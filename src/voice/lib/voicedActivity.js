import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { getVadEnergyThreshold, getVadFrameMs } from './asr/asrConfig.js'

/**
 * Actividad de voz (VAD-lite) — DUENO UNICO de "cuanto de esta ventana es VOZ".
 *
 * P9.71: el "piso de voz" de la diarizacion se alimentaba de la LONGITUD de la ventana
 * (`voiceIdWorkerClient.js` pasaba `sourceLength` como `voicedSampleCount`), y el minimo
 * (`conversationMinVoicedMs: 350`) coincide con el del embedder -> CUALQUIER ventana que el
 * embedder acepta pasaba el piso, incluida una de TV/silencio. Aqui se cuenta lo VIVO: se
 * parte la senal en tramas de `frameMs` y se suman las muestras de las tramas cuya energia
 * (RMS) supera `rmsFloor`. El piso pasa a ser de VOZ, no de longitud.
 *
 * DUENO UNICO DEL DATO (P9.72): el umbral de VOZ, la trama y sus RESPALDOS son los MISMOS que
 * los del VAD del ASR (`asrConfig.getVadEnergyThreshold` / `getVadFrameMs`). Antes habia un
 * `voicedRmsFloor` propio (0.01, MAS permisivo que el VAD 0.02 -> TV/ambiente contaba como voz),
 * una trama propia (20 ms frente a los 30 del VAD) y un respaldo propio (0.02 frente a 0.012):
 * tres copias del mismo dato. Con la config ausente los dos consumidores volvian a divergir.
 *
 * @param {Float32Array|number[]} samples Muestras de audio (mono, [-1,1]).
 * @param {{ sampleRate?: number, frameMs?: number, rmsFloor?: number }} [opts] Trama y umbral
 *   por defecto del dueno unico; se admiten explicitos para los tests.
 * @returns {number} muestras consideradas VOZ (0 si no hay senal).
 */
export function countVoicedSamples(samples, { sampleRate = DEFAULT_SAMPLE_RATE, frameMs = getVadFrameMs(), rmsFloor = getVadEnergyThreshold() } = {}) {
  const data = samples && samples.length ? samples : null
  if (!data || !(Number(sampleRate) > 0) || !(Number(frameMs) > 0)) return 0
  const floor = Number(rmsFloor)
  if (!(floor > 0)) return data.length
  const frame = Math.max(1, Math.floor((Number(sampleRate) * Number(frameMs)) / 1000))
  let voiced = 0
  for (let i = 0; i < data.length; i += frame) {
    const end = Math.min(i + frame, data.length)
    let sum = 0
    for (let j = i; j < end; j++) sum += data[j] * data[j]
    const rms = Math.sqrt(sum / (end - i))
    if (rms >= floor) voiced += end - i
  }
  return voiced
}

/**
 * Voz viva en la COLA del bufer de bloques PCM (degradacion por SR mudo,
 * caso 45aeb8e2): recorre los bloques desde el final hasta cubrir `windowMs`
 * y cuenta las muestras con voz con el MISMO VAD de `countVoicedSamples`
 * (dueno unico de umbral y trama: nada de copias de pisos de voz).
 *
 * @param {Array<Float32Array|number[]>} blocks Bloques PCM del micro, en orden temporal.
 * @param {{ sampleRate?: number, windowMs?: number, frameMs?: number, rmsFloor?: number }} [opts]
 *   `windowMs` (0 = todo el bufer) acota la ventana a los bloques mas recientes.
 * @returns {number} muestras consideradas VOZ dentro de la ventana (0 sin bloques o sin voz).
 */
export function countVoicedSamplesInBlocks(blocks, { sampleRate = DEFAULT_SAMPLE_RATE, windowMs = 0, frameMs = getVadFrameMs(), rmsFloor = getVadEnergyThreshold() } = {}) {
  if (!Array.isArray(blocks) || !blocks.length || !(Number(sampleRate) > 0)) return 0
  const want = Math.floor(Number(windowMs)) > 0
    ? Math.floor((Number(windowMs) / 1000) * Number(sampleRate))
    : 0
  const parts = []
  let total = 0
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (!block || !block.length) continue
    parts.push(block)
    total += block.length
    if (want > 0 && total >= want) break
  }
  if (!parts.length) return 0
  const merged = new Float32Array(total)
  let offset = total
  for (const block of parts) {
    offset -= block.length
    merged.set(block, offset)
  }
  const tail = want > 0 && total > want ? merged.subarray(total - want) : merged
  return countVoicedSamples(tail, { sampleRate, frameMs, rmsFloor })
}

