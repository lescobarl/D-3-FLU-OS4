/**
 * devFlags.js — DUENO ÚNICO del flag de depuración con override global de ventana.
 *
 * Estaba copiado con la misma forma (IS_DEV + override en `window` + default de
 * FLU_CONFIG.debug) en fluDevConsole.js y en listenLog.js (dos veces): P9.27.
 * El override de `window` MANDA sobre la config, y `false` gana sobre `true`.
 *
 * NO es el mismo patrón `isMicIngressLogEnabled` (micIngressLog.js): ese NO se apaga
 * fuera de dev, así que se declara aparte y no usa este helper.
 */
import { FLU_CONFIG } from './fluConfig.js'

const IS_DEV = Boolean(import.meta.env?.DEV)

/**
 * @param {string[]} keys claves de `window` que fuerzan el estado (cualquier `false` apaga)
 * @param {string} configKey clave dentro de `FLU_CONFIG.debug`
 * @returns {boolean}
 */
export function resolveDevDebugFlag(keys, configKey) {
  if (!IS_DEV || typeof window === 'undefined') return false
  for (const key of keys) {
    if (window[key] === false) return false
  }
  for (const key of keys) {
    if (window[key] === true) return true
  }
  return FLU_CONFIG.debug?.[configKey] !== false
}
