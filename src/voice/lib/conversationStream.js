/**
 * Motor único: mic → turno vivo (openLine) → UI/log. Archivo (session) solo al cerrar turno.
 */
import { cleanForSpeech, sliceWordsLower, speechWords } from './audioMath.js';
import { FLU_CONFIG } from './fluConfig.js'
import {
  collapseRepeatedSpeech,
  mergeSpeechText,
  resolveMicFragmentMerge,
  normalizeMicText,
  hasSpeechAnchor,
  preferNewRowForShortFinal,
  utterancesRelate,
} from './speechMerge.js'
import { shouldForceNewLogRowOnCommit } from './ingressGuards.js'
import { getTranscriptPauseCfg, countSpeechWords as countWordsFromPauseCfg, srGapSilenceReached } from './fluTranscriptPause.js'
import { normalizeForMatch } from '../../lib/textUtils'
import { VOICE_DIARIZATION_DEFAULTS } from '../../core/config/sharedConfig'

/**
 * Palabras mínimas para tratar un fragmento como eco del TTS de FLU.
 * Vive aquí (defaults de voz) porque `fluConfig.js` está en su techo shrink-only.
 */
const ASSISTANT_ECHO_MIN_WORDS = VOICE_DIARIZATION_DEFAULTS.assistantEchoMinWords
const ASSISTANT_ECHO_MIN_COVERAGE = VOICE_DIARIZATION_DEFAULTS.assistantEchoMinCoverage

export {
  collapseRepeatedSpeech,
  mergeSpeechText,
  collapseEchoPhrase,
  mergeMicChunks,
  pickBestMicInterim,
  micPublishedParityOk,
  resolveMicFragmentMerge,
  collapseAsrStutter,
  normalizeMicText,
  hasSpeechAnchor,
  utterancesRelate,
} from './speechMerge.js'

/** Revisión progresiva ASR (com→Comes po→Comes pollo): mismo turno, no concatenar. */
export function utterancesAsrProgress(previous = '', next = '') {
  const prev = cleanForSpeech(previous)
  const nxt = cleanForSpeech(next)
  if (!prev || !nxt) return false
  if (utterancesRelate(prev, nxt) || utterancesSameRevision(prev, nxt)) return true
  if (hasSpeechAnchor(prev, nxt) || hasSpeechAnchor(nxt, prev)) return true
  // Crecimiento de UN SOLO token ("com"→"Comes", "po"→"Comes pollo"): el ASR aun
  // esta formando la PRIMERA palabra, asi que comparar la cabeza basta.
  // NO se aplica a locuciones de VARIAS palabras: dos frases DISTINTAS que solo
  // comparten la primera palabra (p. ej. la propia wake "Okay ...") NO son la misma
  // locucion creciendo. Tratarlas como tal hacia que el commit de un bloque nuevo
  // pidiera `replaceLast` y REEMPLAZARA la fila del bloque anterior -> la
  // transcripcion del bloque previo desaparecia de la conversacion aunque siguiera
  // en ULTIMA FRASE (medido en el log del dueno: 2026-10-07 14:10-14:11, turno 5
  // `RowTrace ... replace=true` entre dos locuciones largas distintas).
  if (speechWords(prev).length > 1) return false
  const pw = prev.toLowerCase()
  const nw = nxt.toLowerCase().split(/\s+/)[0] || ''
  if (pw.length >= 2 && nw.startsWith(pw)) return true
  if (nw.length >= 2 && pw.startsWith(nw)) return true
  return false
}

/**
 * §9 (anti-fragmentación): ¿`capture` es la MISMA emisión creciendo respecto de
 * `lastCommitted`? Si lo es, NO se debe pelar el prefijo ya comprometido (eso
 * produciría residuos como "tas de cafe" a partir de "busca en la web rece" +
 * "busca en la web recetas de cafe").
 *
 * Fuente ÚNICA del criterio: la usan por igual el camino de FINALES y el de
 * INTERIMS de transcriptIngress.js, para que no puedan divergir.
 */
export function isProgressiveExtension(capture = '', lastCommitted = '') {
  const next = cleanForSpeech(capture)
  const prior = cleanForSpeech(lastCommitted)
  if (!next || !prior || next.length <= prior.length) return false
  return (
    next.toLowerCase().startsWith(prior.toLowerCase()) ||
    utterancesAsrProgress(prior, next)
  )
}

/**
 * §9 ÚNICA FUENTE DE VERDAD del texto de un turno en ingress.
 *
 * Decide, en UN SOLO lugar, qué texto corresponde al turno actual frente a la
 * última fila commiteada: conserva la emisión que crece, pela el prefijo ya
 * commiteado cuando corresponde y no inventa residuos. La usan por igual el
 * camino de FINALES y el de INTERIMS; antes cada uno tenía su propia lógica y
 * podían divergir (residuo "tas de cafe" del log).
 *
 * @param {string} raw Texto entrante (final o interim).
 * @param {string} lastCommitted Última fila commiteada.
 * @param {{ atFreshVoice?: boolean }} [options] `atFreshVoice` conserva el texto
 *   cuando no continúa la fila (voz nueva), en vez de pelar.
 */
export function resolveIngressCaptureText(raw = '', lastCommitted = '', { atFreshVoice = false } = {}) {
  const current = cleanForSpeech(raw)
  const prior = cleanForSpeech(lastCommitted)
  if (!current || !prior) return current
  if (isProgressiveExtension(current, prior)) return current
  if (atFreshVoice) return current
  const peeled = cleanForSpeech(peelCommittedPrefixFromInterim(current, prior))
  return peeled || current
}

// speechWords: dueno unico en audioMath.js (V18). Antes habia una copia local
// aqui SIN normalizar a minusculas (P8.10); sus 4 usos solo miran el numero de
// palabras, asi que la copia era divergente sin motivo. Se importa el dueno.

// Dueño canónico: fluTranscriptPause.js. Se re-exporta para no duplicar.
export { countSpeechWords } from './fluTranscriptPause.js'

