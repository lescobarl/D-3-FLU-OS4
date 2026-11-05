// @vitest-environment jsdom
// ============================================================
// Tests para useConfigPersistence
// ============================================================
// Tests unitarios para el hook de persistencia de configuración
// Mockea localStorage y verifica carga/guardado de configuraciones
// ============================================================

import { describe, test as vitestTest, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfigPersistence } from '../../src/hooks/useConfigPersistence';

// Mock localStorage
const mockLocalStorage = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => mockLocalStorage.store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage.store[key] = value;
  }),
  clear: vi.fn(() => {
    mockLocalStorage.store = {};
  }),
};

// Mock window.localStorage
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// Mock SpeechSynthesis
const mockSpeechSynthesis = {
  getVoices: vi.fn(() => [
    { name: 'Google español', lang: 'es-ES' },
    { name: 'Google US English', lang: 'en-US' },
  ]),
};

Object.defineProperty(window, 'speechSynthesis', {
  value: mockSpeechSynthesis,
  writable: true,
});

// Envuelve cada test para drenar DENTRO de act() el refresh() asíncrono de
// useAuditLog (su IndexedDB no existe en jsdom): sin esto, su setLoading(false)
// resuelve después del cuerpo síncrono y React emite "not wrapped in act(...)".
// No cambia aserciones: solo añade el flush posterior al cuerpo del test.
const test = (name: string, fn: () => void) =>
  vitestTest(name, async () => {
    fn();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

describe('useConfigPersistence', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
    // Aísla los tests del entorno real: la API key de OpenRouter del .env
    // (VITE_OPENROUTER_API_KEY) filtra a resolveTextApiKey() cuando
    // localStorage está vacío (appConfig.ts:791-796). Se anulan las claves
    // VITE_* para que el default "sin API key" sea determinista en cualquier máquina.
    vi.stubEnv('VITE_GEMINI_API_KEY', '');
    vi.stubEnv('VITE_OPENROUTER_API_KEY', '');
    vi.stubEnv('VITE_DEEPSEEK_API_KEY', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test('1. Carga valores iniciales desde localStorage', () => {
    // Configurar localStorage con valores de prueba
    mockLocalStorage.store['flu-text-api-key'] = 'test-api-key-123';
    mockLocalStorage.store['flu-text-model'] = 'gemini-2.0-flash';
    mockLocalStorage.store['flu-text-api-url'] = 'https://api.test.com';
    mockLocalStorage.store['flu-language'] = 'en';
    mockLocalStorage.store['flu-session-role'] = 'profesor';

    const { result } = renderHook(() => useConfigPersistence());

    expect(result.current.apiKey).toBe('test-api-key-123');
    expect(result.current.textModel).toBe('gemini-2.0-flash');
    expect(result.current.textApiUrl).toBe('https://api.test.com');
    expect(result.current.language).toBe('en');
    expect(result.current.sessionRole).toBe('profesor');
  });

  test('2. handleTextApiKeyCommit guarda en localStorage', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleTextApiKeyCommit('new-api-key-456');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-text-api-key',
      'new-api-key-456'
    );
    expect(result.current.apiKey).toBe('new-api-key-456');
  });

  test('3. handleTextModelCommit guarda modelo en localStorage', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleTextModelCommit('deepseek-chat');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-text-model',
      'deepseek-chat'
    );
    expect(result.current.textModel).toBe('deepseek-chat');
  });

  test('4. handleTextApiUrlCommit guarda URL en localStorage', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleTextApiUrlCommit('https://api.deepseek.com');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-text-api-url',
      'https://api.deepseek.com'
    );
    expect(result.current.textApiUrl).toBe('https://api.deepseek.com');
  });

  test('5. setLanguage actualiza estado y ref', () => {
    const { result } = renderHook(() => useConfigPersistence());

    // Inicialmente 'es' (default)
    expect(result.current.language).toBe('es');
    expect(result.current.languageRef.current).toBe('es');

    act(() => {
      result.current.setLanguage('both');
    });

    expect(result.current.language).toBe('both');
    expect(result.current.languageRef.current).toBe('both');
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-language',
      'both'
    );
  });

  test('6. setSessionRole actualiza estado y ref', () => {
    const { result } = renderHook(() => useConfigPersistence());

    // Inicialmente 'Asistente del Maestro' (default de FLU_CONFIG)
    expect(result.current.sessionRole).toBe('Asistente del Maestro');
    expect(result.current.sessionRoleRef.current).toBe('Asistente del Maestro');

    act(() => {
      result.current.setSessionRole('administrativo');
    });

    expect(result.current.sessionRole).toBe('administrativo');
    expect(result.current.sessionRoleRef.current).toBe('administrativo');
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-session-role',
      'administrativo'
    );
  });

  test('7. Carga voices desde speechSynthesis', () => {
    const { result } = renderHook(() => useConfigPersistence());

    expect(result.current.voices).toHaveLength(2);
    expect(result.current.voices[0].name).toBe('Google español');
    expect(result.current.voices[1].name).toBe('Google US English');
  });

  test('8. handleImageApiKeyCommit guarda clave de imagen', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleImageApiKeyCommit('image-key-789');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-image-api-key',
      'image-key-789'
    );
    expect(result.current.imageApiKey).toBe('image-key-789');
  });

  test('9. handleImageModelCommit guarda modelo de imagen', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleImageModelCommit('dall-e-3');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-image-model',
      'dall-e-3'
    );
    expect(result.current.imageModel).toBe('dall-e-3');
  });

  test('10. handleImageApiUrlCommit guarda URL de imagen', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleImageApiUrlCommit('https://api.pollinations.ai');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-image-api-url',
      'https://api.pollinations.ai'
    );
    expect(result.current.imageApiUrl).toBe('https://api.pollinations.ai');
  });

  test('11. handleGeminiApiKeyCommit guarda clave de Gemini dedicada', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleGeminiApiKeyCommit('gemini-key-xyz');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-gemini-api-key',
      'gemini-key-xyz'
    );
    expect(result.current.geminiApiKey).toBe('gemini-key-xyz');
  });

  test('12. geminiApiKey carga desde localStorage dedicado y hace fallback a la clave de texto', () => {
    // Sin clave dedicada: geminiApiKey cae a resolveTextApiKey() (vacío en test)
    const { result: emptyResult } = renderHook(() => useConfigPersistence());
    expect(emptyResult.current.geminiApiKey).toBe('');

    // Con clave dedicada: se usa la clave de Gemini
    mockLocalStorage.store['flu-gemini-api-key'] = 'dedicated-gemini-key';
    const { result: dedicatedResult } = renderHook(() => useConfigPersistence());
    expect(dedicatedResult.current.geminiApiKey).toBe('dedicated-gemini-key');
  });

  test('13. handleOcrApiKeyCommit guarda clave de OCR', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleOcrApiKeyCommit('ocr-key-abc');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-ocr-api-key',
      'ocr-key-abc'
    );
    expect(result.current.ocrApiKey).toBe('ocr-key-abc');
  });

  test('14. handleOcrModelCommit guarda modelo de OCR', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleOcrModelCommit('tesseract-es');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-ocr-model',
      'tesseract-es'
    );
    expect(result.current.ocrModel).toBe('tesseract-es');
  });

  test('15. handleOcrApiUrlCommit guarda URL de OCR', () => {
    const { result } = renderHook(() => useConfigPersistence());

    act(() => {
      result.current.handleOcrApiUrlCommit('https://ocr.endpoint.ai');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'flu-ocr-api-url',
      'https://ocr.endpoint.ai'
    );
    expect(result.current.ocrApiUrl).toBe('https://ocr.endpoint.ai');
  });

  test('16. Valores por defecto cuando localStorage está vacío', () => {
    // localStorage vacío
    mockLocalStorage.store = {};

    const { result } = renderHook(() => useConfigPersistence());

    expect(result.current.apiKey).toBe('');
    expect(result.current.textModel).toBe('');
    expect(result.current.textApiUrl).toBe('');
    expect(result.current.geminiApiKey).toBe('');
    expect(result.current.imageApiKey).toBe('');
    expect(result.current.imageModel).toBe('');
    expect(result.current.imageApiUrl).toBe('');
    expect(result.current.ocrApiKey).toBe('');
    expect(result.current.ocrModel).toBe('');
    expect(result.current.ocrApiUrl).toBe('');
    expect(result.current.language).toBe('es');
    expect(result.current.sessionRole).toBe('Asistente del Maestro');
  });

  test('17. Manejo de errores en localStorage', () => {
    // Simular error en localStorage.getItem
    mockLocalStorage.getItem.mockImplementation(() => {
      throw new Error('LocalStorage error');
    });

    // No debería fallar el hook
    const { result } = renderHook(() => useConfigPersistence());

    expect(result.current.apiKey).toBe('');
    expect(result.current.language).toBe('es'); // Default
  });
});