/**
 * Fallback OFFLINE de voz (§1/§9).
 *
 * Cuando Chrome SpeechRecognition falla por red ('network') o por ausencia de
 * habla ('no-speech'), el motor principal degrada al motor local Whisper WASM
 * on-device. Esta decisión vive aquí, config-driven y sin hardcode: los códigos
 * de error que disparan el fallback se leen de
 * `FLU_CONFIG.voiceIdentity.capture.recognition.fallbackErrors`.
 *
 * El motor local en sí (`createWhisperRecognitionEngine`) lo instancia el hook
 * `useFluVoiceAssistant` — único punto con acceso al búfer PCM de
 * `micCaptureBridge` y al cableado de eventos del pipeline — de modo que la
 * transcripción siga teniendo UNA sola salida (parciales/finales caen en el
 * mismo `resolveIngressCaptureText`/`commitAndResolveTurn`). Aquí no se crea
 * ni se duplica ningún motor: solo se decide CUÁNDO degradar.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { createWhisperRecognitionEngine } from './asr/whisperRecognitionEngine.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { countSpeechLikeSamplesInBlocks, countVoicedSamplesInBlocks, rmsOfBlocks } from './voicedActivity.js'
import { logCaughtError } from '../../lib/caughtError'
import { DISCARD_REASONS, discardLocution } from './phraseDiscard.js'
import { LOCAL_FALLBACK_DEFAULTS } from './asr/asrDefaults.js'

/**
 * Códigos de error de Chrome SpeechRecognition que degradan al motor local.
 * Config-driven: `FLU_CONFIG.voiceIdentity.capture.recognition.fallbackErrors`.
 * Default: `['network', 'no-speech']`.
 *
 * @returns {string[]} códigos en minúsculas, sin vacíos.
 */
export function getLocalFallbackErrors() {
  const configured = FLU_CONFIG.voiceIdentity?.capture?.recognition?.fallbackErrors
  if (Array.isArray(configured) && configured.length) {
    return configured
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean)
  }
  return ['network', 'no-speech']
}

/**
 * Politica de motor del respaldo `rescate/wip-pre-s9`: en produccion la escucha
 * es Chrome SR y su watchdog lo reconstruye. El motor Whisper local solo se
 * habilita explicitamente (`localFallbackEnabled: true`) para el lab dev o una
 * validacion controlada; por defecto no entra en produccion.
 *
 * @returns {boolean} `true` solo si la config habilita el fallback local.
 */
export function isLocalFallbackEnabled() {
  return FLU_CONFIG.voiceIdentity?.capture?.recognition?.localFallbackEnabled === true
}

/**
 * Decide si un error de reconocimiento debe degradar al motor local Whisper WASM.
 * Acepta tanto el código crudo ('network') como el evento de Chrome `{ error }`.
 *
 * @param {string | { error?: string }} error Código de error o evento `{ error }`.
 * @returns {boolean} `true` si el error está en la lista de fallback configurada.
 */
export function shouldUseLocalFallback(error) {
  const code = String(error?.error ?? error ?? '').trim().toLowerCase()
  if (!code) return false
  return getLocalFallbackErrors().includes(code)
}

// Los RESPALDOS del fallback viven en `asrDefaults.js` (una sola definicion,
// compartida con `fluConfig`). Aqui solo se leen.

/**
 * Config de la degradacion por SR MUDO y de la RECUPERACION del motor online
 * (caso 45aeb8e2 repetido el 2026-10-20): el watchdog reconstruia Chrome en bucle
 * y la transcripcion se perdia; la primera version degradaba a los 3,5 s mirando
 * solo RMS, asi que una pausa con ruido/TV encendia Whisper y este alucinaba.
 *
 * REGLA DURA: la degradacion NO puede adelantarse al rebuild de Chrome; el piso
 * es `silentMicStallMs` de la conversacion + margen. Todo config-driven
 * (`voiceIdentity.capture.recognition`), sin hardcode.
 *
 * @returns {{ silentMs: number, rebuilds: number, minSpeechLikeMs: number, stallMs: number }}
 */
