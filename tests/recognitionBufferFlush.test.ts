// Conducta de recognitionBufferFlush: flush por fases al FINAL. La transcripcion
// se vacia de inmediato (sync, sin PCM) y el PCM se vacia tras el commit. El
// colaborador audioBufferFlush es REAL: se ejercita con refs/objetos sinteticos.
import { describe, it, expect, vi } from 'vitest'
import { flushTranscriptStateOnFinal, flushPcmStateAfterCommit } from '../src/voice/lib/recognitionBufferFlush'

const ref = (v: unknown = null) => ({ current: v })

describe('flushTranscriptStateOnFinal: vacia el estado de transcripcion en FINAL', () => {
    it('limpia el texto live publicado', () => {
        const publishedLiveRef = ref('hola')
        flushTranscriptStateOnFinal({ publishedLiveRef } as any)
        expect(publishedLiveRef.current).toBe('')
    })

    it('limpia el ultimo preview de stream', () => {
        const lastStreamPreviewRef = ref('parcial')
        flushTranscriptStateOnFinal({ lastStreamPreviewRef } as any)
        expect(lastStreamPreviewRef.current).toBe('')
    })

    it('apaga el turno de preview abierto', () => {
        const openPreviewTurnRef = ref(true)
        flushTranscriptStateOnFinal({ openPreviewTurnRef } as any)
        expect(openPreviewTurnRef.current).toBe(false)
    })

    it('vacia los tres campos del listenState', () => {
        const listenState = { openLine: 'a', pendingInterim: 'b', pendingFinal: 'c' }
        flushTranscriptStateOnFinal({ listenState } as any)
        expect(listenState).toEqual({ openLine: '', pendingInterim: '', pendingFinal: '' })
    })

    it('no revienta sin argumentos', () => {
        expect(() => flushTranscriptStateOnFinal()).not.toThrow()
    })

    it('tolera refs y listenState ausentes (null)', () => {
        expect(() =>
            flushTranscriptStateOnFinal({
                listenState: null,
                publishedLiveRef: null,
                openPreviewTurnRef: null,
                lastStreamPreviewRef: null,
            } as any),
        ).not.toThrow()
    })
})

describe('flushPcmStateAfterCommit: vacia el PCM tras el commit', () => {
    it('sin audioBuffer deja las refs a cero', () => {
        const chunksRef = ref(['x'])
        const total = ref(999)
        const start = ref(999)
        const r = flushPcmStateAfterCommit({
            chunksRef,
            chunkTotalSamplesRef: total,
            turnAudioStartSampleRef: start,
        } as any)
        expect(chunksRef.current).toEqual([])
        expect(total.current).toBe(0)
        expect(start.current).toBe(0)
        expect(r).toEqual({ flushed: true, totalSamples: 0, turnStartSample: 0 })
    })

    it('con audioBuffer usa flushToZero y propaga turnStartSample y chunks', () => {
        const audioBuffer = {
            chunks: [{ id: 1 }],
            flushToZero: () => ({ flushed: true, totalSamples: 5, turnStartSample: 42 }),
        }
        const chunksRef = ref()
        const total = ref(1)
        const start = ref(1)
        const r = flushPcmStateAfterCommit({
            audioBuffer,
            chunksRef,
            chunkTotalSamplesRef: total,
            turnAudioStartSampleRef: start,
        } as any)
        expect(start.current).toBe(42)
        expect(chunksRef.current).toBe(audioBuffer.chunks)
        expect(total.current).toBe(0)
        expect(r.turnStartSample).toBe(42)
    })

    it('resetea el indice de muestras del micBridge', () => {
        const resetSampleIndex = vi.fn()
        flushPcmStateAfterCommit({ micBridgeRef: { current: { resetSampleIndex } } } as any)
        expect(resetSampleIndex).toHaveBeenCalledTimes(1)
    })

    it('no exige micBridge ni audioBuffer', () => {
        expect(() => flushPcmStateAfterCommit()).not.toThrow()
    })
})
