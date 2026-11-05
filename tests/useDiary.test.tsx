// @vitest-environment jsdom
/**
 * useDiary - el diario personal sobre Dexie (0%).
 *
 * POR QUE ESTE TEST: 160 lineas que son el unico camino del diario (alta, edicion,
 * baja y consultas por dia/historial). Se sustituyen las fronteras (la tabla Dexie
 * y el servicio, que tiene test propio) y se comprueba su politica: un solo servicio
 * con la tabla y el tope diario de la config, el reloj inyectable, refresco SOLO si
 * la mutacion fue bien, consultas directas y loading que no se cuelga.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crear: vi.fn(),
    servicio: {
        listEntries: vi.fn(async () => [] as unknown[]),
        addEntry: vi.fn(async () => ({ ok: true })),
        updateEntry: vi.fn(async () => ({ ok: true })),
        getEntry: vi.fn(async () => undefined as unknown),
        getHistory: vi.fn(async () => [] as unknown[]),
        removeEntry: vi.fn(async () => ({ ok: true })),
    },
    argumentos: null as unknown,
}));

vi.mock('../src/core/db/fluDatabase.js', () => ({ fluDb: { diaryEntries: { nombre: 'tabla-diario' } } }));

vi.mock('../src/core/diary/diaryService.js', () => ({
    createDiaryService: (opciones: unknown) => {
        dobles.argumentos = opciones;
        dobles.crear(opciones);
        return dobles.servicio;
    },
}));

import { useDiary } from '../src/hooks/useDiary.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const montar = (opciones: { now?: () => number } = {}) => renderHook(() => useDiary(opciones));

beforeEach(() => {
    dobles.crear.mockClear();
    for (const fn of Object.values(dobles.servicio)) fn.mockClear();
    dobles.servicio.listEntries.mockResolvedValue([]);
    dobles.servicio.addEntry.mockResolvedValue({ ok: true });
    dobles.servicio.updateEntry.mockResolvedValue({ ok: true });
    dobles.servicio.removeEntry.mockResolvedValue({ ok: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useDiary - arranque', () => {
    it('crea un unico servicio con la tabla, el tope de la config y el reloj', async () => {
        const ahora = () => 2024;
        const { result } = montar({ now: ahora });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(dobles.crear).toHaveBeenCalledTimes(1);
        const opciones = dobles.argumentos as { db: unknown; config: { maxEntriesPerDay: unknown }; now: () => number };
        expect(opciones.db).toEqual({ diaryEntries: { nombre: 'tabla-diario' } });
        expect(opciones.config.maxEntriesPerDay).toBe((FLU_CONFIG.diary as unknown as Record<string, unknown>).maxEntriesPerDay);
        expect(opciones.now()).toBe(2024);
        expect(result.current.service).toBe(dobles.servicio);
    });

    it('la carga inicial trae las entradas y termina en loading=false', async () => {
        dobles.servicio.listEntries.mockResolvedValue([{ id: 'd1', text: 'hoy' }]);

        const { result } = montar();

        expect(result.current.loading).toBe(true);
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.entries).toEqual([{ id: 'd1', text: 'hoy' }]);
    });

    it('un fallo de lectura se registra y no deja loading colgado', async () => {
        dobles.servicio.listEntries.mockRejectedValue(new Error('dexie caido'));

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(console.error).toHaveBeenCalled();
        expect(result.current.entries).toEqual([]);
    });
});

describe('useDiary - mutaciones', () => {
    it('el alta refresca solo si fue bien', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.listEntries.mock.calls.length;

        dobles.servicio.addEntry.mockResolvedValueOnce({ ok: false, reason: 'limit' } as never);
        const fallo = await result.current.addEntry({ text: 'x' } as never);
        expect(fallo).toEqual({ ok: false, reason: 'limit' });
        expect(dobles.servicio.listEntries.mock.calls.length).toBe(lecturas);

        dobles.servicio.addEntry.mockResolvedValueOnce({ ok: true });
        await result.current.addEntry({ text: 'y' } as never);
        expect(dobles.servicio.listEntries.mock.calls.length).toBe(lecturas + 1);
    });

    it('editar y borrar siguen la misma regla', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const base = dobles.servicio.listEntries.mock.calls.length;

        dobles.servicio.updateEntry.mockResolvedValueOnce({ ok: false, reason: 'not-found' } as never);
        dobles.servicio.removeEntry.mockResolvedValueOnce({ ok: false, reason: 'not-found' } as never);
        await result.current.updateEntry('d1', { text: 'otro' } as never);
        await result.current.removeEntry('d1');
        expect(dobles.servicio.listEntries.mock.calls.length).toBe(base);

        await result.current.updateEntry('d1', { text: 'otro' } as never);
        await result.current.removeEntry('d1');
        expect(dobles.servicio.listEntries.mock.calls.length).toBe(base + 2);
        expect(dobles.servicio.updateEntry).toHaveBeenLastCalledWith('d1', { text: 'otro' });
    });
});

describe('useDiary - consultas', () => {
    it('paso directo por dia, por id y con historial', async () => {
        dobles.servicio.getEntry.mockResolvedValue({ id: 'd1' });
        dobles.servicio.listEntries.mockResolvedValue([{ id: 'd1' }]);
        dobles.servicio.getHistory.mockResolvedValue([{ id: 'd2' }]);
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.listEntries.mockClear();

        expect(await result.current.getEntry('d1')).toEqual({ id: 'd1' });
        await result.current.listEntries('2026-10-02');
        await result.current.getHistory(5);

        expect(dobles.servicio.listEntries).toHaveBeenCalledWith('2026-10-02');
        expect(dobles.servicio.getHistory).toHaveBeenCalledWith(5);
    });

    it('sin argumentos consulta el dia de hoy y el historial completo', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.listEntries.mockClear();

        await result.current.listEntries();
        await result.current.getHistory();

        expect(dobles.servicio.listEntries).toHaveBeenCalledWith(undefined);
        expect(dobles.servicio.getHistory).toHaveBeenCalledWith(undefined);
    });
});
