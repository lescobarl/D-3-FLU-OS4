/**
 * Sufijo de CONFIRMACION que el ASR pega tras un nombre propio.
 *
 * "okay flu soy Luis registrado" es nombre "Luis", no "Luis Registrado" (defecto medido
 * 2026-10-21: el eco del TTS creo un participante "Luis Registrado" y contamino la base).
 *
 * FUENTE UNICA: la lista la consumen el guard de nombres (audioMath, stopwords) y la
 * reparacion de datos (useParticipants, base del nombre). Antes cada uno tenia su copia y
 * ya habian divergido: audioMath cubria los plurales y no "registered"; la reparacion
 * cubria "registered" y no los plurales.
 */

/** Palabras que cierran una confirmacion y NUNCA forman parte del nombre. */
export const CONFIRMATION_SUFFIXES: readonly string[] = Object.freeze([
  'registrado',
  'registrada',
  'registrados',
  'registradas',
  'registered',
])

const SUFFIX_AT_END = new RegExp(
  `^(.*\\S)\\s+(?:${CONFIRMATION_SUFFIXES.join('|')})$`,
  'i',
)

/**
 * Nombre base de `"<nombre> <sufijo de confirmacion>"`, o '' si el texto no lleva sufijo.
 * @param {string} name
 * @returns {string}
 */
export function baseNameWithoutConfirmationSuffix(name = ''): string {
  const match = String(name || '').trim().match(SUFFIX_AT_END)
  return match ? match[1].trim() : ''
}
