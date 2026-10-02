// @vitest-environment jsdom
/**
 * ThinkingIndicator - pill de "FLU esta pensando" (0%).
 *
 * POR QUE ESTE TEST: el indicador es efimero y esta gobernado por un retraso de
 * entrada de 150ms (anti-parpadeo). Se prueba su politica temporal REAL, que es
 * donde puede fallar: no renderiza nada si no se esta pensando; aparece tras
 * 150ms; a 149ms aun no; si deja de pensar antes del retraso nunca aparece y no
 * deja timers; si estaba visible se desmonta al instante; alternar rapido solo
 * muestra con el ultimo tramo; y desmontar limpia el timer pendiente.
 *
 * Frontera: el hook useThinkingIndicator (selector del integrationStore) se
 * sustituye por un doble con estado mutable. El componente bajo prueba no se
 * mockea.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ state: { isThinking: false } }));

vi.mock('../src/hooks/useThinkingIndicator.js', () => ({
    useThinkingIndicator: () => ({ isThinking: dobles.state.isThinking }),
}));

import { ThinkingIndicator } from '../src/components/ThinkingIndicator.js';

// Construido sin literales no-ASCII (el texto real lleva acento en "esta").
const ACENTO = String.fromCharCode(225);
const TEXTO = `FLU est${ACENTO} pensando...`;
const ARIA = `FLU est${ACENTO} pensando`;

const setThinking = (value: boolean): void => {
    dobles.state.isThinking = value;
};

const avanzar = (ms: number): void => {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
};

beforeEach(() => {
    setThinking(false);
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

// ------------------------------------------------------------
// Bloque: visibilidad y retraso de entrada
// ------------------------------------------------------------
describe('ThinkingIndicator - visibilidad', () => {
    it('no renderiza nada cuando FLU no esta pensando', () => {
        const { container } = render(<ThinkingIndicator />);

        expect(container.firstChild).toBeNull();
    });

    it('tras 150ms con isThinking muestra el indicador y su texto', () => {
        setThinking(true);
        render(<ThinkingIndicator />);

        avanzar(150);

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.getByText(TEXTO)).toBeTruthy();
    });

    it('a los 149ms todavia no aparece (retraso anti-parpadeo)', () => {
        setThinking(true);
        render(<ThinkingIndicator />);

        avanzar(149);

        expect(screen.queryByRole('status')).toBeNull();
    });
});

// ------------------------------------------------------------
// Bloque: cancelacion y limpieza de timers
// ------------------------------------------------------------
describe('ThinkingIndicator - cancelacion', () => {
    it('si deja de pensar antes del retraso nunca aparece ni deja timer', () => {
        setThinking(true);
        const { rerender } = render(<ThinkingIndicator />);
        avanzar(100);

        setThinking(false);
        rerender(<ThinkingIndicator />);
        avanzar(200);

        expect(screen.queryByRole('status')).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('al dejar de pensar estando visible se desmonta al instante', () => {
        setThinking(true);
        const { rerender } = render(<ThinkingIndicator />);
        avanzar(150);
        expect(screen.getByRole('status')).toBeTruthy();

        setThinking(false);
        rerender(<ThinkingIndicator />);

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('desmontar con un timer pendiente lo limpia', () => {
        setThinking(true);
        const { unmount } = render(<ThinkingIndicator />);
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});

// ------------------------------------------------------------
// Bloque: semantica accesible y alternancia rapida
// ------------------------------------------------------------
describe('ThinkingIndicator - semantica', () => {
    it('expone rol status con aria-live y aria-label correctos', () => {
        setThinking(true);
        render(<ThinkingIndicator />);
        avanzar(150);

        const status = screen.getByRole('status');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.getAttribute('aria-label')).toBe(ARIA);
    });

    it('el spinner es decorativo (aria-hidden)', () => {
        setThinking(true);
        const { container } = render(<ThinkingIndicator />);
        avanzar(150);

        const spinner = container.querySelector('.thinking-indicator__spinner');
        expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    });

    it('alternar true/false/true rapido solo muestra con el ultimo tramo', () => {
        setThinking(true);
        const { rerender } = render(<ThinkingIndicator />);
        avanzar(100);

        setThinking(false);
        rerender(<ThinkingIndicator />);
        avanzar(50);

        setThinking(true);
        rerender(<ThinkingIndicator />);
        avanzar(149);
        expect(screen.queryByRole('status')).toBeNull();

        avanzar(1);
        expect(screen.getByRole('status')).toBeTruthy();
    });
});
