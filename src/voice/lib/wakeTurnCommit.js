/**
 * Punto único de verdad: turnos ASR con wake inline (TV/fondo + «ok flu …»).
 * Ingress, hook y comandos delegan aquí — una sola ruta, sin duplicar split/commit.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { resolveEchoSources } from './echoPolicy.js'
import { resolveWakeWords } from './wakeWords.js'
import {
  cleanForSpeech,
  splitTranscriptAtWakeWord,
  peelWakeQuestionEcho,
  planConversationDispatch,
  resolveCommandConversationLogText,
} from './audioMath.js'

/**
 * @param {import('./fluConfig.js').typeof FLU_CONFIG} [config]
 * @returns {string[]}
 */
export function getWakeWords(config = FLU_CONFIG) {
  // La regla de respaldo (lista de Ajustes -> default de FLU_CONFIG) vive en UN
  // solo sitio, `resolveWakeWords`: antes estaba reimplementada aqui y en el hook,
  // asi que una copia podia divergir de la otra sin que nadie lo notara.
  return resolveWakeWords(config.voiceCommands?.wakeWords)
}

/**
 * Analiza una captura respecto al wake word y al último commit del log.
 *
 * @param {string} capture
 * @param {{ lastCommitted?: string, wakeWords?: string[] }} [options]
 * @returns {{
 *   cleaned: string,
 *   wakeWordMatched: boolean,
 *   hasInlineBoundary: boolean,
 *   passiveOnly: string,
 *   afterWake: string,
 *   question: string,
 *   commandLogText: string,
 *   action: ReturnType<typeof planConversationDispatch>['action'],
 *   split: ReturnType<typeof splitTranscriptAtWakeWord>,
 *   commitCapture: string,
 *   fluTail: { fullCapture: string, action: object } | null,
 * }}
 */
export function analyzeWakeTurn(capture = '', { lastCommitted = '', wakeWords = getWakeWords() } = {}) {
  const emptySplit = splitTranscriptAtWakeWord('', wakeWords)
  const cleaned = cleanForSpeech(capture)
  if (!cleaned) {
    return {
      cleaned: '',
      wakeWordMatched: false,
      hasInlineBoundary: false,
      passiveOnly: '',
      afterWake: '',
      question: '',
      commandLogText: '',
      action: { kind: 'log' },
      split: emptySplit,
      commitCapture: '',
      fluTail: null,
    }
  }

  const split = splitTranscriptAtWakeWord(cleaned, wakeWords)
  const passiveOnly = cleanForSpeech(split.beforeWake || '')
  const hasInlineBoundary = Boolean(split.wakeWordMatched && passiveOnly)
  // B2: la fuente del eco es el texto REAL de FLU (no la ultima fila del log de usuario),
  // y solo si su ventana de eco sigue abierta (anclada al fin de su habla).
  const echoSources = resolveEchoSources({ passiveText: passiveOnly })
  const afterWakeRaw = cleanForSpeech(split.afterWake || split.commandText || '')
  const afterWake = peelWakeQuestionEcho(afterWakeRaw, echoSources)
  const action = planConversationDispatch(cleaned, FLU_CONFIG.voiceCommands, {
    lastCommitted: passiveOnly || cleanForSpeech(lastCommitted),
  }).action
  const commandLogText = resolveCommandConversationLogText(cleaned, split, passiveOnly)
  const question =
    action.kind === 'flu'
      ? cleanForSpeech(action.question || afterWake)
      : cleanForSpeech(afterWake)

  const fluTail =
    hasInlineBoundary && afterWake && action.kind === 'flu'
      ? { fullCapture: cleaned, action: { ...action, beforeWake: passiveOnly, question } }
      : null

  return {
    cleaned,
    wakeWordMatched: Boolean(split.wakeWordMatched),
    hasInlineBoundary,
    passiveOnly,
    afterWake,
    question,
    commandLogText,
    action,
    split,
    commitCapture: hasInlineBoundary ? passiveOnly : cleaned,
    fluTail,
  }
}

/**
 * Parte pasiva → scheduleTurnCommit; cola flu → tryDispatch (wake-tail).
 *
 * @param {object} ctx — contexto ingress (scheduleTurnCommit, tryDispatch, logRowsTextRef)
 * @param {string} capture
 * @param {object} [commitOpts]
 * @returns {{ handled: boolean, reason?: string, capture?: string, analysis?: object }}
 */