export function getSilentDegradeConfig() {
  const cfg = FLU_CONFIG.voiceIdentity?.capture?.recognition || {}
  const restart = FLU_CONFIG.activeListen?.restart || {}
  const stallMs = Number(restart.conversationStallMs) > 0
    ? Number(restart.conversationStallMs)
    : Number(restart.silentMicStallMs) || 0
  const configuredMs = Number(cfg.silentDegradeMs)
  const marginMs = Number(cfg.silentDegradeStallMarginMs)
  const rebuilds = Number(cfg.silentDegradeRebuilds)
  const minSpeechLikeMs = Number(cfg.silentDegradeMinSpeechLikeMs)
  return {
    // Chrome primero: la ventana nunca es menor que su stall + margen.
    silentMs: Math.max(
      configuredMs > 0 ? configuredMs : LOCAL_FALLBACK_DEFAULTS.silentDegradeMs,
      stallMs + (marginMs > 0 ? marginMs : LOCAL_FALLBACK_DEFAULTS.silentDegradeStallMarginMs),
    ),
    rebuilds: rebuilds > 0 ? Math.max(1, Math.floor(rebuilds)) : LOCAL_FALLBACK_DEFAULTS.silentDegradeRebuilds,
    minSpeechLikeMs:
      minSpeechLikeMs > 0 ? minSpeechLikeMs : LOCAL_FALLBACK_DEFAULTS.silentDegradeMinSpeechLikeMs,
    stallMs,
  }
}

/**
 * Config de recuperacion (Chrome se reintenta con el motor local activo) y del
 * gate de resultados locales. Un solo lector para las dos decisiones.
 *
 * @returns {{ recoveryMs: number, recoverySegments: number, probeMs: number, evalMinMs: number, finalMinSpeechLikeMs: number, partialMinSpeechLikeMs: number }}
 */
export function getLocalFallbackRuntimeConfig() {
  const cfg = FLU_CONFIG.voiceIdentity?.capture?.recognition || {}
  const asr = FLU_CONFIG.transcript?.asr || {}
  const recoveryMs = Number(cfg.localRecoveryMs)
  const recoverySegments = Number(cfg.localRecoverySegments)
  const probeMs = Number(cfg.localRecoveryProbeMs)
  const finalMin = Number(asr.finalMinSpeechLikeMs)
  const partialMin = Number(asr.partialMinSpeechLikeMs)
  const evalMinMs = Number(cfg.silentDegradeEvalMinMs)
  return {
    recoveryMs: recoveryMs > 0 ? recoveryMs : LOCAL_FALLBACK_DEFAULTS.localRecoveryMs,
    recoverySegments:
      recoverySegments > 0 ? Math.floor(recoverySegments) : LOCAL_FALLBACK_DEFAULTS.localRecoverySegments,
    probeMs: probeMs > 0 ? probeMs : LOCAL_FALLBACK_DEFAULTS.localRecoveryProbeMs,
    evalMinMs: evalMinMs > 0 ? evalMinMs : LOCAL_FALLBACK_DEFAULTS.silentDegradeEvalMinMs,
    finalMinSpeechLikeMs: finalMin > 0 ? finalMin : LOCAL_FALLBACK_DEFAULTS.finalMinSpeechLikeMs,
    partialMinSpeechLikeMs: partialMin > 0 ? partialMin : LOCAL_FALLBACK_DEFAULTS.partialMinSpeechLikeMs,
  }
}