/** Cola ASR suelta tras pausa: heurística de relación + umbrales en fluConfig. */
export function isTailOnlyInterimCapture(capture = '', turnLive = '', lastCommitted = '') {
  const cap = cleanForSpeech(capture)
  if (!cap) return false
  const cfg = getTranscriptPauseCfg()
  const live = cleanForSpeech(turnLive)
  const margin = Number(cfg.tailLiveLengthMarginChars)
  if (live && live.length > cap.length + margin && !live.toLowerCase().includes(cap.toLowerCase())) {
    return false
  }
  const prior = cleanForSpeech(lastCommitted)
  if (prior) {
    if (prior.toLowerCase().endsWith(cap.toLowerCase())) return true
    const ratio = Number(cfg.tailMinLengthRatio)
    if (utterancesRelate(prior, cap) && cap.length < prior.length * ratio) return true
  }
  const maxWords = Number(cfg.tailOnlyMaxWords)
  if (maxWords > 0 && countWordsFromPauseCfg(cap) <= maxWords) {
    const maxChars = Number(cfg.tailOnlyMaxChars)
    if (!(maxChars > 0) || cap.length < maxChars) return true
  }
  const maxCharsOnly = Number(cfg.tailOnlyMaxChars)
  if (maxCharsOnly > 0 && maxWords <= 0 && cap.length < maxCharsOnly) return true
  return false
}

/**
 * Tras commit reciente: interino acumulativo de Chrome que re-incluye la fila cerrada
 * → conservar solo la continuación (ej. «le salto la pelota bastante»).
 */
export function bridgeInterimAfterCommitPause(interim = '', lastCommitted = '', msSinceCommit = 0) {
  const chunk = cleanForSpeech(interim)
  const prior = cleanForSpeech(lastCommitted)
  if (!chunk || !prior) return chunk

  const cfg = getTranscriptPauseCfg()
  const maxMs = Number(cfg.pauseContinuationMs)
  const minMs = Number(cfg.pauseContinuationMinMs)
  if (msSinceCommit < minMs || msSinceCommit > maxMs) return chunk

  const lowChunk = chunk.toLowerCase()
  const lowPrior = prior.toLowerCase()
  if (lowChunk.startsWith(lowPrior)) {
    return normalizeMicText(chunk.slice(prior.length))
  }
  if (utterancesRelate(prior, chunk)) {
    if (chunk.length <= prior.length) return chunk
    return normalizeMicText(mergeSpeechText(prior, chunk, { keepAll: true }))
  }

  const shared = countSharedSpeechWords(prior, chunk)
  const minShared = Number(cfg.pauseBridgeMinSharedWords)
  if (shared >= minShared && chunk.length > prior.length) {
    return normalizeMicText(chunk)
  }

  return chunk
}

/** Palabras iniciales compartidas (tolera typo ASR: táctil/táctico). */
export function countSharedSpeechWords(a = '', b = '') {
  const aw = speechWords(a)
  const bw = speechWords(b)
  let shared = 0
  while (shared < aw.length && shared < bw.length) {
    const left = aw[shared].toLowerCase()
    const right = bw[shared].toLowerCase()
    if (left === right) {
      shared += 1
      continue
    }
    if (
      left.length >= 4 &&
      right.length >= 4 &&
      (left.slice(0, 4) === right.slice(0, 4) || left.startsWith(right) || right.startsWith(left))
    ) {
      shared += 1
      continue
    }
    break
  }
  return shared
}

/**
 * Revisión ASR del mismo enunciado (no turno nuevo): prefijo largo compartido
 * aunque utterancesRelate falle por corrección táctil→táctico, etc.
 */
export function utterancesSameRevision(previous = '', next = '') {
  const prev = cleanForSpeech(previous)
  const nxt = cleanForSpeech(next)
  if (!prev || !nxt) return false
  if (utterancesRelate(prev, nxt)) return true

  const minLen = Math.min(speechWords(prev).length, speechWords(nxt).length)
  if (minLen < 3) return false

  const shared = countSharedSpeechWords(prev, nxt)
  if (shared >= 4) return true
  if (shared >= 3 && shared >= Math.floor(minLen * 0.55)) return true

  let chars = 0
  const max = Math.min(prev.length, nxt.length)
  while (chars < max && prev[chars].toLowerCase() === nxt[chars].toLowerCase()) {
    chars += 1
  }
  return chars >= 24
}

export function readOpenLine(state) {
  return state?.openLine || ''
}

export function clearInterimOpenLineClock(state) {
  if (!state) return
  state.openLineStartedAtMs = 0
  state.openLineLastTouchMs = 0
  state.openLineClockText = ''
}

/** Marca actividad en openLine (TV/stream sin final prolongado). */
export function markInterimOpenLineActivity(state, { text = '', nowMs = Date.now() } = {}) {
  const line = cleanForSpeech(text || readOpenLine(state))
  if (!line) {
    clearInterimOpenLineClock(state)
    return
  }
  const prev = cleanForSpeech(state.openLineClockText || '')
  if (prev !== line) {
    state.openLineStartedAtMs = nowMs
    state.openLineClockText = line
  }
  state.openLineLastTouchMs = nowMs
}

/** Recupera texto cuando strip vacía un interino acumulativo de Chrome pero el raw trae continuación. */
export function recoverInterimAfterStrip(rawInterim = '', priorTexts = []) {
  const raw = cleanForSpeech(rawInterim)
  if (!raw) return ''
  const priors = priorTexts.map((t) => cleanForSpeech(t)).filter(Boolean)
  if (!priors.length) return raw
  const last = priors[priors.length - 1]
  if (!last) return raw

  const lowRaw = raw.toLowerCase()
  const lowLast = last.toLowerCase()
  if (lowRaw.startsWith(lowLast)) {
    const tail = cleanForSpeech(raw.slice(last.length))
    return tail || raw
  }

  for (let len = Math.min(last.length, raw.length); len >= 16; len -= 1) {
    const suffix = lowLast.slice(-len)
    const idx = lowRaw.indexOf(suffix)
    if (idx >= 0) {
      const tail = cleanForSpeech(raw.slice(idx + len))
      if (tail.length >= 6) return tail
    }
  }
  return raw
}

/**
 * Interino idéntico al último commit (Chrome repite tras isFinal).
 * NO duplica `audioMath.spokenUtteranceRevision` (comparador de revisión):
 * aquí la política es "eco de commit"; allí, el avance de la emisión hablada.
 */
