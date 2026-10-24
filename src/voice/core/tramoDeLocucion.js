/**
 * FRONTERA DE LOCUCIÓN — dueño único de «¿aquí acabó una locución y empieza otra?».
 *
 * El tramo de la fila (`turnWindow`) es la ventana del TURNO y NO identifica la locución.
 * Eso dejaba un agujero medido (sesión 8f3112c2): dos locuciones sin pausa suficiente
 * compartían turno y acababan en UNA fila, porque el reloj del turno no cierra hasta
 * `srGapCommitMs` (3500 ms) y la pausa entre ellas era 2440 ms.
 *
 * La frontera se decide con DOS evidencias independientes:
 *   1. QUIETUD de la línea viva: el ASR lleva `minSilenceMs` (900 ms) sin tocarla.
 *   2. TEXTO AJENO: la emisión que llega abre OTRA locución (`estadoDeLocucion`).
 *
 * Solo el texto no basta (el ASR reinicia su hipótesis a media frase: 57 filas medidas) y
 * solo la pausa tampoco (un dictado normal tiene pausas de 1-2 s dentro de la misma
 * locución: cortar en cada una partió 24 filas). Las dos juntas sí identifican el corte.
 *
 * `crearDetectorDeFronteras` sigue siendo el dueño del VAD por evento para MEDIR audio
 * (playback y diagnóstico). Su marca NO decide la frontera: en la sesión real no hay
 * frontera de audio después de 77,7 s y la locución sí acabó.
 */
import { createVoiceSegmenter } from '../lib/asr/voiceActivitySegmenter.js'
import { DEFAULT_SAMPLE_RATE } from '../lib/audioConstants.js'
import { estadoDeLocucion } from './locucion.js'

/**
 * Detector de fronteras de audio por evento (VAD). Devuelve la posición, en muestras, del
 * último fin de habla que vio el segmentador.
 * @param {{ sampleRate?: number, config?: object }} [options]
 * @returns {{ push: (samples: Float32Array | number[]) => number, frontera: () => number,
 *   muestras: () => number, reset: () => void }}
 */
export function crearDetectorDeFronteras({ sampleRate = DEFAULT_SAMPLE_RATE, config = undefined } = {}) {
  const tasa = Number(sampleRate) > 0 ? Number(sampleRate) : DEFAULT_SAMPLE_RATE
  const segmenter = createVoiceSegmenter(config, tasa)
  let frontera = 0
  let muestras = 0

  /**
   * Empuja un bloque de PCM y devuelve la última frontera detectada (en muestras).
   * @param {Float32Array | number[]} samples
   * @returns {number}
   */
  const push = (samples) => {
    const bloque = samples instanceof Float32Array ? samples : new Float32Array(samples || [])
    if (!bloque.length) return frontera
    muestras += bloque.length
    for (const evento of segmenter.push(bloque) || []) {
      if (evento?.type !== 'speech-end') continue
      const fin = Math.round(((Number(evento.startMs) + Number(evento.durationMs)) / 1000) * tasa)
      if (fin > frontera) frontera = fin
    }
    return frontera
  }

  return {
    push,
    frontera: () => frontera,
    muestras: () => muestras,
    reset: () => {
      segmenter.reset()
      frontera = 0
      muestras = 0
    },
  }
}

/**
 * ¿Hay FRONTERA de locución? Dueño único del predicado.
 *
 * Exige las dos evidencias: la línea lleva QUIETA el silencio mínimo y lo que llega abre
 * otra locución. Sin la quietud, un reinicio de hipótesis del ASR a media frase (texto
 * distinto, 200 ms después) se tomaba por frontera y partía la locución (2 filas extra
 * medidas en playback 8f3112c2).
 *
 * @param {{ lineaAbierta?: string, texto?: string, quietaMs?: number, minQuietaMs?: number }} [estado]
 * @returns {boolean}
 */
export function hayFronteraDeAudio({ lineaAbierta = '', texto = '', quietaMs = 0, minQuietaMs = 0 } = {}) {
  const abierta = String(lineaAbierta || '').trim()
  if (!abierta) return false
  if (Number(minQuietaMs) > 0 && Number(quietaMs) < Number(minQuietaMs)) return false
  return estadoDeLocucion(abierta, String(texto || '')).locucionNueva
}
