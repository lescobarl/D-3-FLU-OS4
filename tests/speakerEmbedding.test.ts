// ============================================================
// speakerEmbedding.test.ts — Conducta de la API publica (barrel)
// ------------------------------------------------------------
// El modulo no implementa logica: reexporta el nucleo de embedding
// (Node) y el cliente del Web Worker (navegador). Se sustituye
// SOLO la frontera (ambos colaboradores) y se observa que cada
// funcion reenviada delega en el modulo correcto.
// ============================================================
import { describe, expect, it, vi } from 'vitest'

const core = vi.hoisted(() => ({
  preloadSpeakerEmbeddingModel: vi.fn(),
  getSpeakerEmbeddingModelStatus: vi.fn(),
  computeSpeakerEmbedding: vi.fn(),
}))

const workerClient = vi.hoisted(() => ({
  embedAudioForDiarization: vi.fn(),
  preloadVoiceIdWorker: vi.fn(),
  resolveSpeakerFromAudio: vi.fn(),
}))

vi.mock('../src/voice/lib/speakerEmbeddingCore.js', () => core)
vi.mock('../src/voice/lib/voiceIdWorkerClient.js', () => workerClient)

import {
  computeSpeakerEmbedding,
  embedAudioForDiarization,
  getSpeakerEmbeddingModelStatus,
  preloadSpeakerEmbeddingModel,
  preloadVoiceIdWorker,
  resolveSpeakerFromAudio,
} from '../src/voice/lib/speakerEmbedding.js'

describe('speakerEmbedding — API publica reexportada', () => {
  it('expone las seis funciones esperadas', () => {
    for (const fn of [
      preloadSpeakerEmbeddingModel,
      getSpeakerEmbeddingModelStatus,
      computeSpeakerEmbedding,
      embedAudioForDiarization,
      preloadVoiceIdWorker,
      resolveSpeakerFromAudio,
    ]) {
      expect(typeof fn).toBe('function')
    }
  })

  it('preloadSpeakerEmbeddingModel es el mismo que el del nucleo', () => {
    expect(preloadSpeakerEmbeddingModel).toBe(core.preloadSpeakerEmbeddingModel)
  })

  it('getSpeakerEmbeddingModelStatus es el mismo que el del nucleo', () => {
    expect(getSpeakerEmbeddingModelStatus).toBe(core.getSpeakerEmbeddingModelStatus)
  })

  it('computeSpeakerEmbedding es el mismo que el del nucleo', () => {
    expect(computeSpeakerEmbedding).toBe(core.computeSpeakerEmbedding)
  })

  it('embedAudioForDiarization es el mismo que el del cliente worker', () => {
    expect(embedAudioForDiarization).toBe(workerClient.embedAudioForDiarization)
  })

  it('preloadVoiceIdWorker es el mismo que el del cliente worker', () => {
    expect(preloadVoiceIdWorker).toBe(workerClient.preloadVoiceIdWorker)
  })

  it('resolveSpeakerFromAudio es el mismo que el del cliente worker', () => {
    expect(resolveSpeakerFromAudio).toBe(workerClient.resolveSpeakerFromAudio)
  })

  it('invocar preloadSpeakerEmbeddingModel delega y devuelve el resultado del nucleo', async () => {
    core.preloadSpeakerEmbeddingModel.mockResolvedValueOnce({ ready: true })
    await expect(preloadSpeakerEmbeddingModel()).resolves.toEqual({ ready: true })
    expect(core.preloadSpeakerEmbeddingModel).toHaveBeenCalledTimes(1)
  })

  it('invocar computeSpeakerEmbedding delega con los argumentos recibidos', async () => {
    core.computeSpeakerEmbedding.mockResolvedValueOnce([0.1, 0.2])
    const samples = new Float32Array([1, 2, 3])
    const compute = computeSpeakerEmbedding as (s: any, rate: number) => Promise<number[]>
    await expect(compute(samples, 16000)).resolves.toEqual([0.1, 0.2])
    expect(core.computeSpeakerEmbedding).toHaveBeenCalledWith(samples, 16000)
  })

  it('invocar resolveSpeakerFromAudio delega en el cliente worker', async () => {
    workerClient.resolveSpeakerFromAudio.mockResolvedValueOnce({ speakerName: 'Ana' })
    const samples = new Float32Array([1, 2, 3])
    await expect(resolveSpeakerFromAudio(samples, 48000, {})).resolves.toEqual({
      speakerName: 'Ana',
    })
    expect(workerClient.resolveSpeakerFromAudio).toHaveBeenCalledWith(samples, 48000, {})
  })
})
