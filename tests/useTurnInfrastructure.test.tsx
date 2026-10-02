// @vitest-environment jsdom
// ============================================================
// useTurnInfrastructure - ciclo de vida del turno y escritor off-path (0%)
// ------------------------------------------------------------
// Fronteras sustituidas: createTurnLifecycle, createOffPathWriter, el store
// (subscribe/getState) y el relay de logs. Los dos hooks reales deciden CUANDO
// crear la infraestructura, que transiciones cierran el turno y como encolan.
// ============================================================
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    lifecycle: { isWorking: vi.fn(), markSpeaking: vi.fn(), resetTurn: vi.fn() },
    createTurnLifecycle: vi.fn(),
    writer: { write: vi.fn(), flush: vi.fn() },
    createOffPathWriter: vi.fn(),
    relayLog: vi.fn(),
    getState: vi.fn(),
    unsubscribe: vi.fn(),
    subscribeCb: null as ((state: unknown, prev?: unknown) => void) | null,
}));

vi.mock('../src/voice/lib/turnLifecycle', () => ({ createTurnLifecycle: dobles.createTurnLifecycle }));
vi.mock('../src/voice/lib/offPathWriter', () => ({ createOffPathWriter: dobles.createOffPathWriter }));
vi.mock('../src/store/integrationStore', () => ({
    useIntegrationStore: {
        subscribe: (cb: (state: unknown, prev?: unknown) => void) => {
            dobles.subscribeCb = cb;
            return dobles.unsubscribe;
        },
        getState: dobles.getState,
    },
}));
vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: dobles.relayLog }));

import { useTurnLifecycleSync, useOffPathSessionWriter } from '../src/voice/hooks/useTurnInfrastructure';

beforeEach(() => {
    dobles.lifecycle.isWorking.mockReset().mockReturnValue(false);
    dobles.lifecycle.markSpeaking.mockReset();
    dobles.lifecycle.resetTurn.mockReset();
    dobles.createTurnLifecycle.mockReset().mockReturnValue(dobles.lifecycle);
    dobles.writer.write.mockReset();
    dobles.writer.flush.mockReset();
    dobles.createOffPathWriter.mockReset().mockReturnValue(dobles.writer);
    dobles.relayLog.mockReset();
    dobles.getState.mockReset().mockReturnValue({ conversationState: 'IDLE' });
    dobles.unsubscribe.mockReset();
    dobles.subscribeCb = null;
});

// ------------------------------------------------------------
// Bloque: creacion unica y cableado del ciclo de vida
// ------------------------------------------------------------
describe('useTurnLifecycleSync - creacion y cableado', () => {
    it('crea el ciclo de vida una sola vez y lo devuelve', () => {
        const { result, rerender } = renderHook(() => useTurnLifecycleSync());
        rerender();

        // El hook devuelve la ref: la identidad vive en ref.current.
        expect(result.current.current).toBe(dobles.lifecycle);
        expect(dobles.createTurnLifecycle).toHaveBeenCalledTimes(1);
    });

    it('cablea getStore con el estado del store y log con el relay', () => {
        renderHook(() => useTurnLifecycleSync());

        const arg = dobles.createTurnLifecycle.mock.calls[0][0] as {
            getStore: () => unknown;
            log: (mensaje: string) => void;
        };
        dobles.getState.mockReturnValue({ conversationState: 'THINKING' });
        expect(arg.getStore()).toEqual({ conversationState: 'THINKING' });

        arg.log('hola');
        expect(dobles.relayLog).toHaveBeenCalledWith('LOG', 'useFluVoiceAssistant', 'hola');
    });
});

