import { equalsTrimmed, pickLabel } from '../../lib/textUtils';
/**
 * Escucha activa: estado, hablantes, finales. Motor de texto en conversationStream.js.
 */
import { cleanForSpeech, detectWakeIntroducedName, normalizeSpokenCommand, stripDiacritics } from './audioMath.js'
import { FLU_CONFIG, getActiveListenConfig } from './fluConfig.js'
import { isProperSpeakerName, nextAvailableSpeakerLabel } from './voiceIdentity.js'
import { requiresWakeWordForSpeakerName } from './speakerPolicy.js'
import { integrateMicPacket, mergeMicChunks, readStreamDisplay, resolveCommitCapture, utterancesRelate, utterancesSameRevision } from './conversationStream.js'

export {
  advancePublishedDisplay,
  assessStreamParity,
  checkStreamParity,
  integrateMicPacket,
  mergeSpeechText,
  processListenPacket,
  readStreamDisplay,
  readSession,
  readPublishedText,
  resolveLogParagraphBreak,
  resolveLogRowAction,
  resolveCommitCapture,
  stripPriorTurnsFromInterim,
  archiveCommittedTurn,
  buildPriorRowsForStrip,
  trimCommittedRowsRef,
  validateLogRowsNoPrefixDup,
  validateLogRowsNoAsrRevisionDup,
  utterancesSameRevision,
  utterancesAsrProgress,
  countSharedSpeechWords,
  rowDuplicatesPrior,
  collapseRepeatedSpeech,
  collapseEchoPhrase,
  mergeMicChunks,
  pickBestMicInterim,
  micPublishedParityOk,
  collapseAsrStutter,
  normalizeMicText,
  hasSpeechAnchor,
  shouldRefreshStream,
  utterancesRelate,
} from './conversationStream.js'

import { shouldRelaxIngressTextGuards } from './ingressGuards.js'
import { autoSpeakerLabel, getFallbackSpeaker, parseSpeakerIndex } from './speakerCore.js';

export { isSpeakerVoiceAbruptChange, shouldRelaxIngressTextGuards } from './ingressGuards.js'

export function createActiveListenState() {
  return {
    transcript: '',
    openLine: '',
    pendingInterim: '',
    lastFinalAtMs: 0,
    speakerIndex: 1,
    /** Libro de la ultima fusion de la linea viva: `{ base, chunk, line }` (ver integrateOpenLine). */
    openLineBook: null,
  }
}

export function resetActiveListenState(state) {
  state.transcript = ''
  state.openLine = ''
  state.pendingInterim = ''
  state.lastFinalAtMs = 0
  state.speakerIndex = 1
  state.openLineBook = null
}

export function resolveActiveSpeaker(state, utterance = '') {
  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const introduced = detectWakeIntroducedName(utterance, wakeWords)
  if (introduced) return introduced
  return getSpeakerLabel(state)
}

export function readCommandText(state) {
  return readStreamDisplay(state)
}

/** Un final por onresult: fusiona varios fragmentos acumulativos o secuenciales. */
export function pickLongestFinal(chunks = []) {
  return mergeMicChunks(chunks)
}

/**
 * Ventana (ms) del eco ASR ya commiteado: la MISMA frase re-emitida DENTRO de esta ventana es
 * el MISMO evento (doble final / loop de Chrome), NO habla nueva; pasada la ventana, la
 * repeticion es genuina. DUENO UNICO del criterio (antes eran 3 copias del mismo literal).
 *
 * @returns {number} ms
 */
export function committedEchoStreakWindowMs() {
  return Number(FLU_CONFIG?.voiceIdentity?.capture?.committedEchoStreakWindowMs) || 1200
}

