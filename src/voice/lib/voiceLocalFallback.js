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
 * Crea el motor local de reconocimiento (Whisper WASM + VAD) para el fallback
 * OFFLINE. Es DROP-IN del contrato de Chrome SpeechRecognition
 * (`onstart/onresult/onerror/onend` + `start/stop/abort`) y, además, acepta
 * PCM por `pushAudio(samples, rate)` para transcribir el mismo audio del
 * micrófono. El hook `useFluVoiceAssistant` lo instancia y lo cablea con los
 * MISMOS handlers del pipeline (una sola salida de transcripción).
 *
 * @returns {ReturnType<typeof createWhisperRecognitionEngine>} motor local.
 */
export function createLocalRecognition() {
  return createWhisperRecognitionEngine({ sampleRate: DEFAULT_SAMPLE_RATE })
}
