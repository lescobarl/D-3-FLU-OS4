/**
 * Pausa / cola ASR débil — lee SOLO fluConfig.transcript.pauseAndWeakAsr (sin fallbacks numéricos aquí).
 * Inventario: docs/reglas-duras.md · listConfiguredTranscriptHardRules()
 */
import { cleanForSpeech } from './audioMath.js'
import { requireConfigBlock } from './configGuard.js'
import { voiceProbe } from './voiceProbe'

export const TRANSCRIPT_PAUSE_KEYS = [
  'interimOpenLineFlushMs',
  'srGapCommitMs',
  'srGapCommitExtensionMinChars',
  'srGapCommitNoNewContentMinChars',
  'postCommitCooldownMs',
  'staleFlushMinWords',
  'staleFlushMinWordsDuringCooldown',
  'pauseContinuationMs',
  'pauseContinuationMinMs',
  'pauseBridgeMinSharedWords',
  'tailMinLengthRatio',
  'tailLiveLengthMarginChars',
  'weakAsrRepetitionUniqueRatio',
  'tailOnlyMaxWords',
  'tailOnlyMaxChars',
  'weakAsrStaleMaxWords',
  'weakAsrStaleMaxChars',
  'weakAsrFinalMaxWords',
  'weakAsrFinalMaxChars',
  'shortCommitMaxWords',
  'shortCommitMaxChars',
  'skipDiarizeOnStaleFlush',
  'treatEmptyPhraseAsWeak',
]

export function getTranscriptPauseCfg() {
  return requireConfigBlock(['transcript', 'pauseAndWeakAsr'], 'fluConfig.transcript.pauseAndWeakAsr')
}

export function listConfiguredTranscriptHardRules() {
  const cfg = getTranscriptPauseCfg()
  return TRANSCRIPT_PAUSE_KEYS.filter((key) => key in cfg).map((key) => ({
    key,
    value: cfg[key],
    source: 'fluConfig.transcript.pauseAndWeakAsr',
  }))
}

/**
 * Disparador del cierre de SEGMENTO vivo (`srGap`): dos caminos, la MISMA regla
 * ("el ASR no va a cerrar esta locucion"):
 *   1) el ASR lleva `srGapCommitMs` sin onresult (Chrome mudo / TV), o
 *   2) la LOCUCION VIVA lleva `srGapCommitMs` sin cerrar: Chrome puede emitir
 *      interinos durante minutos y no entregar nunca un final.
 * El caso 2 se midio el 2026-10-07 (debug.log): 76 s de audio continuo con
 * interinos -> UNA fila "mientras"; el texto vivia solo en ULTIMA FRASE y se
 * perdia. Devuelve el valor sintetico de silencio para reutilizar el MISMO
 * cierre (`evaluateSrGapSegmentCommit`), sin una segunda ruta de commit.
 */
/**
 * Sonda `srGap` con FRENO: el disparador se evalua en cada tick del watchdog
 * (~350 ms). Sin freno, un turno que no cierra emite la sonda ~3 veces por
 * segundo durante minutos y ENTIERRA el log (medido 2026-10-08: 421 de 421
 * eventos eran `srGap`, cero `commit`/`row`). Un log que inunda es un defecto
 * (§10.7): se emite una vez por motivo y como maximo cada 5 s.
 */
let lastSrGapProbeAt = 0
let lastSrGapProbeReason = ''
function emitSrGapProbe(reason, data) {
  const now = Date.now()
  if (reason === lastSrGapProbeReason && now - lastSrGapProbeAt < 5000) return
  lastSrGapProbeAt = now
  lastSrGapProbeReason = reason
  voiceProbe('srGap', { reason, ...data })
}

/** DUENO UNICO del tiempo del silencio: srGapCommitMs se lee SOLO aqui. */
export function srGapSilenceReached(sinceLastResultMs = 0) {
  const gapMs = Number(getTranscriptPauseCfg()?.srGapCommitMs) || 0
  return gapMs > 0 && Number(sinceLastResultMs) >= gapMs
}

