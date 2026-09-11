/**
 * Preview y commit del stream de conversación (mic → UI/log).
 * Extraído de useFluVoiceAssistant para aislar la ruta syncConversationStream.
 */
import { cleanForSpeech, detectWakeIntroducedName, formatClock } from './audioMath.js'
import { resolveInlineWakeAtCommit } from './wakeTurnCommit.js'
import { getAsrSegmentationCfg } from './fluTranscriptMotor.js'
import { FLU_CONFIG } from './fluConfig.js'
import { resolveMicCommitAction } from './turnStream.js'
import {
  advancePublishedDisplay,
  detectNextSpeakerPhrase,
  getSpeakerLabel,
  readSession,
  shouldRefreshStream,
  syncSpeakerIndexFromLabel,
  utterancesSameRevision,
  wouldShrinkLog,
} from './activeListen.js'
import { debugHotPath, fluDebugHot } from './fluDebug.js'
import { finalizeTurnIdentityPipeline } from './turnIdentityPipeline.js'
import { planAsrTurnSegments, segmentPlanCoversCapture } from './asrTurnSegmentation.js'
import { resolveTurnSpeakerAtCommit, applyResolvedSpeakerToSessionRefs } from './turnSpeakerCommit.js'
import {
  anchorResolvedToLastLogged,
  resolveCommitStickyFallback,
  isWeakAsrSpeakerEvidence,
} from './speakerPolicy.js'
import { markCommitPerfNow } from './audioSegmentClock.js'
import { labelToSpeakerId } from './conversationRow.js'
import { normalizeSpeakerLabel, isAutoSpeakerLabel } from './voiceIdentity.js'

/**
 * @typedef {Object} ConversationStreamCommitPayload
 * @property {string} [capture]
 * @property {boolean} [newParagraph]
 * @property {string} [speaker]
 * @property {string} [utterance]
 * @property {boolean} [freshUtterance]
 * @property {boolean} [turnCommit]
 * @property {boolean} [turnBoundary]
 * @property {boolean} [diarize]
 * @property {boolean} [atTurnBoundary]
 * @property {boolean} [forceNewRowOnSegment]
 */

/**
 * Refs, callbacks y estado compartido inyectados desde useFluVoiceAssistant.
 *
 * @typedef {Object} ConversationStreamCommitDeps
 * @property {import('react').MutableRefObject<boolean>} conversationActiveRef
 * @property {import('react').MutableRefObject<string>} publishedLiveRef
 * @property {import('react').MutableRefObject<object>} listenStateRef
 * @property {import('react').MutableRefObject<boolean>} openPreviewTurnRef
 * @property {(value: string) => void} setLiveTranscript
 * @property {(capture: string) => void} scheduleLiveTranscriptUpdate
 * @property {(phrase: string, fallbackSpeaker: string, options?: object) => void} applyConversationSpeaker
 * @property {() => void} flushPendingStreamLog
 * @property {import('react').MutableRefObject<string[]>} logRowsTextRef
 * @property {import('react').MutableRefObject<number>} turnCommitIdRef
 * @property {import('react').MutableRefObject<number>} activeTurnIdRef
 * @property {() => void} flushPcmAfterTurnCommit
 * @property {import('react').MutableRefObject<number>} lastCommitAtRef
 * @property {import('react').MutableRefObject<number>} turnAudioStartSampleRef
 * @property {import('react').MutableRefObject<number>} chunkTotalSamplesRef
 * @property {import('react').MutableRefObject<boolean>} preflightScheduledForTurnRef
 * @property {import('react').MutableRefObject<boolean>} srGapFiredForOpenLineRef
 * @property {import('react').MutableRefObject<(capture: string, action: object) => void | Promise<void>>} processConversationFluQueryRef
 * @property {import('react').MutableRefObject<string>} lastEmittedTranscriptRef
 * @property {(capture: string, options?: object) => boolean} emitConversationLog
 * @property {(options?: object) => object} createSpeakerAudioResolver
 * @property {import('react').MutableRefObject<string>} sessionPrimarySpeakerRef
 * @property {import('react').MutableRefObject<string>} lastLoggedSpeakerRef
 * @property {import('react').MutableRefObject<string[]>} logRowSpeakersRef
 * @property {import('react').MutableRefObject<object[]>} speakerClustersRef
 * @property {import('react').MutableRefObject<string>} lastSpeakerRef
 * @property {import('react').MutableRefObject<number[]|null>} lastTurnSignatureRef
 * @property {import('react').MutableRefObject<string>} lastLogLineTextRef
 * @property {(capture: string, speakerName: string, options?: object) => void} commitTurnToSessionRows
 * @property {import('react').MutableRefObject<{ onTurnCommitted?: () => void }|null>} fluParticipantRef
 */

