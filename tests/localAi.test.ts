// @vitest-environment jsdom
// ============================================================
// localAi.test.ts — compatibilidad con LLM local (Ollama/localhost)
// ============================================================
// Cubre (modo 100% local):
//  - buildTextApiUrl / isLocalTextEndpoint (appConfig)
//  - deepseek.postJson: URL local, sin API key, sin response_format
//  - F1/F2/F3: gate usa hasUsableTextBackend() (apiKey O endpoint local)
//  - aiServiceFactory: provider 'local'
// ============================================================

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    buildTextApiUrl,
    isLocalTextEndpoint,
    OPENROUTER_CONFIG,
    STORAGE_KEYS,
} from '../src/core/config/appConfig';
import { deepseekService } from '../src/services/deepseek';
import { getPreferredAIProvider, getAIService, setPreferredAIProvider } from '../src/services/aiServiceFactory';

// ------------------------------------------------------------
// Aísla estos tests del entorno real: la API key de OpenRouter del
// .env (VITE_OPENROUTER_API_KEY) queda CAPTURADA en OPENROUTER_CONFIG /
// DEEPSEEK_CONFIG al importar appConfig (constantes a nivel de módulo).
// Estos tests asumen "sin API key", así que se neutralizan ambas API_KEY
// (el resto de configs queda intacto: API_URL, MODEL, etc.).
// ------------------------------------------------------------
vi.mock('../src/core/config/appConfig', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/config/appConfig')>();
    return {
        ...actual,
        OPENROUTER_CONFIG: { ...actual.OPENROUTER_CONFIG, API_KEY: '' },
        DEEPSEEK_CONFIG: { ...actual.DEEPSEEK_CONFIG, API_KEY: '' },
    };
});

// ------------------------------------------------------------
// Mock localStorage
// ------------------------------------------------------------
const mockLocalStorage = {
    store: {} as Record<string, string>,
    getItem: vi.fn((key: string) => mockLocalStorage.store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage.store[key] = value;
    }),
    clear: vi.fn(() => {
        mockLocalStorage.store = {};
    }),
};

Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
});