/**
 * DUENO UNICO de "que tramo de la ventana del turno se EMBEBE".
 *
 * La ventana del turno termina en el FINAL del ASR, que llega DESPUES de la pausa:
 * su cola es silencio, y en los bordes puede quedar audio ajeno (eco/TV). Embeber la
 * ventana entera diluye el timbre de la voz del turno y produjo similitudes medidas
 * de 0.10-0.43 contra la MISMA voz (log del dueno 2026-10-18: turno 11, 2 s de
 * ventana con voz solo en una parte). Aqui se devuelve el TRAMO CON VOZ:
 *
 * - se marcan las tramas VAD (mismo umbral y trama que `countVoicedSamples`);
 * - se unen las tramas vivas separadas por pausas <= `maxGapMs` (una respiracion
 *   dentro de la frase no parte el timbre);
 * - se elige el tramo con MAS muestras de voz y se recorta a sus bordes (sin
 *   silencio inicial/final);
 * - sin ninguna trama viva se devuelve la cola de siempre (`maxSamples`): el piso de
 *   voz del llamador decide si alcanza; aqui NO se fabrica voz.
 *
 * @param {Float32Array|number[]} samples Ventana del turno (mono, [-1,1]).
 * @param {{ sampleRate?: number, maxSamples?: number, frameMs?: number, rmsFloor?: number, maxGapMs?: number }} [opts]
 *   `maxSamples` acota el tramo devuelto (0/ausente = toda la ventana).
 * @returns {Float32Array} Tramo con voz (copia), o la cola si no hay voz.
 */
export function selectVoicedWindow(
  samples,
  {
    sampleRate = DEFAULT_SAMPLE_RATE,
    maxSamples = 0,
    frameMs = getVadFrameMs(),
    rmsFloor = getVadEnergyThreshold(),
    maxGapMs = 500,
  } = {},
) {
  const data = samples && samples.length ? samples : null
  const limit = Math.floor(Number(maxSamples)) > 0 ? Math.floor(Number(maxSamples)) : 0
  if (!data) return new Float32Array(0)
  const rate = Number(sampleRate)
  const frame = Math.max(1, Math.floor((rate * Number(frameMs)) / 1000))
  if (!(rate > 0) || !(frame > 0)) {
    const tail = limit > 0 ? Math.min(limit, data.length) : data.length
    return new Float32Array(data.subarray(data.length - tail))
  }
  const floor = Number(rmsFloor)
  const frameCount = Math.ceil(data.length / frame)
  const voiced = new Uint8Array(frameCount)
  let voicedFrames = 0
  for (let f = 0; f < frameCount; f += 1) {
    const start = f * frame
    const end = Math.min(start + frame, data.length)
    let sum = 0
    for (let j = start; j < end; j += 1) sum += data[j] * data[j]
    const rms = Math.sqrt(sum / (end - start))
    if (!(floor > 0) || rms >= floor) {
      voiced[f] = 1
      voicedFrames += 1
    }
  }

  const tailCopy = () => {
    const tail = limit > 0 ? Math.min(limit, data.length) : data.length
    return new Float32Array(data.subarray(data.length - tail))
  }
  if (!voicedFrames) return tailCopy()

  // Tramos: una pausa de mas de `maxGapMs` los separa (dos voces/frases distintas).
  const gapFrames = Math.max(1, Math.round(Number(maxGapMs) / Math.max(1, Number(frameMs))))
  let best = null
  let current = null
  for (let f = 0; f < frameCount; f += 1) {
    if (!voiced[f]) continue
    if (current && f - current.last <= gapFrames) {
      current.last = f
      current.voiced += 1
    } else {
      current = { first: f, last: f, voiced: 1 }
      if (!best || current.voiced > best.voiced) best = current
      continue
    }
    if (current.voiced > best.voiced) best = current
  }

  let startSample = best.first * frame
  let endSample = Math.min(data.length, (best.last + 1) * frame)
  if (limit > 0 && endSample - startSample > limit) {
    // Mas voz que el tope: se queda el tramo MAS RECIENTE (el final del turno es el
    // que el ASR acaba de confirmar).
    startSample = Math.max(startSample, endSample - limit)
  }
  return new Float32Array(data.subarray(startSample, endSample))
}