/**
 * Decide si el resultado de un motor LOCAL se emite o se descarta por falta de
 * evidencia acustica de habla.
 *
 * La evidencia es `metrics` (la mide el motor sobre el audio transcrito). Sin
 * `metrics` NO se decide (se conserva): no se inventa un descarte sin medida.
 * Excepcion: la wake manda ("ok flu" corto se conserva) y un comando de
 * navegacion reconocido tambien; los aporta el llamador con sus duenos
 * (`analyzeWakeTurn` / `resolveNavigationCommand`).
 *
 * DECISION DE PRODUCTO (2026-10-21, opcion "a"): se mantiene el umbral ABSOLUTO
 * en ms. Medido sobre el audio real de la sesion d4c1c8f3, dentro de turnos
 * reales, ventanas de 500 ms dan speech-like p25=90 ms (17/36 bajo 180): una
 * minoria de habla MUY corta se descarta. Se acepta el borde; no se baja el
 * umbral para taparlo y no hay lista negra de frases.
 *
 * ALCANCE: "el audio parece habla", NO "habla dirigida a FLU": la voz de fondo
 * (TV/sala) pasa el gate. Separarla es criterio de HABLANTE (diarizacion).
 *
 * @param {{ isFinal?: boolean, metrics?: { speechLikeMs?: number }|null, wakeMatched?: boolean, isNavigationCommand?: boolean }} [m]
 * @returns {{ keep: boolean, reason: 'not-speech'|null, speechLikeMs: number, threshold: number }}
 */
export function classifyLocalResult({ isFinal = true, metrics = null, wakeMatched = false, isNavigationCommand = false } = {}) {
  const cfg = getLocalFallbackRuntimeConfig()
  const threshold = isFinal ? cfg.finalMinSpeechLikeMs : cfg.partialMinSpeechLikeMs
  const speechLikeMs = Number(metrics?.speechLikeMs) || 0
  if (!metrics) return { keep: true, reason: null, speechLikeMs, threshold }
  if (speechLikeMs >= threshold || wakeMatched || isNavigationCommand) {
    return { keep: true, reason: null, speechLikeMs, threshold }
  }
  return { keep: false, reason: 'not-speech', speechLikeMs, threshold }
}

/**
 * Registra el descarte de un resultado LOCAL sin habla por el dueno unico: un
 * FINAL es una locucion (`discardLocution`, motivo en vocabulario cerrado); un
 * PARCIAL no abre fila, pero su descarte tambien deja motivo.
 *
 * @param {{ decision?: { keep: boolean, speechLikeMs: number, threshold: number }, phrase?: string, isFinal?: boolean, log?: Function }} m
 * @returns {boolean} `true` si el resultado se descarto (el llamador debe saltarlo).
 */
export function reportLocalResultGate({ decision, phrase = '', isFinal = true, log } = {}) {
  if (!decision || decision.keep) return false
  const clip = String(phrase || '').slice(0, 80)
  if (isFinal) {
    discardLocution({ reason: DISCARD_REASONS.NOT_SPEECH, phrase, site: 'onresult', log })
    return true
  }
  if (typeof log === 'function') {
    log(
      'WARN',
      'useFluVoiceAssistant',
      `parcial DESCARTADO motivo=${DISCARD_REASONS.NOT_SPEECH} site=onresult speechLikeMs=${Math.round(decision.speechLikeMs)}<${Math.round(decision.threshold)} "${clip}"`,
    )
  }
  return true
}

/**
 * Decide si el SR VIVO pero MUDO debe degradar al motor local.
 *
 * Tres condiciones, no una: (1) la ventana larga sin resultados del reconocedor,
 * (2) HABLA medida con el VAD speech-like (no solo RMS) y (3) `failedRebuilds`
 * rebuilds de Chrome ya intentados sin resultado. Silencio o ruido con SR mudo
 * NO degradan: es la pausa normal de una conversacion.
 *
 * @param {{ sinceSrResultMs: number, speechLikeMs: number, failedRebuilds: number }} m
 * @returns {boolean} `true` para degradar al motor local.
 */
export function shouldDegradeSilentRecognition({ sinceSrResultMs, speechLikeMs, failedRebuilds }) {
  const cfg = getSilentDegradeConfig()
  return (
    Number(sinceSrResultMs) >= cfg.silentMs &&
    Number(speechLikeMs) >= cfg.minSpeechLikeMs &&
    Number(failedRebuilds) >= cfg.rebuilds
  )
}

/** Motor local precalentado (uno solo), listo para el swap. */
let prewarmedEngine = null

