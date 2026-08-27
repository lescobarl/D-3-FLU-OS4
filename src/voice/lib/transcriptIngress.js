/**
 * ingestFinalChunk: flush absoluto + final-only + commit async vía hook.
 */
import { cleanForSpeech, pickBestRecognitionTranscript } from './audioMath.js'
import { mergeTranscriptText } from './transcriptDelta.js'
import { FLU_CONFIG } from './fluConfig.js'
import {
  analyzeWakeTurn,
  applyWakeTurnCommit,
  commitCaptureRespectingWakeBoundary,
} from './wakeTurnCommit.js'
import { getTranscriptPauseCfg } from './fluTranscriptPause.js'
import { getSpeakerThresholdsCfg } from './fluTranscriptMotor.js'
import { shouldRelaxIngressTextGuards } from './ingressGuards.js'
import {
  confirmFinal,
  isRedundantFinal,
  isSpeakerVoiceAbruptChange,
  pickBestMicInterim,
  processListenPacket,
  resolveLogParagraphBreak,
  readStreamDisplay,
  utterancesRelate,
  utterancesSameRevision,
  sealPendingInterim,
  phrasesEquivalent,
} from './activeListen.js'
import {
  micPublishedParityOk,
  collapseMisorderedMicMerge,
  buildPriorRowsForStrip,
  clearInterimOpenLineClock,
  readTurnLive,
  evaluateSrGapSegmentCommit,
  isCommittedInterimEcho,
  peelCommittedPrefixFromInterim,
  clearStaleCommittedEchoFromState,
  resolveCommitCapture,
  mergePreviewIntoFinalCapture,
  mergeTurnBridgeWithInterim,
  mergeLivePreviewIntoFinalCommit,
  shouldMergeLivePreviewIntoFinal,
  utterancesAsrProgress,
} from './conversationStream.js'
import { fluTrace } from './fluTrace.js'
import { shouldDiarizeInterimAtTurnBoundary } from './speakerPolicy.js'
import { shouldForceNewLogRowOnCommit } from './ingressGuards.js'
import { nowPerf, getSegmentSilenceGapMs } from './audioSegmentClock.js'
import { countSpeechWords as countWordsFromPauseCfg } from './fluTranscriptPause.js'

function buildFinalCommitList(finalChunks = []) {
  const normalized = finalChunks
    .map((chunk) => cleanForSpeech(chunk))
    .filter(Boolean)

  if (normalized.length <= 1) return normalized

  const commits = []
  for (const capture of normalized) {
    const last = commits.at(-1) || ''
    if (!last) {
      commits.push(capture)
      continue
    }
    if (
      capture === last ||
      capture.startsWith(last) ||
      utterancesSameRevision(last, capture) ||
      utterancesRelate(last, capture)
    ) {
      commits[commits.length - 1] = capture
      continue
    }
    commits.push(capture)
  }
  return commits
}

export function collectBrowserResultChunks(event) {
  const interimChunks = []
  const finalChunks = []
  if (!event?.results?.length) {
    return { interimChunks, finalChunks }
  }
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index]
    const transcript = pickBestRecognitionTranscript(result)
    if (transcript == null) continue
    if (result.isFinal) {
      finalChunks.push(transcript)
    } else {
      interimChunks.push(transcript)
    }
  }
  return { interimChunks, finalChunks }
}

function buildIngressVoiceContext(ctx = {}) {
  const fromHook = typeof ctx.getIngressVoiceContext === 'function' ? ctx.getIngressVoiceContext() : {}
  const thresholds = getSpeakerThresholdsCfg()
  return {
    previewSpeaker: fromHook.previewSpeaker || ctx.lastLoggedSpeakerRef?.current || '',
    interimSpeaker: fromHook.interimSpeaker || fromHook.previewSpeaker || '',
    finalSpeaker: fromHook.finalSpeaker || fromHook.interimSpeaker || '',
    previewSignature: fromHook.previewSignature || fromHook.lastSignature || null,
    finalSignature: fromHook.finalSignature || fromHook.previewSignature || null,
    lastSignature: fromHook.lastSignature || fromHook.previewSignature || null,
    continuityThreshold: thresholds.cosineContinuityThreshold,
    abruptSimilarityFloor: thresholds.cosineNewVoiceThreshold,
    abruptSimilarityDrop: thresholds.abruptSimilarityDrop,
  }
}

