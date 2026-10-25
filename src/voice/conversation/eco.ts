/**
 * DETECTOR DE ECO del módulo CONVERSACIÓN.
 *
 * El módulo NO habla: compara el texto del ASR contra `ultimoTextoDicho()`, que
 * entrega el consumidor. La comparación es por PALABRAS (cobertura y sufijo),
 * no por caracteres: el ASR puede devolver una cola del texto de FLU con otra
 * puntuación o sin acentos.
 */
import { normalizarParaComparar } from './adapters.ts'

/** Palabras normalizadas por el dueño único (sin acentos) y sin signos. */
function palabrasNormalizadas(texto: string): string[] {
  return normalizarParaComparar(texto)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * ¿El texto es eco de lo último que dijo FLU? Cobertura y sufijo: todas las
 * palabras del candidato son la cola de las palabras de FLU, en el mismo orden.
 * Un texto vacío nunca es eco.
 * @param texto Texto reconocido como posible eco.
 * @param ultimoTexto Último texto dicho por FLU (vacío si no hay voz activa).
 * @returns `true` si es eco y por tanto nunca produce fila de usuario.
 */
export function esEcoDeTts(texto: string, ultimoTexto: string): boolean {
  const candidato = palabrasNormalizadas(texto)
  const dicho = palabrasNormalizadas(ultimoTexto)
  if (candidato.length === 0 || dicho.length === 0) return false
  if (candidato.length > dicho.length) return false
  const cola = dicho.slice(dicho.length - candidato.length)
  return cola.every((palabra, indice) => palabra === candidato[indice])
}
