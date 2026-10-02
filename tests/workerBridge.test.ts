// Conducta de workerBridge: utilidades compartidas por los Web Workers de voz.
// Frontera sustituida: el global `self` del contexto Worker (su postMessage),
// que fuera de un Worker no existe. Todo lo demas es el cuerpo real del modulo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { samplesFromTransfer, createWorkerReply } from '../src/voice/lib/workerBridge'

describe('samplesFromTransfer: lee muestras de un payload transferido', () => {
    it('desde audioBuffer con sampleCount explicito devuelve una vista Float32Array', () => {
        const buf = new Float32Array([1, 2, 3, 4]).buffer
        const out = samplesFromTransfer({ audioBuffer: buf, sampleCount: 3 })
        expect(out).toBeInstanceOf(Float32Array)
        expect(Array.from(out)).toEqual([1, 2, 3])
    })

    it('desde audioBuffer sin sampleCount deriva el conteo del byteLength y el byteOffset', () => {
        const buf = new Float32Array([1, 2, 3, 4, 5, 6]).buffer
        const out = samplesFromTransfer({ audioBuffer: buf, byteOffset: 8 })
        expect(Array.from(out)).toEqual([3, 4, 5, 6])
    })

    it('acepta samples como ArrayBuffer', () => {
        const buf = new Float32Array([7, 8]).buffer
        const out = samplesFromTransfer({ samples: buf })
        expect(Array.from(out)).toEqual([7, 8])
    })

    it('devuelve la misma instancia cuando samples ya es Float32Array', () => {
        const arr = new Float32Array([9, 10])
        expect(samplesFromTransfer({ samples: arr })).toBe(arr)
    })

    it('convierte un array numerico a Float32Array', () => {
        const out = samplesFromTransfer({ samples: [1.5, 2.5] })
        expect(out).toBeInstanceOf(Float32Array)
        expect(Array.from(out)).toEqual([1.5, 2.5])
    })

    it('sin datos devuelve un Float32Array vacio', () => {
        expect(samplesFromTransfer().length).toBe(0)
        expect(samplesFromTransfer({}).length).toBe(0)
    })

    it('con sampleCount no finito recae en el byteLength', () => {
        const buf = new Float32Array([1, 2, 3]).buffer
        expect(samplesFromTransfer({ audioBuffer: buf, sampleCount: NaN }).length).toBe(3)
    })

    it('un byteLength insuficiente produce un resultado vacio', () => {
        expect(samplesFromTransfer({ audioBuffer: new ArrayBuffer(0) }).length).toBe(0)
    })
})

describe('createWorkerReply: responde por postMessage del Worker', () => {
    let postMessage: ReturnType<typeof vi.fn>
    let originalSelf: unknown

    beforeEach(() => {
        originalSelf = (globalThis as any).self
        postMessage = vi.fn()
        ;(globalThis as any).self = { postMessage }
    })

    afterEach(() => {
        if (originalSelf === undefined) delete (globalThis as any).self
        else (globalThis as any).self = originalSelf
    })

    it('responde ok con el id y el resultado', () => {
        createWorkerReply('msg-1')(true, { embedding: [1, 2] })
        expect(postMessage).toHaveBeenCalledWith({
            id: 'msg-1',
            ok: true,
            result: { embedding: [1, 2] },
            error: '',
        })
    })

    it('convierte un Error a su message en el campo error', () => {
        createWorkerReply(7)(false, null, new Error('fallo de worker'))
        expect(postMessage).toHaveBeenCalledWith({ id: 7, ok: false, result: null, error: 'fallo de worker' })
    })

    it('acepta un error de tipo string', () => {
        createWorkerReply('x')(false, null, 'algo salio mal')
        expect(postMessage.mock.calls[0][0].error).toBe('algo salio mal')
    })

    it('deja el error vacio en la respuesta correcta', () => {
        createWorkerReply('x')(true, 42)
        expect(postMessage.mock.calls[0][0]).toEqual({ id: 'x', ok: true, result: 42, error: '' })
    })
})