function msSinceLastCommitFromCtx(ctx) {
  const at = Number(ctx.lastCommitAtRef?.current)
  if (!Number.isFinite(at) || at <= 0) return 0
  return Math.max(0, Date.now() - at)
}

function buildIngressRowContext(ctx, capture) {
  const voice = buildIngressVoiceContext(ctx)
  const msSinceLastCommit = msSinceLastCommitFromCtx(ctx)
  const preview = cleanForSpeech(
    ctx.publishedLiveRef?.current || ctx.lastStreamPreviewRef?.current || readStreamDisplay(ctx.listenState),
  )
  const row = {
    lastEmitted: ctx.lastEmittedTranscriptRef?.current || '',
    lastCommitted: ctx.logRowsTextRef?.current?.at(-1) || '',
    preview,
    openPreview: ctx.openPreviewTurnRef?.current,
    displayLine: readStreamDisplay(ctx.listenState),
    msSinceLastCommit,
    pauseBeforeMs: msSinceLastCommit,
    openLineAgeMs:
      Date.now() -
      (ctx.listenState?.openLineLastTouchMs || ctx.listenState?.openLineStartedAtMs || 0),
    finalSpeaker: voice.finalSpeaker,
    previewSpeaker: voice.previewSpeaker,
    interimSpeaker: voice.interimSpeaker,
    finalSignature: voice.finalSignature,
    previewSignature: voice.previewSignature,
    lastSignature: voice.lastSignature,
    continuityThreshold: voice.continuityThreshold,
    abruptSimilarityFloor: voice.abruptSimilarityFloor,
    abruptSimilarityDrop: voice.abruptSimilarityDrop,
    capture,
  }
  row.forceRelaxGuards = shouldRelaxIngressTextGuards(row)
  return row
}

export { commitCaptureRespectingWakeBoundary, applyWakeTurnCommit, analyzeWakeTurn }

/** Heartbeat por tiempo en interino sin cambios — inerte (no commit). */
export function flushStaleInterimThroughIngress(ctx) {
  if (!ctx?.conversationActive || !ctx.listenState) return { flushed: false }
  return { flushed: false, reason: 'flush-disabled-production' }
}

/** Commit openLine cuando Chrome lleva ≥ srGapCommitMs sin onresult (TV / SR mudo). */
export function flushSrGapSegmentThroughIngress(ctx, { sinceLastResultMs = 0 } = {}) {
  if (!ctx?.conversationActive || !ctx.listenState) {
    return { flushed: false, reason: 'inactive' }
  }

  const lastCommitted = ctx.logRowsTextRef?.current?.at(-1) || ''
  const evalResult = evaluateSrGapSegmentCommit(ctx.listenState, {
    sinceLastResultMs,
    lastCommitted,
    lastCommitAtMs: Number(ctx.lastCommitAtRef?.current) || 0,
  })
  if (!evalResult.flush || !evalResult.capture) {
    return { flushed: false, reason: evalResult.reason || 'no-flush', capture: evalResult.capture || '' }
  }

  const capture = cleanForSpeech(evalResult.capture)
  if (!capture) return { flushed: false, reason: 'empty-capture' }

  resetInterimControlBuffers(ctx.listenState, ctx.publishedLiveRef, ctx.lastStreamPreviewRef)

  const rowContext = buildIngressRowContext(ctx, capture)
  const forceNewRow = shouldForceNewLogRowOnCommit(
    capture,
    rowContext.lastCommitted,
    rowContext.lastEmitted,
    rowContext,
  )
  const redundant = !forceNewRow && isRedundantFinal(capture, rowContext)
  if (redundant) {
    return { flushed: false, reason: 'redundant-vs-log', capture }
  }

  confirmFinal(ctx.listenState, capture)
  processListenPacket(ctx.listenState, '', { interim: '', final: capture, reset: true })

  const wakeAnalysis = analyzeWakeTurn(capture, { lastCommitted })
  if (wakeAnalysis.hasInlineBoundary) {
    const wakeSplit = applyWakeTurnCommit(ctx, capture, {
      source: 'sr-gap',
      newParagraph: forceNewRow || resolveLogParagraphBreak('', capture, true),
      forceNewRow,
    })
    if (wakeSplit.handled) {
      sealTurnBoundaryAfterFinal(ctx)
      return {
        flushed: true,
        dispatched: wakeSplit.reason === 'wake-split-flu',
        capture,
        reason: wakeSplit.reason || evalResult.reason,
        sinceLastResultMs,
      }
    }
  }

  if (ctx.tryDispatch?.(capture, { interim: false, source: 'sr-gap' })) {
    sealTurnBoundaryAfterFinal(ctx)
    return {
      flushed: true,
      dispatched: true,
      capture,
      reason: 'sr-gap-dispatched',
      sinceLastResultMs,
    }
  }

  ctx.scheduleTurnCommit?.({
    capture,
    newParagraph: forceNewRow || resolveLogParagraphBreak('', capture, true),
    utterance: capture,
    turnCommit: true,
    freshUtterance: true,
    turnBoundary: true,
    atTurnBoundary: true,
    forceNewRow,
  })

  sealTurnBoundaryAfterFinal(ctx)

  return {
    flushed: true,
    capture,
    reason: evalResult.reason,
    sinceLastResultMs,
  }
}

