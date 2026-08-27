// ============================================================
// VALIDACIÓN MULTI-TURNO — Traducción de la respuesta anterior (OS4)
// ------------------------------------------------------------
// Golpea el MISMO endpoint que usa la app en producción:
//   POST /api/gemini/contract  (dev server ya corriendo)
//
// Reproduce EXACTAMENTE la secuencia del bug:
//   Turno 1: "okay flow habla chino"                        → FLU responde en chino
//   Turno 2: "okay flow traduce a español lo que hablaste"  → FLU debe responder
//            en ESPAÑOL (antes repetía la respuesta china).
//
// El turno 2 envía history con la respuesta del turno 1 para que el
// detector de intención de traducción (gemini.js) re-enmarque el prompt
// con un bloque EXPLÍCITO que ANULA la directiva IDIOMA.
//
// Validación de EQUIVALENCIA DE TRADUCCIÓN (no solo "contiene español"):
//   - t2-no-identica   : la respuesta NO debe ser idéntica a la del turno 1
//                        (el bug clásico: FLU repetía la frase china).
//   - t2-baja-similitud: la similitud de caracteres (Dice) con la respuesta
//                        anterior debe ser BAJA; una traducción real comparte
//                        pocos caracteres con el original chino.
//   - t2-es-traduccion : sin Han, sin Kana, con español y con contenido real.
//   - e2-no-identica   : mismo control en la variante EN→ES.
//
// Controles (sin regresión):
//   - "habla en chino y cuéntame un dato de la luna"  → chino (Han)
//   - "traduce al chino esta frase: me encanta programar" → chino (frase aislada)
//   - "hola, ¿cómo estás hoy?"                        → español
//   - multi-turno EN: "habla en inglés" → "traduce a español lo que dijiste"
//
// Uso: node scripts/validate-multiturn-translation.mjs [puerto]
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Puertos candidatos (se usa el primero que responda) ─────
// Nota: si 5173 está ocupado por un servidor "stale" (sin middleware /api/*),
// Vite auto-incrementa y el server real con middleware queda en 5174.
// Por eso 5174 va PRIMERO en la lista.
const CANDIDATE_PORTS = [5174, 5176, 5173, 5175]

async function findBase() {
  const explicit = process.argv[2]
  const ports = explicit ? [Number(explicit)] : CANDIDATE_PORTS
  for (const p of ports) {
    if (!Number.isFinite(p)) continue
    try {
      const res = await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(2500) })
      if (res.ok || res.status < 500) return `http://localhost:${p}`
    } catch { /* seguir con el siguiente puerto */ }
  }
  console.error(`✖ No se encontró el dev server en puertos: ${ports.join(', ')}`)
  process.exit(1)
}

// ── Key real desde .env (nunca se hardcodea) ─────────────────
const envRaw = readFileSync(join(process.cwd(), '.env'), 'utf8')
const keyMatch = envRaw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m)
const KEY = keyMatch ? keyMatch[1].trim() : ''
if (!KEY) { console.error('✖ VITE_OPENROUTER_API_KEY no está en .env'); process.exit(1) }
const KEY_MASK = `${KEY.slice(0, 8)}…${KEY.slice(-4)}`

// ── Detectores de script ─────────────────────────────────────
const hasHan = (s) => /[\u4e00-\u9fff]/.test(s)
const hasKana = (s) => /[\u3040-\u30ff]/.test(s)
const hasLatin = (s) => /[A-Za-z]/.test(s)
const hasSpanish = (s) =>
  /[áéíóúñü¿¡]/i.test(s) ||
  /\b(el|la|los|las|de|que|y|en|es|un|una|me|te|se|por|para|con|muy|estoy|está|están|son|como|cómo|qué|también|además|porque|cuando|donde|programar|traducción|frase)\b/i.test(s)

