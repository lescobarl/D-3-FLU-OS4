// Conducta de embeddingFrames: helpers puros de PCM/embeddings compartidos por
// el nucleo de embedding y el Worker de identidad de voz. No hay fronteras de
// red/timers/navegador aqui: se prueba el cuerpo real de decimacion y extraccion.
import { describe, it, expect } from 'vitest'
import { downsampleTo16k, tensorToEmbeddingVector } from '../src/voice/lib/embeddingFrames'

describe('downsampleTo16k: remuestreo por decimacion', () => {
    it('a tasa igual o menor que la objetivo devuelve las muestras tal cual', () => {
        const arr = new Float32Array([1, 2, 3])
        expect(downsampleTo16k(arr, 16000, 16000)).toBe(arr)
        expect(downsampleTo16k(arr, 8000, 16000)).toBe(arr)
    })

    it('convierte un array numerico a Float32Array cuando no hay que decimar', () => {
        const out = downsampleTo16k([1, 2, 3], 8000, 16000)
        expect(out).toBeInstanceOf(Float32Array)
        expect(Array.from(out)).toEqual([1, 2, 3])
    })

    it('48 kHz -> 16 kHz decima por factor 3 y reduce la longitud', () => {
        const input = new Float32Array(9).map((_, i) => i)
        const out = downsampleTo16k(input, 48000, 16000)
        expect(out.length).toBe(3)
        expect(Array.from(out)).toEqual([0, 3, 6])
    })

    it('toma la muestra correspondiente en cada paso de decimacion', () => {
        const out = downsampleTo16k(new Float32Array([0, 1, 2, 3, 4, 5]), 32000, 16000)
        expect(Array.from(out)).toEqual([0, 2, 4])
    })

    it('una entrada vacia o nula devuelve un Float32Array vacio', () => {
        expect(downsampleTo16k(new Float32Array(0), 48000, 16000).length).toBe(0)
        expect(downsampleTo16k([], 48000, 16000).length).toBe(0)
        expect(downsampleTo16k(null, 48000, 16000).length).toBe(0)
    })

    it('usa 16 kHz como objetivo por defecto cuando targetRate no es valido', () => {
        expect(downsampleTo16k(new Float32Array(6), 48000, 0).length).toBe(2)
    })

    it('garantiza al menos una muestra y no sale del rango con ratios grandes', () => {
        const out = downsampleTo16k(new Float32Array([5, 6, 7]), 48000, 1)
        expect(out.length).toBe(1)
        expect(out[0]).toBe(5)
    })
})

describe('tensorToEmbeddingVector: extrae el vector crudo del modelo', () => {
    it('usa embeddings cuando existe', () => {
        expect(tensorToEmbeddingVector({ embeddings: { data: [0.1, 0.2] } })).toEqual([0.1, 0.2])
    })

    it('recae en logits si no hay embeddings', () => {
        expect(tensorToEmbeddingVector({ logits: { data: [1, 2, 3] } })).toEqual([1, 2, 3])
    })

    it('prefiere embeddings sobre logits', () => {
        expect(tensorToEmbeddingVector({ embeddings: { data: [9] }, logits: { data: [8] } })).toEqual([9])
    })

    it('convierte salidas tipadas no-array a array numerico', () => {
        expect(tensorToEmbeddingVector({ embeddings: { data: new Float32Array([0.5, 0.25]) } })).toEqual([0.5, 0.25])
    })

    it('sin tensor o sin data devuelve un vector vacio', () => {
        expect(tensorToEmbeddingVector({ embeddings: {} })).toEqual([])
        expect(tensorToEmbeddingVector(null)).toEqual([])
        expect(tensorToEmbeddingVector(undefined as any)).toEqual([])
    })
})