export function isCommittedInterimEcho(interim = '', lastCommitted = '') {
  const chunk = cleanForSpeech(interim)
  const prior = cleanForSpeech(lastCommitted)
  if (!chunk || !prior) return false
  if (chunk === prior) return true

  if (chunk.toLowerCase().startsWith(prior.toLowerCase())) {
    const tail = cleanForSpeech(chunk.slice(prior.length))
    if (!tail || tail.length < 6) return true
    if (countWordsFromPauseCfg(tail) < 2 && tail.length < 12) return true
    return false
  }

  if (
    utterancesSameRevision(prior, chunk) &&
    chunk.length <= prior.length + 12
  ) {
    const cLow = chunk.toLowerCase()
    const pLow = prior.toLowerCase()
    return cLow.startsWith(pLow) || pLow.startsWith(cLow)
  }
  return false
}

/**
 * ¿Este texto es la propia voz de FLU re-capturada por el micrófono?
 *
 * El detector de eco clásico compara contra filas de USUARIO, así que no puede
 * ver lo que FLU acaba de decir: su TTS re-capturado entraba como turno de una
 * persona y se mezclaba con el hablante real («FLU y yo como Hablante 1»). Aquí
 * la referencia es el texto hablado por FLU.
 *
 * La comparación es por PALABRAS (no por substring) porque el ASR no reproduce
 * la puntuación del TTS: «…lotería! Prepárense…» y «…lotería prepárense…» deben
 * coincidir. El mínimo de palabras evita descartar respuestas cortas legítimas.
 */
/**
 * El fragmento EMPIEZA por la COLA de lo que FLU acaba de decir?
 *
 * El ASR captura el final del TTS (el micro se abre mientras FLU termina) y
 * despues, muchas veces, el turno real: "o prefieres que te cuente algo mas
 * esta | Okay flu estabamos jugando..." (medido 18:12:34). Por eso la cola que
 * cuenta es la que ABRE el fragmento. Exige mas palabras que el minimo suelto:
 * repetir las 3 ultimas palabras de FLU no es eco, es conversacion.
 */