// Similitud de Dice sobre el CONJUNTO de caracteres (0..1).
// Una traducción real del chino al español comparte muy pocos caracteres con
// el original (casi ninguno); repetir la frase da similitud 1.0.
function similarity(a = '', b = '') {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const c of sa) if (sb.has(c)) inter++
  return (2 * inter) / (sa.size + sb.size)
}

// ── Fuente REAL del bug en vivo ───────────────────────────────
// La frase exacta que FLU respondió en producción tras "habla chino" y que se
// negó a traducir (la repetía en vez de traducirla). Se inyecta de forma
// determinista como última respuesta del asistente en el turno 2 para
// reproducir EXACTAMENTE el fallo reportado (fuente larga + conversacional).
const REAL_SOURCE = '你好，我准备好用中文交流了。有什么可以帮您的吗？'

// ── Clasificador honesto de ACUSE (sin contenido) ─────────────
const END = '[^.,，。!?！？;；:：、…]'
const ACK_PATTERNS = [
  new RegExp(`^(entendido|de acuerdo|claro|perfecto|bueno|esta bien|está bien|ok|okay|understood|got it|sure|i will|i can|absolutely)${END}*$`, 'i'),
  new RegExp(`^(好的|好的，|明白|明白，|知道了|知道了，|我明白|我明白了|我知道了|我会用中文|我會用中文|我将用中文|我將用中文|我用中文|我現在用中文|我现在用中文|接下来用中文|接下來用中文)[^。！？]*?(用中文|說中文|说中文|用漢語|用汉语|用中文说话|用中文說話|用中文回答|用中文交流|用中文对话|用中文對話)[^。！？]*$`),
  new RegExp(`^(はい、|うん、)?(日本語で話します|日本語でお話しします|日本語でお答えします|日本語で返事します|日本語で答えます|日本語でお答え|日本語で話す|中国語で話します|中国語でお話しします|中国語でお答えします|英語で話します|英語でお話しします|わかりました|分かりました|了解しました|はい)${END}*$`),
  new RegExp(`^.{0,30}(用中文说话|用中文說話|用中文回答|用中文回复|用中文回復|说中文|說中文|会讲中文|會講中文)${END}{0,6}$`),
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
  return {
    ok: true,
    rv,
    kind: classify(rv),
    model: res.json.diagnostics?.model || '?',
  }
}

const base = await findBase()
console.log(`\n=== VALIDACIÓN MULTI-TURNO (traducción de respuesta anterior) | server=${base} | key=${KEY_MASK} ===`)

let passCount = 0
let failCount = 0
const results = []

function report(id, checks, extra = {}) {
  const fails = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log(`   ${ok ? '✅' : '❌'} check ${name}`)
  if (extra.rv !== undefined) console.log(`   respuesta: ${JSON.stringify(extra.rv)}`)
  if (extra.kind) console.log(`   clase    : ${extra.kind}`)
  if (extra.model) console.log(`   modelo   : ${extra.model}`)
  const pass = fails.length === 0
  results.push({ id, pass, fails: fails.map(([n]) => n), ...extra })
  if (pass) passCount++; else failCount++
}

