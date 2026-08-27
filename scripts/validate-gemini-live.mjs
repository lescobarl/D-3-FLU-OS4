// ============================================================
// Validación REAL en vivo del proxy Gemini (OS4).
// - Apunta al dev server QUE YA ESTÁ CORRIENDO (5176 por defecto).
// - Lee la key real de .env (VITE_OPENROUTER_API_KEY), sin imprimirla.
// - Golpea el MISMO middleware que usa el pizarrón de Gemini:
//     POST /api/gemini/text  (round-trip real → OpenRouter/Gemini)
//   y verifica el gate sin clave (503 no_api_key).
// Uso: node scripts/validate-gemini-live.mjs [puerto]
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = process.argv[2] || '5176'
const BASE = `http://127.0.0.1:${PORT}`

// ── Key real desde .env (nunca se hardcodea) ─────────────────
const envRaw = readFileSync(join(process.cwd(), '.env'), 'utf8')
const keyMatch = envRaw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m)
const REAL_KEY = keyMatch ? keyMatch[1].trim() : ''
if (!REAL_KEY) {
  console.error('✖ VITE_OPENROUTER_API_KEY no está en .env')
  process.exit(1)
}
const KEY_MASK = `${REAL_KEY.slice(0, 8)}…${REAL_KEY.slice(-4)}`

async function post(path, body) {
  let res
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { status: 'NETWORK_ERROR', json: null, raw: String(err?.message || err) }
  }
  const raw = await res.text().catch(() => '')
  let json = null
  try { json = JSON.parse(raw) } catch { /* no JSON */ }
  return { status: res.status, json, raw: raw.slice(0, 160) }
}

// 1) GET / → el servidor está vivo
const app = await fetch(BASE + '/')
console.log(`✅ GET ${BASE}/ → HTTP ${app.status}`)

// 2) POST /api/gemini/text SIN clave → gate 503 no_api_key (sin gastar llamada)
const gate = await post('/api/gemini/text', { prompt: 'di hola' })
console.log(
  gate.json?.error === 'no_api_key' && gate.status === 503
    ? `✅ Gate sin clave → HTTP ${gate.status} error=no_api_key (correcto)`
    : `⚠️  Gate sin clave → HTTP ${gate.status} ${gate.raw}`,
)

// 3) POST /api/gemini/text CON key real → round-trip REAL a OpenRouter/Gemini
console.log(`▶ Llamada REAL con key ${KEY_MASK}…`)
const live = await post('/api/gemini/text', {
  prompt: 'Responde exactamente con la palabra OK y nada mas.',
  apiKey: REAL_KEY,
})
if (live.status === 200 && live.json?.text) {
  console.log(`✅ Round-trip REAL → HTTP 200 | text="${live.json.text.slice(0, 60)}"`)
} else {
  console.log(`✖ Round-trip REAL falló → HTTP ${live.status} | ${live.raw}`)
  if (live.json?.detail) console.log(`   detail: ${String(live.json.detail).slice(0, 200)}`)
  process.exitCode = 1
}
