// @vitest-environment jsdom
// ============================================================
// Guard — la supresión de eco del TTS no puede quedar pegada
// ------------------------------------------------------------
// Causa raíz del bug "no transcribe nada después del onboarding":
// el guard del micrófono usaba `speechSynthesis.speaking` (flag GLOBAL del
// navegador), que puede quedar en `true` tras intercalar
// cancel/speak/resume (onboarding) y descartaba TODOS los resultados hasta
// recargar. Este guard ejecuta el ciclo real de habla: si el utterance nunca
// dispara `onend`, el watchdog debe liberar; y si el flag global quedó pegado
// sin habla propia, la siguiente locución no debe descartarse.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/store/integrationStore', () => ({
    useIntegrationStore: {
        getState: () => ({}),
        setState: () => undefined,
    },
}));

import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import { speakResponse, isFluSpeaking } from '../src/voice/lib/fluSpeech';

class FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
        this.text = text;
    }
}

interface SynthStub {
    speaking: boolean;
    pending: boolean;
    getVoices: () => unknown[];
    addEventListener: () => void;
    removeEventListener: () => void;
    speak: (u: FakeUtterance) => void;
    cancel: () => void;
    resume: () => void;
}

/** Sintetizador que NUNCA dispara onend (simula el bug de Chrome). */
function installStuckSynth(): SynthStub {
    const synth: SynthStub = {
        speaking: false,
        pending: false,
        getVoices: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        speak: () => {
            synth.speaking = true;
        },
        cancel: () => {
            synth.speaking = false;
            synth.pending = false;
        },
        resume: () => {},
    };
    (window as unknown as { speechSynthesis: SynthStub }).speechSynthesis = synth;
    (globalThis as unknown as { SpeechSynthesisUtterance: typeof FakeUtterance }).SpeechSynthesisUtterance =
        FakeUtterance;
    return synth;
}

describe('TTS — la supresión de eco se libera sola (no se queda pegada)', () => {
    const originalWatchdog = FLU_CONFIG.speech?.watchdogMs;

    beforeEach(() => {
        // Watchdog corto para no esperar 20s reales (config data-driven).
        FLU_CONFIG.speech = { ...FLU_CONFIG.speech, watchdogMs: 30 };
        installStuckSynth();
    });

    afterEach(() => {
        FLU_CONFIG.speech = { ...FLU_CONFIG.speech, watchdogMs: originalWatchdog };
        vi.restoreAllMocks();
    });

    it('si el utterance nunca termina, el watchdog libera el habla', async () => {
        const promise = speakResponse('hola mundo', 'es');
        expect(isFluSpeaking()).toBe(true);
        await promise;
        expect(isFluSpeaking()).toBe(false);
    });

    it('si el flag global quedó pegado sin habla propia, la locución no se descarta', async () => {
        const synth = installStuckSynth();
        synth.speaking = true; // flag pegado, sin promesa activa
        synth.pending = false;

        const promise = speakResponse('segunda locución', 'es');
        expect(isFluSpeaking()).toBe(true);
        await promise;
        expect(isFluSpeaking()).toBe(false);
    });
});
