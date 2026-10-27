/**
 * DETECTOR DE ECO del módulo CONVERSACIÓN.
 *
 * El módulo NO habla: compara el texto del ASR contra `ultimoTextoDicho()`, que
 * entrega el consumidor. La comparación es por PALABRAS (cobertura y sufijo),
 * no por caracteres: el ASR puede devolver una cola del texto de FLU con otra
 * puntuación o sin acentos.
 *
 * DOS reglas, ambas de palabras y en orden:
 *  1. SUFIJO EXACTO: el candidato ES la cola de FLU.
 *  2. COLA QUE ABRE EL FRAGMENTO (medido 18:12:34, log del dueño): el ASR
 *     captura el final del TTS (el micro se abre mientras FLU termina) y luego
 *     el turno real — "o prefieres que te cuente algo mas esta | Okay flu
 *     estabamos jugando...". Un PREFIJO del candidato (de al menos
 *     `minPalabrasCola`) que es la cola de FLU también es eco; el resto del
 *     candidato son las primeras palabras del turno real. Sin esta regla la
 *     cola de una respuesta larga se colaba como turno de persona y el LLM
 *     respondía a las palabras de FLU.
 *
 * `minPalabrasCola` se inyecta por el puerto de config (fuente única:
 * `VOICE_DIARIZATION_DEFAULTS.assistantEchoMinWords` + 1): repetir solo las 3
 * últimas palabras de FLU no es eco, es conversación.
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
 * palabras del candidato son la cola de las palabras de FLU, en el mismo orden,
 * o un prefijo suficiente del candidato abre por la cola de FLU (regla 2).
 * Un texto vacío nunca es eco.
 * @param texto Texto reconocido como posible eco.
 * @param ultimoTexto Último texto dicho por FLU (vacío si no hay voz activa).
 * @param minPalabrasCola Mínimo de palabras de la cola que abre el fragmento
 *   (inyectado por el puerto de config; nunca menor que 1).
 * @returns `true` si es eco y por tanto nunca produce fila de usuario.
 */
export function esEcoDeTts(texto: string, ultimoTexto: string, minPalabrasCola: number): boolean {
  const candidato = palabrasNormalizadas(texto)
  const dicho = palabrasNormalizadas(ultimoTexto)
  if (candidato.length === 0 || dicho.length === 0) return false
  const minimo = Math.max(1, Math.floor(Number(minPalabrasCola) || 1))
  if (candidato.length <= dicho.length) {
    const cola = dicho.slice(dicho.length - candidato.length)
    if (cola.every((palabra, indice) => palabra === candidato[indice])) return true
  }
  // Regla 2: un prefijo del candidato que ES la cola de FLU. Se prueba desde el
  // prefijo más largo hasta el mínimo: el eco se declara con la evidencia mayor.
  for (let k = Math.min(candidato.length, dicho.length); k >= minimo; k -= 1) {
    let igual = true
    for (let j = 0; j < k; j += 1) {
      if (candidato[j] !== dicho[dicho.length - k + j]) {
        igual = false
        break
      }
    }
    if (igual) return true
  }
  return false
}
