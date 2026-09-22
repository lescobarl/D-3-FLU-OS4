/**
 * Puente AudioWorklet → búfer PCM + STT (hilo de audio aislado del main thread).
 */
import { encodePcmChunk } from './pcmAudio.js'
import { nowPerf } from './audioSegmentClock.js'
import { logCaughtError } from '../../lib/caughtError';

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
 *   onPcmBlock?: (samples: Float32Array, meta: { sampleIndex: number }) => void,
 *   pushSttPcm?: (int16: Int16Array) => void,
 *   sampleRate?: number,
 *   sttTargetRate?: number,
 *   processEvery?: number,
 * }} options
 */
export async function wireMicCapturePipeline({
  audioContext,
  source,
  onPcmBlock,
  pushSttPcm,
  sampleRate = 48000,
  sttTargetRate = 16000,
  processEvery = 1,
} = {}) {
  const workletNode = await createMicCaptureWorkletNode(audioContext)
  const zeroGain = audioContext.createGain()
  zeroGain.gain.value = 0

  let blockSeq = 0
  let sampleIndex = 0
  const every = Math.max(1, Number(processEvery) || 1)

  workletNode.port.onmessage = (event) => {
    const data = event.data
    if (data?.type !== 'pcm' || !data.samples?.length) return
    blockSeq += 1
    if (blockSeq % every !== 0) return

    const samples = data.samples instanceof Float32Array ? data.samples : new Float32Array(data.samples)
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
      } catch {
        logCaughtError('[catch] src/voice/lib/micCaptureBridge.js');
        // ignore
      }
      try {
        zeroGain.disconnect()
      } catch {
        logCaughtError('[catch] src/voice/lib/micCaptureBridge.js');
        // ignore
      }
    },
  }
}