/**
 * PRECALIENTA el motor local SIN activarlo: crea el engine y encarga la carga
 * del modelo Whisper mientras el reconocedor principal escucha, de modo que la
 * degradacion cambie a un motor ya listo. La grabacion 45aeb8e2 perdio su
 * primera frase porque el modelo cargaba justo en el swap (primer final 29 s
 * despues de degradar). Idempotente.
 *
 * @returns {boolean} `true` si hay un motor precalentado esperando el swap.
 */
export function prewarmLocalRecognition() {
  if (prewarmedEngine) return true
  prewarmedEngine = createWhisperRecognitionEngine({ sampleRate: DEFAULT_SAMPLE_RATE })
  if (!prewarmedEngine) return false
  prewarmedEngine.preload?.()
  return true
}

/**
 * PREDICADO UNICO de "este reconocedor es el motor LOCAL".
 *
 * El marcador es `pushAudio` (el contrato offline acepta PCM), declarado UNA vez
 * aqui: lo usan el swap (degradacion y recuperacion), el hook (tag `engine` y
 * gate de resultados) y este modulo. No hay latch ni segunda copia del test
 * `typeof recognitionRef.current?.pushAudio === 'function'`.
 *
 * @param {any} engine reconocedor activo (Chrome o local).
 * @returns {boolean}
 */
export function isLocalRecognitionEngine(engine) {
  return typeof engine?.pushAudio === 'function'
}

/**
 * Crea (o ENTREGA el precalentado) motor local de reconocimiento (Whisper WASM
 * + VAD) para el fallback OFFLINE. Es DROP-IN del contrato de Chrome
 * SpeechRecognition (`onstart/onresult/onerror/onend` + `start/stop/abort`) y,
 * además, acepta PCM por `pushAudio(samples, rate)` para transcribir el mismo
 * audio del micrófono. El hook `useFluVoiceAssistant` lo instancia y lo cablea
 * con los MISMOS handlers del pipeline (una sola salida de transcripción).
 *
 * @returns {ReturnType<typeof createWhisperRecognitionEngine>} motor local.
 */
export function createLocalRecognition() {
  if (prewarmedEngine) {
    const engine = prewarmedEngine
    prewarmedEngine = null
    return engine
  }
  return createWhisperRecognitionEngine({ sampleRate: DEFAULT_SAMPLE_RATE })
}

/**
 * Ejecuta el SWAP al motor local: suelta el reconocedor anterior (handlers y
 * abort/stop) e instala el motor Whisper ya cableado y arrancado. DUENO UNICO de
 * la mecanica de degradacion; el hook solo aporta los refs y el cableado.
 *
 * @param {{ previous: any, wire: (engine: any) => void }} args
 *   `previous` reconocedor activo (Chrome SR o null); `wire` cablea los eventos
 *   del pipeline sobre el motor nuevo (UNA sola salida de transcripcion).
 * @returns {any|null} el motor local instalado, o `null` si `previous` YA era local.
 */
export function installLocalRecognition({ previous, wire }) {
  if (isLocalRecognitionEngine(previous)) return null
  releaseRecognition(previous)
  const localEngine = createLocalRecognition()
  if (!localEngine) return null
  if (typeof wire === 'function') wire(localEngine)
  localEngine.start()
  return localEngine
}

/**
 * Ejecuta el SWAP a Chrome (RECUPERACION): suelta el motor local y arranca un
 * reconocedor online ya cableado.
 *
 * CONTRATO (una sola forma de no dejar la escucha muerta):
 *   - `null`                => no aplica (previous ya era Chrome) o Chrome no se
 *                              pudo crear: el motor activo NO se toco.
 *   - `{ ok: true, recognition }`           => Chrome instalado y arrancado.
 *   - `{ ok: false, fallback }`             => Chrome creado pero NO arranco: se
 *                              restauro el motor local (mismo cableado) y el
 *                              llamador debe apuntar su ref a `fallback`.
 *
 * Que Chrome "sirve" se mide por un RESULTADO dentro de `probeMs`; ese reloj lo
 * lleva el hook (watchdog), no este modulo.
 *
 * @param {{ previous: any, create: () => any, wire: (engine: any) => void, start: (engine: any) => boolean }} args
 * @returns {null | { ok: true, recognition: any } | { ok: false, fallback: any }}
 */
