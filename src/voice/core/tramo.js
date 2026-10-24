/**
 * TRAMO DE LA LOCUCIÓN — dueño único de `[inicio, fin]` en MUESTRAS para la fila.
 *
 * Antes el tramo era una resta de contadores (`total - inicioDelTurno`): si el contador
 * del turno se reiniciaba, la fila salía con tramo 0 o acumulativo (medido 2026-10-23:
 * 176.000 / 259.200 muestras en filas de una sola frase). Ahora el tramo es la VENTANA CON
 * VOZ de la locución (`ventanaConVoz`, el mismo criterio que mide la identidad): la fila
 * declara el audio que de verdad se habló, no el hueco entre dos contadores.
 */
import { flattenChunksWindow } from '../lib/speakerClusters.js'
import { ventanaConVoz } from '../lib/voicedActivity.js'

/**
 * @param {{ chunks?: ArrayLike<Float32Array|Int16Array>, totalSamples?: number, sinceSample?: number, sampleRate?: number }} [input]
 * @returns {{ audioStartSample: number, audioEndSample: number, tramoValido: boolean }}
 */
export function tramoDelTurno({ chunks = [], totalSamples = 0, sinceSample = 0, sampleRate = 0 } = {}) {
  const total = Number(totalSamples) || 0
  const ventana = flattenChunksWindow(chunks, { totalSamples: total, sinceSample: Number(sinceSample) || 0 })
  // Indice ABSOLUTO de la primera muestra de la ventana dentro del audio de la sesión.
  const base = Math.max(0, total - ventana.length)
  const { inicio, fin, hayVoz } = ventanaConVoz(ventana, { sampleRate })
  return {
    audioStartSample: base + inicio,
    audioEndSample: base + fin,
    tramoValido: hayVoz === true && fin > inicio,
  }
}
