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
 * Bloque OPCIONAL de config en `path`, o `{}` si no hay objeto.
 *
 * DUENO UNICO de la forma `config.a?.b?.c || {}` que estaba copiada en 6 getters
 * (embeddingConfig, micCapture x2, speakerPolicy, asrTurnSegmentation, wakePolicy): P9.41.
 * Su tipo publico lo declara cada getter con `@returns` (aqui devuelve el mapa crudo).
 * @param {Record<string, unknown>} config base (FLU_CONFIG o uno inyectado)
 * @param {string[]} path claves desde la raiz
 * @returns {unknown}
 */
export function optionalConfigBlock(config, path) {
  let block = config
  for (const key of path) block = block?.[key]
  return block && typeof block === 'object' ? block : {}
}

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
