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
 * transcripción siga teniendo UNA sola salida: los parciales y finales del motor
 * local caen en el mismo `onresult` del hook que alimenta al módulo de
 * conversación (y a la caja de la frase en modo pasivo). Aquí no se crea
 * ni se duplica ningún motor: solo se decide CUÁNDO degradar.
 */
import { FLU_CONFIG } from './fluConfig.js'
import { createWhisperRecognitionEngine } from './asr/whisperRecognitionEngine.js'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { countSpeechLikeSamplesInBlocks, countVoicedSamplesInBlocks, rmsOfBlocks } from './voicedActivity.js'
import { logCaughtError } from '../../lib/caughtError'
import { DISCARD_REASONS, discardLocution } from './phraseDiscard.js'
import { LOCAL_FALLBACK_DEFAULTS, LOCAL_FINAL_DEFAULTS } from './asr/asrDefaults.js'
import { collapseRepeatedSpeech } from './speechMerge.js'

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
    // Racha de reinicios SIN un solo final que prueba motor VIVO y MUDO.
    deadRebuilds:
      Number(cfg.silentDegradeDeadRebuilds) > 0
        ? Math.max(1, Math.floor(Number(cfg.silentDegradeDeadRebuilds)))
        : LOCAL_FALLBACK_DEFAULTS.silentDegradeDeadRebuilds,
    minSpeechLikeMs:
      minSpeechLikeMs > 0 ? minSpeechLikeMs : LOCAL_FALLBACK_DEFAULTS.silentDegradeMinSpeechLikeMs,
    stallMs,
  }
}

/**
 * Config de recuperacion (Chrome se reintenta con el motor local activo), del
 * gate de resultados locales y del DISPARADOR del respaldo por tramo. Un solo
 * lector de transcript.localFinal: la puerta y el modulo consumen la MISMA
 * config, cada uno su mitad (aqui no se decide nada, solo se lee).
 *
 * @returns {{ recoveryMs: number, recoverySegments: number, probeMs: number, evalMinMs: number, finalMinSpeechLikeMs: number, partialMinSpeechLikeMs: number, enabled: boolean, timeoutMs: number, sidecarUrl: string, sidecarProbeMs: number, minPalabras: number, minPalabrasPorSegundo: number, minVozMs: number, minAudioSegundos: number, maxPalabrasPorSegundo: number, minPalabrasUnicasRatio: number }}
 */