/** Sella preview pendiente al cerrar SpeechRecognition (onend) sin duplicar commits. */
export function flushRecognitionEndThroughIngress(ctx) {
  if (!ctx?.conversationActive || !ctx.listenState) {
    return { flushed: false, reason: 'inactive' }
  }

  const capture =
    readStreamDisplay(ctx.listenState) || cleanForSpeech(ctx.listenState.pendingInterim)
  if (!capture) {
    sealPendingInterim(ctx.listenState)
    return { flushed: false, reason: 'empty-capture' }
  }

  if (ctx.tryDispatch?.(capture, { interim: false, source: 'onend' })) {
    sealPendingInterim(ctx.listenState)
    return { flushed: true, dispatched: true, capture }
  }

  if (phrasesEquivalent(capture, ctx.lastEmittedTranscriptRef?.current)) {
    sealPendingInterim(ctx.listenState)
    return { flushed: false, reason: 'already-emitted', capture }
  }

  const result = sealPendingInterim(ctx.listenState)
  ctx.scheduleTurnCommit?.({
    capture,
    newParagraph: result.newParagraph,
    speaker: result.speaker,
    utterance: capture,
    turnCommit: true,
  })
  return { flushed: true, capture, source: 'onend' }
}

function resetInterimControlBuffers(listenState, publishedLiveRef, lastStreamPreviewRef) {
  if (listenState) {
    listenState.openLine = ''
    listenState.pendingInterim = ''
    listenState.pendingFinal = ''
    clearInterimOpenLineClock(listenState)
  }
  if (publishedLiveRef) publishedLiveRef.current = ''
  if (lastStreamPreviewRef) lastStreamPreviewRef.current = ''
}

function sealTurnBoundaryAfterFinal(ctx) {
  if (ctx?.openPreviewTurnRef) ctx.openPreviewTurnRef.current = false
  if (ctx?.preflightScheduledForTurnRef) ctx.preflightScheduledForTurnRef.current = false
  if (typeof ctx?.onTurnFinalized === 'function') ctx.onTurnFinalized()
}