// ------------------------------------------------------------
// Bloque: transiciones que cierran el turno vivo
// ------------------------------------------------------------
describe('useTurnLifecycleSync - transiciones', () => {
    it('SPEAKING con turno vivo marca el inicio de la voz', () => {
        dobles.lifecycle.isWorking.mockReturnValue(true);
        renderHook(() => useTurnLifecycleSync());

        act(() => {
            dobles.subscribeCb?.({ conversationState: 'SPEAKING' }, { conversationState: 'THINKING' });
        });

        expect(dobles.lifecycle.markSpeaking).toHaveBeenCalledWith('flu-habla');
        expect(dobles.lifecycle.resetTurn).not.toHaveBeenCalled();
    });

    it('un SPEAKING repetido (prev ya SPEAKING) no vuelve a marcar', () => {
        dobles.lifecycle.isWorking.mockReturnValue(true);
        renderHook(() => useTurnLifecycleSync());

        act(() => {
            dobles.subscribeCb?.({ conversationState: 'SPEAKING' }, { conversationState: 'SPEAKING' });
        });

        expect(dobles.lifecycle.markSpeaking).not.toHaveBeenCalled();
    });

    it('ERROR con turno vivo aborta el turno', () => {
        dobles.lifecycle.isWorking.mockReturnValue(true);
        renderHook(() => useTurnLifecycleSync());

        act(() => {
            dobles.subscribeCb?.({ conversationState: 'ERROR' }, { conversationState: 'THINKING' });
        });

        expect(dobles.lifecycle.resetTurn).toHaveBeenCalledWith('flu-error');
        expect(dobles.lifecycle.markSpeaking).not.toHaveBeenCalled();
    });

    it('sin trabajo vivo ninguna transicion cierra nada', () => {
        dobles.lifecycle.isWorking.mockReturnValue(false);
        renderHook(() => useTurnLifecycleSync());

        act(() => {
            dobles.subscribeCb?.({ conversationState: 'SPEAKING' }, { conversationState: 'IDLE' });
            dobles.subscribeCb?.({ conversationState: 'ERROR' }, { conversationState: 'IDLE' });
        });

        expect(dobles.lifecycle.markSpeaking).not.toHaveBeenCalled();
        expect(dobles.lifecycle.resetTurn).not.toHaveBeenCalled();
    });

    it('un IDLE intermedio no cierra el turno', () => {
        dobles.lifecycle.isWorking.mockReturnValue(true);
        renderHook(() => useTurnLifecycleSync());

        act(() => {
            dobles.subscribeCb?.({ conversationState: 'IDLE' }, { conversationState: 'THINKING' });
        });

        expect(dobles.lifecycle.markSpeaking).not.toHaveBeenCalled();
        expect(dobles.lifecycle.resetTurn).not.toHaveBeenCalled();
    });

    it('al desmontar se cancela la suscripcion', () => {
        const { unmount } = renderHook(() => useTurnLifecycleSync());
        expect(dobles.unsubscribe).not.toHaveBeenCalled();

        unmount();

        expect(dobles.unsubscribe).toHaveBeenCalledTimes(1);
    });
});

// ------------------------------------------------------------
// Bloque: escritor de sesion fuera del camino critico
// ------------------------------------------------------------
describe('useOffPathSessionWriter', () => {
    it('crea el escritor con run y onError y delega cada write', () => {
        const run = vi.fn<(p: object) => Promise<unknown>>();
        const onError = vi.fn<(e: Error) => void>();
        const { result } = renderHook(() => useOffPathSessionWriter(run, onError));

        expect(dobles.createOffPathWriter).toHaveBeenCalledWith(run, onError);

        (result.current.write as unknown as (p: object) => void)({ a: 1 });
        expect(dobles.writer.write).toHaveBeenCalledWith({ a: 1 });
    });

    it('el escritor no se recrea aunque cambie run', () => {
        const runA = vi.fn<(p: object) => Promise<unknown>>();
        const runB = vi.fn<(p: object) => Promise<unknown>>();
        const { rerender } = renderHook(
            ({ run }: { run: (p: object) => Promise<unknown> }) => useOffPathSessionWriter(run),
            { initialProps: { run: runA } },
        );
        rerender({ run: runB });

        expect(dobles.createOffPathWriter).toHaveBeenCalledTimes(1);
    });

    it('sin onError el escritor se crea igual con undefined', () => {
        const run = vi.fn<(p: object) => Promise<unknown>>();
        renderHook(() => useOffPathSessionWriter(run));

        expect(dobles.createOffPathWriter).toHaveBeenCalledWith(run, undefined);
    });
});
