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
    // La clave debe venir del test, no del entorno. Este fichero corre en entorno
    // `node` (sin cabecera @vitest-environment jsdom), así que `readStorage` —que lee
    // window.localStorage— nunca veía el stubLocalStorage(): la key solo existía si la
    // máquina tenía un .env SIN versionar con VITE_OPENROUTER_API_KEY. Sin ella,
    // isAvailable() es false y el servicio devuelve el respaldo sin IA en vez de llamar
    // al proxy, que es justo lo que este flujo quiere comprobar.
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'test-key');
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  it('analyzeDocument (F1) usa el proxy /api/gemini/text con maxTokens 1800', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ text: JSON.stringify({ resumen: 'resumen-f1', puntos_clave: ['a'] }) }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { geminiService } = await import('../src/services/gemini');
    const contract = await geminiService.analyzeDocument(
      {
        tipo: 'txt',
        nombre: 'x.txt',
        mime: 'text/plain',
        errores: [],
        chunks: ['contenido'],
        rawText: 'contenido',
        resumen_heuristico: '',
        qa_context: '',
      },
      'es',
    );

    expect(contract.resumen).toBe('resumen-f1');
    expect(contract.puntos_clave).toContain('a');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(String(url)).toContain('/api/gemini/text');
    expect(JSON.parse(init.body).maxTokens).toBe(1800);
  });

  it('analyzeApp (F2) usa el proxy con maxTokens 2200', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({
        text: JSON.stringify({
          pantallas: [{ id: 's1', nombre: 'Inicio', proposito: 'p', entradas: [], acciones: [], salidas: [] }],
          flujos: [],
          errores_detectados: [],
        }),
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { geminiService } = await import('../src/services/gemini');
    const contract = await geminiService.analyzeApp(
      { proyecto: 'demo', framework: 'react', estructura: 'src/', archivos: ['App.tsx'], errores_detectados: [] },
      'es',
    );

    expect(contract.proyecto).toBe('demo');
    expect(contract.pantallas).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).maxTokens).toBe(2200);
  });

  it('generateDocument (F3) usa el proxy con maxTokens 3000 y serializa el contenido', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ text: 'cuerpo-generado' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { geminiService } = await import('../src/services/gemini');
    const result = await geminiService.generateDocument(
      { formato: 'md', fuentes: [{ tipo: 'note', ref: 'doc' }] },
      'es',
    );

    expect(result.content).toContain('cuerpo-generado');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).maxTokens).toBe(3000);
  });
});
