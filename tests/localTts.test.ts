// @vitest-environment jsdom
// ============================================================
// localTts — Pruebas unitarias del TTS 100% local
// ============================================================
import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
    buildLocalNarrationSegments,
    getLocalVoices,
    isLocalTtsAvailable,
    pickBestLocalVoice,
    sanitizeForNarration,
    speakLocal,
    stopLocalSpeech,
} from '../src/services/localTts';

interface MockVoice {
    name: string;
    lang: string;
    localService: boolean;
    default: boolean;
    voiceURI: string;
}

class MockUtterance {
    text: string;
    lang = '';
    voice: unknown = null;
    rate = 1;
    pitch = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;

    constructor(text: string) {
        this.text = text;
    }
}

function makeMockSynth(voices: MockVoice[]) {
    const speak = vi.fn();
    const cancel = vi.fn();
    const synth = {
        getVoices: vi.fn(() => voices),
        speak,
        cancel,
    } as unknown as SpeechSynthesis;
    return { synth, speak, cancel };
}

function installSpeechSynthesis(voices: MockVoice[]) {
    const { synth, speak, cancel } = makeMockSynth(voices);
    Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        writable: true,
        value: synth,
    });
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    return { synth, speak, cancel };
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (typeof window !== 'undefined') {
        // @ts-expect-error — limpieza del mock
        delete window.speechSynthesis;
    }
});

const ES_MX: MockVoice = {
    name: 'Microsoft Sabina',
    lang: 'es-MX',
    localService: true,
    default: true,
    voiceURI: 'es-MX-Sabina',
};

const EN_US: MockVoice = {
    name: 'Microsoft Aria',
    lang: 'en-US',
    localService: true,
    default: false,
    voiceURI: 'en-US-Aria',
};

describe('localTts — buildLocalNarrationSegments', () => {
    test('divide por encabezados Markdown y agrupa el preámbulo como Introducción', () => {
        const content = [
            'Este es el resumen inicial.',
            '',
            '# Objetivo',
            'Lograr la meta.',
            '',
            '## Alcance',
            'Dentro del proyecto.',
        ].join('\n');
        const segments = buildLocalNarrationSegments(content, 'es');
        expect(segments).toHaveLength(3);
        expect(segments[0].title).toBe('Introducción');
        expect(segments[0].text).toContain('resumen inicial');
        expect(segments[1].title).toBe('Objetivo');
        expect(segments[1].text).toContain('Lograr la meta');
        expect(segments[2].title).toBe('Alcance');
        expect(segments).toEqual([
            expect.objectContaining({ index: 0, title: 'Introducción' }),
            expect.objectContaining({ index: 1, title: 'Objetivo' }),
            expect.objectContaining({ index: 2, title: 'Alcance' }),
        ]);
    });

    test('contenido vacío produce cero segmentos', () => {
        expect(buildLocalNarrationSegments('', 'es')).toEqual([]);
        expect(buildLocalNarrationSegments('   \n  ', 'es')).toEqual([]);
    });

    test('sin encabezados todo el contenido va en un único segmento', () => {
        const segments = buildLocalNarrationSegments('Solo texto sin títulos.', 'es');
        expect(segments).toHaveLength(1);
        expect(segments[0].title).toBe('Introducción');
        expect(segments[0].text).toBe('Solo texto sin títulos.');
    });

    test('quita marcado (*, _, `) de los títulos de sección', () => {
        const segments = buildLocalNarrationSegments('# **Resultados** clave\nContenido.', 'es');
        expect(segments).toHaveLength(1);
        expect(segments[0].title).toBe('Resultados clave');
    });
});

describe('localTts — pickBestLocalVoice', () => {
    const voices = [EN_US, ES_MX];

    test('prioriza coincidencia exacta de idioma', () => {
        const picked = pickBestLocalVoice(voices, 'es-MX');
        expect(picked?.voiceURI).toBe('es-MX-Sabina');
    });

    test('acepta prefijo de idioma (es → es-MX)', () => {
        const picked = pickBestLocalVoice(voices, 'es');
        expect(picked?.voiceURI).toBe('es-MX-Sabina');
    });

    test('usa la familia de idioma cuando no hay prefijo exacto', () => {
        const picked = pickBestLocalVoice(voices, 'es-ES');
        expect(picked?.voiceURI).toBe('es-MX-Sabina');
    });

    test('sin voces devuelve null', () => {
        expect(pickBestLocalVoice([], 'es')).toBeNull();
    });

    test('con lista no vacía siempre elige la primera como último recurso', () => {
        const picked = pickBestLocalVoice(voices, 'fr');
        expect(picked).not.toBeNull();
    });
});