/** Final ya cubierto por lo commitado; preview abierto siempre se sella en commit. */
export function isRedundantFinal(finalText = '', context = {}) {
  const fin = cleanForSpeech(finalText)
  if (!fin) return true

  const preview = cleanForSpeech(context.preview || context.displayLine || '')
  if (context.openPreview && preview) {
    if (fin === preview) return false
    if (utterancesSameRevision(preview, fin)) return false
    if (preview.length <= fin.length && fin.startsWith(preview)) return false
    if (shouldRelaxIngressTextGuards(context) && fin.length > preview.length) return false
  }

  const candidates = [
    cleanForSpeech(context.lastEmitted || ''),
    cleanForSpeech(context.lastCommitted || ''),
  ].filter(Boolean)

  // Pasada una pausa real (>= ventana de eco ASR), lo dicho contra la fila YA
  // cerrada es un turno NUEVO, no eco, sea repetición exacta, PREFIJO, sufijo o
  // revisión. Antes el escape solo cubría la igualdad exacta: «ok flu como voy»
  // tras «ok flu como voy en ingles» (una pregunta MÁS CORTA, segundos después) se
  // colapsaba como redundante y la locución se perdía sin fila ni despacho — medido
  // 2026-10-18 en tests/e2e/tutoria-avance.spec.ts. Dentro de la ventana el eco
  // rápido (doble final / loop de Chrome) se sigue colapsando igual.
  const msSinceLastCommit = Number(context.msSinceLastCommit) || 0
  const echoStreakWindowMs = committedEchoStreakWindowMs()
  const isFreshRepeat = msSinceLastCommit > 0 && msSinceLastCommit >= echoStreakWindowMs

  for (const last of candidates) {
    if (isFreshRepeat) continue
    if (fin === last) return true
    if (last.length >= fin.length) {
      if (last.startsWith(fin) || last.endsWith(fin)) {
        return true
      }
      const finWordCount = fin.split(/\s+/).filter(Boolean).length
      if (finWordCount > 1 && last.includes(` ${fin}`)) {
        return true
      }
      if (utterancesRelate(last, fin)) {
        if (
          finWordCount <= 2 &&
          last.length > fin.length + 6 &&
          !last.startsWith(fin) &&
          !last.endsWith(fin)
        ) {
          continue
        }
        return true
      }
    }
    if (utterancesSameRevision(last, fin)) {
      if (fin === last) return true
      if (fin.length <= last.length && last.startsWith(fin)) return true
      continue
    }
  }
  return false
}

/** No acortar por ruido ASR; no bloquear sufijos sueltos («estas» tras frase larga). */
export function wouldShrinkListenLog(capture = '', lastEmitted = '') {
  const next = cleanForSpeech(capture)
  const prev = cleanForSpeech(lastEmitted)
  if (!next || !prev || next.length >= prev.length) return false
  if (!utterancesRelate(prev, next)) return false
  if (prev.startsWith(next)) return true
  if (prev.endsWith(` ${next}`)) return true
  return false
}

/**
 * Etiqueta automatica de la ESCUCHA. DUENO UNICO de la plantilla: `autoSpeakerLabel`
 * (`voiceIdentity.labels.template`). Antes esta funcion leia `speakers.labelTemplate` y
 * reemplazaba SOLO la primera `{n}`: dos plantillas y dos semantica (auditoria 2026-10-22).
 * @param {number} index
 * @param {object} [_speakersCfg] ya no se lee (se conserva la firma por compatibilidad)
 * @returns {string}
 */
export function formatListenSpeakerLabel(index, _speakersCfg) {
  return autoSpeakerLabel(index)
}

export function getSpeakerLabel(state) {
  const { speakers } = getActiveListenConfig()
  const index = Number(state?.speakerIndex)
  return formatListenSpeakerLabel(Number.isFinite(index) && index >= 1 ? index : 1, speakers)
}

export function shouldOpenNewParagraph(state, nowMs = Date.now()) {
  const { speakers } = getActiveListenConfig()
  const breakOnPause = speakers.paragraphBreakOnPause !== false
  if (!breakOnPause) return false
  if (!state.lastFinalAtMs || !cleanForSpeech(state.openLine)) return false
  return nowMs - state.lastFinalAtMs >= speakers.paragraphBreakMs
}

