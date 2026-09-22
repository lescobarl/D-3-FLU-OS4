#!/usr/bin/env node
/**
 * audit-metric — métricas de los contratos de saneamiento (SOLO LECTURA).
 *
 * Imprime UN entero en stdout. El task-gate lo parsea con parseMetricValue.
 * Uso: node scripts/audit-metric.mjs <id>
 *
 * Congelado por hash en .task/frozen.json (§B14): el agente que ejecuta la
 * tarea NO puede editar este archivo ni la métrica que produce.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) acc.push(p)
  }
  return acc
}

const rel = (f) => relative(ROOT, f).replace(/\\/g, '/')
const read = (f) => readFileSync(f, 'utf8')
const linesOf = (f) => read(f).split(/\r?\n/)
const stripComment = (line) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return ''
  return line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '')
}

const RE = {
  vozInstancia: /new\s+Recognition\s*\(|new\s+(?:window\.)?(?:webkit)?SpeechRecognition\s*\(/,
  allowlist: /\[\s*'wikipedia\.org'\s*,\s*'educ\.ar'\s*\]/,
  voiceProfilesWriter: /fluDb\.voiceProfiles\.(?:put|add|delete|bulkDelete)\s*\(/,
  aiProviderLiteral: /['"]flu-ai-provider['"]/,
  textApiKeyDirecta: /import\.meta\.env\.VITE_OPENROUTER_API_KEY/,
  wakeRuntime: /ok\s*flu|okay\s*flow/i,
  pollinations: /image\.pollinations\.ai/,
  conversationWriter: /fluDb\.conversations\.(?:put|add|delete|bulkDelete)\s*\(|fluDb\.conversations\.where\s*\(/,
  sessionBackend: /flu-session-state|fluDb\.sessionState/,
  minutesDoubleWrite: /integrationStore\.addMinute\s*\(/,
  textKeyLiteral: /['"]flu-text-model['"]|['"]flu-text-api-key['"]/,
  physicalDelete: /fluDb\.[A-Za-z]+\.(?:delete|bulkDelete|clear)\s*\(|\.where\([^)]*\)\s*\.delete\(/g,
  nonV4Id: /voice-\$\{Date\.now\(\)\}/,
  staleStack: /React 18|Vite 5|Tailwind CSS 3/g,
  notasCompras: /fluDb\.(?:notes|shoppingItems)/,
  timeoutsConfig: /\b[A-Z_]*TIMEOUT(?:_MS)?\s*=/,
  // Mide IMPLEMENTACION de sintesis (no el literal): construccion del utterance,
  // acceso al motor y llamadas al motor. Case-insensitive a proposito: el literal
  // /speechSynthesis/ dejaba invisible `SpeechSynthesisUtterance` y `getSpeechEngine`.
  ttsPoint:
    /new\s+SpeechSynthesisUtterance\s*\(|getSpeechEngine\s*\(|getSpeechSynthesis\s*\(|speechSynthesis\.(?:speak|cancel|getVoices|resume)\s*\(/i,
  modeloDefault: /gemini-2\.5-flash-lite/,
  appNormaliza: /normalizeCommandForDeterministic\s*\(|actionBelongsToTranscript\s*\(/,
  commitSites: /commitUserTurnRow\s*\(/,
  deriveSites: /deriveQueryFromRow\s*\(/,
  stripFns:
    /export function (?:stripWakeWord|stripWakeWordAnywhere|removeWakeWord|splitTranscriptAtWakeWord|stripWakeWordForDisplay)\s*\(/,
  sampleRateLiteral: /\b48000\b/,
  ownIndexedDb: /indexedDB\.open\s*\(/,
  voiceProfilesKey: /STORAGE_KEYS\.VOICE_PROFILES/,
  longtermDelete: /store\.delete\s*\(/,
  consoleDebug: /console\.debug\s*\(/,
  consumerNorm:
    /(?:cleanForSpeech|normalizeTranscriptText|stripWakeWord|stripWakeWordAnywhere|collapseStutter|normalizeCommandForDeterministic)\s*\(/,
  finalizeSites: /finalizeTurnCommit\(\)/,
  umbralLiteral: /0\.[0-9]{2}/,
  // C47: locales BCP-47 de la familia es/en declarados como literal.
  localeLiteral: /['"`](?:es|en)-(?:MX|US|ES|GB)['"`]/,
  // C49: doble cast que evade el tipado (`as unknown as`).
  tsDoubleCast: /as unknown as/,
}
const CONSUMER_NORM_FILES = new Set([
  'src/lib/generationTopic.ts',
  'src/core/agenda/agendaCommandParser.ts',
  'src/voice/lib/noteIntentParser.js',
])
const UMBRAL_FILES = new Set([
  'src/voice/lib/speakerDiarization.js',
  'src/core/autonomy/healthMonitor.ts',
  'src/core/autonomy/decisionEngine.ts',
  'src/core/autonomy/autoOptimization.ts',
  'src/lib/participantProfiles.ts',
])
const FILES_IMPORT_PROXY = [
  'src/services/ocrService.ts',
  'src/core/autonomy/healthMonitor.ts',
  'src/voice/lib/fluVisualStockSearch.js',
]

/** Cuenta bloques catch cuyo cuerpo no registra ni propaga el error. */
function countSilentCatches() {
  let n = 0
  for (const f of FILES) {
    const src = read(f)
    const re = /catch\s*(?:\([^)]*\))?\s*\{/g
    let m
    while ((m = re.exec(src)) !== null) {
      const open = src.indexOf('{', m.index)
      let depth = 0
      let i = open
      for (; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1
        else if (src[i] === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      const body = src.slice(open + 1, i)
      // Un catch esta "manejado" si PROPAGA o REGISTRA. `console.*` NO cuenta:
      // un warn por consola no es registro (AGENTS.md 2.6). Vias validas:
      // throw/reject/emit, setError/onError, el registro central
      // (logCaughtError/relayLog/auditLog/...) o la marca explicita `ignorado:`.
      const handled =
        /\b(throw|relayLog|logCaughtError|systemEventLog|auditLog|logAudit|reportError|reject\s*\(|setError|onError|emit\w*\s*\()|ignorado:/.test(
          body,
        )
      if (!handled) n += 1
    }
  }
  return n
}

const FILES = walk(SRC)
const DEAD_MODULES = [
  'src/lib/conversationFlow.ts',
  'src/lib/emotionalState.ts',
  'src/lib/exportUtils.ts',
  'src/lib/forgettingCurve.ts',
  'src/lib/goalTracker.ts',
  'src/lib/longTermMemory.ts',
  'src/lib/memoryConsolidation.ts',
  'src/lib/minuteSuggester.ts',
  'src/lib/participantProfiles.ts',
  'src/lib/preferenceLearner.ts',
  'src/lib/proactiveEngine.ts',
  'src/lib/theoryOfMind.ts',
  'src/lib/transcriptQuality.ts',
  'src/lib/userEmotionDetector.ts',
  'src/voice/lib/localTranslate.js',
]
const ORPHANS = [
  'plan_solucion_basura.md',
  'CONTEXTO_FLU_OS2.md',
  'ESTADO_SISTEMA.md',
  'mermaid-diagrama1.png',
  'tools/e2e-sims/sim-pollinations-caida-openrouter.spec.ts',
  'tools/live-check.mjs',
]

function countFilesWhere(pred) {
  let n = 0
  for (const f of FILES) if (pred(rel(f), f)) n += 1
  return n
}
function countLinesWhere(pred) {
  let n = 0
  for (const f of FILES) for (const line of linesOf(f)) if (pred(rel(f), line)) n += 1
  return n
}
function countExisting(paths) {
  let n = 0
  for (const p of paths) if (existsSync(join(ROOT, p))) n += 1
  return n
}

const metrics = {
  // ---- C1-C5 -------------------------------------------------------------
  'voz-instancia': () =>
    countFilesWhere(
      (r, f) =>
        r !== 'src/voice/lib/speechRecognitionLocal.js' &&
        linesOf(f).some((l) => RE.vozInstancia.test(l)),
    ),
  'search-allowlist': () =>
    countLinesWhere((r, l) => r !== 'src/voice/lib/fluConfig.js' && RE.allowlist.test(l)),
  'voiceprofiles-escritores': () => countFilesWhere((_r, f) => RE.voiceProfilesWriter.test(read(f))),
  'ai-provider-literal': () =>
    countLinesWhere((r, l) => r !== 'src/core/config/appConfig.ts' && RE.aiProviderLiteral.test(l)),
  'text-api-key-directa': () =>
    countLinesWhere(
      (r, l) =>
        !r.startsWith('src/dev/') &&
        r !== 'src/core/config/appConfig.ts' &&
        r !== 'src/core/config/sharedConfig.ts' &&
        RE.textApiKeyDirecta.test(l),
    ),
  // ---- C6-C24 ------------------------------------------------------------
  'wake-runtime': () =>
    countLinesWhere(
      (r, l) => r !== 'src/voice/lib/fluConfig.js' && RE.wakeRuntime.test(stripComment(l)),
    ),
  'pollinations-fuentes': () =>
    countFilesWhere((r, f) => r !== 'src/components/FluSettingsPanel.tsx' && RE.pollinations.test(read(f))),
  'conversacion-escritores': () => countFilesWhere((_r, f) => RE.conversationWriter.test(read(f))),
  'sesion-backends': () => countFilesWhere((_r, f) => RE.sessionBackend.test(read(f))),
  'minutos-doble-escritura': () =>
    countLinesWhere(
      (r, l) => r === 'src/hooks/useMinuteHandlers.ts' && RE.minutesDoubleWrite.test(stripComment(l)),
    ),
  'text-key-literales': () =>
    countLinesWhere(
      (r, l) => r !== 'src/core/config/appConfig.ts' && RE.textKeyLiteral.test(stripComment(l)),
    ),
  'borrado-fisico': () => {
    let n = 0
    for (const f of FILES) {
      const m = read(f).match(RE.physicalDelete)
      if (m) n += m.length
    }
    return n
  },
  'uuid-no-v4': () => countLinesWhere((_r, l) => RE.nonV4Id.test(l)),
  'modulos-muertos': () => countExisting(DEAD_MODULES),
  'huerfanos': () => countExisting(ORPHANS),
  'stack-doc': () => {
    const p = join(ROOT, 'AGENTS.md')
    if (!existsSync(p)) return -1
    const m = read(p).match(RE.staleStack)
    return m ? m.length : 0
  },
  // ---- C11-C24 -----------------------------------------------------------
  'notas-compras-tablas': () => countFilesWhere((_r, f) => RE.notasCompras.test(read(f))),
  'timeouts-config': () =>
    countLinesWhere(
      (r, l) =>
        r !== 'src/core/config/appConfig.ts' &&
        r !== 'src/core/config/sharedConfig.ts' &&
        RE.timeoutsConfig.test(stripComment(l)),
    ),
  'catch-silencioso': countSilentCatches,
  'fetch-proveedor': () =>
    FILES_IMPORT_PROXY.filter((p) => existsSync(join(ROOT, p)) && /fetch\s*\(/.test(read(join(ROOT, p))))
      .length,
  'tts-punto-unico': () => countFilesWhere((_r, f) => RE.ttsPoint.test(read(f))),
  'modelo-default': () => countFilesWhere((_r, f) => RE.modeloDefault.test(read(f))),
  // ---- C25-C35 -----------------------------------------------------------
  'app-normaliza': () =>
    countLinesWhere((r, l) => r === 'src/App.tsx' && RE.appNormaliza.test(stripComment(l))),
  'commit-sites': () =>
    countLinesWhere(
      (r, l) => RE.commitSites.test(stripComment(l)) && !/export function/.test(l),
    ),
  'derive-sites': () =>
    countLinesWhere((_r, l) => RE.deriveSites.test(stripComment(l)) && !/export function/.test(l)),
  'strip-implementaciones': () => countLinesWhere((_r, l) => RE.stripFns.test(l)),
  'sample-rate-literal': () =>
    countLinesWhere(
      (r, l) => r === 'src/voice/hooks/useFluVoiceAssistant.js' && RE.sampleRateLiteral.test(l),
    ),
  'indexeddb-propias': () =>
    countFilesWhere((r, f) => r !== 'src/core/autonomy/healthMonitor.ts' && RE.ownIndexedDb.test(read(f))),
  'voiceprofiles-localstorage': () =>
    countFilesWhere(
      (r, f) => r !== 'src/core/config/appConfig.ts' && RE.voiceProfilesKey.test(read(f)),
    ),
  'longterm-delete': () =>
    countLinesWhere((r, l) => r === 'src/lib/longTermMemory.ts' && RE.longtermDelete.test(l)),
  'memoryitem-sync': () => {
    const p = join(ROOT, 'src/lib/longTermMemory.ts')
    if (!existsSync(p)) return 0
    const src = read(p)
    const m = src.match(/interface MemoryItem\s*\{[\s\S]*?\n\}/)
    if (!m) return -1
    const block = m[0]
    return /revision/.test(block) && /updatedAt/.test(block) ? 0 : 1
  },
  'fallback-responses': () => (existsSync(join(ROOT, 'src/services/fallbackResponses.ts')) ? 1 : 0),
  'console-debug': () => countLinesWhere((_r, l) => RE.consoleDebug.test(l)),
  // ---- C36-C38 -----------------------------------------------------------
  'consumidores-normalizan': () => {
    let n = 0
    for (const f of FILES) {
      if (!CONSUMER_NORM_FILES.has(rel(f))) continue
      for (const line of linesOf(f)) {
        const s = stripComment(line)
        if (/^\s*import/.test(s)) continue
        if (RE.consumerNorm.test(s)) n += 1
      }
    }
    return n
  },
  'finalize-sites': () =>
    countLinesWhere(
      (r, l) => r === 'src/voice/lib/conversationStreamCommit.js' && RE.finalizeSites.test(stripComment(l)),
    ),
  'umbrales-autonomy': () =>
    countFilesWhere((r, f) => UMBRAL_FILES.has(r) && RE.umbralLiteral.test(read(f))),
  // ---- C47 ---------------------------------------------------------------
  'locale-literales': () =>
    countLinesWhere(
      (r, l) => r !== 'src/core/config/localeConfig.ts' && RE.localeLiteral.test(stripComment(l)),
    ),
  // ---- C49 ---------------------------------------------------------------
  'ts-escapes': () => countLinesWhere((_r, l) => RE.tsDoubleCast.test(stripComment(l))),
  // ---- C39 ---------------------------------------------------------------
  'motor-normaliza': () => {
    const p = join(ROOT, 'src/voice/hooks/useFluVoiceAssistant.js')
    if (!existsSync(p)) return -1
    let n = 0
    for (const line of linesOf(p)) {
      const s = stripComment(line)
      if (/normalizeTranscriptText\s*\(/.test(s)) n += 1
      if (/cleanForSpeech\(\s*wakeAnalysis\.afterWake/.test(s)) n += 1
    }
    return n
  },
}

const id = process.argv[2]
if (!metrics[id]) {
  console.error(`audit-metric: id desconocido "${id}". Válidos: ${Object.keys(metrics).join(', ')}`)
  process.exit(1)
}
process.stdout.write(String(metrics[id]()))
