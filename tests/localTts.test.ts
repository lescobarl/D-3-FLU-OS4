// ============================================================
// localTts — adaptador del motor ÚNICO de síntesis (C21)
// ============================================================
// Esta capa NO toca el motor del navegador: consume la API de
// fluSpeech. Los tests verifican (a) las funciones puras y
// (b) la delegación, con el módulo de voz mockeado. Determinista:
// no depende de speechSynthesis real ni de timing.
// ============================================================
import { describe, test, expect, vi, beforeEach } from 'vitest';

interface MockVoice {
    name: string;
    lang: string;
    localService: boolean;
    default: boolean;
    voiceURI: string;
}

const mocks = vi.hoisted(() => ({
    speakResponse: vi.fn(() => Promise.resolve()),
    cancelSpeech: vi.fn(),
    isSpeechBusy: vi.fn(() => false),
    isSpeechSupported: vi.fn(() => true),
    voices: [] as MockVoice[],
}));

vi.mock('../src/voice/lib/fluSpeech', () => ({
    speakResponse: mocks.speakResponse,
    cancelSpeech: mocks.cancelSpeech,
    isSpeechBusy: mocks.isSpeechBusy,
    isSpeechSupported: mocks.isSpeechSupported,
    getSpeechVoices: () => mocks.voices,
}));

import {
    buildLocalNarrationSegments,
    getLocalVoices,
    isLocalTtsAvailable,
    isTtsSpeaking,
    pickBestLocalVoice,
    sanitizeForNarration,
    speakLocal,
    stopLocalSpeech,
} from '../src/services/localTts';

beforeEach(() => {
    mocks.speakResponse.mockReset().mockImplementation(() => Promise.resolve());
    mocks.cancelSpeech.mockClear();
    mocks.isSpeechBusy.mockReset().mockReturnValue(false);
    mocks.isSpeechSupported.mockReset().mockReturnValue(true);
    mocks.voices = [];
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
        expect(pickBestLocalVoice(voices, 'es-MX')?.voiceURI).toBe('es-MX-Sabina');
    });

    test('acepta prefijo de idioma (es → es-MX)', () => {
        expect(pickBestLocalVoice(voices, 'es')?.voiceURI).toBe('es-MX-Sabina');
    });

    test('usa la familia de idioma cuando no hay prefijo exacto', () => {
        expect(pickBestLocalVoice(voices, 'es-ES')?.voiceURI).toBe('es-MX-Sabina');
    });

    test('sin voces devuelve null', () => {
        expect(pickBestLocalVoice([], 'es')).toBeNull();
    });

    test('con lista no vacía siempre elige la primera como último recurso', () => {
        expect(pickBestLocalVoice(voices, 'fr')).not.toBeNull();
    });
});

describe('localTts — getLocalVoices / isLocalTtsAvailable', () => {
    test('filtra solo voces locales (localService)', () => {
        mocks.voices = [ES_MX, EN_US];
        expect(getLocalVoices().map((v) => v.voiceURI)).toEqual(['es-MX-Sabina', 'en-US-Aria']);
        expect(isLocalTtsAvailable()).toBe(true);
    });

    test('sin voces devuelve vacío', () => {
        expect(getLocalVoices()).toEqual([]);
        expect(isLocalTtsAvailable()).toBe(false);
    });

    test('si el navegador no marca localService, devuelve todas las voces', () => {
        mocks.voices = [{ ...EN_US, localService: false }];
        expect(getLocalVoices().map((v) => v.voiceURI)).toEqual(['en-US-Aria']);
    });
});

describe('localTts — speakLocal delega en el motor ÚNICO', () => {
    test('pronuncia con el idioma pedido y pasa rate/pitch al motor', () => {
        mocks.voices = [ES_MX, EN_US];
        const result = speakLocal('Hola mundo', { lang: 'es', rate: 1.1, pitch: 0.9 });
        expect(result).toEqual({ started: true });
        expect(mocks.speakResponse).toHaveBeenCalledTimes(1);
        expect(mocks.speakResponse).toHaveBeenCalledWith('Hola mundo', 'es', {
            rate: 1.1,
            pitch: 0.9,
        });
    });

    test('invoca onStart al encolar y onEnd al resolver la locución', async () => {
        mocks.voices = [ES_MX];
        const onStart = vi.fn();
        const onEnd = vi.fn();
        const result = speakLocal('Hola', { onStart, onEnd });
        expect(result.started).toBe(true);
        expect(onStart).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    test('un fallo del motor se reporta por onError (no se traga)', async () => {
        mocks.voices = [ES_MX];
        const boom = new Error('motor caído');
        mocks.speakResponse.mockImplementation(() => Promise.reject(boom));
        const onError = vi.fn();
        speakLocal('Hola', { onError });
        await Promise.resolve();
        await Promise.resolve();
        expect(onError).toHaveBeenCalledWith(boom);
    });

    test('sin voces locales no pronuncia y devuelve no-local-voice', () => {
        const result = speakLocal('Hola', { lang: 'es' });
        expect(result).toEqual({ started: false, error: 'no-local-voice' });
        expect(mocks.speakResponse).not.toHaveBeenCalled();
    });

    test('texto vacío no se pronuncia', () => {
        mocks.voices = [ES_MX];
        expect(speakLocal('   ', { lang: 'es' })).toEqual({ started: false, error: 'empty-text' });
        expect(mocks.speakResponse).not.toHaveBeenCalled();
    });

    test('sin motor TTS devuelve tts-unavailable', () => {
        mocks.isSpeechSupported.mockReturnValue(false);
        expect(speakLocal('Hola', { lang: 'es' })).toEqual({
            started: false,
            error: 'tts-unavailable',
        });
    });

    test('stopLocalSpeech delega la cancelación en el motor ÚNICO', () => {
        stopLocalSpeech();
        expect(mocks.cancelSpeech).toHaveBeenCalledTimes(1);
    });

    test('isTtsSpeaking refleja el estado del motor ÚNICO', () => {
        expect(isTtsSpeaking()).toBe(false);
        mocks.isSpeechBusy.mockReturnValue(true);
        expect(isTtsSpeaking()).toBe(true);
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
});