function empiezaPorLaCola(needle, hay) {
  const minimo = ASSISTANT_ECHO_MIN_WORDS + 1
  const max = Math.min(needle.length, hay.length)
  for (let k = max; k >= minimo; k -= 1) {
    let igual = true
    for (let j = 0; j < k; j += 1) {
      if (needle[j] !== hay[hay.length - k + j]) { igual = false; break }
    }
    if (igual) return true
  }
  return false
}
export function isAssistantVoiceEcho(candidate = '', assistantText = '') {
  const chunk = normalizeForMatch(candidate)
  const spoken = normalizeForMatch(assistantText)
  if (!chunk || !spoken) return false
  if (chunk === spoken) return true
  if (isCommittedInterimEcho(chunk, spoken)) return true

  const needle = chunk.split(/[^a-z0-9]+/).filter(Boolean)
  if (needle.length < ASSISTANT_ECHO_MIN_WORDS) return false
  const hay = spoken.split(/[^a-z0-9]+/).filter(Boolean)
  // COLA: el ASR suele captar el FINAL de lo que FLU acaba de decir (el micro se
  // abre mientras el TTS termina). Un sufijo suficiente de las ultimas palabras
  // habladas ES eco, aunque no cubra la frase entera: sin esto, la cola de una
  // respuesta larga (8 de 20 palabras = 0.4 < 0.5 de cobertura) se colaba como
  // turno de persona y el LLM respondia a las palabras de FLU (medido 18:12:34).
  if (empiezaPorLaCola(needle, hay)) return true
  // El fragmento debe CUBRIR buena parte de lo que dijo FLU. Sin esto, una
  // corrida corta de palabras dentro de una respuesta larga bastaba para
  // descartar la frase del usuario: este modulo nunca borra contenido, los
  // detectores son diagnosticos (ver transcriptionDedupLoss).
  if (needle.length / hay.length < ASSISTANT_ECHO_MIN_COVERAGE) return false
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let matched = true
    for (let k = 0; k < needle.length; k += 1) {
      if (hay[i + k] !== needle[k]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

/**
 * ¿Este evento ASR es eco del TTS de FLU? Filtro por CONTENIDO, no por tiempo.
 *
 * DEFECTO MEDIDO (2026-10-07, escenario inyectado sobre la app real): el
 * `onresult` descartaba TODO mientras FLU hablaba (`if (isFluSpeaking()) return`),
 * asi que una locucion real dicha durante la respuesta se perdia SIN fila y SIN
 * rastro (dos frases del guion cayeron: "soy Luis" y un bloque entero). Se
 * conserva el filtro, pero por contenido: solo se descarta lo que es eco del texto
 * que FLU acaba de decir.
 */
/**
 * @param {{ resultIndex?: number, results?: Array<Record<number, { transcript?: string }>> }|null} [event]
 * @param {string} [assistantText]
 * @returns {boolean}
 */
export function isAssistantSpeechEcho(event = null, assistantText = '') {
  const heard = cleanForSpeech(
    event?.results?.[Number(event?.resultIndex) || 0]?.[0]?.transcript || '',
  )
  return Boolean(heard) && isAssistantVoiceEcho(heard, assistantText)
}

/** Separa texto nuevo cuando Chrome prependea el turno ya cerrado. */
export function peelCommittedPrefixFromInterim(interim = '', lastCommitted = '') {
  const chunk = cleanForSpeech(interim)
  const prior = cleanForSpeech(lastCommitted)
  if (!chunk || !prior) return chunk
  if (isCommittedInterimEcho(chunk, prior)) return ''
  if (chunk.toLowerCase().startsWith(prior.toLowerCase())) {
    const tail = cleanForSpeech(chunk.slice(prior.length))
    return tail || chunk
  }
  return chunk
}

function clearStaleCommittedEchoFromState(state, lastCommitted = '') {
  const prior = cleanForSpeech(lastCommitted)
  if (!prior || !state) return
  const pending = cleanForSpeech(readPending(state))
  const openLine = cleanForSpeech(readOpenLine(state))
  if (pending && isCommittedInterimEcho(pending, prior)) {
    state.pendingInterim = ''
  }
  if (openLine && isCommittedInterimEcho(openLine, prior)) {
    state.openLine = ''
    clearInterimOpenLineClock(state)
  }
}

export { clearStaleCommittedEchoFromState }

/** Commit de segmento cuando Chrome deja de emitir onresult pero openLine tiene texto nuevo. */
export function evaluateSrGapSegmentCommit(
  state,
  {
    nowMs = Date.now(),
    sinceLastResultMs = 0,
    lastCommitted = '',
    lastCommitAtMs = 0,
  } = {},
) {
  const cfg = getTranscriptPauseCfg()
  // MISMA condicion que el TRIGGER (`resolveSrGapTrigger`): SOLO SILENCIO. En P9.55 esta
  // rama acepto tambien 'turno viejo' (`sinceCommitMs >= gapMs`) para volcar el texto que
  // se quedaba en «ultima frase»; se RETIRA porque con el ASR entregando onresult vaciaba
  // la conversacion A MITAD del dictado (medido en la sesion del dueno 2026-10-10
  // 15:02-15:14: 26 de 26 srGap por 'sr-live-turn-stale' y la fila nacida en el "10",
  // luego reemplazada). El texto NO se pierde: sigue acumulado en la linea viva y lo
  // escribe el cierre REAL (silencio / onend / cambio de hablante).
  // Mismo dueno del tiempo que el trigger (srGapCommitMs): un solo lector.
  const contentAgeMs = nowMs - (state?.openLineStartedAtMs || nowMs)
  const sinContenidoNuevo = srGapSilenceReached(contentAgeMs)
  if (!srGapSilenceReached(sinceLastResultMs) && !sinContenidoNuevo) {
    return { flush: false, capture: '', reason: 'sr-active' }
  }

  const capture = cleanForSpeech(readTurnLive(state) || state?.pendingFinal)
  if (!capture) return { flush: false, capture: '', reason: 'empty-openline' }


  const prior = cleanForSpeech(lastCommitted)
  if (prior && capture === prior) {
    return { flush: false, capture, reason: 'already-committed' }
  }
  const extensionChars = prior ? Math.max(0, capture.length - prior.length) : capture.length
  const extensionWords = prior
    ? countWordsFromPauseCfg(capture.slice(Math.min(prior.length, capture.length)))
    : countWordsFromPauseCfg(capture)
  // Cierre por SIN CONTENIDO NUEVO (congelacion, medido 2026-10-12): la linea VIVA dejo de
  // crecer aunque el ASR siga entregando interinos repetidos -> se CIERRA, volcando la ultima
  // frase que aun no esta en la conversacion. Se adelanta al porton de contenido: si no, el
  // turno quedaba abierto indefinidamente con interinos (78 s sin fila).
  if (sinContenidoNuevo) {
    const cooldownContent = Number(cfg.postCommitCooldownMs)
    if (cooldownContent > 0 && lastCommitAtMs > 0 && nowMs - lastCommitAtMs < cooldownContent) {
      return { flush: false, capture, reason: 'post-commit-cooldown' }
    }
    return { flush: true, capture, reason: 'sr-gap-segment-commit', sinceLastResultMs, openLineAgeMs: contentAgeMs }
  }
  if (
    prior &&
    utterancesSameRevision(prior, capture) &&
    extensionChars < Number(cfg.srGapCommitExtensionMinChars) &&
    extensionWords === 0
  ) {
    return { flush: false, capture, reason: 'already-committed' }
  }
  if (
    prior &&
    utterancesRelate(prior, capture) &&
    extensionChars < Number(cfg.srGapCommitNoNewContentMinChars)
  ) {
    return { flush: false, capture, reason: 'no-new-content' }
  }

  const cooldown = Number(cfg.postCommitCooldownMs)
  if (cooldown > 0 && lastCommitAtMs > 0 && nowMs - lastCommitAtMs < cooldown) {
    return { flush: false, capture, reason: 'post-commit-cooldown' }
  }

  return {
    flush: true,
    capture,
    reason: 'sr-gap-segment-commit',
    sinceLastResultMs,
    openLineAgeMs: nowMs - (state?.openLineLastTouchMs || state?.openLineStartedAtMs || nowMs),
  }
}

export function readPending(state) {
  return state?.pendingInterim || ''
}

export function readSession(state) {
  return state?.transcript || ''
}

/** Texto del turno en curso (openLine + pending). Nunca usa session. */
export function readTurnLive(state) {
  const line = readOpenLine(state)
  const pending = readPending(state)
  if (!pending) return normalizeMicText(line)
  if (!line) return normalizeMicText(pending)
  if (pending.startsWith(line)) return normalizeMicText(pending)
  if (line.startsWith(pending)) return normalizeMicText(line)
  if (!utterancesRelate(line, pending)) return normalizeMicText(pending)
  if (line.length > pending.length) return normalizeMicText(line)
  return normalizeMicText(mergeSpeechText(line, pending, { keepAll: true }))
}

export const readStreamDisplay = readTurnLive

/**
 * Quita prefijos de filas ya cerradas en interinos acumulativos de Chrome
 * (todas las filas). Fuente ÚNICA del recorte: delega en
 * `stripRecentClosedTurnsFromInterim` con el total de turnos, para no
 * reimplementar el bucle.
 */
export function stripPriorTurnsFromInterim(interim = '', priorTexts = []) {
  const total = Array.isArray(priorTexts) ? priorTexts.length : 0
  return stripRecentClosedTurnsFromInterim(interim, priorTexts, total)
}

/** Solo los últimos N turnos cerrados (no toda la sesión); evita vaciar interinos largos. */
export function stripRecentClosedTurnsFromInterim(interim = '', priorTexts = [], maxPriors = 6) {
  let chunk = cleanForSpeech(interim)
  if (!chunk || !priorTexts?.length) return chunk
  const cap = Number.isFinite(maxPriors) && maxPriors > 0 ? maxPriors : 6
  const priors = priorTexts
    .map((t) => cleanForSpeech(t))
    .filter(Boolean)
    .slice(-cap)
    .sort((a, b) => b.length - a.length)
  if (!priors.length) return chunk

  let prev = ''
  let passes = 0
  while (chunk !== prev && passes < 12) {
    prev = chunk
    passes += 1
    for (const prior of priors) {
      if (!prior) continue
      if (chunk.toLowerCase().startsWith(prior.toLowerCase())) {
        chunk = cleanForSpeech(chunk.slice(prior.length))
        break
      }
    }
  }
  return chunk
}

/** Solo el último turno cerrado (eco Chrome); no barrer toda la sesión (TV). */
export function stripLastClosedTurnFromInterim(interim = '', priorTexts = []) {
  return stripRecentClosedTurnsFromInterim(interim, priorTexts, 1)
}

export function applyInterimPriorStrip(interim = '', priorTexts = [], config = FLU_CONFIG) {
  const transcript = config.transcript || {}
  if (transcript.stripPriorTurnsOnInterim === false) return cleanForSpeech(interim)
  const priors = priorTexts.filter(Boolean)
  let mode = transcript.stripPriorTurnsMode || 'all'
  const escalateAfter = Number(transcript.stripPriorTurnsEscalateAfterRows)
  if (
    mode === 'last-only' &&
    Number.isFinite(escalateAfter) &&
    escalateAfter > 0 &&
    priors.length > escalateAfter
  ) {
    mode = 'all'
  }
  if (mode === 'off') return cleanForSpeech(interim)
  if (mode === 'last-only') {
    const recentMax = Number(transcript.stripPriorTurnsRecentMax)
    return stripRecentClosedTurnsFromInterim(interim, priorTexts, recentMax)
  }
  return stripPriorTurnsFromInterim(interim, priorTexts)
}

export function readPublishedText(state) {
  const pending = readPending(state)
  const line = readOpenLine(state)
  if (!pending && line) return normalizeMicText(line)
  return readTurnLive(state)
}

function integrateOpenLine(state, chunk) {
  if (!chunk) return
  const line = readOpenLine(state)
  const resolved = resolveMicFragmentMerge(line, chunk)
  state.openLine = normalizeMicText(resolved)
}

/** Filas recientes para stripPriorTurnsFromInterim (incluye fila viva aún no cerrada). */
export function buildPriorRowsForStrip(committedRows = [], liveEmitted = '', { maxRows = 64 } = {}) {
  const rows = committedRows.map((t) => cleanForSpeech(t)).filter(Boolean)
  const live = cleanForSpeech(liveEmitted)
  if (live) {
    const last = rows[rows.length - 1]
    if (!last || last !== live) rows.push(live)
  }
  const cap = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 0
  return cap > 0 && rows.length > cap ? rows.slice(-cap) : rows
}

export function trimCommittedRowsRef(rowsRef, maxRows = 64) {
  if (!Array.isArray(rowsRef)) return
  const cap = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 0
  if (!cap || rowsRef.length <= cap) return
  rowsRef.splice(0, rowsRef.length - cap)
}

function trimSessionArchive(state, maxChars = 0) {
  if (!maxChars || maxChars <= 0) return
  const text = readSession(state)
  if (!text || text.length <= maxChars) return
  state.transcript = text.slice(-maxChars)
}

/** Archivo de sesión: solo al cerrar turno (no en interinos). */
export function archiveCommittedTurn(state, turnText = '', { maxChars = 0 } = {}) {
  const chunk = cleanForSpeech(turnText)
  if (!chunk) return
  const arch = readSession(state)
  if (!arch) {
    state.transcript = chunk
    trimSessionArchive(state, maxChars)
    return
  }
  if (arch === chunk || arch.endsWith(` ${chunk}`) || arch.endsWith(chunk)) return
  if (chunk.startsWith(arch)) {
    state.transcript = collapseRepeatedSpeech(chunk)
    trimSessionArchive(state, maxChars)
    return
  }
  state.transcript = collapseRepeatedSpeech(mergeSpeechText(arch, chunk))
  trimSessionArchive(state, maxChars)
}

export function integrateMicPacket(state, { interim = '', final = '' } = {}) {
  const interimChunk = interim ? cleanForSpeech(interim) : ''
  const finalChunk = final ? cleanForSpeech(final) : ''

  if (interimChunk && !finalChunk) {
    state.pendingInterim = interimChunk
    integrateOpenLine(state, interimChunk)
  }

  if (finalChunk) {
    const resolved = resolveCommitCapture({
      final: finalChunk,
      interim: interimChunk,
      state,
    })
    state.pendingInterim = ''
    state.openLine = resolved
  }

  return {
    display: readTurnLive(state),
    session: readSession(state),
  }
}

/**
 * Texto al cerrar turno: conserva preview/interino más completo que el final ASR.
 * Chrome suele emitir final truncado («minutos») tras interinos largos en el mismo onresult.
 * Solo fusiona preview/interino cuando pertenecen al mismo enunciado (no concatena basura TV).
 */
function previewRelatesToFinal(preview = '', fin = '') {
  const pub = cleanForSpeech(preview)
  const f = cleanForSpeech(fin)
  if (!pub || !f) return false
  if (pub.startsWith(f) || f.startsWith(pub) || pub.endsWith(f) || pub.includes(` ${f}`)) return true
  return utterancesRelate(pub, f) || utterancesAsrProgress(pub, f)
}

const NEW_UTTERANCE_BRIDGE_RE =
  /^(el momento|en el momento|y |pero |aunque |cuando |porque |entonces |ahora )/i

/**
 * Separa final ASR vs cola de preview que pertenece al siguiente turno/hablante.
 */
export function splitFinalAndBridgeTail(finalText = '', previewText = '') {
  const fin = cleanForSpeech(finalText)
  const preview = cleanForSpeech(previewText)
  if (!fin) return { commit: preview || '', bridge: '' }
  if (!preview || preview.length <= fin.length + 2) {
    return { commit: fin, bridge: '' }
  }

  if (preview.toLowerCase().startsWith(fin.toLowerCase())) {
    const tail = cleanForSpeech(preview.slice(fin.length))
    if (!tail) return { commit: fin, bridge: '' }
    if (utterancesSameRevision(fin, preview) && !NEW_UTTERANCE_BRIDGE_RE.test(tail)) {
      return { commit: preview, bridge: '' }
    }
    if (NEW_UTTERANCE_BRIDGE_RE.test(tail) || countWordsFromPauseCfg(tail) >= 4) {
      return { commit: fin, bridge: tail }
    }
    return { commit: preview, bridge: '' }
  }

  if (previewRelatesToFinal(preview, fin)) {
    return { commit: preview.length >= fin.length ? preview : fin, bridge: '' }
  }
  return { commit: fin, bridge: '' }
}

export function mergePreviewIntoFinalCapture(finalText = '', previewText = '') {
  const finClean = cleanForSpeech(finalText)
  const { commit, bridge } = splitFinalAndBridgeTail(finalText, previewText)
  let commitText = normalizeMicText(commit)
  if (
    finClean &&
    finClean.length > commitText.length &&
    (finClean.startsWith(commitText) || utterancesSameRevision(commitText, finClean))
  ) {
    commitText = finClean
  }
  return { commit: commitText, bridge: normalizeMicText(bridge) }
}

export function mergeTurnBridgeWithInterim(bridge = '', interim = '') {
  const b = cleanForSpeech(bridge)
  const i = cleanForSpeech(interim)
  if (!b) return i
  if (!i) return b
  const bLower = b.toLowerCase()
  const iLower = i.toLowerCase()
  if (iLower.startsWith(bLower)) return i
  if (bLower.startsWith(iLower)) return b

  const wordsB = bLower.split(/\s+/).filter(Boolean)
  const wordsI = iLower.split(/\s+/).filter(Boolean)
  const maxOverlap = Math.min(wordsB.length, wordsI.length)
  for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
    const suffix = wordsB.slice(-overlap).join(' ')
    if (iLower.startsWith(suffix)) {
      const rest = i.slice(iLower.indexOf(suffix) + suffix.length).trim()
      return normalizeMicText(rest ? `${b} ${rest}` : b)
    }
  }
  return normalizeMicText(`${b} ${i}`)
}

function trimPartialAsrTailFromLive(live = '', finalText = '') {
  const liveWords = live.split(/\s+/).filter(Boolean)
  const finLower = cleanForSpeech(finalText).toLowerCase()
  const finFirst = finLower.split(/\s+/).filter(Boolean)[0] || ''
  while (liveWords.length > 1) {
    const tail = liveWords[liveWords.length - 1].toLowerCase()
    if (!tail || tail.length < 3) break
    if (finLower.includes(` ${tail}`) || finLower.endsWith(tail)) break
    if (finFirst && (finFirst.startsWith(tail) || tail.startsWith(finFirst.slice(0, Math.min(4, finFirst.length))))) {
      liveWords.pop()
      continue
    }
    break
  }
  return liveWords.join(' ')
}

/** Fusiona preview en vivo con final ASR sin arrastrar sílabas parciales (ej. «porcenta»). */
export function mergeLivePreviewIntoFinalCommit(livePreview = '', finalText = '') {
  const live = cleanForSpeech(trimPartialAsrTailFromLive(livePreview, finalText))
  const fin = cleanForSpeech(finalText)
  if (!live || !fin) return fin || live || ''
  const liveLower = live.toLowerCase()
  const finLower = fin.toLowerCase()
  if (liveLower.startsWith(finLower)) return live
  if (finLower.startsWith(liveLower)) return fin

  const liveWords = live.split(/\s+/).filter(Boolean)
  const finWords = fin.split(/\s+/).filter(Boolean)
  const maxOverlap = Math.min(liveWords.length, finWords.length)
  for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
    const suffix = sliceWordsLower(liveWords, -overlap)
    const prefix = sliceWordsLower(finWords, 0, overlap)
    if (suffix === prefix) {
      const head = liveWords.slice(0, liveWords.length - overlap).join(' ')
      return normalizeMicText(head ? `${head} ${fin}` : fin)
    }
  }
  return mergeTurnBridgeWithInterim(live, fin)
}

export function shouldMergeLivePreviewIntoFinal({
  livePreview = '',
  finalText = '',
  lastCommitted = '',
} = {}) {
  const live = cleanForSpeech(livePreview)
  const fin = cleanForSpeech(finalText)
  const prior = cleanForSpeech(lastCommitted)
  if (!live || !fin) return false
  if (live === fin) return false
  if (prior) {
    const liveLower = live.toLowerCase()
    const priorLower = prior.toLowerCase()
    if (liveLower.startsWith(priorLower) || priorLower.startsWith(liveLower)) return false
    if (utterancesRelate(prior, live) && live.length > prior.length + 20) return false
  }

  const liveTrimmed = cleanForSpeech(trimPartialAsrTailFromLive(live, fin))
  const liveWords = liveTrimmed.split(/\s+/).filter(Boolean)
  const finWords = fin.split(/\s+/).filter(Boolean)
  const maxOverlap = Math.min(liveWords.length, finWords.length)
  let wordOverlap = 0
  for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
    const suffix = sliceWordsLower(liveWords, -overlap)
    const prefix = sliceWordsLower(finWords, 0, overlap)
    if (suffix === prefix) {
      wordOverlap = overlap
      break
    }
  }
  const related =
    wordOverlap > 0 ||
    fin.toLowerCase().startsWith(liveTrimmed.toLowerCase()) ||
    liveTrimmed.toLowerCase().startsWith(fin.toLowerCase()) ||
    utterancesRelate(liveTrimmed, fin)
  if (!related) return false

  const merged = mergeLivePreviewIntoFinalCommit(live, fin)
  if (merged.length <= fin.length + 8) return false
  if (prior && merged.toLowerCase().startsWith(prior.toLowerCase()) && fin.length < prior.length) {
    return false
  }
  return true
}

