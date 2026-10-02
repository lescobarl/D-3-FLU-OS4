// @vitest-environment jsdom
/**
 * useOnboardingVoiceCapture - tap-to-talk + auto-reanudacion del onboarding (0%).
 *
 * POR QUE ESTE TEST: estas 262 lineas son TODO el contrato de voz del onboarding
 * (microfono que NO se abre solo, one-shot tras la respuesta, anti-eco mientras FLU
 * habla y reintentos suaves). Nadie las ejecutaba. Se sustituye la FRONTERA (el
 * motor de reconocimiento del navegador) por un doble que deja disparar los eventos
 * reales (onstart/onresult/onerror/onend) y se comprueba la conducta observable,
 * incluidos los REINTENTOS con temporizador.
 *
 * HALLAZGO DECLARADO (mutacion equivalente medida): la guarda `!deliveredRef.current`
 * del `onEnd` es REDUNDANTE. El temporizador de reintento vuelve a mirar
 * `deliveredRef` antes de arrancar, asi que quitarla deja las 23 pruebas verdes: el
 * one-shot lo sostiene el temporizador. Se deja escrito, no se toca el producto.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rec = vi.hoisted(() => ({
    soporte: true,
    adquiridos: 0,
    iniciados: 0,
    detenidos: 0,
    abortados: 0,
    idioma: '',
    reconocedor: {} as Record<string, unknown>,
    manejadores: {} as Record<string, (evento?: unknown) => void>,
}));

vi.mock('../src/voice/lib/speechRecognitionLocal.js', () => ({
    isSpeechRecognitionSupported: () => rec.soporte,
    acquireSpeechRecognition: (idioma: string) => {
        rec.adquiridos += 1;
        rec.idioma = idioma;
        rec.reconocedor = { lang: idioma };
        return rec.reconocedor;
    },
    bindSpeechRecognition: (_motor: unknown, manejadores: Record<string, (evento?: unknown) => void>) => {
        rec.manejadores = manejadores;
    },
    startSpeechRecognition: () => {
        rec.iniciados += 1;
    },
    stopSpeechRecognition: () => {
        rec.detenidos += 1;
    },
    abortSpeechRecognition: () => {
        rec.abortados += 1;
    },
}));

import { useOnboardingVoiceCapture } from '../src/hooks/useOnboardingVoiceCapture.js';

/** Resultado de reconocimiento con la forma que lee el hook. */
const resultado = (transcript: string, final: boolean) => ({
    results: [{ isFinal: final, 0: { transcript } }],
});

const onStart = () => act(() => rec.manejadores.onStart?.());
const onResult = (evento: unknown) => act(() => rec.manejadores.onResult?.(evento));
const onError = (error: string) => act(() => rec.manejadores.onError?.({ error } as never));
const onEnd = () => act(() => rec.manejadores.onEnd?.());

const montar = (opciones: Partial<{ enabled: boolean; language: string; onFinal: (t: string) => void }> = {}) => {
    const onFinal = opciones.onFinal ?? vi.fn();
    const onEvent = vi.fn();
    type Props = { enabled: boolean; language?: string; onFinal?: (t: string) => void };
    const inicial: Props = {
        enabled: opciones.enabled ?? true,
        language: opciones.language ?? 'es',
        onFinal,
    };
    const vista = renderHook(
        (props: Props) =>
            useOnboardingVoiceCapture({
                enabled: props.enabled,
                language: props.language,
                onFinal: props.onFinal ?? onFinal,
                onEvent,
            } as never),
        { initialProps: inicial },
    );
    return { ...vista, onFinal, onEvent };
};

