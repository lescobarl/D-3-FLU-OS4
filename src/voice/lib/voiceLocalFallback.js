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
import { countVoicedSamplesInBlocks } from './voicedActivity.js'
import { logCaughtError } from '../../lib/caughtError'

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

/**
 * Config de la degradacion por SR MUDO (caso 45aeb8e2): Chrome SR vivo, sin
 * errores y sin resultados durante 142 s de habla real, mientras el PCM del
 * micro tenia voz. El watchdog reconstruia Chrome en bucle y la transcripcion
 * se perdia entera. Ventana y piso de voz viven en la MISMA config que
 * `fallbackErrors` (`voiceIdentity.capture.recognition`).
 *
 * @returns {{ silentMs: number, minVoicedMs: number }}
 */
export function getSilentDegradeConfig() {
  const cfg = FLU_CONFIG.voiceIdentity?.capture?.recognition || {}
  const silentMs = Number(cfg.silentDegradeMs)
  const minVoicedMs = Number(cfg.silentDegradeMinVoicedMs)
  return {
    silentMs: silentMs > 0 ? silentMs : 3500,
    minVoicedMs: minVoicedMs > 0 ? minVoicedMs : 400,
  }
}

/**
 * Decide si un SR VIVO pero MUDO debe degradar al motor local: el reconocedor
 * no ha producido resultados durante `silentMs` (reloj de RESULTADOS, que los
 * rebuilds de Chrome NO reinician) y el PCM del micro tiene al menos
 * `minVoicedMs` de voz. Silencio real con SR mudo NO degrada: es la pausa
 * normal de una conversacion.
 *
 * @param {{ sinceSrResultMs: number, voicedMs: number }} m
 *   `sinceSrResultMs` ms desde el ULTIMO resultado del reconocedor;
 *   `voicedMs` ms de voz medida en la ventana PCM (VAD dueno unico).
 * @returns {boolean} `true` para degradar al motor local.
 */
export function shouldDegradeSilentRecognition({ sinceSrResultMs, voicedMs }) {
  const cfg = getSilentDegradeConfig()
  return Number(sinceSrResultMs) >= cfg.silentMs && Number(voicedMs) >= cfg.minVoicedMs
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
  if (typeof previous?.pushAudio === 'function') return null
  if (previous) {
    previous.onstart = null
    previous.onresult = null
    previous.onerror = null
    previous.onend = null
    try {
      if (typeof previous.abort === 'function') previous.abort()
      else previous.stop()
    } catch (e) {
      // El reconocedor anterior puede estar ya muerto: se registra y el swap sigue.
      logCaughtError('[catch] src/voice/lib/voiceLocalFallback.js', e, e?.stack)
    }
  }
  const localEngine = createLocalRecognition()
  if (!localEngine) return null
  if (typeof wire === 'function') wire(localEngine)
  localEngine.start()
  return localEngine
}

/**
 * Resuelve el degrade-check del watchdog: mide la VOZ del micro en la ventana
 * (`countVoicedSamplesInBlocks`, VAD dueno unico) y decide con
 * `shouldDegradeSilentRecognition`. El reloj es el de RESULTADOS del SR (los
 * rebuilds NO lo reinician) con el piso de elegibilidad de la sesion.
 *
 * @param {{ chunks: any[], sampleRate: number, now: number, lastSrResultAt: number, eligibleSince: number }} m
 * @returns {{ degrade: boolean, voicedMs: number, sinceSrResultMs: number, log: string }}
 */
export function resolveSilentDegrade({ chunks, sampleRate, now, lastSrResultAt, eligibleSince }) {
  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : DEFAULT_SAMPLE_RATE
  const sinceSrResultMs = Number(now) - Math.max(Number(lastSrResultAt) || 0, Number(eligibleSince) || 0)
  const voiced = countVoicedSamplesInBlocks(chunks, { sampleRate: rate, windowMs: getSilentDegradeConfig().silentMs })
  const voicedMs = (voiced / Math.max(1, rate)) * 1000
  return {
    degrade: shouldDegradeSilentRecognition({ sinceSrResultMs, voicedMs }),
    voicedMs,
    sinceSrResultMs,
    log: `[REC] degrade: SR mudo ${Math.round(sinceSrResultMs / 1000)}s con voz en PCM (${Math.round(voicedMs)}ms) -> motor local Whisper`,
  }
}