function mergeSameEventFragments(inter = '', fin = '') {
  const interText = cleanForSpeech(inter)
  const finText = cleanForSpeech(fin)
  if (!interText) return finText
  if (!finText) return interText
  if (previewRelatesToFinal(interText, finText)) {
    return interText.length >= finText.length ? interText : finText
  }
  if (interText.toLowerCase().startsWith(finText.toLowerCase())) {
    return interText
  }
  const merged = normalizeMicText(resolveMicFragmentMerge(interText, finText))
  if (
    merged.length > finText.length + 2 &&
    merged.toLowerCase().includes(finText.toLowerCase()) &&
    interText.toLowerCase().includes(finText.toLowerCase())
  ) {
    return merged
  }
  return finText
}

export function resolveCommitCapture({
  final = '',
  interim = '',
  state = null,
  published = '',
} = {}) {
  const fin = cleanForSpeech(final)
  const inter = cleanForSpeech(interim)
  const pub = cleanForSpeech(published)
  const pending = state ? readPending(state) : ''
  const line = state ? readOpenLine(state) : ''
  const live = state ? readTurnLive(state) : ''

  let best = fin || inter || pub || pending || line || live || ''
  if (inter && fin) {
    best = mergeSameEventFragments(inter, fin)
  }

  for (const preview of [pub, live, pending, line].filter(Boolean)) {
    if (!previewRelatesToFinal(preview, fin || best)) continue
    if (preview.length > best.length) best = preview
  }

  const finClean = cleanForSpeech(fin)
  let resolved = normalizeMicText(best)
  if (
    finClean &&
    finClean.length > resolved.length &&
    (finClean.startsWith(resolved) || utterancesSameRevision(resolved, finClean))
  ) {
    resolved = finClean
  }
  return resolved
}

