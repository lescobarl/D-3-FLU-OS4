/**
 * fusion.ts — dueño único de «¿este trozo del ASR pertenece a la locución
 * abierta?».
 *
 * La frontera del producto es el SILENCIO medido (`silencioPrevioMs` del tramo
 * entrante) o un cambio de hablante medido/declarado. El hueco de ÍNDICES entre
 * tramos NO es frontera: con `abierta.fin` viejo un tramo posterior da un hueco
 * grande aunque la frase siga y no haya silencio medido. Dentro de la frase la
 * cola pertenece a la locución abierta; el cierre ya no fusiona ni descarta por
 * texto/turno: esa segunda frontera era la que duplicaba y perdía filas.
 */
import { continuaLaFrase } from '../core/locucion.js'

export function perteneceALineaAbierta({
  locucionId,
  textoAbierto,
  trozo,
  tramoVigente,
  silenceCloseMs,
}: {
  locucionId: string
  textoAbierto: string
  trozo: string
  tramoVigente: Readonly<{
    tramoId?: string
    inicio: number
    fin: number
    sampleRate: number
    silencioPrevioMs?: number
  }> | null
  silenceCloseMs: number
}): boolean {
  const nuevo = String(trozo || '').trim()
  if (!nuevo) return false
  if (!tramoVigente) return true
  if (String(tramoVigente.tramoId || '') === String(locucionId || '')) return true
  const umbral = Number(silenceCloseMs)
  if (!(umbral > 0)) return false
  // La MISMA FRASE la decide `continuaLaFrase`; un texto ajeno no entra en la
  // locución abierta aunque los índices estén pegados.
  if (!continuaLaFrase(String(textoAbierto || ''), nuevo)) return false
  // Solo el silencio MEDIDO cierra: el hueco de índices no cuenta.
  const silencioPrevioMs = Number(tramoVigente.silencioPrevioMs)
  return !(Number.isFinite(silencioPrevioMs) && silencioPrevioMs >= umbral)
}
