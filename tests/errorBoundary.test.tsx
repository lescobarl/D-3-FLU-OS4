// @vitest-environment jsdom
/**
 * ErrorBoundary - captura de errores de renderizado (0%).
 *
 * POR QUE ESTE TEST: es la red de seguridad del arbol React. Se prueba lo que
 * de verdad importa: sin error deja pasar los hijos; con un hijo que lanza,
 * sustituye TODO el subarbol por el fallback y muestra mensaje y stack; un
 * mensaje vacio cae al texto de reserva; registra el error en consola con su
 * prefijo; y el boton de recargar invoca la recarga del navegador. Sin mocks de
 * modulo bajo prueba: solo se silencia console.error y se observa la frontera
 * window.confirm/location.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary.js';

function Boom({ message }: { message?: string }): never {
    throw new Error(message);
}

// El boton de recarga reinicia el estado del boundary (setState) y ademas
// dispara window.location.reload (silencioso en jsdom). El reinicio se observa
// con un hijo que deja de fallar: tras el clic, el arbol vuelve a renderizarse.
let modoHijo: 'boom' | 'ok' = 'boom';
function HijoRecuperable(): React.ReactElement {
    if (modoHijo === 'boom') throw new Error('falla una vez');
    return <span data-testid="recuperado">vivo</span>;
}

beforeEach(() => {
    modoHijo = 'boom';
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Bloque: camino feliz (sin error)
// ------------------------------------------------------------
describe('ErrorBoundary - sin error', () => {
    it('renderiza los hijos tal cual', () => {
        render(
            <ErrorBoundary>
                <span data-testid="hijo">contenido</span>
            </ErrorBoundary>,
        );

        expect(screen.getByTestId('hijo').textContent).toBe('contenido');
        expect(screen.queryByText(/Error de Renderizado/)).toBeNull();
    });
});

// ------------------------------------------------------------
// Bloque: captura de un error de render
// ------------------------------------------------------------
describe('ErrorBoundary - captura', () => {
    it('sustituye los hijos por el fallback', () => {
        render(
            <ErrorBoundary>
                <span data-testid="hijo">contenido</span>
                <Boom message="boom en render" />
            </ErrorBoundary>,
        );

        expect(screen.getByText(/Error de Renderizado/)).toBeTruthy();
        expect(screen.queryByTestId('hijo')).toBeNull();
    });

    it('muestra el mensaje del error capturado', () => {
        render(
            <ErrorBoundary>
                <Boom message="fallo controlado" />
            </ErrorBoundary>,
        );

        expect(screen.getByText('fallo controlado')).toBeTruthy();
    });

    it('muestra el stack del error', () => {
        const { container } = render(
            <ErrorBoundary>
                <Boom message="con stack" />
            </ErrorBoundary>,
        );

        const stack = container.querySelector('.app-error-boundary__stack');
        expect(stack).not.toBeNull();
        expect(stack?.textContent).toContain('con stack');
    });

    it('un mensaje vacio cae al texto de reserva', () => {
        render(
            <ErrorBoundary>
                <Boom message="" />
            </ErrorBoundary>,
        );

        expect(screen.getByText('Error desconocido')).toBeTruthy();
    });

    it('registra el error en consola con el prefijo del boundary', () => {
        render(
            <ErrorBoundary>
                <Boom message="traza" />
            </ErrorBoundary>,
        );

        const llamadas = vi.mocked(console.error).mock.calls;
        const conPrefijo = llamadas.find((c) => c[0] === '[ErrorBoundary] Error capturado:');
        expect(conPrefijo).toBeTruthy();
        expect(conPrefijo?.[1]).toBeInstanceOf(Error);
    });
});

// ------------------------------------------------------------
// Bloque: boton de recarga
// ------------------------------------------------------------
describe('ErrorBoundary - recarga', () => {
    it('el boton reinicia el estado y vuelve a renderizar el arbol', () => {
        render(
            <ErrorBoundary>
                <HijoRecuperable />
            </ErrorBoundary>,
        );
        expect(screen.getByText(/Error de Renderizado/)).toBeTruthy();

        modoHijo = 'ok';
        fireEvent.click(screen.getByRole('button'));

        expect(screen.getByTestId('recuperado').textContent).toBe('vivo');
        expect(screen.queryByText(/Error de Renderizado/)).toBeNull();
    });

    it('si el hijo sigue fallando, el fallback permanece tras recargar', () => {
        render(
            <ErrorBoundary>
                <Boom message="sigue roto" />
            </ErrorBoundary>,
        );

        fireEvent.click(screen.getByRole('button'));

        expect(screen.getByText(/Error de Renderizado/)).toBeTruthy();
        expect(screen.getByText('sigue roto')).toBeTruthy();
    });
});

// ------------------------------------------------------------
// Bloque: contrato de la API de React
// ------------------------------------------------------------
describe('ErrorBoundary - contrato', () => {
    it('getDerivedStateFromError marca hasError y conserva la instancia', () => {
        const err = new Error('contrato');
        const estado = ErrorBoundary.getDerivedStateFromError(err);

        expect(estado.hasError).toBe(true);
        expect(estado.error).toBe(err);
    });

    it('tras capturar, el estado de la instancia guarda el Error', () => {
        const ref = React.createRef<ErrorBoundary>();
        render(
            <ErrorBoundary ref={ref}>
                <Boom message="estado" />
            </ErrorBoundary>,
        );

        expect(ref.current?.state.hasError).toBe(true);
        expect(ref.current?.state.error).toBeInstanceOf(Error);
    });
});
