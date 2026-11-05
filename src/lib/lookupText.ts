/**
 * lookupText — normalización de texto para COMPARAR nombres, dueño único.
 *
 * Criterio: espacios colapsados y recortados (delegado en `normalizeSpaces`) y
 * minúsculas. El normalizador de voz se mantiene aparte porque además pela
 * wake words y puntuación.
 */
import { normalizeSpaces } from './textUtils'

/**
 * Normaliza un valor para comparación por nombre.
 * @param value Valor de entrada.
 * @returns Texto en minúsculas, sin espacios repetidos ni extremos.
 */
export function normalizeLookupText(value: unknown): string {
  return normalizeSpaces(String(value ?? '')).toLowerCase()
}
