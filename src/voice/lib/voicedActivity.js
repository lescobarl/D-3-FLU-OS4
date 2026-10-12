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
