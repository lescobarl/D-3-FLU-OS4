/**
 * useLocalAsrFallback — dueno del FALLBACK LOCAL del ASR y de su RECUPERACION.
 *
 * Extraido del hook principal por SRP y por el trinquete de tamano
 * (`tests/godFileSizeGuard.test.ts`): useFluVoiceAssistant orquesta, este hook
 * decide y ejecuta el cambio de motor. Una sola razon de cambio:
 *
 *   - DEGRADAR a Whisper: solo tras N rebuilds de Chrome sin resultado, ventana
 *     larga (`silentDegradeMs`) y HABLA sostenida (`resolveSilentDegrade`).
 *   - GATEAR resultados locales sin evidencia acustica (`classifyLocalResult`).
 *     ALCANCE DECLARADO: el criterio es "el audio parece habla", NO "es habla
 *     dirigida a FLU". TV o conversacion de fondo pasan el gate (lo decide un
 *     criterio de hablante, fuera de este modulo); solo el audio NO hablado
 *     (silencio/zumbido/ruido sin estructura) se descarta.
 *   - RECUPERAR Chrome: el reloj es la INACTIVIDAD DE FINALES ACEPTADOS (un
 *     parcial no lo reinicia: si Whisper solo emite parciales, la recuperacion
 *     debe ocurrir igual). Sin resultado de Chrome en `probeMs` -> vuelve el local.
 *
 * UN solo predicado de motor local: `isLocalRecognitionEngine` (dueno del
 * contrato del motor). No hay latch paralelo: el motor activo ES el ref.
 */
import { useCallback, useMemo, useRef } from 'react'
import {
  classifyLocalResult,
  getLocalFallbackRuntimeConfig,
  installChromeRecognition,
  installLocalRecognition,
  isLocalRecognitionEngine,
  reportLocalResultGate,
  resolveSilentDegrade,
} from '../lib/voiceLocalFallback'
import { WATCHDOG_ACTIONS, resolveWatchdogStep } from '../lib/asrWatchdog.js'
import { analyzeWakeTurn } from '../lib/wakeTurnCommit.js'
import { resolveNavigationCommand } from '../lib/voiceCommands.js'

/**
 * @param {object} deps Refs y acciones del hook principal.
 * @param {boolean} [deps.degradeEnabled] Politica de produccion: `false` deja
 *   Chrome como unico motor y conserva el rebuild del watchdog (backup
 *   `rescate/wip-pre-s9`); `true` permite el fallback local (lab/opt-in).
 * @returns {{
 *   degradeEligibleSinceRef: { current: number },
 *   isLocal: (engine?: unknown) => boolean,
 *   degrade: () => boolean,
 *   recover: () => boolean,
 *   degradeRef: { current: (() => boolean) | null },
 *   recoverRef: { current: (() => boolean) | null },
 *   gateResult: (m: { isFinal: boolean, transcript: string, metrics: any, wakeWords: string[] }) => boolean,
 *   noteResult: () => void,
 *   noteFinalAccepted: () => void,
 *   resetSession: () => void,
 *   watchdogTick: () => 'handled'|'none',
 * }}
 */
