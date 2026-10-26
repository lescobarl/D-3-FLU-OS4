import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tramoDelTurno } from '../core/tramo.js'
import {
  computeAudioSignature,
  cleanForSpeech,
  decideVoiceTurnDispatch,
  detectWakeIntroducedName,
  detectListeningControl,
  detectRole,
  detectTranscriptLanguage,
  extractTheme,
  formatClock,
  extractFluVoiceCommand,
  getRecognitionRetryDelay,
  getRecognitionErrorMessage,
  isRecoverableRecognitionError,
  isMinuteGenerationRequest,
  isMinuteSaveRequest,
  isMinuteKnowledgeRequest,
  splitTranscriptAtWakeWord,
} from '../lib/audioMath'
import { isNavSettlePending } from '../lib/navSettleFlag'
import { getFluTimingCfg } from '../lib/fluTranscriptMotor.js'
import { analyzeWakeTurn, requiresWakeWord } from '../lib/wakeTurnCommit.js'
import { crearCajaDeLaFrase } from '../lib/conversationStreamCommit.js'
import { loadSessionState, saveSessionState } from '../lib/fluStorage'
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
import { recordSessionTurn } from '../lib/sessionRecorder.js'
import { captureTurnAudioSnapshot, capturedTurnAudio, probePcmBlock, turnAudioForDiarize } from '../lib/turnAudioSnapshot.js'
import { useIntegrationStore } from '../../store/integrationStore'
import { fluAsyncErrorHandler } from '../lib/fluAsyncError.js'
import {
  FLU_CONFIG,
  getActiveListenConfig,
  getConversationRestartConfig,
  getConversationConfig,
} from '../lib/fluConfig'
import {
  getCommandSpeech,
  planVoiceCommandDispatch,
  resolveNavigationCommand,
} from '../lib/voiceCommands'
import {
  flattenChunksTail,
  flattenChunksWindow,
  isProperSpeakerName,
  normalizeSpeakerLabel,
  pruneGhostSpeakerClusters,
  trimAudioChunkBuffer,
} from '../lib/voiceIdentity'
import { setSessionPrimarySpeaker } from '../lib/sessionPrimarySpeaker'
import { applySessionCommandToPrimary } from '../lib/sessionLifecycle.js'
import { resetVoiceDirectory } from '../lib/speakerDirectory.js'
import { participantRegisterPort, registerSpeakerIdentity } from '../lib/speakerIdentityRegister'
import { resolveSpeakerIdentityFromVector } from '../lib/voiceIdentityResolve.js'
import {
  getConversationMinVoicedSamples,
  getConversationSpeakerTailMs,
  getDiarizeIntervalMs,
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
  nextSpeakerLabel,
  readCommandText,
  archiveCommittedTurn,
  getSpeakerLabel,
  resetActiveListenState,
  getRecognitionLanguage,
  isBilingualListenMode,
  resolveRecognitionLocale,
  resolveSpeakerByText as resolveConversationSpeakerLabel,
  syncSpeakerIndexFromLabel,
} from '../lib/activeListen.js'
import { buildResolvedContract, estadoFastPathIdempotente } from '../lib/resolvedContract.js'
import {
  acquireSpeechRecognition,
  startSpeechRecognition,
  stopSpeechRecognition,
} from '../lib/speechRecognitionLocal'
import { logChromeSpeechResult, getListenLogRing, clearListenLogRing } from '../lib/listenLog'
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
  normalizeTurnCapture,
  resetTurnState,
  waitForCaptureSettle,
} from '../lib/turnTranscript'
import { wireMicCapturePipeline } from '../lib/micCaptureBridge.js'
import { formatGeminiUserMessage, buildGeminiDiagnosticsFromError } from '../lib/geminiDiagnostics.js'
import { resolveTurnCommitPhrase } from '../lib/turnCommitPhrase.js'
import { resolveWakeWords } from '../lib/wakeWords.js'
import { startContinuousIdentityPipeline, stopAllContinuousIdentityPipelines } from '../lib/turnIdentityPipeline.js'
import {
  createTurnSpeakerAudioResolver,
  peekTurnSpeakerPreflight,
  preflightEvidenceMeasured,
} from '../lib/turnSpeakerPreflight.js'
import {
  blindSpeakerFallback,
  resolveSpeakerNameFromUtterance,
  shouldSkipPreviewDiarize,
} from '../lib/speakerPolicy.js'
import { WAKE_POLICY_ORDER, applyWakePolicyOrder, resolveWakePolicyOrder, wakePolicySpeech } from '../lib/wakePolicy.js'
import { normalizeLang } from '../../core/config/localeConfig.ts'
import { normalizeMicText } from '../lib/speechMerge.js'
// Ruta única: useFluParticipant vive solo en src/hooks/useFluParticipant.ts.
// El motor de voz la importa aquí solo como fallback defensivo; en producción App.tsx inyecta su instancia vía participantRef (mismo módulo).
import { useFluParticipant } from '../../hooks/useFluParticipant'
import { isSpeechSynthesisSpeaking, isFluSpeaking, waitForSpeechIdle, getLastCompletedSpeechAt } from '../lib/fluSpeech.js'
import { resumeAfterSpeechSuspend, releaseStalledTurn } from '../lib/voiceStallPolicy.js'
import { isLocalFallbackEnabled, prewarmLocalRecognition, shouldUseLocalFallback } from '../lib/voiceLocalFallback'
import { useLocalAsrFallback } from './useLocalAsrFallback'
import { logCaughtError } from '../../lib/caughtError';
import { clearAnimationFrameRef, clearTimeoutRef } from '../../lib/timerRefs'
import { useTurnLifecycleSync, useOffPathSessionWriter } from './useTurnInfrastructure'
import { useSessionSpeakerClusters } from './useSessionSpeakerClusters'
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
import { getFallbackSpeaker, isAutoSpeakerLabel, payloadSeparacionDeTurno } from '../lib/speakerCore.js';
import { countVoicedSamples, selectVoicedWindow } from '../lib/voicedActivity.js';
import { reservedSpeakerLabels } from '../lib/speakerLabels.js';
import { COMMAND_IDS } from '../lib/commandIds.js'
import { createEmissionDeduper, shouldSkipCapture } from '../lib/captureDedup.js'
import { isAssistantSpeechEcho, isAssistantVoiceEcho } from '../lib/conversationStream.js'
import { voiceProbe, isVoiceProbeEnabled } from '../lib/voiceProbe'
import { defaultLanguage } from '../lib/languageDefault.ts'
import { crearMotorConversacionHook } from '../compose/conversationMotorProducto'
const CONTEXT_HISTORY_LIMIT = FLU_CONFIG.limits.contextHistoryMax
// Sample rate de captura: fuente única en FLU_CONFIG.audio.sampleRate (sin hardcode).
const AUDIO_SAMPLE_RATE = FLU_CONFIG.audio?.sampleRate ?? 0