export function getLocalFallbackRuntimeConfig() {
  const cfg = FLU_CONFIG.voiceIdentity?.capture?.recognition || {}
  const asr = FLU_CONFIG.transcript?.asr || {}
  const local = FLU_CONFIG.transcript?.localFinal || {}
  const recoveryMs = Number(cfg.localRecoveryMs)
  const recoverySegments = Number(cfg.localRecoverySegments)
  const probeMs = Number(cfg.localRecoveryProbeMs)
  const finalMin = Number(asr.finalMinSpeechLikeMs)
  const partialMin = Number(asr.partialMinSpeechLikeMs)
  const evalMinMs = Number(cfg.silentDegradeEvalMinMs)
  // Umbrales del RESPALDO POR TRAMO: una sola fuente, transcript.localFinal.
  const minPalabras = Number(local.minPalabras)
  const minPorSegundo = Number(local.minPalabrasPorSegundo)
  const minVozMs = Number(local.minVozMs)
  const minAudio = Number(local.minAudioSegundos)
  const maxPorSegundo = Number(local.maxPalabrasPorSegundo)
  const ratioUnicas = Number(local.minPalabrasUnicasRatio)
  const timeoutMs = Number(local.timeoutMs)
  const sidecarProbeMs = Number(local.sidecarProbeMs)
  // Sin URL no se inventa endpoint: el cliente del sidecar responde «no
  // disponible» y la fila se queda con Chrome (el valor literal vive en
  // `fluConfig.js`; este lector solo lo proyecta).
  const sidecarUrl = String(local.sidecarUrl || '')
  return {
    recoveryMs: recoveryMs > 0 ? recoveryMs : LOCAL_FALLBACK_DEFAULTS.localRecoveryMs,
    recoverySegments:
      recoverySegments > 0 ? Math.floor(recoverySegments) : LOCAL_FALLBACK_DEFAULTS.localRecoverySegments,
    probeMs: probeMs > 0 ? probeMs : LOCAL_FALLBACK_DEFAULTS.localRecoveryProbeMs,
    evalMinMs: evalMinMs > 0 ? evalMinMs : LOCAL_FALLBACK_DEFAULTS.silentDegradeEvalMinMs,
    finalMinSpeechLikeMs: finalMin > 0 ? finalMin : LOCAL_FALLBACK_DEFAULTS.finalMinSpeechLikeMs,
    partialMinSpeechLikeMs: partialMin > 0 ? partialMin : LOCAL_FALLBACK_DEFAULTS.partialMinSpeechLikeMs,
    enabled: local.enabled === true,
    timeoutMs: timeoutMs > 0 ? timeoutMs : LOCAL_FINAL_DEFAULTS.timeoutMs,
    sidecarUrl,
    sidecarProbeMs:
      sidecarProbeMs > 0 ? sidecarProbeMs : LOCAL_FINAL_DEFAULTS.sidecarProbeMs,
    minPalabras: minPalabras > 0 ? Math.floor(minPalabras) : LOCAL_FINAL_DEFAULTS.minPalabras,
    minPalabrasPorSegundo:
      minPorSegundo > 0 ? minPorSegundo : LOCAL_FINAL_DEFAULTS.minPalabrasPorSegundo,
    minVozMs: minVozMs > 0 ? minVozMs : LOCAL_FINAL_DEFAULTS.minVozMs,
    minAudioSegundos:
      Number.isFinite(minAudio) && minAudio >= 0
        ? minAudio
        : LOCAL_FINAL_DEFAULTS.minAudioSegundos,
    maxPalabrasPorSegundo:
      maxPorSegundo > 0 ? maxPorSegundo : LOCAL_FINAL_DEFAULTS.maxPalabrasPorSegundo,
    minPalabrasUnicasRatio:
      ratioUnicas > 0 && ratioUnicas <= 1 ? ratioUnicas : LOCAL_FINAL_DEFAULTS.minPalabrasUnicasRatio,
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
 * RESPALDO POR TRAMO (docs/CONTRATO-ASR-LOCAL.md §6): cuando el llamador aporta
 * la evidencia del tramo CERRADO (`vozMs`, `text`, `audioSeconds`), la puerta se
 * amplia en el MISMO dueno con la evidencia que el modulo ya mide:
 *   1. voz real del tramo (`vozMs >= minVozMs`): sin voz no hay texto aceptable
 *      (el hueco 67-95 s de b6d82bca midio 120 ms y «Back to the cojo» no entra);
 *   2. silencio/no-habla (`speechLikeMs` del tramo, umbral ya existente);
 *   3. duracion plausible (`maxPalabrasPorSegundo`): texto imposible se rechaza;
 *   4. repeticion/bucle (`collapseRepeatedSpeech`, dueno de `speechMerge`):
 *      un decoder en bucle reduce las palabras unicas por debajo del ratio;
 *   5. idioma/escritura: con idioma latino configurado (es/en), un texto sin una
 *      sola letra latina es de otro idioma y se rechaza.
 * La confianza del decoder (`avg_logprob`) NO viaja por el contrato actual del
 * worker; la puerta se limita a la evidencia acustica MEDIDA, nunca a la fe.
 *
 * @param {{ isFinal?: boolean, metrics?: { speechLikeMs?: number }|null, wakeMatched?: boolean, isNavigationCommand?: boolean, vozMs?: number|null, text?: string, audioSeconds?: number }} [m]
 * @returns {{ keep: boolean, reason: 'sin-voz'|'not-speech'|'sin-texto'|'imposible'|'bucle'|'idioma'|null, speechLikeMs: number, threshold: number, vozMs: number|null }}
 */
export function classifyLocalResult({
  isFinal = true,
  metrics = null,
  wakeMatched = false,
  isNavigationCommand = false,
  vozMs = null,
  text = '',
  audioSeconds = 0,
} = {}) {
  const cfg = getLocalFallbackRuntimeConfig()
  const threshold = isFinal ? cfg.finalMinSpeechLikeMs : cfg.partialMinSpeechLikeMs
  const speechLikeMs = Number(metrics?.speechLikeMs) || 0
  const voz = vozMs === null || vozMs === undefined ? null : Math.max(0, Number(vozMs) || 0)
  const minVozMs = Number(cfg.minVozMs) > 0 ? Number(cfg.minVozMs) : LOCAL_FINAL_DEFAULTS.minVozMs
  // 1) VOZ REAL del tramo: es la primera puerta del respaldo. Sin voz no se
  // transcribe y sin voz no se acepta NADA (mejor `sinTexto` que alucinar).
  if (voz !== null && voz < minVozMs) {
    return { keep: false, reason: 'sin-voz', speechLikeMs, threshold, vozMs: voz }
  }
  if (!metrics) return { keep: true, reason: null, speechLikeMs, threshold, vozMs: voz }
  if (speechLikeMs < threshold && !wakeMatched && !isNavigationCommand) {
    return { keep: false, reason: 'not-speech', speechLikeMs, threshold, vozMs: voz }
  }
  // Sin evidencia de tramo (ruta del motor vivo) el gate termina aqui: su
  // contrato no cambia (wake/navegacion mandan; sin `metrics` no se decide).
  if (voz === null) return { keep: true, reason: null, speechLikeMs, threshold, vozMs: voz }
  const limpio = String(text || '').trim()
  if (!limpio) return { keep: false, reason: 'sin-texto', speechLikeMs, threshold, vozMs: voz }
  const palabras = limpio.split(/\s+/).filter(Boolean).length
  const segundos = Number(audioSeconds) > 0 ? Number(audioSeconds) : 0
  // 3) Duracion plausible: mas palabras que las humanamente posibles.
  if (segundos > 0 && palabras / segundos > cfg.maxPalabrasPorSegundo) {
    return { keep: false, reason: 'imposible', speechLikeMs, threshold, vozMs: voz }
  }
  // 4) Repeticion/bucle: el colapso del dueno mide cuantas palabras sobreviven.
  const colapsado = collapseRepeatedSpeech(limpio)
  const unicas = colapsado ? colapsado.split(/\s+/).filter(Boolean).length : 0
  if (palabras > 0 && unicas / palabras < cfg.minPalabrasUnicasRatio) {
    return { keep: false, reason: 'bucle', speechLikeMs, threshold, vozMs: voz }
  }
  // 5) Idioma/escritura: es/en son latinos; un texto sin letras latinas es otro
  // idioma (no hay detector de idioma sin otro motor; esto es lo medible).
  if (!/[a-záéíóúüñç]/i.test(limpio)) {
    return { keep: false, reason: 'idioma', speechLikeMs, threshold, vozMs: voz }
  }
  return { keep: true, reason: null, speechLikeMs, threshold, vozMs: voz }
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
  // La ventana larga es la puerta de siempre: sin ella no se degrada nada.
  if (!(Number(sinceSrResultMs) >= cfg.silentMs)) return false
  // MOTOR VIVO Y MUDO (medido en la sesión real d702: 13 reinicios seguidos sin
  // un solo `asrFinal`): el reconocedor no vuelve por sí mismo y la evidencia de
  // habla no puede exigirse — el silencio del micro es indistinguible del habla
  // que Chrome ya no entrega. Con la racha medida se escala al motor local.
  if (Number(failedRebuilds) >= cfg.deadRebuilds) return true
  return (
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