export function installChromeRecognition({ previous, create, wire, start }) {
  if (!isLocalRecognitionEngine(previous)) return null
  const recognition = typeof create === 'function' ? create() : null
  if (!recognition) return null
  releaseRecognition(previous)
  if (typeof wire === 'function') wire(recognition)
  const started = typeof start === 'function' ? start(recognition) : true
  if (!started) {
    // Chrome no arranca: se restaura el local con el MISMO cableado. Nunca se
    // deja la escucha sin motor (dos activos tampoco: el Chrome fallido se suelta).
    const local = installLocalRecognition({ previous: recognition, wire })
    return local ? { ok: false, fallback: local } : null
  }
  return { ok: true, recognition }
}

/**
 * Suelta un reconocedor (handlers + abort/stop) antes de instalar otro. DUENO
 * UNICO del desmontaje: lo usan la degradacion a local y la recuperacion a
 * Chrome, de modo que nunca haya dos motores activos a la vez.
 *
 * @param {any} previous reconocedor a soltar (puede ser null).
 * @returns {void}
 */
function releaseRecognition(previous) {
  if (!previous) return
  previous.onstart = null
  previous.onresult = null
  previous.onerror = null
  previous.onend = null
  try {
    if (typeof previous.abort === 'function') previous.abort()
    else previous.stop?.()
  } catch (e) {
    // El reconocedor anterior puede estar ya muerto: se registra y el swap sigue.
    logCaughtError('[catch] src/voice/lib/voiceLocalFallback.js', e, e?.stack)
  }
}

/**
 * Resuelve el degrade-check del watchdog: mide la HABLA (no solo energia) del
 * micro en la ventana con `countSpeechLikeSamplesInBlocks` (VAD dueno unico) y
 * decide con `shouldDegradeSilentRecognition`. El reloj es el de RESULTADOS del
 * SR (los rebuilds NO lo reinician); `failedRebuilds` lo aporta el watchdog.
 *
 * @param {{ chunks: any[], sampleRate: number, now: number, lastSrResultAt: number, eligibleSince: number, failedRebuilds?: number }} m
 * @returns {{ degrade: boolean, speechLikeMs: number, rms: number, voicedMs: number, sinceSrResultMs: number, failedRebuilds: number, log: string }}
 */
export function resolveSilentDegrade({ chunks, sampleRate, now, lastSrResultAt, eligibleSince, failedRebuilds = 0 }) {
  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : DEFAULT_SAMPLE_RATE
  const cfg = getSilentDegradeConfig()
  const sinceSrResultMs = Number(now) - Math.max(Number(lastSrResultAt) || 0, Number(eligibleSince) || 0)
  const speechLike = countSpeechLikeSamplesInBlocks(chunks, { sampleRate: rate, windowMs: cfg.silentMs })
  const speechLikeMs = (speechLike / Math.max(1, rate)) * 1000
  // Energia cruda de la MISMA ventana: se registra para distinguir "silencio" de
  // "ruido fuerte que no es habla" sin volver a decidir con ella.
  const rms = rmsOfBlocks(chunks, { sampleRate: rate, windowMs: cfg.silentMs })
  const voicedMs = (countVoicedSamplesInBlocks(chunks, { sampleRate: rate, windowMs: cfg.silentMs }) / Math.max(1, rate)) * 1000
  const rebuilds = Math.max(0, Math.floor(Number(failedRebuilds) || 0))
  const degrade = shouldDegradeSilentRecognition({ sinceSrResultMs, speechLikeMs, failedRebuilds: rebuilds })
  return {
    degrade,
    speechLikeMs,
    rms,
    voicedMs,
    sinceSrResultMs,
    failedRebuilds: rebuilds,
    log: `[REC] degrade: SR mudo ${Math.round(sinceSrResultMs / 1000)}s con HABLA en PCM (${Math.round(speechLikeMs)}ms, rms=${rms.toFixed(3)}) tras ${rebuilds} rebuilds -> motor local Whisper`,
  }
}