export function advancePublishedDisplay(published = '', state, { reset = false, freshTurn = false } = {}) {
  const candidate = readPublishedText(state)
  if (!candidate) return reset || freshTurn ? '' : published
  if (reset || freshTurn) return candidate
  if (!readPending(state)) return candidate

  const prev = cleanForSpeech(published)
  if (!prev) return candidate
  if (candidate.startsWith(prev)) return candidate
  if (prev.startsWith(candidate)) return prev
  if (!utterancesRelate(prev, candidate)) {
    if (utterancesSameRevision(prev, candidate)) return candidate
    return prev.length > candidate.length ? prev : candidate
  }
  return candidate.length >= prev.length ? candidate : prev
}

export function shouldRefreshStream(previous = '', next = '') {
  if (!next) return false
  if (!previous) return true
  if (previous === next) return false
  return previous.toLowerCase() !== next.toLowerCase()
}

export function resolveLogParagraphBreak(published = '', finalChunk = '', paragraphByPause = false) {
  if (paragraphByPause) return true
  const pub = cleanForSpeech(published)
  const fin = cleanForSpeech(finalChunk)
  if (!pub || !fin) return false
  return !utterancesRelate(pub, fin) && !utterancesSameRevision(pub, fin) && !utterancesAsrProgress(pub, fin)
}

