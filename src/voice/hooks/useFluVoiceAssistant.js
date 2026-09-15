import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  computeAudioSignature,
  cleanForSpeech,
  decideVoiceTurnDispatch,
  detectIntroducedName,
  detectListeningControl,
  detectRole,
  detectTranscriptLanguage,
  extractTheme,
  formatClock,
  extractFluVoiceCommand,
  compareAudioSignatures,
  getRecognitionRetryDelay,
  getRecognitionErrorMessage,
  isRecoverableRecognitionError,
  isMinuteGenerationRequest,
  isMinuteSaveRequest,
  isMinuteKnowledgeRequest,
  isPlausiblePersonName,
  pickRichestVoiceCommandCapture,
  deriveQueryFromRow,
} from '../lib/audioMath'
import { isNavSettlePending } from '../lib/navSettleFlag'
import { getFluTimingCfg, getProfileMatchCfg } from '../lib/fluTranscriptMotor.js'
import { analyzeWakeTurn } from '../lib/wakeTurnCommit.js'
import { handleConversationStreamSync } from '../lib/conversationStreamCommit.js'
import { listVoiceProfiles, loadSessionState, saveSessionState, saveVoiceProfile } from '../lib/fluStorage'
import { requestFluContract } from '../lib/gemini'
import {
  isCommandAuthorized,
  resolveDeterministicCommand,
  resolveDeterministicSkipGeminiContract,
  resolveStatefulDomains,
  resolveVoiceCommand,
} from '../lib/deterministicArbiter'
import { relayLog } from '../../lib/clientLogRelay'
import { useIntegrationStore } from '../../store/integrationStore'
import { fluAsyncErrorHandler } from '../lib/fluAsyncError.js'
import { isSelfKnowledgeRequest } from '../../core/selfKnowledge/selfKnowledge'
import {
  FLU_CONFIG,
  getActiveListenConfig,
  getConversationRestartConfig,
  getConversationConfig,
  isSessionResetCommand,
} from '../lib/fluConfig'
import {
  getCommandSpeech,
  planVoiceCommandDispatch,
  resolveNavigationCommand,
} from '../lib/voiceCommands'
import {
  flattenChunksTail,
  flattenChunksWindow,
  isAutoSpeakerLabel,
  nextAvailableSpeakerLabel,
  normalizeSpeakerLabel,
  pruneGhostSpeakerClusters,
  trimAudioChunkBuffer,
} from '../lib/voiceIdentity'
import {
  getConversationMinVoicedSamples,
  getConversationSpeakerTailMs,
  getDiarizeIntervalMs,
  getLastTurnSignatureContinuityDistance,
  getMaxSilenceWindowsForHold,
  getVoiceDetectionThreshold,
} from '../lib/micCapture.js'
import {
  computeSpillAfterLog,
  isDuplicateLogPhrase,
  listSessionSpeakers,
  readCommandSnapshot,
  readTurnCapture,
} from '../lib/conversationSession'
import {
  advanceSpeaker,
  createActiveListenState,
  detectNextSpeakerPhrase,
  pickBestMicInterim,
  nextSpeakerLabel,
  readCommandText,
  readStreamDisplay,
  archiveCommittedTurn,
  getSpeakerLabel,
  resetActiveListenState,
  getRecognitionLanguage,
  isBilingualListenMode,
  resolveRecognitionLocale,
  resolveConversationSpeaker as resolveConversationSpeakerLabel,
  sealPendingInterim,
  syncSpeakerIndexFromLabel,
} from '../lib/activeListen.js'
import {
  acquireSpeechRecognition,
  startSpeechRecognition,
  stopSpeechRecognition,
} from '../lib/speechRecognitionLocal'
import { fluEvent, logMicRaw, getListenLogRing, clearListenLogRing } from '../lib/listenLog'
import {
  debugHotPath,
  fluDebugHot,
  getFluDebugApi,
} from '../lib/fluDebug'
import {
  appendSpillText,
  applyRecognitionResultWithBoundary,
  createTurnState,
  getTranscriptDelta,
  monotonicDisplay,
  normalizeTranscriptText,
  resetTurnState,
  waitForCaptureSettle,
} from '../lib/turnTranscript'
import { wireMicCapturePipeline } from '../lib/micCaptureBridge.js'
import { createConversationIngressRuntime } from '../lib/conversationIngressBridge.js'
import { formatGeminiUserMessage, buildGeminiDiagnosticsFromError } from '../lib/geminiDiagnostics.js'
import { convertSimEventsToMicBursts } from '../lib/micEventProducer.js'
import { collectRecognitionResultChunks } from '../lib/transcriptIngress.js'
import {
  flushTranscriptStateOnFinal,
  flushPcmStateAfterCommit,
} from '../lib/recognitionBufferFlush.js'
import { startContinuousIdentityPipeline, stopAllContinuousIdentityPipelines } from '../lib/turnIdentityPipeline.js'
import {
  createTurnSpeakerAudioResolver,
  peekTurnSpeakerPreflight,
} from '../lib/turnSpeakerPreflight.js'
import {
  shouldSkipPreviewDiarize,
} from '../lib/speakerPolicy.js'
import { getTranscriptPauseCfg, countSpeechWords } from '../lib/fluTranscriptPause.js'
// Ruta única: useFluParticipant vive solo en src/hooks/useFluParticipant.ts.
// El motor de voz la importa aquí solo como fallback defensivo; en producción
// App.tsx inyecta su instancia vía participantRef (mismo módulo).
import { useFluParticipant } from '../../hooks/useFluParticipant'
import { isSpeechSynthesisSpeaking, isSpeechBusy, isFluSpeaking, waitForSpeechIdle } from '../lib/fluSpeech.js'
import {
  FLU_DIALOGUE_SPEAKER,
  deriveDialogueHistory,
  deriveUserRowSpeakers,
  deriveUserRowTexts,
  getDialogueContextSlice,
  isFluSpeaker,
} from '../lib/conversationDialogue.js'

const CONTEXT_HISTORY_LIMIT = FLU_CONFIG.limits.contextHistoryMax

function flattenChunks(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Float32Array(length)
  let offset = 0
  chunks.forEach((chunk) => {
    result.set(chunk, offset)
    offset += chunk.length
  })
  return result
}

function segmentAudio(samples, sampleRate, threshold) {
  const voiceThreshold = threshold ?? getVoiceDetectionThreshold()
  if (!samples.length) return []

  const windowSize = Math.max(1024, Math.floor(sampleRate * 0.04))
  const hopSize = Math.max(512, Math.floor(sampleRate * 0.02))
  const voicedSegments = []
  const maxSilenceWindows = getMaxSilenceWindowsForHold(sampleRate)

  let currentStart = null
  let silenceWindows = 0

  for (let index = 0; index + windowSize <= samples.length; index += hopSize) {
    let sumSquares = 0
    for (let sampleIndex = index; sampleIndex < index + windowSize; sampleIndex += 1) {
      const value = samples[sampleIndex]
      sumSquares += value * value
    }

    const rms = Math.sqrt(sumSquares / windowSize)
    const isVoiced = rms >= voiceThreshold

    if (isVoiced && currentStart === null) {
      currentStart = index
      silenceWindows = 0
    }

    if (currentStart !== null) {
      if (isVoiced) {
        silenceWindows = 0
      } else {
        silenceWindows += 1
      }

      if (silenceWindows >= maxSilenceWindows) {
        const end = index + windowSize
        if (end > currentStart + windowSize) {
          voicedSegments.push(samples.slice(currentStart, end))
        }
        currentStart = null
        silenceWindows = 0
      }
    }
  }

  if (currentStart !== null && currentStart < samples.length) {
    voicedSegments.push(samples.slice(currentStart))
  }

  if (!voicedSegments.length) {
    voicedSegments.push(samples)
  }

  return voicedSegments
}

async function matchSegmentNames(segments, sampleRate, speakerClusters = [], cachedProfiles = []) {
  if (!segments.length) return 'Hablante 1'

  const profiles = Array.isArray(cachedProfiles) ? cachedProfiles : []

  const segmentResults = await Promise.all(
    segments.map((segment) => computeAudioSignature(segment, sampleRate)),
  )
  const segmentSignatures = segmentResults.map((result, i) => ({
    vector: result.vector,
    length: segments[i].length,
  }))
  const signature = segmentSignatures.reduce(
    (acc, current) => {
      const weight = Math.max(1, current.length)
      current.vector.forEach((value, index) => {
        acc.vector[index] = (acc.vector[index] || 0) + value * weight
      })
      acc.totalWeight += weight
      return acc
    },
    { vector: [], totalWeight: 0 },
  )
  const signatureVector =
    signature.totalWeight > 0
      ? signature.vector.map((value) => value / signature.totalWeight)
      : [0, 0, 0, 0]

  let bestMatch = null
  let bestSimilarity = -1

  profiles.forEach((profile) => {
    if (!Array.isArray(profile.signature)) return
    const similarity = compareAudioSignatures(signatureVector, profile.signature)
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      bestMatch = profile
    }
  })

  const profileMatch = getProfileMatchCfg()
  // compareAudioSignatures devuelve SIMILITUD (1 = misma voz); la config la
  // expresa como "máxima distancia" → umbral de similitud = 1 - distancia.
  const registeredMinSimilarity = 1 - Number(profileMatch.registeredProfileMaxDistance ?? 0.12)
  if (bestMatch && bestSimilarity >= registeredMinSimilarity && isPlausiblePersonName(bestMatch.label || '')) {
    return bestMatch.label || 'Hablante 1'
  }

  let clusterMatch = null
  let clusterSimilarity = -1
  speakerClusters.forEach((cluster) => {
    if (!Array.isArray(cluster?.signature)) return
    const similarity = compareAudioSignatures(signatureVector, cluster.signature)
    if (similarity > clusterSimilarity) {
      clusterSimilarity = similarity
      clusterMatch = cluster
    }
  })

  const MATCH_THRESHOLD = 1 - Number(profileMatch.clusterMatchMaxDistance ?? 0.09)
  const blendWeight = profileMatch.clusterSignatureBlendWeight

  if (clusterMatch && clusterSimilarity >= MATCH_THRESHOLD) {
    const label = clusterMatch.label || 'Hablante 1'
    if (isPlausiblePersonName(label) || /^Hablante\s+\d+$/i.test(label)) {
      clusterMatch.signature = clusterMatch.signature.map((value, index) => {
        const previous = Number(value || 0)
        const next = Number(signatureVector[index] || 0)
        return previous * (1 - blendWeight) + next * blendWeight
      })
      return label
    }
  }

  const label = nextAvailableSpeakerLabel(speakerClusters)
  speakerClusters.push({ label, signature: signatureVector })
  return label
}

