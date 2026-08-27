import { FLU_CONFIG } from './fluConfig.js'
import { STREAM_STT_DEV_URL } from '../../core/config/appConfig'

export function getTranscriptConfig(config = FLU_CONFIG) {
  return config.transcript || {}
}

export function getStreamSttConfig(config = FLU_CONFIG) {
  return config.streamStt || {}
}

/** browser | stream | hybrid */
export function getTranscriptSource(config = FLU_CONFIG) {
  return getTranscriptConfig(config).source || 'browser'
}

export function usesStreamSttPipeline(config = FLU_CONFIG) {
  const source = getTranscriptSource(config)
  return source === 'stream' || source === 'hybrid'
}

export function shouldRunBrowserRecognition(config = FLU_CONFIG) {
  const source = getTranscriptSource(config)
  if (source === 'stream') {
    return getTranscriptConfig(config).commandsFromBrowser !== false
  }
  return true
}

export function getStreamTranscriptProviders(config = FLU_CONFIG) {
  const list = getTranscriptConfig(config).streamTranscriptProviders
  return Array.isArray(list) && list.length ? list : ['deepgram']
}

/** Proveedor con ASR real (no mock de VAD). */
export function isRealStreamTranscriptProvider(provider = '', config = FLU_CONFIG) {
  const name = String(provider || '').trim().toLowerCase()
  if (!name || name === 'mock') return false
  return getStreamTranscriptProviders(config).includes(name)
}

/**
 * Hybrid: si el stream está conectado pero es mock, Chrome sigue llevando la conversación.
 */
export function shouldIngestBrowserConversation(
  config = FLU_CONFIG,
  streamConnected = false,
  streamProvider = '',
) {
  const transcript = getTranscriptConfig(config)
  const source = getTranscriptSource(config)
  if (source === 'browser') return true
  if (source === 'stream') return !streamConnected || !isRealStreamTranscriptProvider(streamProvider)
  if (transcript.conversationFromStream === false) return true
  if (!streamConnected) return true
  return !isRealStreamTranscriptProvider(streamProvider)
}

/** Texto del WS STT → log / última frase (solo proveedores reales). */
export function shouldIngestStreamTranscript(
  config = FLU_CONFIG,
  streamConnected = false,
  streamProvider = '',
) {
  if (!shouldIngestStreamConversation(config)) return false
  if (!streamConnected) return false
  const source = getTranscriptSource(config)
  if (source === 'browser') return false
  return isRealStreamTranscriptProvider(streamProvider)
}

export function shouldIngestStreamConversation(config = FLU_CONFIG) {
  const source = getTranscriptSource(config)
  return source === 'stream' || source === 'hybrid'
}

/** Etiqueta y clase UI para chip STT. Modo browser = solo Chrome SR. */
export function formatStreamSttUiStatus(
  status = '',
  { listening = false, transcriptSource = getTranscriptSource() } = {},
) {
  if (!listening) {
    return { label: 'STT off', tone: 'fallback' }
  }
  if (transcriptSource === 'browser') {
    return { label: 'Chrome SR', tone: 'ok' }
  }
  const raw = String(status || '').trim()
  if (!raw) {
    return { label: 'STT ON', tone: 'ok' }
  }
  if (raw.startsWith('connected')) {
    const provider = raw.replace(/^connected:?/, '').trim().split(':')[0] || 'on'
    const label = provider === 'mock' ? 'STT mock · Chrome' : `STT ${provider}`
    return { label, tone: 'ok' }
  }
  if (raw === 'error') {
    return { label: 'STT error', tone: 'error' }
  }
  if (raw === 'chrome-fallback' || raw === 'disconnected' || raw === 'idle') {
    return { label: 'Chrome SR', tone: 'fallback' }
  }
  return { label: raw ? `STT ${raw}` : '', tone: 'fallback' }
}

export function resolveStreamSttWsUrl(config = FLU_CONFIG) {
  const cfg = getStreamSttConfig(config)
  if (cfg.wsUrl) return cfg.wsUrl
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const path = cfg.wsPath || '/stream-stt'
    return `${proto}//${window.location.host}${path}`
  }
  return cfg.devServerUrl || STREAM_STT_DEV_URL
}