export function applyWakeTurnCommit(ctx, capture, commitOpts = {}) {
  const lastCommitted = ctx.logRowsTextRef?.current?.at(-1) || ''
  const analysis = analyzeWakeTurn(capture, { lastCommitted })

  if (!analysis.hasInlineBoundary) {
    return { handled: false, reason: 'no-inline-wake', capture: analysis.cleaned, analysis }
  }

  const { passiveOnly, afterWake, action } = analysis
  const baseOpts = {
    turnCommit: true,
    turnBoundary: true,
    atTurnBoundary: true,
    freshUtterance: true,
    // Cierre REAL: el split por wake sella la parte pasiva como turno cerrado.
    settlesTurn: true,
    ...commitOpts,
  }

  ctx.scheduleTurnCommit?.({
    ...baseOpts,
    capture: passiveOnly,
    utterance: passiveOnly,
    forceNewRow: commitOpts.forceNewRow,
  })

  if (afterWake && action.kind === 'flu') {
    ctx.tryDispatch?.(analysis.cleaned, {
      interim: false,
      source: `${commitOpts.source || 'commit'}-wake-tail`,
    })
    return { handled: true, reason: 'wake-split-flu', capture: analysis.cleaned, analysis }
  }

  if (afterWake) {
    ctx.scheduleTurnCommit?.({
      ...baseOpts,
      capture: afterWake,
      utterance: afterWake,
      forceNewRow: true,
    })
  }

  return { handled: true, reason: 'wake-split-passive', capture: analysis.cleaned, analysis }
}

export { applyWakeTurnCommit as commitCaptureRespectingWakeBoundary }

/**
 * Predicado UNICO de "esta captura es un turno del usuario".
 *
 * Con la wake word exigida siempre (aula/casa: TV, ninos, familia) la wake es la
 * unica compuerta: una captura SIN wake no es un turno. Lo consumen el ingress
 * (no acuna id de turno, no abre fila) y la pregunta de fila del log. Usa el
 * splitter UNICO (`splitTranscriptAtWakeWord`), no un segundo criterio.
 *
 * @param {string} capture
 * @param {{ wakeRequired?: boolean, wakeWords?: string[] }} [options]
 * @returns {boolean}
 */
export function isTurnCapture(capture = '', { wakeRequired = false, wakeWords = getWakeWords() } = {}) {
  if (!wakeRequired) return true
  return Boolean(splitTranscriptAtWakeWord(cleanForSpeech(capture), wakeWords).wakeWordMatched)
}

/**
 * ¿Hay que EXIGIR la wake word en este punto de la escucha? DUENO UNICO de la
 * decision: antes estaba reimplementada en TRES sitios (dos identicos en el hook y
 * uno reducido en el commit del stream), que podian divergir. `conversationActive`
 * es el contexto de escucha; con la conversacion INACTIVA siempre se exige.
 *
 * @param {boolean} conversationActive
 * @param {import('./fluConfig.js').typeof FLU_CONFIG} [config]
 * @returns {boolean}
 */
export function requiresWakeWord(conversationActive = false, config = FLU_CONFIG) {
  return config.voiceCommands?.requireWakeAlways !== false || !conversationActive
}

/**
 * Guardia de commit: separa pasivo TV de cola flu si la captura aún llega mezclada.
 *
 * `wakeWordMatched` viaja con el resultado: es el MISMO analisis del turno
 * (no un segundo criterio) el que decide si la captura lleva la wake word, que es
 * lo que separa un turno de usuario del ruido de fondo en conversacion activa.
 *
 * @param {string} capture
 * @param {string} [lastCommitted]
 * @returns {{ capture: string, fluTail: { fullCapture: string, action: object } | null, wakeWordMatched: boolean }}
 */
export function resolveInlineWakeAtCommit(capture = '', lastCommitted = '') {
  const wakeAnalysis = analyzeWakeTurn(capture, { lastCommitted })
  if (
    wakeAnalysis.hasInlineBoundary &&
    wakeAnalysis.passiveOnly &&
    wakeAnalysis.passiveOnly.length < wakeAnalysis.cleaned.length
  ) {
    return {
      capture: wakeAnalysis.passiveOnly,
      fluTail: wakeAnalysis.fluTail,
      wakeWordMatched: wakeAnalysis.wakeWordMatched,
    }
  }
  return {
    capture: cleanForSpeech(capture),
    fluTail: null,
    wakeWordMatched: wakeAnalysis.wakeWordMatched,
  }
}
