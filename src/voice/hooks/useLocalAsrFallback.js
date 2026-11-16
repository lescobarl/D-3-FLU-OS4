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
import { isFluSpeaking } from '../lib/fluSpeech.js'
import { countVoicedSamplesInBlocks } from '../lib/voicedActivity.js'
import { getConversationMinVoicedSamples } from '../lib/micCapture.js'
import { analyzeWakeTurn } from '../lib/wakeTurnCommit.js'
import { resolveNavigationCommand } from '../lib/voiceCommands.js'

/**
 * @param {object} deps Refs y acciones del hook principal.
 * @param {() => ({ texto?: string } | null)} [deps.leerLocucionAbierta] La
 *   locución abierta del módulo, con su texto (su dueño es `instantanea`), o
 *   `null`. Con texto es una frase viva; vacía es la firma del Chrome mudo
 *   (medido 2026-11-12 18:22 y 19:05). Con la locución abierta el stall no
 *   reconstruye: es la prueba de habla que el piso PCM de identidad no ve.
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
  leerLocucionAbierta,
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
  /** Locucion a la que YA se le dio el rebuild `mudo` temprano: una por locucion. */
  const mudoTempranoLocucionRef = useRef('')
  /**
   * CONTADOR DE SESION del Chrome mudo: ms acumulados con una locucion ABIERTA y
   * SIN texto, a traves de las ventanas que parte el tope. NO se reinicia al
   * cerrar por `maximo` ni al abrir la ventana siguiente; SOLO con texto de
   * Chrome observado o al cambiar de motor. Las filas LOCALES no lo tocan.
   */
  const muteSpeechMsRef = useRef(0)
  /** Ultimo tick que acumulo: mide el tramo entre ticks, no el hueco total. */
  const muteLastTickAtRef = useRef(0)
  /** Ultimo rebuild de la puerta de SESION (20 s): evita repetirlo cada cooldown. */
  const lastSessionMuteRebuildAtRef = useRef(0)

  /** Reinicia el contador de sesion: SOLO texto de Chrome o cambio de motor. */
  const resetMuteClock = useCallback(() => {
    muteSpeechMsRef.current = 0
    muteLastTickAtRef.current = 0
    lastSessionMuteRebuildAtRef.current = 0
  }, [])

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
    // CAMBIO DE MOTOR: el contador de Chrome mudo no sobrevive al motor local.
    resetMuteClock()
    return true
  }, [degradeEnabled, isLocal, recognitionActiveRef, recognitionRef, resetMuteClock, wireRecognitionEventsRef])

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
    // CAMBIO DE MOTOR (local -> Chrome): nueva sesion de escucha, contador a cero.
    resetMuteClock()
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
    resetMuteClock,
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
    mudoTempranoLocucionRef.current = ''
    resetMuteClock()
  }, [resetMuteClock])

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
    const recognitionActive = recognitionActiveRef.current
    const rate = sampleRateRef.current || audioSampleRate
    // VOZ RECIENTE: el rebuild `stall` no puede tirar un segmento que Chrome
    // esta reconociendo. El conteo es del dueno `voicedActivity`; el piso es el
    // mismo de la identidad (`conversationMinVoicedMs`), no un literal nuevo.
    const voiceWindowMs =
      Number(restartCfg.stallVoiceWindowMs) || Number(restartCfg.silentMicStallMs) || 0
    const hasRecentSpeech =
      !localActive &&
      recognitionActive &&
      countVoicedSamplesInBlocks(chunksRef.current, {
        sampleRate: rate,
        windowMs: voiceWindowMs,
      }) >= getConversationMinVoicedSamples(rate)
    // LOCUCIÓN ABIERTA: habla que el piso de identidad no alcanza a ver. El
    // hecho lo posee el módulo (su instantánea de sesión); aquí solo se lee.
    // Medido 2026-11-12 18:22: la mujer hablaba con 30–480 ms de voz por
    // ventana de 1,5 s y el watchdog la trataba como micrófono muerto.
    const locucionAbierta = leerLocucionAbierta?.() ?? null
    const hayLocucionAbierta = Boolean(locucionAbierta)
    // SIN TEXTO EN LA ABIERTA: la firma del Chrome mudo. Medido 19:05: 37,2 s
    // con la locución abierta y CERO resultados (el stall no podía tocarla
    // —hay locución— y el dead exige inactivo); cerró con `descarte:sinTexto`.
    // Sin una palabra escrita no hay frase que un rebuild pueda cortar.
    const sinTextoEnLaAbierta =
      hayLocucionAbierta && !String(locucionAbierta.texto || '').trim()
    // CONTADOR DE SESION del Chrome mudo: suma el tiempo con una locucion
    // ABIERTA y VACIA. El tope parte la locucion cada 12 s y abre la siguiente;
    // como no se llavea por `locutionId`, el contador NO se reinicia por ninguno
    // de los dos hechos. Se reinicia SOLO cuando Chrome escribe (la abierta deja
    // de estar vacia) o al cambiar de motor. Un final LOCAL no lo toca: Chrome
    // sigue mudo y la recuperacion debe ocurrir igual.
    if (localActive || (hayLocucionAbierta && !sinTextoEnLaAbierta)) {
      muteSpeechMsRef.current = 0
      lastSessionMuteRebuildAtRef.current = 0
    } else if (hayLocucionAbierta) {
      const previo = muteLastTickAtRef.current
      if (previo > 0) muteSpeechMsRef.current += Math.max(0, now - previo)
    }
    muteLastTickAtRef.current = now
    const muteSpeechMs = muteSpeechMsRef.current
    const muteRebuildDue =
      lastSessionMuteRebuildAtRef.current === 0 ||
      now - lastSessionMuteRebuildAtRef.current >= Number(restartCfg.muteOpenLocutionMs)
    // AUDIO PROPIO de la locucion abierta (`fin - inicio` de su tramo). El
    // reloj global (`sinceMeaningful`) es del motor, no de ESTA locucion: en
    // 18:44:08.183 traia 4238 ms del turno anterior y disparo el mudo 0,57 s
    // despues de abrir 4d84debd, cuyo audio propio era de 43 ms. La frase que
    // Chrome estaba oyendo quedo fuera de la ventana de medida (240 ms de voz,
    // sin `vozId`) y el nombre no alcanzo a las filas de la voz.
    const openLocutionMs =
      hayLocucionAbierta &&
      Number(locucionAbierta.tramo?.sampleRate) > 0
        ? Math.max(
            0,
            ((Number(locucionAbierta.tramo.fin) - Number(locucionAbierta.tramo.inicio)) /
              Number(locucionAbierta.tramo.sampleRate)) *
              1000,
          )
        : 0
    // MUDO TEMPRANO: el rebuild de `stallMs` ya se le dio a ESTA locucion. Sin
    // este candado el reloj se rearma con cada onstart y el motor se cortaria
    // cada pocos segundos en medio de la misma frase (defecto medido 18:22).
    // La llave es el `locutionId` que ya publica la instantanea del modulo.
    const mudoTempranoHecho =
      hayLocucionAbierta && mudoTempranoLocucionRef.current === locucionAbierta.locutionId
    const step = resolveWatchdogStep({
      sinceMeaningful: now - (lastMeaningfulIngressAtRef.current || 0),
      sinceEnd: now - (lastRecognitionEndAtRef.current || 0),
      sinceRebuild: now - (lastStallRebuildAtRef.current || 0),
      localActive,
      recognitionActive,
      restartPending: recognitionRestartPendingRef.current,
      probePending: Boolean(probeUntil),
      probeExpired: Boolean(probeUntil) && now >= probeUntil,
      hasRecentSpeech,
      hasOpenLocution: hayLocucionAbierta,
      hasEmptyOpenLocution: sinTextoEnLaAbierta,
      openLocutionMs,
      mudoTempranoHecho,
      muteSpeechMs,
      muteRebuildDue,
      recoveryDue:
        now - (lastFinalAtRef.current || 0) >= runtimeCfg.recoveryMs ||
        segmentsSinceRecoveryRef.current >= runtimeCfg.recoverySegments,
      // El hecho lo posee `isFluSpeaking`; aqui solo se aporta al paso.
      fluSpeaking: isFluSpeaking(),
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
      relayLog('LOG', 'useFluVoiceAssistant', `[WD] rebuild kind=${step.kind} sinceMeaningful=${now - (lastMeaningfulIngressAtRef.current || 0)} recognitionActive=${recognitionActiveRef.current} restartPending=${recognitionRestartPendingRef.current} hasRecentSpeech=${hasRecentSpeech} locucionAbierta=${hayLocucionAbierta} sinTextoEnAbierta=${sinTextoEnLaAbierta} locucionMs=${Math.round(openLocutionMs)} mudoSesionMs=${Math.round(muteSpeechMs)} locucionId=${locucionAbierta?.locutionId || '-'} mudoTemprano=${step.early === true}`)
      if (step.early === true && locucionAbierta?.locutionId) {
        mudoTempranoLocucionRef.current = locucionAbierta.locutionId
      }
      if (step.kind === 'stall') lastStallRebuildAtRef.current = now
      if (step.kind === 'mudo' && step.early !== true) {
        // Puerta de SESION: no se repite hasta acumular otra ventana completa.
        lastSessionMuteRebuildAtRef.current = now
      }
      stallRebuildStreakRef.current += 1
      if (!rebuildRecognitionRef.current()) {
        // Caso 13: el reinicio declara su motivo; sin el, no se agenda.
        requestRecognitionRestartRef.current?.('fallback-rebuild', restartCfg.retryBackoffMs)
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
    leerLocucionAbierta,
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
