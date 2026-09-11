import { FLU_CONFIG } from './fluConfig.js'

/**
 * Configuración de transcripción — MOTOR ÚNICO (§9).
 *
 * Ya no existe selector de fuente (`browser`/`stream`/`hybrid`): el transcriptor
 * es uno solo, Whisper WASM on-device, alimentado por el AudioWorklet PCM.
 */
export function getTranscriptConfig(config = FLU_CONFIG) {
  return config.transcript || {}
}

/** Etiqueta UI del motor único de transcripción. */
export function formatStreamSttUiStatus(status = '', { listening = false } = {}) {
  if (!listening) {
    return { label: 'STT off', tone: 'fallback' }
  }
  const raw = String(status || '').trim()
  if (raw === 'error') {
    return { label: 'STT error', tone: 'error' }
  }
  return { label: 'Whisper', tone: 'ok' }
}
