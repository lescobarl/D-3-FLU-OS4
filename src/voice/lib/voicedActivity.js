import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { getVadEnergyThreshold, getVadFrameMs, getVadSpeechLikeConfig } from './asr/asrConfig.js'

/**
 * Epsilon numerico del modulo (evita division por cero), NO un umbral de voz:
 * no se configura porque no decide nada del audio.
 */
const SPEECH_LIKE_EPSILON = 1e-9

/**
 * Tamano de trama canonico (muestras) para `frameMs` a `sampleRate`.
 *
 * DUENO UNICO del redondeo: el segmentador redondeaba (`Math.round`) y el conteo
 * truncaba (`Math.floor`), de modo que a tasas no enteras (22050 Hz) la trama no
 * media lo mismo para los dos. Se fija `Math.round` porque es lo que ya usaba el
 * SEGMENTADOR (no se cambia el comportamiento de segmentacion) y se prueba a
 * 22050 Hz.
 *
 * @param {number} sampleRate Hz.
 * @param {number} frameMs milisegundos.
 * @returns {number} muestras por trama (>= 1).
 */
export function frameSamplesFor(sampleRate, frameMs) {
  const rate = Number(sampleRate)
  const ms = Number(frameMs)
  if (!(rate > 0) || !(ms > 0)) return 1
  return Math.max(1, Math.round((rate * ms) / 1000))
}

/**
 * Limites de un tramo redondeados a indices validos del buffer.
 *
 * @param {Float32Array|number[]|null|undefined} samples
 * @param {number} start
 * @param {number} end
 * @returns {{ from: number, to: number }}
 */
function frameBounds(samples, start, end) {
  const length = samples && samples.length ? samples.length : 0
  const num = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.floor(n) : fallback
  }
  const from = Math.max(0, num(start, 0))
  const to = Math.min(length, num(end, length))
  return { from, to }
}

/**
 * Energia (RMS) de `samples[start, end)` — UNICO bucle de energia del modulo.
 *
 * @param {Float32Array|number[]} samples
 * @param {number} [start]
 * @param {number} [end]
 * @returns {number} 0 si el tramo esta vacio.
 */
export function frameRms(samples, start = 0, end = samples ? samples.length : 0) {
  const data = samples && samples.length ? samples : null
  if (!data) return 0
  const { from, to } = frameBounds(data, start, end)
  if (to <= from) return 0
  let sum = 0
  for (let i = from; i < to; i += 1) sum += data[i] * data[i]
  return Math.sqrt(sum / (to - from))
}

/**
 * Predicado UNICO de TRAMA DE VOZ: energia (RMS) del tramo >= piso.
 *
 * Lo consumen el segmentador (`createVoiceSegmenter`), el conteo
 * (`countVoicedSamples`) y el marcado de ventana (`selectVoicedWindow`). Antes
 * habia una copia por consumidor (con dos redondeos distintos de la trama).
 * Un piso <= 0 significa "sin umbral": toda trama no vacia es voz (semantica ya
 * vigente en los dos consumidores), no se inventa un descarte.
 *
 * @param {Float32Array|number[]} samples
 * @param {number} [start]
 * @param {number} [end]
 * @param {number} [rmsFloor] piso de energia (por defecto el del VAD de asrConfig).
 * @returns {boolean}
 */
export function isVoicedFrame(samples, start = 0, end = samples ? samples.length : 0, rmsFloor = getVadEnergyThreshold()) {
  const data = samples && samples.length ? samples : null
  if (!data) return false
  const { from, to } = frameBounds(data, start, end)
  if (to <= from) return false
  const floor = Number(rmsFloor)
  if (!(floor > 0)) return true
  return frameRms(data, from, to) >= floor
}

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
  const frame = frameSamplesFor(sampleRate, frameMs)
  let voiced = 0
  for (let i = 0; i < data.length; i += frame) {
    const end = Math.min(i + frame, data.length)
    if (isVoicedFrame(data, i, end, floor)) voiced += end - i
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
  const tail = mergeBlocksTail(blocks, { sampleRate, windowMs })
  if (!tail) return 0
  return countVoicedSamples(tail, { sampleRate, frameMs, rmsFloor })
}

/**
 * Cola del bufer PCM que cubre `windowMs` (0 = todo el bufer), concatenada.
 *
 * DUENO UNICO de la ventana: la comparten el conteo de VOZ (`countVoicedSamplesInBlocks`)
 * y el de HABLA (`countSpeechLikeSamplesInBlocks`). Una sola copia del recorrido.
 *
 * @param {Array<Float32Array|number[]>} blocks
 * @param {{ sampleRate: number, windowMs?: number }} opts
 * @returns {Float32Array|null} cola (o todo el bufer); `null` sin datos.
 */
function mergeBlocksTail(blocks, { sampleRate, windowMs = 0 }) {
  if (!Array.isArray(blocks) || !blocks.length || !(Number(sampleRate) > 0)) return null
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
  if (!parts.length) return null
  const merged = new Float32Array(total)
  let offset = total
  for (const block of parts) {
    offset -= block.length
    merged.set(block, offset)
  }
  return want > 0 && total > want ? merged.subarray(total - want) : merged
}

/**
 * RMS de una senal (0 si no hay muestras). Dueno unico del calculo de energia.
 *
 * @param {Float32Array|number[]} samples
 * @returns {number}
 */
export function rmsOf(samples) {
  return samples && samples.length ? frameRms(samples, 0, samples.length) : 0
}