export function resolveSrGapTrigger({ sinceLastResultMs = 0, sinceLastCommitMs = 0, hasOpenLine = true, openLineAgeMs = 0 } = {}) {
  // El trigger PREGUNTA al dueno del tiempo (srGapSilenceReached); NO re-decide el cierre.
  // DOS caminos, MISMO umbral: (1) SILENCIO (`srGapCommitMs` sin onresult) y (2) SIN
  // CONTENIDO NUEVO: la locucion lleva `srGapCommitMs` SIN CAMBIAR aunque Chrome siga
  // entregando interinos repetidos. Antes solo existia (1): con interinos continuos el reloj
  // de resultado nunca vencia y el turno NO cerraba (congelacion medida 2026-10-12, turn
  // 15->26: 78 s sin fila). El reloj del CONTENIDO (`openLineStartedAtMs`) es DISTINTO del de
  // resultado: se reinicia SOLO cuando el texto crece, asi que interinos repetidos no lo tocan.
  const silence = srGapSilenceReached(sinceLastResultMs)
  const noNewContent = !silence && hasOpenLine && srGapSilenceReached(openLineAgeMs)
  if (!silence && !noNewContent) {
    return { fire: false, sinceLastResultMs: Number(sinceLastResultMs) || 0, reason: 'sr-active' }
  }
  // Sin locucion viva no hay nada que cerrar: no se sondea. En reposo el srGap
  // emitia `sr-live-turn-stale` cada 5 s durante minutos (medido 2026-10-08) con
  // cero `commit`/`row`; un log que inunda es un defecto (§10.7).
  if (!hasOpenLine) {
    return { fire: false, sinceLastResultMs: Number(sinceLastResultMs) || 0, reason: 'sr-no-open-line' }
  }
  // SOLO SILENCIO (spec del dueno, 2026-10-10): "la ultima frase es para ACUMULAR y una
  // vez que se termine, que haya espacio o cambio de hablante, es cuando lo debe vaciar a
  // la conversacion". Se RETIRA la rama 'turno viejo' que entro en P9.55: con el ASR
  // entregando onresult, cerrar por `sinceCommitMs` vaciaba a mitad del dictado (medido en
  // su sesion del 2026-10-10 15:02-15:14: 26 de 26 srGap por 'sr-live-turn-stale', fila
  // nacida en el "10" y reemplazada 3 veces). El sintoma que perseguia P9.55 (texto que no
  // llegaba a fila) tenia su causa en el DESCARTE del rebuild, cerrado en P9.60.
  const reason = silence ? 'sr-silence' : 'sr-no-new-content'
  emitSrGapProbe(reason, { sinceResult: Number(sinceLastResultMs) || 0, sinceCommit: Number(sinceLastCommitMs) || 0, openLineAge: Number(openLineAgeMs) || 0 })
  return {
    fire: true,
    sinceLastResultMs: Number(sinceLastResultMs) || 0,
    reason,
  }}

export function countSpeechWords(text = '') {
  // Recuento de "palabras habladas": el tokenizador tiene dueno unico
  // (audioMath.speechWords, minusculas). Aqui solo se usa el NUMERO, invariante a
  // la normalizacion, y el guard speechWordsSingleOwnerGuard fija la equivalencia
  // countSpeechWords(t) === speechWords(t).length (P8.10).
  return cleanForSpeech(text).split(/\s+/).filter(Boolean).length
}

function isTailByRelation(shorter = '', longer = '', ratio) {
  const short = cleanForSpeech(shorter)
  const long = cleanForSpeech(longer)
  if (!short || !long || short.length >= long.length) return false
  if (long.toLowerCase().endsWith(short.toLowerCase())) return true
  const p = long.toLowerCase()
  const n = short.toLowerCase()
  if (p.startsWith(n) || n.startsWith(p) || p.includes(` ${n}`)) {
    return short.length < long.length * ratio
  }
  return false
}

export function isPhraseShortForSpeakerHeuristics(phrase = '', lastCommitted = '') {
  const text = cleanForSpeech(phrase)
  if (!text) return getTranscriptPauseCfg().treatEmptyPhraseAsWeak !== false
  const cfg = getTranscriptPauseCfg()
  const ratio = Number(cfg.tailMinLengthRatio)
  if (lastCommitted && isTailByRelation(text, lastCommitted, ratio)) return true
  const words = countSpeechWords(text)
  const staleMin = Number(cfg.staleFlushMinWords)
  if (staleMin > 0 && words < staleMin) return true
  const maxW = Number(cfg.shortCommitMaxWords)
  const maxC = Number(cfg.shortCommitMaxChars)
  if (maxW > 0 && countSpeechWords(text) <= maxW) {
    return !(maxC > 0) || text.length < maxC
  }
  if (maxC > 0 && text.length < maxC) return true
  return false
}

export function isWeakAsrSpeakerEvidence({
  phrase = '',
  staleInterimFlush = false,
  lastCommitted = '',
} = {}) {
  const cfg = getTranscriptPauseCfg()
  const text = cleanForSpeech(phrase)
  if (!text) return cfg.treatEmptyPhraseAsWeak !== false

  const prior = cleanForSpeech(lastCommitted)
  const ratio = Number(cfg.tailMinLengthRatio)
  if (prior && isTailByRelation(text, prior, ratio)) return true

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length >= 3) {
    const unique = new Set(words.map((w) => w.toLowerCase()))
    const repetitionRatio = Number(cfg.weakAsrRepetitionUniqueRatio)
    if (unique.size <= Math.ceil(words.length * repetitionRatio)) return true
  }

  const wordsCount = countSpeechWords(text)
  const staleMin = Number(cfg.staleFlushMinWords)
  if (staleInterimFlush && staleMin > 0 && wordsCount > 0 && wordsCount < staleMin) return true
  const maxW = Number(staleInterimFlush ? cfg.weakAsrStaleMaxWords : cfg.weakAsrFinalMaxWords)
  const maxC = Number(staleInterimFlush ? cfg.weakAsrStaleMaxChars : cfg.weakAsrFinalMaxChars)
  if (maxW > 0 && wordsCount <= maxW && (!(maxC > 0) || text.length < maxC)) return true
  if (maxC > 0 && maxW <= 0 && text.length < maxC) return true
  return false
}