// ═══ ESCENARIO PRINCIPAL: el bug exacto ─────────────────────
console.log('\n▶ [multiturn-zh→es] secuencia: "habla chino" → "traduce a español lo que hablaste"')
const t1 = await postTurn(base, 'okay flow habla chino')
if (!t1.ok) {
  report('multiturn-zh→es', [['http', false]], { error: t1.error })
} else {
  // El turno 1 solo debe demostrar el cambio de idioma a chino. El modelo puede
  // responder con contenido o con un acuse breve EN CHINO ("好的，我们现在用中文交流。");
  // ambos son válidos y demuestran el switch. Se exige chino (Han) y que NO sea
  // un acuse en otro idioma (español/inglés sin Han).
  report('multiturn-t1-zh', [
    ['t1-chino(han)', hasHan(t1.rv)],
    ['t1-no-acuse-otro-idioma', t1.kind === 'CONTENIDO' || hasHan(t1.rv) || hasKana(t1.rv)],
  ], { rv: t1.rv, kind: t1.kind, model: t1.model })

  // Turno 2: la fuente a traducir es la frase REAL que falló en vivo (larga y
  // conversacional), NO la respuesta corta que el modelo pueda generar aquí.
  const t2 = await postTurn(base, 'okay flow traduce a español lo que hablaste', 'es', [
    { role: 'user', transcript: 'okay flow habla chino' },
    { role: 'assistant', response: REAL_SOURCE },
  ])
  if (!t2.ok) {
    report('multiturn-t2-es', [['http', false]], { error: t2.error })
  } else {
    report('multiturn-t2-es', [
      ['t2-no-acuse', t2.kind === 'CONTENIDO'],
      ['t2-no-chino', !hasHan(t2.rv)],
      ['t2-no-japones', !hasKana(t2.rv)],
      ['t2-es-traduccion', !hasHan(t2.rv) && !hasKana(t2.rv) && hasSpanish(t2.rv) && t2.kind === 'CONTENIDO'],
      ['t2-no-identica', t2.rv !== REAL_SOURCE],
      ['t2-baja-similitud', similarity(t2.rv, REAL_SOURCE) < 0.6],
    ], { rv: t2.rv, kind: t2.kind, model: t2.model })
  }
}

// ═══ VARIANTE EN: "habla en inglés" → "traduce a español lo que dijiste" ──
console.log('\n▶ [multiturn-en→es] secuencia: "habla en inglés" → "traduce a español lo que dijiste"')
const e1 = await postTurn(base, 'okay flow habla en inglés')
if (!e1.ok) {
  report('multiturn-en→es', [['e1-http', false]], { error: e1.error })
} else {
  report('multiturn-e1-en', [
    ['e1-no-acuse', e1.kind === 'CONTENIDO'],
    ['e1-latin(inglés)', hasLatin(e1.rv) && !hasSpanish(e1.rv)],
  ], { rv: e1.rv, kind: e1.kind, model: e1.model })

  const e2 = await postTurn(base, 'okay flow traduce a español lo que dijiste', 'es', [
    { role: 'user', transcript: 'okay flow habla en inglés' },
    { role: 'assistant', response: e1.rv },
  ])
  if (!e2.ok) {
    report('multiturn-e2-es', [['e2-http', false]], { error: e2.error })
  } else {
    report('multiturn-e2-es', [
      ['e2-no-acuse', e2.kind === 'CONTENIDO'],
      ['e2-español', hasSpanish(e2.rv)],
      ['e2-no-inglés', !(hasLatin(e2.rv) && !hasSpanish(e2.rv))],
      ['e2-no-identica', e2.rv !== e1.rv],
    ], { rv: e2.rv, kind: e2.kind, model: e2.model })
  }
}

