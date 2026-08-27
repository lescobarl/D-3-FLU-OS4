// ============================================================
// REPRODUCCIÓN EXACTA — Frase real del usuario (OS4)
// ------------------------------------------------------------
// Reproduce el fallo reportado en vivo:
//   "Okay Flow traduce lo que dijiste a español" → FLU repite
//   "你好，我准备好用中文交流了。有什么可以帮您的吗？"
//
// Dos escenarios:
//   1. DINÁMICO: Turno 1 "habla chino" (llamada real) → Turno 2
//      "traduce lo que dijiste a español" usando la fuente real
//      que devolvió el turno 1 (como hace la app vía historial).
//   2. FUENTE FIJA: Turno 2 con la fuente LARGA exacta que el
//      usuario vio en producción ("你好，我准备好用中文交流了。
//      有什么可以帮您的吗？"), para reproducir el caso donde el
//      modelo hace eco pese al override.
//
// Uso: node scripts/test-user-phrase.mjs [puerto]
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Puertos candidatos (idéntico a validate-multiturn) ───────
const CANDIDATE_PORTS = [5174, 5176, 5173, 5175]

async function findBase() {
  const explicit = process.argv[2]
  const ports = explicit ? [Number(explicit)] : CANDIDATE_PORTS
  for (const p of ports) {
    if (!Number.isFinite(p)) continue
    try {
      const res = await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(2500) })
      if (res.ok || res.status < 500) return `http://localhost:${p}`
    } catch { /* siguiente */ }
  }
  console.error(`✖ No se encontró el dev server en puertos: ${ports.join(', ')}`)
  process.exit(1)
}

// ── Key real desde .env ──────────────────────────────────────
const envRaw = readFileSync(join(process.cwd(), '.env'), 'utf8')
const keyMatch = envRaw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m)
const KEY = keyMatch ? keyMatch[1].trim() : ''
if (!KEY) { console.error('✖ VITE_OPENROUTER_API_KEY no está en .env'); process.exit(1) }
const KEY_MASK = `${KEY.slice(0, 8)}…${KEY.slice(-4)}`

// ── Detectores de script ─────────────────────────────────────
const hasHan = (s) => /[\u4e00-\u9fff]/.test(s)
const hasKana = (s) => /[\u3040-\u30ff]/.test(s)
const hasSpanish = (s) =>
  /[áéíóúñü¿¡]/i.test(s) ||
  /\b(el|la|los|las|de|que|y|en|es|un|una|me|te|se|por|para|con|muy|estoy|está|están|son|como|cómo|qué|también|además|porque|cuando|donde|programar|traducción|frase|dijiste|dijiste|hablaste)\b/i.test(s)

// Similitud de Dice sobre el CONJUNTO de caracteres (0..1).
function similarity(a = '', b = '') {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const c of sa) if (sb.has(c)) inter++
  return (2 * inter) / (sa.size + sb.size)
}

async function postContract(base, body) {
  const res = await fetch(`${base}/api/gemini/contract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const raw = await res.text()
  let json = null
  try { json = JSON.parse(raw) } catch { /* no JSON */ }
  return { status: res.status, json, raw: raw.slice(0, 200) }
}

// La app envía history con el FORMATO del diálogo real:
//   { role: 'assistant'|'user', speaker, text, phase, source }
async function postTurn(base, transcript, language = 'es', history = []) {
  const res = await postContract(base, {
    apiKey: KEY,
    transcript,
    language,
    history,
    intent: undefined,
    speaker: undefined,
    theme: undefined,
    role: undefined,
    phase: undefined,
    model: undefined,
  })
  if (res.status !== 200 || !res.json?.contract) {
    return { ok: false, error: `HTTP ${res.status} | ${res.json?.error || res.raw}` }
  }
  const contract = res.json.contract
  const rv = (contract.respuesta_voz || '').trim()
  return { ok: true, rv, model: res.json.diagnostics?.model || '?' }
}

// ── Caso fijo: la fuente LARGA exacta que el usuario vio ─────
const USER_SOURCE = '你好，我准备好用中文交流了。有什么可以帮您的吗？'

function checkEcho(name, rv, source) {
  const echando = hasHan(rv) || rv === source
  const dice = similarity(rv, source)
  console.log(`   ${echando || dice >= 0.6 ? '❌ ECO' : '✅ traducción'} respuesta: ${JSON.stringify(rv)}`)
  console.log(`   ${echando || dice >= 0.6 ? '❌' : '✅'} sin Han (${!hasHan(rv)}) | similitud Dice vs fuente = ${dice.toFixed(3)} (umbral < 0.6) | español: ${hasSpanish(rv)}`)
  return { pass: !echando && dice < 0.6 && !hasHan(rv), rv }
}

const base = await findBase()
console.log(`\n=== REPRODUCCIÓN EXACTA — frase real del usuario | server=${base} | key=${KEY_MASK} ===`)

let passCount = 0
let failCount = 0
function tally(pass, id) {
  console.log(`   → ${pass ? '✅ PASS' : '❌ FAIL'} [${id}]`)
  if (pass) passCount++; else failCount++
}

// ═══ 1. DINÁMICO: turno 1 real → turno 2 con fuente real ────
console.log('\n▶ [dinámico] "habla chino" → "traduce lo que dijiste a español" (fuente = respuesta real del turno 1)')
const t1 = await postTurn(base, 'habla chino')
if (!t1.ok) {
  console.log(`   ❌ turno 1 HTTP: ${t1.error}`)
  failCount++
} else {
  console.log(`   turno 1 (chino): ${JSON.stringify(t1.rv)}`)
  const t2 = await postTurn(base, 'traduce lo que dijiste a español', 'es', [
    { role: 'user', text: 'habla chino' },
    { role: 'assistant', text: t1.rv },
  ])
  if (!t2.ok) {
    console.log(`   ❌ turno 2 HTTP: ${t2.error}`)
    failCount++
  } else {
    const r = checkEcho('dinámico', t2.rv, t1.rv)
    tally(r.pass, 'dinámico')
  }
}

// ═══ 2. FUENTE FIJA: la fuente LARGA exacta de producción ────
console.log('\n▶ [fuente-fija] "traduce lo que dijiste a español" con fuente LARGA de producción:')
console.log(`      fuente: ${JSON.stringify(USER_SOURCE)}`)
const f2 = await postTurn(base, 'traduce lo que dijiste a español', 'es', [
  { role: 'user', text: 'habla chino' },
  { role: 'assistant', text: USER_SOURCE },
])
if (!f2.ok) {
  console.log(`   ❌ turno 2 HTTP: ${f2.error}`)
  failCount++
} else {
  const r = checkEcho('fuente-fija', f2.rv, USER_SOURCE)
  tally(r.pass, 'fuente-fija')
}

// ═══ RESUMEN ─────────────────────────────────────────────────
console.log(`\n=== RESUMEN: ${passCount} pass / ${failCount} fail ===`)
process.exitCode = failCount > 0 ? 1 : 0