/** Nueva fila no debe empezar con el texto completo de la fila anterior. */
export function rowDuplicatesPrior(prior = '', next = '') {
  const p = cleanForSpeech(prior)
  const n = cleanForSpeech(next)
  if (!p || !n || p === n) return false
  return n.startsWith(p)
}

export function validateLogRowsNoPrefixDup(rows = []) {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = cleanForSpeech(rows[i - 1])
    const cur = cleanForSpeech(rows[i])
    if (prev && cur && rowDuplicatesPrior(prev, cur)) return false
  }
  return true
}

/** Filas adyacentes no deben ser revisiones ASR del mismo enunciado. */
export function validateLogRowsNoAsrRevisionDup(rows = []) {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = cleanForSpeech(rows[i - 1])
    const cur = cleanForSpeech(rows[i])
    if (prev && cur && utterancesSameRevision(prev, cur)) return false
  }
  return true
}

export function assessStreamParity(micInterim = '', published = '', _session = '') {
  const mic = micInterim ? cleanForSpeech(micInterim) : ''
  if (!mic) return { ok: true }

  const pub = published || ''
  return {
    ok: !pub || mic.startsWith(pub) || pub.startsWith(mic) || pub.length <= mic.length + 8,
    displayOk: !pub || mic.startsWith(pub) || pub.startsWith(mic) || pub.length <= mic.length + 8,
    sessionOk: true,
  }
}

export function processListenPacket(
  state,
  published = '',
  {
    interim = '',
    final = '',
    reset = false,
    turnBoundary = false,
    priorRows = [],
    msSinceLastCommit = 0,
  } = {},
) {
  const buildListenPacketResult = ({
    unchanged = false,
    display = readTurnLive(state),
    session = readSession(state),
    published: nextPublished = published || '',
    changed = !unchanged,
    deltaChars = 0,
    micLen = 0,
    freshUtterance = false,
  } = {}) => ({
    unchanged,
    display,
    session,
    published: nextPublished,
    changed,
    deltaChars,
    micLen,
    freshUtterance,
  })

  let interimChunk = interim ? cleanForSpeech(interim) : ''
  const finalChunk = final ? cleanForSpeech(final) : ''
  const prevPublished = published || ''

  if (interimChunk && !finalChunk) {
    const rawBeforeStrip = interimChunk
    if (priorRows.length) {
      interimChunk = applyInterimPriorStrip(interimChunk, priorRows, FLU_CONFIG)
      if (turnBoundary && msSinceLastCommit > 0) {
        interimChunk = bridgeInterimAfterCommitPause(
          interimChunk,
          priorRows.at(-1) || '',
          msSinceLastCommit,
        )
      }
      if (!interimChunk && rawBeforeStrip) {
        interimChunk = recoverInterimAfterStrip(rawBeforeStrip, priorRows)
      }
    }
    const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
    if (turnBoundary && roomCfg.preservePreviewOnTurnBoundary === false) {
      state.openLine = ''
      state.pendingInterim = ''
    }
    if (!interimChunk) {
      interimChunk = rawBeforeStrip
    }
    if (!interimChunk) {
      return buildListenPacketResult({ unchanged: true, published: prevPublished })
    }
    interim = interimChunk
  }

  const lineBefore = readOpenLine(state)

  if (interimChunk && interimChunk === readPending(state) && !finalChunk) {
    markInterimOpenLineActivity(state, { text: readOpenLine(state), nowMs: Date.now() })
    const liveAfterMerge = cleanForSpeech(readTurnLive(state))
    const bestPublished = liveAfterMerge.length >= prevPublished.length ? liveAfterMerge : prevPublished
    return buildListenPacketResult({
      unchanged: true,
      display: liveAfterMerge || readTurnLive(state),
      published: bestPublished || prevPublished,
      changed: Boolean(bestPublished && bestPublished !== prevPublished),
      deltaChars: 0,
      micLen: interimChunk.length,
      freshUtterance: false,
    })
  }

  const freshUtterance =
    turnBoundary ||
    (Boolean(interimChunk) &&
      !finalChunk &&
      Boolean(lineBefore) &&
      !utterancesRelate(lineBefore, interimChunk))

  const freshTurn = (Boolean(interimChunk) && !finalChunk && !lineBefore) || turnBoundary

  const { display, session } = integrateMicPacket(state, { interim, final })
  let nextPublished
  if (finalChunk) {
    nextPublished = resolveCommitCapture({
      final: finalChunk,
      interim: interimChunk,
      state,
      published: prevPublished,
    })
    state.openLine = nextPublished
    state.pendingInterim = ''
    clearInterimOpenLineClock(state)
  } else {
    nextPublished = normalizeMicText(
      advancePublishedDisplay(prevPublished, state, { reset, freshTurn }),
    )
    if (interimChunk) {
      markInterimOpenLineActivity(state, { text: readOpenLine(state), nowMs: Date.now() })
    }
  }
  const deltaChars = Math.max(0, nextPublished.length - prevPublished.length)

  return buildListenPacketResult({
    display,
    session,
    published: nextPublished,
    changed: nextPublished !== prevPublished,
    deltaChars,
    micLen: interimChunk.length || finalChunk.length,
    freshUtterance,
  })
}