function ingestFinalChunk({ finalChunk, ctx }) {
  const lastCommittedRow = cleanForSpeech(
    ctx.logRowsTextRef?.current?.at(-1) || ctx.lastEmittedTranscriptRef?.current || '',
  )
  let capture = cleanForSpeech(finalChunk)
  if (lastCommittedRow && !isCommittedInterimEcho(capture, lastCommittedRow)) {
    const progressiveExtension =
      capture.length > lastCommittedRow.length &&
      (capture.toLowerCase().startsWith(lastCommittedRow.toLowerCase()) ||
        utterancesAsrProgress(lastCommittedRow, capture))
    if (!progressiveExtension) {
      const peeledFinal = cleanForSpeech(peelCommittedPrefixFromInterim(capture, lastCommittedRow))
      if (peeledFinal) capture = peeledFinal
    }
  }
  if (!capture) return { handled: false, capture: '' }

  const earlyRowContext = buildIngressRowContext(ctx, capture)
  if (
    isRedundantFinal(capture, {
      ...earlyRowContext,
      preview: ctx.publishedLiveRef?.current || ctx.lastStreamPreviewRef?.current || '',
      openPreview: Boolean(ctx.openPreviewTurnRef?.current),
    })
  ) {
    resetInterimControlBuffers(ctx.listenState, ctx.publishedLiveRef, ctx.lastStreamPreviewRef)
    if (typeof ctx.flushTranscriptOnFinal === 'function') {
      ctx.flushTranscriptOnFinal()
    } else if (typeof ctx.flushRecognitionOnFinal === 'function') {
      ctx.flushRecognitionOnFinal()
    }
    sealTurnBoundaryAfterFinal(ctx)
    return { handled: false, capture, redundant: true }
  }

  const listenState = ctx.listenState
  const previewSnapshot = resolveCommitCapture({
    final: capture,
    state: listenState,
    published: ctx.publishedLiveRef?.current || ctx.lastStreamPreviewRef?.current || '',
  })
  let { commit: mergedCapture, bridge } = mergePreviewIntoFinalCapture(capture, previewSnapshot)
  if (
    !bridge &&
    lastCommittedRow &&
    cleanForSpeech(mergedCapture).length > capture.length + 16 &&
    cleanForSpeech(mergedCapture).toLowerCase().startsWith(lastCommittedRow.toLowerCase())
  ) {
    mergedCapture = capture
  }
  let commitCapture = cleanForSpeech(mergedCapture || capture)
  if (!bridge) {
    const livePreview = cleanForSpeech(
      ctx.publishedLiveRef?.current || ctx.lastStreamPreviewRef?.current || '',
    )
    const lastCommitted = cleanForSpeech(
      ctx.logRowsTextRef?.current?.at(-1) || ctx.lastEmittedTranscriptRef?.current || '',
    )
    const closingSameTurnTail =
      previewSnapshot &&
      commitCapture &&
      previewSnapshot.length > commitCapture.length + 8 &&
      previewSnapshot.toLowerCase().startsWith(commitCapture.toLowerCase())
    if (
      !closingSameTurnTail &&
      livePreview &&
      shouldMergeLivePreviewIntoFinal({
        livePreview,
        finalText: commitCapture,
        lastCommitted,
      })
    ) {
      const bridged = mergeLivePreviewIntoFinalCommit(livePreview, commitCapture)
      if (bridged.length > commitCapture.length) commitCapture = bridged
    }
  }
  const pendingBridge =
    typeof ctx.peekTurnBridgeText === 'function'
      ? cleanForSpeech(ctx.peekTurnBridgeText() || '')
      : ''
  if (pendingBridge) {
    commitCapture = mergeTurnBridgeWithInterim(pendingBridge, commitCapture)
  }

  if (bridge && typeof ctx.stashTurnBridgeText === 'function') {
    ctx.stashTurnBridgeText(bridge)
    fluTrace('ingress', 'bridge-tail-stashed', { bridge: bridge.slice(0, 120), final: capture.slice(0, 80) })
  }

  if (pendingBridge && typeof ctx.consumeTurnBridgeText === 'function') {
    ctx.consumeTurnBridgeText()
  }

  resetInterimControlBuffers(
    ctx.listenState,
    ctx.publishedLiveRef,
    ctx.lastStreamPreviewRef,
  )

  if (typeof ctx.flushTranscriptOnFinal === 'function') {
    ctx.flushTranscriptOnFinal()
  }

  const {
    openPreviewTurnRef,
    logRowsTextRef,
    lastEmittedTranscriptRef,
    lastLoggedSpeakerRef,
    tryDispatch,
    debugHotPath,
  } = ctx

  const lastCommittedForWake = logRowsTextRef?.current?.at(-1) || ''
  const wakeAnalysis = analyzeWakeTurn(commitCapture, { lastCommitted: lastCommittedForWake })

  if (!wakeAnalysis.hasInlineBoundary && tryDispatch(commitCapture, { interim: false, source: 'final' })) {
    return { handled: true, capture: commitCapture }
  }

  const rowContext = buildIngressRowContext(ctx, commitCapture)
  const forceNewRow = shouldForceNewLogRowOnCommit(
    commitCapture,
    rowContext.lastCommitted,
    rowContext.lastEmitted,
    rowContext,
  )
  const redundant = !forceNewRow && isRedundantFinal(commitCapture, rowContext)
  const result = confirmFinal(listenState, commitCapture)
  const newParagraph = resolveLogParagraphBreak('', commitCapture, result.newParagraph)
  ctx.lastStreamPreviewRef.current = ''

  const packet = processListenPacket(listenState, '', {
    interim: '',
    final: commitCapture,
    reset: true,
  })

  if (redundant) {
    resetInterimControlBuffers(listenState, ctx.publishedLiveRef, ctx.lastStreamPreviewRef)
    sealTurnBoundaryAfterFinal(ctx)
    return { handled: false, capture: commitCapture, redundant: true }
  }

  if (import.meta.env?.DEV && debugHotPath && !micPublishedParityOk(packet.published, commitCapture)) {
    ctx.fluDebugHot('mic-fragment-mismerge', {
      mic: commitCapture,
      published: packet.published,
      collapsed: collapseMisorderedMicMerge(packet.published),
    })
  }

  const published =
    commitCapture.length >= cleanForSpeech(packet.published || '').length
      ? commitCapture
      : cleanForSpeech(packet.published || commitCapture)
  const gapMs = getSegmentSilenceGapMs()
  const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
  const segmentChronoSplit =
    roomCfg.segmentChronoSplit === true &&
    (rowContext.pauseBeforeMs >= gapMs ||
      isSpeakerVoiceAbruptChange({
        ...rowContext,
        finalSpeaker: rowContext.finalSpeaker || rowContext.interimSpeaker,
      }))

  sealTurnBoundaryAfterFinal(ctx)

  const wakeSplit = applyWakeTurnCommit(ctx, published, {
    source: 'final',
    newParagraph: forceNewRow ? true : newParagraph,
    speaker: result.speaker,
    forceNewRow,
    forceNewRowOnSegment: segmentChronoSplit,
  })
  if (!wakeSplit.handled) {
    ctx.scheduleTurnCommit?.({
      capture: published,
      newParagraph: forceNewRow ? true : newParagraph,
      speaker: result.speaker,
      utterance: commitCapture,
      turnCommit: true,
      freshUtterance: packet.freshUtterance || forceNewRow,
      turnBoundary: true,
      atTurnBoundary: true,
      forceNewRow,
      forceNewRowOnSegment: segmentChronoSplit,
    })
  }
  if (typeof ctx.touchMeaningfulIngress === 'function') {
    ctx.touchMeaningfulIngress({ meaningful: true, reason: 'final-commit' })
  }

  fluTrace('ingress', 'final-commit-scheduled', {
    capture: published,
    newParagraph,
    speaker: lastLoggedSpeakerRef.current,
  })

  return { handled: false, capture: published, redundant: false }
}

