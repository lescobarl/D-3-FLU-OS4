import { FLU_CONFIG } from './fluConfig.js'

/**
 * Configuración de transcripción — motor de escucha único (Chrome SR).
 *
 * No existe selector de fuente (`browser`/`stream`/`hybrid`): el transcriptor es
 * uno solo (Chrome SpeechRecognition, Google online) y el resto del pipeline es
 * agnóstico al motor.
 */
export function getTranscriptConfig(config = FLU_CONFIG) {
  return config.transcript || {}
}

/** Etiqueta UI del motor de transcripción. */
export function formatStreamSttUiStatus(status = '', { listening = false } = {}) {
  if (!listening) {
    return { label: 'STT off', tone: 'fallback' }
  }
  const raw = String(status || '').trim()
  if (raw === 'error') {
    return { label: 'STT error', tone: 'error' }
  }
  return { label: 'Chrome', tone: 'ok' }
}
