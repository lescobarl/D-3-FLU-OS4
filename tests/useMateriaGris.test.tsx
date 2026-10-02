// @vitest-environment jsdom
/**
 * useMateriaGris - gamificacion de participaciones sobre Dexie (0%).
 *
 * POR QUE ESTE TEST: el hook es el unico dueno del estado de materia gris
 * (carga inicial, leaderboard, historial, alta de puntos y total por
 * participante). Se sustituyen las fronteras (la tabla Dexie y el servicio,
 * que tiene test propio) y se comprueba su politica REAL: un unico servicio
 * con la tabla, la config de FLU_CONFIG y el reloj inyectable; refresco SOLO
 * cuando el alta fue bien; y loading que nunca se queda colgado.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crear: vi.fn(),
    servicio: {
        awardPoints: vi.fn(async () => ({ ok: true })),
        getLeaderboard: vi.fn(async () => [] as unknown[]),
        getTotalFor: vi.fn(async () => 0),
        getHistory: vi.fn(async () => [] as unknown[]),
    },
    argumentos: null as unknown,
}));

vi.mock('../src/core/db/fluDatabase.js', () => ({
    fluDb: { materiaGris: { nombre: 'tabla-materia-gris' } },
}));

vi.mock('../src/core/multiuser/materiaGrisService.js', () => ({
    createMateriaGrisService: (opciones: unknown) => {
        dobles.argumentos = opciones;
        dobles.crear(opciones);
        return dobles.servicio;
    },
}));

import { useMateriaGris } from '../src/hooks/useMateriaGris.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const montar = (opciones: { now?: () => number } = {}) => renderHook(() => useMateriaGris(opciones));

beforeEach(() => {
    dobles.crear.mockClear();
    for (const fn of Object.values(dobles.servicio)) fn.mockClear();
    dobles.servicio.awardPoints.mockResolvedValue({ ok: true } as never);
    dobles.servicio.getLeaderboard.mockResolvedValue([]);
    dobles.servicio.getTotalFor.mockResolvedValue(0);
    dobles.servicio.getHistory.mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ------------------------------------------------------------
// Bloque: arranque (creacion del servicio y carga inicial)
// ------------------------------------------------------------
describe('useMateriaGris - arranque', () => {
    it('crea un unico servicio con la tabla Dexie, la config y el reloj inyectado', async () => {
        const ahora = () => 555;
        const { result } = montar({ now: ahora });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(dobles.crear).toHaveBeenCalledTimes(1);
        const opciones = dobles.argumentos as {
            db: unknown;
            config: { actions: unknown; maxEntriesPerParticipant: unknown };
            now: () => number;
        };
        expect(opciones.db).toEqual({ nombre: 'tabla-materia-gris' });
        expect(opciones.config.actions).toEqual(FLU_CONFIG.materiaGris.actions);
        expect(opciones.config.maxEntriesPerParticipant).toBe(
            FLU_CONFIG.materiaGris.maxEntriesPerParticipant,
        );
        expect(opciones.now()).toBe(555);
        expect(result.current.service).toBe(dobles.servicio);
    });

    it('la carga inicial trae leaderboard e historial y termina en loading=false', async () => {
        dobles.servicio.getLeaderboard.mockResolvedValue([
            { participantId: 'p1', points: 10, actions: 2 },
        ] as never);
        dobles.servicio.getHistory.mockResolvedValue([{ id: 'm1', points: 3 }] as never);

        const { result } = montar();

        expect(result.current.loading).toBe(true);
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.leaderboard).toEqual([
            { participantId: 'p1', points: 10, actions: 2 },
        ]);
        expect(result.current.history).toEqual([{ id: 'm1', points: 3 }]);
    });

    it('un fallo de lectura se registra y no deja loading colgado', async () => {
        dobles.servicio.getLeaderboard.mockRejectedValue(new Error('dexie caido'));

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(console.error).toHaveBeenCalled();
        expect(result.current.leaderboard).toEqual([]);
    });
});

// ------------------------------------------------------------
// Bloque: acciones (alta de puntos y total por participante)
// ------------------------------------------------------------
describe('useMateriaGris - acciones', () => {
    it('awardPoints exitoso refresca el leaderboard y devuelve el resultado', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.getLeaderboard.mock.calls.length;

        dobles.servicio.awardPoints.mockResolvedValueOnce({ ok: true, record: { id: 'm9' } } as never);
        const salida = await result.current.awardPoints({ participantId: 'p1', action: 'cuento' });

        expect(salida.ok).toBe(true);
        expect(dobles.servicio.awardPoints).toHaveBeenCalledWith({
            participantId: 'p1',
            action: 'cuento',
        });
        expect(dobles.servicio.getLeaderboard.mock.calls.length).toBe(lecturas + 1);
    });

    it('awardPoints fallido NO refresca el leaderboard', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.getLeaderboard.mock.calls.length;

        dobles.servicio.awardPoints.mockResolvedValueOnce({
            ok: false,
            reason: 'unknown-action',
        } as never);
        const salida = await result.current.awardPoints({ participantId: 'p1', action: 'x' });

        expect(salida).toEqual({ ok: false, reason: 'unknown-action' });
        expect(dobles.servicio.getLeaderboard.mock.calls.length).toBe(lecturas);
    });

    it('getTotalFor delega en el servicio con el id recibido', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        dobles.servicio.getTotalFor.mockResolvedValueOnce(42);
        const total = await result.current.getTotalFor('p1');

        expect(total).toBe(42);
        expect(dobles.servicio.getTotalFor).toHaveBeenCalledWith('p1');
    });
});

// ------------------------------------------------------------
// Bloque: estabilidad del servicio y refresco manual
// ------------------------------------------------------------
describe('useMateriaGris - servicio estable y refresh', () => {
    it('el servicio se crea una sola vez aunque el hook se vuelva a renderizar', async () => {
        const { result, rerender } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        rerender();

        expect(dobles.crear).toHaveBeenCalledTimes(1);
        expect(result.current.service).toBe(dobles.servicio);
    });

    it('refresh manual vuelve a leer y actualiza el leaderboard', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        dobles.servicio.getLeaderboard.mockResolvedValue([
            { participantId: 'p2', points: 7, actions: 1 },
        ] as never);
        await result.current.refresh();

        await waitFor(() => {
            expect(result.current.leaderboard).toEqual([
                { participantId: 'p2', points: 7, actions: 1 },
            ]);
        });
        expect(dobles.servicio.getHistory).toHaveBeenCalled();
    });

    it('sin reloj inyectado usa un reloj real por defecto', async () => {
        const antes = Date.now();
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const opciones = dobles.argumentos as { now: () => number };
        expect(opciones.now()).toBeGreaterThanOrEqual(antes);
    });
});