/**
 * ¿La linea abierta es una captura CONFIRMADA (un FINAL ya integrado y sin interino
 * posterior) o solo un INTERINO en vuelo?
 *
 * El dueño del estado marca los dos hechos: `confirmFinal` estampa `lastFinalAtMs` al
 * integrar un FINAL, y cada interino toca `openLineLastTouchMs`
 * (`markInterimOpenLineActivity`). Con un interino POSTERIOR al final la linea ya no es
 * fiable (Chrome congela a mitad de frase y entrega una palabra truncada); con el FINAL
 * como ultimo escritor, la linea es texto que el usuario YA dijo y NO se puede descartar
 * sin fila (defecto medido P9.60: el rebuild del watchdog la descartaba y la locucion se
 * perdia).
 */
export function hasConfirmedOpenLine(state) {
  // LOCUCION CONFIRMADA SIN FILA: la marca el ingress (`pendingFinal`) al confirmar un
  // FINAL de segmento que NO cierra el turno. Los interinos POSTERIORES tocan la linea
  // viva (`openLineLastTouchMs > lastFinalAtMs`) y hacian que este test dijera "no
  // confirmada" -> el rebuild por stall la descartaba y la locucion se perdia ENTERA
  // (medido en el log del dueno 2026-10-10 19:24: `filas=[]` con el texto en la linea).
  if (cleanForSpeech(state?.pendingFinal)) return true
  if (!cleanForSpeech(state?.openLine)) return false
  const finalAt = Number(state?.lastFinalAtMs) || 0
  if (finalAt <= 0) return false
  return finalAt >= (Number(state?.openLineLastTouchMs) || 0)
}

export function confirmFinal(state, finalText = '', nowMs = Date.now()) {
  const utterance = resolveCommitCapture({
    final: finalText,
    interim: state.pendingInterim,
    state,
    published: readStreamDisplay(state),
  })
  state.pendingInterim = ''

  const newParagraph = shouldOpenNewParagraph(state, nowMs)
  if (newParagraph) {
    const { speakers } = getActiveListenConfig()
    if (speakers.autoAdvanceOnPause) {
      advanceSpeaker(state)
    }
  }

  if (utterance) {
    integrateMicPacket(state, { final: utterance })
  }

  if (newParagraph) {
    state.openLine = ''
    state.pendingInterim = ''
  }

  if (utterance && detectNextSpeakerPhrase(utterance)) {
    advanceSpeaker(state)
  }

  state.lastFinalAtMs = nowMs

  const speaker = resolveActiveSpeaker(state, utterance)

  return {
    transcript: state.transcript,
    openLine: state.openLine,
    newParagraph,
    speaker,
  }
}

export function sealPendingInterim(state, nowMs = Date.now()) {
  const pending = cleanForSpeech(state?.pendingInterim || '')
  if (!pending) return confirmFinal(state, '', nowMs)
  return confirmFinal(state, pending, nowMs)
}

/**
 * DUENO UNICO del BORRADO de la locucion CONFIRMADA sin fila (`pendingFinal`).
 *
 * Un dato, un dueno: el borrado estaba repartido en TRES sitios por su cuenta (el
 * ingress lo vaciaba en dos ramas y el flush de buffers en una tercera), y el orden
 * entre ellos decide si la locucion se sella o se pierde. Aqui vive el unico borrado,
 * y DEVUELVE lo que habia para que ningun llamante pueda perderlo en silencio.
 *
 * @param {object|null} state Estado de escucha.
 * @returns {string} La locucion confirmada que se descarta ('' si no habia).
 */
export function clearPendingFinal(state) {
  if (!state) return ''
  const pendiente = cleanForSpeech(state.pendingFinal || '')
  state.pendingFinal = ''
  state.pendingFinalTurn = null
  return pendiente
}

export function foldSpeechKey(text = '') {
  return cleanForSpeech(text).toLowerCase()
}

