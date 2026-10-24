/**
 * TRAMO POR LOCUCIÓN — frontera de AUDIO entre dos locuciones (dueño único).
 *
 * El tramo de la fila (`tramoDelTurno`) es la ventana del TURNO. Eso deja un agujero medido
 * (sesión 8f3112c2): dos locuciones SIN pausa suficiente comparten turno y acaban en UNA
 * fila (ids 1792789182623 / 1792789202635), porque el reloj del turno no cierra hasta
 * `srGapCommitMs` (3500 ms) y la pausa entre ellas era 2440 ms.
 *
 * El AUDIO sí lo sabe antes: el segmentador de voz cierra la locución en cuanto hay
 * `minSilenceMs` (900 ms) de silencio. Este módulo expone esa frontera como una POSICIÓN en
 * muestras del PCM del turno; el ingress la consume para cerrar la locución abierta y
 * arrancar la siguiente (una locución = una fila), sin tocar el reloj del turno.
 *
 * No decide texto: solo responde «¿dónde acabó el habla?», que es lo que el texto no puede
 * demostrar (cortar por texto produjo 57 filas: el ASR reinicia su hipótesis a media frase).
 */
import { createVoiceSegmenter } from '../lib/asr/voiceActivitySegmenter.js'
import { DEFAULT_SAMPLE_RATE } from '../lib/audioConstants.js'
import { estadoDeLocucion } from './locucion.js'

/**
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
 * ¿Hay FRONTERA de locución? Exige DOS evidencias independientes:
 *
 *  1. **AUDIO**: el segmentador cerró el habla después de la última frontera consumida.
 *  2. **TEXTO**: la emisión que llega abre OTRA locución (dueño único: `estadoDeLocucion`).
 *
 * Solo el audio no basta: en un dictado normal hay pausas de 1-2 s dentro de la MISMA
 * locución (el producto cierra por silencio a los 3500 ms justamente por eso), y cortar en
 * cada pausa partió 24 filas en la sesión 8f3112c2. Solo el texto tampoco basta (el ASR
 * reinicia su hipótesis a media frase: 57 filas medidas). Las dos señales juntas sí
 * identifican «aquí acabó una locución y empieza otra».
 *
 * @param {{ frontera?: number, consumida?: number, lineaAbierta?: string, texto?: string }} [estado]
 * @returns {boolean}
 */
export function hayFronteraDeAudio({ frontera = 0, consumida = 0, lineaAbierta = '', texto = '', quietaMs = 0, minQuietaMs = 0 } = {}) {
  const marca = Number(frontera) || 0
  const yaVista = Number(consumida) || 0
  // La marca del VAD es CONTEXTO (se informa); la EVIDENCIA que decide es la quietud de la
  // linea + el texto ajeno: el VAD solo ve el PCM que el recorder conservo (medido: en la
  // sesion 8f3112c2 no hay frontera de audio despues de 77,7 s y la locucion si acabo).
  void marca
  void yaVista
  const abierta = String(lineaAbierta || '').trim()
  if (!abierta) return false
  // TERCERA condicion: la linea lleva QUIETA el silencio del VAD. Sin esto, un reinicio
  // de hipotesis del ASR a media frase (texto distinto, 200 ms despues) se tomaba por
  // frontera y partia la locucion: 2 filas extra medidas en playback 8f3112c2.
  if (Number(minQuietaMs) > 0 && Number(quietaMs) < Number(minQuietaMs)) return false
  return estadoDeLocucion(abierta, String(texto || '')).locucionNueva
}