export function resolveLogRowAction({
  activeLogStream = false,
  newParagraph = false,
  turnBoundary = false,
  turnCommit = false,
  lastEmitted = '',
  lastCommitted = '',
  capture = '',
  logRowContext = {},
} = {}) {
  let streamOpen = activeLogStream
  let effectiveNewParagraph = newParagraph
  const committed = cleanForSpeech(lastCommitted)
  const prior = cleanForSpeech(lastEmitted)
  const next = cleanForSpeech(capture)

  const pauseMs = Number(
    logRowContext.msSinceLastCommit ?? logRowContext.pauseBeforeMs ?? logRowContext.openLineAgeMs ?? 0,
  )
  const pauseForceNewMs =
    Number(FLU_CONFIG.transcript?.logRowPauseForceNewMs) > 0
      ? Number(FLU_CONFIG.transcript.logRowPauseForceNewMs)
      : 1000
  const pauseForceNew = Number.isFinite(pauseMs) && pauseMs >= pauseForceNewMs

  /**
   * Sufijo huérfano recortado del ancla (p. ej. «estas» tras «hola como estas»).
   * No confundir con revisión ASR del mismo enunciado (táctil→táctico).
   */
  const isHarmfulSuffixShrink = (anchor = '', candidate = '') => {
    const a = cleanForSpeech(anchor)
    const n = cleanForSpeech(candidate)
    if (!a || !n || n.length >= a.length) return false
    const aLow = a.toLowerCase()
    const nLow = n.toLowerCase()
    const trailingSuffix = aLow.endsWith(nLow) || aLow.endsWith(` ${nLow}`)
    if (!trailingSuffix) return false
    const aw = speechWords(a).length
    const nw = speechWords(n).length
    if (nw >= aw) return false
    return nw <= 2 || n.length <= a.length * 0.45
  }

  /**
   * turnCommit: replaceLast solo si duplicado exacto, revisión ASR del mismo enunciado
   * o extensión progresiva. Nunca si el candidato es un sufijo huérfano recortado.
   */
  const canReplaceLastOnCommit = (anchor = '', candidate = '') => {
    const a = cleanForSpeech(anchor)
    const n = cleanForSpeech(candidate)
    if (!a || !n) return false
    if (a === n) return true
    if (isHarmfulSuffixShrink(a, n)) return false
    if (utterancesSameRevision(a, n)) return true
    if (n.length > a.length && utterancesAsrProgress(a, n)) return true
    return false
  }

  const forceNewRowGuard =
    logRowContext.forceNewRow ||
    shouldForceNewLogRowOnCommit(next, committed, prior, logRowContext)

  if (turnCommit && next) {
    if (pauseForceNew || forceNewRowGuard) {
      return {
        replaceLast: false,
        afterEmitActive: false,
        extendsPrevious: false,
        forcedReplacePrefix: false,
        effectiveNewParagraph: true,
      }
    }

    const replacePrior = canReplaceLastOnCommit(prior, next)
    const replaceCommitted = canReplaceLastOnCommit(committed, next)

    if (replacePrior || replaceCommitted) {
      return {
        replaceLast: true,
        afterEmitActive: false,
        extendsPrevious: false,
        forcedReplacePrefix: Boolean(replaceCommitted && !replacePrior && committed !== next),
        effectiveNewParagraph: false,
      }
    }

    return {
      replaceLast: false,
      afterEmitActive: false,
      extendsPrevious: false,
      forcedReplacePrefix: false,
      effectiveNewParagraph: true,
    }
  }

  if (effectiveNewParagraph || turnBoundary) streamOpen = false

  const extendsPrevious =
    !pauseForceNew &&
    turnCommit &&
    Boolean(next) &&
    ((Boolean(prior) && utterancesRelate(prior, next) && next.length >= prior.length) ||
      (Boolean(committed) &&
        (utterancesRelate(committed, next) ||
          utterancesSameRevision(committed, next) ||
          utterancesAsrProgress(committed, next))))

  let replaceLast = (streamOpen && !effectiveNewParagraph && !turnBoundary) || extendsPrevious
  let forcedReplacePrefix = false

  if (turnCommit && prior && next && canReplaceLastOnCommit(prior, next)) {
    replaceLast = true
    forcedReplacePrefix = prior !== next
  } else if (turnCommit && committed && next && canReplaceLastOnCommit(committed, next)) {
    replaceLast = true
    forcedReplacePrefix = committed !== next
  } else if (turnCommit) {
    replaceLast = false
    forcedReplacePrefix = false
    if (next) effectiveNewParagraph = true
  }

  if (
    turnCommit &&
    replaceLast &&
    committed &&
    next &&
    preferNewRowForShortFinal(next, committed, logRowContext)
  ) {
    replaceLast = false
    forcedReplacePrefix = false
    effectiveNewParagraph = true
  }

  const afterEmitActive = turnCommit ? false : true
  return {
    replaceLast,
    afterEmitActive,
    extendsPrevious: pauseForceNew ? false : extendsPrevious,
    forcedReplacePrefix,
    effectiveNewParagraph,
  }
}

export function checkStreamParity(micInterim = '', published = '', session = '') {
  return assessStreamParity(micInterim, published, session)
}
