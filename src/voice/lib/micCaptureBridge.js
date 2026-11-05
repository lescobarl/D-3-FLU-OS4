/**
 * Puente AudioWorklet → búfer PCM + STT (hilo de audio aislado del main thread).
 */
import { encodePcmChunk } from './pcmAudio.js'
import { pushSessionAudio } from './sessionRecorder.js'
import { nowPerf } from './audioSegmentClock.js'
import { logCaughtError } from '../../lib/caughtError';
import { DEFAULT_SAMPLE_RATE, DEFAULT_TARGET_SAMPLE_RATE } from './audioConstants.js'

const WORKLET_NAME = 'flu-mic-capture'

export async function createMicCaptureWorkletNode(audioContext) {
  if (!audioContext?.audioWorklet) {
    throw new Error('AudioWorklet no disponible en este navegador')
  }
  const moduleUrl = new URL('../workers/micCapture.processor.js', import.meta.url)
  await audioContext.audioWorklet.addModule(moduleUrl)
  return new AudioWorkletNode(audioContext, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
}

/**
 * @param {{
 *   audioContext: AudioContext,
 *   source: MediaStreamAudioSourceNode,
 *   recordSource?: AudioNode,
 *   onPcmBlock?: (samples: Float32Array, meta: { sampleIndex: number, audioStartedAtMs: number }) => void,
 *   onRawPcmBlock?: (samples: Float32Array, meta: { sampleIndex: number }) => void, // dominio CRUDO: el piso VAD 0.02 está calibrado sin ganancia
 *   pushSttPcm?: (int16: Int16Array) => void,
 *   sampleRate?: number,
 *   sttTargetRate?: number,
 *   processEvery?: number,
 * }} options
 */
export async function wireMicCapturePipeline({
  audioContext,
  source,
  recordSource = null,
  onPcmBlock,
  onRawPcmBlock,
  pushSttPcm,
  sampleRate = DEFAULT_SAMPLE_RATE,
  sttTargetRate = DEFAULT_TARGET_SAMPLE_RATE,
  processEvery = 1,
} = {}) {
  const workletNode = await createMicCaptureWorkletNode(audioContext)
  const zeroGain = audioContext.createGain()
  zeroGain.gain.value = 0

  let blockSeq = 0
  let sampleIndex = 0
  let rawSampleIndex = 0
  const every = Math.max(1, Number(processEvery) || 1)

  /**
   * Entrega un bloque CRUDO (pre-ganancia): grabación de sesión y cualquier
   * consumidor que mida niveles en el dominio del micrófono (el piso del VAD
   * está calibrado ahí). Se entrega SIEMPRE, antes del throttle de `processEvery`,
   * con su propio índice de muestras: el eje de tiempo es el de la grabación.
   * @param {Float32Array} samples Bloque PCM crudo.
   */
  const deliverRawTap = (samples) => {
    pushSessionAudio(samples, sampleRate)
    if (typeof onRawPcmBlock !== 'function') return
    onRawPcmBlock(samples, { sampleIndex: rawSampleIndex })
    rawSampleIndex += samples.length
  }

  workletNode.port.onmessage = (event) => {
    const data = event.data
    if (data?.type !== 'pcm' || !data.samples?.length) return

    const samples = data.samples instanceof Float32Array ? data.samples : new Float32Array(data.samples)
    // Grabación de sesión: si hay una fuente CRUDA dedicada (`recordSource`), la
    // grabación sale de ahí — sonido natural, con silencios, SIN la ganancia del
    // pipeline (el STT conserva su amplificación). Sin fuente cruda, se graba del
    // mismo nodo que alimenta el STT (comportamiento previo). En ambos casos se
    // alimenta ANTES del throttle de `processEvery` para que el WAV no tenga
    // huecos cuando el pipeline procesa cada N bloques.
    if (!recordSource) deliverRawTap(samples)

    blockSeq += 1
    if (blockSeq % every !== 0) return

    const blockStart = sampleIndex
    const blockStartedAtMs = nowPerf()
    sampleIndex += samples.length

    if (typeof onPcmBlock === 'function') {
      onPcmBlock(samples, { sampleIndex: blockStart, audioStartedAtMs: blockStartedAtMs })
    }
    if (typeof pushSttPcm === 'function') {
      const pcm = encodePcmChunk(samples, sampleRate, sttTargetRate)
      if (pcm.length) pushSttPcm(pcm)
    }
  }

  source.connect(workletNode)
  workletNode.connect(zeroGain)

  // Tap CRUDO para la grabación y los medidores de nivel: worklet dedicado sobre
  // `recordSource` (pre-ganancia). El STT/identidad siguen en el grafo amplificado.
  // El processor no tiene estado: dos instancias conviven sin conflicto.
  let recordNode = null
  if (recordSource) {
    recordNode = await createMicCaptureWorkletNode(audioContext)
    recordNode.port.onmessage = (event) => {
      const data = event.data
      if (data?.type !== 'pcm' || !data.samples?.length) return
      const samples = data.samples instanceof Float32Array ? data.samples : new Float32Array(data.samples)
      deliverRawTap(samples)
    }
    recordSource.connect(recordNode)
    recordNode.connect(zeroGain)
  }

  zeroGain.connect(audioContext.destination)

  return {
    workletNode,
    zeroGain,
    getSampleIndex: () => sampleIndex,
    resetSampleIndex: () => {
      sampleIndex = 0
    },
    disconnect: () => {
      try {
        workletNode.port.onmessage = null
        workletNode.disconnect()
      } catch (e) {
        logCaughtError('[catch] src/voice/lib/micCaptureBridge.js', e);
        // ignore
      }
      try {
        if (recordNode) {
          recordNode.port.onmessage = null
          recordNode.disconnect()
        }
      } catch (e) {
        logCaughtError('[catch] src/voice/lib/micCaptureBridge.js', e);
        // ignore
      }
      try {
        zeroGain.disconnect()
      } catch (e) {
        logCaughtError('[catch] src/voice/lib/micCaptureBridge.js', e);
        // ignore
      }
    },
  }
}
