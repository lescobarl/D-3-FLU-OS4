/**
 * Ciclo de vida de la IDENTIDAD de sesion ante un comando de sesion (A4).
 *
 * DEFECTO MEDIDO (2026-10-10): `FLU_CONFIG.navigation.sessionResetCommand` es
 * `INICIAR_CONVERSACION` y la lista `startConversation` mezcla ABRIR ("iniciar
 * conversacion") con CERRAR/REINICIAR ("nueva sesion", "nueva conversacion"). El hook
 * limpiaba el hablante PRIMARIO en esa rama SIEMPRE, asi que abrir o reanudar la escucha
 * borraba el nombre presentado por voz ("soy Luz") y los turnos siguientes volvian a
 * "Hablante N". Limpiar solo al CERRAR la sesion; al reiniciar la escucha, el presentado
 * se conserva (esa es la re-siembra: el ref no se toca).
 *
 * DUENO UNICO de la decision: `isSessionCloseRequest` (las frases de cierre vienen de
 * config `voiceCommands.sessionClosePhrases`) y `applySessionCommandToPrimary` (la unica
 * puerta que limpia el primario por comando).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { cleanForSpeech, matchesCommandPhrase } from './audioMath.js'
import { clearSessionPrimarySpeaker } from './sessionPrimarySpeaker.js'

/**
 * true si el enunciado es un CIERRE/REINICIO de sesion (y no una simple apertura de
 * escucha). Las frases son DATO de config (`voiceCommands.sessionClosePhrases`).
 *
 * @param {string} transcript Enunciado del comando de sesion.
 * @param {object} [config] Config de la app (inyectable en pruebas).
 * @returns {boolean}
 */
export function isSessionCloseRequest(transcript = '', config = FLU_CONFIG) {
  const phrases = config?.voiceCommands?.sessionClosePhrases || []
  const text = cleanForSpeech(transcript)
  if (!text || !phrases.length) return false
  return matchesCommandPhrase(text, phrases, { tolerant: true })
}

/**
 * Aplica el comando de sesion al hablante primario: SOLO un cierre lo limpia.
 *
 * @param {object} params
 * @param {string} params.transcript Enunciado del comando.
 * @param {{ current: string }|null} [params.sessionPrimarySpeakerRef] Ref del primario.
 * @param {object} [params.config] Config (inyectable).
 * @returns {{ cleared: boolean }}
 */
export function applySessionCommandToPrimary({
  transcript = '',
  sessionPrimarySpeakerRef = null,
  config = FLU_CONFIG,
} = {}) {
  if (!isSessionCloseRequest(transcript, config)) return { cleared: false }
  clearSessionPrimarySpeaker(sessionPrimarySpeakerRef)
  return { cleared: true }
}
