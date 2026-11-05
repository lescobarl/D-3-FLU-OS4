import { resolveTextApiKey } from '../config/appConfig'
import { resolveApiKey } from '../config/sharedConfig'

/**
 * Resuelve la clave del motor de texto (directa > central).
 * Dueño único del envoltorio que repetían Gemini y DeepSeek.
 * @param apiKey Clave explícita de la petición.
 * @returns Clave y su origen.
 */
export function resolveTextRequestKey(apiKey = ''): { apiKey: string; apiKeySource: string } {
  return resolveApiKey(apiKey, resolveTextApiKey)
}