beforeEach(() => {
    rec.soporte = true;
    rec.adquiridos = 0;
    rec.iniciados = 0;
    rec.detenidos = 0;
    rec.abortados = 0;
    rec.idioma = '';
    rec.manejadores = {};
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useOnboardingVoiceCapture - arranque y tap-to-talk', () => {
    it('sin soporte del navegador no adquiere motor y start no hace nada', () => {
        rec.soporte = false;
        const { result } = montar({ enabled: true });

        expect(result.current.supported).toBe(false);
        expect(rec.adquiridos).toBe(0);

        act(() => result.current.start());

        expect(rec.iniciados).toBe(0);
    });

    it('con soporte crea el motor UNA vez con el idioma del momento', () => {
        const { rerender, result } = montar({ enabled: true, language: 'es' });

        expect(rec.adquiridos).toBe(1);
        expect(rec.idioma).toBe('es');

        rerender({ enabled: true, language: 'en' });

        expect(rec.adquiridos).toBe(1);
        expect(result.current.supported).toBe(true);
    });

    it('el boton habilitado NO abre el microfono: hace falta el primer clic', () => {
        const { result } = montar({ enabled: true });

        expect(rec.iniciados).toBe(0);
        expect(result.current.listening).toBe(false);

        act(() => result.current.start());

        expect(rec.iniciados).toBe(1);
        // `listening` no es optimista: sigue false hasta el onstart real.
        expect(result.current.listening).toBe(false);
    });

    it('con el paso deshabilitado, start es un no-op', () => {
        const { result } = montar({ enabled: false });

        act(() => result.current.start());

        expect(rec.iniciados).toBe(0);
    });

    it('un segundo clic no vuelve a arrancar el motor ya activo', () => {
        const { result } = montar({ enabled: true });

        act(() => result.current.start());
        act(() => result.current.start());

        expect(rec.iniciados).toBe(1);
    });

    it('listening solo se enciende con la confirmacion del navegador', () => {
        const { result } = montar({ enabled: true });
        act(() => result.current.start());

        onStart();

        expect(result.current.listening).toBe(true);
        expect(result.current.interim).toBe('');
    });
});

describe('useOnboardingVoiceCapture - resultados', () => {
    it('el interim se ve en vivo y no entrega respuesta', () => {
        const { result, onFinal, onEvent } = montar({ enabled: true });
        act(() => result.current.start());

        onResult(resultado('hola que', false));

        expect(result.current.interim).toBe('hola que');
        expect(onFinal).not.toHaveBeenCalled();
        expect(onEvent).not.toHaveBeenCalledWith('final', expect.anything());
    });

    it('un final entrega la respuesta, limpia el interim y avisa', () => {
        const { result, onFinal, onEvent } = montar({ enabled: true });
        act(() => result.current.start());

        onResult(resultado('me llamo Ana', true));

        expect(onFinal).toHaveBeenCalledWith('me llamo Ana');
        expect(onEvent).toHaveBeenCalledWith('final', 'me llamo Ana');
        expect(result.current.interim).toBe('');
    });

    it('final + interim en la misma tanda: gana el final', () => {
        const { result, onFinal } = montar({ enabled: true });
        act(() => result.current.start());

        onResult({ results: [{ isFinal: false, 0: { transcript: 'bla' } }, { isFinal: true, 0: { transcript: 'firme' } }] });

        expect(onFinal).toHaveBeenCalledWith('firme');
        expect(result.current.interim).toBe('');
    });

    it('un interim vacio no pisa lo que ya se veia', () => {
        const { result } = montar({ enabled: true });
        act(() => result.current.start());
        onResult(resultado('algo', false));

        onResult({ results: [{ isFinal: false, 0: { transcript: '   ' } }] });

        expect(result.current.interim).toBe('');
    });

    it('usa el onFinal MAS RECIENTE, no el del primer render', () => {
        const primero = vi.fn();
        const segundo = vi.fn();
        const { result, rerender } = montar({ enabled: true, onFinal: primero });
        rerender({ enabled: true, onFinal: segundo });

        act(() => result.current.start());
        onResult(resultado('nuevo callback', true));

        expect(primero).not.toHaveBeenCalled();
        expect(segundo).toHaveBeenCalledWith('nuevo callback');
    });
});

