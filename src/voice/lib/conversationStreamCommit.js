/**
 * Preview y commit del stream de conversación (mic → UI/log).
 * Extraído de useFluVoiceAssistant para aislar la ruta syncConversationStream.
 */
import { cleanForSpeech, detectWakeIntroducedName, formatClock, sameRequestWindowMs } from './audioMath.js'
import { resolveInlineWakeAtCommit, isTurnCapture, requiresWakeWord } from './wakeTurnCommit.js'
import { getAsrSegmentationCfg } from './fluTranscriptMotor.js'
import { FLU_CONFIG } from './fluConfig.js'
import {
  resolveMicCommitAction,
  isDuplicateTurnCommit,
  reconcileCommitText,
} from './turnStream.js'
import {
  advancePublishedDisplay,
  detectNextSpeakerPhrase,
  getSpeakerLabel,
  readSession,
  shouldRefreshStream,
  syncSpeakerIndexFromLabel,
  utterancesSameRevision,
  wouldShrinkListenLog,
} from './activeListen.js'
import { debugHotPath, fluDebugHot } from './fluDebug.js'
import { relayLog } from '../../lib/clientLogRelay'
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
import { normalizeSpeakerLabel, isAutoSpeakerLabel, resolveRegisteredSpeakerName } from './voiceIdentity.js'
import { isSameEmissionWithinWindow } from './captureDedup.js'

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
 * @property {import('react').MutableRefObject<number>} activeTurnIdRef
 * @property {() => void} flushPcmAfterTurnCommit
 * @property {import('react').MutableRefObject<number>} lastCommitAtRef
 * @property {import('react').MutableRefObject<number>} lastOnresultAtRef
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
 * @property {import('react').MutableRefObject<{ text?: string, at?: number }>} [lastRequestRef]
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
    activeTurnIdRef,
    captureTurnAudio,
    flushPcmAfterTurnCommit,
    lastCommitAtRef,
    lastOnresultAtRef,
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
    participantSpeakerRef,
    lastRequestRef,
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

  // El ID del turno nace al ABRIR el turno (una sola vez), no al resolverlo: el
  // commit temprano, la emision que crece, la resolucion y el log crudo
  // comparten SIEMPRE el mismo id. Antes la resolucion acuñaba el id tarde (y
  // solo con diarizacion activa), asi que la fila del usuario tenia que
  // deduplicarse por POSICION: dos criterios para la misma decision.
  //
  // P8.36 - y nace SOLO para un turno DE VERDAD. El ruido de fondo (aula/casa) no
  // es un turno: si acunara id, moveria el id del turno VIVO y la resolucion (que
  // lo lee al escribir) abriria una SEGUNDA fila con la misma frase.
  const wakeRequired = requiresWakeWord(conversationActiveRef?.current)
  const esTurno = (text) => isTurnCapture(text, { wakeRequired })
  // UN ID POR PETICION (no por reloj ni por estado de la UI): la identidad del
  // turno la dicta la MISMA memoria del despacho —la ultima peticion ACEPTADA
  // (texto + instante)— con la ventana compartida (`sameRequestWindowMs`). Una
  // reentrega del ASR de la MISMA peticion no acuna id: la fila se reutiliza. Un
  // solo criterio (comparador del motor + una ventana) para la ejecucion y la fila.
  const sameRequestAsLastDispatch = (text) => {
    const req = lastRequestRef?.current || { text: '', at: 0 }
    return isSameEmissionWithinWindow(String(req.text || ''), text, {
      sinceMs: Date.now() - Number(req.at || 0),
      windowMs: sameRequestWindowMs(),
    })
  }
  const ensureTurnId = (isTurn, sameLive) => {
    if (!isTurn) return
    if (openPreviewTurnRef.current) return
    if (sameLive) return
    openPreviewTurnRef.current = true
    activeTurnIdRef.current += 1
  }

  if (!turnCommit) {
    if (wouldShrinkListenLog(capture, publishedLiveRef.current)) {
      if (import.meta.env.DEV && debugHotPath) fluDebugHot('stream-skip', { reason: 'shrink-preview' })
      return
    }
    if (capture !== publishedLiveRef.current) {
      publishedLiveRef.current = capture
      scheduleLiveTranscriptUpdate(capture)
    }
    ensureTurnId(esTurno(capture), sameRequestAsLastDispatch(capture))
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
  // El preview ya protegia el recorte por ruido ASR, pero aqui se commiteaba el
  // texto recortado: la fila quedaba mas corta que lo mostrado y se perdia la cola.
  capture = reconcileCommitText(capture, publishedLiveRef.current)

  const wakeWords = FLU_CONFIG.voiceCommands?.wakeWords || []
  const lastCommittedRow = logRowsTextRef.current.at(-1) || ''
  let fluTailAfterCommit = null
  const inlineWake = resolveInlineWakeAtCommit(capture, lastCommittedRow)
  if (inlineWake.fluTail) {
    fluTailAfterCommit = inlineWake.fluTail
  }
  // La wake SOLO es compuerta de ACCION (¿se ejecuta el comando?), NUNCA de fila:
  // la TRANSCRIPCION se registra SIEMPRE (requisito del dueno, 2026-10-06). El
  // veredicto de wake se calcula ANTES de recortar la cola flu: una captura mixta
  // ("... ok flu <orden>") SI lleva wake.
  capture = inlineWake.capture

  // MISMA locucion viva: la decide el MISMO criterio que el id (la memoria del
  // despacho + la ventana compartida). Solo esa (re-emision) se bloquea, no el habla.
  const mismaLocucionViva = sameRequestAsLastDispatch(capture)
  const ambientRowBlocked = mismaLocucionViva

  // El id del turno se acuna para todo COMMIT real: la fila lo necesita (antes
  // se acunaba solo con wake y el ruido se quedaba sin fila NI id).
  ensureTurnId(true, mismaLocucionViva)

  // §9 Sella el turno: captura UNA vez su audio (dueño: turnAudioSnapshot.js) con
  // el id YA acuñado, antes de que `finalizeTurnCommit` vacíe el buffer PCM.
  if (turnCommit && typeof captureTurnAudio === 'function') captureTurnAudio()

  // Único escritor del log: si esta MISMA frase ya se cerró y no llegó habla
  // nueva desde ese commit (doble `onend`/doble dispatch), es una re-emisión
  // del mismo turno, no una fila nueva.
  if (
    isDuplicateTurnCommit(capture, {
      lastEmitted: lastEmittedTranscriptRef?.current || '',
      lastCommitted: lastCommittedRow,
      lastResultAt: lastOnresultAtRef?.current || 0,
      lastCommitAt: lastCommitAtRef?.current || 0,
    })
  ) {
    if (import.meta.env.DEV && debugHotPath) {
      fluDebugHot('stream-skip', { reason: 'duplicate-turn-commit', capture })
    }
    return
  }

  const finalizeTurnCommit = () => {
    finalizeTurnIdentityPipeline(activeTurnIdRef.current)
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

  // §9.5 — RUTA ÚNICA de cierre de turno: finalize + aviso al participante.
  // Las dos ramas (segmentada y simple) cierran por aquí; no se invoca
  // `finalizeTurnCommit` en más de un punto.
  const finalizeAndNotify = () => {
    finalizeTurnCommit()
    fluParticipantRef.current?.onTurnCommitted?.()
  }

  // UNICA puerta de emision de la fila de conversacion de un turno: el ruido de
  // fondo no la cruza (`ambientRowBlocked`). Los dos commits que emiten (ramas
  // segmentada y simple) pasan por aqui, asi que la regla vive en un solo sitio.
  const emitTurnRow = (text, options) =>
    ambientRowBlocked ? false : emitConversationLog(text, options)

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
  const turnId = activeTurnIdRef.current
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

  const speakerResuelto = sameRevisionReplace
    ? logRowSpeakersRef.current.at(-1) ||
      lastLoggedSpeakerRef.current ||
      fallbackSpeaker
    : resolved.speakerName || fallbackSpeaker
  // P8.40: si la etiqueta resuelta es una automatica REGISTRADA en participantes, la
  // fila lleva el NOMBRE de la persona (mismo dueno del vinculo: el panel).
  const speakerName = normalizeSpeakerLabel(
    resolveRegisteredSpeakerName(speakerResuelto, participantSpeakerRef?.current || {}) ||
      speakerResuelto,
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
        const delivered = emitTurnRow(segmentText, {
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
    finalizeAndNotify()

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

  relayLog('LOG', 'RowTrace', `refresh=${refreshNeeded} blocked=${ambientRowBlocked} replace=${replaceLast} turn=${activeTurnIdRef.current} cap="${capture.slice(0, 60)}"`) // BANDERA DE DIAGNOSTICO
  let delivered = false
  if (refreshNeeded) {
    delivered = emitTurnRow(capture, {
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
  finalizeAndNotify()

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
