/**
 * Flujo EJECUTADO de la ruta Gemini del motor único (C40/C41).
 *
 * Cierra la reserva de la auditoría: "sin test de flujo que ejecute la ruta
 * Gemini". Mockea SOLO el transporte de red (`fetch`); la orquestación es la
 * real: GeminiService + BaseAIService + postGeminiContract + geminiProxy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../src/core/config/appConfig';

function stubLocalStorage(): void {
  const map = new Map<string, string>([[STORAGE_KEYS.TEXT_API_KEY, 'test-key']]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  });
}

describe('GeminiService — flujo real por proxy (motor único)', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('generateResponse ejecuta el transporte y devuelve la respuesta del proxy', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ respuesta_voz: 'respuesta-gemini' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { geminiService } = await import('../src/services/gemini');
    const out = await geminiService.generateResponse(
      { apiKey: 'test-key', language: 'es' },
      'hola',
      'FLU',
      [],
    );

    expect(out).toBe('respuesta-gemini');
    expect(fetchMock).toHaveBeenCalled();
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/api/gemini/contract');
  });
});