async function stopMediaStream(stream) {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

function createRecognition(language, activeLocale = '') {
  // §9 Motor de escucha: Chrome SpeechRecognition (Google, online) — en vivo y
  // preciso. El resto del pipeline (ingress/commit/query/display/diarización)
  // sigue unificado y es agnóstico al motor.
  return acquireSpeechRecognition(language, activeLocale)
}

function deriveSession(transcript, currentRole = '', language = 'es') {
  const role = detectRole(transcript, language) || currentRole || FLU_CONFIG.sessionDefaults.role
  const theme = extractTheme(transcript, role, FLU_CONFIG.voiceCommands.wakeWords)
  return {
    role,
    theme,
  }
}

export function useFluVoiceAssistant({
  apiKey,
  onContractResolved,
  language = 'es',
  conversationActiveRef,
  knowledgeBase = '',
  getMinuteKnowledgeBase = () => '',
  getDailyAgenda = () => '',
  getSelfManifesto = () => '',
  getDiaryContext = () => '',
  getNotesContext = () => '',
  getHorarioContext = () => '',
  getResultadosContext = () => '',
  resolveMinuteLookup = () => ({ mode: 'gemini' }),
  participantRef,
  activeParticipantName = '',
  wakeWords = '',
}) {
  const [status, setStatus] = useState('idle')
  const [phase, setPhase] = useState('CONFIGURACION')
  const [error, setError] = useState('')
  const [activeKnowledgeBase, setActiveKnowledgeBase] = useState('general')
  const [liveTranscript, setLiveTranscript] = useState('')
  /**
   * §9 FUENTE ÚNICA de la frase visible: `lastTranscript` vive en el store
   * (`lastCommittedTranscript`). El hook ya no mantiene un estado local espejo.
   */
  const lastTranscript = useIntegrationStore((state) => state.lastCommittedTranscript)
  const commitVisibleTranscript = useCallback((text) => {
    useIntegrationStore.getState().setLastCommittedTranscript(typeof text === 'string' ? text : '')
  }, [])
  /**
   * §9: ÚNICO punto de commit de la locución del turno. Limpia UNA vez y
   * devuelve la frase canónica para que la fila de conversación use EXACTAMENTE
   * el mismo texto (display === fila). Ninguna rama llama ya
   * `commitVisibleTranscript` directo (salvo el reset).
   */
  const commitTurnPhrase = useCallback((text) => {
    const canonical = cleanForSpeech(typeof text === 'string' ? text : '')
    if (canonical) commitVisibleTranscript(canonical)
    return canonical
  }, [commitVisibleTranscript])
  // Limpieza del estado del turno tras resolver (se asigna cuando
  // `clearTurnBuffers` existe). Evita que la locución ya ejecutada quede en el
  // buffer/spill y se vuelva a procesar (ciclo de comandos repetidos).
  const clearTurnAfterResolveRef = useRef(() => {})
  /**
   * §9: par ÚNICO `commit + resolución` del turno. TODAS las ramas cierran por
   * aquí, de modo que el display (commit) y la fila (`transcript`) no puedan
   * divergir por construcción: la fila es SIEMPRE el valor commiteado.
   * Las ramas solo aportan su `contract` y los campos del payload.
   */
  const commitAndResolveTurn = useCallback(
    async ({ capture, contract, commitOnly = false, ...payload } = {}) => {
      const canonicalPhrase = commitTurnPhrase(capture)
      // `commitOnly`: commit temprano + fila del USUARIO inmediata (sin esperar a
      // la IA). La resolución posterior re-commitea el MISMO valor (idempotente)
      // y deduplica la fila, así no hay doble fuente.
      if (commitOnly) {
        await onContractResolved?.({
          contract: null,
          userCommitOnly: true,
          transcript: canonicalPhrase,
          speakerName: payload.speakerName,
          phase: payload.phase,
        })
        return canonicalPhrase
      }
      const result = await onContractResolved?.({ contract, ...payload, transcript: canonicalPhrase })
      // Turno cerrado: limpiar buffer/spill para que la locución ya ejecutada no
      // se reprocese (ciclo de comandos/ambient que repetían la misma orden).
      clearTurnAfterResolveRef.current?.()
      return result
    },
    [commitTurnPhrase, onContractResolved],
  )
  const [lastContract, setLastContract] = useState(null)
  const [lastDiagnostics, setLastDiagnostics] = useState(null)
  const [lastErrorEvent, setLastErrorEvent] = useState(null)
  const [session, setSession] = useState({
    role: FLU_CONFIG.sessionDefaults.role,
    theme: FLU_CONFIG.sessionDefaults.theme,
  })
  const [isSupported, setIsSupported] = useState(true)
  const [listeningAck, setListeningAck] = useState('')

  // Wake words configurables (Ajustes) — fuente única para toda la resolución
  // de comandos. Nunca hardcodeadas aquí: si Ajustes no provee ninguna, se cae
  // al default de FLU_CONFIG.voiceCommands.wakeWords.
  const configuredWakeWords = Array.isArray(wakeWords)
    ? wakeWords.filter(Boolean)
    : String(wakeWords || '')
        .split('\n')
        .map((word) => word.trim())
        .filter(Boolean)
  const resolvedWakeWords = configuredWakeWords.length
    ? configuredWakeWords
    : FLU_CONFIG.voiceCommands.wakeWords

  const getParticipantLogSnapshotRef = useRef(() => ({ texts: [], speakers: [] }))

  const reportGeminiFailure = useCallback(
    (failure, { phase = 'SESION_ACTIVA', transcript = '' } = {}) => {
      const message = formatGeminiUserMessage(failure, language, { fallback: true })
      setError(message)
      setLastDiagnostics(buildGeminiDiagnosticsFromError(failure))
      setLastErrorEvent({
        timestamp: formatClock(),
        phase,
        transcript: cleanForSpeech(transcript),
        error: message,
        code: failure?.code || '',
        detail: failure?.detail || failure?.bodyPreview || '',
      })
    },
    [language],
  )

  const audioContextRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const sourceRef = useRef(null)
  const processorRef = useRef(null)
  const analyserRef = useRef(null)
  const zeroGainRef = useRef(null)
  const recognitionRef = useRef(null)
  const recognitionActiveRef = useRef(false)
  const recognitionEndResolverRef = useRef(null)
  const isStoppingRef = useRef(false)
  const isListeningRef = useRef(false)
  const recentMemoryRef = useRef('')
  const isProcessingRef = useRef(false)
  // Última captura procesada (dedup anti-repetición): evita que la MISMA frase
  // se procese dos veces (p. ej. cierre + auto-proceso) y cree la acción doble.
  const lastProcessedCaptureRef = useRef({ text: '', at: 0 })
  const autoProcessTimerRef = useRef(null)
  const recognitionRetryTimerRef = useRef(null)
  const recognitionRetryCountRef = useRef(0)
  const turnRef = useRef(createTurnState())
  const publishedLiveRef = useRef('')
  const pendingSpillRef = useRef('')
  const lastLoggedCaptureRef = useRef('')
  const finalizeGraceUsedRef = useRef(false)
  const sampleRateRef = useRef(48000)
  const chunksRef = useRef([])
  const sessionLoadedRef = useRef(false)
  // §9 ÚNICA FUENTE DE VERDAD: vistas de SOLO LECTURA derivadas del store
  // `conversationHistory` (el motor no tiene almacén propio). No exponen setter:
  // cualquier escritura (`x.current = ...`) lanza error en vez de descartarse.
  const dialogueView = useMemo(
    () => ({
      get current() {
        return deriveDialogueHistory(useIntegrationStore.getState().conversationHistory)
      },
    }),
    [],
  )
  const speakerClustersRef = useRef([])
  /**
   * §9 ÚNICO punto de escritura de los clusters de hablante.
   * El COMMIT es autoritativo; el segmento solo propone (no persiste).
   */
  const setSpeakerClusters = useCallback((next) => {
    speakerClustersRef.current =
      typeof next === 'function' ? next(speakerClustersRef.current) : next
  }, [])

  /**
   * §9 ÚNICO punto de cálculo de la firma de voz por turno.
   * Cachea por snapshot (WeakMap): el MISMO audio no se re-embebe dos veces,
   * y todas las ramas pasan por aquí. Devuelve el mismo shape que
   * `computeAudioSignature` (`{ vector, stats }`).
   */
  const turnSignatureCacheRef = useRef(new WeakMap())
  const computeTurnSignature = useCallback((snapshot, sampleRate) => {
    if (!snapshot?.length) {
      return Promise.resolve({ vector: [], stats: { empty: true, dim: 0 } })
    }
    const cache = turnSignatureCacheRef.current
    const cached = cache.get(snapshot)
    if (cached) return cached
    const promise = computeAudioSignature(snapshot, sampleRate)
    cache.set(snapshot, promise)
    return promise
  }, [])
  const knowledgeBaseRef = useRef(knowledgeBase)
  const getMinuteKnowledgeBaseRef = useRef(getMinuteKnowledgeBase)
  const getDailyAgendaRef = useRef(getDailyAgenda)
  const getSelfManifestoRef = useRef(getSelfManifesto)
  const getDiaryContextRef = useRef(getDiaryContext)
  const getNotesContextRef = useRef(getNotesContext)
  const getHorarioContextRef = useRef(getHorarioContext)
  const getResultadosContextRef = useRef(getResultadosContext)
  const resolveMinuteLookupRef = useRef(resolveMinuteLookup)
  const voiceProfilesRef = useRef([])
  const chunkTotalSamplesRef = useRef(0)
  /** Muestras acumuladas al abrir turno (diarización alineada al turno). */
  const turnAudioStartSampleRef = useRef(0)
  const lastSpeakerRef = useRef('')
  const lastLoggedSpeakerRef = useRef('')
  const lastTurnSignatureRef = useRef(null)
  const isCommittingRef = useRef(false)
  const commitBaselineRef = useRef('')
  const liveDebounceTimerRef = useRef(null)
  const livePendingCaptureRef = useRef('')
  const liveRafRef = useRef(null)
  const pendingStreamLogRef = useRef(null)
  const streamLogTimerRef = useRef(null)
  const lastDiarizeUtteranceRef = useRef('')
  const lastEmittedTranscriptRef = useRef('')
  /** Hay preview interino abierto (sin commit al log aún). */
  const openPreviewTurnRef = useRef(false)
  const userRowsTextView = useMemo(
    () => ({
      get current() {
        return deriveUserRowTexts(useIntegrationStore.getState().conversationHistory)
      },
    }),
    [],
  )
  const userSpeakersView = useMemo(
    () => ({
      get current() {
        return deriveUserRowSpeakers(useIntegrationStore.getState().conversationHistory)
      },
    }),
    [],
  )

  /** Evita re-sync si Chrome repite el mismo interino. */
  const lastStreamPreviewRef = useRef('')
  const listenStateRef = useRef(createActiveListenState())
  const lastLogLineTextRef = useRef('')
  const lastLogLineAtRef = useRef(0)
  const recognitionRestartPendingRef = useRef(false)
  const consecutiveEndsWithoutResultRef = useRef(0)
  const stopListeningRef = useRef(async () => { })
  const startListeningRef = useRef(async () => { })
  const flushPassiveConversationRef = useRef(async () => { })
  const dispatchPassiveVoiceCommandRef = useRef(async () => { })
  const processConversationFluQueryRef = useRef(async () => { })
  const tryDispatchConversationActionRef = useRef(() => false)
  const lastConversationActionRef = useRef({ signature: '', at: 0 })
  const rebuildRecognitionRef = useRef(() => false)
  const maybeSwitchRecognitionLocaleRef = useRef(() => { })
  const recognitionLocaleRef = useRef(getRecognitionLanguage(language))
  const localeSwitchDetectRef = useRef('')
  const localeSwitchCountRef = useRef(0)
  const lastRecognitionEndAtRef = useRef(0)
  const lastOnresultAtRef = useRef(0)
  const lastMeaningfulIngressAtRef = useRef(0)
  const lastStallRebuildAtRef = useRef(0)
  const lastSpeakerDiarizeAtRef = useRef(0)
  const lastLogEmitAtRef = useRef(0)
  const passiveAudioDelayTimerRef = useRef(null)
  const _audioProcessSkipRef = useRef(0)
  const _lastDiarizeAtRef = useRef(0)
  const listeningAckTimerRef = useRef(null)
  const _lastTurnHadFinalRef = useRef(false)
  const _allowStableCommitRef = useRef(false)
  const turnCommitIdRef = useRef(0)
  const activeTurnIdRef = useRef(0)
  const lastCommitAtRef = useRef(0)
  const preflightScheduledForTurnRef = useRef(false)
  const turnBridgeTextRef = useRef('')
  const sessionPrimarySpeakerRef = useRef('')
  const turnSegmentStartedAtRef = useRef(0)
  const ingressEchoStreakRef = useRef(0)
  const lastEchoAtRef = useRef(0)
  const srGapFiredForOpenLineRef = useRef(false)
  const ingressBindingsRef = useRef({})
  const ingressRuntimeRef = useRef(null)

  // ---- Fase E: vincular la voz del participante activo (Juan/Luis) a su nombre ----
  // Si hay un participante real con nombre propio activo, se siembra como sessionPrimary
  // para que la diarización etiquete sus turnos con su nombre (no «Hablante N»).
  // Config-gated (roomCapture.seedSessionPrimaryFromActiveParticipant) y solo con
  // participante real (no anónimo/default) para no introducir regresiones.
  const seedSessionPrimaryFromActiveName = useCallback(() => {
    const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
    const roomCfg = captureCfg.roomCapture || {}
    if (roomCfg.seedSessionPrimaryFromActiveParticipant !== true) return
    const name = String(activeParticipantName || '').trim()
    if (!name) return
    // Solo nombres propios reales (no «Hablante N» ni anónimo genérico).
    if (isAutoSpeakerLabel(name)) return
    const skipDefaults = FLU_CONFIG.multiuser?.skipDefaults || {}
    const anonymousName = String(skipDefaults.anonymousName || 'Anónimo').trim().toLowerCase()
    if (name.toLowerCase() === anonymousName) return
    sessionPrimarySpeakerRef.current = name
  }, [activeParticipantName])

  useEffect(() => {
    seedSessionPrimaryFromActiveName()
  }, [seedSessionPrimaryFromActiveName])

  if (!ingressRuntimeRef.current) {
    ingressRuntimeRef.current = createConversationIngressRuntime({
      getBindings: () => ingressBindingsRef.current,
      onAfterBrowserEvent: (event, bindings) => {
        if (!import.meta.env.DEV || !bindings.debugHotPath) return
        bindings.fluDebugHot?.('mic', {
          interim: event.kind === 'interim' ? event.text : '',
          final: event.kind === 'final' ? event.text : '',
        })
      },
    })
  }

  getParticipantLogSnapshotRef.current = () => ({
    texts: userRowsTextView.current,
    speakers: userSpeakersView.current,
  })

  // OS3 parity: if an external participantRef is provided, use it instead of creating a new instance.
  // This ensures voice commands (FLU_ADELANTE) and the UI button share the same participant state.
  const fluParticipant = participantRef?.current
    ? participantRef.current
    : useFluParticipant({
      apiKey,
      language,
      conversationActiveRef,
      session,
      getLogSnapshot: () => getParticipantLogSnapshotRef.current(),
    })
  const fluParticipantRef = useRef(fluParticipant)
  fluParticipantRef.current = fluParticipant

  const flushTranscriptOnFinal = useCallback(() => {
    flushTranscriptStateOnFinal({
      listenState: listenStateRef.current,
      publishedLiveRef,
      openPreviewTurnRef,
      lastStreamPreviewRef,
    })
  }, [])

  const flushPcmAfterTurnCommit = useCallback(() => {
    flushPcmStateAfterCommit({
      chunksRef,
      chunkTotalSamplesRef,
      turnAudioStartSampleRef,
      micBridgeRef: processorRef,
    })
  }, [])

  useEffect(() => {
    knowledgeBaseRef.current = knowledgeBase
  }, [knowledgeBase])

  useEffect(() => {
    getMinuteKnowledgeBaseRef.current = getMinuteKnowledgeBase
  }, [getMinuteKnowledgeBase])

  useEffect(() => {
    getDailyAgendaRef.current = getDailyAgenda
  }, [getDailyAgenda])

  useEffect(() => {
    getSelfManifestoRef.current = getSelfManifesto
  }, [getSelfManifesto])

  useEffect(() => {
    getDiaryContextRef.current = getDiaryContext
  }, [getDiaryContext])

  useEffect(() => {
    getNotesContextRef.current = getNotesContext
  }, [getNotesContext])

  useEffect(() => {
    getHorarioContextRef.current = getHorarioContext
  }, [getHorarioContext])

  useEffect(() => {
    getResultadosContextRef.current = getResultadosContext
  }, [getResultadosContext])

  useEffect(() => {
    resolveMinuteLookupRef.current = resolveMinuteLookup
  }, [resolveMinuteLookup])

  useEffect(() => {
    recognitionLocaleRef.current = getRecognitionLanguage(language)
    localeSwitchDetectRef.current = ''
    localeSwitchCountRef.current = 0
    if (isListeningRef.current && !isStoppingRef.current) {
      rebuildRecognitionRef.current()
    }
  }, [language])

  useEffect(() => {
    listVoiceProfiles()
      .then((profiles) => {
        voiceProfilesRef.current = profiles
      })
      .catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
  }, [])

  useEffect(() => {
    const hasGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia)
    const hasSpeechRecognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    const hasAudioContext = Boolean(window.AudioContext)
    // §9 Motor: Chrome SpeechRecognition (Google, online) + AudioContext para la
    // captura PCM (identidad de voz). El resto del pipeline es agnóstico.
    const supported = hasGetUserMedia && hasSpeechRecognition && hasAudioContext
    setIsSupported(supported)
    if (!supported) {
      const missing = []
      if (!hasGetUserMedia) missing.push('getUserMedia (micrófono)')
      if (!hasSpeechRecognition) missing.push('SpeechRecognition (reconocimiento de voz)')
      if (!hasAudioContext) missing.push('AudioContext (audio)')
      const isSecureContext = typeof window !== 'undefined' && window.isSecureContext
      let hint = ''
      if (!isSecureContext) {
        hint = ' Requiere un contexto seguro (HTTPS o localhost) para estas APIs. Accede vía https:// o http://localhost.'
      } else if (!hasSpeechRecognition) {
        hint = ' Usá Chrome actualizado para el reconocimiento de voz.'
      }
      setError(`Este navegador necesita: ${missing.join(', ')}.${hint}`)
    }
  }, [])

  useEffect(() => {
    if (sessionLoadedRef.current) return
    sessionLoadedRef.current = true
    loadSessionState()
      .then((saved) => {
        if (!saved) return
        if (saved.role || saved.theme) {
          setSession({
            role: saved.role || FLU_CONFIG.sessionDefaults.role,
            theme: saved.theme || FLU_CONFIG.sessionDefaults.theme,
          })
        }
        // §9: el historial restaurado lo carga `useConversationPersistence` en el
        // store; el motor NO mantiene diálogo propio. El filtrado de eventos de
        // sistema pertenece a la persistencia, no a este hook.
        if (saved.phase === 'SESION_ACTIVA' || saved.phase === 'CONFIGURACION') {
          setPhase(saved.phase)
        }
      })
      .catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
  }, [])

  const readCaptureSnapshot = useCallback(
    () => readTurnCapture(turnRef.current, pendingSpillRef.current),
    [],
  )

  const readActiveSnapshot = useCallback(() => {
    if (conversationActiveRef?.current) {
      return readCommandText(listenStateRef.current)
    }
    return readCommandSnapshot(turnRef.current, pendingSpillRef.current)
  }, [conversationActiveRef])


  const clearListeningAck = useCallback(() => {
    if (typeof window === 'undefined') return
    if (listeningAckTimerRef.current) {
      window.clearTimeout(listeningAckTimerRef.current)
      listeningAckTimerRef.current = null
    }
    setListeningAck('')
  }, [])

  const showListeningAck = useCallback(() => {
    const { listeningAck: ackCfg } = getConversationConfig()
    setListeningAck(ackCfg.message)
    if (typeof window === 'undefined') return
    clearListeningAck()
    listeningAckTimerRef.current = window.setTimeout(() => {
      listeningAckTimerRef.current = null
      setListeningAck('')
    }, ackCfg.durationMs)
  }, [clearListeningAck])

  const clearLiveTranscriptTimers = useCallback(() => {
    if (typeof window === 'undefined') return
    if (liveDebounceTimerRef.current) {
      window.clearTimeout(liveDebounceTimerRef.current)
      liveDebounceTimerRef.current = null
    }
    if (liveRafRef.current) {
      window.cancelAnimationFrame(liveRafRef.current)
      liveRafRef.current = null
    }
  }, [])

  const clearStreamLogTimer = useCallback(() => {
    if (typeof window === 'undefined') return
    if (streamLogTimerRef.current) {
      window.clearTimeout(streamLogTimerRef.current)
      streamLogTimerRef.current = null
    }
  }, [])

  const flushPendingStreamLog = useCallback(() => {
    clearStreamLogTimer()
    const pending = pendingStreamLogRef.current
    if (!pending) return
    pendingStreamLogRef.current = null
    const { __fluDebug, ...payload } = pending
    void onContractResolved?.(payload)
    if (import.meta.env.DEV && debugHotPath && __fluDebug) {
      fluDebugHot('log-emit', __fluDebug)
    }
  }, [clearStreamLogTimer, onContractResolved])

  const scheduleLiveTranscriptUpdate = useCallback(
    (capture = '') => {
      if (!capture) return
      livePendingCaptureRef.current = capture
      const debounceMs = Math.max(0, FLU_CONFIG.timing.liveTranscriptDebounceMs)
      if (typeof window === 'undefined') {
        setLiveTranscript(capture)
        return
      }
      if (debounceMs > 0) {
        clearLiveTranscriptTimers()
        liveDebounceTimerRef.current = window.setTimeout(() => {
          liveDebounceTimerRef.current = null
          setLiveTranscript(livePendingCaptureRef.current)
        }, debounceMs)
        return
      }
      if (liveRafRef.current) return
      liveRafRef.current = window.requestAnimationFrame(() => {
        liveRafRef.current = null
        setLiveTranscript(livePendingCaptureRef.current)
      })
    },
    [clearLiveTranscriptTimers],
  )

  const flushLiveTranscript = useCallback(() => {
    if (conversationActiveRef?.current) {
      // §9 — UN SOLO ESCRITOR: en conversación activa la frase viva la escribe
      // únicamente `handleConversationStreamSync` (vía syncConversationStream,
      // preview y commit). Aquí NO se escribe: antes había dos escritores
      // (este + el stream sync) con reglas distintas → alternancia/ciclo.
      return
    }

    const raw = readCommandSnapshot(turnRef.current, pendingSpillRef.current)
    const turnPreview = raw ? cleanForSpeech(raw) : ''

    if (turnPreview) {
      const stable = monotonicDisplay(publishedLiveRef.current, turnPreview)
      if (stable === publishedLiveRef.current) return
      publishedLiveRef.current = stable
      setLiveTranscript(stable)
      return
    }

    if (isListeningRef.current && publishedLiveRef.current) {
      return
    }

    publishedLiveRef.current = ''
    setLiveTranscript('')
  }, [conversationActiveRef])

  const publishLive = useCallback(() => {
    if (typeof window === 'undefined') {
      flushLiveTranscript()
      return
    }
    if (liveDebounceTimerRef.current) {
      window.clearTimeout(liveDebounceTimerRef.current)
    }
    liveDebounceTimerRef.current = window.setTimeout(() => {
      liveDebounceTimerRef.current = null
      flushLiveTranscript()
    }, FLU_CONFIG.timing.liveTranscriptDebounceMs)
  }, [flushLiveTranscript])

  const publishLiveImmediate = useCallback(() => {
    if (typeof window !== 'undefined' && liveDebounceTimerRef.current) {
      window.clearTimeout(liveDebounceTimerRef.current)
      liveDebounceTimerRef.current = null
    }
    flushLiveTranscript()
  }, [flushLiveTranscript])

  const publishLiveFromTurn = useCallback(() => {
    const debounceMs = FLU_CONFIG.timing.liveTranscriptDebounceMs
    if (!debounceMs) {
      publishLiveImmediate()
      return
    }
    publishLive()
  }, [publishLive, publishLiveImmediate])

  const clearTurnBuffers = useCallback(() => {
    resetTurnState(turnRef.current)
    finalizeGraceUsedRef.current = false
  }, [])

  // Asignación del limpiador que usa `commitAndResolveTurn` al cerrar el turno.
  clearTurnAfterResolveRef.current = () => {
    clearTurnBuffers()
    pendingSpillRef.current = ''
  }

  const clearCaptureState = useCallback(() => {
    clearTurnBuffers()
    chunksRef.current = []
    chunkTotalSamplesRef.current = 0
  }, [clearTurnBuffers])

  const resetVoiceDisplay = useCallback(() => {
    clearCaptureState()
    pendingSpillRef.current = ''
    lastLoggedCaptureRef.current = ''
    lastEmittedTranscriptRef.current = ''
    openPreviewTurnRef.current = false
    turnAudioStartSampleRef.current = 0
    lastStreamPreviewRef.current = ''
    resetActiveListenState(listenStateRef.current)
    lastLogLineTextRef.current = ''
    lastLogLineAtRef.current = 0
    lastTurnSignatureRef.current = null
    publishedLiveRef.current = ''
    commitVisibleTranscript('')
    setLiveTranscript('')
  }, [clearCaptureState])

  const resetConversationSession = useCallback(() => {
    resetVoiceDisplay()
    clearListeningAck()
    setSpeakerClusters([])
    const { speakers } = getConversationConfig()
    lastSpeakerRef.current = speakers.defaultLabel
    lastLoggedSpeakerRef.current = speakers.defaultLabel
    lastTurnSignatureRef.current = null
  }, [clearListeningAck, resetVoiceDisplay])

  const advanceConversationSpeaker = useCallback(() => {
    if (conversationActiveRef?.current) {
      const next = advanceSpeaker(listenStateRef.current)
      lastSpeakerRef.current = next
      lastLoggedSpeakerRef.current = next
      return next
    }

    const known = listSessionSpeakers(dialogueView.current)
    const labels = [
      lastSpeakerRef.current,
      lastLoggedSpeakerRef.current,
      ...known,
    ].filter(Boolean)
    const next = nextSpeakerLabel(labels)
    lastSpeakerRef.current = next
    lastLoggedSpeakerRef.current = next
    return next
  }, [conversationActiveRef])

  const renameSessionSpeaker = useCallback((fromLabel = '', toLabel = '') => {
    const source = String(fromLabel || '').trim()
    const target = String(toLabel || '').trim()
    if (!source || !target || source === target) return

    setSpeakerClusters((prev) =>
      prev.map((cluster) =>
        String(cluster?.label || '').trim() === source ? { ...cluster, label: target } : cluster,
      ),
    )

    if (lastSpeakerRef.current === source) lastSpeakerRef.current = target
    if (lastLoggedSpeakerRef.current === source) lastLoggedSpeakerRef.current = target
  }, [])

  const removeSessionSpeaker = useCallback((label = '') => {
    const source = String(label || '').trim()
    if (!source) return

    setSpeakerClusters((prev) =>
      prev.filter((cluster) => String(cluster?.label || '').trim() !== source),
    )

    if (lastSpeakerRef.current === source) lastSpeakerRef.current = ''
    if (lastLoggedSpeakerRef.current === source) lastLoggedSpeakerRef.current = ''
  }, [])

  const reconcileSpeakerClusters = useCallback((committedSpeakers = []) => {
    const roomCfg = FLU_CONFIG.voiceIdentity?.capture?.roomCapture || {}
    if (roomCfg.pruneGhostClusters === false) return

    const before = speakerClustersRef.current.map((cluster) => cluster.label)
    setSpeakerClusters((prev) =>
      pruneGhostSpeakerClusters(prev, committedSpeakers, {
        keepLabels: [lastSpeakerRef.current, lastLoggedSpeakerRef.current].filter(Boolean),
      }),
    )
    const after = speakerClustersRef.current.map((cluster) => cluster.label)
    const removed = before.filter((label) => !after.includes(label))
    if (import.meta.env.DEV && debugHotPath && removed.length) {
      fluDebugHot('speaker-prune', { removed, kept: after })
    }
  }, [])

  const releaseTurnAfterLog = useCallback(
    (loggedCapture = '') => {
      pendingSpillRef.current = computeSpillAfterLog(
        turnRef.current,
        pendingSpillRef.current,
        loggedCapture,
      )
      lastLoggedCaptureRef.current = ''
      resetTurnState(turnRef.current)
      finalizeGraceUsedRef.current = false

      const spillPreview = pendingSpillRef.current ? cleanForSpeech(pendingSpillRef.current) : ''
      publishedLiveRef.current = spillPreview
      flushLiveTranscript()
    },
    [flushLiveTranscript],
  )

  const clearAutoProcessTimer = useCallback(() => {
    if (typeof window === 'undefined') return
    if (autoProcessTimerRef.current) {
      window.clearTimeout(autoProcessTimerRef.current)
      autoProcessTimerRef.current = null
    }
    if (liveDebounceTimerRef.current) {
      window.clearTimeout(liveDebounceTimerRef.current)
      liveDebounceTimerRef.current = null
    }
  }, [])

  const clearAllCommitTimers = useCallback(() => {
    clearAutoProcessTimer()
  }, [clearAutoProcessTimer])

  const clearRecognitionRetryTimer = useCallback(() => {
    if (typeof window === 'undefined') return
    if (recognitionRetryTimerRef.current) {
      window.clearTimeout(recognitionRetryTimerRef.current)
      recognitionRetryTimerRef.current = null
    }
  }, [])

  const clearPassiveAudioDelayTimer = useCallback(() => {
    if (typeof window === 'undefined') return
    if (passiveAudioDelayTimerRef.current) {
      window.clearTimeout(passiveAudioDelayTimerRef.current)
      passiveAudioDelayTimerRef.current = null
    }
  }, [])

  const getConversationContext = useCallback(
    () => getDialogueContextSlice(dialogueView.current, CONTEXT_HISTORY_LIMIT),
    [],
  )

  const requestFluContractForTranscript = useCallback(
    async ({
      transcript,
      knowledgeMode = 'general',
      intent = { comando: null, destino: null, parametros: {} },
      speaker,
      theme,
      role,
      phase: contractPhase,
    }) => {
      if (knowledgeMode === 'minutes') {
        const local = resolveMinuteLookupRef.current(transcript, language)
        if (local?.mode === 'local' && local.contract) {
          return {
            contract: local.contract,
            diagnostics: local.diagnostics || { provider: 'minute-store', route: 'minute-lookup' },
          }
        }
      }

      // Read personality + creativity from FLU Configurator (integrationStore)
      const integrationState = useIntegrationStore.getState?.()
      const personality = integrationState?.config?.personality
        ? {
          traits: integrationState.config.personality.traits || [],
          tone: integrationState.config.personality.tone || 'friendly',
          customInstructions: integrationState.config.personality.customInstructions || '',
        }
        : null
      const creativity = integrationState?.advancedConfig?.creativity ?? null

      // Read startupPrompt from the active profile definition
      const currentProfile = integrationState?.availableProfiles?.find(
        (p) => p.id === integrationState?.profile
      )
      const startupPrompt = currentProfile?.startupPrompt || ''

      // Read recentMemory from ref (set by OS3's onEmotion callback via setRecentMemory)
      // Clear it immediately after reading so it only fires once (avoids repeating the
      // same emotion across multiple subsequent contract requests).
      const recentMemory = recentMemoryRef.current || ''
      recentMemoryRef.current = ''

      // Build daily agenda from minutes (pending items from previous sessions)
      const agendaText = getDailyAgendaRef.current()
        ? getDailyAgendaRef.current()
        : ''

      // Autoconocimiento (§1.4): solo se inyecta en el user prompt cuando el
      // turno es una petición de autoconocimiento (isSelfKnowledgeRequest).
      // La ruta local CONOCER_FLU (§1.3) corta antes de Gemini; este texto es
      // la red de seguridad si una variante ambigua sí llega a la IA.
      const selfKnowledgeText = isSelfKnowledgeRequest(transcript, language)
        ? (getSelfManifestoRef.current() || '')
        : ''

      // Radar de contexto (Pizarrón un solo objeto — Paso 5): bloques 6-9.
      // Cada bloque es dinámico desde su fuente (Dexie) y '' si no hay datos
      // (Rule #1). Los getters los provee App.tsx desde los hooks de diario,
      // notas, horario y resultados del feed.
      const diaryContext = getDiaryContextRef.current() || ''
      const notesContext = getNotesContextRef.current() || ''
      const horarioContext = getHorarioContextRef.current() || ''
      const resultadosContext = getResultadosContextRef.current() || ''

      // FLU "thinking" (Pensando / Idle_1) while the AI processes the request —
      // deterministic per definition: when the user asks the AI something (or it
      // learns/generates) FLU must show Pensando. Local minute lookups above
      // return instantly, so they correctly skip this.
      useIntegrationStore.getState?.().setConversationState?.('THINKING')
      // Indicador visual de procesamiento: se enciende al iniciar la llamada
      // a la IA y se apaga SIEMPRE al resolver (éxito o error) en el finally.
      useIntegrationStore.getState?.().setThinking?.(true)

      try {
        const iaStartMs = Date.now()
        const iaResult = await requestFluContract({
          apiKey,
          transcript,
          intent,
          speaker,
          theme,
          role,
          phase: contractPhase,
          language,
          history: getConversationContext(),
          knowledgeBase: knowledgeBaseRef.current,
          knowledgeBase2: knowledgeMode === 'minutes' ? getMinuteKnowledgeBaseRef.current() : '',
          knowledgeMode,
          personality,
          creativity,
          recentMemory,
          startupPrompt,
          agendaText,
          selfKnowledgeText,
          diaryContext,
          notesContext,
          horarioContext,
          resultadosContext,
        })
        // Instrumentación de latencia (diagnóstico): permite medir el tiempo real
        // de la intervención con IA sin adivinar.
        relayLog(
          'LOG',
          'useFluVoiceAssistant',
          `latencia IA: ${Date.now() - iaStartMs}ms (phase=${contractPhase}, model=${iaResult?.diagnostics?.model || iaResult?.diagnostics?.provider || 'n/d'})`,
        )
        return iaResult
      } finally {
        useIntegrationStore.getState?.().setThinking?.(false)
      }
    },
    [apiKey, getConversationContext, language],
  )

  const persistDialogueSession = useCallback(async () => {
    await saveSessionState({
      phase,
      ...session,
      history: getConversationContext(),
    })
  }, [getConversationContext, phase, session])

  const scheduleAutoProcess = useCallback(
    (delay = getFluTimingCfg().scheduleAutoProcessDelayMs) => {
      if (typeof window === 'undefined') return
      clearAutoProcessTimer()
      autoProcessTimerRef.current = window.setTimeout(() => {
        if (!isListeningRef.current || isStoppingRef.current) return

        if (isCommittingRef.current) {
          scheduleAutoProcess(getFluTimingCfg().scheduleAutoProcessWhileCommittingMs)
          return
        }

        if (conversationActiveRef?.current) {
          return
        } else {
          const pendingInterim = cleanForSpeech(turnRef.current.interim)
          if (pendingInterim && !finalizeGraceUsedRef.current) {
            finalizeGraceUsedRef.current = true
            scheduleAutoProcess(FLU_CONFIG.timing.interimFinalizeGraceMs)
            return
          }
        }

        finalizeGraceUsedRef.current = false
        stopListeningRef.current({ closing: false }).catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
      }, delay)
    },
    [clearAutoProcessTimer, conversationActiveRef],
  )

  const requestRecognitionRestart = useCallback(
    (delay = getFluTimingCfg().recognitionRestartDefaultDelayMs) => {
      if (typeof window === 'undefined') return
      if (!isListeningRef.current || !recognitionRef.current || isStoppingRef.current) return

      clearRecognitionRetryTimer()
      recognitionRestartPendingRef.current = true
      recognitionRetryTimerRef.current = window.setTimeout(() => {
        recognitionRetryTimerRef.current = null
        recognitionRestartPendingRef.current = false
        if (!isListeningRef.current || !recognitionRef.current || isStoppingRef.current) return
        if (isProcessingRef.current && !conversationActiveRef?.current) return

        recognitionActiveRef.current = false

        if (conversationActiveRef?.current) {
          if (startSpeechRecognition(recognitionRef.current)) {
            recognitionRetryCountRef.current = 0
            return
          }
          try {
            stopSpeechRecognition(recognitionRef.current)
          } catch {
            // ignore
          }
          const retryCount = recognitionRetryCountRef.current + 1
          recognitionRetryCountRef.current = retryCount
          if (retryCount >= 2 && rebuildRecognitionRef.current()) {
            return
          }
        } else if (startSpeechRecognition(recognitionRef.current)) {
          recognitionRetryCountRef.current = 0
          return
        }

        const restartCfg = getActiveListenConfig().restart
        try {
          stopSpeechRecognition(recognitionRef.current)
        } catch {
          // ignore
        }
        const retryCount = recognitionRetryCountRef.current + 1
        recognitionRetryCountRef.current = retryCount
        const maxRetries = restartCfg.maxRetries
        const unlimited = conversationActiveRef?.current && maxRetries === 0
        const withinLimit = unlimited || retryCount <= maxRetries

        if (withinLimit) {
          const backoff = conversationActiveRef?.current
            ? Math.min(
              restartCfg.maxBackoffMs,
              restartCfg.retryBackoffMs * Math.min(retryCount, 8),
            )
            : Math.min(220 + retryCount * 40, 800)
          requestRecognitionRestart(backoff)
        } else if (conversationActiveRef?.current) {
          recognitionRetryCountRef.current = 0
          requestRecognitionRestart(restartCfg.maxBackoffMs)
        }
      }, delay)
    },
    [clearRecognitionRetryTimer, conversationActiveRef],
  )

  const finalizeRecognition = useCallback(async () => {
    if (!recognitionRef.current) return

    relayLog('LOG', 'useFluVoiceAssistant', '[REC] stop: finalizeRecognition', {
      isListening: isListeningRef.current,
      conversationActive: Boolean(conversationActiveRef?.current),
    })

    const finalizeMs = conversationActiveRef?.current
      ? FLU_CONFIG.timing.recognitionFinalizeMs
      : FLU_CONFIG.timing.recognitionStopMs

    isStoppingRef.current = true
    const waitForEnd = new Promise((resolve) => {
      recognitionEndResolverRef.current = resolve
    })

    try {
      recognitionRef.current.stop()
    } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }

    await Promise.race([
      waitForEnd,
      new Promise((resolve) => setTimeout(resolve, finalizeMs)),
    ])

    isStoppingRef.current = false
    recognitionEndResolverRef.current = null
  }, [conversationActiveRef])

  /** Libera el micrófono antes de TTS para que Chrome no mute/interrumpa la voz. */
  const suspendRecognitionForAssistantSpeech = useCallback(async () => {
    if (!recognitionRef.current || !recognitionActiveRef.current) return

    // La escucha estaba activa antes de hablar: al terminar la suspensión se
    // debe volver a encender (log evidencia: onend con isStopping=true y luego
    // nadie reabría → "se cierra la conversación").
    const wasListeningBefore = isListeningRef.current || recognitionActiveRef.current

    isStoppingRef.current = true
    const waitForEnd = new Promise((resolve) => {
      recognitionEndResolverRef.current = resolve
    })

    try {
      if (typeof recognitionRef.current.abort === 'function') {
        recognitionRef.current.abort()
      } else {
        recognitionRef.current.stop()
      }
    } catch {
      // ignore
    }

    recognitionActiveRef.current = false
    await Promise.race([
      waitForEnd,
      new Promise((resolve) => setTimeout(resolve, FLU_CONFIG.timing.recognitionStopMs)),
    ])
    isStoppingRef.current = false
    recognitionEndResolverRef.current = null

    // Reanudar la escucha si estaba activa antes del habla del asistente.
    // SOLO en modo pasivo (sin conversación activa): ahí no hay quien reabra
    // tras el TTS (scheduleResumeListening solo aplica con conversación activa),
    // y sin esto la escucha ambiental moría (bug que motivó el parche 3132d2e).
    // En conversación ACTIVA NO se reabre aquí: reabrir durante el habla fuerza
    // syncAvatarToState(LISTENING) en el mismo ms del SPEAKING → corta MouthMove
    // (boca congelada) aunque el audio siga. La reapertura activa la hace App
    // (onContractResolved → scheduleResumeListening) al terminar el TTS.
    if (wasListeningBefore && !conversationActiveRef?.current) {
      relayLog('LOG', 'useFluVoiceAssistant', '[REC] suspend: reanudando tras habla (modo pasivo)', {
        wasListeningBefore,
      })
      requestRecognitionRestart(0)
    } else {
      relayLog('LOG', 'useFluVoiceAssistant', '[REC] suspend: sin reanudar en suspend (conversación activa o no escuchaba)', {
        wasListeningBefore,
        conversationActive: Boolean(conversationActiveRef?.current),
      })
    }
  }, [conversationActiveRef, requestRecognitionRestart])

  const restartRecognition = useCallback(() => {
    requestRecognitionRestart(0)
  }, [requestRecognitionRestart])

  const resolveConversationSpeakerSync = useCallback(
    (
      _transcriptForIntro = '',
      audioSnapshot,
      sampleRate,
      fallbackSpeaker,
      { atTurnBoundary: _atTurnBoundary = false, allowNewCluster: _allowNewCluster = true } = {},
    ) => {
      const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
      const canDiarize = conversationActiveRef?.current === true && captureCfg.conversationAutoDiarize === true
      // §3 Regla dura: sin EVIDENCIA de audio NO se estampa un nombre propio
      // (respeta requireWakeWordForSpeakerName). Se usa etiqueta genérica.
      const GENERIC_SPEAKER = 'Hablante 1'
      const isProperName = (value) => {
        const s = String(value || '').trim()
        return Boolean(s) && s !== 'FLU' && !/^Hablante\s+\d+$/i.test(s)
      }
      if (!audioSnapshot?.length) {
        const sticky = lastSpeakerRef.current || fallbackSpeaker
        return isProperName(sticky) ? GENERIC_SPEAKER : sticky || GENERIC_SPEAKER
      }
      // Embeddings async (worker): el preflight ya resolvió identidad por audio
      // (assignSpeakerStrictCosine, signatureVector 512-D). Se consulta el slot del
      // turno activo para que la vista previa NO rompa la diarización de conversación:
      // con evidencia lista se usa el hablante real; sin ella se mantiene sticky.
      if (canDiarize) {
        const preflight = peekTurnSpeakerPreflight(activeTurnIdRef.current)
        if (preflight?.ready && preflight.speakerName) {
          return preflight.speakerName
        }
        if (lastLoggedSpeakerRef.current) {
          // Sin preflight listo NO se estampa el nombre propio (evita "FLU/otro = tu nombre").
          return isProperName(lastLoggedSpeakerRef.current)
            ? GENERIC_SPEAKER
            : lastLoggedSpeakerRef.current
        }
      }
      const fallback = fallbackSpeaker || lastLoggedSpeakerRef.current || lastSpeakerRef.current || GENERIC_SPEAKER
      return isProperName(fallback) ? GENERIC_SPEAKER : fallback
    },
    [conversationActiveRef],
  )

  const getContinuousBufferAdapter = useCallback(() => ({
    getTurnStartSample: () => turnAudioStartSampleRef.current,
    snapshotTurnWindow: ({ turnAudioStartSample, atTurnBoundary = false } = {}) => {
      const rate = sampleRateRef.current || 48000
      const tailMs = getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary })
      const maxSamples = Math.floor(rate * (tailMs / 1000))
      const minVoiced = getConversationMinVoicedSamples(rate)
      return flattenChunksWindow(chunksRef.current, {
        totalSamples: chunkTotalSamplesRef.current,
        sinceSample: Number.isFinite(turnAudioStartSample)
          ? turnAudioStartSample
          : turnAudioStartSampleRef.current,
        maxSamples,
        minSamples: minVoiced,
      })
    },
  }), [])

  const createSpeakerAudioResolver = useCallback(
    ({ atTurnBoundary = false, allowNewCluster = false, utterance = '' } = {}) =>
      createTurnSpeakerAudioResolver({
        getAudioBuffer: () => getContinuousBufferAdapter(),
        getSampleRate: () => sampleRateRef.current || 48000,
        getTurnStartSample: () => turnAudioStartSampleRef.current,
        getAudioStartSample: () => turnAudioStartSampleRef.current,
        getAudioStartedAtMs: () => turnSegmentStartedAtRef.current,
        getSpeakerClusters: () => speakerClustersRef.current,
        getLastSpeaker: () => lastLoggedSpeakerRef.current || lastSpeakerRef.current,
        getLastSignature: () => lastTurnSignatureRef.current,
        getFallbackSpeaker: () =>
          lastLoggedSpeakerRef.current || lastSpeakerRef.current || 'Hablante 1',
        getUtteranceText: () => cleanForSpeech(utterance) || lastDiarizeUtteranceRef.current,
        atTurnBoundary,
        allowNewCluster,
        getPreferSpeaker: () => lastLoggedSpeakerRef.current || '',
        getSessionPrimary: () => sessionPrimarySpeakerRef.current || '',
        getReservedLabels: () => [...userSpeakersView.current].filter(Boolean),
      }),
    [getContinuousBufferAdapter],
  )

  const scheduleIdentityPreflight = useCallback(
    ({ utterance = '' } = {}) => {
      if (!conversationActiveRef?.current) return
      const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
      if (captureCfg.conversationAutoDiarize !== true) return

      const phrase = cleanForSpeech(utterance)
      if (phrase) lastDiarizeUtteranceRef.current = phrase

      if (preflightScheduledForTurnRef.current) {
        return
      }

      preflightScheduledForTurnRef.current = true
      activeTurnIdRef.current += 1
      const turnId = activeTurnIdRef.current
      startContinuousIdentityPipeline(
        turnId,
        () => createSpeakerAudioResolver({ atTurnBoundary: true, allowNewCluster: true, utterance: phrase }),
        {
          // §9 Decisión: el COMMIT es autoritativo; el segmento solo propone
          // (no persiste clusters). Persistir aquí era una 2ª ruta de escritura.
          onClusters: () => {},
        },
      )
    },
    [conversationActiveRef, createSpeakerAudioResolver],
  )

  const resolveSpeakerWithAudio = useCallback(
    (utterance = '', fallbackSpeaker = '', { atTurnBoundary = false, allowNewCluster = false } = {}) => {
      const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
      if (!conversationActiveRef?.current || captureCfg.conversationAutoDiarize !== true) {
        return fallbackSpeaker
      }
      const tailMs = getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary })
      const sampleRate = sampleRateRef.current || 48000
      const maxSamples = Math.floor(sampleRate * (tailMs / 1000))
      const minVoiced = getConversationMinVoicedSamples(sampleRate)
      let tail = flattenChunksTail(chunksRef.current, maxSamples)
      if (captureCfg.conversationTurnAlignedDiarize !== false) {
        const turnWindow = flattenChunksWindow(chunksRef.current, {
          totalSamples: chunkTotalSamplesRef.current,
          sinceSample: turnAudioStartSampleRef.current,
          maxSamples,
          minSamples: minVoiced,
        })
        if (turnWindow.length >= minVoiced) tail = turnWindow
      }
      if (!tail.length) return fallbackSpeaker
      return resolveConversationSpeakerSync(utterance, tail, sampleRate, fallbackSpeaker, {
        atTurnBoundary,
        allowNewCluster,
      })
    },
    [conversationActiveRef, resolveConversationSpeakerSync],
  )

  const applyConversationSpeaker = useCallback(
    (utterance = '', fallbackSpeaker = '', { force = false, atTurnBoundary = false, allowNewCluster = false } = {}) => {
      const fallback = cleanForSpeech(fallbackSpeaker) || getSpeakerLabel(listenStateRef.current)
      const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
      if (
        shouldSkipPreviewDiarize({
          forceWakeDiarize: force,
          conversationActive: Boolean(conversationActiveRef?.current),
        })
      ) {
        syncSpeakerIndexFromLabel(listenStateRef.current, fallback)
        lastSpeakerRef.current = fallback
        return fallback
      }
      const now = Date.now()
      const diarizeMs = getDiarizeIntervalMs()
      const canDiarize =
        captureCfg.conversationAutoDiarize === true &&
        (force ||
          atTurnBoundary ||
          utterance !== lastDiarizeUtteranceRef.current ||
          now - lastSpeakerDiarizeAtRef.current >= diarizeMs)

      if (!canDiarize) {
        syncSpeakerIndexFromLabel(listenStateRef.current, fallback)
        lastSpeakerRef.current = fallback
        lastLoggedSpeakerRef.current = fallback
        return fallback
      }

      lastSpeakerDiarizeAtRef.current = now
      lastDiarizeUtteranceRef.current = cleanForSpeech(utterance)
      const prevSpeaker = lastLoggedSpeakerRef.current || lastSpeakerRef.current
      const canCreateCluster = allowNewCluster || force || atTurnBoundary
      const speaker =
        cleanForSpeech(
          resolveSpeakerWithAudio(utterance, fallback, {
            atTurnBoundary,
            allowNewCluster: canCreateCluster,
          }),
        ) || fallback
      syncSpeakerIndexFromLabel(listenStateRef.current, speaker)
      lastSpeakerRef.current = speaker
      lastLoggedSpeakerRef.current = speaker
      if (import.meta.env.DEV && debugHotPath) {
        if (atTurnBoundary && speaker === prevSpeaker) {
          fluDebugHot('speaker-sticky', { speaker: prevSpeaker, utterance })
        } else if (canCreateCluster && speaker !== prevSpeaker && prevSpeaker) {
          fluDebugHot('speaker-new', { from: prevSpeaker, to: speaker, atTurnBoundary })
        }
      }
      return speaker
    },
    [resolveSpeakerWithAudio],
  )

  const resolveSpeaker = useCallback(
    async (transcriptForIntro = '', audioSnapshot, sampleRate, fallbackSpeaker) => {
      const signatureVector = audioSnapshot.length
        ? (await computeTurnSignature(audioSnapshot, sampleRate)).vector
        : [0, 0, 0, 0]

      if (conversationActiveRef?.current) {
        const resolvedSpeakerName = resolveConversationSpeakerSync(
          transcriptForIntro,
          audioSnapshot,
          sampleRate,
          fallbackSpeaker,
        )
        return {
          signatureVector,
          speakerName: resolvedSpeakerName,
          introducedName: null,
          resolvedSpeakerName,
          speakerAlias: null,
        }
      }

      if (!audioSnapshot.length) {
        return {
          signatureVector,
          speakerName: fallbackSpeaker,
          introducedName: null,
          resolvedSpeakerName: fallbackSpeaker,
          speakerAlias: null,
        }
      }

      const segments = segmentAudio(audioSnapshot, sampleRate)
      const speakerName = await matchSegmentNames(
        segments,
        sampleRate,
        speakerClustersRef.current,
        voiceProfilesRef.current,
      )

      const introducedName = detectIntroducedName(transcriptForIntro)
      let resolvedSpeakerName = introducedName || speakerName
      if (
        !introducedName &&
        Array.isArray(lastTurnSignatureRef.current) &&
        lastTurnSignatureRef.current.length
      ) {
        const distanceToLast = compareAudioSignatures(signatureVector, lastTurnSignatureRef.current)
        if (distanceToLast < getLastTurnSignatureContinuityDistance()) {
          resolvedSpeakerName = lastSpeakerRef.current || speakerName
        }
      }
      const speakerAlias = introducedName && introducedName !== speakerName ? speakerName : null

      if (introducedName && introducedName !== speakerName) {
        // §9 Decisión: el segmento solo PROPONE; el COMMIT persiste los clusters.
        // Aquí no se escribe `speakerClustersRef` (era una 2ª ruta de escritura).
        saveVoiceProfile({
          label: introducedName,
          signature: signatureVector,
        })
          .then((profile) => {
            voiceProfilesRef.current = [
              profile,
              ...voiceProfilesRef.current.filter((item) => item.label !== profile.label),
            ]
          })
          .catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
      }

      lastSpeakerRef.current = resolvedSpeakerName
      lastTurnSignatureRef.current = signatureVector
      return {
        signatureVector,
        speakerName,
        introducedName,
        resolvedSpeakerName,
        speakerAlias,
      }
    },
    [conversationActiveRef, resolveConversationSpeakerSync],
  )

  const emitConversationLog = useCallback(
    (
      turnCapture,
      {
        fallbackSpeaker,
        speakerName: explicitSpeaker,
        currentClock,
        replaceLastRawLog = false,
        streamUpdate = false,
        turnCommit = false,
      } = {},
    ) => {
      const capture = conversationActiveRef?.current
        ? cleanForSpeech(turnCapture)
        : normalizeTranscriptText(turnCapture)
      if (!capture) return false
      if (
        !replaceLastRawLog &&
        isDuplicateLogPhrase(capture, lastEmittedTranscriptRef.current)
      ) {
        return false
      }

      const speakerName = normalizeSpeakerLabel(
        cleanForSpeech(explicitSpeaker) ||
        resolveConversationSpeakerLabel(
          capture,
          fallbackSpeaker || lastLoggedSpeakerRef.current || lastSpeakerRef.current,
        ),
      )

      lastLoggedCaptureRef.current = capture
      lastLoggedSpeakerRef.current = speakerName
      lastSpeakerRef.current = speakerName
      // §9: el MISMO valor commiteado es el de la fila (display === fila).
      const canonicalPhrase = commitTurnPhrase(capture)
      if (!conversationActiveRef?.current) {
        lastEmittedTranscriptRef.current = canonicalPhrase
      }

      lastLogEmitAtRef.current = Date.now()

      const payload = {
        contract: null,
        rawOnly: true,
        replaceLastRawLog,
        streamUpdate,
        transcript: canonicalPhrase,
        speakerName,
        speakerAlias: null,
        phase,
        timestamp: currentClock,
        signature: lastTurnSignatureRef.current,
        language: detectTranscriptLanguage(capture),
      }
      const debugMeta = { text: capture, speaker: speakerName, replaceLast: replaceLastRawLog }
      const throttleMs = Math.max(0, FLU_CONFIG.timing.streamLogThrottleMs)

      if (
        streamUpdate &&
        !turnCommit &&
        throttleMs > 0 &&
        conversationActiveRef?.current
      ) {
        pendingStreamLogRef.current = { ...payload, __fluDebug: debugMeta }
        if (!streamLogTimerRef.current) {
          streamLogTimerRef.current = window.setTimeout(flushPendingStreamLog, throttleMs)
        }
        if (import.meta.env.DEV && debugHotPath) {
          fluDebugHot('log-emit', { ...debugMeta, throttled: true })
        }
        return false
      }

      pendingStreamLogRef.current = null
      clearStreamLogTimer()
      void onContractResolved?.(payload)
      if (import.meta.env.DEV && debugHotPath) {
        fluDebugHot('log-emit', debugMeta)
      }
      return true
    },
    [clearStreamLogTimer, conversationActiveRef, flushPendingStreamLog, onContractResolved, phase],
  )

  const commitSessionTurn = useCallback(
    (text, speakerName) => {
      const capture = cleanForSpeech(text)
      if (!capture) return

      const speaker = normalizeSpeakerLabel(
        cleanForSpeech(speakerName) ||
        lastLoggedSpeakerRef.current ||
        lastSpeakerRef.current ||
        getSpeakerLabel(listenStateRef.current),
      )

      if (!isFluSpeaker(speaker)) {
        archiveCommittedTurn(listenStateRef.current, capture, {
          maxChars: FLU_CONFIG.limits.sessionTranscriptMaxChars,
        })
        reconcileSpeakerClusters(userSpeakersView.current)
      }
    },
    [reconcileSpeakerClusters],
  )

  // §9: se eliminó `injectDialogueEntry`. App ya persiste el evento en el store
  // (`addConversationEntry`) y el diálogo se DERIVA del store; el canal lateral
  // del motor era redundante.

  const commitTurnToSessionRows = useCallback(
    (capture, speakerName) => commitSessionTurn(capture, speakerName),
    [commitSessionTurn],
  )

  const syncConversationStream = useCallback(
    (payload = {}) =>
      handleConversationStreamSync(
        {
          conversationActiveRef,
          publishedLiveRef,
          listenStateRef,
          openPreviewTurnRef,
          setLiveTranscript,
          scheduleLiveTranscriptUpdate,
          applyConversationSpeaker,
          flushPendingStreamLog,
          logRowsTextRef: userRowsTextView,
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
          logRowSpeakersRef: userSpeakersView,
          speakerClustersRef,
          setSpeakerClusters,
          lastSpeakerRef,
          lastTurnSignatureRef,
          lastLogLineTextRef,
          commitTurnToSessionRows,
          fluParticipantRef,
        },
        payload,
      ),
    [
      applyConversationSpeaker,
      commitTurnToSessionRows,
      conversationActiveRef,
      createSpeakerAudioResolver,
      emitConversationLog,
      flushPendingStreamLog,
      flushPcmAfterTurnCommit,
      scheduleLiveTranscriptUpdate,
    ],
  )

  const flushListenStateBeforeRebuild = useCallback(() => {
    if (!conversationActiveRef?.current) return
    // El interino en vuelo durante un stall/rebuild es NO CONFIABLE: Chrome se
    // congeló a mitad de frase y puede entregar una palabra truncada (p.ej. "hoa"
    // de "hola"). Commitearlo como turno final crea filas basura en el log y
    // reinicia la línea abierta, de modo que la siguiente sesión arranca desde
    // cero y vuelve a commitear otro fragmento parcial (síntoma "solo escribe hoa
    // y deja de transcribir" + "escucha pasmada").
    //
    // En un rebuild NO se commitea el interino parcial: se descarta la línea
    // abierta (sin tocar el transcript de sesión ni el índice de hablante) para
    // que la nueva sesión de reconocimiento recapture limpio desde el audio
    // actual. El audio hablado durante el congelamiento de Chrome se pierde de
    // todos modos (Chrome no lo procesó), así que commitear el fragmento previo
    // no recupera nada y solo ensucia el log.
    const partial = cleanForSpeech(
      readStreamDisplay(listenStateRef.current) ||
        listenStateRef.current.pendingInterim,
    )
    if (partial && import.meta.env?.DEV && debugHotPath) {
      fluDebugHot('stall-rebuild-discard-partial', { partial: partial.slice(0, 80) })
    }
    // Reset de la línea abierta (espejo de finalizeTurnCommit pero SIN commitear
    // una fila al log).
    listenStateRef.current.openLine = ''
    listenStateRef.current.pendingInterim = ''
    publishedLiveRef.current = ''
    openPreviewTurnRef.current = false
    lastStreamPreviewRef.current = ''
    preflightScheduledForTurnRef.current = false
    srGapFiredForOpenLineRef.current = false
    setLiveTranscript('')
  }, [
    conversationActiveRef,
    debugHotPath,
    fluDebugHot,
    openPreviewTurnRef,
    publishedLiveRef,
    lastStreamPreviewRef,
    preflightScheduledForTurnRef,
    srGapFiredForOpenLineRef,
    setLiveTranscript,
  ])

  const cleanupAudio = useCallback(async () => {
    clearPassiveAudioDelayTimer()
    clearAllCommitTimers()
    clearRecognitionRetryTimer()
    clearLiveTranscriptTimers()
    flushPendingStreamLog()
    isListeningRef.current = false
    recognitionActiveRef.current = false
    clearCaptureState()

    if (recognitionRef.current) {
      recognitionRef.current.onresult = null
      recognitionRef.current.onerror = null
      recognitionRef.current.onend = null
      try {
        recognitionRef.current.stop()
      } catch {
        // Ignore stop errors.
      }
      recognitionRef.current = null
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      processorRef.current = null
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      sourceRef.current = null
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      analyserRef.current = null
    }

    if (zeroGainRef.current) {
      try {
        zeroGainRef.current.disconnect()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      zeroGainRef.current = null
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      audioContextRef.current = null
    }

    await stopMediaStream(mediaStreamRef.current)
    mediaStreamRef.current = null
  }, [clearAllCommitTimers, clearLiveTranscriptTimers, clearPassiveAudioDelayTimer, clearRecognitionRetryTimer, flushPendingStreamLog])

  const releasePassiveAudioCapture = useCallback(async () => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect?.()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      processorRef.current = null
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      sourceRef.current = null
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      analyserRef.current = null
    }

    if (zeroGainRef.current) {
      try {
        zeroGainRef.current.disconnect()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      zeroGainRef.current = null
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close()
      } catch (err) { console.debug('[flu] fallo de teardown ignorado:', err) }
      audioContextRef.current = null
    }

    await stopMediaStream(mediaStreamRef.current)
    mediaStreamRef.current = null
  }, [])

  const needsConversationPassiveAudio = useCallback(() => {
    const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
    if (!conversationActiveRef?.current) return true
    return (
      captureCfg.conversationUsePassiveAudio === true &&
      captureCfg.conversationAutoDiarize === true
    )
  }, [conversationActiveRef])

  const setupPassiveAudioCapture = useCallback(async () => {
    const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
    if (!needsConversationPassiveAudio()) {
      return
    }

    if (mediaStreamRef.current && audioContextRef.current && processorRef.current) {
      return
    }

    const conversationAudio = captureCfg.conversationAudio
    const roomCapture =
      conversationActiveRef?.current && captureCfg.captureRoomAudio !== false
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: conversationActiveRef?.current
        ? {
          echoCancellation: roomCapture
            ? (conversationAudio?.echoCancellation ?? false)
            : true,
          noiseSuppression: roomCapture
            ? (conversationAudio?.noiseSuppression ?? false)
            : true,
          autoGainControl: roomCapture
            ? (conversationAudio?.autoGainControl ?? false)
            : true,
        }
        : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
    })
    mediaStreamRef.current = stream
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    const audioContext = new AudioContextClass()
    audioContextRef.current = audioContext
    sampleRateRef.current = audioContext.sampleRate || 48000

    await audioContext.resume()

    const source = audioContext.createMediaStreamSource(stream)
    sourceRef.current = source

    const captureGain =
      conversationActiveRef?.current
        ? Number(FLU_CONFIG.voiceIdentity?.capture?.conversationAudio?.captureGain) || 8
        : 1

    const inputGain = audioContext.createGain()
    inputGain.gain.value = captureGain

    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.45
    analyserRef.current = analyser

    source.connect(inputGain)
    inputGain.connect(analyser)

    const processEvery = Math.max(
      1,
      Number(conversationAudio?.processEvery) ||
      Number(captureCfg.conversationAudioProcessEvery) ||
      1,
    )

    const micBridge = await wireMicCapturePipeline({
      audioContext,
      source: inputGain,
      sampleRate: sampleRateRef.current || 48000,
      processEvery,
      onPcmBlock: (input) => {
        chunksRef.current.push(new Float32Array(input))
        chunkTotalSamplesRef.current += input.length
        trimAudioChunkBuffer(
          chunksRef,
          sampleRateRef.current || 48000,
          FLU_CONFIG.voiceIdentity?.capture?.passiveBufferMs,
          chunkTotalSamplesRef,
        )
      },
    })

    processorRef.current = micBridge
    zeroGainRef.current = micBridge.zeroGain
  }, [needsConversationPassiveAudio])

  const schedulePassiveAudioCapture = useCallback(() => {
    const runCapture = () => {
      void setupPassiveAudioCapture().catch((_error) => {
        // audio opcional; SR sigue sin segundo stream
      })
    }

    if (!conversationActiveRef?.current) {
      runCapture()
      return
    }

    if (!needsConversationPassiveAudio()) {
      void releasePassiveAudioCapture()
      return
    }

    if (mediaStreamRef.current && processorRef.current) {
      return
    }

    clearPassiveAudioDelayTimer()
    const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
    const delayMs = Number(captureCfg.conversationPassiveAudioDelayMs) || 0
    if (delayMs <= 0) {
      runCapture()
      return
    }
    passiveAudioDelayTimerRef.current = window.setTimeout(() => {
      passiveAudioDelayTimerRef.current = null
      if (!isListeningRef.current) return
      runCapture()
    }, delayMs)
  }, [
    clearPassiveAudioDelayTimer,
    conversationActiveRef,
    needsConversationPassiveAudio,
    releasePassiveAudioCapture,
    setupPassiveAudioCapture,
  ])

  const wireRecognitionEvents = useCallback(
    (Recognition) => {
      const requireWake = !conversationActiveRef?.current

      Recognition.onstart = () => {
        recognitionActiveRef.current = true
        recognitionRetryCountRef.current = 0
        recognitionRestartPendingRef.current = false
        consecutiveEndsWithoutResultRef.current = 0
        lastOnresultAtRef.current = Date.now()
        lastMeaningfulIngressAtRef.current = Date.now()
        isListeningRef.current = true
        setStatus('listening')
        isProcessingRef.current = false
        if (import.meta.env.DEV && debugHotPath) {
          fluDebugHot('context', {
            status: 'listening',
            conversationActive: Boolean(conversationActiveRef?.current),
            logRowCount: -1,
          })
        }
        publishLiveImmediate()
      }

      Recognition.onresult = (event) => {
        // Supresión de eco: mientras FLU HABLA, ignorar resultados del
        // reconocedor para no capturar la propia voz y re-mandarla a la IA.
        // Se usa la promesa propia de FLU (`isFluSpeaking`, acotada por el
        // watchdog), NUNCA el flag global `speechSynthesis.speaking`: ese
        // quedaba pegado y silenciaba la escucha hasta recargar la página.
        if (isFluSpeaking()) {
          return
        }
        logMicRaw(event)
        lastOnresultAtRef.current = Date.now()
        recognitionRetryCountRef.current = 0
        consecutiveEndsWithoutResultRef.current = 0
        let interim = ''
        let finalText = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const transcript = cleanForSpeech(result?.[0]?.transcript || '')
          if (!transcript) continue

          if (conversationActiveRef?.current) {
            // Captura del micrófono para el PREVIEW. La publica el stream sync
            // (ÚNICO escritor), no este handler.
            if (result.isFinal) finalText = transcript
            else interim = transcript
            continue
          }

          const boundary = ''
          if (result.isFinal) {
            applyRecognitionResultWithBoundary(turnRef.current, {
              finalText: transcript,
              interimText: '',
              committedBoundary: boundary,
            })
          } else {
            interim = transcript
          }
        }

        if (conversationActiveRef?.current) {
          try {
            if (import.meta.env.DEV && debugHotPath) {
              const { interimChunks, finalChunks } = collectRecognitionResultChunks(event)
              fluDebugHot('mic-fragments', {
                rawInterims: interimChunks,
                rawFinals: finalChunks,
                mergedInterim: pickBestMicInterim(interimChunks),
              })
            }
            ingressRuntimeRef.current.pushMicRecognitionEvent(event)
          } catch (error) {
            console.error('[Flu][mic] onresult-conversation-failed', error)
            if (import.meta.env.DEV) {
              fluDebugHot('history-error', { detail: String(error?.message || error) })
            }
          }
          // §9 — ÚNICO escritor: el preview lo publica `handleConversationStreamSync`
          // (vía syncConversationStream, turnCommit:false). Este handler NO escribe
          // la frase viva: antes había dos escritores → alternancia/ciclo.
          const liveText = cleanForSpeech(finalText || interim)
          if (liveText) {
            syncConversationStream({
              capture: liveText,
              utterance: liveText,
              turnCommit: false,
            })
          }
          return
        }

        if (interim) {
          applyRecognitionResultWithBoundary(turnRef.current, {
            interimText: interim,
            committedBoundary: '',
          })
        }
        if (!conversationActiveRef?.current) {
          publishLiveFromTurn()
        }

        if (
          !conversationActiveRef?.current &&
          (isCommittingRef.current || isProcessingRef.current)
        ) {
          const lateText = getTranscriptDelta(
            commitBaselineRef.current,
            readCommandSnapshot(turnRef.current, pendingSpillRef.current),
          )
          if (lateText) {
            pendingSpillRef.current = appendSpillText(pendingSpillRef.current, lateText)
          }
        }

        finalizeGraceUsedRef.current = false

        const turnPhrase = readActiveSnapshot()
        const uiCommand = resolveNavigationCommand(turnPhrase)
        const validation = extractFluVoiceCommand(turnPhrase, {
          requireWake,
          wakeWords: resolvedWakeWords,
        })
        if (uiCommand === 'CERRAR_ESCUCHA') {
          scheduleAutoProcess(0)
          return
        }

        if (!turnPhrase) {
          clearAutoProcessTimer()
          return
        }

        if (validation.wakeWordMatched && !validation.commandText) {
          if (!conversationActiveRef?.current) {
            clearAutoProcessTimer()
          }
          return
        }

        const timingCfg = FLU_CONFIG.timing
        const baseDelay = validation.wakeWordMatched
          ? timingCfg.wakeWordCommandDelayMs
          : timingCfg.interimCommandDelayMs
        // Estabilización de fragmentos (Bug #3/#4): si el turno acumulado quedó
        // en un comando incompleto ("ok flu busca en la web" sin consulta,
        // "navega", "crea un video"…), NO se ejecuta todavía: se espera a que
        // llegue el siguiente fragmento final. Mientras tanto se amplía el
        // margen desde el último fragmento con incompleteCommandWaitMs.
        const turnDecision = decideVoiceTurnDispatch(turnPhrase, FLU_CONFIG.voiceCommands, {
          requireWake,
        })
        // Dictado: una frase larga en curso indica que el usuario sigue hablando
        // (p. ej. dictando una lista). Se amplía el margen antes de auto-procesar
        // para no cortarlo cuando hace una pausa breve pensando entre ítems.
        const wordCount = turnPhrase.trim().split(/\s+/).filter(Boolean).length
        let pauseDelay = baseDelay
        if (wordCount >= (timingCfg.dictationGraceWords || 0)) {
          const extra = Math.min(
            (timingCfg.dictationGraceBaseMs || 0) +
              (wordCount - (timingCfg.dictationGraceWords || 0)) *
                (timingCfg.dictationGracePerWordMs || 0),
            timingCfg.dictationGraceMaxMs || 0,
          )
          pauseDelay = baseDelay + extra
        }
        if (turnDecision.ready === false) {
          pauseDelay = Math.max(pauseDelay, timingCfg.incompleteCommandWaitMs || 0)
        }
        scheduleAutoProcess(pauseDelay)
      }

      Recognition.onerror = (event) => {
        const errorCode = String(event.error || '').trim()
        relayLog('LOG', 'useFluVoiceAssistant', '[REC] onerror', {
          error: errorCode,
          message: String(event.message || ''),
          isListening: isListeningRef.current,
          conversationActive: Boolean(conversationActiveRef?.current),
          isStopping: isStoppingRef.current,
          recognitionActive: recognitionActiveRef.current,
        })

        if (errorCode === 'no-speech' || errorCode === 'aborted') {
          if ((isListeningRef.current || (conversationActiveRef?.current && !isStoppingRef.current)) && !isStoppingRef.current) {
            requestRecognitionRestart(FLU_CONFIG.listening?.restartAfterNoSpeechMs)
          }
          return
        }

        if (conversationActiveRef?.current) {
          if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
            setStatus('idle')
            isProcessingRef.current = false
            cleanupAudio().catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
            return
          }
          if (errorCode === 'audio-capture' || errorCode === 'network') {
            setError('Micrófono o reconocimiento interrumpido. Reintentando…')
            window.setTimeout(() => setError(''), getFluTimingCfg().errorBannerClearMs)
          }
          requestRecognitionRestart(getRecognitionRetryDelay(errorCode))
          return
        }

        // Errores del motor local de transcripción (worker/WASM): se reintentan
        // solos; no son fallo del micrófono ni del usuario.
        if (errorCode === 'engine-error') {
          setError('')
          isProcessingRef.current = false
          requestRecognitionRestart(getRecognitionRetryDelay(errorCode))
          return
        }

        const recoverableError = isRecoverableRecognitionError(errorCode, false)
        if (recoverableError) {
          setError('')
          isProcessingRef.current = false
          requestRecognitionRestart(getRecognitionRetryDelay(errorCode))
          return
        }

        if (errorCode !== 'not-allowed' && errorCode !== 'service-not-allowed') {
          setError(
            getRecognitionErrorMessage(errorCode, FLU_CONFIG.ui?.recognitionErrors || {}),
          )
        }
        setStatus('idle')
        isProcessingRef.current = false
        cleanupAudio().catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
      }

      Recognition.onend = () => {
        recognitionActiveRef.current = false
        lastRecognitionEndAtRef.current = Date.now()
        relayLog('LOG', 'useFluVoiceAssistant', '[REC] onend', {
          isListening: isListeningRef.current,
          conversationActive: Boolean(conversationActiveRef?.current),
          isStopping: isStoppingRef.current,
          endStream: Boolean(conversationActiveRef?.current),
        })
        if (import.meta.env.DEV && debugHotPath && conversationActiveRef?.current) {
          fluDebugHot('recognition-end', {})
        }
        if (isStoppingRef.current) {
          if (recognitionEndResolverRef.current) {
            recognitionEndResolverRef.current()
            recognitionEndResolverRef.current = null
          }
          return
        }

        if (!isListeningRef.current && !(conversationActiveRef?.current && !isStoppingRef.current)) return

        if (conversationActiveRef?.current && !isStoppingRef.current) {
          ingressRuntimeRef.current?.pushRecognitionEndEvent({ immediate: true })
        }

        const streak = consecutiveEndsWithoutResultRef.current + 1
        consecutiveEndsWithoutResultRef.current = streak

        const timingCfg = getFluTimingCfg()
        const delay = conversationActiveRef?.current
          ? FLU_CONFIG.listening?.restartAfterEndMs
          : streak > timingCfg.passiveRestartStreakThreshold
            ? Math.min(
              timingCfg.passiveRestartStreakBaseMs + streak * timingCfg.passiveRestartStreakStepMs,
              timingCfg.passiveRestartStreakMaxMs,
            )
            : 0

        if (conversationActiveRef?.current) {
          const restartCfg = getConversationRestartConfig(true)
          requestRecognitionRestart(restartCfg.retryBackoffMs)
          return
        }

        requestRecognitionRestart(delay)
      }
    },
    [
      cleanupAudio,
      clearAutoProcessTimer,
      conversationActiveRef,
      publishLiveFromTurn,
      publishLiveImmediate,
      requestRecognitionRestart,
      scheduleAutoProcess,
      readActiveSnapshot,
      applyConversationSpeaker,
      commitTurnToSessionRows,
      syncConversationStream,
      setError,
      showListeningAck,
    ],
  )

  const rebuildRecognition = useCallback(() => {
    if (!isListeningRef.current || isStoppingRef.current) return false

    flushListenStateBeforeRebuild()

    const Recognition = createRecognition(language, recognitionLocaleRef.current)
    if (!Recognition) return false

    const previous = recognitionRef.current
    if (previous) {
      previous.onstart = null
      previous.onresult = null
      previous.onerror = null
      previous.onend = null
      stopSpeechRecognition(previous)
      previous.dispose?.()
    }

    recognitionRef.current = Recognition
    recognitionActiveRef.current = false
    wireRecognitionEvents(Recognition)

    if (!startSpeechRecognition(Recognition)) {
      return false
    }

    recognitionRetryCountRef.current = 0
    if (import.meta.env.DEV && debugHotPath) {
      fluDebugHot('stall-rebuild', { reason: 'rebuild-recognition' })
    }
    return true
  }, [flushListenStateBeforeRebuild, language, wireRecognitionEvents])

  rebuildRecognitionRef.current = rebuildRecognition

  const maybeSwitchRecognitionLocale = useCallback(
    (interimText = '') => {
      if (!isBilingualListenMode(language)) return

      const text = cleanForSpeech(interimText)
      const { bilingual } = FLU_CONFIG.activeListen
      const minChars = Number(bilingual?.minCharsToSwitch) || 10
      if (text.length < minChars) return

      const detected = detectTranscriptLanguage(text)
      const nextLocale = resolveRecognitionLocale('both', detected)
      if (nextLocale === recognitionLocaleRef.current) {
        localeSwitchDetectRef.current = ''
        localeSwitchCountRef.current = 0
        return
      }

      if (localeSwitchDetectRef.current === detected) {
        localeSwitchCountRef.current += 1
      } else {
        localeSwitchDetectRef.current = detected
        localeSwitchCountRef.current = 1
      }

      const stable = Number(bilingual?.stableInterims) || 2
      if (localeSwitchCountRef.current < stable) return

      recognitionLocaleRef.current = nextLocale
      localeSwitchDetectRef.current = ''
      localeSwitchCountRef.current = 0
      if (import.meta.env.DEV && debugHotPath) {
        fluDebugHot('stall-rebuild', {
          reason: 'bilingual-locale',
          locale: nextLocale,
          detected,
        })
      }
      rebuildRecognitionRef.current()
    },
    [language],
  )
  maybeSwitchRecognitionLocaleRef.current = maybeSwitchRecognitionLocale

  const injectSimulatedRecognition = useCallback(
    (events = []) => {
      if (!conversationActiveRef?.current) {
        fluEvent('sim-abort', { reason: 'conversation-not-active' })
        return { ok: false, accumulated: '' }
      }

      clearListenLogRing()
      ingressRuntimeRef.current?.reset()
      fluEvent('sim-start', { events: events.length })

      for (const mockEvent of convertSimEventsToMicBursts(events)) {
        ingressRuntimeRef.current?.pushMicRecognitionEvent(mockEvent)
      }

      ingressRuntimeRef.current?.drainAll()

      const accumulated = listenStateRef.current.transcript
      fluEvent('sim-done', { accumulatedLen: accumulated.length })
      if (import.meta.env.DEV) {
        window.__fluListenLog = getListenLogRing()
      }
      return { ok: true, accumulated }
    },
    [conversationActiveRef],
  )

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    window.__fluDev = {
      ...(window.__fluDev || {}),
      getListenLog: getListenLogRing,
      clearListenLog: clearListenLogRing,
      enableListenTrace: () => {
        window.__FLU_LISTEN_DEBUG = true
      },
      simulateRecognition: injectSimulatedRecognition,
      debug: getFluDebugApi(),
    }
    return () => {
      if (window.__fluDev) {
        delete window.__fluDev.getListenLog
        delete window.__fluDev.clearListenLog
        delete window.__fluDev.enableListenTrace
        delete window.__fluDev.simulateRecognition
        delete window.__fluDev.debug
      }
    }
  }, [injectSimulatedRecognition])

  const startListening = useCallback(async ({ resume = false } = {}) => {
    setError('')
    if (!isSupported) {
      setError('El navegador no soporta el flujo de voz de Flu.')
      return
    }

    if (isProcessingRef.current) {
      if (status !== 'processing') {
        isProcessingRef.current = false
      } else {
        return
      }
    }

    if (resume && recognitionRef.current) {
      clearAllCommitTimers()
      clearRecognitionRetryTimer()
      isStoppingRef.current = false
      isListeningRef.current = true
      isProcessingRef.current = false
      recognitionRetryCountRef.current = 0
      setStatus('listening')
      setError('')
      if (conversationActiveRef?.current) {
        // Reuse-first: the existing instance is STILL wired (suspend only
        // aborted/stopped it; handlers were not nulled). Restart it directly
        // instead of a per-turn teardown + rebuild + rewire (dead time +
        // resource waste). Mirrors requestRecognitionRestart's fallback chain.
        if (startSpeechRecognition(recognitionRef.current)) {
          recognitionRetryCountRef.current = 0
        } else if (rebuildRecognitionRef.current()) {
          recognitionRetryCountRef.current = 0
        } else {
          requestRecognitionRestart(0)
        }
      } else if (!recognitionActiveRef.current) {
        requestRecognitionRestart(0)
      }
      schedulePassiveAudioCapture()
      return
    }

    try {

      if (!resume) {
        lastTurnSignatureRef.current = null
      }
      clearTurnBuffers()
      chunksRef.current = []
      chunkTotalSamplesRef.current = 0
      if (!resume) {
        resetActiveListenState(listenStateRef.current)
        pendingSpillRef.current = ''
        publishedLiveRef.current = ''
        setLiveTranscript('')
      }
      clearAllCommitTimers()
      clearRecognitionRetryTimer()
      isListeningRef.current = false
      isStoppingRef.current = false
      recognitionRetryCountRef.current = 0
      recognitionLocaleRef.current = getRecognitionLanguage(language)
      localeSwitchDetectRef.current = ''
      localeSwitchCountRef.current = 0

      const Recognition = createRecognition(language, recognitionLocaleRef.current)
      if (!Recognition) {
        throw new Error('SpeechRecognition no esta disponible en este navegador.')
      }

      recognitionRef.current = Recognition
      isProcessingRef.current = false
      wireRecognitionEvents(Recognition)

      setStatus('listening')
      isProcessingRef.current = false
      isListeningRef.current = true

      if (!startSpeechRecognition(Recognition)) {
        requestRecognitionRestart(getActiveListenConfig().restart.retryBackoffMs)
      }


      schedulePassiveAudioCapture()
    } catch (caughtError) {
      if (recognitionRef.current && isListeningRef.current) {
        return
      }
      await cleanupAudio()
      setStatus('idle')
      isProcessingRef.current = false
      setError(caughtError?.message || 'No se pudo iniciar la escucha.')
    }
  }, [
    clearAllCommitTimers,
    clearTurnBuffers,
    cleanupAudio,
    conversationActiveRef,
    isSupported,
    language,
    publishLive,
    publishLiveFromTurn,
    publishLiveImmediate,
    scheduleAutoProcess,
    wireRecognitionEvents,
    schedulePassiveAudioCapture,
    requestRecognitionRestart,
    releasePassiveAudioCapture,
    status,
    clearRecognitionRetryTimer,
  ])

  const commitConversationTurn = useCallback(
    async ({ closing = false } = {}) => {
      clearAutoProcessTimer()

      try {
        if (closing && recognitionRef.current) {
          relayLog('LOG', 'useFluVoiceAssistant', '[REC] stop: commitConversationTurn(closing)', {
            isListening: isListeningRef.current,
            conversationActive: Boolean(conversationActiveRef?.current),
          })
          isStoppingRef.current = true
          await finalizeRecognition()
          isStoppingRef.current = false
        }

        const capture =
          readStreamDisplay(listenStateRef.current) ||
          cleanForSpeech(listenStateRef.current.pendingInterim)
        const result = sealPendingInterim(listenStateRef.current)
        if (capture) {
          syncConversationStream({
            capture,
            newParagraph: result.newParagraph,
            speaker: result.speaker,
            utterance: capture,
            turnCommit: true,
          })
        }

        if (closing) {
          isListeningRef.current = false
          await cleanupAudio()
          setStatus('idle')
        }
      } catch {
        if (closing) {
          isListeningRef.current = false
          await cleanupAudio().catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
          setStatus('idle')
        }
      } finally {
        if (isListeningRef.current && !isStoppingRef.current && !recognitionActiveRef.current) {
          requestRecognitionRestart(0)
        }
      }
    },
    [
      cleanupAudio,
      clearAutoProcessTimer,
      finalizeRecognition,
      syncConversationStream,
      requestRecognitionRestart,
    ],
  )

  const emitActiveConversationCommand = useCallback(
    async (command, transcript, { conversationCommandPreLogged = false } = {}) => {
      const cleaned = cleanForSpeech(transcript)
      clearAutoProcessTimer()

      const commandSpeaker =
        lastLoggedSpeakerRef.current || lastSpeakerRef.current || 'Hablante 1'

      const shouldBlockParticipantFloorGrant = () => {
        const participant = fluParticipantRef.current
        if (!participant) return true
        if (!participant.canAcceptFloorGrant?.()) return true
        if (participant.shouldIgnoreDuplicateFloorGrant?.()) return true
        return false
      }

      if (command === 'INICIAR_CONVERSACION') {
        resetActiveListenState(listenStateRef.current)
        lastEmittedTranscriptRef.current = ''
        openPreviewTurnRef.current = false
        turnAudioStartSampleRef.current = 0
        lastStreamPreviewRef.current = ''
        lastLogLineTextRef.current = ''
        lastLogLineAtRef.current = 0
        lastLoggedCaptureRef.current = ''
        setSpeakerClusters([])
        lastSpeakerRef.current = 'Hablante 1'
        lastLoggedSpeakerRef.current = 'Hablante 1'
        sessionPrimarySpeakerRef.current = ''
        // Fase E: tras reiniciar la sesión, re-sembrar el participante activo (Juan/Luis)
        // como sessionPrimary para que sus turnos sigan etiquetándose con su nombre.
        seedSessionPrimaryFromActiveName()
        activeTurnIdRef.current = 0
        preflightScheduledForTurnRef.current = false
        stopAllContinuousIdentityPipelines()
        lastTurnSignatureRef.current = null
        resetTurnState(turnRef.current)
        pendingSpillRef.current = ''
        publishedLiveRef.current = ''
        setLiveTranscript('')
        fluParticipantRef.current?.resetParticipant?.()
      } else if (cleaned) {
        releaseTurnAfterLog(cleaned)
      } else {
        releaseTurnAfterLog('')
      }

      if (command === 'FLU_ESPERA') {
        fluParticipantRef.current?.dismissRaisedHand?.()
        await commitAndResolveTurn({
          capture: cleaned,
          contract: {
            respuesta_voz: getCommandSpeech('FLU_ESPERA', language),
            navegacion: { comando: null, destino: null, parametros: {} },
          },
          diagnostics: null,
          speakerName: commandSpeaker,
          speakerAlias: null,
          phase,
          timestamp: formatClock(),
          signature: null,
          language: detectTranscriptLanguage(transcript),
          conversationCommandPreLogged,
        })
        return
      }

      if (command === 'FLU_ADELANTE') {
        const commandSpeaker =
          lastLoggedSpeakerRef.current || lastSpeakerRef.current || 'Hablante 1'
        const participant = fluParticipantRef.current
        const respondParticipantFloor = async (speechText, { floor = false } = {}) => {
          await commitAndResolveTurn({
            capture: cleaned,
            contract: {
              respuesta_voz: speechText,
              navegacion: { comando: null, destino: null, parametros: {} },
            },
            diagnostics: null,
            speakerName: commandSpeaker,
            speakerAlias: null,
            phase,
            timestamp: formatClock(),
            signature: null,
            language: detectTranscriptLanguage(transcript),
            participantFloor: floor,
            conversationCommandPreLogged,
          })
        }

        if (!participant?.canAcceptFloorGrant?.()) {
          await participant?.evaluateOnDemand?.()
        }

        // FIX palabra tragada: si "ok flu adelante" llega mientras FLU está hablando
        // (TTS ocupado, synth.speaking/pending), shouldBlockParticipantFloorGrant()
        // bloquea la concesión y la intervención se pierde ("No tengo nada pendiente").
        // Si el participante tiene la mano alzada y el TTS está ocupado, ESPERAR a que
        // termine el habla actual y revalidar la concesión en lugar de tragar el turno.
        const handRaised = participant?.hasRaisedHand?.() === true
        if (handRaised && isSpeechBusy()) {
          if (import.meta.env.DEV && debugHotPath) {
            fluDebugHot('participant-floor-queued-wait', {
              speaking: isSpeechSynthesisSpeaking(),
            })
          }
          await waitForSpeechIdle()
        }

        if (shouldBlockParticipantFloorGrant()) {
          if (import.meta.env.DEV && debugHotPath) {
            fluDebugHot('participant-floor-ignored', {
              raised: participant?.hasRaisedHand?.() === true,
              speaking: isSpeechSynthesisSpeaking(),
            })
          }
          await respondParticipantFloor(getCommandSpeech('FLU_ADELANTE_EMPTY', language))
          return
        }

        const draft = participant?.consumeRaisedDraft?.() || ''
        if (!draft) {
          await respondParticipantFloor(getCommandSpeech('FLU_ADELANTE_EMPTY', language))
          return
        }

        participant?.beginFloorDelivery?.()
        commitSessionTurn(draft, FLU_DIALOGUE_SPEAKER)
        try {
          await respondParticipantFloor(draft, { floor: true })
          participant?.recordInterventionDelivered?.()
          await persistDialogueSession()
        } finally {
          participant?.endFloorDelivery?.()
        }
        return
      }

      await commitAndResolveTurn({
        capture: cleaned,
        contract: {
          respuesta_voz: getCommandSpeech(command, language),
          navegacion: {
            comando: command,
            destino: null,
            parametros: {},
          },
        },
        diagnostics: null,
        speakerName: commandSpeaker,
        speakerAlias: null,
        phase,
        timestamp: formatClock(),
        signature: null,
        language: detectTranscriptLanguage(transcript),
        conversationCommandPreLogged,
      })
    },
    [commitAndResolveTurn, commitSessionTurn, language, persistDialogueSession, phase, releaseTurnAfterLog],
  )

  const dispatchPassiveVoiceCommand = useCallback(
    async (uiCommand, transcript) => {
      if (!uiCommand || !conversationActiveRef?.current) return

      clearAutoProcessTimer()
      clearStreamLogTimer()
      pendingStreamLogRef.current = null

      const preserveWake = FLU_CONFIG.voiceCommands.commandLogPreserveWake !== false
      const phrase = preserveWake
        ? pickRichestVoiceCommandCapture(transcript, {
          publishedLive: publishedLiveRef.current,
          lastEmitted: lastEmittedTranscriptRef.current,
          streamDisplay: readStreamDisplay(listenStateRef.current),
        }) || cleanForSpeech(transcript)
        : cleanForSpeech(transcript)
      const wakeAnalysis = analyzeWakeTurn(phrase, {
        lastCommitted: userRowsTextView.current.at(-1) || '',
      })
      const passivePrefix = wakeAnalysis.passiveOnly
      const commandLogText = wakeAnalysis.commandLogText
      let conversationCommandPreLogged = false

      if (passivePrefix) {
        syncConversationStream({
          capture: passivePrefix,
          utterance: passivePrefix,
          turnCommit: true,
          diarize: true,
          atTurnBoundary: true,
        })
      }

      if (
        commandLogText &&
        commandLogText !== passivePrefix &&
        !isSessionResetCommand(uiCommand)
      ) {
        syncConversationStream({
          capture: commandLogText,
          utterance: commandLogText,
          turnCommit: true,
          diarize: true,
          atTurnBoundary: true,
        })
        conversationCommandPreLogged = true
      }

      openPreviewTurnRef.current = false
      listenStateRef.current.openLine = ''
      listenStateRef.current.pendingInterim = ''
      publishedLiveRef.current = ''
      setLiveTranscript('')

      if (import.meta.env.DEV && debugHotPath) {
        fluDebugHot('conversation-command', { command: uiCommand, phrase })
      }

      await emitActiveConversationCommand(uiCommand, phrase, { conversationCommandPreLogged })
    },
    [
      clearAutoProcessTimer,
      clearStreamLogTimer,
      conversationActiveRef,
      emitActiveConversationCommand,
      syncConversationStream,
    ],
  )

  const grantParticipantFloor = useCallback(async () => {
    if (fluParticipantRef.current?.shouldIgnoreDuplicateFloorGrant?.()) return
    const wakeWord = String(resolvedWakeWords[0] || 'flu').trim()
    const phrase = `ok ${wakeWord} adelante`
    await emitActiveConversationCommand('FLU_ADELANTE', phrase)
  }, [emitActiveConversationCommand])

  // ============================================================
  // FAST-PATH DETERMINISTA (configuración por voz instantánea)
  // ============================================================
  // resolveConfigCommandFromText() resuelve comandos de configuración de forma
  // DETERMINISTA y síncrona (sin red). Este helper los despacha por la MISMA ruta
  // única (onContractResolved → applyConfigAction) apenas se captura el transcript,
  // en paralelo con la llamada a la IA: la configuración se aplica de inmediato
  // mientras la IA solo genera la confirmación verbal. El contrato tardío (con
  // respuesta_voz) llega después con configuracion anulada (idempotencia: sin
  // doble aplicación). Nunca dispara en conversación casual: el resolver tiene
  // triple guardia (verbo + nombre + contexto) y aquí se exige det.accion.
  const dispatchFastConfigCommand = useCallback(
    async (
      configuracion,
      { speakerName = null, speakerAlias = null, phase = 'SESION_ACTIVA', session = null, language = null, transcript = '', timestamp = '' } = {},
    ) => {
      if (!configuracion?.accion) return null
      await onContractResolved?.({
        contract: {
          respuesta_voz: '',
          navegacion: { comando: null, destino: null, parametros: {} },
          workspace: null,
          musica: null,
          configuracion,
          metadata: { provider: 'deterministic-fast-path', transcript, rawText: '' },
        },
        diagnostics: { route: 'deterministic-fast-path', provider: 'local', fastPath: true },
        transcript,
        speakerName,
        speakerAlias,
        phase,
        session,
        timestamp,
        signature: null,
        language,
        fastPathConfig: true,
      })
      return configuracion
    },
    [onContractResolved],
  )

  // Fast-path determinista de JUEGO (espejo de dispatchFastConfigCommand): despacha
  // un contrato `juego` ya resuelto por resolveGameCommandFromText a la ÚNICA ruta
  // (onContractResolved → applyGameAction). El motor local (src/core/games/*) es la
  // fuente de verdad: Gemini nunca arbitra el estado de la partida. Si no hay acción
  // de juego, no hace nada (guardia estricta: requiere gameId resuelto).
  const dispatchFastGameCommand = useCallback(
    async (
      juego,
      { speakerName = null, speakerAlias = null, phase = 'SESION_ACTIVA', session = null, language = null, transcript = '', timestamp = '' } = {},
    ) => {
      if (!juego?.gameId) return null
      await onContractResolved?.({
        contract: {
          respuesta_voz: '',
          navegacion: { comando: null, destino: null, parametros: {} },
          workspace: null,
          musica: null,
          configuracion: null,
          juego,
          metadata: { provider: 'deterministic-fast-path', transcript, rawText: '' },
        },
        diagnostics: { route: 'deterministic-fast-path', provider: 'local', fastPath: true },
        transcript,
        speakerName,
        speakerAlias,
        phase,
        session,
        timestamp,
        signature: null,
        language,
        fastPathGame: true,
      })
      return juego
    },
    [onContractResolved],
  )

  // Fast-path determinista de AMBIENTE (espejo de dispatchFastGameCommand): despacha
  // un contrato `ambiente` ya resuelto por resolveEnvironmentIntent a la ÚNICA ruta
  // (onContractResolved → applyEnvironment/resetEnvironment). El catálogo de ambientes
  // (src/core/environments/*) es la fuente de verdad: el rebranding se aplica de
  // inmediato mientras la IA solo genera la confirmación verbal. Si no hay intent,
  // no hace nada (guardia estricta: requiere tipo resuelto).
  const dispatchFastEnvironmentCommand = useCallback(
    async (
      intent,
      { speakerName = null, speakerAlias = null, phase = 'SESION_ACTIVA', session = null, language = null, transcript = '', timestamp = '' } = {},
    ) => {
      if (!intent?.tipo) return null
      await onContractResolved?.({
        contract: {
          respuesta_voz: '',
          navegacion: { comando: null, destino: null, parametros: {} },
          workspace: null,
          musica: null,
          configuracion: null,
          juego: null,
          ambiente: intent,
          metadata: { provider: 'deterministic-fast-path', transcript, rawText: '' },
        },
        diagnostics: { route: 'deterministic-fast-path', provider: 'local', fastPath: true },
        transcript,
        speakerName,
        speakerAlias,
        phase,
        session,
        timestamp,
        signature: null,
        language,
        fastPathEnvironment: true,
      })
      return intent
    },
    [onContractResolved],
  )

  // §3.1 — Árbitro determinista UNIFICADO. Centraliza la resolución y el despacho de
  // los tres fast-paths deterministas (configuración/juego/ambiente) que antes se
  // duplicaban en processConversationFluQuery y en las dos ramas de processCapture.
  // Resuelve cada dominio desde el texto y lanza su despacho por la ÚNICA ruta
  // (onContractResolved). Devuelve los objetos resueltos (para la idempotencia del
  // contrato tardío) y un `dispatch` (Promise.allSettled que nunca rechaza) para que
  // cada llamador decida cuándo esperarlo: en paralelo con la IA en conversación, o
  // fire-and-forget antes de la confirmación verbal en captura.
  const evaluateDeterministicFastPaths = useCallback(
    async ({
      text,
      speakerName = null,
      speakerAlias = null,
      phase = 'SESION_ACTIVA',
      session = null,
      language = null,
      timestamp = '',
    }) => {
      const transcript = cleanForSpeech(text)
      // §1A: la resolución de los dominios con efecto de estado (config/juego/
      // ambiente) se delega al árbitro puro (src/voice/lib/deterministicArbiter.js).
      // El hook conserva SOLO la orquestación del despacho (onContractResolved).
      const { config, game, env } = resolveStatefulDomains(text, { language })
      const dispatch = Promise.allSettled([
        config?.accion
          ? dispatchFastConfigCommand(config, {
              speakerName,
              speakerAlias,
              phase,
              session,
              language,
              timestamp,
              transcript,
            })
          : Promise.resolve(null),
        game?.gameId
          ? dispatchFastGameCommand(game, {
              speakerName,
              speakerAlias,
              phase,
              session,
              language,
              timestamp,
              transcript,
            })
          : Promise.resolve(null),
        env?.tipo
          ? dispatchFastEnvironmentCommand(env, {
              speakerName,
              speakerAlias,
              phase,
              session,
              language,
              timestamp,
              transcript,
            })
          : Promise.resolve(null),
      ])
      return { config, game, env, dispatch }
    },
    [dispatchFastConfigCommand, dispatchFastGameCommand, dispatchFastEnvironmentCommand],
  )

  const processConversationFluQuery = useCallback(
    async (fullTranscript, { beforeWake = '', question = '' } = {}) => {
      relayLog('LOG', 'useFluVoiceAssistant', `processConversationFluQuery ENTER: conversationActiveRef.current=${conversationActiveRef?.current}, question="${(question || '').slice(0, 60)}"`)
      if (!conversationActiveRef?.current || !question) {
        relayLog('WARN', 'useFluVoiceAssistant', `processConversationFluQuery EXIT EARLY: conversationActiveRef.current=${conversationActiveRef?.current}, question="${(question || '').slice(0, 60)}"`)
        return
      }

      openPreviewTurnRef.current = false
      listenStateRef.current.openLine = ''
      listenStateRef.current.pendingInterim = ''
      // §9: UNA sola frase canónica para el turno. Display y fila de
      // conversación salen de ESTE mismo valor (con wake word), no de dos
      // derivaciones distintas. Se commitea AQUÍ (commitOnly) para que la
      // transcripción sea visible de inmediato, sin esperar a la IA; la
      // resolución posterior re-commitea el mismo valor.
      const canonicalPhrase = await commitAndResolveTurn({
        capture: fullTranscript || question,
        commitOnly: true,
      })
      // §9: la query se deriva de la MISMA fila canónica por el derivador único.
      question =
        deriveQueryFromRow(canonicalPhrase, FLU_CONFIG.voiceCommands).question || question
      publishedLiveRef.current = ''
      setLiveTranscript('')

      const sampleRate = sampleRateRef.current || 48000
      const streamSamples = flattenChunks(chunksRef.current)
      const audioSnapshot = streamSamples.length ? new Float32Array(streamSamples) : new Float32Array(0)
      const fallbackSpeaker = lastSpeakerRef.current || 'Hablante 1'
      const currentClock = formatClock()
      const detectedLanguage = detectTranscriptLanguage(question)

      setStatus('processing')
      isProcessingRef.current = true
      setError('')
      // FIX estabilidad: `resolvedSpeakerName`, `speakerAlias` y `audioSignatureVector`
      // se declaran FUERA del try porque el bloque catch los referencia. En JS
      // let/const tienen ámbito de bloque, así que declararlos dentro del try lanzaba
      // `ReferenceError: ... is not defined` en el path de error (cuando la IA falla),
      // tumbando la UI de React.
      let resolvedSpeakerName = fallbackSpeaker
      let speakerAlias = null
      let audioSignatureVector = null
      try {
        // Fase 2: la conversación está SIEMPRE activa aquí (early-return arriba), así
        // que applyConversationSpeaker es la fuente de verdad del orador. Se aplica de
        // forma síncrona ANTES del lote paralelo para que la API ya reciba el speaker.
        if (conversationActiveRef?.current) {
          resolvedSpeakerName = applyConversationSpeaker(fullTranscript || question, fallbackSpeaker, {
            atTurnBoundary: true,
            allowNewCluster: true,
            force: true,
          })
          speakerAlias = null
        }

        // §2B — Semántica "si hay match determinista de estado → NO llamar a Gemini".
        // Controlado por FLU_CONFIG.arbiter.skipGeminiOnMatch (por defecto APAGADO).
        // La decisión + construcción del contrato determinista se delega a la función
        // pura `resolveDeterministicSkipGeminiContract` (testeable sin React, paso 3B).
        // Cuando devuelve un contrato (flag activo + match de config/juego/ambiente),
        // se despacha con la frase de cortesía y se omite por completo la llamada a
        // Gemini (requestFluContractForTranscript NO se invoca). Para juego/ambiente el
        // motor local ya habla su propia voz, así que la frase de cortesía es '' (no se
        // duplica el habla).
        const skipGemini = resolveDeterministicSkipGeminiContract({
          text: question || fullTranscript,
          language: detectedLanguage,
          skipGeminiOnMatch: Boolean(FLU_CONFIG.arbiter?.skipGeminiOnMatch),
        })
        if (skipGemini) {
          const { domain: statefulDomain, contract: deterministicContract } = skipGemini
          const courtesy = deterministicContract.respuesta_voz || ''
          setLastContract(deterministicContract)
          setLastDiagnostics({ route: 'deterministic-arbiter', provider: 'local', skipGemini: true })
          setError('')
          setLastErrorEvent(null)
          await saveSessionState({
            phase: 'SESION_ACTIVA',
            ...session,
            history: getConversationContext(),
          })
          relayLog('LOG', 'useFluVoiceAssistant', `processConversationFluQuery §2B deterministic (skip Gemini): domain="${statefulDomain}", respuesta_voz="${courtesy.slice(0, 80)}"`)
          await commitAndResolveTurn({
            capture: canonicalPhrase,
            contract: deterministicContract,
            diagnostics: { route: 'deterministic-arbiter', provider: 'local', skipGemini: true },
            conversationCommandPreLogged: Boolean(cleanForSpeech(beforeWake)),
            speakerName: resolvedSpeakerName,
            speakerAlias,
            phase: 'SESION_ACTIVA',
            session,
            timestamp: currentClock,
            signature: (await computeTurnSignature(audioSnapshot, sampleRate)).vector,
            language: detectedLanguage,
            fastPathConfig: statefulDomain === 'config',
            fastPathGame: statefulDomain === 'game',
            fastPathEnvironment: statefulDomain === 'environment',
          })
          return
        }

        // TRACE escenario: ¿el árbitro determinista matchearía reminder/temporal/
        // nota/horario sobre la question ANTES de llamar a Gemini? Esto muestra si el
        // mandato ("crea una cita...", "pon una alarma...") debía despacharse sin IA.
        try {
          const probe = resolveDeterministicCommand(question, {
            language: detectedLanguage,
          })
          relayLog(
            'LOG',
            'useFluVoiceAssistant',
            `processConversationFluQuery TRACE: determinista sobre question="${(question || '').slice(0, 80)}" → matched=${Boolean(probe?.matched)} domain="${probe?.domain || ''}" action="${JSON.stringify(probe?.action?.action ?? probe?.action ?? null)?.slice(0, 120)}"`,
          )
        } catch (probeError) {
          relayLog('WARN', 'useFluVoiceAssistant', `processConversationFluQuery TRACE determinista lanzó: ${probeError?.message || probeError}`)
        }

        const knowledgeMode = isMinuteKnowledgeRequest(question) ? 'minutes' : 'general'
        setActiveKnowledgeBase(knowledgeMode)

        // Fase 2: orador + llamada API + firma de audio en PARALELO. La firma se
        // calcula UNA vez y se reutiliza en ambos caminos de onContractResolved.
        const [speakerResult, contractResult, signatureResult, fastPathResult] = await Promise.allSettled([
          resolveSpeaker(question, audioSnapshot, sampleRate, fallbackSpeaker),
          requestFluContractForTranscript({
            transcript: question,
            knowledgeMode,
            intent: { comando: null, destino: null, parametros: {} },
            speaker: resolvedSpeakerName,
            theme: session.theme,
            role: session.role,
            phase: 'SESION_ACTIVA',
          }),
          computeTurnSignature(audioSnapshot, sampleRate).then((s) => s.vector),
          // Fast-path determinista UNIFICADO (§3.1): el árbitro resuelve y despacha
          // configuración/juego/ambiente desde un único punto, en paralelo con la IA.
          // Se espera su `dispatch` para garantizar el orden: el efecto del fast-path
          // queda aplicado ANTES de que el contrato tardío (con idempotencia) llegue a
          // onContractResolved.
          (async () => {
            const result = await evaluateDeterministicFastPaths({
              text: question || fullTranscript,
              speakerName: resolvedSpeakerName,
              speakerAlias,
              phase: 'SESION_ACTIVA',
              session,
              language: detectedLanguage,
              timestamp: currentClock,
            })
            await result.dispatch
            return result
          })(),
        ])
        const fastPath = fastPathResult?.status === 'fulfilled' ? fastPathResult.value : null
        const fastPathConfig = fastPath?.config
        const fastGame = fastPath?.game
        const fastEnv = fastPath?.env

        // La llamada API es el único resultado obligatorio: si falla, propagar al catch.
        if (contractResult.status === 'rejected') {
          throw contractResult.reason
        }
        const contract = contractResult.value

        // Mantener fallback del plan: si resolveSpeaker falla se usa fallbackSpeaker.
        // En modo conversación (siempre activo aquí) applyConversationSpeaker ya decidió.
        if (speakerResult.status === 'fulfilled' && speakerResult.value && !conversationActiveRef?.current) {
          resolvedSpeakerName =
            speakerResult.value.resolvedSpeakerName || speakerResult.value.speakerName || resolvedSpeakerName
          speakerAlias = speakerResult.value.speakerAlias ?? speakerAlias
        }

        // Firma de audio reutilizable; fallback perezoso si el cálculo paralelo falló.
        audioSignatureVector = signatureResult.status === 'fulfilled' ? signatureResult.value : null

        // §1A: re-resolución determinista tardía (config/ambiente) para la idempotencia
        // del contrato. Se delega al árbitro puro; solo se usa cuando el fast-path NO
        // despachó (para que la resolución determinista gane sobre la del modelo).
        const lateStateful = resolveStatefulDomains(question || fullTranscript, { language: detectedLanguage })

        const resolvedContract = {
          ...contract.contract,
          respuesta_voz: contract.contract.respuesta_voz,
          navegacion: contract?.contract?.navegacion || {
            comando: null,
            destino: null,
            parametros: {},
          },
          // Idempotencia fast-path: si el árbitro determinista ya aplicó la
          // configuración, se anula la del contrato tardío para NO duplicar el efecto.
          // Si no hubo fast-path, se conserva la resolución determinista sobre la del
          // modelo. La re-resolución se delega al árbitro puro (§1A).
          configuracion:
            fastPathConfig?.accion
              ? null
              : lateStateful.config?.accion
                ? lateStateful.config
                : contract?.contract?.configuracion,
          // Idempotencia de juego: si el fast-path de juego ya despachó (start/turn/
          // end), se anula el `juego` del contrato tardío para NO duplicar el efecto.
          // La voz del turno ya la habló el motor local (determinista).
          juego: fastGame?.gameId ? null : contract?.contract?.juego ?? null,
          // Idempotencia de ambiente: si el fast-path de ambiente ya despachó
          // (activar/reset), se anula el `ambiente` del contrato tardío para NO
          // duplicar el rebranding ni la bienvenida hablada.
          ambiente: fastEnv?.tipo
            ? null
            : lateStateful.env?.tipo
              ? lateStateful.env
              : contract?.contract?.ambiente ?? null,
        }

        setLastContract(resolvedContract)
        setLastDiagnostics(contract.diagnostics || null)
        setError('')
        setLastErrorEvent(null)
        await saveSessionState({
          phase: 'SESION_ACTIVA',
          ...session,
          history: getConversationContext(),
        })

        relayLog('LOG', 'useFluVoiceAssistant', `processConversationFluQuery calling commitAndResolveTurn with respuesta_voz="${(resolvedContract.respuesta_voz || '').slice(0, 80)}"`)
        await commitAndResolveTurn({
          capture: canonicalPhrase,
          contract: resolvedContract,
          diagnostics: contract.diagnostics || null,
          conversationCommandPreLogged: Boolean(cleanForSpeech(beforeWake)),
          speakerName: resolvedSpeakerName,
          speakerAlias,
          phase: 'SESION_ACTIVA',
          session,
          timestamp: currentClock,
          signature: audioSignatureVector ?? (await computeTurnSignature(audioSnapshot, sampleRate)).vector,
          language: detectedLanguage,
          // En juegos por voz la voz es SIEMPRE del motor local (determinista).
          fastPathGame: Boolean(fastGame?.gameId),
          // En ambientes por voz la bienvenida la habla SIEMPRE el motor local.
          fastPathEnvironment: Boolean(fastEnv?.tipo),
        })
      } catch (error) {
        relayLog('ERROR', 'useFluVoiceAssistant', `processConversationFluQuery CATCH: message="${error?.message || error}", code="${error?.code}", status="${error?.status}"`)
        reportGeminiFailure(error, { phase: 'SESION_ACTIVA', transcript: fullTranscript })
        // Also notify the UI (FluShell) so FLU speaks the error to the user
        const errorMessage = formatGeminiUserMessage(error, language, { fallback: true })
        relayLog('LOG', 'useFluVoiceAssistant', `processConversationFluQuery catch calling commitAndResolveTurn with errorMessage="${(errorMessage || '').slice(0, 80)}"`)
        await commitAndResolveTurn({
          capture: canonicalPhrase,
          contract: {
            respuesta_voz: errorMessage,
            navegacion: { comando: null, destino: null, parametros: {} },
            workspace: null,
            metadata: { provider: 'error', transcript: fullTranscript, rawText: '' },
          },
          diagnostics: buildGeminiDiagnosticsFromError(error),
          conversationCommandPreLogged: Boolean(cleanForSpeech(beforeWake)),
          speakerName: resolvedSpeakerName || 'FLU',
          speakerAlias: null,
          phase: 'SESION_ACTIVA',
          session,
          timestamp: currentClock,
          signature: audioSignatureVector ?? (await computeTurnSignature(audioSnapshot, sampleRate)).vector,
          language: detectedLanguage,
        })
        if (isListeningRef.current && !recognitionActiveRef.current) {
          requestRecognitionRestart(FLU_CONFIG.timing.resumeAfterSpeechMs)
        }
      } finally {
        isProcessingRef.current = false
        if (isListeningRef.current) {
          setStatus('listening')
        } else {
          setStatus('idle')
        }
      }
    },
    [
      conversationActiveRef,
      commitAndResolveTurn,
      getConversationContext,
      requestFluContractForTranscript,
      requestRecognitionRestart,
      reportGeminiFailure,
      resolveSpeaker,
      applyConversationSpeaker,
      session,
      dispatchFastConfigCommand,
      dispatchFastGameCommand,
      dispatchFastEnvironmentCommand,
      evaluateDeterministicFastPaths,
    ],
  )

  const runConversationActionDispatch = useCallback(
    async (text, { interim = false, source = 'interim', awaitHandlers = false } = {}) => {
      if (!conversationActiveRef?.current) return false
      const phrase = cleanForSpeech(text)
      const lastCommitted = userRowsTextView.current.at(-1) || ''
      if (isSpeechBusy()) {
        return false
      }

      // Dedupe unificada de revisiones ASR (turno canónico): Chrome entrega la
      // misma frase en finales que CRECEN ("…Cómo" → "…Cómo sal" → "…cómo saltan").
      // Solo la última (la más larga tras pausa) debe despacharse como comando.
      const prevText = String(lastConversationActionRef.current.text || '').toLowerCase().trim()
      const prevAt = Number(lastConversationActionRef.current.at || 0)
      const curText = phrase.toLowerCase().trim()
      const isAsrRevision =
        prevText &&
        curText &&
        prevText !== curText &&
        Date.now() - prevAt < 1600 &&
        (curText.startsWith(prevText) || prevText.startsWith(curText))
      if (isAsrRevision) {
        if (import.meta.env.DEV && debugHotPath) {
          fluDebugHot('conversation-dispatch', { source, plan: 'dedup', kind: 'asr-revision', phrase, prev: prevText })
        }
        return true
      }

      const plan = planVoiceCommandDispatch(text, {
        interim,
        lastSignature: lastConversationActionRef.current.signature,
        lastAt: lastConversationActionRef.current.at,
        lastCommitted,
      })

      if (import.meta.env.DEV && debugHotPath) {
        fluDebugHot('conversation-dispatch', {
          source,
          interim,
          plan: plan.plan,
          kind: plan.action?.kind || '',
          command: plan.action?.command || '',
          question: plan.action?.question || '',
          phrase: plan.phrase || cleanForSpeech(text),
          reason: plan.reason || '',
        })
      }

      if (plan.plan === 'skip') return false
      if (plan.plan === 'dedup') return true

      lastConversationActionRef.current = { signature: plan.signature, at: Date.now(), text: phrase }

      const invoke = async (handler) => {
        if (awaitHandlers) await handler()
        else void handler()
      }

      if (plan.action.kind === 'command') {
        // §9/F: un comando requiere la wake en SU propio enunciado; no se hereda
        // del wake de un turno anterior. Excepción: control de escucha.
        const listeningControl = detectListeningControl(text, FLU_CONFIG.voiceCommands)
        const authorized = isCommandAuthorized(text, {
          wakeWords: resolvedWakeWords,
          allowWithoutWake: Boolean(listeningControl),
        })
        if (!authorized) {
          relayLog('LOG', 'useFluVoiceAssistant', '[WAKE] comando sin wake en su enunciado: no se despacha', {
            phrase: phrase.slice(0, 60),
          })
          return false
        }
        await invoke(() => dispatchPassiveVoiceCommand(plan.action.command, plan.phrase))
        return true
      }
      if (plan.action.kind === 'flu') {
        await invoke(() => processConversationFluQuery(plan.phrase, plan.action))
        return true
      }
      return false
    },
    [conversationActiveRef, debugHotPath, dispatchPassiveVoiceCommand, processConversationFluQuery],
  )

  const tryDispatchConversationAction = useCallback(
    (text, options = {}) => runConversationActionDispatch(text, { ...options, awaitHandlers: false }),
    [runConversationActionDispatch],
  )

  const awaitConversationAction = useCallback(
    (text, options = {}) => runConversationActionDispatch(text, { ...options, awaitHandlers: true }),
    [runConversationActionDispatch],
  )

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    window.__fluDev = window.__fluDev || {}
    window.__fluDev.runFluPhrase = (phrase) =>
      awaitConversationAction(phrase, { awaitHandlers: true, interim: false, source: 'e2e-dev' })
    return () => {
      if (window.__fluDev?.runFluPhrase) delete window.__fluDev.runFluPhrase
    }
  }, [awaitConversationAction])

  const processCapture = useCallback(async ({ closing = false } = {}) => {
    const snapshot = readCommandSnapshot(turnRef.current, pendingSpillRef.current)
    relayLog('LOG', 'useFluVoiceAssistant', `processCapture ENTER: snapshot="${(snapshot || '').slice(0, 60)}", closing=${closing}, conversationActiveRef.current=${conversationActiveRef?.current}`)
    // Dedup: la MISMA captura no se procesa dos veces seguidas (evita doble
    // acción cuando el cierre y el auto-proceso coinciden, como en el ciclo de
    // alarmas repetidas). Ventana corta: solo bloquea repeticiones inmediatas.
    const snapshotKeyDedup = cleanForSpeech(snapshot || '')
    if (snapshotKeyDedup) {
      const nowMsDedup = Date.now()
      const prevCap = lastProcessedCaptureRef.current
      // CORRECCIÓN EN VUELO: si hay un settle de navegación pendiente
      // (parcial→completo) o un turno procesándose, la captura entrante puede ser
      // la versión COMPLETA de la misma locución. NO se descarta: `scheduleNavSettle`
      // reemplaza el parcial. El dedup por superconjunto solo aplica a turnos ya
      // cerrados (re-emisión), nunca a una corrección viva.
      const correctionInFlight = isNavSettlePending() || isProcessingRef.current
      if (!correctionInFlight) {
        const sameCapture =
          prevCap.text && snapshotKeyDedup === prevCap.text && nowMsDedup - prevCap.at < 10000
        // Acumulación (turno ya cerrado): la nueva captura EMPIEZA con la anterior
        // (misma locución + audio pegado) → no se reprocesa. Exige previa larga
        // para no bloquear el wake corto ("okay") seguido del comando real.
        const supersetCapture =
          prevCap.text.length >= 20 &&
          snapshotKeyDedup.length > prevCap.text.length &&
          snapshotKeyDedup.startsWith(prevCap.text) &&
          nowMsDedup - prevCap.at < 25000
        if (sameCapture || supersetCapture) {
          relayLog(
            'WARN',
            'useFluVoiceAssistant',
            `processCapture SKIP: captura ${sameCapture ? 'duplicada' : 'acumulada'} (${nowMsDedup - prevCap.at}ms)`,
          )
          return
        }
        lastProcessedCaptureRef.current = { text: snapshotKeyDedup, at: nowMsDedup }
      }
    }
    if (!snapshot && !closing) return

    const requireWake = !conversationActiveRef?.current
    const wakeWords = resolvedWakeWords
    // Captura pasiva: recordar si el micrófono estaba abierto para reabrirlo al
    // final del turno, salvo que sea un cierre explícito (p. ej. CERRAR_ESCUCHA)
    // o la escucha se esté cerrando a propósito.
    let reopenListeningAfterCapture =
      (isListeningRef.current || recognitionActiveRef.current) && !closing

    if (conversationActiveRef?.current && snapshot) {
      relayLog('LOG', 'useFluVoiceAssistant', `processCapture CONVERSATION MODE: calling awaitConversationAction with text="${(snapshot || '').slice(0, 60)}"`)
      const handled = await awaitConversationAction(snapshot, { interim: false, source: 'capture' })
      relayLog('LOG', 'useFluVoiceAssistant', `processCapture CONVERSATION MODE: awaitConversationAction returned handled=${handled}`)
      return
    }

    // Escucha pasiva (sin conversación activa): el wake word es la ÚNICA
    // compuerta para que una frase sea comando o consulta a la IA. Sin wake,
    // es audio ambiente (TV/sala) → solo se registra y se sigue escuchando.
    // Excepción explícita: los comandos de control de escucha (abrir/cerrar)
    // siguen funcionando sin wake para poder detener la escucha por voz.
    if (requireWake && !closing && snapshot) {
      const resolution = resolveVoiceCommand(snapshot, { requireWake: true, wakeWords })
      const listeningControl = detectListeningControl(snapshot, FLU_CONFIG.voiceCommands)
      if (resolution.kind === 'ambient' && !listeningControl) {
        const toLog = cleanForSpeech(snapshot)
        if (toLog) {
          await emitConversationLog(toLog, {
            fallbackSpeaker: lastSpeakerRef.current || 'Hablante 1',
            currentClock: formatClock(),
          })
        }
        releaseTurnAfterLog(toLog || lastLoggedCaptureRef.current)
        return
      }
    }

    if (!snapshot) {
      if (closing) {
        isListeningRef.current = false
        await cleanupAudio()
        setStatus('idle')
      }
      return
    }

    setStatus('processing')
    isProcessingRef.current = true
    relayLog('LOG', 'useFluVoiceAssistant', '[REC] stop: processConversationFluQuery/processing', {
      isListening: isListeningRef.current,
      conversationActive: Boolean(conversationActiveRef?.current),
    })
    isStoppingRef.current = true
    clearAutoProcessTimer()

    try {
      commitBaselineRef.current = snapshot
      await finalizeRecognition()

      const readTurnCaptureSnapshot = () =>
        appendSpillText(commitBaselineRef.current, readCaptureSnapshot())

      let capturedTranscript = readTurnCaptureSnapshot()
      if (capturedTranscript && turnRef.current.interim) {
        capturedTranscript = await waitForCaptureSettle(readTurnCaptureSnapshot, FLU_CONFIG.timing)
      }

      // §9 — Visibilidad INMEDIATA: commit temprano de la frase capturada para
      // que la transcripción se vea en cuanto el usuario termina de hablar, SIN
      // esperar a la IA ni al comando. La resolución posterior re-commitea el
      // MISMO valor (idempotente), así no hay doble fuente.
      if (capturedTranscript) {
        await commitAndResolveTurn({ capture: capturedTranscript, commitOnly: true })
      }

      const sampleRate = sampleRateRef.current || 48000
      const streamSamples = flattenChunks(chunksRef.current)
      const currentClock = formatClock()
      const fallbackSpeaker = lastSpeakerRef.current || 'Hablante 1'
      const audioSnapshot = streamSamples.length ? new Float32Array(streamSamples) : new Float32Array(0)

      const finishTurn = () => {
        releaseTurnAfterLog(lastLoggedCaptureRef.current)
      }

      const logContext = {
        audioSnapshot,
        sampleRate,
        fallbackSpeaker,
        currentClock,
      }

      let passivePrefix = ''
      if (conversationActiveRef?.current && capturedTranscript) {
        const wakeAnalysis = analyzeWakeTurn(capturedTranscript, {
          lastCommitted: userRowsTextView.current.at(-1) || '',
        })
        if (wakeAnalysis.hasInlineBoundary) {
          passivePrefix = wakeAnalysis.passiveOnly
          capturedTranscript = cleanForSpeech(wakeAnalysis.afterWake || wakeAnalysis.question)
        }
      }

      const detectedLanguage = detectTranscriptLanguage(capturedTranscript || passivePrefix)

      if (passivePrefix) {
        await emitConversationLog(passivePrefix, logContext)
      }

      const bufferedValidation = extractFluVoiceCommand(capturedTranscript, {
        requireWake,
        wakeWords,
      })
      relayLog('LOG', 'useFluVoiceAssistant', `processCapture wake validation: accepted=${bufferedValidation.accepted}, reason="${bufferedValidation.reason}", requireWake=${requireWake}, requireWake?current=${conversationActiveRef?.current}`)
      if (!bufferedValidation.accepted) {
        if (
          bufferedValidation.reason === 'empty_after_wake_word' &&
          conversationActiveRef?.current
        ) {
          finishTurn()
          restartRecognition()
          return
        }

        const toLog = cleanForSpeech(capturedTranscript)
        if (toLog) {
          await emitConversationLog(toLog, logContext)
        }
        finishTurn()
        await cleanupAudio()
        setStatus('idle')
        isListeningRef.current = false
        if (bufferedValidation.reason === 'missing_wake_word' && conversationActiveRef?.current) {
          window.setTimeout(() => {
            if (conversationActiveRef?.current) {
              startListeningRef.current({ resume: true }).catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
            }
          }, FLU_CONFIG.timing.resumeListeningMs)
        }
        return
      }

      // OPTIMIZACIÓN LATENCIA (sin afectación funcional): bufferedTranscript, comando
      // directo e intent son TEXTO PURO (sin I/O ni efectos laterales), así que se
      // calculan ANTES de la diarización pesada. La diarización (resolveSpeaker) arranca
      // EN PARALELO con la llamada a la API y se reconcilia justo antes de
      // onContractResolved — mismo patrón que processConversationFluQuery (lote paralelo).
      const bufferedTranscript = bufferedValidation.commandText
      // §2A: la resolución de navegación se delega al árbitro determinista UNIFICADO
      // (src/voice/lib/deterministicArbiter.js), que evalúa config/juego/ambiente/
      // navegación en orden de prioridad. Aquí solo se extrae el dominio de navegación
      // (los dominios de estado se despachan después por el fast-path de fase).
      const arbiterResult = resolveDeterministicCommand(capturedTranscript, {
        language: detectedLanguage,
        texts: [bufferedTranscript, capturedTranscript],
      })
      const directCommand =
        arbiterResult.domain === 'navigation' ? arbiterResult.action : null
      const intent = directCommand
        ? {
          comando: directCommand,
          destino: null,
          parametros: {},
        }
        : { comando: null, destino: null, parametros: {} }

      // Orador rápido basado en texto para el prompt de la API y el fast-path
      // (instantáneo): nombre introducido por voz > último orador conocido > fallback.
      // La diarización real (audio) reconcilia el orador definitivo antes de hablar.
      const fastSpeakerName =
        detectIntroducedName(bufferedTranscript || capturedTranscript) ||
        lastSpeakerRef.current ||
        fallbackSpeaker

      // Diarización pesada corriendo EN PARALELO con la API. .catch(() => null) la hace
      // no-fatal (mismo policy que el lote conversacional vía Promise.allSettled): si la
      // diarización fallara, se degrada al orador rápido + firma calculada bajo demanda.
      const speakerPromise = resolveSpeaker(
        capturedTranscript,
        audioSnapshot,
        sampleRate,
        fallbackSpeaker,
      ).catch((speakerError) => {
        console.error('processCapture resolveSpeaker falló; se usa orador rápido:', speakerError?.message || speakerError)
        return null
      })

      const resolveTurnSpeaker = async () => {
        const turnSpeaker = await speakerPromise
        if (!turnSpeaker) {
          return {
            signatureVector: null,
            resolvedSpeakerName: fastSpeakerName,
            speakerAlias: null,
          }
        }
        return {
          signatureVector: turnSpeaker.signatureVector,
          resolvedSpeakerName:
            turnSpeaker.resolvedSpeakerName || turnSpeaker.speakerName || fastSpeakerName,
          speakerAlias: turnSpeaker.speakerAlias ?? null,
        }
      }

      if (directCommand) {
        // El comando directo espera la diarización (ya en curso) para conservar el
        // orador real y la firma; si ésta fallara, se degrada al orador rápido.
        const { signatureVector, resolvedSpeakerName, speakerAlias } = await resolveTurnSpeaker()

        if (directCommand === 'INICIAR_CONVERSACION' && conversationActiveRef?.current) {
          await emitActiveConversationCommand('INICIAR_CONVERSACION', capturedTranscript)
          return
        }

        // "cerrar escucha" debe cerrar de verdad: no reabrir la captura pasiva.
        if (directCommand === 'CERRAR_ESCUCHA') {
          reopenListeningAfterCapture = false
        }

        finishTurn()
        await cleanupAudio()
        setStatus('idle')
        isListeningRef.current = false
        setActiveKnowledgeBase('general')
        relayLog('LOG', 'useFluVoiceAssistant', `processCapture DIRECT COMMAND: calling commitAndResolveTurn with command="${directCommand}"`)
        await commitAndResolveTurn({
          capture: capturedTranscript,
          contract: {
            respuesta_voz: getCommandSpeech(directCommand, detectedLanguage || language),
            navegacion: {
              comando: directCommand,
              destino: null,
              parametros: {},
            },
          },
          diagnostics: null,
          speakerName: resolvedSpeakerName,
          speakerAlias,
          phase,
          timestamp: currentClock,
          signature: signatureVector ?? (await computeTurnSignature(audioSnapshot, sampleRate)).vector,
          language: detectedLanguage,
        })
        return
      }

      if (!bufferedTranscript) {
        finishTurn()
        if (conversationActiveRef?.current) {
          restartRecognition()
        } else {
          await cleanupAudio()
          setStatus('idle')
          isListeningRef.current = false
        }
        return
      }

      setError('')

      const knowledgeMode =
        !isMinuteGenerationRequest(bufferedTranscript) &&
          !isMinuteGenerationRequest(capturedTranscript) &&
          !isMinuteSaveRequest(bufferedTranscript) &&
          !isMinuteSaveRequest(capturedTranscript) &&
          isMinuteKnowledgeRequest(bufferedTranscript)
          ? 'minutes'
          : 'general'
      setActiveKnowledgeBase(knowledgeMode)

      if (phase === 'CONFIGURACION') {
        const derivedSession = deriveSession(bufferedTranscript, session.role, language)
        const nextSession = {
          role: derivedSession.role,
          theme: derivedSession.theme,
        }
        setSession(nextSession)
        setPhase('SESION_ACTIVA')
        await saveSessionState({
          phase: 'SESION_ACTIVA',
          ...nextSession,
          history: getConversationContext(),
        })

        // FAST-PATH DETERMINISTA UNIFICADO (§3.1): el árbitro resuelve y despacha
        // configuración/juego/ambiente desde un único punto, sin IA, por la MISMA ruta
        // (onContractResolved) mientras la API genera la confirmación verbal. El
        // `dispatch` (Promise.allSettled que nunca rechaza) se espera antes de hablar
        // la confirmación; los objetos resueltos alimentan la idempotencia del contrato.
        const fastPath = await evaluateDeterministicFastPaths({
          text: capturedTranscript,
          speakerName: fastSpeakerName,
          speakerAlias: null,
          phase: 'CONFIGURACION',
          session: nextSession,
          language: detectedLanguage,
          timestamp: currentClock,
        })
        const fastPathConfig = fastPath.config
        const fastGame = fastPath.game
        const fastEnv = fastPath.env
        const fastPathDispatch = fastPath.dispatch
        // §1A: re-resolución determinista tardía (config/ambiente) para la idempotencia
        // del contrato. Se delega al árbitro puro; solo se usa cuando el fast-path NO
        // despachó (para que la resolución determinista gane sobre la del modelo).
        const lateStateful = resolveStatefulDomains(capturedTranscript, { language: detectedLanguage })

        // §9: la IA recibe la query DERIVADA por el derivador único a partir de la
        // frase canónica del turno; nunca el texto propio de la captura.
        const turnQuery =
          deriveQueryFromRow(capturedTranscript, FLU_CONFIG.voiceCommands).question ||
          capturedTranscript

        let contract
        try {
          contract = await requestFluContractForTranscript({
            transcript: turnQuery,
            knowledgeMode,
            intent,
            speaker: fastSpeakerName,
            theme: nextSession.theme,
            role: nextSession.role,
            phase: 'CONFIGURACION',
          })
        } catch (error) {
          console.error('processCapture CONFIGURACION error:', error?.message || error, 'code:', error?.code, 'status:', error?.status, 'apiKeySource:', error?.apiKeySource)
          const errorMessage = formatGeminiUserMessage(error, language, { fallback: true })
          console.error('processCapture CONFIGURACION error message:', errorMessage)
          // La diarización (en paralelo) ya terminó en el caso común; se reconcilia el
          // orador real para el commit y la voz de error (mismo patrón conversacional).
          const { resolvedSpeakerName, speakerAlias } = await resolveTurnSpeaker()
          setError(errorMessage)
          setLastDiagnostics({
            provider: 'error',
            reason: errorMessage,
            apiKeySource: error?.apiKeySource || (apiKey ? 'localStorage' : 'missing'),
            message: error?.bodyPreview || error?.message || errorMessage,
            model: error?.model || 'unknown',
          })
          setLastErrorEvent({
            timestamp: currentClock,
            phase: 'CONFIGURACION',
            transcript: bufferedTranscript,
            error: errorMessage,
          })
          setLastContract(null)
          if (bufferedTranscript) {
            commitSessionTurn(capturedTranscript, resolvedSpeakerName)
            await saveSessionState({
              phase: 'SESION_ACTIVA',
              ...nextSession,
              history: getConversationContext(),
            })
            // Speak the error to the user so FLU explains what went wrong
            relayLog('LOG', 'useFluVoiceAssistant', `processCapture CONFIGURACION ERROR: calling commitAndResolveTurn with errorMessage="${(errorMessage || '').slice(0, 80)}"`)
            await commitAndResolveTurn({
              capture: capturedTranscript,
              contract: {
                respuesta_voz: errorMessage,
                navegacion: { comando: null, destino: null, parametros: {} },
                workspace: null,
                metadata: { provider: 'error', transcript: bufferedTranscript, rawText: '' },
              },
              diagnostics: buildGeminiDiagnosticsFromError(error),
              speakerName: resolvedSpeakerName,
              speakerAlias,
              phase: 'CONFIGURACION',
              session: nextSession,
              timestamp: currentClock,
              signature: (await computeTurnSignature(audioSnapshot, sampleRate)).vector,
              language: detectedLanguage,
              // Si el fast-path de juego ya arrancó la partida, la voz es la del motor.
              fastPathGame: Boolean(fastGame?.gameId),
              // Si el fast-path de ambiente ya aplicó el rebranding, la voz es la del motor.
              fastPathEnvironment: Boolean(fastEnv?.tipo),
            })
          }
          finishTurn()
          await cleanupAudio()
          setStatus('idle')
          isListeningRef.current = false
          return
        }

        // Reconciliar el orador diarizado (ya resuelto en paralelo) antes de persistir.
        const { resolvedSpeakerName, speakerAlias } = await resolveTurnSpeaker()

        const finalContract = {
          ...contract.contract,
          respuesta_voz: contract.contract.respuesta_voz,
          // Idempotencia fast-path: si el fast-path ya aplicó la configuración,
          // se anula la del contrato tardío para NO duplicar el efecto.
          configuracion:
            fastPathConfig?.accion
              ? null
              : lateStateful.config?.accion
                ? lateStateful.config
                : contract?.contract?.configuracion,
          // Idempotencia de juego: si el fast-path de juego ya despachó (start),
          // se anula el `juego` del contrato tardío para NO duplicar el arranque.
          juego: fastGame?.gameId ? null : contract?.contract?.juego ?? null,
          // Idempotencia de ambiente: si el fast-path ya aplicó el rebranding, se
          // anula el `ambiente` del contrato tardío para NO duplicar el efecto.
          ambiente: fastEnv?.tipo
            ? null
            : lateStateful.env?.tipo
              ? lateStateful.env
              : contract?.contract?.ambiente ?? null,
        }

        setLastContract(finalContract)
        setLastDiagnostics(contract.diagnostics || null)
        setLastErrorEvent(null)

        await saveSessionState({
          phase: 'SESION_ACTIVA',
          ...nextSession,
          history: getConversationContext(),
        })

        finishTurn()
        await cleanupAudio()
        setStatus('idle')
        isListeningRef.current = false
        relayLog('LOG', 'useFluVoiceAssistant', `processCapture CONFIGURACION SUCCESS: calling commitAndResolveTurn with respuesta_voz="${(finalContract.respuesta_voz || '').slice(0, 80)}"`)
        // Esperar el fast-path (ya resuelto) para garantizar el orden: la configuración,
        // el arranque de juego y el ambiente se aplican ANTES de hablar la confirmación.
        await fastPathDispatch
        await commitAndResolveTurn({
          capture: capturedTranscript,
          contract: finalContract,
          diagnostics: contract.diagnostics || null,
          speakerName: resolvedSpeakerName,
          speakerAlias,
          phase: 'CONFIGURACION',
          session: nextSession,
          timestamp: currentClock,
          signature: (await computeTurnSignature(audioSnapshot, sampleRate)).vector,
          language: detectedLanguage,
          // En juegos por voz la voz es SIEMPRE del motor local (determinista).
          fastPathGame: Boolean(fastGame?.gameId),
          // En ambientes por voz el rebranding es SIEMPRE del motor local (determinista).
          fastPathEnvironment: Boolean(fastEnv?.tipo),
        })
        return
      }

      // FAST-PATH DETERMINISTA UNIFICADO (§3.1): el árbitro resuelve y despacha
      // configuración/juego/ambiente desde un único punto, sin IA, por la MISMA ruta
      // (onContractResolved) mientras la API genera la confirmación verbal. El
      // `dispatch` (Promise.allSettled que nunca rechaza) se espera antes de hablar
      // la confirmación; los objetos resueltos alimentan la idempotencia del contrato.
      const fastPath = await evaluateDeterministicFastPaths({
        text: capturedTranscript,
        speakerName: fastSpeakerName,
        speakerAlias: null,
        phase: 'SESION_ACTIVA',
        session,
        language: detectedLanguage,
        timestamp: currentClock,
      })
      const fastPathConfig = fastPath.config
      const fastGame = fastPath.game
      const fastEnv = fastPath.env
      const fastPathDispatch = fastPath.dispatch
      // §1A: re-resolución determinista tardía (config/ambiente) para la idempotencia
      // del contrato. Se delega al árbitro puro; solo se usa cuando el fast-path NO
      // despachó (para que la resolución determinista gane sobre la del modelo).
      const lateStateful = resolveStatefulDomains(capturedTranscript, { language: detectedLanguage })

      // §9: la IA recibe la query DERIVADA por el derivador único a partir de la
      // frase canónica del turno; nunca el texto propio de la captura.
      const turnQuery =
        deriveQueryFromRow(capturedTranscript, FLU_CONFIG.voiceCommands).question ||
        capturedTranscript

      let contract
      try {
        contract = await requestFluContractForTranscript({
          transcript: turnQuery,
          knowledgeMode,
          intent,
          speaker: fastSpeakerName,
          theme: session.theme,
          role: session.role,
          phase: 'SESION_ACTIVA',
        })
      } catch (error) {
        console.error('processCapture SESION_ACTIVA error:', error?.message || error, 'code:', error?.code, 'status:', error?.status, 'apiKeySource:', error?.apiKeySource)
        const errorMessage = formatGeminiUserMessage(error, language, { fallback: true })
        console.error('processCapture SESION_ACTIVA error message:', errorMessage)
        // Reconciliar el orador diarizado (resuelto en paralelo) para commit y voz de error.
        const { resolvedSpeakerName, speakerAlias, signatureVector } = await resolveTurnSpeaker()
        setError(errorMessage)
        setLastDiagnostics({
          provider: 'error',
          reason: errorMessage,
          apiKeySource: error?.apiKeySource || (apiKey ? 'localStorage' : 'missing'),
          message: error?.bodyPreview || error?.message || errorMessage,
          model: error?.model || 'unknown',
        })
        setLastErrorEvent({
          timestamp: currentClock,
          phase: 'SESION_ACTIVA',
          transcript: bufferedTranscript,
          error: errorMessage,
        })
        setLastContract(null)
        if (bufferedTranscript) {
          commitSessionTurn(capturedTranscript, resolvedSpeakerName)
          await saveSessionState({
            phase: 'SESION_ACTIVA',
            ...session,
            history: getConversationContext(),
          })
          // Speak the error to the user so FLU explains what went wrong
          relayLog('LOG', 'useFluVoiceAssistant', `processCapture SESION_ACTIVA ERROR: calling commitAndResolveTurn with errorMessage="${(errorMessage || '').slice(0, 80)}"`)
          await commitAndResolveTurn({
            capture: capturedTranscript,
            contract: {
              respuesta_voz: errorMessage,
              navegacion: { comando: null, destino: null, parametros: {} },
              workspace: null,
              metadata: { provider: 'error', transcript: bufferedTranscript, rawText: '' },
            },
            diagnostics: buildGeminiDiagnosticsFromError(error),
            speakerName: resolvedSpeakerName,
            speakerAlias,
            phase: 'SESION_ACTIVA',
            session,
            timestamp: currentClock,
            signature: signatureVector ?? (await computeTurnSignature(audioSnapshot, sampleRate)).vector,
            language: detectedLanguage,
            // Si el fast-path de juego ya despachó el turno, la voz es la del motor.
            fastPathGame: Boolean(fastGame?.gameId),
            // Si el fast-path de ambiente ya aplicó el rebranding, la voz es la del motor.
            fastPathEnvironment: Boolean(fastEnv?.tipo),
          })
        }
        finishTurn()
        await cleanupAudio()
        setStatus('idle')
        isListeningRef.current = false
        return
      }

      // Reconciliar el orador diarizado (resuelto en paralelo) antes de persistir/hablar.
      const { resolvedSpeakerName, speakerAlias, signatureVector } = await resolveTurnSpeaker()

      const resolvedContract = {
        ...contract.contract,
        navegacion: {
          comando: contract?.contract?.navegacion?.comando || intent.comando || null,
          destino: contract?.contract?.navegacion?.destino || intent.destino || null,
          parametros: {
            ...(intent.parametros || {}),
            ...(contract?.contract?.navegacion?.parametros || {}),
          },
        },
        respuesta_voz: contract.contract.respuesta_voz,
        // Idempotencia fast-path: si el fast-path ya aplicó la configuración,
        // se anula la del contrato tardío para NO duplicar el efecto.
        configuracion:
          fastPathConfig?.accion
            ? null
            : lateStateful.config?.accion
              ? lateStateful.config
              : contract?.contract?.configuracion,
        // Idempotencia de juego: si el fast-path de juego ya despachó (turn/end),
        // se anula el `juego` del contrato tardío para NO duplicar el efecto.
        juego: fastGame?.gameId ? null : contract?.contract?.juego ?? null,
        // Idempotencia de ambiente: si el fast-path ya aplicó el rebranding, se anula
        // el `ambiente` del contrato tardío para NO duplicar el efecto.
        ambiente: fastEnv?.tipo
          ? null
          : lateStateful.env?.tipo
            ? lateStateful.env
            : contract?.contract?.ambiente ?? null,
      }

      setLastContract(resolvedContract)
      setLastDiagnostics(contract.diagnostics || null)
      setLastErrorEvent(null)

      await saveSessionState({
        phase: 'SESION_ACTIVA',
        ...session,
        history: getConversationContext(),
      })
      finishTurn()
      await cleanupAudio()
      setStatus('idle')
      isListeningRef.current = false
      relayLog('LOG', 'useFluVoiceAssistant', `processCapture SESION_ACTIVA SUCCESS: calling commitAndResolveTurn with respuesta_voz="${(resolvedContract.respuesta_voz || '').slice(0, 80)}"`)
      // Esperar el fast-path (ya resuelto) para garantizar el orden: la configuración,
      // el turno de juego y el ambiente se aplican ANTES de hablar la confirmación.
      await fastPathDispatch
      await commitAndResolveTurn({
        capture: capturedTranscript,
        contract: resolvedContract,
        diagnostics: contract.diagnostics || null,
        speakerName: resolvedSpeakerName,
        speakerAlias,
        phase: 'SESION_ACTIVA',
        session,
        timestamp: currentClock,
        signature: signatureVector ?? (await computeTurnSignature(audioSnapshot, sampleRate)).vector,
        language: detectedLanguage,
        // En juegos por voz la voz es SIEMPRE del motor local (determinista).
        fastPathGame: Boolean(fastGame?.gameId),
        // En ambientes por voz el rebranding es SIEMPRE del motor local (determinista).
        fastPathEnvironment: Boolean(fastEnv?.tipo),
      })
    } catch (error) {
      setError(error?.message || 'No se pudo procesar la captura.')
      await cleanupAudio().catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
      setStatus('idle')
      isListeningRef.current = false
    } finally {
      isStoppingRef.current = false
      isProcessingRef.current = false
      isCommittingRef.current = false
      commitBaselineRef.current = ''
      recognitionEndResolverRef.current = null
      // Captura pasiva: cleanupAudio() ya cerró el micrófono y anuló la
      // reconocedora. Si estaba abierta y no es un cierre explícito, reabrir la
      // escucha aquí (única política de reapertura) para que no "se cierre sola"
      // al decir, por ejemplo, "estas ahí" sin wake word.
      if (reopenListeningAfterCapture) {
        // Marcar 'listening' de forma síncrona antes del startListening asíncrono:
        // React agrupa este set con el 'idle' transitorio de la rama y evita que el
        // chip de "Cerrar escucha" parpadee (idle → listening) mientras se abre el mic.
        setStatus('listening')
        startListeningRef.current({ resume: true }).catch(fluAsyncErrorHandler('useFluVoiceAssistant'))
      }
    }
  }, [
    apiKey,
    cleanupAudio,
    clearAutoProcessTimer,
    commitAndResolveTurn,
    commitConversationTurn,
    conversationActiveRef,
    dispatchFastConfigCommand,
    dispatchFastGameCommand,
    dispatchFastEnvironmentCommand,
    dispatchPassiveVoiceCommand,
    evaluateDeterministicFastPaths,
    emitActiveConversationCommand,
    emitConversationLog,
    finalizeRecognition,
    getConversationContext,
    language,
    phase,
    processConversationFluQuery,
    readCaptureSnapshot,
    releaseTurnAfterLog,
    requestFluContractForTranscript,
    resolveSpeaker,
    restartRecognition,
    session,
  ])

  const flushPassiveConversation = useCallback(async () => {
    if (!isListeningRef.current || isStoppingRef.current) return

    const snapshot = readActiveSnapshot()
    if (!snapshot) return

    if (detectNextSpeakerPhrase(snapshot)) {
      advanceConversationSpeaker()
      listenStateRef.current.pendingInterim = ''
      listenStateRef.current.openLine = ''
      return
    }

    const uiCommand = resolveNavigationCommand(snapshot)

    if (uiCommand) {
      await dispatchPassiveVoiceCommand(uiCommand, snapshot)
      return
    }

    await awaitConversationAction(snapshot, { interim: false, source: 'flush' })
  }, [
    advanceConversationSpeaker,
    awaitConversationAction,
    dispatchPassiveVoiceCommand,
    processCapture,
    readActiveSnapshot,
  ])

  const stopListening = useCallback(async ({ closing = false } = {}) => {
    if (!isListeningRef.current && !readActiveSnapshot()) {
      return
    }

    if (conversationActiveRef?.current) {
      if (closing) {
        await commitConversationTurn({ closing: true })
      } else {
        await flushPassiveConversation()
      }
      return
    }

    await processCapture({ closing })
  }, [
    commitConversationTurn,
    conversationActiveRef,
    flushPassiveConversation,
    processCapture,
    readActiveSnapshot,
  ])

  const toggleListening = useCallback(async () => {
    if (status === 'listening') {
      await stopListening({ closing: true })
      return
    }

    if (isProcessingRef.current || isCommittingRef.current) return

    if (status === 'idle') {
      await startListening()
    }
  }, [startListening, status, stopListening])

  useEffect(() => {
    startListeningRef.current = startListening
    stopListeningRef.current = stopListening
    flushPassiveConversationRef.current = flushPassiveConversation
    dispatchPassiveVoiceCommandRef.current = dispatchPassiveVoiceCommand
    processConversationFluQueryRef.current = processConversationFluQuery
    tryDispatchConversationActionRef.current = tryDispatchConversationAction
  }, [
    dispatchPassiveVoiceCommand,
    flushPassiveConversation,
    processConversationFluQuery,
    startListening,
    stopListening,
    tryDispatchConversationAction,
  ])

  useEffect(() => {
    if (status !== 'listening' || typeof window === 'undefined') return undefined

    const listeningCfg = FLU_CONFIG.listening || {}
    const watchdogMs = listeningCfg.watchdogMs
    const timerId = window.setInterval(() => {
      if (!isListeningRef.current || isStoppingRef.current) return

      if (conversationActiveRef?.current) {
        const restartCfg = getConversationRestartConfig(true)
        const now = Date.now()
        const sinceMeaningful = now - (lastMeaningfulIngressAtRef.current || 0)
        const sinceEnd = now - (lastRecognitionEndAtRef.current || 0)
        const sinceRebuild = now - (lastStallRebuildAtRef.current || 0)
        const deadMs = restartCfg.deadRecognitionMs
        const rebuildCooldown = restartCfg.stallRebuildMinMs

        if (
          recognitionActiveRef.current &&
          sinceMeaningful >= restartCfg.silentMicStallMs &&
          sinceRebuild >= rebuildCooldown
        ) {
          lastStallRebuildAtRef.current = now
          if (!rebuildRecognitionRef.current()) {
            requestRecognitionRestart(restartCfg.retryBackoffMs)
          }
          return
        }

        if (
          !recognitionActiveRef.current &&
          !recognitionRestartPendingRef.current &&
          sinceEnd >= deadMs
        ) {
          if (!rebuildRecognitionRef.current()) {
            requestRecognitionRestart(restartCfg.retryBackoffMs)
          }
          return
        }

        if (sinceMeaningful >= restartCfg.stallMs && sinceRebuild >= rebuildCooldown) {
          lastStallRebuildAtRef.current = now
          if (!rebuildRecognitionRef.current()) {
            requestRecognitionRestart(restartCfg.retryBackoffMs)
          }
        }

        const pauseCfg = getTranscriptPauseCfg()
        const srGapMs = Number(pauseCfg.srGapCommitMs) || 0
        const srGapMinWords = Number(pauseCfg.srGapCommitMinWords) || 0
        const sinceResult = now - (lastOnresultAtRef.current || 0)
        if (
          srGapMs > 0 &&
          sinceResult >= srGapMs &&
          !srGapFiredForOpenLineRef.current
        ) {
          const openLine = cleanForSpeech(
            listenStateRef.current?.openLine ||
            publishedLiveRef.current ||
            readStreamDisplay(listenStateRef.current),
          )
          if (openLine && countSpeechWords(openLine) >= srGapMinWords) {
            srGapFiredForOpenLineRef.current = true
            ingressRuntimeRef.current?.pushSrGapEvent?.({ sinceLastResultMs: sinceResult })
          }
        }
        return
      }

      if (recognitionActiveRef.current || !recognitionRef.current) return
      requestRecognitionRestart(listeningCfg.restartAfterEndMs)
    }, conversationActiveRef?.current
      ? getActiveListenConfig().restart.stallCheckMs
      : watchdogMs)

    return () => window.clearInterval(timerId)
  }, [conversationActiveRef, requestRecognitionRestart, status])

  ingressBindingsRef.current = {
    conversationActiveRef,
    listenStateRef,
    publishedLiveRef,
    openPreviewTurnRef,
    logRowsTextRef: userRowsTextView,
    logRowSpeakersRef: userSpeakersView,
    lastEmittedTranscriptRef,
    lastLoggedSpeakerRef,
    lastStreamPreviewRef,
    lastCommitAtRef,
    preflightScheduledForTurnRef,
    syncConversationStream,
    tryDispatchConversationAction,
    maybeSwitchRecognitionLocale,
    flushTranscriptOnFinal,
    flushPcmAfterTurnCommit,
    commitTurnToSessionRows,
    showListeningAck,
    debugHotPath,
    fluDebugHot,
    getIngressVoiceContext: () => ({
      previewSpeaker: lastLoggedSpeakerRef.current,
      interimSpeaker: lastLoggedSpeakerRef.current,
      finalSpeaker: lastLoggedSpeakerRef.current,
      lastSignature: lastTurnSignatureRef.current,
      previewSignature: lastTurnSignatureRef.current,
      finalSignature: lastTurnSignatureRef.current,
    }),
    peekTurnBridgeText: () => turnBridgeTextRef.current,
    stashTurnBridgeText: (text) => {
      turnBridgeTextRef.current = cleanForSpeech(text)
    },
    consumeTurnBridgeText: () => {
      const bridge = turnBridgeTextRef.current
      turnBridgeTextRef.current = ''
      return bridge
    },
    onTurnFinalized: () => {
      preflightScheduledForTurnRef.current = false
    },
    markAudioSegmentStart: (atMs) => {
      turnSegmentStartedAtRef.current = Number(atMs) || Date.now()
      turnAudioStartSampleRef.current = chunkTotalSamplesRef.current
    },
    scheduleIdentityPreflight,
    touchMeaningfulIngress: ({ meaningful = true, reason: _reason = '' } = {}) => {
      const now = Date.now()
      const echoWindowMs =
        Number(FLU_CONFIG.voiceIdentity?.capture?.committedEchoStreakWindowMs) || 1200
      if (meaningful) {
        ingressEchoStreakRef.current = 0
        lastEchoAtRef.current = 0
        lastMeaningfulIngressAtRef.current = now
        return
      }
      // Solo cuenta como ráfaga de eco si viene encadenada RÁPIDO (loop ASR real).
      // Si entre eco y eco pasa más que la ventana, es repetición genuina: reinicia.
      const sinceLastEcho = lastEchoAtRef.current ? now - lastEchoAtRef.current : echoWindowMs
      lastEchoAtRef.current = now
      if (sinceLastEcho > echoWindowMs) {
        ingressEchoStreakRef.current = 1
        return
      }
      ingressEchoStreakRef.current += 1
      const echoLimit =
        Number(FLU_CONFIG.voiceIdentity?.capture?.committedEchoRebuildAfter) || 3
      if (ingressEchoStreakRef.current >= echoLimit && conversationActiveRef?.current) {
        const restartCfg = getConversationRestartConfig(true)
        // Respeta el cooldown de rebuild: si sigue atascado, el watchdog se encarga.
        if (
          lastStallRebuildAtRef.current &&
          now - lastStallRebuildAtRef.current < (restartCfg.stallRebuildMinMs || 1600)
        ) {
          return
        }
        ingressEchoStreakRef.current = 0
        lastEchoAtRef.current = 0
        lastStallRebuildAtRef.current = now
        if (!rebuildRecognitionRef.current()) {
          requestRecognitionRestart(restartCfg.retryBackoffMs)
        }
      }
    },
  }

  const setRecentMemory = useCallback((text) => {
    recentMemoryRef.current = text || ''
  }, [])

  return {
    phase,
    status,
    error,
    lastDiagnostics,
    lastErrorEvent,
    liveTranscript,
    lastTranscript,
    lastContract,
    session,
    isSupported,
    toggleListening,
    startListening,
    stopListening,
    setSession,
    setPhase,
    resetVoiceDisplay,
    resetConversationSession,
    renameSessionSpeaker,
    removeSessionSpeaker,
    advanceConversationSpeaker,
    listeningAck,
    showListeningAck,
    activeKnowledgeBase,
    fluParticipantPresentation: fluParticipant.presentation,
    grantParticipantFloor,
    endParticipantFloorDelivery: () => fluParticipantRef.current?.endFloorDelivery?.(),
    suspendRecognitionForAssistantSpeech,
    /** Set a recent memory text that gets injected into the system prompt on next contract request. */
    setRecentMemory,
  }
}

