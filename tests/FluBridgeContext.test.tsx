// @vitest-environment jsdom
// ============================================================
// FluBridgeContext - contexto React para props del bridge (0%).
// ------------------------------------------------------------
// Modulo puro (createContext + useMemo) sin fronteras externas: se importa
// REAL y se ejercita con render/renderHook de @testing-library/react. Se
// cubren: fallback sin provider, entrega e identidad del value, campos
// opcionales, invocacion de callbacks, refs mutables, memoizacion por
// referencia, actualizacion via rerender, children y providers anidados.
// ============================================================
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FluBridgeProvider, useFluBridge } from '../src/context/FluBridgeContext';
import type { FluBridgeContextValue } from '../src/context/FluBridgeContext';

const makeValue = (over: Partial<FluBridgeContextValue> = {}): FluBridgeContextValue => ({ ...over });

const wrap = (value: FluBridgeContextValue) =>
    ({ children }: { children: ReactNode }) => (
        <FluBridgeProvider value={value}>{children}</FluBridgeProvider>
    );

// ------------------------------------------------------------
// Bloque A: fallback sin provider
// ------------------------------------------------------------
describe('useFluBridge - sin provider', () => {
    it('devuelve un objeto vacio', () => {
        const { result } = renderHook(() => useFluBridge());

        expect(result.current).toEqual({});
    });

    it('el fallback no expone ninguna prop', () => {
        const { result } = renderHook(() => useFluBridge());

        expect(Object.keys(result.current)).toEqual([]);
        expect(result.current.apiKey).toBeUndefined();
    });
});

// ------------------------------------------------------------
// Bloque B: entrega del value
// ------------------------------------------------------------
describe('useFluBridge - value del provider', () => {
    it('devuelve el MISMO objeto entregado (identidad)', () => {
        const value = makeValue({ apiKey: 'k' });
        const { result } = renderHook(() => useFluBridge(), { wrapper: wrap(value) });

        expect(result.current).toBe(value);
    });

    it('expone estado de voz y configuracion', () => {
        const value = makeValue({
            voiceStatus: 'LISTENING',
            liveTranscript: 'hola',
            apiKey: 'k',
            language: 'es',
            welcomeMessage: 'bienvenido',
        });
        const { result } = renderHook(() => useFluBridge(), { wrapper: wrap(value) });

        expect(result.current.voiceStatus).toBe('LISTENING');
        expect(result.current.liveTranscript).toBe('hola');
        expect(result.current.apiKey).toBe('k');
        expect(result.current.language).toBe('es');
        expect(result.current.welcomeMessage).toBe('bienvenido');
    });

    it('invoca el callback entregado', async () => {
        const onToggle = vi.fn(async () => undefined);
        const value = makeValue({ onToggleListening: onToggle });
        const { result } = renderHook(() => useFluBridge(), { wrapper: wrap(value) });

        await act(async () => {
            await result.current.onToggleListening?.();
        });

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('expone refs mutables de animos de emocion', () => {
        const anims = vi.fn();
        const value = makeValue({ onEmotionAnimsRef: { current: null } });
        const { result } = renderHook(() => useFluBridge(), { wrapper: wrap(value) });

        const ref = result.current.onEmotionAnimsRef;
        expect(ref).toBeTruthy();
        if (ref) ref.current = anims;
        ref?.current?.(['Dance']);

        expect(anims).toHaveBeenCalledWith(['Dance']);
    });

    it('un value parcial no rompe y mantiene undefined el resto', () => {
        const value = makeValue({ apiKey: 'solo-key' });
        const { result } = renderHook(() => useFluBridge(), { wrapper: wrap(value) });

        expect(result.current.apiKey).toBe('solo-key');
        expect(result.current.voiceStatus).toBeUndefined();
        expect(result.current.onStartListening).toBeUndefined();
    });
});

// ------------------------------------------------------------
// Bloque C: memoizacion y reactividad
// ------------------------------------------------------------
describe('useFluBridge - memoizacion y reactividad', () => {
    it('mantiene la referencia del contexto si el value no cambia', () => {
        let captured: FluBridgeContextValue | null = null;
        function Capture() {
            captured = useFluBridge();
            return null;
        }
        const value = makeValue({ apiKey: 'x' });
        const { rerender } = render(
            <FluBridgeProvider value={value}>
                <Capture key="a" />
            </FluBridgeProvider>,
        );
        const first = captured;

        rerender(
            <FluBridgeProvider value={value}>
                <Capture key="b" />
                <span>extra</span>
            </FluBridgeProvider>,
        );

        expect(captured).toBe(first);
    });

    it('un value nuevo produce referencia nueva y valores actualizados', () => {
        let captured: FluBridgeContextValue | null = null;
        function Capture() {
            captured = useFluBridge();
            return null;
        }
        const v1 = makeValue({ apiKey: 'a' });
        const v2 = makeValue({ apiKey: 'b' });
        const { rerender } = render(
            <FluBridgeProvider value={v1}>
                <Capture />
            </FluBridgeProvider>,
        );
        const first = captured;

        rerender(
            <FluBridgeProvider value={v2}>
                <Capture />
            </FluBridgeProvider>,
        );

        expect(captured).not.toBe(first);
        expect(captured).toEqual(v2);
    });

    it('el hook refleja el value actualizado tras rerender', () => {
        let current = makeValue({ language: 'es' });
        const { result, rerender } = renderHook(() => useFluBridge(), {
            wrapper: ({ children }: { children: ReactNode }) => (
                <FluBridgeProvider value={current}>{children}</FluBridgeProvider>
            ),
        });
        expect(result.current.language).toBe('es');

        current = makeValue({ language: 'en' });
        rerender();

        expect(result.current.language).toBe('en');
    });
});

// ------------------------------------------------------------
// Bloque D: composicion
// ------------------------------------------------------------
describe('FluBridgeProvider - composicion', () => {
    it('renderiza los children', () => {
        render(
            <FluBridgeProvider value={makeValue()}>
                <span>contenido hijo</span>
            </FluBridgeProvider>,
        );

        expect(screen.getByText('contenido hijo')).toBeTruthy();
    });

    it('con providers anidados gana el value interno', () => {
        const outer = makeValue({ apiKey: 'outer' });
        const inner = makeValue({ apiKey: 'inner' });
        const { result } = renderHook(() => useFluBridge(), {
            wrapper: ({ children }: { children: ReactNode }) => (
                <FluBridgeProvider value={outer}>
                    <FluBridgeProvider value={inner}>{children}</FluBridgeProvider>
                </FluBridgeProvider>
            ),
        });

        expect(result.current.apiKey).toBe('inner');
    });
});