export function useLocalAsrFallback({
  recognitionRef,
  wireRecognitionEventsRef,
  createRecognition,
  startRecognition,
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
  audioSampleRate,
  getRestartConfig,
  degradeEnabled = true,
}) {
  const degradeEligibleSinceRef = useRef(0)
  const stallRebuildStreakRef = useRef(0)
  const recoveryAtRef = useRef(0)
  const segmentsSinceRecoveryRef = useRef(0)
  const probeUntilRef = useRef(0)
  /** Ultimo FINAL aceptado (el parcial NO cuenta): reloj de la recuperacion. */
  const lastFinalAtRef = useRef(0)
  const lastDegradeEvalAtRef = useRef(0)

  /** UNICO predicado de "este motor es el local" (delegado a su dueno). */
  const isLocal = useCallback(
    (engine = recognitionRef.current) => isLocalRecognitionEngine(engine),
    [recognitionRef],
  )

  const degrade = useCallback(() => {
    if (!degradeEnabled) return false
    const previous = recognitionRef.current
    const localEngine = installLocalRecognition({
      previous,
      wire: (engine) => wireRecognitionEventsRef.current?.(engine),
    })
    if (!localEngine) return isLocal(previous)
    recognitionRef.current = localEngine
    recognitionActiveRef.current = false
    const now = Date.now()
    recoveryAtRef.current = now
    lastFinalAtRef.current = now
    segmentsSinceRecoveryRef.current = 0
    probeUntilRef.current = 0
    return true
  }, [degradeEnabled, isLocal, recognitionActiveRef, recognitionRef, wireRecognitionEventsRef])

  const degradeRef = useRef(null)
  degradeRef.current = degrade

  const recover = useCallback(() => {
    if (!isListeningRef.current || isStoppingRef.current) return false
    const runtimeCfg = getLocalFallbackRuntimeConfig()
    const swap = installChromeRecognition({
      previous: recognitionRef.current,
      create: () => createRecognition(language, recognitionLocaleRef.current),
      wire: (engine) => wireRecognitionEventsRef.current?.(engine),
      start: (engine) => startRecognition(engine),
    })
    if (!swap) return false
    const now = Date.now()
    if (!swap.ok) {
      // Chrome no arranco: el swap ya restauro un local ARRANCADO.
      recognitionRef.current = swap.fallback
      recognitionActiveRef.current = false
      recoveryAtRef.current = now
      lastFinalAtRef.current = now
      segmentsSinceRecoveryRef.current = 0
      probeUntilRef.current = 0
      return false
    }
    recognitionRef.current = swap.recognition
    recognitionActiveRef.current = false
    recoveryAtRef.current = now
    lastFinalAtRef.current = now
    segmentsSinceRecoveryRef.current = 0
    probeUntilRef.current = now + runtimeCfg.probeMs
    lastSrResultAtRef.current = now
    lastOnresultAtRef.current = now
    lastMeaningfulIngressAtRef.current = now
    stallRebuildStreakRef.current = 0
    return true
  }, [
    createRecognition,
    isListeningRef,
    isStoppingRef,
    language,
    lastMeaningfulIngressAtRef,
    lastOnresultAtRef,
    lastSrResultAtRef,
    recognitionActiveRef,
    recognitionLocaleRef,
    recognitionRef,
    startRecognition,
    wireRecognitionEventsRef,
  ])

  const recoverRef = useRef(null)
  recoverRef.current = recover

  /** Sesion nueva: se arranca en Chrome y se borran los relojes del fallback. */
  const resetSession = useCallback(() => {
    stallRebuildStreakRef.current = 0
    recoveryAtRef.current = 0
    segmentsSinceRecoveryRef.current = 0
    probeUntilRef.current = 0
    lastFinalAtRef.current = 0
  }, [])

  /** Chrome produjo un RESULTADO: si habia ventana de prueba, queda como activo. */
  const noteResult = useCallback(() => {
    stallRebuildStreakRef.current = 0
    if (probeUntilRef.current) {
      probeUntilRef.current = 0
      recoveryAtRef.current = Date.now()
    }
  }, [])

  /**
   * FINAL aceptado (paso el gate y se emitio). Unico reloj que habilita la
   * recuperacion: los parciales no cuentan (si no, Whisper emitiendo parciales
   * bloquearia la vuelta a Chrome para siempre).
   */
  const noteFinalAccepted = useCallback(() => {
    lastFinalAtRef.current = Date.now()
    segmentsSinceRecoveryRef.current += 1
  }, [])

  /**
   * Gate de un resultado LOCAL: `true` si se descarto (el llamador lo salta).
   * Solo aplica cuando el motor adjunto `metrics` (motor local).
   */
  const gateResult = useCallback(({ isFinal, transcript, metrics, wakeWords }) => {
    const decision = classifyLocalResult({
      isFinal,
      metrics,
      wakeMatched: analyzeWakeTurn(transcript, { wakeWords }).wakeWordMatched,
      isNavigationCommand: Boolean(resolveNavigationCommand(transcript)),
    })
    return reportLocalResultGate({ decision, phrase: transcript, isFinal, log: relayLog })
  }, [relayLog])

  /**
   * Un tick del watchdog en CONVERSACION. Devuelve 'handled' si ejecuto un paso
   * (rebuild / recuperacion / degradacion) y 'none' si no habia nada que hacer.
   */
  const watchdogTick = useCallback(() => {
    const now = Date.now()
    const restartCfg = getRestartConfig(true)
    const runtimeCfg = getLocalFallbackRuntimeConfig()
    const localActive = isLocal()
    const probeUntil = probeUntilRef.current
    const step = resolveWatchdogStep({
      sinceMeaningful: now - (lastMeaningfulIngressAtRef.current || 0),
      sinceEnd: now - (lastRecognitionEndAtRef.current || 0),
      sinceRebuild: now - (lastStallRebuildAtRef.current || 0),
      localActive,
      recognitionActive: recognitionActiveRef.current,
      restartPending: recognitionRestartPendingRef.current,
      probePending: Boolean(probeUntil),
      probeExpired: Boolean(probeUntil) && now >= probeUntil,
      recoveryDue:
        now - (lastFinalAtRef.current || 0) >= runtimeCfg.recoveryMs ||
        segmentsSinceRecoveryRef.current >= runtimeCfg.recoverySegments,
      restartCfg,
      runtimeCfg,
    })

    if (step.action === WATCHDOG_ACTIONS.RECOVER_BACK) {
      probeUntilRef.current = 0
      if (degradeRef.current?.()) {
        relayLog('LOG', 'useFluVoiceAssistant', '[REC] recovery: Chrome sin resultado en la ventana de prueba -> motor local')
      }
      return 'handled'
    }
    if (step.action === WATCHDOG_ACTIONS.RECOVER) {
      if (recoverRef.current?.()) {
        relayLog('LOG', 'useFluVoiceAssistant', '[REC] recovery: reintento del motor online (Chrome)')
      }
      return 'handled'
    }
    if (step.action === WATCHDOG_ACTIONS.REBUILD) {
      if (step.kind === 'stall') lastStallRebuildAtRef.current = now
      stallRebuildStreakRef.current += 1
      if (!rebuildRecognitionRef.current()) {
        requestRecognitionRestartRef.current?.(restartCfg.retryBackoffMs)
      }
      return 'handled'
    }

    // Politica de produccion: Chrome-only. El rebuild ya se intento arriba;
    // no se enciende Whisper por una pausa (backup `rescate/wip-pre-s9`).
    if (!degradeEnabled) return 'none'
    // DEGRADACION: ultima, y como mucho cada `evalMinMs` (recorrer la ventana de
    // audio en cada tick seria inutil). La decision es de `resolveSilentDegrade`:
    // ventana larga + HABLA + rebuilds fallidos.
    if (now - lastDegradeEvalAtRef.current < runtimeCfg.evalMinMs) return 'none'
    lastDegradeEvalAtRef.current = now
    const decision = resolveSilentDegrade({
      chunks: chunksRef.current,
      sampleRate: sampleRateRef.current || audioSampleRate,
      now,
      lastSrResultAt: lastSrResultAtRef.current,
      eligibleSince: degradeEligibleSinceRef.current,
      failedRebuilds: stallRebuildStreakRef.current,
    })
    if (decision.degrade && degradeRef.current?.()) {
      relayLog('LOG', 'useFluVoiceAssistant', decision.log)
      return 'handled'
    }
    return 'none'
  }, [
    audioSampleRate,
    chunksRef,
    degradeEnabled,
    getRestartConfig,
    isLocal,
    lastMeaningfulIngressAtRef,
    lastRecognitionEndAtRef,
    lastSrResultAtRef,
    lastStallRebuildAtRef,
    rebuildRecognitionRef,
    recognitionActiveRef,
    recognitionRestartPendingRef,
    relayLog,
    requestRecognitionRestartRef,
    sampleRateRef,
  ])

  return useMemo(
    () => ({
      degradeEligibleSinceRef,
      isLocal,
      degrade,
      recover,
      degradeRef,
      recoverRef,
      gateResult,
      noteResult,
      noteFinalAccepted,
      resetSession,
      watchdogTick,
    }),
    [degrade, gateResult, isLocal, noteFinalAccepted, noteResult, recover, resetSession, watchdogTick],
  )
}
