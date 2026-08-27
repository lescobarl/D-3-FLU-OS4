// ============================================================
// VALIDACIÓN DE FONDO — Funcionalidad de "humano" (0 parches)
// ------------------------------------------------------------
// Golpea el MISMO endpoint que usa la app en producción:
//   POST /api/gemini/contract  (dev server ya corriendo)
// que ejecuta generateFluContract con el pipeline COMPLETO:
// system prompt IDIOMA + user prompt + modelo real (flash-lite)
// contra OpenRouter con la clave real de .env.
//
// Escenarios:
//   1. "habla en chino"             → reproducción EXACTA del bug
//   2. "habla en chino: <contenido>" → ¿produce contenido real en chino?
//   3. "habla en japonés"           → variante del bug (japonés)
//   4. "traduce al inglés: ..."     → caso que el patch manejaba mal
//   5. "hola, ¿cómo estás?"         → español normal (sin regresión)
//   6. "pon música relajante"       → campo musica desde el MODELO
//   7. "traduce al chino: ..."      → traducción es→zh
//   8. "traduce al español: 中文..." → traducción zh→es (ambos sentidos)
//
// Los checks son DIAGNÓSTICO (no parches): solo inspeccionan la
// salida y reportan; nunca modifican el comportamiento.
// Uso: node scripts/validate-human-function.mjs [puerto]
// ============================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Puertos candidatos (se usa el primero que responda) ─────
const CANDIDATE_PORTS = [5176, 5173, 5175]

