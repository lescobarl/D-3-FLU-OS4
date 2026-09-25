/**
 * voiceSegmenter — Segmentador/VAD del motor único (§9).
 * Corta PCM en turnos (silencio→voz→silencio) sin depender de Chrome SR.
 */
import { describe, expect, it } from 'vitest'
import { createVoiceSegmenter } from '../src/voice/lib/asr/voiceActivitySegmenter'

const SAMPLE_RATE = 16000
const FRAME_MS = 30
const FRAME_SAMPLES = Math.round((SAMPLE_RATE * FRAME_MS) / 1000)

const CONFIG = {
  frameMs: FRAME_MS,
  energyThreshold: 0.012,
  minSpeechMs: 60,
  minSilenceMs: 60,
  maxSegmentMs: 1000,
  preRollMs: 0,
}

function loudFrames(count: number, amplitude = 0.5) {
  const out = new Float32Array(count * FRAME_SAMPLES)
  out.fill(amplitude)
  return out
}

function silentFrames(count: number) {
  return new Float32Array(count * FRAME_SAMPLES)
}

describe('voiceSegmenter — turnos por VAD', () => {
  it('abre y cierra un turno con voz entre silencios', () => {
    const segmenter = createVoiceSegmenter(CONFIG, SAMPLE_RATE)
    const events = [
      ...segmenter.push(silentFrames(2)),
      ...segmenter.push(loudFrames(5)),
      ...segmenter.push(silentFrames(4)),
    ]
    const types = events.map((event) => event.type)
    expect(types).toContain('speech-start')
    expect(types).toContain('speech-end')

    const end = events.find((event) => event.type === 'speech-end')
    if (!end || end.type !== 'speech-end') throw new Error('no se emitió speech-end')
    expect(end.samples.length).toBeGreaterThanOrEqual(5 * FRAME_SAMPLES)
    expect(end.durationMs).toBeGreaterThan(0)
  })

  it('no abre turno por ruido breve por debajo de minSpeechMs', () => {
    const segmenter = createVoiceSegmenter(CONFIG, SAMPLE_RATE)
    const events = [
      ...segmenter.push(loudFrames(1)),
      ...segmenter.push(silentFrames(3)),
    ]
    expect(events.map((event) => event.type)).not.toContain('speech-end')
  })

  it('flush cierra el turno abierto', () => {
    const segmenter = createVoiceSegmenter(CONFIG, SAMPLE_RATE)
    segmenter.push(loudFrames(5))
    const events = segmenter.flush()
    expect(events.map((event) => event.type)).toContain('speech-end')
  })
})