describe('localTts — getLocalVoices / isLocalTtsAvailable', () => {
    test('filtra solo voces locales (localService)', () => {
        installSpeechSynthesis([ES_MX, EN_US]);
        const voices = getLocalVoices();
        expect(voices.map((v) => v.voiceURI)).toEqual(['es-MX-Sabina', 'en-US-Aria']);
        expect(isLocalTtsAvailable()).toBe(true);
    });

    test('sin speechSynthesis devuelve vacío', () => {
        expect(getLocalVoices()).toEqual([]);
        expect(isLocalTtsAvailable()).toBe(false);
    });

    test('si el navegador no marca localService, devuelve todas las voces', () => {
        const unmarked: MockVoice = { ...EN_US, localService: false };
        installSpeechSynthesis([unmarked]);
        expect(getLocalVoices().map((v) => v.voiceURI)).toEqual(['en-US-Aria']);
    });
});

describe('localTts — speakLocal / stopLocalSpeech', () => {
    test('pronuncia con la voz local elegida y encola el utterance', () => {
        const { speak } = installSpeechSynthesis([ES_MX, EN_US]);
        const result = speakLocal('Hola mundo', { lang: 'es', rate: 1.1 });
        expect(result.started).toBe(true);
        expect(speak).toHaveBeenCalledTimes(1);
        const utterance = speak.mock.calls[0][0] as MockUtterance;
        expect(utterance.text).toBe('Hola mundo');
        expect(utterance.lang).toBe('es-MX');
        expect(utterance.rate).toBe(1.1);
    });

    test('invoca onEnd al terminar la reproducción', () => {
        const { speak } = installSpeechSynthesis([ES_MX]);
        const onEnd = vi.fn();
        const onStart = vi.fn();
        const result = speakLocal('Hola', { onStart, onEnd });
        expect(result.started).toBe(true);
        const utterance = speak.mock.calls[0][0] as MockUtterance;
        utterance.onstart?.();
        utterance.onend?.();
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    test('sin voces locales no pronuncia y devuelve no-local-voice', () => {
        const { speak } = installSpeechSynthesis([]);
        const result = speakLocal('Hola', { lang: 'es' });
        expect(result).toEqual({ started: false, error: 'no-local-voice' });
        expect(speak).not.toHaveBeenCalled();
    });

    test('texto vacío no se pronuncia', () => {
        const { speak } = installSpeechSynthesis([ES_MX]);
        const result = speakLocal('   ', { lang: 'es' });
        expect(result.started).toBe(false);
        expect(speak).not.toHaveBeenCalled();
    });

    test('sin motor TTS devuelve tts-unavailable', () => {
        const result = speakLocal('Hola', { lang: 'es' });
        expect(result).toEqual({ started: false, error: 'tts-unavailable' });
    });

    test('el error "canceled" no se reporta como fallo y dispara onEnd', () => {
        const { speak } = installSpeechSynthesis([ES_MX]);
        const onEnd = vi.fn();
        const onError = vi.fn();
        speakLocal('Hola', { onEnd, onError });
        const utterance = speak.mock.calls[0][0] as MockUtterance;
        utterance.onerror?.({ error: 'canceled' });
        expect(onError).not.toHaveBeenCalled();
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    test('stopLocalSpeech cancela la síntesis en curso', () => {
        const { cancel } = installSpeechSynthesis([ES_MX]);
        stopLocalSpeech();
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    test('stopLocalSpeech es inofensivo sin speechSynthesis', () => {
        expect(() => stopLocalSpeech()).not.toThrow();
    });
});

describe('localTts — narración sin marcas (punto 10)', () => {
    test('sanitizeForNarration quita markdown, viñetas y slashes', () => {
        const out = sanitizeForNarration('# Título\n- uno // dos *tres*');
        expect(out).not.toContain('#');
        expect(out).not.toContain('/');
        expect(out).not.toContain('*');
        expect(out).toContain('Título');
        expect(out).toContain('uno');
    });

    test('los segmentos narrados no contienen marcas (no dice "slash slash")', () => {
        const segs = buildLocalNarrationSegments('# Carta\n// nota\n- item');
        const joined = segs.map((s) => s.text).join(' ');
        expect(joined).not.toContain('/');
        expect(joined).not.toContain('#');
    });

    test('sin voz del idioma pedido NO se fuerza la voz extranjera', () => {
        const { speak } = installSpeechSynthesis([EN_US]);
        const result = speakLocal('Hola mundo', { lang: 'es' });
        expect(result.started).toBe(true);
        const utterance = speak.mock.calls[0][0] as MockUtterance;
        expect(utterance.lang).toBe('es');
        expect(utterance.voice).toBeNull();
    });
});
