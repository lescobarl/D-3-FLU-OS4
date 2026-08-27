// ============================================================
// VALIDACIÓN INTEGRAL ANTI-ECHO — los 4 escenarios del reporte
// ------------------------------------------------------------
// 1) "habla en chino"                          → respuesta en chino
// 2) "traduce lo que dijiste al español"       → traducción correcta
// 3) "hola cómo estás en chino"                → respuesta apropiada
//                                               (NO la respuesta anterior)
// 4) "traduce al español lo que dijiste en chino" → traducción correcta
//
// Además valida la MEMORIA DE CONTEXTO de forma determinista (sin red) vía
// vitest (los módulos importan TypeScript que Node puro no resuelve):
//   A) appendDialogueEntry conserva respuesta_voz y mapea roles
//   B) buildConversationMessages mapea role 'flu' → assistant y lee
//      respuesta_voz / text / response / transcript
//   C) buildConversationMessages: turno de traducción → historial vacío
//   D) buildContractCacheKey separa por fuente y firma T:/N
// Las comprobaciones viven en tests/validateIntegralCtx.test.ts.
//
// Uso: node scripts/validate-integral-anti-echo.mjs [puerto]
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// ── Puertos candidatos (igual que validate-multiturn) ────────
const CANDIDATE_PORTS = [5174, 5176, 5173, 5175]

async function findBase() {
  const explicit = process.argv[2]
  const ports = explicit ? [Number(explicit)] : CANDIDATE_PORTS
  for (const p of ports) {
    if (!Number.isFinite(p)) continue
    try {
      const res = await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(2500) })
      if (res.ok || res.status < 500) return `http://localhost:${p}`
    } catch { /* seguir */ }
  }
  console.error(`✖ No se encontró el dev server en puertos: ${ports.join(', ')}`)
  process.exit(1)
}

const envRaw = readFileSync(join(process.cwd(), '.env'), 'utf8')
const keyMatch = envRaw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m)
const KEY = keyMatch ? keyMatch[1].trim() : ''
if (!KEY) { console.error('✖ VITE_OPENROUTER_API_KEY no está en .env'); process.exit(1) }
const KEY_MASK = `${KEY.slice(0, 8)}…${KEY.slice(-4)}`

const hasHan = (s) => /[\u4e00-\u9fff]/.test(s)
const hasKana = (s) => /[\u3040-\u30ff]/.test(s)
const hasSpanish = (s) =>
  /[áéíóúñü¿¡]/i.test(s) ||
  /\b(el|la|los|las|de|que|y|en|es|un|una|me|te|se|por|para|con|muy|estoy|está|están|son|como|cómo|qué|también|además|porque|cuando|donde|hola|bien|gracias|traduc|respuesta|anterior|dijiste|hablaste)\b/i.test(s)

function diceSimilarity(a = '', b = '') {
  const sa = new Set(String(a))
  const sb = new Set(String(b))
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const c of sa) if (sb.has(c)) inter++
  return (2 * inter) / (sa.size + sb.size)
}

