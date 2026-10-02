// @vitest-environment jsdom
/**
 * useNotificationCenter - el centro de notificaciones (0%).
 *
 * POR QUE ESTE TEST: 192 lineas que deciden como se ENTREGA una notificacion
 * (toast, voz o ambas), llevan el historial consultable y el contador de no leidas.
 * Se sustituye la frontera (el servicio) y se emite el EVENTO REAL del bus
 * ('flu-notification') para ejercitar la conducta: stack con tope, expiracion del
 * toast, historial con tope, voz solo cuando corresponde y respeto del canal/DND.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crear: vi.fn(),
    servicio: {
        getChannel: vi.fn(() => 'toast' as string),
        setChannel: vi.fn(),
        setDnd: vi.fn(),
    },
    argumentos: null as unknown,
}));

vi.mock('../src/core/notifications/notificationService.js', () => ({
    NOTIFICATION_EVENT: 'flu-notification',
    createNotificationService: (opciones: unknown) => {
        dobles.argumentos = opciones;
        dobles.crear(opciones);
        return dobles.servicio;
    },
}));

import { useNotificationCenter } from '../src/hooks/useNotificationCenter.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const config = FLU_CONFIG.notifications as unknown as Record<string, unknown>;

const aviso = (over: Record<string, unknown> = {}) => ({
    id: `n${Math.round(Math.random() * 1e6)}`,
    title: 'Titulo',
    body: 'Cuerpo',
    category: 'agenda',
    urgent: false,
    timestamp: 1,
    ...over,
});

/** Emite el evento real del bus con la entrega indicada. */
const emitir = (delivery: string, notification = aviso()) =>
    act(() => {
        window.dispatchEvent(new CustomEvent('flu-notification', { detail: { notification, delivery } }));
    });

const montar = (over: Partial<Record<string, unknown>> = {}) =>
    renderHook(() =>
        useNotificationCenter({
            speak: (over.speak as never) ?? (vi.fn(async () => {}) as never),
            language: (over.language as string) ?? 'es',
            dnd: over.dnd as never,
        }),
    );

beforeEach(() => {
    dobles.crear.mockClear();
    dobles.servicio.getChannel.mockReturnValue('toast');
    dobles.servicio.setChannel.mockClear();
    dobles.servicio.setDnd.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    // Con temporizadores falsos activos, waitFor no avanza: se restauran siempre.
    vi.useRealTimers();
});

describe('useNotificationCenter - arranque', () => {
    it('crea el servicio con la config vigente y el DND recibido', async () => {
        montar({ dnd: { isActive: true, allowUrgent: true } });
        await waitFor(() => {
            expect(dobles.crear).toHaveBeenCalledTimes(1);
        });

        const opciones = dobles.argumentos as { config: Record<string, unknown>; dnd: { isActive: boolean } };
        expect(opciones.config.enabled).toBe(config.enabled);
        expect(opciones.config.channel).toBe('toast');
        expect(opciones.dnd).toEqual({ isActive: true, allowUrgent: true });
    });

    it('sin DND usa el estado inactivo por defecto', async () => {
        montar();
        await waitFor(() => {
            expect(dobles.servicio.setDnd).toHaveBeenCalledWith({ isActive: false, allowUrgent: false });
        });
    });

    it('el canal inicial es el del servicio y cambiarlo lo sincroniza', () => {
        dobles.servicio.getChannel.mockReturnValue('both');
        const { result } = montar();

        expect(result.current.channel).toBe('both');

        act(() => result.current.setChannel('voice'));

        expect(dobles.servicio.setChannel).toHaveBeenCalledWith('voice');
        expect(result.current.channel).toBe('voice');
    });
});

