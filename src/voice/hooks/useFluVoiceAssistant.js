import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  computeAudioSignature,
  cleanForSpeech,
  decideVoiceTurnDispatch,
  detectIntroducedName,
  detectWakeIntroducedName,
  detectListeningControl,
  detectRole,
  detectTranscriptLanguage,
  extractTheme,
  formatClock,
  extractFluVoiceCommand,
  compareCosineSignatures,
  getRecognitionRetryDelay,
  getRecognitionErrorMessage,
  isRecoverableRecognitionError,
  isMinuteGenerationRequest,
  isMinuteSaveRequest,
  isMinuteKnowledgeRequest,
  isPlausiblePersonName,
  pickRichestVoiceCommandCapture,
} from '../lib/audioMath'
import { isNavSettlePending } from '../lib/navSettleFlag'
import { getFluTimingCfg, getProfileMatchCfg } from '../lib/fluTranscriptMotor.js'
import { analyzeWakeTurn, requiresWakeWord } from '../lib/wakeTurnCommit.js'
import { handleConversationStreamSync } from '../lib/conversationStreamCommit.js'
import { listVoiceProfiles, loadSessionState, saveSessionState, saveVoiceProfile } from '../lib/fluStorage'
import { requestFluContract } from '../lib/gemini'
import { buildContractParams } from '../lib/contractParams'
import {
  isCommandAuthorized,
  resolveDeterministicCommand,
  resolveDeterministicSkipGeminiContract,
  resolveStatefulDomains,
  musicActionSpeech,
  resolveVoiceCommand,
} from '../lib/deterministicArbiter'
import { noteGameTurn } from '../../core/games/gameSessionStore'
import { consumesGameTurn, isCatalogLevelGameAction } from '../lib/gameCommands'
import { relayLog } from '../../lib/clientLogRelay'
import { captureTurnAudioSnapshot, probePcmBlock, readTurnAudioSnapshot, turnAudioForDiarize } from '../lib/turnAudioSnapshot.js'
import { useIntegrationStore } from '../../store/integrationStore'
import { fluAsyncErrorHandler } from '../lib/fluAsyncError.js'
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
  findLabelsWithSharedVoice,
  flattenChunksTail,
  flattenChunksWindow,
  isProperSpeakerName,
  nextAvailableSpeakerLabel,
  normalizeSpeakerLabel,
  pruneGhostSpeakerClusters,
  trimAudioChunkBuffer,
} from '../lib/voiceIdentity'
import { clearSessionPrimarySpeaker, setSessionPrimarySpeaker } from '../lib/sessionPrimarySpeaker'
import { updateTurnRowSpeaker, renameSpeakerRows } from '../lib/conversationTurnRow'
import {
  getConversationMinVoicedSamples,
  getConversationSpeakerTailMs,
  getDiarizeIntervalMs,
  getLastTurnSignatureContinuityDistance,
  getMaxSilenceWindowsForHold,
  getVoiceDetectionThreshold,
  resolveCaptureAudioConstraints,
  resolveCaptureGain,
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
  resolveSpeakerByText as resolveConversationSpeakerLabel,
  sealPendingInterim,
  syncSpeakerIndexFromLabel,
} from '../lib/activeListen.js'
import { buildResolvedContract, estadoFastPathIdempotente } from '../lib/resolvedContract.js'
import {
  acquireSpeechRecognition,
  startSpeechRecognition,
  stopSpeechRecognition,
} from '../lib/speechRecognitionLocal'
import { fluEvent, logChromeSpeechResult, getListenLogRing, clearListenLogRing } from '../lib/listenLog'
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
  normalizeTurnCapture,
  resetTurnState,
  waitForCaptureSettle,
} from '../lib/turnTranscript'
import { wireMicCapturePipeline } from '../lib/micCaptureBridge.js'
import { createConversationIngressRuntime } from '../lib/conversationIngressBridge.js'
import { formatGeminiUserMessage, buildGeminiDiagnosticsFromError } from '../lib/geminiDiagnostics.js'
import { convertSimEventsToMicBursts } from '../lib/micEventProducer.js'
import { collectRecognitionResultChunks } from '../lib/transcriptIngress.js'
import { resolveTurnCommitPhrase } from '../lib/turnCommitPhrase.js'
import { resolveWakeWords } from '../lib/wakeWords.js'
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
  blindSpeakerFallback,
  shouldSkipPreviewDiarize,
} from '../lib/speakerPolicy.js'
import { WAKE_POLICY_ORDER, applyWakePolicyOrder, resolveWakePolicyOrder, wakePolicySpeech } from '../lib/wakePolicy.js'
import { getTranscriptPauseCfg, countSpeechWords, resolveSrGapTrigger } from '../lib/fluTranscriptPause.js'
// Ruta única: useFluParticipant vive solo en src/hooks/useFluParticipant.ts.
// El motor de voz la importa aquí solo como fallback defensivo; en producción
// App.tsx inyecta su instancia vía participantRef (mismo módulo).
import { useFluParticipant } from '../../hooks/useFluParticipant'
import { isSpeechSynthesisSpeaking, isFluSpeaking, waitForSpeechIdle, getLastCompletedSpeechAt } from '../lib/fluSpeech.js'
import { createLocalRecognition, shouldUseLocalFallback } from '../lib/voiceLocalFallback'
import { logCaughtError } from '../../lib/caughtError';
import { useTurnLifecycleSync, useOffPathSessionWriter } from './useTurnInfrastructure'
import { resolvePreLaunchDelay } from '../lib/preLaunchDelay'
import { AI_PROVIDER_IDS } from '../../core/config/sharedConfig'
import {
  FLU_DIALOGUE_SPEAKER,
  resolveEchoContext,
  deriveDialogueHistory,
  deriveUserRowSpeakers,
  deriveUserRowTexts,
  getDialogueContextSlice,
  isFluSpeaker,
} from '../lib/conversationDialogue.js'
import { isAutoSpeakerLabel } from '../lib/speakerCore.js';
import { COMMAND_IDS } from '../lib/commandIds.js'
import { createEmissionDeduper, shouldSkipCapture } from '../lib/captureDedup.js'
import { isAssistantSpeechEcho } from '../lib/conversationStream.js'
import { voiceProbe, isVoiceProbeEnabled } from '../lib/voiceProbe'

