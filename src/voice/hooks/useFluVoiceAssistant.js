import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tramoDelTurno } from '../core/tramo.js'
import {
  computeAudioSignature,
  cleanForSpeech,
  detectWakeIntroducedName,
  detectListeningControl,
  detectTranscriptLanguage,
  formatClock,
  getRecognitionRetryDelay,
  getRecognitionErrorMessage,
  isRecoverableRecognitionError,
  isMinuteKnowledgeRequest,
  splitTranscriptAtWakeWord,
} from '../lib/audioMath'
import { getFluTimingCfg } from '../lib/fluTranscriptMotor.js'
import { analyzeWakeTurn, requiresWakeWord } from '../lib/wakeTurnCommit.js'
import { loadSessionState, saveSessionState } from '../lib/fluStorage'
import { requestFluContract } from '../lib/gemini'
import { buildContractParams } from '../lib/contractParams'
import {
  isCommandAuthorized,
  resolveDeterministicCommand,
  resolveDeterministicSkipGeminiContract,
  resolveStatefulDomains,
  musicActionSpeech,
} from '../lib/deterministicArbiter'
import { noteGameTurn } from '../../core/games/gameSessionStore'
import { consumesGameTurn, isCatalogLevelGameAction } from '../lib/gameCommands'
import { relayLog } from '../../lib/clientLogRelay'
import { recordSessionTurn } from '../lib/sessionRecorder.js'
import { captureTurnAudioSnapshot, probePcmBlock, turnAudioForDiarize } from '../lib/turnAudioSnapshot.js'
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
} from '../lib/voiceCommands'
import {
  flattenChunksWindow,
  nextAvailableSpeakerLabel,
  normalizeSpeakerLabel,
  pruneGhostSpeakerClusters,
  trimAudioChunkBuffer,
} from '../lib/voiceIdentity'
import { setSessionPrimarySpeaker } from '../lib/sessionPrimarySpeaker'
import { applySessionCommandToPrimary } from '../lib/sessionLifecycle.js'
import { resetVoiceDirectory } from '../lib/speakerDirectory.js'
import { participantRegisterPort, registerSpeakerIdentity } from '../lib/speakerIdentityRegister'
import {
  getConversationSpeakerTailMs,
  resolveCaptureAudioConstraints,
  resolveCaptureGain,
} from '../lib/micCapture.js'
import { buildResolvedContract } from '../lib/resolvedContract.js'
import {
  acquireSpeechRecognition,
  getRecognitionLanguage,
  isBilingualListenMode,
  resolveRecognitionLocale,
  startSpeechRecognition,
  stopSpeechRecognition,
} from '../lib/speechRecognitionLocal'
import { logChromeSpeechResult, getListenLogRing, clearListenLogRing } from '../lib/listenLog'
import {
  debugHotPath,
  fluDebugHot,
  getFluDebugApi,
} from '../lib/fluDebug'
import { wireMicCapturePipeline } from '../lib/micCaptureBridge.js'
import { formatGeminiUserMessage, buildGeminiDiagnosticsFromError } from '../lib/geminiDiagnostics.js'
import { resolveWakeWords } from '../lib/wakeWords.js'
import {
  blindSpeakerFallback,
  resolveSpeakerNameFromUtterance,
} from '../lib/speakerPolicy.js'
import { WAKE_POLICY_ORDER, applyWakePolicyOrder, resolveWakePolicyOrder, wakePolicySpeech } from '../lib/wakePolicy.js'
import { normalizeLang } from '../../core/config/localeConfig.ts'
// Ruta única: useFluParticipant vive solo en src/hooks/useFluParticipant.ts.
// El motor de voz la importa aquí solo como fallback defensivo; en producción App.tsx inyecta su instancia vía participantRef (mismo módulo).
import { useFluParticipant } from '../../hooks/useFluParticipant'
import { isSpeechSynthesisSpeaking, isFluSpeaking, waitForSpeechIdle } from '../lib/fluSpeech.js'
import { resumeAfterSpeechSuspend, releaseStalledTurn } from '../lib/voiceStallPolicy.js'
import { isLocalFallbackEnabled, prewarmLocalRecognition, shouldUseLocalFallback } from '../lib/voiceLocalFallback'
import { useLocalAsrFallback } from './useLocalAsrFallback'
import { logCaughtError } from '../../lib/caughtError';
import { clearAnimationFrameRef, clearTimeoutRef } from '../../lib/timerRefs'
import { useTurnLifecycleSync, useOffPathSessionWriter } from './useTurnInfrastructure'
import { useSessionSpeakerClusters } from './useSessionSpeakerClusters'
import { AI_PROVIDER_IDS } from '../../core/config/sharedConfig'
import {
  FLU_DIALOGUE_SPEAKER,
  deriveDialogueHistory,
  deriveUserRowSpeakers,
  deriveUserRowTexts,
  getDialogueContextSlice,
  isFluSpeaker,
} from '../lib/conversationDialogue.js'
import { getFallbackSpeaker, isAutoSpeakerLabel, payloadSeparacionDeTurno } from '../lib/speakerCore.js';
import { selectVoicedWindow } from '../lib/voicedActivity.js';
import { COMMAND_IDS } from '../lib/commandIds.js'
import { voiceProbe, isVoiceProbeEnabled } from '../lib/voiceProbe'
import { defaultLanguage } from '../lib/languageDefault.ts'
import { crearMotorConversacionHook } from '../compose/conversationMotorProducto'
import { crearResolucionPasivaProducto } from '../conversation/index'
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
  // §9 FUENTE ÚNICA de la frase visible: `lastTranscript` vive en el store, sin espejo local.
  const lastTranscript = useIntegrationStore((state) => state.lastCommittedTranscript)
  const commitVisibleTranscript = useCallback((text) => {
    useIntegrationStore.getState().setLastCommittedTranscript(typeof text === 'string' ? text : '')
  }, [])
  // §9 ÚNICO punto de commit de la locución: la frase llega YA canónica del
  // MÓDULO (Anexo B 2/6); `trim` es identidad, así display === fila por construcción.
  const commitTurnPhrase = useCallback((text, fallback = '') => {
    return String(text || '').trim() || String(fallback || '').trim()
  }, [])
  // Wake words efectivas (Ajustes o default): UN solo criterio.
  const resolvedWakeWords = resolveWakeWords(wakeWords)
  const activeTurnIdRef = useRef(0)
  const sessionTurnRecordedRef = useRef('') // ultimo turnId de fila ya registrado (Paso 0: sin snapshots duplicados)
  const lastEmittedTurnRef = useRef(0) // turno de la ultima locucion emitida: resolucion tardia idempotente
  // §9 par ÚNICO `commit + resolución`: TODAS las ramas cierran aquí; la fila
  // es SIEMPRE el valor commiteado y el display no diverge.
  const commitAndResolveTurn = useCallback(
    async ({ capture, fallbackCapture = '', contract, commitOnly = false, ...payload } = {}) => {
      // ÚNICA frase canónica del turno (display === fila), la del MÓDULO (Anexo B 2/6).
      const canonicalPhrase = commitTurnPhrase(capture, fallbackCapture)
      const evidenciaAcustica = payload.evidenciaAcustica === true // solo la DECLARA quien midio VOZ
      // Garbage descartada (anti-alucinación): no se commitea ni se consulta a IA.
      if (!canonicalPhrase) return
      // `commitOnly`: fila del USUARIO inmediata; la resolución posterior re-commitea el MISMO valor.
      if (commitOnly) {
        await onContractResolved?.({ contract: null, userCommitOnly: true, transcript: canonicalPhrase, speakerName: payload.speakerName, evidenciaAcustica, phase: payload.phase, turnId: activeTurnIdRef.current })
        return canonicalPhrase
      }
      // El turno de la fila es el de la FRASE (no el vivo): la resolucion tardia escribe SU fila.
      const turnIdDeLaFrase = canonicalPhrase && canonicalPhrase === lastEmittedTranscriptRef.current && lastEmittedTurnRef.current ? lastEmittedTurnRef.current : activeTurnIdRef.current
      const result = await onContractResolved?.({ contract, ...payload, evidenciaAcustica, transcript: canonicalPhrase, turnId: turnIdDeLaFrase })
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
  const autoProcessTimerRef = useRef(null)
  const recognitionRetryTimerRef = useRef(null)
  const recognitionRetryCountRef = useRef(0)
  const lastLoggedCaptureRef = useRef('')
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
  const lastResolvedSpeakerRef = useRef('') // Ultima voz RESUELTA POR MEDIDA (unico escritor: resolveSpeaker); el sticky la prefiere a lastLogged (d4c1c8f3)
  const lastTurnSignatureRef = useRef(null)
  const isCommittingRef = useRef(false)
  const liveDebounceTimerRef = useRef(null)
  const liveRafRef = useRef(null)
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
  const passiveAudioDelayTimerRef = useRef(null)
  const passiveSetupPromiseRef = useRef(null)
  const listeningAckTimerRef = useRef(null)
  const sessionPrimarySpeakerRef = useRef('')
  if (identitySession) identitySession.current = { ...(identitySession.current || {}), speakerClustersRef, sessionPrimarySpeakerRef, setClusters: setSpeakerClusters, getLastTurnSignature: () => lastTurnSignatureRef.current }
  const turnSegmentStartedAtRef = useRef(0)

  /** Motor CONVERSACIÓN del producto: única ruta de escritura de filas. */
  const motorConversacionRef = useRef(null)
  // ESTADO DE LA MEDIDA PASIVA (decisión A): el resolver del módulo es SIN estado;
  // el hook conserva la cadena de evidencia entre turnos (voz anterior, vector y
  // contador de voces nuevas). UNA medida por turno: identidad + firma del turno.
  const resolverPasivoRef = useRef(null)
  if (!resolverPasivoRef.current) resolverPasivoRef.current = crearResolucionPasivaProducto()
  const ultimoVozIdRef = useRef('')
  const ultimoVectorRef = useRef(null)
  const contadorVocesRef = useRef(0)
  /** Etiqueta resuelta por el MÓDULO al cerrar la última locución (`row.committed`). */
  const lastModuleLabelRef = useRef('')
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
          // El turno de la FRASE se captura ANTES del commit (el despacho corre con la locución abierta).
          lastEmittedTranscriptRef.current = frase
          lastEmittedTurnRef.current = activeTurnIdRef.current
          tryDispatchConversationActionRef.current(frase, {
            interim,
            source: interim ? 'asr-interim' : 'asr-final',
          })
        },
        // Frontera de TURNO (locución nueva): la siguiente frase es otro turno.
        onLocucionCommiteada: (fila) => {
          // Paso 0: UNA instantánea por locución commiteada, con los campos
          // REALES de la fila; la revisión del mismo turnId no añade snapshot.
          const turnId = String(fila?.turnId ?? '').trim()
          if (turnId && turnId !== sessionTurnRecordedRef.current) {
            sessionTurnRecordedRef.current = turnId
            const tramoFila = tramoDelTurno({ chunks: chunksRef.current, totalSamples: chunkTotalSamplesRef.current, sinceSample: turnAudioStartSampleRef.current, sampleRate: sampleRateRef.current })
            recordSessionTurn({ kind: 'commit', text: fila?.texto || '', speaker: fila?.etiqueta || '', signature: lastTurnSignatureRef.current, clusters: speakerClustersRef.current, lastSpeaker: lastSpeakerRef.current, primary: sessionPrimarySpeakerRef.current, audioStartSample: tramoFila.audioStartSample, audioEndSample: tramoFila.audioEndSample, tramoValido: tramoFila.tramoValido, sessionTurnId: turnId, locutionId: fila?.locutionId || '' })
          }
          activeTurnIdRef.current += 1
          lastModuleLabelRef.current = String(fila?.etiqueta || '')
          turnSegmentStartedAtRef.current = Date.now()
          turnAudioStartSampleRef.current = chunkTotalSamplesRef.current
          fluParticipantRef.current?.onTurnCommitted?.(fila?.turnId)
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

  // Estado de captura: el turno vive en el MÓDULO; aquí solo se descarta el PCM.
  const clearCaptureState = useCallback(() => {
    chunksRef.current = []
    chunkTotalSamplesRef.current = 0
  }, [])

  const resetVoiceDisplay = useCallback(() => {
    clearCaptureState()
    lastLoggedCaptureRef.current = ''
    lastEmittedTranscriptRef.current = ''
    openPreviewTurnRef.current = false
    turnAudioStartSampleRef.current = 0
    lastStreamPreviewRef.current = ''
    lastLogLineTextRef.current = ''
    lastLogLineWasCommandRef.current = false
    lastLogLineAtRef.current = 0
    lastTurnSignatureRef.current = null
    commitVisibleTranscript('')
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
    // Etiqueta nueva de la VISTA: el tope lo da el plan de escucha; la identidad de
    // la fila la resuelve el MÓDULO por su propia medida (decisión A, Paso 5).
    const cap = getActiveListenConfig().speakers?.maxSpeakers ?? 0
    const next = nextAvailableSpeakerLabel([], [lastSpeakerRef.current, ...userSpeakersView.current].filter(Boolean), { maxSpeakers: cap })
    lastSpeakerRef.current = next
    lastLoggedSpeakerRef.current = next
    return next
  }, [userSpeakersView])

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

  const requestRecognitionRestart = useCallback(
    (motivo, delay = getFluTimingCfg().recognitionRestartDefaultDelayMs) => {
      // Caso 13: un reinicio de la escucha SOLO se agenda con motivo declarado.
      const motivoDeclarado = String(motivo || '').trim()
      if (!motivoDeclarado) {
        logCaughtError('escucha.reinicio.sinMotivo', new Error('reinicio de la escucha sin motivo declarado'))
        return
      }
      if (typeof window === 'undefined') return
      if (!isListeningRef.current || !recognitionRef.current || isStoppingRef.current) return

      clearRecognitionRetryTimer()
      recognitionRestartPendingRef.current = true
      recognitionRetryTimerRef.current = window.setTimeout(() => {
        fluDebugHot('recognition-restart', { motivo: motivoDeclarado, delay })
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
          requestRecognitionRestart('reintento', backoff)
        } else if (conversationActiveRef?.current) {
          recognitionRetryCountRef.current = 0
          requestRecognitionRestart('bucle-lento', restartCfg.maxBackoffMs)
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

    // Reanudar la escucha si estaba activa antes del habla. SOLO en modo pasivo: en conversación
    // activa lo hace App (onContractResolved → scheduleResumeListening); reabrir aqui forzaba LISTENING.
    resumeAfterSpeechSuspend({ wasListeningBefore, isConversationActive: () => Boolean(conversationActiveRef?.current), requestRestart: requestRecognitionRestart }) // (a) dueno unico: voiceStallPolicy
  }, [conversationActiveRef, requestRecognitionRestart])

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
      const minVoiced = Math.floor(rate * (Number(minSamplesMs) / 1000))
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

  const resolveSpeaker = useCallback(
    async (transcriptForIntro = '', audioSnapshot, sampleRate, fallbackSpeaker) => {
      // Firma SOLO del tramo con VOZ (dueno unico `selectVoicedWindow`): la ventana completa
      // embebia audio ajeno y envenenaba el ancla de "soy X" (d4c1c8f3: Luis 0.495 vs SU ancla).
      const ventanaVoz = audioSnapshot?.length ? selectVoicedWindow(audioSnapshot, { sampleRate }) : audioSnapshot
      const signatureVector = ventanaVoz.length ? (await computeTurnSignature(ventanaVoz, sampleRate)).vector : [0, 0, 0, 0]

      if (conversationActiveRef?.current) {
        // CONVERSACIÓN: la etiqueta de la fila la resolvió el MÓDULO por su propia
        // medida (decisión A). El hook solo aporta la firma para el puente de App.
        const resolvedSpeakerName = lastModuleLabelRef.current || fallbackSpeaker
        // BANDERA DE DIAGNÓSTICO: decisión de hablante del turno.
        voiceProbe('identity', { path: 'conversacion', vec: signatureVector.length, snap: audioSnapshot.length, sr: sampleRate, clusters: speakerClustersRef.current?.length ?? 0, ...payloadSeparacionDeTurno(signatureVector, speakerClustersRef.current, audioSnapshot, sampleRate), resolved: resolvedSpeakerName, fallback: fallbackSpeaker, last: lastSpeakerRef.current || '' })
        return {
          signatureVector,
          speakerName: audioSnapshot.length ? resolvedSpeakerName : '',
          evidenciaAcustica: false,
          introducedName: null,
          resolvedSpeakerName: audioSnapshot.length ? resolvedSpeakerName : '',
          speakerAlias: null,
        }
      }

      // MODO PASIVO: UNA decisión de hablante delegada al resolver del MÓDULO
      // (decisión A). Una medida por turno: la identidad y la firma salen de la
      // MISMA medida (EmbebedorPort); el resolver es sin estado y el hook
      // conserva la cadena de evidencia entre turnos (voz/vector/contador).
      const fallbackCiego = blindSpeakerFallback(lastResolvedSpeakerRef.current || lastSpeakerRef.current || fallbackSpeaker)
      if (!audioSnapshot.length) {
        // SIN AUDIO no hay diarización posible: fallback ciego, sin evidencia.
        relayLog(
          'LOG',
          'SpeakerTrace',
          `pasivo SIN AUDIO (snap=0) → fallback="${fallbackSpeaker}" (no se puede separar voces)`,
        )
        return {
          signatureVector,
          speakerName: fallbackCiego,
          introducedName: null,
          resolvedSpeakerName: fallbackCiego,
          speakerAlias: null,
          evidenciaAcustica: false,
        }
      }

      const resolucion = await resolverPasivoRef.current({
        muestras: audioSnapshot,
        sampleRate,
        ultimoVozId: ultimoVozIdRef.current,
        ultimoVector: ultimoVectorRef.current,
        contadorVoces: contadorVocesRef.current,
      })

      if (!resolucion?.evidencia) {
        return {
          signatureVector,
          speakerName: fallbackCiego,
          introducedName: null,
          resolvedSpeakerName: fallbackCiego,
          speakerAlias: null,
          evidenciaAcustica: false,
        }
      }

      // Con evidencia: la cadena de la medida avanza y la etiqueta viene del
      // resolver; la continuidad prefiere la voz ya resuelta de la sesión.
      ultimoVozIdRef.current = resolucion.vozId
      ultimoVectorRef.current = resolucion.vector
      const resolvedSpeakerName = resolucion.continuidad
        ? lastResolvedSpeakerRef.current || lastSpeakerRef.current || resolucion.hablante
        : resolucion.hablante
      if (!resolucion.continuidad) contadorVocesRef.current += 1
      const introducedName = resolveSpeakerNameFromUtterance(transcriptForIntro)
      const speakerAlias = introducedName && introducedName !== resolvedSpeakerName ? resolvedSpeakerName : null

      // La base de participantes se re-ancla por la MISMA via en todas las rutas de "soy X" (2026-10-18).
      registerSpeakerIdentity({ name: introducedName, clusters: speakerClustersRef.current, signatureVector, refs: { sessionPrimarySpeakerRef, registerParticipant: participantRegisterPort(identitySession) } })
      lastSpeakerRef.current = resolvedSpeakerName
      lastResolvedSpeakerRef.current = resolvedSpeakerName
      lastTurnSignatureRef.current = signatureVector
      return {
        signatureVector,
        speakerName: resolvedSpeakerName,
        introducedName,
        resolvedSpeakerName,
        speakerAlias,
        evidenciaAcustica: true,
      }
    },
    [conversationActiveRef, computeTurnSignature, identitySession],
  )

  const commitSessionTurn = useCallback(
    (text, speakerName) => {
      const capture = cleanForSpeech(text)
      if (!capture) return

      const speaker = normalizeSpeakerLabel(
        cleanForSpeech(speakerName) ||
        lastLoggedSpeakerRef.current ||
        lastSpeakerRef.current ||
        FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker,
      )
      const tramoFila = tramoDelTurno({ chunks: chunksRef.current, totalSamples: chunkTotalSamplesRef.current, sinceSample: turnAudioStartSampleRef.current, sampleRate: sampleRateRef.current })
      recordSessionTurn({ kind: 'commit', text: capture, speaker, signature: lastTurnSignatureRef.current, clusters: speakerClustersRef.current, lastSpeaker: lastSpeakerRef.current, primary: sessionPrimarySpeakerRef.current, audioStartSample: tramoFila.audioStartSample, audioEndSample: tramoFila.audioEndSample, tramoValido: tramoFila.tramoValido, sessionTurnId: activeTurnIdRef.current })

      if (!isFluSpeaker(speaker)) {
        reconcileSpeakerClusters(userSpeakersView.current)
      }
    },
    [reconcileSpeakerClusters, userSpeakersView],
  )

  // §9: `injectDialogueEntry` se eliminó: App persiste en el store y el diálogo se DERIVA de él.

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
        // Fallback OFFLINE: Whisper WASM se alimenta del MISMO PCM cuando es la instancia activa.
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
      Recognition.onstart = () => {
        recognitionActiveRef.current = true
        // El motor del producto abre con CADA onstart (corte de Chrome): un solo camino en ambos modos; la sesión del módulo sobrevive a los reinicios (Caso 13).
        abrirMotorConversacion()
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
      }

      Recognition.onresult = (event) => {
        // UNICO predicado de motor local (dueno: voiceLocalFallback).
        const localEngineActive = fallback.isLocal(recognitionRef.current)
        if (isVoiceProbeEnabled()) voiceProbe('asrRaw', { engine: localEngineActive ? 'whisper' : 'chrome', metrics: event?.metrics ?? null, turn: activeTurnIdRef.current, items: Array.from(event.results || []).map((r) => { const t = String(r?.[0]?.transcript || ''); return { f: r?.isFinal ? 1 : 0, t, l: t.length } }) })
        // El eco lo gana el MÓDULO por su único dueño (`ultimoTextoDicho`): aquí no
        // se re-gatea por contenido; el evento CRUDO entra tal cual en ambos modos.
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

          if (result.isFinal) finalText = transcript
          else interim = transcript
        }

        // El modo bilingüe cambia el locale del ASR: es conducta de la ESCUCHA
        // (del hook), no de la conversación. Se decide con el texto del evento,
        // en AMBOS modos.
        if (interim || finalText) maybeSwitchRecognitionLocaleRef.current(interim || finalText)
        if (finalText) { const w = analyzeWakeTurn(finalText, { lastCommitted: userRowsTextView.current.at(-1) || '' }); voiceProbe('asrFinal', { engine: localEngineActive ? 'whisper' : 'chrome', ms: event?.metrics?.durationMs ?? null, speechLikeMs: event?.metrics?.speechLikeMs ?? null, rms: event?.metrics?.rms ?? null, turn: activeTurnIdRef.current, wake: w.wakeWordMatched, inline: w.hasInlineBoundary, before: w.passiveOnly.slice(0, 80), after: w.afterWake.slice(0, 80), len: w.cleaned.length, text: w.cleaned }) }
        // MOTOR del producto: ÚNICA ruta de la frase y de la fila en AMBOS modos.
        // Evento CRUDO adentro; la rama activa TERMINA tras delegar.
        if (conversationActiveRef?.current) {
          if (motorConversacionRef.current) motorConversacionRef.current.evento(event)
          return
        }
        if (motorConversacionRef.current) motorConversacionRef.current.evento(event)
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
            requestRecognitionRestart('fallback', getRecognitionRetryDelay(errorCode))
          }
          return
        }

        if (errorCode === 'no-speech' || errorCode === 'aborted') {
          if ((isListeningRef.current || (conversationActiveRef?.current && !isStoppingRef.current)) && !isStoppingRef.current) {
            requestRecognitionRestart('no-speech', FLU_CONFIG.listening?.restartAfterNoSpeechMs)
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
          requestRecognitionRestart('error-captura', getRecognitionRetryDelay(errorCode))
          return
        }

        // Errores del motor local de transcripción (worker/WASM): se reintentan
        // solos; no son fallo del micrófono ni del usuario.
        if (errorCode === 'engine-error') {
          setError('')
          isProcessingRef.current = false
          requestRecognitionRestart('error-motor', getRecognitionRetryDelay(errorCode))
          return
        }

        const recoverableError = isRecoverableRecognitionError(errorCode, false)
        if (recoverableError) {
          setError('')
          isProcessingRef.current = false
          requestRecognitionRestart('error-recuperable', getRecognitionRetryDelay(errorCode))
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
        // La sesión del módulo vive mientras la escucha vive: Chrome reinicia el reconocedor cada pocos
        // segundos y cerrar aquí partía la conversación en una sesión por reinicio (medido 2026-10-25).

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
          requestRecognitionRestart('onend-conversacion', restartCfg.retryBackoffMs)
          return
        }

        requestRecognitionRestart('onend-pasivo', delay)
      }
    },
    [
      abrirMotorConversacion,
      cleanupAudio,
      conversationActiveRef,
      fallback,
      requestRecognitionRestart,
      setError,
      resolvedWakeWords,
      userRowsTextView,
    ],
  )

  wireRecognitionEventsRef.current = wireRecognitionEvents

  const rebuildRecognition = useCallback(() => {
    if (!isListeningRef.current || isStoppingRef.current) return false

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
  }, [language, wireRecognitionEvents])

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
          requestRecognitionRestart('reanudar', 0)
        }
      } else if (!recognitionActiveRef.current) {
        requestRecognitionRestart('reanudar', 0)
      }
      schedulePassiveAudioCapture()
      return
    }

    try {

      if (!resume) {
        lastTurnSignatureRef.current = null
      }
      chunksRef.current = []
      chunkTotalSamplesRef.current = 0
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
        requestRecognitionRestart('arranque', getActiveListenConfig().restart.retryBackoffMs)
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
        // La cadena de evidencia PASIVA también es de la sesión: una voz de la
        // sesión anterior no debe continuar en la nueva.
        ultimoVozIdRef.current = ''
        ultimoVectorRef.current = null
        contadorVocesRef.current = 0
        lastResolvedSpeakerRef.current = ''
        lastModuleLabelRef.current = ''
        applySessionCommandToPrimary({ transcript: cleaned, sessionPrimarySpeakerRef })
        // Fase E: tras reiniciar la sesion, re-sembrar el participante activo como sessionPrimary.
        seedSessionPrimaryFromActiveName()
        activeTurnIdRef.current = 0
        lastTurnSignatureRef.current = null
        fluParticipantRef.current?.resetParticipant?.()
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
    [commitAndResolveTurn, commitSessionTurn, language, persistDialogueSession, phase, clearAutoProcessTimer, seedSessionPrimaryFromActiveName, setSpeakerClusters, buildCommandSpeech],
  )

  const dispatchPassiveVoiceCommand = useCallback(
    async (uiCommand, transcript) => {
      if (!uiCommand) return

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
      if (!question) {
        relayLog('WARN', 'useFluVoiceAssistant', `processConversationFluQuery EXIT EARLY: question="${(question || '').slice(0, 60)}"`)
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
        // El orador lo decide `resolveSpeaker` (UNA medida por turno, decisión A):
        // en conversación la etiqueta es la del módulo; en pasivo, la del resolver.

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
        if (speakerResult.status === 'fulfilled' && speakerResult.value) {
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
          requestRecognitionRestart('tras-habla', FLU_CONFIG.timing.resumeAfterSpeechMs)
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
      const phrase = cleanForSpeech(text)
      const lastCommitted = userRowsTextView.current.at(-1) || ''
      // El eco lo gana el MÓDULO por su único dueño (`ultimoTextoDicho`): el
      // despacho recibe solo la frase canónica ya gated.

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

    // SIN motor (onstart nunca llegó): apagar la escucha sin parseo local. El
    // despacho pasivo vive en el módulo (`onFraseCanonica`); aquí no se procesa
    // captura propia (processCapture retirado con la tubería vieja).
    if (!isListeningRef.current) return
    isListeningRef.current = false
    await cleanupAudio()
    setStatus('idle')
  }, [
    cerrarMotorConversacion,
    cleanupAudio,
    finalizeRecognition,
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
      requestRecognitionRestartRef.current?.('watchdog', listeningCfg.restartAfterEndMs)
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
