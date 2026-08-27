/**
 * Lógica compartida WebSocket STT (servidor standalone y plugin Vite).
 */
import { WebSocketServer } from 'ws'
import { buildStatusMessage, STREAM_STT_MSG } from '../src/lib/streamStt/protocol.js'
import { createMockStreamSttProvider } from './providers/mockProvider.mjs'
import { createDeepgramStreamSttProvider } from './providers/deepgramProvider.mjs'
import { resolveStreamSttProviderName } from './streamSttResolver.js'

// Re-export para preservar el contrato de importación de streamSttServer.mjs
export { resolveStreamSttProviderName }

function sendJson(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj))
  }
}

export function createStreamSttProvider(ws, env = process.env) {
  const providerName = resolveStreamSttProviderName(env)

  const sendTranscript = ({ text, final, partial }) => {
    sendJson(ws, {
      type: STREAM_STT_MSG.TRANSCRIPT,
      text,
      final,
      partial,
    })
  }

  if (providerName === 'deepgram') {
    const dg = createDeepgramStreamSttProvider({
      apiKey: env.DEEPGRAM_API_KEY || '',
    })
    return {
      providerName,
      provider: {
        async onConfig(cfg) {
          await dg.onConfig(cfg, (msg) => ws.send(msg))
        },
        onAudio: (buf) => dg.onAudio(buf),
        onSimulate: () => {},
        close: () => dg.close(),
      },
    }
  }

  const mock = createMockStreamSttProvider({
    utteranceSilenceMs: Number(env.FLU_STT_SILENCE_MS) || 1200,
    minVoicedRms: Number(env.FLU_STT_MIN_RMS) || 0.004,
  })
  return {
    providerName,
    provider: {
      onConfig: (cfg) => mock.onConfig(cfg),
      onAudio: (buf) => mock.onAudio(buf, sendTranscript),
      onSimulate: (events) => mock.onSimulate(events, sendTranscript),
      close: () => mock.close(),
    },
  }
}

export function handleStreamSttWebSocket(ws, env = process.env) {
  const { provider, providerName } = createStreamSttProvider(ws, env)

  sendJson(
    ws,
    buildStatusMessage({
      state: 'connected',
      provider: providerName,
      detail: 'flu-stream-stt',
    }),
  )

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      provider.onAudio(data)
      return
    }
    try {
      const msg = JSON.parse(String(data))
      if (msg.type === STREAM_STT_MSG.CONFIG) {
        void provider.onConfig(msg)
        return
      }
      if (msg.type === STREAM_STT_MSG.SIMULATE && Array.isArray(msg.events)) {
        provider.onSimulate(msg.events)
      }
    } catch {
      sendJson(ws, { type: STREAM_STT_MSG.ERROR, message: 'invalid_json' })
    }
  })

  ws.on('close', () => provider.close())
  return { providerName }
}

/**
 * @param {import('node:http').Server} httpServer
 * @param {{ path?: string | null, env?: NodeJS.ProcessEnv }} [options]
 *   path=null → acepta cualquier upgrade (puerto dedicado 8787).
 *   path='/stream-stt' → solo esa ruta (Vite dev).
 */
export function attachStreamSttWebSocket(httpServer, { path = null, env = process.env } = {}) {
  const providerName = resolveStreamSttProviderName(env)

  if (path) {
    const wss = new WebSocketServer({ noServer: true })
    wss.on('connection', (ws) => handleStreamSttWebSocket(ws, env))

    const onUpgrade = (request, socket, head) => {
      let pathname = ''
      try {
        pathname = new URL(request.url || '/', 'http://localhost').pathname
      } catch {
        return
      }
      if (pathname !== path) return
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
    // Antes que el handler HMR de Vite (si no, rechaza rutas desconocidas).
    if (typeof httpServer.prependListener === 'function') {
      httpServer.prependListener('upgrade', onUpgrade)
    } else {
      httpServer.on('upgrade', onUpgrade)
    }
    return { wss, providerName, path }
  }

  const wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', (ws) => handleStreamSttWebSocket(ws, env))
  return { wss, providerName, path: null }
}