const CONTEXT_HISTORY_LIMIT = FLU_CONFIG.limits.contextHistoryMax
// Sample rate de captura: fuente única en FLU_CONFIG.audio.sampleRate (sin hardcode).
const AUDIO_SAMPLE_RATE = FLU_CONFIG.audio?.sampleRate ?? 0

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
  if (!segments.length) return FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker

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
    const similarity = compareCosineSignatures(signatureVector, profile.signature)
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      bestMatch = profile
    }
  })

  const profileMatch = getProfileMatchCfg()
  // compareCosineSignatures devuelve SIMILITUD (1 = misma voz); la config la
  // expresa como "máxima distancia" → umbral de similitud = 1 - distancia.
  const registeredMinSimilarity = 1 - Number(profileMatch.registeredProfileMaxDistance ?? 0.12)
  if (bestMatch && bestSimilarity >= registeredMinSimilarity && isPlausiblePersonName(bestMatch.label || '')) {
    return bestMatch.label || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
  }

  let clusterMatch = null
  let clusterSimilarity = -1
  speakerClusters.forEach((cluster) => {
    if (!Array.isArray(cluster?.signature)) return
    const similarity = compareCosineSignatures(signatureVector, cluster.signature)
    if (similarity > clusterSimilarity) {
      clusterSimilarity = similarity
      clusterMatch = cluster
    }
  })

  const MATCH_THRESHOLD = 1 - Number(profileMatch.clusterMatchMaxDistance ?? 0.09)
  const blendWeight = profileMatch.clusterSignatureBlendWeight

  if (clusterMatch && clusterSimilarity >= MATCH_THRESHOLD) {
    const label = clusterMatch.label || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
    if (isPlausiblePersonName(label) || isAutoSpeakerLabel(label)) {
      // Cluster con NOMBRE PROPIO = ancla de esa persona: no se mezcla con la voz
      // entrante (la arrastraría hacia sí misma). Los «Hablante N» sí adaptan.
      if (!isPlausiblePersonName(label)) {
        clusterMatch.signature = clusterMatch.signature.map((value, index) => {
          const previous = Number(value || 0)
          const next = Number(signatureVector[index] || 0)
          return previous * (1 - blendWeight) + next * blendWeight
        })
      }
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
  activeParticipantSpeakerLabel = '',
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
  // Wake words efectivas (Ajustes o default): UN solo criterio. Van declaradas
  // ANTES del commit porque el commit las consume para recortar el eco.
  const resolvedWakeWords = resolveWakeWords(wakeWords)
  const commitTurnPhrase = useCallback((text, fallback = '') => {
    const phrase = resolveTurnCommitPhrase({ capture: text, fallback, log: relayLog, wakeWords: resolvedWakeWords })
    if (phrase) commitVisibleTranscript(phrase)
    return phrase
  }, [commitVisibleTranscript, resolvedWakeWords])
  // Limpieza del estado del turno tras resolver (se asigna cuando
  // `clearTurnBuffers` existe). Evita que la locución ya ejecutada quede en el
  // buffer/spill y se vuelva a procesar (ciclo de comandos repetidos).
  const clearTurnAfterResolveRef = useRef(() => {})
  const activeTurnIdRef = useRef(0)
  /**
   * §9: par ÚNICO `commit + resolución` del turno. TODAS las ramas cierran por
   * aquí, de modo que el display (commit) y la fila (`transcript`) no puedan
   * divergir por construcción: la fila es SIEMPRE el valor commiteado.
   * Las ramas solo aportan su `contract` y los campos del payload.
   */
  const commitAndResolveTurn = useCallback(
    async ({ capture, fallbackCapture = '', contract, commitOnly = false, ...payload } = {}) => {
      const canonicalPhrase = commitTurnPhrase(capture, fallbackCapture)
      const evidenciaAcustica = payload.evidenciaAcustica === true // solo la DECLARA quien midio VOZ (preflight/sync con ventana)
      // Garbage descartada (anti-alucinación): no se commitea ni se consulta a IA.
      if (!canonicalPhrase) return ''
      // `commitOnly`: commit temprano + fila del USUARIO inmediata (sin esperar a
      // la IA). La resolución posterior re-commitea el MISMO valor (idempotente)
      // y deduplica la fila, así no hay doble fuente.
      if (commitOnly) {
        if (!earlyCommitDedupeRef.current.isRepeat(canonicalPhrase)) {
          await onContractResolved?.({ contract: null, userCommitOnly: true, transcript: canonicalPhrase, speakerName: payload.speakerName, evidenciaAcustica, phase: payload.phase, turnId: activeTurnIdRef.current })
        }
        return canonicalPhrase
      }
      const result = await onContractResolved?.({ contract, ...payload, evidenciaAcustica, transcript: canonicalPhrase, turnId: activeTurnIdRef.current })
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
  const lastProcessedCaptureRef = useRef({ text: '', at: 0 }) // dedup anti-repeticion de la captura
  const earlyCommitDedupeRef = useRef(null) // idempotencia por PETICION (captureDedup)
  if (!earlyCommitDedupeRef.current) earlyCommitDedupeRef.current = createEmissionDeduper()
  const autoProcessTimerRef = useRef(null)
  const recognitionRetryTimerRef = useRef(null)
  const recognitionRetryCountRef = useRef(0)
  const turnRef = useRef(createTurnState())
  const publishedLiveRef = useRef('')
  const pendingSpillRef = useRef('')
  const lastLoggedCaptureRef = useRef('')
  const finalizeGraceUsedRef = useRef(false)
  const sampleRateRef = useRef(AUDIO_SAMPLE_RATE)
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
  // Ciclo de vida del turno (overlay + cronómetro) y persistencia fuera del camino
  // crítico: viven en `useTurnInfrastructure` para no engordar este hook.
  const turnLifecycleRef = useTurnLifecycleSync()
  const { write: persistSessionOffPath } = useOffPathSessionWriter(
    saveSessionState,
    fluAsyncErrorHandler('useFluVoiceAssistant'),
  )
  /**
   * §9 ÚNICO punto de escritura de los clusters de hablante.
   * El COMMIT es autoritativo; el segmento solo propone (no persiste).
   */
  const setSpeakerClusters = useCallback((next) => {
    speakerClustersRef.current =
      typeof next === 'function' ? next(speakerClustersRef.current) : next
    voiceProbe('clusters', { write: speakerClustersRef.current?.length ?? 0, labels: (speakerClustersRef.current || []).map((c) => c?.label) }) // BANDERA DE DIAGNOSTICO
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
    // BANDERA DE DIAGNÓSTICO: ¿el modelo de voz cargó y produjo vector?
    const promise = computeAudioSignature(snapshot, sampleRate)
      .then((res) => {
        relayLog(
          'LOG',
          'VoiceId',
          `signature dim=${res?.stats?.dim ?? res?.vector?.length ?? 0} empty=${res?.stats?.empty === true} snap=${snapshot.length} sr=${sampleRate}`,
        )
        return res
      })
      .catch((err) => {
        relayLog('ERROR', 'VoiceId', `signature FAILED: ${err?.message || err}`)
        throw err
      })
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
const lastResolvedTurnRef = useRef(0)
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
    setSessionPrimarySpeaker(sessionPrimarySpeakerRef, name, 'participant')
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
  // El hook SIEMPRE se invoca (orden de hooks estable): useFluParticipant no dispara
  // efectos por si solo -- evaluar requiere llamar a la API que devuelve --, por lo que la
  // instancia propia queda inerte cuando App.tsx inyecta la suya. No omitirlo condicionalmente.
  const ownParticipant = useFluParticipant({
    apiKey,
    language,
    conversationActiveRef,
    session,
    getLogSnapshot: () => getParticipantLogSnapshotRef.current(),
  })
  const fluParticipant = participantRef?.current ?? ownParticipant
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
    clearListeningAck()
    if (typeof window === 'undefined') return
    setListeningAck(ackCfg.message)
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
  }, [clearCaptureState, commitVisibleTranscript])

  const resetConversationSession = useCallback(() => {
    resetVoiceDisplay()
    clearListeningAck()
    setSpeakerClusters([])
    const { speakers } = getConversationConfig()
    lastSpeakerRef.current = speakers.defaultLabel
    lastLoggedSpeakerRef.current = speakers.defaultLabel
    lastTurnSignatureRef.current = null
  }, [clearListeningAck, resetVoiceDisplay, setSpeakerClusters])

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
  }, [conversationActiveRef, dialogueView])

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
  }, [setSpeakerClusters])

  const removeSessionSpeaker = useCallback((label = '') => {
    const source = String(label || '').trim()
    if (!source) return

    setSpeakerClusters((prev) =>
      prev.filter((cluster) => String(cluster?.label || '').trim() !== source),
    )

    if (lastSpeakerRef.current === source) lastSpeakerRef.current = ''
    if (lastLoggedSpeakerRef.current === source) lastLoggedSpeakerRef.current = ''
  }, [setSpeakerClusters])

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
  }, [setSpeakerClusters])

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
    [dialogueView],
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
        if (local?.mode === AI_PROVIDER_IDS.LOCAL && local.contract) {
          return {
            contract: local.contract,
            diagnostics: local.diagnostics || { provider: 'minute-store', route: 'minute-lookup' },
          }
        }
      }

      const contractParams = buildContractParams(
        {
          apiKey,
          transcript,
          intent,
          speaker,
          theme,
          role,
          phase: contractPhase,
          language,
          knowledgeMode,
          history: getConversationContext(),
          knowledgeBase: knowledgeBaseRef.current,
          knowledgeBase2: knowledgeMode === 'minutes' ? getMinuteKnowledgeBaseRef.current() : '',
        },
        {
          consumeRecentMemory: () => {
            const value = recentMemoryRef.current || ''
            recentMemoryRef.current = ''
            return value
          },
          getAgenda: getDailyAgendaRef.current,
          getSelfManifesto: getSelfManifestoRef.current,
          getDiaryContext: getDiaryContextRef.current,
          getNotesContext: getNotesContextRef.current,
          getHorarioContext: getHorarioContextRef.current,
          getResultadosContext: getResultadosContextRef.current,
        },
      )

      // FLU "thinking" (Pensando / Idle_1) mientras la IA procesa la petición:
      // gobierna la EXPRESIÓN del avatar (no el overlay, que lo lleva el turno).
      // Las consultas locales de minuta de arriba resuelven al instante, así que
      // se saltan esto correctamente.
      useIntegrationStore.getState?.().setConversationState?.('THINKING')
      // El indicador "Pensando" (overlay) lo gobierna el TURNO (turnWorkIndicator),
      // no esta llamada: al resolver la IA el turno sigue trabajando (escrituras,
      // despacho de la acción y locución), así que apagarlo aquí lo quitaba
      // mientras FLU seguía haciendo cosas.
      const iaStartMs = Date.now()
      try {
        const iaResult = await requestFluContract(contractParams)
        // Instrumentación de latencia (diagnóstico): permite medir el tiempo real
        // de la intervención con IA sin adivinar.
        relayLog(
          'LOG',
          'useFluVoiceAssistant',
          `latencia IA: ${Date.now() - iaStartMs}ms (phase=${contractPhase}, model=${iaResult?.diagnostics?.model || iaResult?.diagnostics?.provider || 'n/d'})`,
        )
        return iaResult
      } catch (err) {
        relayLog('ERROR', 'useFluVoiceAssistant', `latencia IA (fallo) tras ${Date.now() - iaStartMs}ms`); throw err
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
          } catch (e) {
        logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', e, e?.stack);
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
        } catch (e) {
        logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', e, e?.stack);
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
    } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }

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
    } catch (e) {
        logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', e, e?.stack);
      // ignore
    }

    recognitionActiveRef.current = false
    await Promise.race([
      waitForEnd,
      new Promise((resolve) => setTimeout(resolve, FLU_CONFIG.timing.recognitionStopMs)),
    ])
    isStoppingRef.current = false
    recognitionEndResolverRef.current = null

    // Reanudar la escucha si estaba activa antes del habla. SOLO en modo pasivo:
    // en conversación activa lo hace App (onContractResolved →
    // scheduleResumeListening); reabrir aqui forzaba LISTENING en el mismo ms del
    // SPEAKING y congelaba la boca aunque el audio siguiera.
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
      const GENERIC_SPEAKER = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
      if (!audioSnapshot?.length) {
        const sticky = lastSpeakerRef.current || fallbackSpeaker
        return isProperSpeakerName(sticky) ? GENERIC_SPEAKER : sticky || GENERIC_SPEAKER
      }
      // Embeddings async (worker): el preflight resuelve identidad por audio.
      if (canDiarize) {
        const preflight = peekTurnSpeakerPreflight(activeTurnIdRef.current)
        if (preflight?.ready && preflight.speakerName) {
          return preflight.speakerName
        }
        if (lastLoggedSpeakerRef.current) {
          // Sin preflight listo NO se estampa el nombre propio (evita "FLU/otro = tu nombre").
          return isProperSpeakerName(lastLoggedSpeakerRef.current)
            ? GENERIC_SPEAKER
            : lastLoggedSpeakerRef.current
        }
      }
      const fallback = fallbackSpeaker || lastLoggedSpeakerRef.current || lastSpeakerRef.current || GENERIC_SPEAKER
      return isProperSpeakerName(fallback) ? GENERIC_SPEAKER : fallback
    },
    [conversationActiveRef],
  )

  const getContinuousBufferAdapter = useCallback(() => ({
    getTurnStartSample: () => turnAudioStartSampleRef.current,
    snapshotTurnWindow: ({ turnAudioStartSample, atTurnBoundary = false, minSamplesMs = 0 } = {}) => {
      const rate = sampleRateRef.current || AUDIO_SAMPLE_RATE
      const tailMs = getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary })
      const maxSamples = Math.floor(rate * (tailMs / 1000))
      // `minSamplesMs` (captura del turno) garantiza MINIMO de audio: sin el, la
      // ventana salia de ~8 ms (medido: `snap=384` -> `vec=0` -> sin clusters).
      const minVoiced = Number(minSamplesMs) > 0
        ? Math.floor(rate * (Number(minSamplesMs) / 1000))
        : getConversationMinVoicedSamples(rate)
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

  /** §9 Captura el audio del turno (turnAudioSnapshot.js) antes de vaciar el buffer. */
  const captureTurnAudio = useCallback(
    () => captureTurnAudioSnapshot(activeTurnIdRef.current, {
      buildWindow: () => getContinuousBufferAdapter().snapshotTurnWindow({ turnAudioStartSample: turnAudioStartSampleRef.current, atTurnBoundary: true, minSamplesMs: getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary: true }) }),
      meta: { total: chunkTotalSamplesRef.current, since: turnAudioStartSampleRef.current, chunks: chunksRef.current.length, sampleRate: sampleRateRef.current || AUDIO_SAMPLE_RATE },
    }),
    [getContinuousBufferAdapter],
  )

  const createSpeakerAudioResolver = useCallback(
    ({ atTurnBoundary = false, allowNewCluster = false, utterance = '', turnId = 0 } = {}) =>
      createTurnSpeakerAudioResolver({
        getAudioBuffer: () => getContinuousBufferAdapter(),
        getSampleRate: () => sampleRateRef.current || AUDIO_SAMPLE_RATE,
        getTurnStartSample: () => turnAudioStartSampleRef.current,
        getAudioStartSample: () => turnAudioStartSampleRef.current,
        getAudioStartedAtMs: () => turnSegmentStartedAtRef.current,
        getSpeakerClusters: () => speakerClustersRef.current,
        getLastSpeaker: () => lastLoggedSpeakerRef.current || lastSpeakerRef.current,
        getLastSignature: () => lastTurnSignatureRef.current,
        getFallbackSpeaker: () =>
          lastLoggedSpeakerRef.current || lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
        getUtteranceText: () => cleanForSpeech(utterance) || lastDiarizeUtteranceRef.current,
        atTurnBoundary,
        allowNewCluster,
        getPreferSpeaker: () => lastLoggedSpeakerRef.current || '',
        getSessionPrimary: () => sessionPrimarySpeakerRef.current || '',
        getReservedLabels: () => [...userSpeakersView.current].filter(Boolean),
        getCapturedAudio: () => readTurnAudioSnapshot(turnId || activeTurnIdRef.current),
      }),
    [getContinuousBufferAdapter, userSpeakersView],
  )

  /** El embedding tarda MAS que el commit: manda el ULTIMO turno resuelto (monotono). */
  const applyResolvedSpeaker = useCallback(({ speakerName, turnId, workingClusters }) => {
    const id = Number(turnId)
    if (!speakerName || (Number.isFinite(id) && id < lastResolvedTurnRef.current)) return
    if (Number.isFinite(id)) lastResolvedTurnRef.current = id
    lastSpeakerRef.current = speakerName; lastLoggedSpeakerRef.current = speakerName
    updateTurnRowSpeaker(turnId, speakerName, { evidenciaAcustica: Boolean(workingClusters?.length) }) // completa la fila de ESE turno, no la hereda
    if (isProperSpeakerName(speakerName)) {
      renameSpeakerRows(findLabelsWithSharedVoice(speakerClustersRef.current, speakerName), speakerName)
    }
  }, [])

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
      // GETTER, no id fijo: el id se acuña DESPUES de este aviso; fijarlo dejaba los
      // snapshots en un slot que el commit no miraba (Preflight turn=5 vs Commit=9).
      startContinuousIdentityPipeline(
        () => activeTurnIdRef.current,
        () => createSpeakerAudioResolver({ atTurnBoundary: true, allowNewCluster: true, utterance: phrase }),
        // §9 Dueño unico de la escritura de clusters: el ref del hook.
        { onClusters: setSpeakerClusters, onResolved: applyResolvedSpeaker, getSpeakerClusters: () => speakerClustersRef.current, getAudioRevision: () => publishedLiveRef.current },
      )
    },
    [conversationActiveRef, createSpeakerAudioResolver, setSpeakerClusters, applyResolvedSpeaker],
  )

  const resolveSpeakerWithAudio = useCallback(
    (utterance = '', fallbackSpeaker = '', { atTurnBoundary = false, allowNewCluster = false } = {}) => {
      const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
      if (!conversationActiveRef?.current || captureCfg.conversationAutoDiarize !== true) {
        return fallbackSpeaker
      }
      const tailMs = getConversationSpeakerTailMs(FLU_CONFIG, { atTurnBoundary })
      const sampleRate = sampleRateRef.current || AUDIO_SAMPLE_RATE
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
      if (!tail.length) return blindSpeakerFallback(fallbackSpeaker)
      return resolveConversationSpeakerSync(utterance, tail, sampleRate, fallbackSpeaker, {
        atTurnBoundary,
        allowNewCluster,
      })
    },
    [conversationActiveRef, resolveConversationSpeakerSync],
  )

  const applyConversationSpeaker = useCallback(
    (utterance = '', fallbackSpeaker = '', { force = false, atTurnBoundary = false, allowNewCluster = false } = {}) => {
      const fallback = blindSpeakerFallback(cleanForSpeech(fallbackSpeaker) || getSpeakerLabel(listenStateRef.current))
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
    [resolveSpeakerWithAudio, conversationActiveRef],
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
        // BANDERA DE DIAGNÓSTICO: decisión de hablante del turno.
        voiceProbe('identity', { path: 'sync', vec: signatureVector.length, snap: audioSnapshot.length, sr: sampleRate, clusters: speakerClustersRef.current?.length ?? 0, resolved: resolvedSpeakerName, fallback: fallbackSpeaker, last: lastSpeakerRef.current || '' })
        return {
          signatureVector,
          speakerName: audioSnapshot.length ? resolvedSpeakerName : '',
          evidenciaAcustica: audioSnapshot.length > 0,
          introducedName: null,
          resolvedSpeakerName: audioSnapshot.length ? resolvedSpeakerName : '',
          speakerAlias: null,
        }
      }

      if (!audioSnapshot.length) {
        // BANDERA DE DIAGNÓSTICO: sin audio NO hay diarización posible.
        relayLog(
          'LOG',
          'SpeakerTrace',
          `activo=false SIN AUDIO (snap=0) → fallback="${fallbackSpeaker}" (no se puede separar voces)`,
        )
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
        const distanceToLast = compareCosineSignatures(signatureVector, lastTurnSignatureRef.current)
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
      setSessionPrimarySpeaker(sessionPrimarySpeakerRef, introducedName, 'presented')
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
    [conversationActiveRef, resolveConversationSpeakerSync, computeTurnSignature],
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
      const capture = normalizeTurnCapture(turnCapture, {
        conversationActive: Boolean(conversationActiveRef?.current),
      })
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
      // Basura descartada (anti-alucinación): no se emite fila de log.
      if (!canonicalPhrase) return false
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
        turnId: activeTurnIdRef.current,
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
    [clearStreamLogTimer, conversationActiveRef, flushPendingStreamLog, onContractResolved, phase, commitTurnPhrase],
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
    [reconcileSpeakerClusters, userSpeakersView],
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
          activeParticipantName,
      activeParticipantSpeakerLabel,
      applyConversationSpeaker,
          flushPendingStreamLog,
          logRowsTextRef: userRowsTextView,
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
          lastLoggedSpeakerRef, applyResolvedSpeaker,
          logRowSpeakersRef: userSpeakersView,
          speakerClustersRef,
          setSpeakerClusters,
          lastSpeakerRef,
          lastTurnSignatureRef,
          lastLogLineTextRef,
          commitTurnToSessionRows,
          fluParticipantRef,
          participantSpeakerRef: {
            current: { registeredLabel: activeParticipantSpeakerLabel, registeredName: activeParticipantName },
          },
          lastRequestRef: lastConversationActionRef,
        },
        payload,
      ),
    [
      activeParticipantName,
      activeParticipantSpeakerLabel,
      applyConversationSpeaker,
      captureTurnAudio,
      commitTurnToSessionRows,
      conversationActiveRef,
      createSpeakerAudioResolver,
      emitConversationLog,
      flushPendingStreamLog,
      flushPcmAfterTurnCommit,
      scheduleLiveTranscriptUpdate,
      setSpeakerClusters,
      applyResolvedSpeaker,
      userRowsTextView,
      userSpeakersView,
    ],
  )

  const flushListenStateBeforeRebuild = useCallback(() => {
    if (!conversationActiveRef?.current) return
    // El interino en vuelo durante un stall/rebuild es NO CONFIABLE (Chrome congela a
    // mitad de frase y entrega una palabra truncada: "hoa" de "hola"). Commitearlo crea
    // filas basura y reinicia la linea abierta ("solo escribe hoa y deja de transcribir").
    // En rebuild se DESCARTA esa linea, sin tocar transcript de sesion ni indice.
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
      } catch (e) {
        logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', e, e?.stack);
        // Ignore stop errors.
      }
      recognitionRef.current = null
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      processorRef.current = null
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      sourceRef.current = null
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      analyserRef.current = null
    }

    if (zeroGainRef.current) {
      try {
        zeroGainRef.current.disconnect()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      zeroGainRef.current = null
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      audioContextRef.current = null
    }

    await stopMediaStream(mediaStreamRef.current)
    mediaStreamRef.current = null
  }, [clearAllCommitTimers, clearLiveTranscriptTimers, clearPassiveAudioDelayTimer, clearRecognitionRetryTimer, flushPendingStreamLog, clearCaptureState])

  const releasePassiveAudioCapture = useCallback(async () => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect?.()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      processorRef.current = null
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      sourceRef.current = null
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      analyserRef.current = null
    }

    if (zeroGainRef.current) {
      try {
        zeroGainRef.current.disconnect()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
      zeroGainRef.current = null
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close()
      } catch (err) { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', err, err?.stack) }
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
    // Decision unica (micCapture): `maxSensitivity` extiende la captura CRUDA de
    // sala tambien fuera de la conversacion; antes el navegador metia AGC/NS/EC y
    // atenuaba las voces lejanas del aula ("se pierde conversacion").
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: resolveCaptureAudioConstraints({
        conversationActive: Boolean(conversationActiveRef?.current),
        roomCapture,
        maxSensitivity: captureCfg.maxSensitivity === true,
        audio: conversationAudio,
      }),
    })
    mediaStreamRef.current = stream
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    const audioContext = new AudioContextClass()
    audioContextRef.current = audioContext
    sampleRateRef.current = audioContext.sampleRate || AUDIO_SAMPLE_RATE

    await audioContext.resume()

    const source = audioContext.createMediaStreamSource(stream)
    sourceRef.current = source

    const captureGain = resolveCaptureGain({
      conversationActive: Boolean(conversationActiveRef?.current),
      maxSensitivity: captureCfg.maxSensitivity === true,
      audio: conversationAudio,
    })

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
      sampleRate: sampleRateRef.current || AUDIO_SAMPLE_RATE,
      processEvery,
      onPcmBlock: (input) => {
        chunksRef.current.push(new Float32Array(input))
        chunkTotalSamplesRef.current += input.length
        probePcmBlock({ total: chunkTotalSamplesRef.current, chunks: chunksRef.current.length, listening: isListeningRef.current, conversation: Boolean(conversationActiveRef?.current) })
        trimAudioChunkBuffer(
          chunksRef,
          sampleRateRef.current || AUDIO_SAMPLE_RATE,
          FLU_CONFIG.voiceIdentity?.capture?.passiveBufferMs,
          chunkTotalSamplesRef,
        )
        // Fallback OFFLINE: el motor local (Whisper WASM) se alimenta del MISMO
        // PCM del micrófono cuando es la instancia activa. Chrome SR no expone
        // `pushAudio`, así que el chequeo no afecta el flujo online (default).
        if (typeof recognitionRef.current?.pushAudio === 'function') {
          recognitionRef.current.pushAudio(input, sampleRateRef.current || AUDIO_SAMPLE_RATE)
        }
      },
    })

    processorRef.current = micBridge
    zeroGainRef.current = micBridge.zeroGain
  }, [needsConversationPassiveAudio, conversationActiveRef])

  const schedulePassiveAudioCapture = useCallback(() => {
    const runCapture = () => {
      void setupPassiveAudioCapture().catch((e) => { logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', e, e?.stack) })
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
      const requireWake = requiresWakeWord(conversationActiveRef?.current)

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
        if (isVoiceProbeEnabled()) voiceProbe('asrRaw', { items: Array.from(event.results || []).map((r) => ({ f: r?.isFinal ? 1 : 0, t: String(r?.[0]?.transcript || '') })) })
        // Supresión de eco: mientras FLU HABLA, ignorar resultados del
        // reconocedor para no capturar la propia voz y re-mandarla a la IA.
        // Se usa la promesa propia de FLU (`isFluSpeaking`, acotada por el
        // watchdog), NUNCA el flag global del motor TTS: ese
        // quedaba pegado y silenciaba la escucha hasta recargar la página.
        if (isFluSpeaking() && isAssistantSpeechEcho(event, resolveEchoContext(useIntegrationStore.getState().conversationHistory, getLastCompletedSpeechAt()).lastAssistantText)) return
        logChromeSpeechResult(event)
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
          if (finalText) { const w = analyzeWakeTurn(finalText, { lastCommitted: userRowsTextView.current.at(-1) || '' }); voiceProbe('asrFinal', { wake: w.wakeWordMatched, inline: w.hasInlineBoundary, before: w.passiveOnly.slice(0, 80), after: w.afterWake.slice(0, 80), len: w.cleaned.length, text: w.cleaned }) }
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
            logCaughtError('[Flu][mic] onresult-conversation-failed', error)
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
        if (uiCommand === COMMAND_IDS.CERRAR_ESCUCHA) {
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

        // Estabilización de fragmentos (Bug #3/#4): si el turno acumulado quedó
        // en un comando incompleto ("ok flu busca en la web" sin consulta,
        // "navega", "crea un video"…), NO se ejecuta todavía: se espera a que
        // llegue el siguiente fragmento final (margen incompleteCommandWaitMs).
        const turnDecision = decideVoiceTurnDispatch(turnPhrase, FLU_CONFIG.voiceCommands, {
          requireWake,
        })
        const preLaunch = resolvePreLaunchDelay({
          turnPhrase,
          wakeWordMatched: validation.wakeWordMatched,
          ready: turnDecision.ready,
          timingCfg: FLU_CONFIG.timing,
        })
        // La espera previa al lanzamiento no la ve el cronómetro del turno (aún no
        // ha empezado): sin esta línea, un retardo fijo se confunde con "la IA o
        // la acción tardan". Se registra con su origen y desglose.
        relayLog(
          'LOG',
          'useFluVoiceAssistant',
          `esperaPrelanzamiento=${preLaunch.delayMs}ms origen=${preLaunch.origin} base=${preLaunch.baseMs}ms dictado=+${preLaunch.dictationExtraMs}ms palabras=${preLaunch.wordCount} frase="${turnPhrase.slice(0, 60)}"`,
        )
        scheduleAutoProcess(preLaunch.delayMs)
      }

      Recognition.onerror = (event) => {
        const errorCode = String(event.error || '').trim()

        // Fallback OFFLINE (§1/§9): ante error de red ('network') o ausencia de
        // habla ('no-speech') se degrada al motor local Whisper WASM en lugar de
        // reintentar Chrome. Config-driven (fallbackErrors). Solo cuando la
        // instancia activa sigue siendo Chrome (el motor local expone `pushAudio`),
        // para no re-degradar si el propio motor local reporta 'network'.
        if (
          shouldUseLocalFallback(errorCode) &&
          typeof recognitionRef.current?.pushAudio !== 'function'
        ) {
          const previous = recognitionRef.current
          if (previous) {
            previous.onstart = null
            previous.onresult = null
            previous.onerror = null
            previous.onend = null
            try {
              if (typeof previous.abort === 'function') previous.abort()
              else previous.stop()
            } catch (e) {
        logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', e, e?.stack);
              // ignore
            }
          }

          const localEngine = createLocalRecognition()
          if (!localEngine) {
            requestRecognitionRestart(getRecognitionRetryDelay(errorCode))
            return
          }

          recognitionRef.current = localEngine
          recognitionActiveRef.current = false
          wireRecognitionEvents(localEngine)
          localEngine.start()
          return
        }

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
      syncConversationStream,
      setError,
      resolvedWakeWords,
      userRowsTextView,
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
    wireRecognitionEvents,
    schedulePassiveAudioCapture,
    requestRecognitionRestart,
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
      } catch (e) {
        logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', e, e?.stack);
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
      conversationActiveRef,
    ],
  )

  const emitActiveConversationCommand = useCallback(
    async (command, transcript, { conversationCommandPreLogged = false } = {}) => {
      const cleaned = cleanForSpeech(transcript)
      clearAutoProcessTimer()

      const commandSpeaker =
        lastLoggedSpeakerRef.current || lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker

      const shouldBlockParticipantFloorGrant = () => {
        const participant = fluParticipantRef.current
        if (!participant) return true
        if (!participant.canAcceptFloorGrant?.()) return true
        if (participant.shouldIgnoreDuplicateFloorGrant?.()) return true
        return false
      }

      if (command === FLU_CONFIG.navigation.sessionResetCommand) {
        resetActiveListenState(listenStateRef.current)
        lastEmittedTranscriptRef.current = ''
        openPreviewTurnRef.current = false
        turnAudioStartSampleRef.current = 0
        lastStreamPreviewRef.current = ''
        lastLogLineTextRef.current = ''
        lastLogLineAtRef.current = 0
        lastLoggedCaptureRef.current = ''
        setSpeakerClusters([])
        lastSpeakerRef.current = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
        lastLoggedSpeakerRef.current = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
        clearSessionPrimarySpeaker(sessionPrimarySpeakerRef)
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

      if (command === COMMAND_IDS.FLU_ESPERA) {
        fluParticipantRef.current?.dismissRaisedHand?.()
        await commitAndResolveTurn({
          capture: cleaned,
          contract: {
            respuesta_voz: getCommandSpeech(COMMAND_IDS.FLU_ESPERA, language),
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

      if (command === COMMAND_IDS.FLU_ADELANTE) {
        const commandSpeaker =
          lastLoggedSpeakerRef.current || lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
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
        if (handRaised && isFluSpeaking()) {
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
          await respondParticipantFloor(getCommandSpeech(COMMAND_IDS.FLU_ADELANTE_EMPTY, language))
          return
        }

        const draft = participant?.consumeRaisedDraft?.() || ''
        if (!draft) {
          await respondParticipantFloor(getCommandSpeech(COMMAND_IDS.FLU_ADELANTE_EMPTY, language))
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
          respuesta_voz: getCommandSpeech(command, language, FLU_CONFIG, { name: detectWakeIntroducedName(cleaned, resolvedWakeWords) }),
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
    [commitAndResolveTurn, commitSessionTurn, language, persistDialogueSession, phase, releaseTurnAfterLog, clearAutoProcessTimer, seedSessionPrimaryFromActiveName, setSpeakerClusters, resolvedWakeWords],
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
      userRowsTextView,
    ],
  )

  const grantParticipantFloor = useCallback(async () => {
    if (fluParticipantRef.current?.shouldIgnoreDuplicateFloorGrant?.()) return
    // Frase compuesta SOLO desde config (sin literales): wake + concesión de
    // palabra (`grantFloor`). Antes: `ok ${wakeWords[0]} adelante` quemaba "ok"
    // y "adelante" y producía "ok oye flu adelante".
    const wakeWord = String(resolvedWakeWords[0] || '').trim()
    const grantWord = String(FLU_CONFIG.voiceCommands?.grantFloor?.[0] || '').trim()
    const phrase = [wakeWord, grantWord].filter(Boolean).join(' ')
    await emitActiveConversationCommand(COMMAND_IDS.FLU_ADELANTE, phrase)
  }, [emitActiveConversationCommand, resolvedWakeWords])

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
  /** Orden de politica de wake por voz (P8.68): aplica la bandera y confirma el turno. */
  const handleWakePolicyOrder = useCallback(
    async (text, { requireWake = false } = {}) => {
      const order = resolveWakePolicyOrder(text, FLU_CONFIG, { requireWake })
      if (!order || !applyWakePolicyOrder(order)) return false
      useIntegrationStore.getState?.().setVoiceConfig?.({ requireWakeAlways: order === WAKE_POLICY_ORDER.ON })
      await commitAndResolveTurn({
        capture: cleanForSpeech(text),
        contract: {
          respuesta_voz: wakePolicySpeech(order, language),
          navegacion: { comando: null, destino: null, parametros: {} },
        },
        diagnostics: null,
        speakerName: lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
        speakerAlias: null,
        phase, session, timestamp: formatClock(), signature: null, language,
      })
      return true
    },
    [commitAndResolveTurn, language, phase, session],
  )

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
        diagnostics: { route: 'deterministic-fast-path', provider: AI_PROVIDER_IDS.LOCAL, fastPath: true },
        effectOnly: true,
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
      // `unavailable` es del dominio de juegos aunque no traiga gameId (la respuesta la da el catalogo).
      if (!juego?.gameId && !isCatalogLevelGameAction(juego)) return null
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
        diagnostics: { route: 'deterministic-fast-path', provider: AI_PROVIDER_IDS.LOCAL, fastPath: true },
        effectOnly: true,
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

  // Fast-path determinista de AMBIENTE y de CONTROL DE MUSICA (modalidad del
  // dispatcher de estado: un `tipo` de ambiente o una `accion` de musica). Despacha el
  // contrato ya resuelto a la AsNICA ruta (onContractResolved -> applyEnvironment /
  // play-stop music). El catalogo (src/core/environments/*) y la tabla de marcos
  // (src/core/media/musicActions) son la fuente de verdad. Como los otros servicios,
  // NO escribe la conversacion (`effectOnly`).
  const dispatchFastEnvironmentCommand = useCallback(
    async (
      intent,
      { speakerName = null, speakerAlias = null, phase = 'SESION_ACTIVA', session = null, language = null, transcript = '', timestamp = '' } = {},
    ) => {
      const isMusicAction = Boolean(intent?.accion) && !intent?.tipo
      if (!intent?.tipo && !isMusicAction) return null
      await onContractResolved?.({
        contract: {
          respuesta_voz: isMusicAction ? musicActionSpeech(intent.accion, language || 'es') : '',
          navegacion: { comando: null, destino: null, parametros: {} },
          workspace: null,
          musica: isMusicAction ? { accion: intent.accion, ...(intent.cancion ? { cancion: intent.cancion } : {}) } : null,
          configuracion: null,
          juego: null,
          ambiente: isMusicAction ? null : intent,
          metadata: { provider: 'deterministic-fast-path', transcript, rawText: '' },
        },
        diagnostics: { route: 'deterministic-fast-path', provider: AI_PROVIDER_IDS.LOCAL, fastPath: true },
        effectOnly: true,
        transcript,
        speakerName,
        speakerAlias,
        phase,
        session,
        timestamp,
        signature: null,
        language,
        fastPathEnvironment: !isMusicAction,
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
      // Texto de la LOCUCIÓN del turno (frase canónica). Los fast-paths de estado
      // son EFECTOS del turno: reenviar una re-derivación (texto post-wake) haría
      // que el escritor de filas la tomara por otra frase y duplicara la fila.
      utterance = null,
    }) => {
      const transcript = cleanForSpeech(text)
      const utteranceTranscript = cleanForSpeech(utterance) || transcript
      // §1A: la resolución de los dominios con efecto de estado (config/juego/
      // ambiente) se delega al árbitro puro (src/voice/lib/deterministicArbiter.js).
      // El hook conserva SOLO la orquestación del despacho (onContractResolved).
      const { config, game, env, music } = resolveStatefulDomains(text, { language })
      if (transcript) noteGameTurn(consumesGameTurn(game))
      const dispatch = Promise.allSettled([
        config?.accion
          ? dispatchFastConfigCommand(config, {
              speakerName,
              speakerAlias,
              phase,
              session,
              language,
              timestamp,
              transcript: utteranceTranscript,
            })
          : Promise.resolve(null),
        game?.gameId || isCatalogLevelGameAction(game)
          ? dispatchFastGameCommand(game, {
              speakerName,
              speakerAlias,
              phase,
              session,
              language,
              timestamp,
              transcript: utteranceTranscript,
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
              transcript: utteranceTranscript,
            })
          : Promise.resolve(null),
        music
          ? dispatchFastEnvironmentCommand(music, {
              speakerName,
              speakerAlias,
              phase,
              session,
              language,
              timestamp,
              transcript: utteranceTranscript,
            })
          : Promise.resolve(null),
      ])
      return { config, game, env, music, dispatch }
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
      captureTurnAudio() // §9 sella el audio ANTES del commit-only (que vacía el buffer)
      // §9: una sola frase canónica para el turno (display y fila salen de ESTE valor).
      const canonicalPhrase = await commitAndResolveTurn({
        capture: fullTranscript || question,
        fallbackCapture: question, // texto validado del turno (si la captura cruda es basura)
        commitOnly: true,
      })
      // Sin frase válida no se llama a la IA (el motivo ya quedó registrado).
      if (!canonicalPhrase) return
      // §9: la query ya viene derivada por el derivador único
      // (`planConversationDispatch` → action.question); NO se re-deriva aquí.
      publishedLiveRef.current = ''
      setLiveTranscript('')

      const sampleRate = sampleRateRef.current || AUDIO_SAMPLE_RATE
      const streamSamples = turnAudioForDiarize(activeTurnIdRef.current, chunksRef.current)
      const audioSnapshot = streamSamples.length ? new Float32Array(streamSamples) : new Float32Array(0)
      const fallbackSpeaker = lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
      const currentClock = formatClock()
      const detectedLanguage = detectTranscriptLanguage(question)

      setStatus('processing')
      isProcessingRef.current = true
      // Turno vivo: overlay "Pensando" hasta terminar (IA + escrituras + acción +
      // voz) + cronómetro del turno.
      turnLifecycleRef.current?.startTurn('voz')
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
          setLastDiagnostics({ route: 'deterministic-arbiter', provider: AI_PROVIDER_IDS.LOCAL, skipGemini: true })
          setError('')
          setLastErrorEvent(null)
          // La respuesta ya está resuelta: la persistencia va DESPUÉS de la voz.
          persistSessionOffPath({
            phase: 'SESION_ACTIVA',
            ...session,
            history: getConversationContext(),
          })
          relayLog('LOG', 'useFluVoiceAssistant', `processConversationFluQuery §2B deterministic (skip Gemini): domain="${statefulDomain}", respuesta_voz="${courtesy.slice(0, 80)}"`)
          await commitAndResolveTurn({
            capture: canonicalPhrase,
            contract: deterministicContract,
            diagnostics: { route: 'deterministic-arbiter', provider: AI_PROVIDER_IDS.LOCAL, skipGemini: true },
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
    logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', probeError, probeError?.stack);
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
              // La fila del usuario es la MISMA frase canónica del turno: el
              // fast-path no debe registrar otra (defecto: fila duplicada sin wake).
              utterance: canonicalPhrase,
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

        // Reparto real del tiempo del turno: la fase paralela (IA + orador +
        // firma + fast-path) se mide como UNA marca; antes se atribuía a ojo el
        // hueco post-IA. El resumen se emite en el finally, con el total.
        turnLifecycleRef.current?.lap('ia+orador+firma+fastpath')
        const resolvedContract = buildResolvedContract({
          contract,
          lateStateful,
          fastPathConfig,
          fastGame,
          fastEnv,
        })

        setLastContract(resolvedContract)
        setLastDiagnostics(contract.diagnostics || null)
        setError('')
        setLastErrorEvent(null)
        // La respuesta ya está resuelta: la persistencia de sesión NO puede
        // adelantar a la voz (el usuario esperaba al disco para oír algo listo).
        // Se encola en orden y el turno sigue hasta la locución.
        persistSessionOffPath({
          phase: 'SESION_ACTIVA',
          ...session,
          history: getConversationContext(),
        })

        relayLog('LOG', 'useFluVoiceAssistant', `processConversationFluQuery calling commitAndResolveTurn with respuesta_voz="${(resolvedContract.respuesta_voz || '').slice(0, 80)}"`)
        turnLifecycleRef.current?.lap('contrato+escrituras')
        const turnSignature = audioSignatureVector ?? (await computeTurnSignature(audioSnapshot, sampleRate)).vector
        turnLifecycleRef.current?.lap('firma')
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
          signature: turnSignature,
          language: detectedLanguage,
          // En juegos por voz la voz es SIEMPRE del motor local (determinista).
          fastPathGame: Boolean(fastGame?.gameId),
          // En ambientes por voz la bienvenida la habla SIEMPRE el motor local.
          fastPathEnvironment: Boolean(fastEnv?.tipo),
        })
      } catch (error) {
    logCaughtError('[catch] src/voice/hooks/useFluVoiceAssistant.js', error, error?.stack);
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
        turnLifecycleRef.current?.lap('commit(accion+voz)')
        if (isListeningRef.current && !recognitionActiveRef.current) {
          requestRecognitionRestart(FLU_CONFIG.timing.resumeAfterSpeechMs)
        }
      } finally {
        isProcessingRef.current = false
        turnLifecycleRef.current?.endTurn('voz')
        if (isListeningRef.current) {
          setStatus('listening')
        } else {
          setStatus('idle')
        }
      }
    },
    [
      captureTurnAudio,
      conversationActiveRef,
      commitAndResolveTurn,
      getConversationContext,
      requestFluContractForTranscript,
      requestRecognitionRestart,
      reportGeminiFailure,
      resolveSpeaker,
      applyConversationSpeaker,
      turnLifecycleRef,
      persistSessionOffPath,
      session,
      evaluateDeterministicFastPaths,
      computeTurnSignature,
      language,
    ],
  )

  const runConversationActionDispatch = useCallback(
    async (text, { interim = false, source = 'interim', awaitHandlers = false } = {}) => {
      if (!conversationActiveRef?.current) return false
      const phrase = cleanForSpeech(text)
      const lastCommitted = userRowsTextView.current.at(-1) || ''
      // UN solo criterio de "¿habla FLU?": la promesa propia (`isFluSpeaking`), la
      // misma que usa la supresion de eco de `onresult`. Antes aqui se preguntaba
      // con `isSpeechBusy()`, que incluye el flag GLOBAL `speechSynthesis.speaking`
      // —del que este mismo fichero documenta que "quedaba pegado y silenciaba la
      // escucha"—: con el flag pegado el eco se filtraba bien pero el despacho
      // devolvia false y el turno se perdia en silencio.
      if (isFluSpeaking()) {
        return false
      }

      if (await handleWakePolicyOrder(text, { requireWake: true })) return true

      const plan = planVoiceCommandDispatch(text, {
        interim,
        lastSignature: lastConversationActionRef.current.signature,
        lastAt: lastConversationActionRef.current.at,
        // La REVISION DEL ASR la decide el planificador (dueno unico de la
        // decision): aqui solo se le pasa la memoria de la ultima peticion
        // aceptada (texto + instante). Antes esta regla vivia en el hook con
        // la ventana como literal (1600) y el planificador con su propia dedupe.
        lastPhrase: lastConversationActionRef.current.text,
        lastCommitted,
        // Piso: la wake es obligatoria? (dueno unico: requiresWakeWord). Decide si
        // una captura sin wake es turno; antes el despacho la descartaba SIEMPRE
        // aunque el stream le hubiera abierto fila (P8.49) -> peticion pendiente.
        wakeRequired: requiresWakeWord(conversationActiveRef?.current),
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
    [conversationActiveRef, dispatchPassiveVoiceCommand, processConversationFluQuery, resolvedWakeWords, userRowsTextView, handleWakePolicyOrder],
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
    // Dedup de captura: criterio unico (captureDedup) con la ventana del despacho.
    const snapshotKeyDedup = cleanForSpeech(snapshot || '')
    if (snapshotKeyDedup) {
      const nowMsDedup = Date.now()
      const prevCap = lastProcessedCaptureRef.current
      const skipReason = shouldSkipCapture({
        prevText: prevCap.text,
        prevAt: prevCap.at,
        nextText: snapshotKeyDedup,
        nowMs: nowMsDedup,
        correctionInFlight: isNavSettlePending() || isProcessingRef.current,
      })
      if (skipReason) {
        relayLog(
          'WARN',
          'useFluVoiceAssistant',
          `processCapture SKIP: captura ${skipReason} (${nowMsDedup - prevCap.at}ms)`,
        )
        return
      }
      lastProcessedCaptureRef.current = { text: snapshotKeyDedup, at: nowMsDedup }
    }
    if (!snapshot && !closing) return

    const requireWake = requiresWakeWord(conversationActiveRef?.current)
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
            fallbackSpeaker: lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
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
    // Turno vivo: overlay "Pensando" hasta terminar (IA + acción + voz) + cronómetro.
    turnLifecycleRef.current?.startTurn('captura')
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

      const sampleRate = sampleRateRef.current || AUDIO_SAMPLE_RATE
      const streamSamples = turnAudioForDiarize(activeTurnIdRef.current, chunksRef.current)
      const currentClock = formatClock()
      const fallbackSpeaker = lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
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
          // §9.3: `afterWake`/`question` ya vienen normalizados por el análisis
          // del turno; NO se vuelve a limpiar aquí (sin segundo normalizador).
          capturedTranscript = wakeAnalysis.afterWake || wakeAnalysis.question
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

        // Un rechazo de la puerta de la wake word NO es un turno: no abre fila.
        // Aula/casa (TV, ninos): el texto sigue en la transcripcion viva, pero no
        // ensucia el historial ni parece una frase dirigida a FLU.
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
      // Orden de politica de wake por voz (bandera P8.68): se aplica y se confirma.
      if (await handleWakePolicyOrder(bufferedValidation.commandText)) {
        finishTurn(); await cleanupAudio(); setStatus('idle'); isListeningRef.current = false
        return
      }

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

      // Orador rapido por TEXTO para el prompt y el fast-path; lo reconcilia el audio.
      const fastSpeakerName =
        detectIntroducedName(bufferedTranscript || capturedTranscript) ||
        lastSpeakerRef.current ||
        fallbackSpeaker

      // Diarización pesada EN PARALELO con la API; el catch de abajo la hace no-fatal (misma policy que el lote conversacional vía Promise.allSettled): si falla, se degrada al orador rápido.
      const speakerPromise = resolveSpeaker(
        capturedTranscript,
        audioSnapshot,
        sampleRate,
        fallbackSpeaker,
      ).catch((speakerError) => {
        logCaughtError('processCapture resolveSpeaker; se usa orador rapido', speakerError)
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
          evidenciaAcustica: turnSpeaker.evidenciaAcustica === true,
          resolvedSpeakerName:
            turnSpeaker.resolvedSpeakerName || turnSpeaker.speakerName || fastSpeakerName,
          speakerAlias: turnSpeaker.speakerAlias ?? null,
        }
      }

      if (directCommand) {
        // El comando directo espera la diarización (ya en curso) para conservar el
        // orador real y la firma; si ésta fallara, se degrada al orador rápido.
        const { signatureVector, resolvedSpeakerName, speakerAlias, evidenciaAcustica } = await resolveTurnSpeaker()

        if (directCommand === FLU_CONFIG.navigation.sessionResetCommand && conversationActiveRef?.current) {
          await emitActiveConversationCommand(FLU_CONFIG.navigation.sessionResetCommand, capturedTranscript)
          return
        }

        // "cerrar escucha" debe cerrar de verdad: no reabrir la captura pasiva.
        if (directCommand === COMMAND_IDS.CERRAR_ESCUCHA) {
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
            respuesta_voz: getCommandSpeech(directCommand, detectedLanguage || language, FLU_CONFIG, { name: detectWakeIntroducedName(capturedTranscript, resolvedWakeWords) }),
            navegacion: {
              comando: directCommand,
              destino: null,
              parametros: {},
            },
          },
          diagnostics: null,
          speakerName: resolvedSpeakerName,
          speakerAlias, evidenciaAcustica,
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

        // §9: la IA recibe la query ya derivada por el derivador único
        // (`planConversationDispatch`) — el texto normalizado del turno.
        const turnQuery = bufferedTranscript || capturedTranscript

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
          logCaughtError('src/voice/hooks/useFluVoiceAssistant.js', error, { code: error?.code, status: error?.status, apiKeySource: error?.apiKeySource })
          const errorMessage = formatGeminiUserMessage(error, language, { fallback: true })
          logCaughtError('src/voice/hooks/useFluVoiceAssistant.js', errorMessage)
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

        // Idempotencia fast-path (configuracion/juego/ambiente/musica): su regla tiene UN
        // dueno (resolvedContract.estadoFastPathIdempotente); NO se copia aqui.
        const finalContract = {
          ...contract.contract,
          respuesta_voz: contract.contract.respuesta_voz,
          ...estadoFastPathIdempotente({ fastPathConfig, fastGame, fastEnv, lateStateful, contract }),
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

      // §9: la IA recibe la query ya derivada por el derivador único
      // (`planConversationDispatch`) — el texto normalizado del turno.
      const turnQuery = bufferedTranscript || capturedTranscript

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
        logCaughtError('src/voice/hooks/useFluVoiceAssistant.js', error, { code: error?.code, status: error?.status, apiKeySource: error?.apiKeySource })
        const errorMessage = formatGeminiUserMessage(error, language, { fallback: true })
        logCaughtError('src/voice/hooks/useFluVoiceAssistant.js', errorMessage)
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
        ...estadoFastPathIdempotente({ fastPathConfig, fastGame, fastEnv, lateStateful, contract }),
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
        evidenciaAcustica,
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
      turnLifecycleRef.current?.endTurn('captura')
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
    turnLifecycleRef,
    clearAutoProcessTimer,
    commitAndResolveTurn,
    conversationActiveRef,
    evaluateDeterministicFastPaths,
    emitActiveConversationCommand,
    handleWakePolicyOrder,
    emitConversationLog,
    finalizeRecognition,
    getConversationContext,
    language,
    phase,
    readCaptureSnapshot,
    releaseTurnAfterLog,
    requestFluContractForTranscript,
    resolveSpeaker,
    restartRecognition,
    session,
    awaitConversationAction,
    commitSessionTurn,
    computeTurnSignature,
    resolvedWakeWords,
    userRowsTextView,
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
        const srGapMinWords = Number(pauseCfg.srGapCommitMinWords) || 0
        const sinceResult = now - (lastOnresultAtRef.current || 0)
        const openLine = cleanForSpeech(
          listenStateRef.current?.openLine ||
          publishedLiveRef.current ||
          readStreamDisplay(listenStateRef.current),
        )
        const srGap = resolveSrGapTrigger({ sinceLastResultMs: sinceResult, sinceLastCommitMs: lastCommitAtRef.current > 0 ? now - lastCommitAtRef.current : 0, hasOpenLine: Boolean(openLine) })
        if (srGap.fire && !srGapFiredForOpenLineRef.current) {
          if (openLine && countSpeechWords(openLine) >= srGapMinWords) {
            srGapFiredForOpenLineRef.current = true
            ingressRuntimeRef.current?.pushSrGapEvent?.({ sinceLastResultMs: srGap.sinceLastResultMs })
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
      ...resolveEchoContext(useIntegrationStore.getState().conversationHistory, getLastCompletedSpeechAt()),
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