const END = '[^.,，。!?！？;；:：、…]'
const ACK_PATTERNS = [
  new RegExp(`^(entendido|de acuerdo|claro|perfecto|bueno|esta bien|está bien|ok|okay|understood|got it|sure|i will|i can|absolutely)${END}*$`, 'i'),
  new RegExp(`^(好的|好的，|明白|明白，|知道了|知道了，|我明白|我明白了|我知道了|我会用中文|我會用中文|我将用中文|我將用中文|我用中文|我現在用中文|我现在用中文|接下来用中文|接下來用中文)[^。！？]*?(用中文|說中文|说中文|用漢語|用汉语|用中文说话|用中文說話|用中文回答|用中文交流|用中文对话|用中文對話)[^。！？]*$`),
]
function classify(rv) {
  const t = (rv || '').trim()
  if (!t) return 'VACÍA'
  const core = t.replace(/[\s.,，。!?！？;；:：、…]+$/u, '').trim()
  if (ACK_PATTERNS.some((re) => re.test(core))) return 'ACUSE (sin contenido)'
  if (core.length <= 8 && !hasHan(core) && !hasKana(core)) return 'ACUSE (sin contenido)'
  return 'CONTENIDO'
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

async function postTurn(base, transcript, language = 'es', history = []) {
  const res = await postContract(base, {
    apiKey: KEY, transcript, language, history,
    intent: undefined, speaker: undefined, theme: undefined, role: undefined,
    phase: undefined, model: undefined,
  })
  if (res.status !== 200 || !res.json?.contract) {
    return { ok: false, error: `HTTP ${res.status} | ${res.json?.error || res.raw}` }
  }
  const contract = res.json.contract
  const rv = (contract.respuesta_voz || '').trim()
  return {
    ok: true, rv, kind: classify(rv),
    model: res.json.diagnostics?.model || '?',
    retries: res.json.diagnostics?.translationRetries,
    echoFallback: res.json.diagnostics?.translationEchoFallback,
  }
}

const base = await findBase()
console.log(`\n=== VALIDACIÓN INTEGRAL ANTI-ECHO | server=${base} | key=${KEY_MASK} ===`)

let passCount = 0
let failCount = 0
const results = []

function report(id, checks, extra = {}) {
  const fails = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log(`   ${ok ? '✅' : '❌'} check ${name}`)
  if (extra.rv !== undefined) console.log(`   respuesta: ${JSON.stringify(extra.rv)}`)
  if (extra.kind) console.log(`   clase    : ${extra.kind}`)
  if (extra.diag) console.log(`   diag     : ${extra.diag}`)
  const pass = fails.length === 0
  results.push({ id, pass, fails: fails.map(([n]) => n), ...extra })
  if (pass) passCount++; else failCount++
}

// ═══ ESCENARIO 1: "habla en chino" → chino ─────────────────
console.log('\n▶ [S1] "habla en chino" → respuesta en chino')
const s1 = await postTurn(base, 'habla en chino')
report(s1.ok ? 'S1-zh' : 'S1-zh-http',
  s1.ok
    ? [['no-acuse', s1.kind === 'CONTENIDO'], ['chino(han)', hasHan(s1.rv)]]
    : [['http', false]],
  s1.ok ? { rv: s1.rv, kind: s1.kind, model: s1.model } : { error: s1.error })

// ═══ ESCENARIO 2: "traduce lo que dijiste al español" ──────
console.log('\n▶ [S2] "traduce lo que dijiste al español" → traducción correcta')
const S2_SOURCE = s1.ok && hasHan(s1.rv) ? s1.rv : '你好，我准备好用中文交流了。有什么可以帮您的吗？'
const s2 = await postTurn(base, 'traduce lo que dijiste al español', 'es', [
  { role: 'user', transcript: 'habla en chino' },
  { role: 'assistant', response: S2_SOURCE },
])
report(s2.ok ? 'S2-es' : 'S2-es-http',
  s2.ok
    ? [
        ['no-acuse', s2.kind === 'CONTENIDO'],
        ['no-chino', !hasHan(s2.rv)],
        ['no-japones', !hasKana(s2.rv)],
        ['español', hasSpanish(s2.rv)],
        ['no-identica-fuente', s2.rv !== S2_SOURCE],
        ['baja-similitud', diceSimilarity(s2.rv, S2_SOURCE) < 0.6],
      ]
    : [['http', false]],
  s2.ok
    ? { rv: s2.rv, kind: s2.kind, model: s2.model, diag: `retries=${s2.retries} echoFallback=${s2.echoFallback}` }
    : { error: s2.error })

// ═══ ESCENARIO 3: "hola cómo estás en chino" ────────────────
console.log('\n▶ [S3] "hola cómo estás en chino" → respuesta apropiada en chino (NO la anterior)')
// Fuente previa distinta (para comprobar que NO se repite).
const S3_PREV = '好的，我们开始用中文交流吧，请问你今天过得怎么样？'
const s3 = await postTurn(base, 'hola cómo estás en chino', 'es', [
  { role: 'user', transcript: 'habla en chino' },
  { role: 'assistant', response: S3_PREV },
])
report(s3.ok ? 'S3-zh' : 'S3-zh-http',
  s3.ok
    ? [
        ['no-acuse', s3.kind === 'CONTENIDO'],
        ['chino(han)', hasHan(s3.rv)],
        ['no-identica-anterior', s3.rv !== S3_PREV],
        ['baja-similitud-anterior', diceSimilarity(s3.rv, S3_PREV) < 0.6],
      ]
    : [['http', false]],
  s3.ok ? { rv: s3.rv, kind: s3.kind, model: s3.model } : { error: s3.error })

// ═══ ESCENARIO 4: "traduce al español lo que dijiste en chino" ──
console.log('\n▶ [S4] "traduce al español lo que dijiste en chino" → traducción correcta')
const S4_SOURCE = '好的，我们开始用中文交流吧，请问你今天过得怎么样？'
const s4 = await postTurn(base, 'traduce al español lo que dijiste en chino', 'es', [
  { role: 'user', transcript: 'habla en chino' },
  { role: 'assistant', response: S4_SOURCE },
])
report(s4.ok ? 'S4-es' : 'S4-es-http',
  s4.ok
    ? [
        ['no-acuse', s4.kind === 'CONTENIDO'],
        ['no-chino', !hasHan(s4.rv)],
        ['español', hasSpanish(s4.rv)],
        ['no-identica-fuente', s4.rv !== S4_SOURCE],
        ['baja-similitud', diceSimilarity(s4.rv, S4_SOURCE) < 0.6],
      ]
    : [['http', false]],
  s4.ok
    ? { rv: s4.rv, kind: s4.kind, model: s4.model, diag: `retries=${s4.retries} echoFallback=${s4.echoFallback}` }
    : { error: s4.error })

// ═══ MEMORIA DE CONTEXTO (determinista, sin red) ─────────────
// Los módulos importan TypeScript (fluConfig.js → appConfig.ts) que Node puro
// no resuelve sin loader; vitest (Vite) sí. Las comprobaciones deterministas
// viven en tests/validateIntegralCtx.test.ts y se ejecutan aquí como subproceso.
console.log('\n▶ [CTX] Memoria de contexto — determinista (vía vitest)')
try {
  execFileSync('npx', ['vitest', 'run', 'tests/validateIntegralCtx.test.ts', '--reporter=dot'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
    timeout: 120000,
  })
  report('CTX-determinista', [['vitest-suite-pasa', true]])
} catch (err) {
  const diag =
    typeof err?.status === 'number'
      ? `exit=${err.status}`
      : String(err?.code || err?.message || err)
  report('CTX-determinista', [['vitest-suite-pasa', false]], { diag })
}

// ═══ RESUMEN ────────────────────────────────────────────────
console.log('\n\n=== RESUMEN ===')
for (const r of results) {
  const mark = r.pass ? '✅ PASS' : '❌ FAIL'
  console.log(`   ${mark} [${r.id}]${r.fails?.length ? ' — falla: ' + r.fails.join(', ') : ''}`)
}
console.log(`\n   TOTAL: ${passCount} pass / ${failCount} fail de ${results.length} escenarios`)
process.exitCode = failCount > 0 ? 1 : 0
