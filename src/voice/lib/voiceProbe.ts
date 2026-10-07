// ============================================================
// voiceProbe — SONDA UNICA de diagnostico de voz (datos, no prosa).
// ------------------------------------------------------------
// Problema que resuelve: cada sesion de depuracion necesitaba cruzar a mano
// `WakeTrace` / `RowTrace` / `Commit` / `Identity` y NINGUNA linea decia cual era
// la ETIQUETA FINAL que quedo en la fila. Con la sonda, cada evento emite UNA linea
// `VozProbe <tag> {json}` con TODOS los campos, para poder reconstruir:
//   asrFinal (que recibio el ASR) -> commit (que decidio) -> row (que quedo escrito)
//   + identity (por que esa etiqueta) + clusters (el indice) + srGap (los cortes).
//
// Encendida SOLO en desarrollo (`import.meta.env.DEV`). En produccion es no-op
// (cero coste). El rele de logs se carga DIFERIDO para no cerrar ciclos con la
// configuracion.
// ============================================================
import { logCaughtError } from '../../lib/caughtError'

let enabled = false
try {
  enabled = Boolean(import.meta.env?.DEV)
} catch (error) {
  logCaughtError('[catch] src/voice/lib/voiceProbe.ts', error)
}

/** Fuerza la sonda (pruebas). */
export function setVoiceProbeEnabled(value: boolean) {
  enabled = Boolean(value)
}

export function isVoiceProbeEnabled() {
  return enabled
}

/**
 * Emite una linea estructurada `VozProbe <tag> {json}`. No hace nada si la sonda
 * esta apagada (es una sonda, no una traza masiva).
 *
 * @param {string} tag etiqueta corta del evento (asrFinal|commit|row|identity|clusters|srGap|tick)
 * @param {Record<string, unknown>} [data] datos del evento (se serializan a JSON)
 */
export function voiceProbe(tag: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return
  let payload = ''
  try {
    payload = JSON.stringify(data)
  } catch (error) {
    logCaughtError('[catch] src/voice/lib/voiceProbe.ts', error)
    return
  }
  import('../../lib/clientLogRelay')
    .then((mod) => mod?.relayLog?.('LOG', 'VozProbe', `${tag} ${payload}`))
    .catch((error) => logCaughtError('[catch] src/voice/lib/voiceProbe.ts', error))
}