/**
 * Habla REAL en una TRAMA: energia (RMS) + cruces por cero en banda de voz.
 *
 * Una trama de voz se distingue de un DC/zumbido (no cruza por cero) y del ruido
 * blanco (cruza ~0.5, muy por encima de la banda de voz). La MODULACION silabica
 * no cabe en 30 ms: vive en el CONTADOR (`countSpeechLikeSamples`), que mira la
 * secuencia de tramas. Umbrales: `FLU_CONFIG.transcript.asr.vad` via
 * `getVadSpeechLikeConfig`, sin hardcode.
 *
 * @param {Float32Array|number[]} samples Trama (mono, [-1,1]).
 * @param {{ rmsFloor?: number, zcrMin?: number, zcrMax?: number }} [opts]
 * @returns {boolean} `true` si la trama parece habla.
 */
export function isSpeechLikeFrame(samples, opts = {}) {
  const data = samples && samples.length ? samples : null
  if (!data || data.length < 4) return false
  const cfg = getVadSpeechLikeConfig()
  const rmsFloor = Number(opts.rmsFloor ?? getVadEnergyThreshold())
  const zcrMin = Number(opts.zcrMin ?? cfg.zcrMin)
  const zcrMax = Number(opts.zcrMax ?? cfg.zcrMax)

  const rms = rmsOf(data)
  if (!(rms >= rmsFloor)) return false

  let crossings = 0
  for (let i = 1; i < data.length; i += 1) {
    const prev = data[i - 1]
    const next = data[i]
    if ((prev < 0 && next >= 0) || (prev >= 0 && next < 0)) crossings += 1
  }
  const zcr = crossings / (data.length - 1)
  return zcr >= zcrMin && zcr <= zcrMax
}

/**
 * Muestras de HABLA en una senal: tramas speech-like + MODULACION de energia.
 *
 * La modulacion se mide en la secuencia de tramas (envelope silabico ~4-8 Hz):
 * un tono o un zumbido constante tiene energia PLANA (ratio ~1) aunque pase el
 * ZCR; la voz no. Un silencio con ruido de fondo no produce ninguna trama
 * speech-like y devuelve 0. Umbral: `speechLikeModulationMin` (config).
 *
 * @param {Float32Array|number[]} samples
 * @param {{ sampleRate?: number, frameMs?: number, rmsFloor?: number, zcrMin?: number, zcrMax?: number, modulationMin?: number }} [opts]
 * @returns {number} muestras consideradas habla (0 si no hay senal o no modula).
 */
export function countSpeechLikeSamples(samples, opts = {}) {
  const data = samples && samples.length ? samples : null
  if (!data) return 0
  const sampleRate = Number(opts.sampleRate) > 0 ? Number(opts.sampleRate) : DEFAULT_SAMPLE_RATE
  const frameMs = Number(opts.frameMs ?? getVadFrameMs())
  const frame = frameSamplesFor(sampleRate, frameMs)
  const frameOpts = { rmsFloor: opts.rmsFloor, zcrMin: opts.zcrMin, zcrMax: opts.zcrMax }
  const frames = []
  for (let i = 0; i < data.length; i += frame) {
    const end = Math.min(i + frame, data.length)
    if (isSpeechLikeFrame(data.subarray(i, end), frameOpts)) frames.push({ samples: end - i, rms: frameRms(data, i, end) })
  }
  if (!frames.length) return 0

  const speechLikeCfg = getVadSpeechLikeConfig()
  const modulationMin = Number(opts.modulationMin ?? speechLikeCfg.modulationMin)
  if (modulationMin > 0 && frames.length > 1) {
    const valores = frames.map((f) => f.rms)
    const media = valores.reduce((a, b) => a + b, 0) / valores.length
    const piso = Math.max(media * speechLikeCfg.modulationFloorRatio, SPEECH_LIKE_EPSILON)
    const ratio = Math.max(...valores) / Math.max(Math.min(...valores), piso)
    if (ratio < modulationMin) return 0
  }

  return frames.reduce((total, f) => total + f.samples, 0)
}

/**
 * Muestras de HABLA en la cola del bufer de bloques PCM (ventana `windowMs`).
 * Mismo dueno de trama/umbrales que `countSpeechLikeSamples`.
 *
 * @param {Array<Float32Array|number[]>} blocks
 * @param {{ sampleRate?: number, windowMs?: number, frameMs?: number, rmsFloor?: number, zcrMin?: number, zcrMax?: number, modulationMin?: number }} [opts]
 * @returns {number}
 */
export function countSpeechLikeSamplesInBlocks(blocks, { sampleRate = DEFAULT_SAMPLE_RATE, windowMs = 0, ...opts } = {}) {
  const tail = mergeBlocksTail(blocks, { sampleRate, windowMs })
  if (!tail) return 0
  return countSpeechLikeSamples(tail, { sampleRate, ...opts })
}

/**
 * RMS de la cola del bufer PCM (ventana `windowMs`) — para observabilidad del
 * degrade/gate: el mismo dato de energia que se registra junto a `speechLikeMs`.
 *
 * @param {Array<Float32Array|number[]>} blocks
 * @param {{ sampleRate?: number, windowMs?: number }} [opts]
 * @returns {number}
 */
export function rmsOfBlocks(blocks, { sampleRate = DEFAULT_SAMPLE_RATE, windowMs = 0 } = {}) {
  const tail = mergeBlocksTail(blocks, { sampleRate, windowMs })
  return tail ? rmsOf(tail) : 0
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
  const frame = frameSamplesFor(rate, frameMs)
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
    if (isVoicedFrame(data, start, end, floor)) {
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