// ═══ ESCENARIO CONTAMINACIÓN: el bug REAL ─────────────────────
// El bug original no era solo "seguir en chino": FLU añadía contenido de un
// tema ANTERIOR (aviones) a la traducción ("¿Tiene alguna pregunta específica
// sobre aviones…?"). Aquí se inyecta un tema de aviones ANTES del turno de
// chino y se exige que la traducción salga PURA, sin rastro del tema ajeno.
// El turno de traducción NO reenvía historial como mensajes (la fuente va en
// el override del system prompt), así que no puede filtrarse ni el tema de
// aviones ni la respuesta china que el modelo repetía (eco).
console.log('\n▶ [contaminacion-zh→es] historial previo con tema AVIONES + "habla chino" → "traduce a español lo que hablaste"')
const ct1 = await postTurn(base, 'okay flow habla chino')
if (!ct1.ok) {
  report('contaminacion-zh→es', [['http', false]], { error: ct1.error })
} else {
  report('contaminacion-t1-zh', [
    ['t1-chino(han)', hasHan(ct1.rv)],
  ], { rv: ct1.rv, kind: ct1.kind, model: ct1.model })

  const contaminatedHistory = [
    // Tema ajeno ANTES del turno de chino (la contaminación del bug real).
    { role: 'user', transcript: 'cuéntame sobre los aviones' },
    { role: 'assistant', response: 'Claro, los aviones son aeronaves de ala fija que vuelan por el empuje de sus motores y la sustentación de sus alas.' },
    // El turno que hay que traducir (última respuesta del asistente).
    { role: 'user', transcript: 'okay flow habla chino' },
    { role: 'assistant', response: ct1.rv },
  ]
  const ct2 = await postTurn(base, 'okay flow traduce a español lo que hablaste', 'es', contaminatedHistory)
  if (!ct2.ok) {
    report('contaminacion-t2-es', [['http', false]], { error: ct2.error })
  } else {
    report('contaminacion-t2-es', [
      ['t2-no-acuse', ct2.kind === 'CONTENIDO'],
      ['t2-no-chino', !hasHan(ct2.rv)],
      ['t2-no-japones', !hasKana(ct2.rv)],
      ['t2-es-traduccion', !hasHan(ct2.rv) && !hasKana(ct2.rv) && hasSpanish(ct2.rv) && ct2.kind === 'CONTENIDO'],
      ['t2-no-identica', ct2.rv !== ct1.rv],
      ['t2-baja-similitud', similarity(ct2.rv, ct1.rv) < 0.6],
      ['t2-sin-tema-aviones', !/(avión|aviones|avion|avions|airplane|aircraft|aeronave|sustentación|sustentacion|ala fija|motores)/i.test(ct2.rv)],
    ], { rv: ct2.rv, kind: ct2.kind, model: ct2.model })
  }
}

// ═══ CONTROLES: sin regresión ────────────────────────────────
console.log('\n▶ [control] "habla en chino y cuéntame un dato de la luna" → chino (cambio de idioma normal)')
const c1 = await postTurn(base, 'habla en chino y cuéntame un dato de la luna')
report(c1.ok ? 'control-zh-content' : 'control-zh-content-http',
  c1.ok
    ? [['no-acuse', c1.kind === 'CONTENIDO'], ['han(chino)', hasHan(c1.rv)]]
    : [['http', false]],
  c1.ok ? { rv: c1.rv, kind: c1.kind, model: c1.model } : { error: c1.error })

console.log('\n▶ [control] "traduce al chino esta frase: me encanta programar con mi equipo" → chino (frase aislada)')
const c2 = await postTurn(base, 'traduce al chino esta frase: me encanta programar con mi equipo')
report(c2.ok ? 'control-translate-zh' : 'control-translate-zh-http',
  c2.ok
    ? [['no-acuse', c2.kind === 'CONTENIDO'], ['han(chino)', hasHan(c2.rv)]]
    : [['http', false]],
  c2.ok ? { rv: c2.rv, kind: c2.kind, model: c2.model } : { error: c2.error })

console.log('\n▶ [control] "hola, ¿cómo estás hoy?" → español (normal, sin regresión)')
const c3 = await postTurn(base, 'hola, ¿cómo estás hoy?')
report(c3.ok ? 'control-normal-es' : 'control-normal-es-http',
  c3.ok
    ? [['no-acuse', c3.kind === 'CONTENIDO'], ['español', hasSpanish(c3.rv)]]
    : [['http', false]],
  c3.ok ? { rv: c3.rv, kind: c3.kind, model: c3.model } : { error: c3.error })

// ═══ RESUMEN ─────────────────────────────────────────────────
console.log('\n\n=== RESUMEN ===')
for (const r of results) {
  const mark = r.pass ? '✅ PASS' : '❌ FAIL'
  console.log(`   ${mark} [${r.id}]${r.fails?.length ? ' — falla: ' + r.fails.join(', ') : ''}`)
}
console.log(`\n   TOTAL: ${passCount} pass / ${failCount} fail de ${results.length} escenarios`)
process.exitCode = failCount > 0 ? 1 : 0
