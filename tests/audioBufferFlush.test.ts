// ============================================================
// audioBufferFlush.test.ts — Conducta de flushAudioAccumulationOnFinal
// ------------------------------------------------------------
// Vaciado sincronizado del bufer PCM al recibir FINAL: el modulo
// coordina el puente de micro, el bufer de audio y los refs de
// muestras. Se observa que refs se escriben y que se devuelve.
// Nota: la firma en JS infiere los params como opcionales estrictos
// (null|undefined), asi que se invoca via un alias laxo tipado.
// ============================================================
import { describe, expect, it, vi } from 'vitest'
import { flushAudioAccumulationOnFinal } from '../src/voice/lib/audioBufferFlush.js'

const flush = flushAudioAccumulationOnFinal as (arg?: any) => any

function ref<T>(initial: T) {
  return { current: initial }
}

describe('audioBufferFlush — flushAudioAccumulationOnFinal', () => {
  it('reinicia el indice de muestras del puente de micro', () => {
    const resetSampleIndex = vi.fn()
    flush({ micBridgeRef: ref({ resetSampleIndex }) })
    expect(resetSampleIndex).toHaveBeenCalledTimes(1)
  })

  it('no falla si el puente de micro no expone resetSampleIndex', () => {
    const micBridgeRef = ref({})
    expect(() => flush({ micBridgeRef })).not.toThrow()
  })

  it('vuelca el audioBuffer llamando a flushToZero', () => {
    const flushToZero = vi.fn(() => ({ flushed: true, totalSamples: 3, turnStartSample: 7 }))
    flush({ audioBuffer: { flushToZero, chunks: ['c1'] } })
    expect(flushToZero).toHaveBeenCalledTimes(1)
  })

  it('devuelve el resultado del volcado del audioBuffer', () => {
    const resultado = { flushed: true, totalSamples: 5, turnStartSample: 9 }
    const out = flush({
      audioBuffer: { flushToZero: () => resultado, chunks: [] },
    })
    expect(out).toBe(resultado)
  })

  it('copia los chunks del audioBuffer al ref de chunks', () => {
    const chunks = ['a', 'b']
    const chunksRef = ref<string[]>([])
    flush({
      audioBuffer: { flushToZero: () => ({ turnStartSample: 0 }), chunks },
      chunksRef,
    })
    expect(chunksRef.current).toBe(chunks)
  })

  it('pone el total de muestras a cero tras volcar', () => {
    const chunkTotalSamplesRef = ref(1000)
    flush({
      audioBuffer: { flushToZero: () => ({ turnStartSample: 0 }), chunks: [] },
      chunkTotalSamplesRef,
    })
    expect(chunkTotalSamplesRef.current).toBe(0)
  })

  it('toma turnStartSample del resultado del volcado', () => {
    const turnAudioStartSampleRef = ref(123)
    flush({
      audioBuffer: { flushToZero: () => ({ turnStartSample: 42 }), chunks: [] },
      turnAudioStartSampleRef,
    })
    expect(turnAudioStartSampleRef.current).toBe(42)
  })

  it('usa 0 si el volcado no trae turnStartSample', () => {
    const turnAudioStartSampleRef = ref(123)
    flush({
      audioBuffer: { flushToZero: () => ({}), chunks: [] },
      turnAudioStartSampleRef,
    })
    expect(turnAudioStartSampleRef.current).toBe(0)
  })

  it('sin audioBuffer devuelve el resultado por defecto', () => {
    const out = flush({})
    expect(out).toEqual({ flushed: true, totalSamples: 0, turnStartSample: 0 })
  })

  it('sin audioBuffer vacia el ref de chunks', () => {
    const chunksRef = ref<string[]>(['viejo'])
    flush({ chunksRef })
    expect(chunksRef.current).toEqual([])
  })

  it('sin audioBuffer resetea los contadores de muestras a cero', () => {
    const chunkTotalSamplesRef = ref(500)
    const turnAudioStartSampleRef = ref(80)
    flush({ chunkTotalSamplesRef, turnAudioStartSampleRef })
    expect(chunkTotalSamplesRef.current).toBe(0)
    expect(turnAudioStartSampleRef.current).toBe(0)
  })

  it('si audioBuffer no expone flushToZero cae a la rama sin bufer', () => {
    const chunksRef = ref<string[]>(['x'])
    const out = flush({ audioBuffer: { chunks: ['x'] }, chunksRef })
    expect(out).toEqual({ flushed: true, totalSamples: 0, turnStartSample: 0 })
    expect(chunksRef.current).toEqual([])
  })
})