export function phrasesEquivalent(a = '', b = '') {
  const left = foldSpeechKey(a)
  const right = foldSpeechKey(b)
  return Boolean(left) && left === right
}

export function getRecognitionLanguage(language = 'es', activeLocale = '') {
  const { languages, bilingual } = getActiveListenConfig()
  if (activeLocale) return activeLocale
  if (language === 'both') {
    return bilingual?.defaultLocale || languages.es
  }
  return pickLabel(languages, language, languages.es)
}

/** Modo escucha: es | en | both (bilingüe). */
export function isBilingualListenMode(language = '') {
  return equalsTrimmed(language, 'both')
}

/** Locale BCP-47 del motor SR según modo UI y texto detectado. */
export function resolveRecognitionLocale(language = 'es', detected = '') {
  const { languages } = getActiveListenConfig()
  if (!isBilingualListenMode(language)) {
    return getRecognitionLanguage(language)
  }
  if (detected === 'en') return languages.en
  if (detected === 'es') return languages.es
  return getRecognitionLanguage('both')
}

function normalizePhrase(text = '') {
  return stripDiacritics(cleanForSpeech(text)).toLowerCase()
}

export function matchesListeningAck(phrase = '') {
  const norm = normalizePhrase(phrase)
  if (!norm) return false
  const { listeningAck } = getActiveListenConfig()
  return listeningAck.phrases.some((sample) => {
    const key = normalizePhrase(sample)
    return key && (norm === key || norm.includes(key) || key.includes(norm))
  })
}

/**
 * El cue de cambio de hablante es una ORDEN, no una mencion: el mandato ABRE con el cue.
 *
 * Defecto medido (log del dueno, 2026-10-12 21:16): dictando "en la ultima frase no hay
 * ni cambio de hablante ni ni silencio para que lo escriba" el commit salio
 * `src=explicit-next name="Hablante 2"` y una sesion de UNA sola voz quedo partida en
 * "Hablante 1"/"Hablante 2"/"Luis". Antes se buscaba el cue con `includes` en CUALQUIER
 * posicion del dictado, asi que mencionar el concepto cambiaba de hablante.
 *
 * El mandato se lee por su dueno unico de higiene (`normalizeSpokenCommand`: quita wake,
 * eco del ASR y muletilla) y el cue tiene que encabezarlo. Un lector de cues, una regla.
 */
export function detectNextSpeakerPhrase(text = '') {
  const norm = normalizePhrase(normalizeSpokenCommand(text))
  if (!norm) return false
  const phrases = FLU_CONFIG.voiceCommands.nextSpeaker || []
  return phrases.some((sample) => {
    const key = normalizePhrase(sample)
    return key && norm.startsWith(key)
  })
}

export function nextSpeakerLabel(knownLabels = []) {
  const speakersCfg = getActiveListenConfig().speakers
  const cap = Number(speakersCfg.maxSpeakers)
  return nextAvailableSpeakerLabel([], knownLabels, { maxSpeakers: cap > 0 ? cap : 0 })
}

export function resolveSpeakerByText(transcript = '', lastSpeaker = '') {
  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const introduced = detectWakeIntroducedName(transcript, wakeWords)
  if (introduced) return introduced
  const last = cleanForSpeech(lastSpeaker)
  // Sin wake no se estampa un nombre propio por continuidad: el habla pasiva
  // (sala/TV) es generica (Hablante N). Config: requireWakeWordForSpeakerName.
  if (last && requiresWakeWordForSpeakerName() && isProperSpeakerName(last)) {
    return getFallbackSpeaker()
  }
  return last || getFallbackSpeaker()
}

export function advanceSpeaker(state) {
  state.speakerIndex += 1
  state.openLine = ''
  state.lastFinalAtMs = 0
  return getSpeakerLabel(state)
}

export function syncSpeakerIndexFromLabel(state, label = '') {
  const index = parseSpeakerIndex(label)
  if (index === null) return
  if (!Number.isFinite(index) || index < 1) return
  state.speakerIndex = index
}