describe('useNotificationCenter - entrega', () => {
    it('un toast entra arriba, queda en el historial como no leido y expira solo', async () => {
        const duracion = Number(config.toastDurationMs) || 6000;
        const programados: { delay: number; cb: () => void }[] = [];
        const espia = vi.spyOn(window, 'setTimeout').mockImplementation(((cb: () => void, delay?: number) => {
            programados.push({ delay: Number(delay), cb });
            return programados.length;
        }) as never);
        const { result } = montar();

        try {
            emitir('toast', aviso({ id: 't1', title: 'Agenda' }));

            expect(result.current.toasts.map((t) => t.id)).toEqual(['t1']);
            expect(result.current.history.map((h) => h.id)).toEqual(['t1']);
            expect(result.current.unread).toBe(1);
            expect(result.current.history[0].read).toBe(false);

            // El toast se programa con la duracion de la CONFIG.
            expect(programados.at(-1)!.delay).toBe(duracion);

            act(() => programados.at(-1)!.cb());
        } finally {
            espia.mockRestore();
        }

        expect(result.current.toasts).toEqual([]);
        // El historial NO se borra al expirar el toast.
        expect(result.current.history).toHaveLength(1);
    });

    it('el stack respeta el tope (los mas viejos caen)', () => {
        const { result } = montar();
        const tope = Number(config.maxStack) || 4;

        for (let i = 0; i < tope + 2; i += 1) emitir('toast', aviso({ id: `t${i}` }));

        expect(result.current.toasts).toHaveLength(tope);
        expect(result.current.toasts[0].id).toBe(`t${tope + 1}`);
        expect(result.current.toasts.map((t) => t.id)).not.toContain('t0');
    });

    it('solo voz: habla pero NO pinta toast (y si queda en el historial)', () => {
        const speak = vi.fn(async () => {});
        const { result } = montar({ speak });

        emitir('voice', aviso({ id: 'v1', body: 'Hola Ana' }));

        expect(speak).toHaveBeenCalledWith('Hola Ana', 'es');
        expect(result.current.toasts).toEqual([]);
        expect(result.current.history.map((h) => h.id)).toEqual(['v1']);
    });

    it('ambas: toast y voz a la vez', () => {
        const speak = vi.fn(async () => {});
        const { result } = montar({ speak, language: 'en' });

        emitir('both', aviso({ id: 'b1', body: 'Hi' }));

        expect(result.current.toasts.map((t) => t.id)).toEqual(['b1']);
        expect(speak).toHaveBeenCalledWith('Hi', 'en');
    });

    it('una entrega desconocida no pinta nada ni habla', () => {
        const speak = vi.fn(async () => {});
        const { result } = montar({ speak });

        emitir('ninguna', aviso({ id: 'x1' }));

        expect(result.current.toasts).toEqual([]);
        expect(result.current.history).toEqual([]);
        expect(speak).not.toHaveBeenCalled();
    });

    it('un evento sin notificacion se ignora', () => {
        const { result } = montar();

        act(() => {
            window.dispatchEvent(new CustomEvent('flu-notification', { detail: {} }));
        });

        expect(result.current.toasts).toEqual([]);
    });

    it('el historial respeta su tope', () => {
        const { result } = montar();
        const tope = Number(config.maxHistory) || 50;

        for (let i = 0; i < tope + 3; i += 1) emitir('toast', aviso({ id: `h${i}` }));

        expect(result.current.history).toHaveLength(tope);
        expect(result.current.history.map((h) => h.id)).not.toContain('h0');
    });

    it('un fallo de la voz se registra y no rompe la entrega', async () => {
        const speak = vi.fn(async () => {
            throw new Error('tts caido');
        });
        montar({ speak });

        emitir('voice', aviso({ id: 'v2' }));

        await waitFor(() => {
            expect(console.error).toHaveBeenCalled();
        });
    });
});

describe('useNotificationCenter - historial', () => {
    it('descartar un toast no toca el historial', () => {
        const { result } = montar();
        emitir('toast', aviso({ id: 'd1' }));

        act(() => result.current.dismiss('d1'));

        expect(result.current.toasts).toEqual([]);
        expect(result.current.history).toHaveLength(1);
    });

    it('marcar todo como leido baja el contador y no borra nada', () => {
        const { result } = montar();
        emitir('toast', aviso({ id: 'a' }));
        emitir('toast', aviso({ id: 'b' }));
        expect(result.current.unread).toBe(2);

        act(() => result.current.markAllRead());

        expect(result.current.unread).toBe(0);
        expect(result.current.history).toHaveLength(2);
        expect(result.current.history.every((h) => h.read)).toBe(true);
    });

    it('limpiar deja el historial vacio', () => {
        const { result } = montar();
        emitir('toast', aviso({ id: 'c' }));

        act(() => result.current.clear());

        expect(result.current.history).toEqual([]);
        expect(result.current.unread).toBe(0);
    });

    it('al desmontar deja de escuchar el bus', () => {
        const { result, unmount } = montar();
        unmount();

        emitir('toast', aviso({ id: 'fuera' }));

        expect(result.current.toasts).toEqual([]);
    });
});
