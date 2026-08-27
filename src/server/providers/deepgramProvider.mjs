/**
 * Deepgram live STT (requiere DEEPGRAM_API_KEY en entorno).
 */
import { buildTranscriptMessage, buildStatusMessage, STREAM_STT_MSG } from '../../src/lib/streamStt/protocol.js'

export function createDeepgramStreamSttProvider({ apiKey = '', language = 'es' } = {}) {
  let dgSocket = null
  let sendToClient = () => {}

  function close() {
    if (dgSocket) {
      try {
        dgSocket.close()
      } catch {
        // ignore
      }
    }
    dgSocket = null
  }

  async function onConfig({ language: lang = 'es', sampleRate = 16000 } = {}, send) {
    sendToClient = send
    if (!apiKey) {
      send(
        JSON.stringify(
          buildStatusMessage({
            state: 'unavailable',
            provider: 'deepgram',
            detail: 'missing_api_key',
          }),
        ),
      )
      return false
    }

    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: String(sampleRate),
      channels: '1',
      language: lang.startsWith('en') ? 'en' : 'es',
      punctuate: 'true',
      interim_results: 'true',
      endpointing: '300',
    })

    const { default: WebSocket } = await import('ws')
    dgSocket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
      headers: { Authorization: `Token ${apiKey}` },
    })

    dgSocket.on('open', () => {
      send(
        JSON.stringify(
          buildStatusMessage({ state: 'ready', provider: 'deepgram', detail: 'connected' }),
        ),
      )
    })

    dgSocket.on('message', (data) => {
      try {
        const payload = JSON.parse(String(data))
        const alt = payload?.channel?.alternatives?.[0]
        const text = alt?.transcript || ''
        if (!text) return
        const final = Boolean(payload.is_final)
        send(
          JSON.stringify(
            buildTranscriptMessage({ text, final, partial: !final }),
          ),
        )
      } catch {
        // ignore parse errors
      }
    })

    dgSocket.on('error', () => {
      send(
        JSON.stringify(
          buildStatusMessage({ state: 'error', provider: 'deepgram', detail: 'socket_error' }),
        ),
      )
    })

    dgSocket.on('close', () => {
      send(
        JSON.stringify(
          buildStatusMessage({ state: 'closed', provider: 'deepgram', detail: 'disconnected' }),
        ),
      )
    })
    return true
  }

  function onAudio(buffer) {
    if (dgSocket?.readyState === 1) {
      dgSocket.send(buffer)
    }
  }

  return {
    onConfig,
    onAudio,
    close,
    onSimulate() {},
  }
}
