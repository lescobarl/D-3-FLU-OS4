/**
 * Servidor WebSocket STT standalone (puerto 8787).
 * En desarrollo normal basta `npm run dev` (plugin Vite en /stream-stt).
 * Uso: node server/streamSttServer.mjs
 * Env: DEEPGRAM_API_KEY (opcional), FLU_STT_PROVIDER=mock|deepgram, PORT=8787
 */
import 'dotenv/config'
import http from 'node:http'
import { attachStreamSttWebSocket, resolveStreamSttProviderName } from './streamSttHandler.mjs'

const PORT = Number(process.env.PORT) || 8787
const providerName = resolveStreamSttProviderName(process.env)

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      service: 'flu-stream-stt',
      provider: providerName,
      deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    }),
  )
})

attachStreamSttWebSocket(server, { path: null, env: process.env })

server.listen(PORT, () => {
  console.info(`[flu-stream-stt] listening on :${PORT} provider=${providerName}`)
})