function flushPublishedLaneOnly(ctx) {
  if (ctx.publishedLiveRef) ctx.publishedLiveRef.current = ''
  if (ctx.lastStreamPreviewRef) ctx.lastStreamPreviewRef.current = ''
}

function ingestInterimChunk({ interim, ctx }) {
  const {
    listenState,
    publishedLiveRef,
    openPreviewTurnRef,
    logRowsTextRef,
    lastEmittedTranscriptRef,
    tryDispatch,
    syncConversationStream,
    maybeSwitchLocale,
    debugHotPath,
  } = ctx

  maybeSwitchLocale(interim)
  if (tryDispatch(interim, { interim: true, source: 'interim' })) {
    return { handled: true }
  }

  const turnBoundary = !openPreviewTurnRef.current
  const cleanedInterim = cleanForSpeech(interim)
  const pendingBridge =
    typeof ctx.peekTurnBridgeText === 'function'
      ? cleanForSpeech(ctx.peekTurnBridgeText() || '')
      : ''

  const lastCommitted = cleanForSpeech(
    logRowsTextRef.current?.at(-1) || lastEmittedTranscriptRef.current || '',
  )

  const exactCommittedEcho =
    lastCommitted && cleanedInterim && cleanedInterim === lastCommitted

  const extendsCommitted =
    lastCommitted &&
    cleanedInterim.length > lastCommitted.length &&
    cleanedInterim.toLowerCase().startsWith(lastCommitted.toLowerCase())

  const atFreshVoice =
    turnBoundary ||
    Boolean(pendingBridge) ||
    msSinceLastCommitFromCtx(ctx) >= Number(getTranscriptPauseCfg().pauseContinuationMinMs) ||
    extendsCommitted

  // Eco ASR real = la misma fila re-emitida RÁPIDO (loop de Chrome atascado). Si la
  // misma frase vuelve tras una pausa real (>= committedEchoStreakWindowMs), es una
  // repetición genuina del usuario: se trata como voz nueva y NO se descarta ni cuenta
  // como eco (evita el loop "no escucha nada" + "transcribe a medias").
  const echoStreakWindowMs =
    Number(FLU_CONFIG.voiceIdentity?.capture?.committedEchoStreakWindowMs) || 1200
  const withinEchoWindow =
    msSinceLastCommitFromCtx(ctx) < echoStreakWindowMs

  if (
    withinEchoWindow &&
    (exactCommittedEcho ||
      (lastCommitted && !atFreshVoice && isCommittedInterimEcho(cleanedInterim, lastCommitted)))
  ) {
    clearStaleCommittedEchoFromState(listenState, lastCommitted)
    if (typeof ctx.touchMeaningfulIngress === 'function') {
      ctx.touchMeaningfulIngress({ meaningful: false, reason: 'committed-echo-settled' })
    }
    return { handled: false }
  }

  let interimForPacket = cleanedInterim
  if (lastCommitted) {
    const priorLower = lastCommitted.toLowerCase()
    const chunkLower = cleanedInterim.toLowerCase()
    if (chunkLower.startsWith(priorLower)) {
      const prefixPeel = cleanForSpeech(cleanedInterim.slice(lastCommitted.length))
      if (prefixPeel) interimForPacket = prefixPeel
    } else if (!atFreshVoice) {
      const peeled = peelCommittedPrefixFromInterim(cleanedInterim, lastCommitted)
      if (peeled) interimForPacket = peeled
    }
  }
  if (pendingBridge) {
    interimForPacket = mergeTurnBridgeWithInterim(pendingBridge, interimForPacket)
  }

  const priorRows =
    atFreshVoice
      ? []
      : buildPriorRowsForStrip(logRowsTextRef.current, lastEmittedTranscriptRef.current, {
          maxRows: FLU_CONFIG.limits.priorRowsMax,
        })

  const packet = processListenPacket(listenState, publishedLiveRef.current, {
    interim: interimForPacket,
    turnBoundary,
    msSinceLastCommit: msSinceLastCommitFromCtx(ctx),
    priorRows,
  })

  const liveTurn = cleanForSpeech(readTurnLive(listenState))
  const syncSources = [packet.published, liveTurn, interimForPacket]
  if (!interimForPacket || interimForPacket === cleanedInterim) {
    syncSources.push(cleanedInterim)
  }
  const syncCapture = syncSources.reduce(
    (best, candidate) => {
      const next = cleanForSpeech(candidate)
      if (!next) return best
      if (!best || next.length > best.length) return next
      return best
    },
    '',
  )

  if (!syncCapture) {
    return { handled: false }
  }

  if (pendingBridge && typeof ctx.consumeTurnBridgeText === 'function') {
    const bridgeWords = countWordsFromPauseCfg(cleanedInterim)
    if (bridgeWords >= 2 || cleanedInterim.length >= 12) {
      ctx.consumeTurnBridgeText()
      fluTrace('ingress', 'bridge-tail-consumed', {
        bridge: pendingBridge.slice(0, 80),
        interim: cleanedInterim.slice(0, 80),
        merged: syncCapture.slice(0, 120),
      })
    }
  }

  if (turnBoundary && typeof ctx.markAudioSegmentStart === 'function') {
    ctx.markAudioSegmentStart(nowPerf())
  }

  if (turnBoundary && typeof ctx.scheduleIdentityPreflight === 'function') {
    ctx.scheduleIdentityPreflight({ utterance: cleanedInterim || interimForPacket })
  }

  if (import.meta.env?.DEV && debugHotPath && interim.length > syncCapture.length + 24) {
    ctx.fluDebugHot('mic-stutter-collapsed', {
      rawLen: interim.length,
      publishedLen: syncCapture.length,
    })
  }

  ctx.lastStreamPreviewRef.current = packet.display || liveTurn
  if (typeof ctx.touchMeaningfulIngress === 'function') {
    ctx.touchMeaningfulIngress({
      meaningful: true,
      reason: packet.unchanged ? 'interim-steady' : 'interim-changed',
    })
  }
  syncConversationStream({
    capture: syncCapture,
    utterance: interim,
    turnBoundary,
    diarize: shouldDiarizeInterimAtTurnBoundary({ turnBoundary }),
    atTurnBoundary: turnBoundary,
    forceLiveResync: true,
  })
  return { handled: false }
}

