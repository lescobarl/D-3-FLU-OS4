// ============================================================
// turnAudioSnapshotOwnerGuard.test.ts — Guard de PROPIEDAD del audio del turno
// ------------------------------------------------------------
// Invariante: la diarización debe consumir el SNAPSHOT de audio del turno
// (capturado por su dueño único antes de que el buffer PCM se vacíe), NO el
// buffer vivo, que puede haber quedado a 0 por un cierre/commit intermedio.
//
// Medido en la sesión real del dueño (2026-10-06, debug.log): 24 de 25 turnos con
// `SpeakerTrace snap=0` y un único embedding calculado → toda la sesión caía a
// "Hablante 1". El audio existía en el buffer, pero se leía DESPUÉS de vaciarlo.
// ============================================================
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { resolveSpeakerFromAudio } = vi.hoisted(() => ({
  resolveSpeakerFromAudio: vi.fn(async (samples: Float32Array | number[], _sampleRate?: number, _payload?: unknown) => {
    const len = samples?.length || 0
    return {
      speakerId: `spk-${len}`,
      speakerName: len ? 'Hablante 2' : 'Hablante 1',
      signatureVector: len ? [0, 1] : [],
      similarity: 0,
      reason: len ? 'captured-audio' : 'no-audio',
    }
  }),
}))

vi.mock('../src/voice/lib/voiceIdWorkerClient.js', () => ({
  resolveSpeakerFromAudio: (samples: Float32Array | number[], sampleRate: number, payload: unknown) =>
    resolveSpeakerFromAudio(samples, sampleRate, payload),
}))

import { createTurnSpeakerAudioResolver } from '../src/voice/lib/turnSpeakerPreflight.js'

function emptyLiveBuffer() {
  return {
    getTurnStartSample: () => 0,
    snapshotTurnWindow: () => new Float32Array(0),
  }
}

function buildResolver(overrides: Record<string, unknown> = {}) {
  return createTurnSpeakerAudioResolver({
    getAudioBuffer: () => emptyLiveBuffer(),
    getSampleRate: () => 16000,
    getCapturedAudio: () => null,
    getFallbackSpeaker: () => 'Hablante 1',
    atTurnBoundary: true,
    ...overrides,
  })
}

/**
 * Predicado EXPORTADO para poder falsificarlo (prueba de mutación del propio guard):
 * ¿el resolver de identidad consume el snapshot capturado aunque el buffer vivo
 * esté vacío?
 */
export async function resolverUsesCapturedAudio(captured: Float32Array | null): Promise<boolean> {
  resolveSpeakerFromAudio.mockClear()
  const resolver = buildResolver({ getCapturedAudio: () => captured })
  const result = await resolver()
  const sent = resolveSpeakerFromAudio.mock.calls[0]?.[0] as Float32Array | undefined
  return Boolean(result?.reason === 'captured-audio' && (sent?.length || 0) >= 1)
}

describe('diarización — el audio del turno lo captura su dueño único (no el buffer vivo)', () => {
  beforeEach(() => {
    resolveSpeakerFromAudio.mockClear()
  })

  it('con snapshot capturado y buffer vivo vacío, el resolver usa el snapshot capturado', async () => {
    const resolver = buildResolver({ getCapturedAudio: () => new Float32Array([0.1, 0.2, 0.3, 0.4]) })
    const result = await resolver()
    expect(resolveSpeakerFromAudio).toHaveBeenCalledTimes(1)
    const sent = resolveSpeakerFromAudio.mock.calls[0][0] as Float32Array
    expect(sent.length).toBe(4)
    expect(result.reason).toBe('captured-audio')
  })

  it('SIN snapshot capturado, el buffer vivo vacío se reporta honestamente como no-audio', async () => {
    const resolver = buildResolver({ getCapturedAudio: () => null })
    const result = await resolver()
    expect(result.reason).toBe('no-audio')
  })

  it('el snapshot capturado gana al buffer vivo aunque el vivo tenga audio (dueño único)', async () => {
    const liveAdapter = {
      getTurnStartSample: () => 0,
      snapshotTurnWindow: () => new Float32Array([9, 9, 9, 9, 9, 9]),
    }
    const resolver = buildResolver({
      getAudioBuffer: () => liveAdapter,
      getCapturedAudio: () => new Float32Array([1, 2]),
    })
    await resolver()
    const sent = resolveSpeakerFromAudio.mock.calls[0][0] as Float32Array
    expect(sent.length).toBe(2)
  })
})

describe('el detector no es decorativo (prueba de mutación del propio guard)', () => {
  it('marca la ENTRADA INFRACTORA (buffer vivo a 0) y NO la legítima', async () => {
    // Infractor: si el resolver ignorara el snapshot, el buffer vivo a 0 lo delata.
    expect(await resolverUsesCapturedAudio(new Float32Array([1, 2, 3]))).toBe(true)
    // Legítimo: sin snapshot no hay audio que consumir; no debe "inventarlo".
    expect(await resolverUsesCapturedAudio(null)).toBe(false)
  })
})