/**
 * Sincroniza preview o commit del stream de conversación según turnCommit.
 *
 * @param {ConversationStreamCommitDeps} deps
 * @param {ConversationStreamCommitPayload} [payload]
 */
export function handleConversationStreamSync(
  deps,
  {
    capture: precomputed = '',
    newParagraph = false,
    speaker = '',
    utterance = '',
    freshUtterance = false,
    turnCommit = false,
    turnBoundary = false,
    diarize = false,
    atTurnBoundary = false,
    forceNewRowOnSegment = false,
  } = {},
) {
  const {
    conversationActiveRef,
    publishedLiveRef,
    listenStateRef,
    openPreviewTurnRef,
    setLiveTranscript,
    scheduleLiveTranscriptUpdate,
    applyConversationSpeaker,
    flushPendingStreamLog,
    logRowsTextRef,
    turnCommitIdRef,
    activeTurnIdRef,
    flushPcmAfterTurnCommit,
    lastCommitAtRef,
    turnAudioStartSampleRef,
    chunkTotalSamplesRef,
    preflightScheduledForTurnRef,
    srGapFiredForOpenLineRef,
    processConversationFluQueryRef,
    lastEmittedTranscriptRef,
    emitConversationLog,
    createSpeakerAudioResolver,
    sessionPrimarySpeakerRef,
    lastLoggedSpeakerRef,
    logRowSpeakersRef,
    speakerClustersRef,
    setSpeakerClusters,
    lastSpeakerRef,
    lastTurnSignatureRef,
    lastLogLineTextRef,
    commitTurnToSessionRows,
    fluParticipantRef,
  } = deps

  if (!conversationActiveRef?.current) return

  let capture =
    precomputed ||
    advancePublishedDisplay(publishedLiveRef.current, listenStateRef.current, {
      reset: newParagraph,
    })
  if (!capture) {
    if (newParagraph || freshUtterance) {
      publishedLiveRef.current = ''
      setLiveTranscript('')
      openPreviewTurnRef.current = false
    }
    if (import.meta.env.DEV && debugHotPath) fluDebugHot('stream-skip', { reason: 'empty-capture' })
    return
  }

  if (!turnCommit) {
    if (wouldShrinkLog(capture, publishedLiveRef.current)) {
      if (import.meta.env.DEV && debugHotPath) fluDebugHot('stream-skip', { reason: 'shrink-preview' })
      return
    }
    if (capture !== publishedLiveRef.current) {
      publishedLiveRef.current = capture
      scheduleLiveTranscriptUpdate(capture)
    }
    openPreviewTurnRef.current = true
    if (turnBoundary || atTurnBoundary) {
      const fallbackSpeaker = speaker || getSpeakerLabel(listenStateRef.current)
      const phrase = cleanForSpeech(utterance) || capture
      const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
      const forceWakeDiarize = Boolean(detectWakeIntroducedName(phrase, wakeWords))
      applyConversationSpeaker(phrase, fallbackSpeaker, {
        force: forceWakeDiarize || diarize,
        atTurnBoundary: true,
        allowNewCluster: false,
      })
    }
    if (import.meta.env.DEV && debugHotPath) {
      fluDebugHot('stream-preview', { capture, turnBoundary, session: readSession(listenStateRef.current) })
    }
    return
  }

  flushPendingStreamLog()

  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const lastCommittedRow = logRowsTextRef.current.at(-1) || ''
  let fluTailAfterCommit = null
  const inlineWake = resolveInlineWakeAtCommit(capture, lastCommittedRow)
  if (inlineWake.fluTail) {
    fluTailAfterCommit = inlineWake.fluTail
  }
  capture = inlineWake.capture

  const finalizeTurnCommit = () => {
    turnCommitIdRef.current += 1
    const turnId = activeTurnIdRef.current || turnCommitIdRef.current
    finalizeTurnIdentityPipeline(turnId)
    flushPcmAfterTurnCommit()
    lastCommitAtRef.current = Date.now()
    turnAudioStartSampleRef.current = chunkTotalSamplesRef.current
    openPreviewTurnRef.current = false
    publishedLiveRef.current = ''
    setLiveTranscript('')
    listenStateRef.current.openLine = ''
    listenStateRef.current.pendingInterim = ''
    preflightScheduledForTurnRef.current = false
    srGapFiredForOpenLineRef.current = false
    if (fluTailAfterCommit?.action?.kind === 'flu' && fluTailAfterCommit.action.question) {
      void processConversationFluQueryRef.current(
        fluTailAfterCommit.fullCapture,
        fluTailAfterCommit.action,
      )
    }
  }

  const {
    replaceLast,
    forcedReplacePrefix,
    effectiveNewParagraph,
  } = resolveMicCommitAction(
    {
      published: publishedLiveRef.current,
      preview: publishedLiveRef.current,
      openPreview: openPreviewTurnRef.current,
      lastEmitted: lastEmittedTranscriptRef.current,
    },
    {
      capture,
      newParagraph,
      turnBoundary,
      lastCommitted: lastCommittedRow,
    },
  )
  if (import.meta.env.DEV && debugHotPath && forcedReplacePrefix) {
    fluDebugHot('log-asr-revision-blocked', {
      prior: lastCommittedRow || lastEmittedTranscriptRef.current,
      capture,
    })
  }
  if (effectiveNewParagraph || turnBoundary) {
    openPreviewTurnRef.current = false
  }

  const refreshNeeded =
    !replaceLast || shouldRefreshStream(lastEmittedTranscriptRef.current, capture)

  const fallbackSpeaker = speaker || getSpeakerLabel(listenStateRef.current)
  const phrase = cleanForSpeech(utterance) || capture
  const forceWakeDiarize = Boolean(detectWakeIntroducedName(phrase, wakeWords))
  const sameRevisionReplace =
    replaceLast &&
    lastCommittedRow &&
    utterancesSameRevision(lastCommittedRow, capture)

  markCommitPerfNow()
  const turnId = activeTurnIdRef.current || turnCommitIdRef.current + 1
  const preflight = finalizeTurnIdentityPipeline(turnId, () =>
    createSpeakerAudioResolver({
      atTurnBoundary: true,
      allowNewCluster: true,
      utterance: phrase,
    }),
  )

  const stickyFallback = resolveCommitStickyFallback({
    sessionPrimary: sessionPrimarySpeakerRef.current,
    lastLogged: lastLoggedSpeakerRef.current,
    fallback: fallbackSpeaker,
    phrase,
  })

  const explicitNext = detectNextSpeakerPhrase(phrase)
  let resolved = resolveTurnSpeakerAtCommit({
    phrase,
    wakeWords,
    stickyFallback,
    sessionPrimary: sessionPrimarySpeakerRef.current,
    lastLogged: lastLoggedSpeakerRef.current,
    sameRevisionReplace,
    preflight,
    knownSpeakerLabels: logRowSpeakersRef.current,
    clusters: speakerClustersRef.current,
    forceNewRowOnSegment: Boolean(forceNewRowOnSegment || turnBoundary || atTurnBoundary),
  })

  const soloSession =
    (speakerClustersRef.current || []).filter(
      (c) => isAutoSpeakerLabel(c?.label) && Array.isArray(c?.signature) && c.signature.length,
    ).length === 1

  if (preflight?.ready && !sameRevisionReplace && !explicitNext && !forceWakeDiarize) {
    const anchored = anchorResolvedToLastLogged(resolved.speakerName, stickyFallback, {
      weakAsrEvidence: isWeakAsrSpeakerEvidence({
        phrase,
        lastCommitted: lastCommittedRow,
      }),
      sessionPrimary: sessionPrimarySpeakerRef.current,
      phrase,
      preflightReady: preflight.ready,
      preflightSpeaker: preflight.speakerName,
      soloSession,
    })
    if (anchored && anchored !== resolved.speakerName) {
      resolved = {
        ...resolved,
        speakerName: anchored,
        speakerId: labelToSpeakerId(anchored),
      }
    }
  }

  const speakerName = normalizeSpeakerLabel(
    sameRevisionReplace
      ? logRowSpeakersRef.current.at(-1) ||
          lastLoggedSpeakerRef.current ||
          fallbackSpeaker
      : resolved.speakerName || fallbackSpeaker,
  )

  let segmentPlan =
    !sameRevisionReplace && turnCommit
      ? planAsrTurnSegments({
          phrase: capture,
          priorTexts: logRowsTextRef.current,
          priorSpeakers: logRowSpeakersRef.current,
          preflight,
          fallbackSpeaker: speakerName,
        })
      : []

  const minCoverage = Number(getAsrSegmentationCfg().minCoverageRatio)
  if (
    segmentPlan.length >= 2 &&
    !segmentPlanCoversCapture(segmentPlan, capture, minCoverage)
  ) {
    segmentPlan = []
  }

  if (segmentPlan.length >= 1) {
    let replaceNext = replaceLast
    for (let index = 0; index < segmentPlan.length; index += 1) {
      const segment = segmentPlan[index]
      const segmentText = cleanForSpeech(segment.text)
      if (!segmentText) continue

      const segmentSpeaker = normalizeSpeakerLabel(segment.speaker || speakerName)
      applyResolvedSpeakerToSessionRefs(
        { ...resolved, speakerName: segmentSpeaker },
        {
          lastSpeakerRef,
          lastLoggedSpeakerRef,
          sessionPrimarySpeakerRef,
          speakerClustersRef,
          setSpeakerClusters,
        },
      )
      if (resolved.signatureVector?.length) {
        lastTurnSignatureRef.current = resolved.signatureVector
      }
      syncSpeakerIndexFromLabel(listenStateRef.current, segmentSpeaker)
      lastLogLineTextRef.current = segmentText
      lastLoggedSpeakerRef.current = segmentSpeaker
      lastSpeakerRef.current = segmentSpeaker

      const segmentReplace = replaceNext
      if (refreshNeeded) {
        const delivered = emitConversationLog(segmentText, {
          speakerName: segmentSpeaker,
          fallbackSpeaker: segmentSpeaker,
          currentClock: formatClock(),
          replaceLastRawLog: segmentReplace,
          streamUpdate: false,
          turnCommit: true,
        })
        if (delivered) {
          lastEmittedTranscriptRef.current = segmentText
        }
      }
      commitTurnToSessionRows(segmentText, segmentSpeaker, { replaceLast: segmentReplace })
      if (!refreshNeeded) {
        lastEmittedTranscriptRef.current = segmentText
      }
      replaceNext = false
    }

    lastEmittedTranscriptRef.current = capture
    finalizeTurnCommit()
    fluParticipantRef.current?.onTurnCommitted?.()

    if (import.meta.env.DEV && debugHotPath) {
      fluDebugHot('stream-commit-segmented', {
        segments: segmentPlan.length,
        capture,
        session: readSession(listenStateRef.current),
      })
    }
    return
  }

  applyResolvedSpeakerToSessionRefs(
    { ...resolved, speakerName },
    {
      lastSpeakerRef,
      lastLoggedSpeakerRef,
      sessionPrimarySpeakerRef,
      speakerClustersRef,
      setSpeakerClusters,
    },
  )
  if (resolved.signatureVector?.length) {
    lastTurnSignatureRef.current = resolved.signatureVector
  }
  syncSpeakerIndexFromLabel(listenStateRef.current, speakerName)
  lastLogLineTextRef.current = capture
  lastLoggedSpeakerRef.current = speakerName
  lastSpeakerRef.current = speakerName

  let delivered = false
  if (refreshNeeded) {
    delivered = emitConversationLog(capture, {
      speakerName,
      fallbackSpeaker: speakerName,
      currentClock: formatClock(),
      replaceLastRawLog: replaceLast,
      streamUpdate: false,
      turnCommit: true,
    })
    if (delivered) {
      lastEmittedTranscriptRef.current = capture
    }
  }
  commitTurnToSessionRows(capture, speakerName, { replaceLast })
  if (!delivered) {
    lastEmittedTranscriptRef.current = capture
  }
  finalizeTurnCommit()
  fluParticipantRef.current?.onTurnCommitted?.()

  if (import.meta.env.DEV && debugHotPath) {
    fluDebugHot('stream-commit', {
      capture,
      newParagraph,
      replaceLast,
      freshUtterance,
      utterance,
      session: readSession(listenStateRef.current),
    })
  }
}
