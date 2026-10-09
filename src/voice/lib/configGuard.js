/**
 * configGuard.js — lectura de un bloque de config con error uniforme.
 *
 * DUENO ÚNICO de "lee el bloque de FLU_CONFIG o lanza `<ruta> es obligatorio`".
 * Estaba copiado 7 veces con la MISMA forma (6 en fluTranscriptMotor.js, 1 en
 * fluTranscriptPause.js): P9.26. La forma con clave DINÁMICA (fluParticipantConfig)
 * y la del perfil de proveedor (gemini.js) NO son esta; se declaran aparte.
 */
import { FLU_CONFIG } from './fluConfig.js'

/**
 * Devuelve el bloque de FLU_CONFIG en `path`, o lanza si no es un objeto.
 * @param {string[]} path claves desde la raíz de FLU_CONFIG
 * @param {string} label ruta legible para el error (p. ej. 'fluConfig.transcript.speechMerge')
 * @returns {Record<string, unknown>}
 */
export function requireConfigBlock(path, label) {
  let block = FLU_CONFIG
  for (const key of path) block = block?.[key]
  if (!block || typeof block !== 'object') {
    throw new Error(`${label} es obligatorio`)
  }
  return block
}
