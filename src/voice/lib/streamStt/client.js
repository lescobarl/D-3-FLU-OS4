import { encodePcmChunk } from '../pcmAudio.js'
import { FLU_CONFIG } from '../fluConfig.js'
import { getStreamSttConfig, resolveStreamSttWsUrl } from '../transcriptConfig.js'
import { STREAM_STT_MSG, parseStreamSttMessage } from './protocol.js'
import { logStreamSttText } from '../listenLog.js'

export function createStreamSttClient({
  language = 'es',
  onTranscript = () => {},
  onStatus = () => {},
  onError = () => {},
  config = FLU_CONFIG,
} = {}) {
  const cfg = getStreamSttConfig(config)
  let ws = null
  let connected = false
  let sampleRate = 48000
  let processorAttached = false
  let pcmFeedHandler = null
  let sendAccum = new Int16Array(0)
  const targetRate = Number(cfg.targetSampleRate) || 16000
  const frameSamples = Math.max(320, Math.floor((targetRate * (Number(cfg.chunkMs) || 100)) / 1000))

  function setConnected(value) {
    connected = value
    onStatus({ connected: value, wsUrl: resolveStreamSttWsUrl(config) })
  }

  function sendConfig() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(
      JSON.stringify({
        type: STREAM_STT_MSG.CONFIG,
        language,
        sampleRate: targetRate,
        channels: 1,
        encoding: 'linear16',
      }),
    )
  }

  function flushPcm() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sendAccum.length) return
    ws.send(sendAccum.buffer.slice(sendAccum.byteOffset, sendAccum.byteOffset + sendAccum.byteLength))
    sendAccum = new Int16Array(0)
  }

  function pushPcm(int16) {
    if (!int16?.length) return
    const merged = new Int16Array(sendAccum.length + int16.length)
    merged.set(sendAccum, 0)
    merged.set(int16, sendAccum.length)
    sendAccum = merged
    while (sendAccum.length >= frameSamples) {
      const frame = sendAccum.slice(0, frameSamples)
      sendAccum = sendAccum.slice(frameSamples)
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength))
      }
    }
  }

  function connect() {
    if (typeof WebSocket === 'undefined') {
      onError({ message: 'WebSocket no disponible' })
      return false
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return true
    }
    const url = resolveStreamSttWsUrl(config)
    try {
      ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
    } catch (error) {
      onError({ message: error?.message || 'stream-stt-connect-failed' })
      return false
    }

    ws.onopen = () => {
      setConnected(true)
      sendConfig()
    }

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const msg = parseStreamSttMessage(event.data)
      if (!msg) return
      if (msg.type === STREAM_STT_MSG.TRANSCRIPT) {
        logStreamSttText(msg.text, msg.final)
        onTranscript({
          text: msg.text ?? '',
          isFinal: Boolean(msg.final),
          partial: msg.partial !== false && !msg.final,
        })
        return
      }
      if (msg.type === STREAM_STT_MSG.STATUS) {
        onStatus({
          connected: true,
          state: msg.state,
          provider: msg.provider,
          detail: msg.detail,
        })
        return
      }
      if (msg.type === STREAM_STT_MSG.ERROR) {
        onError({ message: msg.message || 'stream-stt-error' })
      }
    }

    ws.onerror = () => {
      onError({ message: 'stream-stt-socket-error' })
    }

    ws.onclose = () => {
      setConnected(false)
      sendAccum = new Int16Array(0)
      if (!processorAttached) return
      const retryMs = Number(cfg.reconnectMs) || 1500
      window.setTimeout(() => {
        if (!processorAttached) return
        connect()
      }, retryMs)
    }
    return true
  }

  function disconnect() {
    processorAttached = false
    flushPcm()
    if (ws) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
    ws = null
    setConnected(false)
  }

  function attachPcmFeed(onFloat32Block) {
    if (typeof onFloat32Block !== 'function') return
    pcmFeedHandler = onFloat32Block
    processorAttached = true
  }

  function pushPcmFromFloat32(float32) {
    if (!float32?.length) return
    pushPcm(encodePcmChunk(float32, sampleRate, targetRate))
  }

  function attachAudioProcessor(processor, inputSampleRate) {
    if (!processor || processorAttached) return
    sampleRate = inputSampleRate || sampleRate
    const previous = processor.onaudioprocess
    processor.onaudioprocess = (event) => {
      if (previous) previous(event)
      if (!connected) return
      const input = event.inputBuffer.getChannelData(0)
      pushPcmFromFloat32(input)
    }
    processorAttached = true
  }

  function pushPcmInt16(int16) {
    pushPcm(int16)
  }

  return {
    connect,
    disconnect,
    attachAudioProcessor,
    attachPcmFeed,
    pushPcmFromFloat32,
    pushPcmInt16,
    isConnected: () => connected,
    flushPcm,
  }
}