function mockFetchOnce(body: unknown) {
    const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function mockFetchFailing() {
    const fetchMock = vi.fn(async () => {
        throw new Error('ECONNREFUSED local LLM down');
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const docPayload = {
    tipo: 'texto',
    nombre: 'tarea.txt',
    mime: 'text/plain',
    errores: [],
    chunks: ['El documento trata sobre las leyes de Newton y su aplicación.'],
    rawText: 'El documento trata sobre las leyes de Newton y su aplicación.',
    resumen_heuristico: 'Resumen heurístico',
    qa_context: '',
};

describe('localAi — buildTextApiUrl / isLocalTextEndpoint', () => {
    beforeEach(() => mockLocalStorage.clear());
    afterEach(() => vi.unstubAllGlobals());

    test('buildTextApiUrl usa TEXT_API_URL cuando está configurada', () => {
        mockLocalStorage.store[STORAGE_KEYS.TEXT_API_URL] = 'http://localhost:11434/v1';
        expect(buildTextApiUrl('/chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
    });

    test('buildTextApiUrl cae a OPENROUTER_API_URL por defecto', () => {
        mockLocalStorage.clear();
        expect(buildTextApiUrl('chat/completions')).toBe(`${OPENROUTER_CONFIG.API_URL}/chat/completions`);
    });

    test('isLocalTextEndpoint detecta localhost y 127.0.0.1', () => {
        expect(isLocalTextEndpoint('http://localhost:11434/v1/chat/completions')).toBe(true);
        expect(isLocalTextEndpoint('http://127.0.0.1:1234/v1/chat/completions')).toBe(true);
        expect(isLocalTextEndpoint('http://[::1]:8000/v1')).toBe(true);
    });

    test('isLocalTextEndpoint rechaza endpoints remotos', () => {
        expect(isLocalTextEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe(false);
        expect(isLocalTextEndpoint('https://generativelanguage.googleapis.com/...')).toBe(false);
        expect(isLocalTextEndpoint('https://localhost.evil.com')).toBe(false);
    });
});

describe('localAi — deepseek F1/F2/F3 con endpoint local', () => {
    beforeEach(() => {
        mockLocalStorage.clear();
        vi.unstubAllGlobals();
        // Endpoint local (Ollama) sin API key
        mockLocalStorage.store[STORAGE_KEYS.TEXT_API_URL] = 'http://localhost:11434/v1';
        mockLocalStorage.store[STORAGE_KEYS.TEXT_MODEL] = 'llama3.2';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        mockLocalStorage.clear();
    });

    test('analyzeDocument sin API key llama al LLM local (no corta a heurístico)', async () => {
        const fetchMock = mockFetchOnce({
            resumen: 'Resumen del LLM local',
            puntos_clave: ['Punto A', 'Punto B'],
        });

        const result = await deepseekService.analyzeDocument(docPayload, 'es');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain('localhost:11434');
        const headers = (init.headers || {}) as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.model).toBe('llama3.2');
        expect(body.response_format).toBeUndefined();
        expect(result.resumen).toBe('Resumen del LLM local');
        expect(result.puntos_clave).toContain('Punto A');
    });

    test('analyzeDocument local con LLM caído degrada a contrato heurístico', async () => {
        mockFetchFailing();
        const result = await deepseekService.analyzeDocument(docPayload, 'es');
        expect(result.resumen).toBeTruthy();
        expect(result.tipo).toBe('texto');
    });

    test('analyzeDocument con endpoint remoto y sin API key NO llama a fetch', async () => {
        mockLocalStorage.clear();
        mockLocalStorage.store[STORAGE_KEYS.TEXT_API_URL] = 'https://api.deepseek.com';
        const fetchMock = mockFetchOnce({ resumen: 'no debe usarse', puntos_clave: [] });

        const result = await deepseekService.analyzeDocument(docPayload, 'es');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.resumen).toBeTruthy(); // heurístico
    });

    test('generateDocument sin API key usa LLM local y serializa el contenido', async () => {
        mockFetchOnce({
            contenido: '# Título local\nNarración del LLM local.',
        });

        const result = await deepseekService.generateDocument({
            formato: 'md',
            fuentes: [{ tipo: 'documento', ref: 'tarea.txt' }],
        }, 'es');

        expect(result.ext).toBe('md');
        expect(result.content).toContain('Título local');
    });

    test('generateDocument sin API key y sin endpoint local degrada al contenido de respaldo', async () => {
        mockLocalStorage.clear(); // ni URL local ni API key
        const fetchMock = mockFetchOnce({ contenido: 'no debe usarse' });

        const result = await deepseekService.generateDocument({
            formato: 'md',
            fuentes: [{ tipo: 'documento', ref: 'tarea.txt' }],
        }, 'es');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.ext).toBe('md');
        expect(result.content).toContain('tarea.txt');
    });
});

describe('localAi — aiServiceFactory provider local', () => {
    beforeEach(() => {
        mockLocalStorage.clear();
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        mockLocalStorage.clear();
    });

    test('getPreferredAIProvider reconoce "local"', () => {
        mockLocalStorage.store['flu-ai-provider'] = 'local';
        expect(getPreferredAIProvider()).toBe('local');
    });

    test('setPreferredAIProvider("local") persiste y getAIService devuelve un servicio F1/F2/F3', () => {
        setPreferredAIProvider('local');
        expect(mockLocalStorage.store['flu-ai-provider']).toBe('local');
        const svc = getAIService();
        expect(typeof svc.analyzeDocument).toBe('function');
        expect(typeof svc.analyzeApp).toBe('function');
        expect(typeof svc.generateDocument).toBe('function');
    });
});
