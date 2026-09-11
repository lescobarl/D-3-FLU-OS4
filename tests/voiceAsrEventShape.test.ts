/**
 * voiceAsrEventShape — Guard de contrato Web Speech del motor único (§9).
 *
 * Causa de raíz de un bug real: el motor emitía `{ results: [{transcript}] }`
 * (el array de alternativas como `results`, con `isFinal` colgado de él), así
 * que los consumidores leían `event.results[0][0].transcript` = undefined y el
 * texto se perdía (sin fila, sin query, mudo). Este test fija la forma.
 */
import { describe, expect, it } from 'vitest'
import { createWhisperRecognitionEngine } from '../src/voice/lib/asr/whisperRecognitionEngine'

const RATE = 16000

function loud(ms: number) {
  const samples = new Float32Array(Math.round((ms / 1000) * RATE))
  samples.fill(0.5)
  return samples
}

function silent(ms: number) {
  return new Float32Array(Math.round((ms / 1000) * RATE))
}

describe('ASR event shape — legible por los consumidores', () => {
  it('el final expone results[0][0].transcript e isFinal', async () => {
    const events: any[] = []
    const fakeTranscriber = {
      preload: async () => true,
      transcribe: async () => 'hola mundo',
      dispose() {},
    }
    const engine = createWhisperRecognitionEngine({
      sampleRate: RATE,
      transcriber: fakeTranscriber,
    })
    ;(engine as any).onresult = (event: any) => events.push(event)

    engine.start()
    engine.pushAudio(loud(1500), RATE)
    engine.pushAudio(silent(1300), RATE)
    await new Promise((resolve) => setTimeout(resolve, 30))
    engine.dispose()

    expect(events.length).toBeGreaterThanOrEqual(1)
    const event = events[0]
    // Misma lectura que hace useFluVoiceAssistant.js (event.results[i][0].transcript)
    expect(event.results.length).toBe(1)
    expect(event.results[event.resultIndex][0].transcript).toBe('hola mundo')
    expect(event.results[event.resultIndex].isFinal).toBe(true)
  })
})