async function stopMediaStream(stream) {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

function createRecognition(language, activeLocale = '') {
  // §9 Motor de escucha: Chrome SpeechRecognition (Google, online) — en vivo y
  // preciso. El resto del pipeline (ingress/commit/query/display/diarización) sigue unificado y es agnóstico al motor.
  return acquireSpeechRecognition(language, activeLocale)
}

function deriveSession(transcript, currentRole = '', language = defaultLanguage()) {
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
  language = defaultLanguage(),
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
  participantVoiceAnchors = /** @type {Array<{ name?: string, vector?: number[], model?: string }>} */ ([]),
  identitySession = /** @type {{ current: unknown } | null} */ (null),
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
   * §9: ÚNICO punto de commit de la locución del turno: limpia UNA vez y devuelve la frase
   * canónica para que la fila use EXACTAMENTE el mismo texto (display === fila).
   */
  // Wake words efectivas (Ajustes o default): UN solo criterio. Van declaradas ANTES del commit porque el commit las consume para recortar el eco.
  const resolvedWakeWords = resolveWakeWords(wakeWords)
  const commitTurnPhrase = useCallback((text, fallback = '') => {
    const phrase = normalizeMicText(resolveTurnCommitPhrase({ capture: text, fallback, log: relayLog, wakeWords: resolvedWakeWords }))
    // En CONVERSACIÓN la frase visible la escribe SOLO el módulo (`box.updated` /
    // `row.committed`): este hook no la reescribe (Anexo B 5/6, un solo escritor).
    if (phrase && !conversationActiveRef?.current) commitVisibleTranscript(phrase)
    return phrase
  }, [commitVisibleTranscript, conversationActiveRef, resolvedWakeWords])
  // Limpieza del estado del turno tras resolver (se asigna cuando `clearTurnBuffers` existe). Evita que la locución ya ejecutada quede en el
  // buffer/spill y se vuelva a procesar (ciclo de comandos repetidos).
  const clearTurnAfterResolveRef = useRef(() => {})
  const activeTurnIdRef = useRef(0)
  const lastEmittedTurnRef = useRef(0) // turno de la ultima locucion emitida: resolucion tardia idempotente
  /**
   * §9: par ÚNICO `commit + resolución` del turno. TODAS las ramas cierran por
   * aquí, de modo que el display (commit) y la fila (`transcript`) no puedan
   * divergir por construcción: la fila es SIEMPRE el valor commiteado.
   * Las ramas solo aportan su `contract` y los campos del payload.
   */
  const commitAndResolveTurn = useCallback(
    async ({ capture, fallbackCapture = '', contract, commitOnly = false, ...payload } = {}) => {
      // En CONVERSACIÓN la frase canónica la produce el módulo (normalización,
      // dedup y commit viven allí): este hook NO la re-normaliza (Anexo B 2/6).
      const canonicalPhrase = conversationActiveRef?.current
        ? cleanForSpeech(capture || fallbackCapture)
        : commitTurnPhrase(capture, fallbackCapture)
      const evidenciaAcustica = payload.evidenciaAcustica === true // solo la DECLARA quien midio VOZ (preflight/sync con ventana)
      // Garbage descartada (anti-alucinación): no se commitea ni se consulta a IA.
      if (!canonicalPhrase) return
      // `commitOnly`: commit temprano + fila del USUARIO inmediata (sin esperar a
      // la IA). La resolución posterior re-commitea el MISMO valor (idempotente) y deduplica la fila, así no hay doble fuente.
      if (commitOnly) {
        if (!earlyCommitDedupeRef.current.isRepeat(canonicalPhrase)) {
          await onContractResolved?.({ contract: null, userCommitOnly: true, transcript: canonicalPhrase, speakerName: payload.speakerName, evidenciaAcustica, phase: payload.phase, turnId: activeTurnIdRef.current })
        }
        return canonicalPhrase
      }
      // El turno de la fila es el de la FRASE (no el vivo): una resolucion tardia de una frase
      // ya emitida escribe SU fila, no una nueva bajo el turno siguiente (filas duplicadas).
      const turnIdDeLaFrase = canonicalPhrase && canonicalPhrase === lastEmittedTranscriptRef.current && lastEmittedTurnRef.current ? lastEmittedTurnRef.current : activeTurnIdRef.current
      const result = await onContractResolved?.({ contract, ...payload, evidenciaAcustica, transcript: canonicalPhrase, turnId: turnIdDeLaFrase })
      // Turno cerrado: limpiar buffer/spill para que la locución ya ejecutada no se reprocese (ciclo de comandos/ambient que repetían la misma orden).
      clearTurnAfterResolveRef.current?.()
      return result
    },
    [commitTurnPhrase, conversationActiveRef, onContractResolved],
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
  // §9 vistas de SOLO LECTURA del store `conversationHistory` (sin setter: escribir lanza).
  const dialogueView = useMemo(
    () => ({
      get current() {
        return deriveDialogueHistory(useIntegrationStore.getState().conversationHistory)
      },
    }),
    [],
  )
  // §9 El ref y su setter: `useSessionSpeakerClusters` siembra las anclas medidas
  // de la base en TODA escritura (voz conocida = nombre inmediato).
  const speakerClustersRef = useRef([])
  const { setClusters: setSpeakerClusters } = useSessionSpeakerClusters(speakerClustersRef, participantVoiceAnchors)
  // Ciclo de vida del turno (overlay + cronómetro) y persistencia fuera del camino
  // crítico: viven en `useTurnInfrastructure` para no engordar este hook.
  const turnLifecycleRef = useTurnLifecycleSync()
  const { write: persistSessionOffPath } = useOffPathSessionWriter(
    saveSessionState,
    fluAsyncErrorHandler('useFluVoiceAssistant'),
  )
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
  const chunkTotalSamplesRef = useRef(0)
  const turnAudioStartSampleRef = useRef(0) // muestras al abrir turno (diarizacion alineada)
  const lastSpeakerRef = useRef('')
  const lastLoggedSpeakerRef = useRef('')
  const lastResolvedSpeakerRef = useRef('') // Ultima voz RESUELTA POR MEDIDA (unico escritor: applyResolvedSpeaker); el sticky la prefiere a lastLogged (d4c1c8f3)
  const lastTurnSignatureRef = useRef(null)
const lastResolvedTurnRef = useRef(0)
  const isCommittingRef = useRef(false)
  const commitBaselineRef = useRef('')
  const liveDebounceTimerRef = useRef(null)
  const livePendingCaptureRef = useRef('')
  const liveRafRef = useRef(null)
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
  // Procedencia de `lastLogLineTextRef`: la escribio una ORDEN cuya locucion sigue viva.
  const lastLogLineWasCommandRef = useRef(false)
  const lastLogLineAtRef = useRef(0)
  const recognitionRestartPendingRef = useRef(false)
  const consecutiveEndsWithoutResultRef = useRef(0)
  const stopListeningRef = useRef(async () => { })
  const startListeningRef = useRef(async () => { })
  const dispatchPassiveVoiceCommandRef = useRef(async () => { })
  const processConversationFluQueryRef = useRef(async () => { })
  const tryDispatchConversationActionRef = useRef(() => false)
  const scheduleIdentityPreflightRef = useRef(() => { })
  const lastConversationActionRef = useRef({ signature: '', at: 0 })
  const rebuildRecognitionRef = useRef(() => false)
  const wireRecognitionEventsRef = useRef(() => { })
  const maybeSwitchRecognitionLocaleRef = useRef(() => { })
  const recognitionLocaleRef = useRef(getRecognitionLanguage(language))
  const localeSwitchDetectRef = useRef('')
  const localeSwitchCountRef = useRef(0)
  const lastRecognitionEndAtRef = useRef(0)
  const lastOnresultAtRef = useRef(0)
  const lastMeaningfulIngressAtRef = useRef(0)
  const lastStallRebuildAtRef = useRef(0)
  // Reloj del ULTIMO RESULTADO (solo onresult; sobrevive a rebuilds): "SR mudo de verdad".
  const lastSrResultAtRef = useRef(0)
  // Ref (no dep): las deps por IDENTIDAD re-montaban el efecto en bucle (1419/289 s, cero ticks).
  const requestRecognitionRestartRef = useRef(null)
  const lastSpeakerDiarizeAtRef = useRef(0)
  const lastLogEmitAtRef = useRef(0)
  const passiveAudioDelayTimerRef = useRef(null)
  const passiveSetupPromiseRef = useRef(null)
  const _audioProcessSkipRef = useRef(0)
  const _lastDiarizeAtRef = useRef(0)
  const listeningAckTimerRef = useRef(null)
  const _lastTurnHadFinalRef = useRef(false)
  const _allowStableCommitRef = useRef(false)
  const preflightScheduledForTurnRef = useRef(false)
  const sessionPrimarySpeakerRef = useRef('')
  if (identitySession) identitySession.current = { ...(identitySession.current || {}), speakerClustersRef, sessionPrimarySpeakerRef, setClusters: setSpeakerClusters, getLastTurnSignature: () => lastTurnSignatureRef.current }
  const turnSegmentStartedAtRef = useRef(0)

  /** Motor CONVERSACIÓN del producto: única ruta de escritura de filas. */
  const motorConversacionRef = useRef(null)
  const languageRef = useRef(language)
  languageRef.current = language
  const abrirMotorConversacion = useCallback(() => {
    if (!motorConversacionRef.current) {
      // El turno del preflight es un número POSITIVO: el pipeline de identidad
      // ignora 0, así que la primera locución de la sesión necesita id 1.
      if (activeTurnIdRef.current < 1) activeTurnIdRef.current = 1
      motorConversacionRef.current = crearMotorConversacionHook({
        idioma: normalizeLang(languageRef.current),
        turnId: () => activeTurnIdRef.current,
        onLiveTranscript: setLiveTranscript,
        // B.6: la query de la IA sale de la MISMA frase canónica del módulo; el
        // planificador único decide revisión y dedup sobre ese texto.
        onFraseCanonica: (frase, opciones = {}) => {
          const interim = opciones.interim === true
          tryDispatchConversationActionRef.current(frase, {
            interim,
            source: interim ? 'asr-interim' : 'asr-final',
          })
        },
        // Calienta la medida de voz ANTES de que el módulo lea la evidencia.
        onTextoParaIdentidad: (frase) => scheduleIdentityPreflightRef.current({ utterance: frase }),
        // Frontera de TURNO (locución nueva): la siguiente frase es otro turno.
        onLocucionCommiteada: () => {
          activeTurnIdRef.current += 1
          preflightScheduledForTurnRef.current = false
          turnSegmentStartedAtRef.current = Date.now()
          turnAudioStartSampleRef.current = chunkTotalSamplesRef.current
        },
      })
    }
    motorConversacionRef.current.abrir()
  }, [])
  const cerrarMotorConversacion = useCallback((motivo) => {
    if (!motorConversacionRef.current) return
    motorConversacionRef.current.cerrar(motivo)
    motorConversacionRef.current = null
  }, [])
  useEffect(() => () => cerrarMotorConversacion('system'), [cerrarMotorConversacion])

  // Fallback LOCAL del ASR (degradar a Whisper, gatear sus resultados y recuperar
  // Chrome): dueno unico en `useLocalAsrFallback`. El cableado se pasa por ref para
  // no crear una dependencia circular con `wireRecognitionEvents`.
  const fallback = useLocalAsrFallback({
    recognitionRef,
    wireRecognitionEventsRef,
    createRecognition,
    startRecognition: startSpeechRecognition,
    language,
    recognitionLocaleRef,
    isListeningRef,
    isStoppingRef,
    chunksRef,
    sampleRateRef,
    lastSrResultAtRef,
    lastOnresultAtRef,
    lastMeaningfulIngressAtRef,
    lastRecognitionEndAtRef,
    lastStallRebuildAtRef,
    recognitionActiveRef,
    recognitionRestartPendingRef,
    rebuildRecognitionRef,
    requestRecognitionRestartRef,
    relayLog,
    audioSampleRate: AUDIO_SAMPLE_RATE,
    getRestartConfig: getConversationRestartConfig,
    degradeEnabled: isLocalFallbackEnabled(),
  })

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
    // El PARTICIPANTE ACTIVO es un DATO de la persona, no la identidad de una VOZ (mandato
    // 2026-10-13: "la etiqueta y el participante activo no nombran a nadie"). Antes esto
    // registraba su nombre para la voz de su `speakerLabel` SIN medida -> "Luis a la chica".
    // Solo se fija como primario de la sesion (dato), sin nombrar ninguna voz.
    setSessionPrimarySpeaker(sessionPrimarySpeakerRef, name, 'participant')
  }, [activeParticipantName])

  useEffect(() => {
    seedSessionPrimaryFromActiveName()
  }, [seedSessionPrimaryFromActiveName])

  getParticipantLogSnapshotRef.current = () => ({
    texts: userRowsTextView.current,
    speakers: userSpeakersView.current,
  })

  // OS3 parity: if an external participantRef is provided, use it instead of creating a new
  // instance (voz y boton de UI comparten estado). El hook SIEMPRE se invoca (orden estable);
  // la instancia propia queda inerte cuando App.tsx inyecta la suya -> no omitirlo.
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
    const hasGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia)
    const hasSpeechRecognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    const hasAudioContext = Boolean(window.AudioContext)
    // §9 Motor: Chrome SpeechRecognition (Google, online) + AudioContext para la captura PCM (identidad de voz). El resto del pipeline es agnóstico.
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
        // §9: el historial restaurado lo carga `useConversationPersistence` en el store; el motor NO mantiene diálogo propio. El filtrado de eventos de
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
    clearTimeoutRef(liveDebounceTimerRef)
    clearAnimationFrameRef(liveRafRef)
  }, [])

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

  // CANCELA la escritura perezosa pendiente (debounce/RAF) Y su texto en vuelo. La caja
  // lo llama antes de cualquier escritura inmediata: sin esto, un update programado
  // antes del vaciado pintaba su captura vieja DESPUES y la ultima frase "volvia".
  const cancelLiveTranscriptUpdate = useCallback(() => {
    clearLiveTranscriptTimers()
    livePendingCaptureRef.current = ''
  }, [clearLiveTranscriptTimers])

  // CAJA de la frase viva: la escribe SOLO la API del modulo dueno; el hook no toca el ref.
  const cajaVivaRef = useRef(null)
  if (!cajaVivaRef.current) cajaVivaRef.current = crearCajaDeLaFrase({ publishedLiveRef, setLiveTranscript, cancelLiveTranscriptUpdate, scheduleLiveTranscriptUpdate })

  const flushLiveTranscript = useCallback(() => {
    if (conversationActiveRef?.current) {
      // §9 — UN SOLO ESCRITOR: en conversación activa la frase viva la escribe
      // únicamente el módulo de conversación (`box.updated`) a través de
      // `onLiveTranscript`. Aquí NO se escribe: la caja es del modo pasivo.
      return
    }

    const raw = readCommandSnapshot(turnRef.current, pendingSpillRef.current)
    const turnPreview = raw ? cleanForSpeech(raw) : ''

    if (turnPreview) {
      // La entrega del espejo visible la agenda quien llama (publishLive/publishLiveImmediate).
      cajaVivaRef.current.publicarEnLaCaja(turnPreview, { inmediato: true })
      return
    }

    if (isListeningRef.current && publishedLiveRef.current) {
      return
    }

    cajaVivaRef.current.vaciarLaCaja()
  }, [conversationActiveRef])

  const publishLive = useCallback(() => {
    if (typeof window === 'undefined') {
      flushLiveTranscript()
      return
    }
    clearTimeoutRef(liveDebounceTimerRef)
    liveDebounceTimerRef.current = window.setTimeout(() => {
      liveDebounceTimerRef.current = null
      flushLiveTranscript()
    }, FLU_CONFIG.timing.liveTranscriptDebounceMs)
  }, [flushLiveTranscript])

  const publishLiveImmediate = useCallback(() => {
    clearTimeoutRef(liveDebounceTimerRef)
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
    lastLogLineWasCommandRef.current = false
    lastLogLineAtRef.current = 0
    lastTurnSignatureRef.current = null
    commitVisibleTranscript('')
    cajaVivaRef.current.vaciarLaCaja()
  }, [clearCaptureState, commitVisibleTranscript])

  const resetConversationSession = useCallback(() => {
    resetVoiceDisplay()
    clearListeningAck()
    setSpeakerClusters([])
    // UNA sola fuente de la etiqueta inicial (auditoria 2026-10-23): getFallbackSpeaker.
    lastSpeakerRef.current = getFallbackSpeaker()
    lastLoggedSpeakerRef.current = getFallbackSpeaker()
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
      // La memoria de lo MOSTRADO nunca encoge dentro de la sesion (regla literal).
      if (spillPreview) cajaVivaRef.current.publicarEnLaCaja(spillPreview)
      flushLiveTranscript()
    },
    [flushLiveTranscript],
  )

  const clearAutoProcessTimer = useCallback(() => {
    clearTimeoutRef(autoProcessTimerRef)
    clearTimeoutRef(liveDebounceTimerRef)
  }, [])

  const clearAllCommitTimers = useCallback(() => {
    clearAutoProcessTimer()
  }, [clearAutoProcessTimer])

  const clearRecognitionRetryTimer = useCallback(() => {
    clearTimeoutRef(recognitionRetryTimerRef)
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

      // FLU "thinking": gobierna la EXPRESIÓN del avatar (el overlay es del turno);
      // las consultas locales de minuta resuelven antes y se lo saltan.
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

  requestRecognitionRestartRef.current = requestRecognitionRestart

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
    resumeAfterSpeechSuspend({ wasListeningBefore, isConversationActive: () => Boolean(conversationActiveRef?.current), requestRestart: requestRecognitionRestart }) // (a) dueno unico: voiceStallPolicy
  }, [conversationActiveRef, requestRecognitionRestart])

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
    /** Cuenta de muestras capturadas: la revision de AUDIO del turno (su unico dueño). */
    getTotalSamples: () => chunkTotalSamplesRef.current,
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
        // SIN MEDIDA no se hereda un NOMBRE PROPIO (la TV no es "Luis"): ruta unica
        // `blindSpeakerFallback`, que degrada el nombre a etiqueta anonima (2026-10-18).
        getFallbackSpeaker: () => blindSpeakerFallback(lastLoggedSpeakerRef.current || lastSpeakerRef.current),
        getUtteranceText: () => cleanForSpeech(utterance) || lastDiarizeUtteranceRef.current,
        atTurnBoundary,
        allowNewCluster,
        getPreferSpeaker: () => lastLoggedSpeakerRef.current || '',
        getSessionPrimary: () => sessionPrimarySpeakerRef.current || '',
        // El RESPALDO no reserva numero (es "sin medida", no una voz): la 1a voz nace "Hablante 1".
        getReservedLabels: () => reservedSpeakerLabels(userSpeakersView.current),
        // Audio CAPTURADO del turno (`capturedTurnAudio`): snapshot, ventana viva o vacio; NUNCA otro turno.
        getCapturedAudio: () => capturedTurnAudio(turnId || activeTurnIdRef.current, activeTurnIdRef.current),
      }),
    [getContinuousBufferAdapter, userSpeakersView],
  )

  /** El embedding tarda MAS que el commit: conserva la evidencia de sesion (refs, clusters y bitacora). NO reescribe filas: la etiqueta la decide el modulo al cerrar. */
  const applyResolvedSpeaker = useCallback(({ speakerName, turnId, evidence, vector }) => {
    const id = Number(turnId)
    if (!speakerName) return
    // La fila ya la escribio el modulo CONVERSACION con su etiqueta resuelta. Una
    // medida tardia no la re-etiqueta (mandato 2026-10-26: un solo dueno de la fila).
    if (Number.isFinite(id)) { if (id < lastResolvedTurnRef.current) return; lastResolvedTurnRef.current = id }
    lastSpeakerRef.current = speakerName; lastLoggedSpeakerRef.current = speakerName
    lastResolvedSpeakerRef.current = speakerName // UNICO escritor: solo la resolucion MEDIDA pisa el sticky de la siguiente fila
    recordSessionTurn({ kind: 'resolved', text: '', speaker: speakerName, resolvedVector: vector || null, evidence: evidence === true, clusters: speakerClustersRef.current, turnId })
    // El nombre SOLO se afirma con evidencia positiva; aqui no se registra nada por
    // el nombre resuelto (ni por etiqueta ni por primario).
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
      // GETTER, no id fijo: el id se acuna DESPUES de este aviso; fijarlo dejaba los snapshots en un slot que el commit no miraba (Preflight turn=5 vs Commit=9).
      startContinuousIdentityPipeline(
        () => activeTurnIdRef.current,
        // El tick entrega su turno: el resolutor queda ATADO a el y mide SU audio.
        (turnId) => createSpeakerAudioResolver({ atTurnBoundary: true, allowNewCluster: true, utterance: phrase, turnId }),
        // §9 Dueño unico de la escritura de clusters: el ref del hook. El tick corre como
        // `continuous` dentro del pipeline (no completa la fila: solo calienta la cache).
        { onClusters: setSpeakerClusters, onResolved: applyResolvedSpeaker, getAudioBuffer: () => getContinuousBufferAdapter() },
      )
    },
    [conversationActiveRef, createSpeakerAudioResolver, getContinuousBufferAdapter, setSpeakerClusters, applyResolvedSpeaker],
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
      // R1: la ventana es la del TURNO. Antes, si la ventana del turno era corta, se
      // caia a `flattenChunksTail` (la cola del buffer) que metia audio PRE-turno (la
      // voz de FLU) -> coseno mezclado. Ahora la ventana del turno se usa tal cual (si
      // es corta, el piso de voz del resolutor la descarta: no se mide ni se abre fila).
      const turnAligned = captureCfg.conversationTurnAlignedDiarize !== false
      const tail = turnAligned
        ? flattenChunksWindow(chunksRef.current, { totalSamples: chunkTotalSamplesRef.current, sinceSample: turnAudioStartSampleRef.current, maxSamples, minSamples: minVoiced })
        : flattenChunksTail(chunksRef.current, maxSamples)
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
      // Firma SOLO del tramo con VOZ (dueno unico `selectVoicedWindow`): la ventana completa
      // embebia audio ajeno y envenenaba el ancla de "soy X" (d4c1c8f3: Luis 0.495 vs SU ancla).
      const ventanaVoz = audioSnapshot?.length ? selectVoicedWindow(audioSnapshot, { sampleRate }) : audioSnapshot
      const signatureVector = ventanaVoz.length ? (await computeTurnSignature(ventanaVoz, sampleRate)).vector : [0, 0, 0, 0]

      if (conversationActiveRef?.current) {
        const resolvedSpeakerName = resolveConversationSpeakerSync(
          transcriptForIntro,
          audioSnapshot,
          sampleRate,
          fallbackSpeaker,
        )
        // BANDERA DE DIAGNÓSTICO: decisión de hablante del turno.
        voiceProbe('identity', { path: 'sync', vec: signatureVector.length, snap: audioSnapshot.length, sr: sampleRate, clusters: speakerClustersRef.current?.length ?? 0, ...payloadSeparacionDeTurno(signatureVector, speakerClustersRef.current, audioSnapshot, sampleRate), resolved: resolvedSpeakerName, fallback: fallbackSpeaker, last: lastSpeakerRef.current || '' })
        return {
          signatureVector,
          speakerName: audioSnapshot.length ? resolvedSpeakerName : '',
          evidenciaAcustica: preflightEvidenceMeasured(peekTurnSpeakerPreflight(activeTurnIdRef.current)),
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

      // MODO PASIVO: UNA decisión de hablante delegada al dueño canónico; el vector
      // ya sale de `computeTurnSignature` (único punto de firma por turno, sin re-embeder).
      const identity = resolveSpeakerIdentityFromVector(signatureVector, {
        speakerClusters: speakerClustersRef.current,
        lastSpeaker: lastSpeakerRef.current,
        lastSignature: lastTurnSignatureRef.current,
        fallbackSpeaker,
        utteranceText: cleanForSpeech(transcriptForIntro),
        sampleRate,
        voicedSampleCount: countVoicedSamples(ventanaVoz, { sampleRate }),
        // `false`: en modo pasivo NO hay turno de conversación abierto. La via NO-boundary
        // es la dueña de la continuidad (lastSpeaker/lastSignature + sticky), que sustituye
        // al `distanceToLast` local borrado, y con `true` `production-*` marcaría
        // `evidenciaAcustica=true` (solo `production-*` y `registered-pinned-rematch`
        // cuentan en `isMeasuredIdentityMatch`), cambiando el comportamiento de la fila.
        atTurnBoundary: false,
        // El modo pasivo es el que necesita abrir "Hablante N" sin turno abierto; el
        // resolutor sigue acotando la apertura (ventana corta / minimo voiced).
        allowNewCluster: true,
        preferSpeaker: lastLoggedSpeakerRef.current || '',
        reservedLabels: reservedSpeakerLabels(userSpeakersView.current),
        sessionPrimary: sessionPrimarySpeakerRef.current || '',
        // HIGH-WATER de la sesion (dato del store): el resolutor devuelve max+1 y no
        // reutiliza un numero aunque su dueno se haya renombrado o borrado.
        speakerHighWater: useIntegrationStore.getState().speakerHighWater,
      })
      // El resolutor decide SOBRE COPIAS (`workingClusters`): el ref solo se escribe aqui.
      setSpeakerClusters(identity.workingClusters)

      const speakerName = identity.speakerName
      const introducedName = resolveSpeakerNameFromUtterance(transcriptForIntro)
      const resolvedSpeakerName = introducedName || speakerName
      const speakerAlias = introducedName && introducedName !== speakerName ? speakerName : null

      // La base de participantes se re-ancla por la MISMA via en todas las rutas de "soy X" (2026-10-18).
      registerSpeakerIdentity({ name: introducedName, clusters: speakerClustersRef.current, signatureVector, refs: { sessionPrimarySpeakerRef, registerParticipant: participantRegisterPort(identitySession) } })
      lastSpeakerRef.current = resolvedSpeakerName
      lastTurnSignatureRef.current = signatureVector
      return {
        signatureVector,
        speakerName,
        introducedName,
        resolvedSpeakerName,
        speakerAlias,
        evidenciaAcustica: identity.evidence === true,
      }
    },
    [conversationActiveRef, resolveConversationSpeakerSync, computeTurnSignature, identitySession, setSpeakerClusters, userSpeakersView],
  )

  const emitConversationLog = useCallback(
    (
      turnCapture,
      {
        fallbackSpeaker,
        speakerName: explicitSpeaker,
        currentClock,
        replaceLastRawLog = false,
      } = {},
    ) => {
      const capture = normalizeTurnCapture(turnCapture, {
        conversationActive: Boolean(conversationActiveRef?.current),
      })
      if (!capture) return false
      // CONVERSACIÓN: la frase y la fila son del módulo (`row.committed`).
      // Este emisor es SOLO del modo PASIVO: en conversación no publica filas
      // ni manda payloads al escritor de App (ruta única de escritura).
      if (conversationActiveRef?.current) return false
      if (
        !replaceLastRawLog &&
        isDuplicateLogPhrase(capture, lastEmittedTranscriptRef.current, { msSinceLastEmit: lastLogEmitAtRef.current ? Date.now() - lastLogEmitAtRef.current : 0 })
      ) {
        return false
      }

      // El nombre de la fila pasiva sale del TEXTO (única vía sin `speakerName`).
      const speakerName = normalizeSpeakerLabel(
        cleanForSpeech(explicitSpeaker) || resolveConversationSpeakerLabel(capture, fallbackSpeaker),
      )

      lastLoggedCaptureRef.current = capture
      lastLoggedSpeakerRef.current = speakerName
      lastSpeakerRef.current = speakerName
      // §9: el MISMO valor commiteado es el de la fila (display === fila).
      const canonicalPhrase = commitTurnPhrase(capture)
      // Basura descartada (anti-alucinación): no se emite fila de log.
      if (!canonicalPhrase) return false
      lastEmittedTranscriptRef.current = canonicalPhrase

      lastLogEmitAtRef.current = Date.now()

      const payload = {
        contract: null,
        rawOnly: true,
        replaceLastRawLog,
        transcript: canonicalPhrase,
        speakerName,
        speakerAlias: null,
        phase,
        turnId: activeTurnIdRef.current,
        timestamp: currentClock,
        signature: lastTurnSignatureRef.current,
        turnWindow: tramoDelTurno({ chunks: chunksRef.current, totalSamples: chunkTotalSamplesRef.current, sinceSample: turnAudioStartSampleRef.current, sampleRate: sampleRateRef.current }),
        language: detectTranscriptLanguage(capture),
      }
      const debugMeta = { text: capture, speaker: speakerName, replaceLast: replaceLastRawLog }

      void Promise.resolve(onContractResolved?.(payload)).catch((error) => logCaughtError('useFluVoiceAssistant.onContractResolved', error))
      if (import.meta.env.DEV && debugHotPath) {
        fluDebugHot('log-emit', debugMeta)
      }
      return true
    },
    [conversationActiveRef, onContractResolved, phase, commitTurnPhrase],
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
      const tramoFila = tramoDelTurno({ chunks: chunksRef.current, totalSamples: chunkTotalSamplesRef.current, sinceSample: turnAudioStartSampleRef.current, sampleRate: sampleRateRef.current })
      recordSessionTurn({ kind: 'commit', text: capture, speaker, signature: lastTurnSignatureRef.current, clusters: speakerClustersRef.current, lastSpeaker: lastSpeakerRef.current, primary: sessionPrimarySpeakerRef.current, audioStartSample: tramoFila.audioStartSample, audioEndSample: tramoFila.audioEndSample, tramoValido: tramoFila.tramoValido, sessionTurnId: activeTurnIdRef.current })

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

  const flushListenStateBeforeRebuild = useCallback(() => {
    if (!conversationActiveRef?.current) return
    // El reconocedor se reinicia: el preflight del turno se rearma para medir la
    // SIGUIENTE locución. La línea viva y su cierre son del módulo (VAD), que
    // sobrevive al rebuild con su locución abierta (edb4a2b6).
    preflightScheduledForTurnRef.current = false
  }, [conversationActiveRef])

  // UN dueno de desconectar el grafo de audio del micro; antes eran DOS copias.
  const disconnectAudioGraph = useCallback(async () => {
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

  const cleanupAudio = useCallback(async () => {
    clearPassiveAudioDelayTimer()
    clearAllCommitTimers()
    clearRecognitionRetryTimer()
    clearLiveTranscriptTimers()
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

    await disconnectAudioGraph()
  }, [clearAllCommitTimers, clearLiveTranscriptTimers, clearPassiveAudioDelayTimer, clearRecognitionRetryTimer, clearCaptureState, disconnectAudioGraph])

  const releasePassiveAudioCapture = useCallback(async () => {
    await disconnectAudioGraph()
  }, [disconnectAudioGraph])

  const needsConversationPassiveAudio = useCallback(() => {
    const captureCfg = FLU_CONFIG.voiceIdentity?.capture || {}
    if (!conversationActiveRef?.current) return true
    return (
      captureCfg.conversationUsePassiveAudio === true &&
      captureCfg.conversationAutoDiarize === true
    )
  }, [conversationActiveRef])

  const setupPassiveAudioCapture = useCallback(async () => {
    // Single-flight: dos arranques concurrentes pasaban el guard de refs (se
    // fijan tras los await) y creaban DOS pipelines: PCM duplicado (alucinaba).
    if (passiveSetupPromiseRef.current) return passiveSetupPromiseRef.current
    const job = (async () => {
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

    const processEvery = Math.max(1, Number(conversationAudio?.processEvery) ||
      Number(captureCfg.conversationAudioProcessEvery) || 1)

    const micBridge = await wireMicCapturePipeline({
      audioContext,
      source: inputGain, // STT amplificado (sala)
      recordSource: source, // grabación CRUDA pre-ganancia: silencios reales, sonido natural
      sampleRate: sampleRateRef.current || AUDIO_SAMPLE_RATE,
      processEvery,
      onRawPcmBlock: (input, meta) => motorConversacionRef.current?.audio(input, sampleRateRef.current || AUDIO_SAMPLE_RATE, meta?.sampleIndex),
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
        // PCM del micrófono cuando es la instancia activa (predicado unico).
        if (fallback.isLocal(recognitionRef.current)) {
          recognitionRef.current.pushAudio(input, sampleRateRef.current || AUDIO_SAMPLE_RATE)
        }
      },
    })

    processorRef.current = micBridge
    zeroGainRef.current = micBridge.zeroGain
    })()
    passiveSetupPromiseRef.current = job.finally(() => { passiveSetupPromiseRef.current = null })
    return passiveSetupPromiseRef.current
  }, [conversationActiveRef, fallback, needsConversationPassiveAudio])

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
        if (conversationActiveRef?.current) abrirMotorConversacion()
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
        // UNICO predicado de motor local (dueno: voiceLocalFallback).
        const localEngineActive = fallback.isLocal(recognitionRef.current)
        if (isVoiceProbeEnabled()) voiceProbe('asrRaw', { engine: localEngineActive ? 'whisper' : 'chrome', metrics: event?.metrics ?? null, turn: activeTurnIdRef.current, items: Array.from(event.results || []).map((r) => { const t = String(r?.[0]?.transcript || ''); return { f: r?.isFinal ? 1 : 0, t, l: t.length } }) })
        // Supresión de eco: mientras FLU HABLA, ignorar resultados del
        // reconocedor para no capturar la propia voz y re-mandarla a la IA.
        // Se usa la promesa propia de FLU (`isFluSpeaking`, acotada por el
        // watchdog), NUNCA el flag global del motor TTS: ese
        // quedaba pegado y silenciaba la escucha hasta recargar la página.
        if (isFluSpeaking() && isAssistantSpeechEcho(event, resolveEchoContext(useIntegrationStore.getState().conversationHistory, getLastCompletedSpeechAt()).lastAssistantText)) return
        logChromeSpeechResult(event)
        lastOnresultAtRef.current = Date.now()
        lastSrResultAtRef.current = Date.now()
        // Texto real del reconocedor: es el reloj de "silencio significativo" del
        // watchdog/fallback (antes lo tocaba el runtime de ingress, retirado).
        lastMeaningfulIngressAtRef.current = Date.now()
        recognitionRetryCountRef.current = 0
        consecutiveEndsWithoutResultRef.current = 0
        // Chrome produjo un RESULTADO (o hubo texto real): el contador de rebuilds
        // sin resultado vuelve a cero y, si habia ventana de prueba, queda activo.
        fallback.noteResult()
        let interim = ''
        let finalText = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const transcript = cleanForSpeech(result?.[0]?.transcript || '')
          if (!transcript) continue

          // GATE DEL MOTOR LOCAL: Whisper alucina con audio sin habla. Evidencia
          // ACUSTICA (`metrics`), no la forma del texto: garbageTranscript (B3)
          // intacto; la wake y los comandos conservan su excepcion.
          if (localEngineActive && event?.metrics) {
            const discarded = fallback.gateResult({
              isFinal: result.isFinal,
              transcript,
              metrics: event.metrics,
              wakeWords: resolvedWakeWords,
            })
            if (discarded) continue
          }
          // Un FINAL que se emite alimenta el UNICO reloj de recuperacion.
          if (result.isFinal) fallback.noteFinalAccepted()

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
          if (!motorConversacionRef.current) return
          // El modo bilingüe cambia el locale del ASR: es conducta de la ESCUCHA
          // (del hook), no de la conversación. Se decide con el texto del evento.
          if (interim || finalText) maybeSwitchRecognitionLocaleRef.current(interim || finalText)
          if (finalText) { const w = analyzeWakeTurn(finalText, { lastCommitted: userRowsTextView.current.at(-1) || '' }); voiceProbe('asrFinal', { engine: localEngineActive ? 'whisper' : 'chrome', ms: event?.metrics?.durationMs ?? null, speechLikeMs: event?.metrics?.speechLikeMs ?? null, rms: event?.metrics?.rms ?? null, turn: activeTurnIdRef.current, wake: w.wakeWordMatched, inline: w.hasInlineBoundary, before: w.passiveOnly.slice(0, 80), after: w.afterWake.slice(0, 80), len: w.cleaned.length, text: w.cleaned }) }
          // MOTOR del producto: ÚNICA ruta de la frase y de la fila. Se ingiere el
          // evento CRUDO (interino o final); el módulo resuelve el tramo dentro de
          // su cola y publica caja/fila. Aquí no se normaliza ni se despacha.
          motorConversacionRef.current.evento(event)
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

        // Fragmentos (Bug #3/#4): un comando incompleto espera al siguiente final
        // (margen incompleteCommandWaitMs); no se ejecuta a medias.
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

        // Fallback OFFLINE (§1/§9): 'network'/'no-speech' degradan al motor
        // local Whisper WASM (config `fallbackErrors`) por el punto unico.
        if (
          isLocalFallbackEnabled() &&
          shouldUseLocalFallback(errorCode) &&
          !fallback.isLocal(recognitionRef.current)
        ) {
          if (!fallback.degradeRef.current?.()) {
            requestRecognitionRestart(getRecognitionRetryDelay(errorCode))
          }
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
        // La sesión vive mientras la conversación vive: Chrome reinicia el reconocedor cada pocos segundos y cerrar aquí partía la conversación en una sesión por reinicio (medido 2026-10-25).
        if (motorConversacionRef.current && !conversationActiveRef?.current) cerrarMotorConversacion('system')

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
      abrirMotorConversacion, cerrarMotorConversacion,
      cleanupAudio,
      clearAutoProcessTimer,
      conversationActiveRef,
      fallback,
      publishLiveFromTurn,
      publishLiveImmediate,
      requestRecognitionRestart,
      scheduleAutoProcess,
      readActiveSnapshot,
      setError,
      resolvedWakeWords,
      userRowsTextView,
    ],
  )

  wireRecognitionEventsRef.current = wireRecognitionEvents

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

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    window.__fluDev = {
      ...(window.__fluDev || {}),
      getListenLog: getListenLogRing,
      clearListenLog: clearListenLogRing,
      enableListenTrace: () => {
        window.__FLU_LISTEN_DEBUG = true
      },
      debug: getFluDebugApi(),
    }
    return () => {
      if (window.__fluDev) {
        delete window.__fluDev.getListenLog
        delete window.__fluDev.clearListenLog
        delete window.__fluDev.enableListenTrace
        delete window.__fluDev.debug
      }
    }
  }, [])

  const startListening = useCallback(async ({ resume = false } = {}) => {
    setError('')
    // Cada sesion arranca con Chrome SR; el piso de elegibilidad se ancla una vez.
    fallback.resetSession()
    if (!resume || !fallback.degradeEligibleSinceRef.current) {
      fallback.degradeEligibleSinceRef.current = Date.now()
    }
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
        cajaVivaRef.current.vaciarLaCaja()
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
      // Precalienta el motor local SOLO si la politica lo habilita: en
      // produccion Chrome-only no se carga Whisper (backup `rescate/wip-pre-s9`).
      if (isLocalFallbackEnabled()) prewarmLocalRecognition()

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
    fallback,
    isSupported,
    language,
    wireRecognitionEvents,
    schedulePassiveAudioCapture,
    requestRecognitionRestart,
    status,
    clearRecognitionRetryTimer,
  ])

  // UN emisor de la respuesta hablada de un comando (dueno 2026-10-12: UNA orden dijo DOS "Registrado ...").
  const buildCommandSpeech = useCallback((command, transcript, lang) => getCommandSpeech(command, lang || language, FLU_CONFIG, { name: detectWakeIntroducedName(transcript, resolvedWakeWords) }), [language, resolvedWakeWords])

  const emitActiveConversationCommand = useCallback(
    async (command, transcript) => {
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
        turnAudioStartSampleRef.current = chunkTotalSamplesRef.current = 0
        lastStreamPreviewRef.current = ''
        lastLogLineTextRef.current = ''
        lastLogLineWasCommandRef.current = false
        lastLogLineAtRef.current = 0
        lastLoggedCaptureRef.current = ''
        setSpeakerClusters([])
        resetVoiceDirectory() // el nombre por VOZ es de la sesion (como los clusters)
        lastSpeakerRef.current = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
        lastLoggedSpeakerRef.current = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
        applySessionCommandToPrimary({ transcript: cleaned, sessionPrimarySpeakerRef })
        // Fase E: tras reiniciar la sesion, re-sembrar el participante activo como sessionPrimary.
        seedSessionPrimaryFromActiveName()
        activeTurnIdRef.current = 0
        preflightScheduledForTurnRef.current = false
        stopAllContinuousIdentityPipelines()
        lastTurnSignatureRef.current = null
        resetTurnState(turnRef.current)
        pendingSpillRef.current = ''
        cajaVivaRef.current.vaciarLaCaja()
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
          respuesta_voz: buildCommandSpeech(command, cleaned, language),
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
      })
    },
    [commitAndResolveTurn, commitSessionTurn, language, persistDialogueSession, phase, releaseTurnAfterLog, clearAutoProcessTimer, seedSessionPrimaryFromActiveName, setSpeakerClusters, buildCommandSpeech],
  )

  const dispatchPassiveVoiceCommand = useCallback(
    async (uiCommand, transcript) => {
      if (!uiCommand || !conversationActiveRef?.current) return

      clearAutoProcessTimer()

      // La frase del comando ES la frase canónica del módulo (Anexo B 6): aquí no
      // se elige entre copias del stream. `commandLogPreserveWake` decide solo la
      // presentación del mandato (con o sin wake), nunca su contenido.
      const preserveWake = FLU_CONFIG.voiceCommands.commandLogPreserveWake !== false
      const phrase = preserveWake
        ? cleanForSpeech(transcript)
        : cleanForSpeech(splitTranscriptAtWakeWord(transcript, resolvedWakeWords).commandText || transcript)

      if (import.meta.env.DEV && debugHotPath) {
        fluDebugHot('conversation-command', { command: uiCommand, phrase })
      }

      await emitActiveConversationCommand(uiCommand, phrase)
    },
    [
      clearAutoProcessTimer,
      conversationActiveRef,
      emitActiveConversationCommand,
      resolvedWakeWords,
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

  // FAST-PATH DETERMINISTA: resuelve y despacha configuración por la MISMA ruta
  // (onContractResolved → applyConfigAction) sin red; la IA solo confirma. El
  // contrato tardío llega con configuración anulada (idempotencia) y se exige acción.
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

  // Fast-path de AMBIENTE y MÚSICA: despacha el contrato ya resuelto por la ÚNICA
  // ruta (onContractResolved); catálogo y marcos son la fuente. NO escribe la
  // conversación (`effectOnly`).
  const dispatchFastEnvironmentCommand = useCallback(
    async (
      intent,
      { speakerName = null, speakerAlias = null, phase = 'SESION_ACTIVA', session = null, language = null, transcript = '', timestamp = '' } = {},
    ) => {
      const isMusicAction = Boolean(intent?.accion) && !intent?.tipo
      if (!intent?.tipo && !isMusicAction) return null
      await onContractResolved?.({
        contract: {
          respuesta_voz: isMusicAction ? musicActionSpeech(intent.accion, normalizeLang(language)) : '',
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

  // §3.1 — Árbitro determinista UNIFICADO: resuelve config/juego/ambiente y los
  // despacha por la ÚNICA ruta (onContractResolved); devuelve los resueltos y un
  // `dispatch` que nunca rechaza para que cada llamador decida cuándo esperarlo.
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
    async (fullTranscript, { question = '' } = {}) => {
      relayLog('LOG', 'useFluVoiceAssistant', `processConversationFluQuery ENTER: conversationActiveRef.current=${conversationActiveRef?.current}, question="${(question || '').slice(0, 60)}"`)
      if (!conversationActiveRef?.current || !question) {
        relayLog('WARN', 'useFluVoiceAssistant', `processConversationFluQuery EXIT EARLY: conversationActiveRef.current=${conversationActiveRef?.current}, question="${(question || '').slice(0, 60)}"`)
        return
      }

      // El turno queda resuelto; la LOCUCION EN VUELO no se vacia (su cierre real la commitea).
      openPreviewTurnRef.current = false
      captureTurnAudio() // §9 sella el audio ANTES del commit-only (que vacía el buffer)
      // §9: una sola frase canónica para el turno (display y fila salen de ESTE valor).
      const canonicalPhrase = await commitAndResolveTurn({
        capture: fullTranscript || question,
        fallbackCapture: question, // texto validado del turno (si la captura cruda es basura)
        commitOnly: true,
      })
      if (!canonicalPhrase) return

      // B.6: la IA recibe la MISMA frase commiteada, sin la wake (splitter unico, Anexo B.11).
      const transcriptForAi = cleanForSpeech(splitTranscriptAtWakeWord(canonicalPhrase, FLU_CONFIG.voiceCommands?.wakeWords || []).commandText || '') || question
      // §9: la query ya viene derivada por el derivador único
      const sampleRate = sampleRateRef.current || AUDIO_SAMPLE_RATE
      const streamSamples = turnAudioForDiarize(activeTurnIdRef.current, { chunks: chunksRef.current, activeTurnId: activeTurnIdRef.current })
      const audioSnapshot = streamSamples.length ? new Float32Array(streamSamples) : new Float32Array(0)
      const fallbackSpeaker = lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
      const currentClock = formatClock()
      const detectedLanguage = detectTranscriptLanguage(transcriptForAi)

      setStatus('processing')
      isProcessingRef.current = true
      // Turno vivo: overlay "Pensando" hasta terminar (IA + escrituras + acción +
      // voz) + cronómetro del turno.
      turnLifecycleRef.current?.startTurn('voz')
      setError('')
      // Declarados FUERA del try: el catch los referencia y `let/const` tienen
      // ámbito de bloque (declararlos dentro lanzaba ReferenceError al fallar la IA).
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

        // §2B — Con match determinista de estado NO se llama a Gemini si el flag
        // `arbiter.skipGeminiOnMatch` está activo; el contrato lo decide la función pura
        // y, en juego/ambiente, la cortesía es '' porque el motor ya habla su voz.
        const skipGemini = resolveDeterministicSkipGeminiContract({
          text: transcriptForAi,
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
          const probe = resolveDeterministicCommand(transcriptForAi, {
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
          resolveSpeaker(transcriptForAi, audioSnapshot, sampleRate, fallbackSpeaker),
          requestFluContractForTranscript({
            transcript: transcriptForAi,
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
              text: transcriptForAi,
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
        const lateStateful = resolveStatefulDomains(transcriptForAi, { language: detectedLanguage })

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
      // Eco del DESPACHO por CONTENIDO (mismo dueno que `onresult`): el gate por
      // tiempo descartaba el habla real dicha mientras FLU responde (musica-en-partida).
      if (isFluSpeaking()) {
        const { lastAssistantText } = resolveEchoContext(
          useIntegrationStore.getState().conversationHistory,
          getLastCompletedSpeechAt(),
        )
        if (isAssistantVoiceEcho(phrase, lastAssistantText)) return false
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
        // §9/F: cada comando exige la wake en SU enunciado (excepto control de escucha).
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

  // Despacho en SEGUNDO PLANO del motor de conversación: el módulo no espera la
  // Promise (`onFraseCanonica`), así que un rechazo quedaría como promesa suelta.
  // Se registra con contexto y se PROPAGA: quien sí espere recibe el rechazo.
  const tryDispatchConversationAction = useCallback(
    (text, options = {}) => {
      const pending = runConversationActionDispatch(text, { ...options, awaitHandlers: false })
      void Promise.resolve(pending).catch((error) =>
        logCaughtError('useFluVoiceAssistant.tryDispatchConversationAction', error, { text, options }),
      )
      return pending
    },
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
    // Con CONVERSACIÓN activa la ÚNICA ruta de la frase es el módulo: el buffer
    // pasivo no despacha ni escribe filas (Anexo B 1/2/6).
    if (conversationActiveRef?.current) return
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
            fallbackSpeaker: blindSpeakerFallback(lastSpeakerRef.current),
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
        capturedTranscript = await waitForCaptureSettle(readTurnCaptureSnapshot, FLU_CONFIG.timing, { settled: true })
      }

      // §9 — Visibilidad INMEDIATA: commit temprano de la frase capturada para
      // que la transcripción se vea en cuanto el usuario termina de hablar, SIN
      // esperar a la IA ni al comando. La resolución posterior re-commitea el
      // MISMO valor (idempotente), así no hay doble fuente.
      if (capturedTranscript) {
        await commitAndResolveTurn({ capture: capturedTranscript, commitOnly: true })
      }

      const sampleRate = sampleRateRef.current || AUDIO_SAMPLE_RATE
      const streamSamples = turnAudioForDiarize(activeTurnIdRef.current, { chunks: chunksRef.current, activeTurnId: activeTurnIdRef.current })
      const currentClock = formatClock()
      const fallbackSpeaker = lastSpeakerRef.current || FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker
      const audioSnapshot = streamSamples.length ? new Float32Array(streamSamples) : new Float32Array(0)

      const finishTurn = () => {
        releaseTurnAfterLog(lastLoggedCaptureRef.current)
      }

      const detectedLanguage = detectTranscriptLanguage(capturedTranscript)

      const bufferedValidation = extractFluVoiceCommand(capturedTranscript, {
        requireWake,
        wakeWords,
      })
      relayLog('LOG', 'useFluVoiceAssistant', `processCapture wake validation: accepted=${bufferedValidation.accepted}, reason="${bufferedValidation.reason}", requireWake=${requireWake}, requireWake?current=${conversationActiveRef?.current}`)
      if (!bufferedValidation.accepted) {
        // Un rechazo de la puerta de la wake word NO es un turno: no abre fila.
        // Aula/casa (TV, ninos): el texto sigue en la transcripcion viva, pero no
        // ensucia el historial ni parece una frase dirigida a FLU.
        finishTurn()
        await cleanupAudio()
        setStatus('idle')
        isListeningRef.current = false
        return
      }

      // LATENCIA: texto puro (sin I/O) se calcula ANTES de la diarización, que arranca
      // EN PARALELO con la API y se reconcilia antes de onContractResolved (bandera P8.68).
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

      const fastSpeakerName =
        resolveSpeakerNameFromUtterance(bufferedTranscript || capturedTranscript) ||
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
            respuesta_voz: buildCommandSpeech(directCommand, capturedTranscript, detectedLanguage || language),
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
        await cleanupAudio()
        setStatus('idle')
        isListeningRef.current = false
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
    buildCommandSpeech,
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
    session,
    commitSessionTurn,
    computeTurnSignature,
    resolvedWakeWords,
  ])

  const stopListening = useCallback(async ({ closing = false } = {}) => {
    // La sesión del módulo se CIERRA siempre que esté abierta: `cerrar` finaliza
    // la locución abierta con su texto fusionado y publica su fila (Anexo B 1/2).
    // OJO: `conversationMode.exit()` apaga la bandera ANTES de llamar aquí, así
    // que la bandera no dice si hay una sesión de conversación viva.
    if (motorConversacionRef.current) {
      if (closing && recognitionRef.current) await finalizeRecognition()
      cerrarMotorConversacion(closing ? 'user' : 'system')
      if (closing) {
        isListeningRef.current = false
        await cleanupAudio()
        setStatus('idle')
      }
      return
    }

    if (!isListeningRef.current && !readActiveSnapshot()) {
      return
    }

    await processCapture({ closing })
  }, [
    cerrarMotorConversacion,
    cleanupAudio,
    finalizeRecognition,
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
    dispatchPassiveVoiceCommandRef.current = dispatchPassiveVoiceCommand
    processConversationFluQueryRef.current = processConversationFluQuery
    tryDispatchConversationActionRef.current = tryDispatchConversationAction
  }, [
    dispatchPassiveVoiceCommand,
    processConversationFluQuery,
    startListening,
    stopListening,
    tryDispatchConversationAction,
  ])

  // El módulo pide el preflight de identidad ANTES de ingerir el texto (para que
  // la evidencia medida llegue a la fila). Se cablea por ref: el motor se crea
  // una vez y debe leer siempre la versión vigente (sin ataduras circulares).
  scheduleIdentityPreflightRef.current = scheduleIdentityPreflight

  useEffect(() => {
    if (status !== 'listening' || typeof window === 'undefined') return undefined

    const listeningCfg = FLU_CONFIG.listening || {}
    const watchdogMs = listeningCfg.watchdogMs
    const timerId = window.setInterval(() => {
      if (!isListeningRef.current || isStoppingRef.current) return

      if (conversationActiveRef?.current) {
        const restartCfg = getConversationRestartConfig(true)
        const idleMs = Date.now() - (lastOnresultAtRef.current || 0)
        releaseStalledTurn({ openPreviewTurnRef, sinceResult: idleMs, stallMs: restartCfg.stallMs }) // (b) dueno unico, ANTES de los rebuilds
        // Fallback local (recuperacion -> rebuild -> degradacion): decide y ejecuta
        // el dueno unico `useLocalAsrFallback`; aqui solo se respeta el orden.
        fallback.watchdogTick()
        return
      }

      if (recognitionActiveRef.current || !recognitionRef.current) return
      requestRecognitionRestartRef.current?.(listeningCfg.restartAfterEndMs)
    }, conversationActiveRef?.current
      ? getActiveListenConfig().restart.stallCheckMs
      : watchdogMs)

    return () => window.clearInterval(timerId)
  }, [conversationActiveRef, fallback, status])

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
    /**
     * Resolución de hablante del turno (paso el pipeline). Expuesta como entrada
     * pública del motor de identidad para que la rama PASIVA se pueda ejercitar
     * de verdad en pruebas (sin simular el resolver).
     */
    resolveSpeaker,
    /** Set a recent memory text that gets injected into the system prompt on next contract request. */
    setRecentMemory,
  }
}
