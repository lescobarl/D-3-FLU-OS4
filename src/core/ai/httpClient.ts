// ============================================================
// httpClient.ts — Capa de transporte para los motores de texto IA
// ============================================================
// Wrapper único sobre fetch() que añade un timeout de red real
// (AbortController). Si el proveedor (OpenRouter / Gemini / endpoint
// local) cuelga o corta la conexión TCP, en lugar de dejar la petición
// abierta indefinidamente — lo que el navegador termina abortando como
// TypeError: Failed to fetch y deriva en mensajes engañosos tipo
// "no se pudo contactar al servidor" — aborta a los AI_REQUEST_TIMEOUT_MS
// y normaliza el fallo a un error con { code: 'gemini_timeout', status: 408 }
// que las capas superiores ya saben propagar:
//   - proxy (geminiProxy.ts)   → JSON 408 { code: 'gemini_timeout', ... }
//   - parseGeminiApiResponse   → error.code = 'gemini_timeout'
//   - formatGeminiUserMessage  → mensaje representativo
// ============================================================

import { REQUEST_TIMEOUT_DEFAULTS } from '../config/sharedConfig'

export const AI_REQUEST_DEADLINE_MS = REQUEST_TIMEOUT_DEFAULTS.AI_TEXT_MS

/**
 * Presets de timeout adaptativo por tipo de petición (Fase 1 de optimización
 * de latencia). Se combinan con la carga real de cada petición en
 * resolveRequestTimeout() para devolver un deadline ajustado sin romper las
 * peticiones complejas (documentos / imágenes) que sí necesitan holgura.
 * El valor por defecto (AI_REQUEST_DEADLINE_MS) se mantiene intacto para no
 * alterar el comportamiento de las capas que no usan el resolver.
 */
export const REQUEST_TIMEOUT_PRESETS = Object.freeze({
  /** Conversación / consulta general → respuesta rápida esperada. */
  conversation: REQUEST_TIMEOUT_DEFAULTS.CONVERSATION_MS,
  /** Consulta de minutas → lookups cortos sobre la base local. */
  minutes: REQUEST_TIMEOUT_DEFAULTS.MINUTES_MS,
  /** Documentos / imágenes / peticiones pesadas → fallback al default. */
  complex: REQUEST_TIMEOUT_DEFAULTS.AI_TEXT_MS,
  /** Generación de imagen nativa (Gemini generateContent/predict) → más lenta. */
  image: REQUEST_TIMEOUT_DEFAULTS.IMAGE_MS,
})

/** Umbrales de carga para escalar el timeout por volumen de contexto. */
const HEAVY_HISTORY_THRESHOLD = 12 // >12 turnos de historial = petición pesada
const LONG_TRANSCRIPT_THRESHOLD = 300 // >300 caracteres de transcript = petición pesada

/**
 * Resuelve el timeout de red (ms) para una petición a la API combinando el
 * tipo de petición con su carga real:
 *   - knowledgeMode 'minutes'        → 10s (lookup corto)
 *   - historial largo / transcript largo → 45s (fallback conservador)
 *   - resto                          → 15s (conversación general)
 * La capa cliente puede sumarle un margen para que el techo del navegador
 * supere siempre al deadline real del servidor.
 */
export function resolveRequestTimeout({
  knowledgeMode = 'general',
  historyLength = 0,
  transcriptLength = 0,
} = {}): number {
  if (knowledgeMode === 'minutes') return REQUEST_TIMEOUT_PRESETS.minutes
  if (historyLength > HEAVY_HISTORY_THRESHOLD || transcriptLength > LONG_TRANSCRIPT_THRESHOLD) {
    return REQUEST_TIMEOUT_PRESETS.complex
  }
  return REQUEST_TIMEOUT_PRESETS.conversation
}

export interface TextEngineTimeoutError extends Error {
  code: string
  status: number
  detail: string
}

export function buildTimeoutError(timeoutMs: number, url: string): TextEngineTimeoutError {
  const error = new Error(`Text API timeout (no response within ${timeoutMs}ms)`) as TextEngineTimeoutError
  error.code = 'gemini_timeout'
  error.status = 408
  error.detail = `No response from ${url} within ${timeoutMs}ms`
  return error
}

export async function fetchTextEngine(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = AI_REQUEST_DEADLINE_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) {
      throw buildTimeoutError(timeoutMs, url)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export interface TextEngineNetworkError extends Error {
  code: string
  status: number
  detail: string
  cause?: unknown
}

/** Normaliza un fallo de transporte puro (TypeError: Failed to fetch) a un
 *  error estructurado con { code: 'gemini_network', status: 0 } que la UI ya
 *  sabe presentar — en lugar de propagar el TypeError crudo del navegador. */
export function buildNetworkError(url: string, cause: unknown): TextEngineNetworkError {
  const error = new Error('Failed to fetch') as TextEngineNetworkError
  error.code = 'gemini_network'
  error.status = 0
  error.detail = `Network transport error contacting ${url}: ${String((cause as { message?: string })?.message || cause)}`
  error.cause = cause
  return error
}

function isTransportError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (err && typeof err === 'object') {
    return String((err as { name?: unknown })?.name || '') === 'TypeError'
  }
  return false
}

/**
 * Capa de transporte resiliente para llamadas de red (cliente o servidor):
 *  - Timeout real vía AbortController (delega en fetchTextEngine →
 *    normaliza a { code: 'gemini_timeout', status: 408 }).
 *  - Reintento ante fallos de transporte puros (TypeError: Failed to fetch),
 *    típicos de sockets keep-alive muertos tras reiniciar el dev server: el
 *    reintento abre una conexión nueva y la petición se resuelve sola.
 *  - Si el fallo persiste, normaliza a { code: 'gemini_network' } para que la
 *    UI muestre un mensaje accionable en lugar del TypeError crudo.
 */
export async function fetchTextEngineResilient(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number; retryDelayMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = AI_REQUEST_DEADLINE_MS, retries = 1, retryDelayMs = 300 } = options
  let attempt = 0
  for (;;) {
    try {
      return await fetchTextEngine(url, init, timeoutMs)
    } catch (err) {
      const isTimeout = (err as { code?: string })?.code === 'gemini_timeout'
      const isTransport = isTransportError(err)
      if (isTimeout || !isTransport) throw err
      if (attempt >= retries) throw buildNetworkError(url, err)
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
}