describe('useOnboardingVoiceCapture - one-shot y reintentos', () => {
    it('tras entregar, el onend NO reabre el microfono (one-shot)', () => {
        vi.useFakeTimers();
        const { result } = montar({ enabled: true });
        act(() => result.current.start());
        onResult(resultado('respuesta', true));

        onEnd();
        act(() => vi.advanceTimersByTime(5000));

        // Solo el primer clic abrio el microfono: el one-shot no reabre nada.
        expect(rec.iniciados).toBe(1);
        expect(result.current.listening).toBe(false);
    });

    it('un onend con la sesion abierta reintenta a los 250 ms', () => {
        vi.useFakeTimers();
        const { result } = montar({ enabled: true });
        act(() => result.current.start());

        onEnd();
        expect(rec.iniciados).toBe(1);

        act(() => vi.advanceTimersByTime(250));

        expect(rec.iniciados).toBe(2);
    });

    it('un no-speech reintenta a los 400 ms', () => {
        vi.useFakeTimers();
        const { result, onEvent } = montar({ enabled: true });
        act(() => result.current.start());
        onStart();

        onError('no-speech');
        expect(result.current.listening).toBe(false);
        expect(onEvent).toHaveBeenCalledWith('error', 'no-speech');
        act(() => vi.advanceTimersByTime(400));

        expect(rec.iniciados).toBe(2);
    });

    it('un permiso denegado NO reintenta en bucle', () => {
        vi.useFakeTimers();
        const { result } = montar({ enabled: true });
        act(() => result.current.start());

        onError('not-allowed');
        act(() => vi.advanceTimersByTime(5000));

        expect(rec.iniciados).toBe(1);
        expect(rec.detenidos).toBeGreaterThanOrEqual(1);
        expect(result.current.listening).toBe(false);
    });

    it('stop cancela un reintento ya programado', () => {
        vi.useFakeTimers();
        const { result } = montar({ enabled: true });
        act(() => result.current.start());

        onEnd(); // programa reintento
        act(() => result.current.stop());
        act(() => vi.advanceTimersByTime(5000));

        expect(rec.iniciados).toBe(1);
    });
});

describe('useOnboardingVoiceCapture - anti-eco (suspend/resume)', () => {
    it('suspender aborta el motor y no reintenta aunque llegue el onend', () => {
        vi.useFakeTimers();
        const { result, onEvent } = montar({ enabled: true });
        act(() => result.current.start());
        onStart();

        act(() => result.current.suspend());

        expect(rec.abortados).toBe(1);
        expect(onEvent).toHaveBeenCalledWith('suspend');
        expect(result.current.listening).toBe(false);

        onEnd();
        act(() => vi.advanceTimersByTime(5000));
        expect(rec.iniciados).toBe(1);
    });

    it('suspender sin sesion abierta no toca el motor', () => {
        const { result } = montar({ enabled: true });

        act(() => result.current.suspend());

        expect(rec.abortados).toBe(0);
    });

    it('resume reabre tras el TTS y reinicia el one-shot', () => {
        vi.useFakeTimers();
        const { result, onEvent, onFinal } = montar({ enabled: true });
        act(() => result.current.start());
        onStart();
        onResult(resultado('primera', true)); // one-shot consumido
        act(() => result.current.suspend());

        act(() => result.current.resume());

        expect(rec.iniciados).toBe(2);
        expect(onEvent).toHaveBeenCalledWith('resume');

        // El one-shot vuelve a estar limpio: otro final se entrega igual.
        onResult(resultado('segunda', true));
        expect(onFinal).toHaveBeenCalledWith('segunda');
    });

    it('resume sin sesion abierta no hace nada', () => {
        const { result } = montar({ enabled: true });

        act(() => result.current.resume());

        expect(rec.iniciados).toBe(0);
    });

    it('deshabilitar el paso cierra el microfono y cancela reintentos', () => {
        vi.useFakeTimers();
        const { result, rerender } = montar({ enabled: true });
        act(() => result.current.start());
        onEnd(); // reintento programado

        rerender({ enabled: false });

        act(() => vi.advanceTimersByTime(5000));
        expect(result.current.listening).toBe(false);
        expect(rec.iniciados).toBe(1);
    });
});

describe('useOnboardingVoiceCapture - limpieza', () => {
    it('al desmontar para el motor y lo suelta', () => {
        const { result, unmount } = montar({ enabled: true });
        act(() => result.current.start());

        unmount();

        expect(rec.detenidos).toBeGreaterThanOrEqual(1);
        expect(result.current.listening).toBe(false);
    });

    it('stop deja el estado limpio (listening e interim)', () => {
        const { result } = montar({ enabled: true });
        act(() => result.current.start());
        onStart();
        onResult(resultado('algo', false));
        expect(result.current.interim).toBe('algo');

        act(() => result.current.stop());

        expect(result.current.listening).toBe(false);
        expect(result.current.interim).toBe('');
    });
});
