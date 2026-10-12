import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'
import { getAsrConfig } from './asr/asrConfig.js'

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
 * DUENO UNICO DEL UMBRAL (P9.72): el umbral de VOZ es el MISMO que el del VAD del ASR
 * (`transcript.asr.vad.energyThreshold`, subido a 0.02 con motivo medido: con 0.015 el ruido de
 * ambiente abria turno y Whisper alucinaba). Antes habia un `voicedRmsFloor` propio (0.01) MAS
 * permisivo que el VAD -> TV/ambiente contaba como voz y el piso no filtraba. Dos umbrales que
 * miden lo MISMO son ruta doble de datos: se comparte uno.
 *
 * @param {Float32Array|number[]} samples Muestras de audio (mono, [-1,1]).
 * @param {{ sampleRate?: number, frameMs?: number, rmsFloor?: number }} [opts]
 * @returns {number} muestras consideradas VOZ (0 si no hay senal).
 */
/**
 * Piso de VOZ vigente (dueno unico: el umbral del VAD del ASR).
 *
 * @returns {number}
 */
function getVoicedFloor() {
  return Number(getAsrConfig()?.vad?.energyThreshold) || 0.02
}

export function countVoicedSamples(samples, { sampleRate = DEFAULT_SAMPLE_RATE, frameMs = 20, rmsFloor = getVoicedFloor() } = {}) {
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
