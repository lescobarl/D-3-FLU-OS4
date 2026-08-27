/**
 * Punto único de verdad: turnos ASR con wake inline (TV/fondo + «ok flu …»).
 * Ingress, hook y comandos delegan aquí — una sola ruta, sin duplicar split/commit.
 */
import { FLU_CONFIG } from './fluConfig.js'
import {
  cleanForSpeech,
  splitTranscriptAtWakeWord,
  peelWakeQuestionEcho,
  resolveFinalConversationAction,
  resolveCommandConversationLogText,
} from './audioMath.js'

/**
 * @param {import('./fluConfig.js').typeof FLU_CONFIG} [config]
 * @returns {string[]}
 */
export function getWakeWords(config = FLU_CONFIG) {
  return config.voiceCommands?.wakeWords || []
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
 *   action: ReturnType<typeof resolveFinalConversationAction>,
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
  const echoSources = [passiveOnly, cleanForSpeech(lastCommitted)].filter(Boolean)
  const afterWakeRaw = cleanForSpeech(split.afterWake || split.commandText || '')
  const afterWake = peelWakeQuestionEcho(afterWakeRaw, echoSources)
  const action = resolveFinalConversationAction(cleaned, FLU_CONFIG.voiceCommands, {
    lastCommitted: passiveOnly || cleanForSpeech(lastCommitted),
  })
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
 * Guardia de commit: separa pasivo TV de cola flu si la captura aún llega mezclada.
 *
 * @param {string} capture
 * @param {string} [lastCommitted]
 * @returns {{ capture: string, fluTail: { fullCapture: string, action: object } | null }}
 */
export function resolveInlineWakeAtCommit(capture = '', lastCommitted = '') {
  const wakeAnalysis = analyzeWakeTurn(capture, { lastCommitted })
  if (
    wakeAnalysis.hasInlineBoundary &&
    wakeAnalysis.passiveOnly &&
    wakeAnalysis.passiveOnly.length < wakeAnalysis.cleaned.length
  ) {
    return { capture: wakeAnalysis.passiveOnly, fluTail: wakeAnalysis.fluTail }
  }
  return { capture: cleanForSpeech(capture), fluTail: null }
}