export function processBrowserConversationIngress({ interimChunks = [], finalChunks = [], ctx }) {
  if (!ctx?.conversationActive) return { handled: false }
  const interimPreview = pickBestMicInterim(interimChunks.map((t) => cleanForSpeech(t)))
  const commitList = buildFinalCommitList(finalChunks)
  const finalPreview = commitList.at(-1) || ''

  if (ctx.skipConversationLog) {
    const blockedPhrase = finalPreview || interimPreview
    if (blockedPhrase) {
      ctx.fluDebugHot?.('ingress-browser-blocked', {
        text: blockedPhrase.slice(0, 160),
        source: 'browser',
        ingestStream: Boolean(ctx.ingestStream),
      })
    }
    if (finalPreview && ctx.tryDispatch(finalPreview, { interim: false, source: 'final' })) {
      return { handled: true, commandsOnly: true }
    }
    if (interimPreview && ctx.tryDispatch(interimPreview, { interim: true, source: 'interim' })) {
      return { handled: true, commandsOnly: true }
    }
    return { handled: false, commandsOnly: true }
  }

  if (ctx.ingestBrowser === false) {
    return { handled: false, reason: 'browser-log-disabled' }
  }

  const interim = interimPreview
  let interimAbsorbedByFinal = false

  ctx.interimAbsorbedByFinal = false
  ctx.ingressSource = 'browser'

  for (const finalChunk of commitList) {
    interimAbsorbedByFinal =
      Boolean(interim) &&
      (() => {
        const capturePreview = cleanForSpeech(finalChunk)
        return (
          capturePreview === interim ||
          capturePreview.startsWith(interim) ||
          interim.startsWith(capturePreview) ||
          utterancesRelate(capturePreview, interim) ||
          utterancesSameRevision(capturePreview, interim)
        )
      })()

    ctx.interimAbsorbedByFinal = interimAbsorbedByFinal

    const result = ingestFinalChunk({ finalChunk, ctx })
    if (result.handled) return { handled: true }
  }

  if (interim && !interimAbsorbedByFinal) {
    const interimResult = ingestInterimChunk({ interim, ctx })
    if (interimResult.handled) return { handled: true }
  }

  return { handled: false }
}

export function processStreamConversationIngress({ text = '', isFinal = false, ctx }) {
  if (!ctx?.conversationActive || !ctx.ingestStream) return { handled: false }

  const phrase = String(text ?? '').trim()
  if (!phrase) return { handled: false }

  ctx.ingressSource = 'stream'

  if (isFinal) {
    const result = ingestFinalChunk({ finalChunk: phrase, ctx })
    return { handled: result.handled, source: 'stream' }
  }

  const interimResult = ingestInterimChunk({ interim: phrase, ctx })
  return { handled: interimResult.handled, source: 'stream' }
}
