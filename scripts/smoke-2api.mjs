// ============================================================
// Smoke test REAL (end-to-end) del refactor "2 APIs" (OS4)
// ------------------------------------------------------------
// - Arranca Vite en vivo (con el middleware geminiProxy).
// - Golpea los endpoints reales del proxy (código modificado).
// - Verifica las respuestas HTTP reales:
//     1. GET /                          → app carga (200 HTML)
//     2. /api/gemini/text sin clave     → gate 503 no_api_key (sin llamada nativa)
//     3. /api/gemini/text clave inválida→ round-trip REAL a OpenRouter (401 esperado:
//                                         prueba que el formato OpenAI es aceptado)
//     4. /api/workspace-image           → imagen Pollinations sin clave (200 imageUrl)
//     5. /api/gemini/contract sin clave → gate error (sin Google nativo)
//     6. /api/gemini/summary sin clave  → gate error (sin Google nativo)
// NOTA: no expone claves; solo imprime estado/códigos/errores.
// ============================================================
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 5175
const BASE = `http://localhost:${PORT}`

function startServer() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--host', '--strictPort'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  return child
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + '/')
      if (res.ok) return true
    } catch {
      /* server still booting */
    }
    await sleep(500)
  }
  return false
}

async function post(path, body) {
  let res
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { status: 'NETWORK_ERROR', json: null, text: String(err?.message || err) }
  }
  const text = await res.text().catch(() => '')
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text: text.slice(0, 200) }
}

function show(label, r) {
  const j = r.json
  if (j?.imageUrl) {
    console.log(`✅ ${label}\n   HTTP ${r.status} | imageUrl=${j.imageUrl.slice(0, 80)}… | provider=${j.trace?.provider} | hasImage=${j.trace?.hasImage}\n`)
  } else if (j?.text) {
    console.log(`✅ ${label}\n   HTTP ${r.status} | text=${j.text.slice(0, 80)}…\n`)
  } else if (j?.error) {
    console.log(`⚠️  ${label}\n   HTTP ${r.status} | error=${j.error} | code=${j.code || ''} | detail=${String(j.detail || '').slice(0, 70)}\n`)
  } else {
    console.log(`❓ ${label}\n   HTTP ${r.status} | ${r.text.slice(0, 120)}\n`)
  }
}

const server = startServer()
console.log(`▶ Arrancando Vite en :${PORT}…`)
const up = await waitForServer()
if (!up) {
  console.log('✖ No se pudo arrancar Vite en 30s.')
  server.kill()
  process.exit(1)
}
console.log('✔ Vite arriba.\n')

// 1) GET / → app carga
const app = await fetch(BASE + '/')
console.log(`✅ GET /  → HTTP ${app.status} | content-type=${app.headers.get('content-type')}\n`)

// 2) /api/gemini/text sin clave → gate 503 no_api_key
show('POST /api/gemini/text   (sin clave → gate 503)', await post('/api/gemini/text', { prompt: 'di hola' }))

// 3) /api/gemini/text con clave inválida → round-trip real a OpenRouter (401 esperado)
show('POST /api/gemini/text   (clave inválida → round-trip OpenRouter)', await post('/api/gemini/text', { prompt: 'di hola', apiKey: 'sk-invalid-test-key-123456' }))

// 4) /api/workspace-image → imagen Pollinations sin clave
show('POST /api/workspace-image  (Pollinations, sin clave)', await post('/api/workspace-image', {
  workspace: { tipo: 'mapa', titulo: 'Flujo de compra', descripcion: 'diagrama de flujo de una compra online' },
  language: 'es',
}))

// 5) /api/gemini/contract sin clave → gate error (sin Google nativo)
show('POST /api/gemini/contract (sin clave → gate)', await post('/api/gemini/contract', { transcript: 'hola', language: 'es' }))

// 6) /api/gemini/summary sin clave → gate error (sin Google nativo)
show('POST /api/gemini/summary  (sin clave → gate)', await post('/api/gemini/summary', { history: [], language: 'es' }))

server.kill()
console.log('✔ Smoke test finalizado.')
