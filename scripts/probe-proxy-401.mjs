// Diagnostic: verifica que el proxy ignora una apiKey obsoleta/inválida del
// navegador (39 chars, basura) cuando el servidor tiene key en .env (73 chars).
// Reproduce el escenario exacto del 401 "Missing Authentication header".
// Uso: node scripts/probe-proxy-401.mjs [puerto]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import http from 'node:http'

const port = process.argv[2] || '5174'
const base = `http://localhost:${port}/api/gemini/contract`

// Key real del .env (73 chars) — solo para comparar longitudes y el caso "clave buena".
const envRaw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
const envMatch = envRaw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m)
const envKey = envMatch ? envMatch[1].trim() : ''
const BAD_KEY = 'x'.repeat(39) // simula la key obsoleta de localStorage (39 chars)

// node:http con Connection: close evita sockets keep-alive de undici que
// provocan el assert UV_HANDLE_CLOSING al salir del proceso en Windows.
function postJson(url, body) {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(url)
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'close',
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { data += c })
        res.on('end', () => resolvePromise({ status: res.statusCode, text: data }))
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function probe(label, body) {
  const { status, text } = await postJson(base, body)
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* noop */ }
  const contractOk = !!(parsed?.contract && parsed.contract !== null)
  const hasError = !!(parsed?.error || /401|Missing Authentication/.test(text))
  console.log(`\n▶ ${label}`)
  console.log(`   HTTP ${status} | contract=${contractOk} | error=${hasError}`)
  if (parsed?.diagnostics) {
    console.log(`   diagnostics.model=${parsed.diagnostics.model}`)
    console.log(`   diagnostics.apiKeySource=${parsed.diagnostics.apiKeySource}`)
  }
  if (parsed?.contract?.metadata) {
    console.log(`   metadata.clase=${parsed.contract.metadata.clase}`)
  }
  if (parsed?.contract?.respuesta) {
    console.log(`   respuesta=${String(parsed.contract.respuesta).slice(0, 60)}`)
  }
  if (parsed?.error) {
    console.log(`   error=${String(parsed.error).slice(0, 160)}`)
  }
  return { status, contractOk, hasError }
}

const r1 = await probe('apiKey=BAD(39 chars, obsoleta) — la que causaba el 401', {
  apiKey: BAD_KEY,
  transcript: 'hola, ¿cómo estás hoy?',
  mode: 'contract',
})
const r2 = await probe('apiKey vacío (sin key del cliente)', {
  apiKey: '',
  transcript: 'hola, ¿cómo estás hoy?',
  mode: 'contract',
})
const r3 = await probe('apiKey=GOOD (key real del .env, 73 chars)', {
  apiKey: envKey,
  transcript: 'hola, ¿cómo estás hoy?',
  mode: 'contract',
})

console.log('\n=== RESUMEN PROBE 401 ===')
const summary = { badKey: r1, emptyKey: r2, goodKey: r3 }
const pass = ['badKey', 'emptyKey', 'goodKey'].every(
  (k) => summary[k].status === 200 && summary[k].contractOk && !summary[k].hasError,
)
console.log('   badKey   :', r1.status === 200 && r1.contractOk && !r1.hasError ? 'PASS (ignora basura)' : 'FAIL')
console.log('   emptyKey :', r2.status === 200 && r2.contractOk && !r2.hasError ? 'PASS (usa key servidor)' : 'FAIL')
console.log('   goodKey  :', r3.status === 200 && r3.contractOk && !r3.hasError ? 'PASS' : 'FAIL')
console.log('   TOTAL:', pass ? '3 pass / 0 fail' : 'HAY FALLOS')
process.exitCode = pass ? 0 : 1