async function findBase() {
  const explicit = process.argv[2]
  const ports = explicit ? [Number(explicit)] : CANDIDATE_PORTS
  for (const p of ports) {
    if (!Number.isFinite(p)) continue
    // localhost resuelve a ::1 y 127.0.0.1 (el dev server escucha en IPv6 [::1]).
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

const hasHan = (s) => /[\u4e00-\u9fff]/.test(s)
const hasKana = (s) => /[\u3040-\u30ff]/.test(s)
const hasLatin = (s) => /[A-Za-z]/.test(s)
// Español: acentos/ñ/¿¡ o palabras españolas típicas (para validar zh→es)
const hasSpanish = (s) =>
  /[áéíóúñü¿¡]/i.test(s) ||
  /\b(el|la|los|las|de|que|y|en|es|un|una|me|te|se|por|para|con|muy|estoy|está|están|son|como|cómo|qué|también|además|porque|cuando|donde|programar|traducción|frase)\b/i.test(s)

// ── Clasificador honesto de ACUSE (sin contenido) ─────────────
// La regla IDIOMA (gemini.js) prohíbe responder con un simple aviso tipo
// "entendido, hablaré en chino". Detectamos esos meta-avisos de idioma en
// es/en, zh (simplificado Y tradicional) y ja (con o sin はい、). Un carácter
// de puntuación final (。.!?…) tras el aviso no lo esconde.
const END = '[^.,，。!?！？;；:：、…]'
const ACK_PATTERNS = [
  // es/en: acuses cortos sin contenido real
  new RegExp(`^(entendido|de acuerdo|claro|perfecto|bueno|esta bien|está bien|ok|okay|understood|got it|sure|i will|i can|absolutely)${END}*$`, 'i'),
  // zh: "voy a hablar/responder en chino" (simplificado y tradicional)
  new RegExp(`^(好的|好的，|明白|明白，|知道了|知道了，|我明白|我明白了|我知道了|我会用中文|我會用中文|我将用中文|我將用中文|我用中文|我現在用中文|我现在用中文|接下来用中文|接下來用中文)[^。！？]*?(用中文|說中文|说中文|用漢語|用汉语|用中文说话|用中文說話|用中文回答|用中文交流|用中文对话|用中文對話)[^。！？]*$`),
  // ja: "hablaré/responderé en japonés/chino/inglés" (con o sin はい、)
  new RegExp(`^(はい、|うん、)?(日本語で話します|日本語でお話しします|日本語でお答えします|日本語で返事します|日本語で答えます|日本語でお答え|日本語で話す|中国語で話します|中国語でお話しします|中国語でお答えします|英語で話します|英語でお話しします|わかりました|分かりました|了解しました|はい)${END}*$`),
  // zh: red de seguridad — frase corta cuyo único contenido es anunciar el idioma
  new RegExp(`^.{0,30}(用中文说话|用中文說話|用中文回答|用中文回复|用中文回復|说中文|說中文|会讲中文|會講中文)${END}{0,6}$`),
  // PREFIJO-ACUSE (ja): la PRIMERA frase es un aviso de cambio de idioma, aunque
  // después siga una pregunta. La regla IDIOMA lo prohíbe. ≠ patrón previo, que
  // exigía que TODA la respuesta fuera el aviso (una pregunta final lo escondía).
  new RegExp(`^(はい、|うん、)?(日本語で話します|日本語でお話しします|日本語でお答えします|日本語で返事します|日本語で答えます|日本語でお答え|日本語で話す|中国語で話します|中国語でお話しします|中国語でお答えします|英語で話します|英語でお話しします)([、。，!?！？]|$)`),
  // PREFIJO-ACUSE (zh): primera frase que anuncia que hablará en chino (con o sin
  // "好的/明白" previo), incluso si después viene pregunta o contenido.
  new RegExp(`^(好的，?|明白，?|知道了，?)?(我会用中文|我會用中文|我将用中文|我將用中文|我现在用中文|我現在用中文|接下来用中文|接下來用中文|我们继续用中文|我們繼續用中文|我们用中文|我們用中文|咱们用中文|咱用中文|用中文说话|用中文說話|用中文回答|用中文交流|用中文回复|用中文回復)`),
]

function classify(rv) {
  const t = (rv || '').trim()
  if (!t) return 'VACÍA'
  const core = t.replace(/[\s.,，。!?！？;；:：、…]+$/u, '').trim()
  if (ACK_PATTERNS.some((re) => re.test(core))) return 'ACUSE (sin contenido)'
  if (core.length <= 8 && !hasHan(core) && !hasKana(core)) return 'ACUSE (sin contenido)'
  return 'CONTENIDO'
}

const CASES = [
  { id: 'zh-bare', transcript: 'habla en chino', lang: 'es', script: hasHan, scriptName: 'Han (chino)' },
  { id: 'zh-content', transcript: 'habla en chino y cuéntame un dato interesante sobre la luna', lang: 'es', script: hasHan, scriptName: 'Han (chino)' },
  { id: 'ja-bare', transcript: 'habla en japonés', lang: 'es', script: (s) => hasKana(s) || hasHan(s), scriptName: 'Kana/Han (japonés)' },
  { id: 'translate-en', transcript: 'traduce al inglés esta frase: me encanta programar con mi equipo', lang: 'es', script: hasLatin, scriptName: 'Latino (inglés)' },
  { id: 'translate-zh', transcript: 'traduce al chino esta frase: me encanta programar con mi equipo', lang: 'es', script: hasHan, scriptName: 'Han (es→zh)' },
  { id: 'translate-es', transcript: 'traduce al español esta frase: 我喜欢在周末和我的团队一起编程', lang: 'es', script: (s) => hasSpanish(s), scriptName: 'Español (zh→es)' },
  { id: 'normal-es', transcript: 'hola, ¿cómo estás hoy?', lang: 'es', script: hasLatin, scriptName: 'Latino (español)' },
  { id: 'music', transcript: 'pon música relajante de fondo', lang: 'es', expectMusica: true },
]

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

async function runCase(base, c) {
  process.stdout.write(`\n▶ [${c.id}] transcript="${c.transcript}"\n`)
  let res
  try {
    res = await postContract(base, {
      apiKey: KEY,
      transcript: c.transcript,
      language: c.lang,
      intent: undefined,
      speaker: undefined,
      theme: undefined,
      role: undefined,
      phase: undefined,
      model: undefined,
    })
  } catch (err) { console.log(`   ✖ ERROR al llamar: ${err?.message || err}`); return { pass: false } }

  if (res.status !== 200 || !res.json?.contract) {
    console.log(`   ✖ HTTP ${res.status} | ${res.json?.error || res.raw}`)
    return { pass: false, fails: ['http'], kind: 'ERROR', rv: res.json?.error || res.raw }
  }

  const contract = res.json.contract
  const rv = (contract.respuesta_voz || '').trim()
  const kind = classify(rv)
  const musica = contract.musica
  const model = res.json.diagnostics?.model || '?'

  console.log(`   modelo   : ${model}`)
  console.log(`   respuesta: ${JSON.stringify(rv)}`)
  console.log(`   musica   : ${JSON.stringify(musica)}`)
  console.log(`   clase    : ${kind}`)

  const checks = []
  checks.push(['no-acuse', kind === 'CONTENIDO'])
  if (c.expectMusica) {
    checks.push(['musica-play', musica?.accion === 'play_music'])
    checks.push(['musica-cancion', Boolean(musica?.cancion)])
  } else {
    checks.push([`script:${c.scriptName}`, c.script(rv)])
  }
  const fails = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log(`   ${ok ? '✅' : '❌'} check ${name}`)
  return { pass: fails.length === 0, fails: fails.map(([n]) => n), rv, kind }
}

const base = await findBase()
console.log(`\n=== VALIDACIÓN DE FONDO (0 parches) | server=${base} | key=${KEY_MASK} | modelo base = default del servidor (ver diagnostics por caso) ===`)

let passCount = 0, failCount = 0
const results = []
for (const c of CASES) {
  const r = await runCase(base, c)
  results.push({ id: c.id, ...r })
  if (r.pass) passCount++; else failCount++
}

console.log('\n\n=== RESUMEN ===')
for (const r of results) {
  const mark = r.pass ? '✅ PASS' : '❌ FAIL'
  console.log(`   ${mark} [${r.id}] ${r.kind}${r.fails?.length ? ' — falla: ' + r.fails.join(', ') : ''}`)
}
console.log(`\n   TOTAL: ${passCount} pass / ${failCount} fail de ${results.length} escenarios`)
process.exitCode = failCount > 0 ? 1 : 0
