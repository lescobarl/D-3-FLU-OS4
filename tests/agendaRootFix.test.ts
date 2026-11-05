// @vitest-environment jsdom
// ============================================================
// agendaRootFix — invariantes de la corrección de raíz del
// calendario unificado (sin parches):
//   I1 recurrencia: UN resolutor; los días nombrados GANAN a
//      "todos los días" y la etiqueta no arrastra la recurrencia.
//   I2 cancelación por IDENTIDAD de serie (matcher en el servicio).
//   I3 mutación + refresco inmediato (sin esperar el tick de 15 s).
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';
import { createAgendaService, type AgendaDb } from '../src/core/agenda/agendaService';
import type { AgendaItem, AgendaKind, AgendaTrigger } from '../src/core/agenda/agendaModel';
import { useAgenda } from '../src/hooks/useAgenda';

const NOW = new Date(2026, 8, 15, 22, 0, 0, 0).getTime(); // martes 15-sep-2026

describe('I1 — recurrencia: días nombrados ganan a "todos los días"', () => {
    it('"todos los días los lunes a las 10" es semanal (lunes), no diario', () => {
        const r = parseAgendaCommand(
            'crea una clase de historia todos los días los lunes a las 10 de la mañana',
            { now: () => NOW },
        );
        expect(r.kind).toBe('clase');
        expect(r.trigger).toEqual({ type: 'weekly', daysOfWeek: [1], timeOfDay: '10:00' });
        expect(r.label).toBe('historia');
    });

    it('conserva "los lunes" (semanal) y "todos los días" (clase = 7 días; resto = daily)', () => {
        expect(parseAgendaCommand('crea una clase los lunes a las 9', { now: () => NOW }).trigger).toEqual({
            type: 'weekly',
            daysOfWeek: [1],
            timeOfDay: '09:00',
        });
        expect(parseAgendaCommand('crea una clase todos los días a las 10', { now: () => NOW }).trigger).toEqual({
            type: 'weekly',
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            timeOfDay: '10:00',
        });
        expect(parseAgendaCommand('recuérdame todos los días a las 8', { now: () => NOW }).trigger).toEqual({
            type: 'daily',
            timeOfDay: '08:00',
        });
    });
});

function memoryDb(seed: AgendaItem[] = []): AgendaDb {
    let rows = [...seed];
    return {
        add: async (item) => {
            rows.push(item);
        },
        put: async (item) => {
            rows = rows.map((r) => (r.id === item.id ? item : r));
        },
        bulkPut: async (items) => {
            rows = rows.map((r) => items.find((i) => i.id === r.id) ?? r);
        },
        delete: async (id) => {
            rows = rows.filter((r) => r.id !== id);
        },
        get: async (id) => rows.find((r) => r.id === id),
        toArray: async () => rows,
    };
}

function makeItem(id: string, kind: AgendaKind, label: string, trigger: AgendaTrigger, personId = 'u'): AgendaItem {
    return {
        id,
        kind,
        label,
        trigger,
        personId,
        status: 'pending',
        sync: { revision: 1, updated_at: '', deleted: false },
    };
}

describe('I2 — cancelar por identidad de serie (matcher en el servicio)', () => {
    it('«borra la clase de historia» cancela TODAS las filas de la serie', async () => {
        const trigger0: AgendaTrigger = { type: 'weekly', daysOfWeek: [1], timeOfDay: '10:00' };
        const db = memoryDb([
            makeItem('c0', 'clase', 'historia todos días', trigger0),
            makeItem('c1', 'clase', 'historia todos días', { type: 'weekly', daysOfWeek: [2], timeOfDay: '10:00' }),
            makeItem('c2', 'clase', 'historia todos días', { type: 'weekly', daysOfWeek: [3], timeOfDay: '10:00' }),
            // Otro kind con la misma palabra NO debe caer.
            makeItem('r0', 'recordatorio', 'historia', { type: 'daily', timeOfDay: '10:00' }),
        ]);
        const service = createAgendaService({ db, now: () => NOW });

        const cancelled = await service.cancelByTarget({ personId: 'u', kind: 'clase', target: 'historia' });
        expect(cancelled).toBe(3);

        const pending = await service.list({ personId: 'u', status: 'pending' });
        expect(pending.map((i) => i.id)).toEqual(['r0']);

        // findSeries respeta el alcance de la serie completa.
        const remaining = await service.findSeries({ personId: 'u', kind: 'clase', target: 'historia' });
        expect(remaining).toEqual([]);
    });
});

describe('I3 — mutación + refresco inmediato (sin tick de 15 s)', () => {
    it('tras create/cancelByTarget, `items` refleja el cambio sin esperar el tick', async () => {
        const stored: AgendaItem[] = [makeItem('a', 'clase', 'historia todos días', { type: 'weekly', daysOfWeek: [1], timeOfDay: '10:00' })];
        let seq = 0;
        const service = {
            list: vi.fn(async (filter?: { status?: string }) =>
                filter?.status === 'pending' ? stored.filter((i) => i.status === 'pending') : stored),
            create: vi.fn(async (input: { kind: AgendaKind; label: string; trigger: AgendaTrigger }) => {
                seq += 1;
                const item = makeItem(`n${seq}`, input.kind, input.label, input.trigger);
                stored.push(item);
                return { ok: true, item };
            }),
            update: vi.fn(async () => ({ ok: true })),
            cancel: vi.fn(async (id: string) => {
                const item = stored.find((i) => i.id === id);
                if (item) item.status = 'deleted';
                return { ok: true };
            }),
            cancelByTarget: vi.fn(async (selector: { target?: string }) => {
                const target = String(selector?.target || '').toLowerCase();
                const live = stored.filter(
                    (i) => i.status === 'pending' && i.kind === 'clase' && (!target || i.label.toLowerCase().includes(target)),
                );
                live.forEach((i) => {
                    i.status = 'deleted';
                });
                return live.length;
            }),
            updateByTarget: vi.fn(async () => 1),
            restore: vi.fn(async () => ({ ok: true })),
            complete: vi.fn(async () => ({ ok: true })),
            clearAll: vi.fn(async () => 0),
        };
        const audio = { start: () => undefined, stop: () => undefined, isSupported: () => false } as never;

        const { result } = renderHook(() =>
            useAgenda({ service: service as never, personId: 'u', onFire: () => undefined, audio, now: () => NOW }),
        );
        await waitFor(() => expect(result.current.items).toHaveLength(1));

        await act(async () => {
            await result.current.create({
                kind: 'clase',
                label: 'matemáticas',
                trigger: { type: 'weekly', daysOfWeek: [2], timeOfDay: '08:00' },
                personId: 'u',
            });
        });
        await waitFor(() => expect(result.current.items).toHaveLength(2));

        await act(async () => {
            await result.current.cancelByTarget({ personId: 'u', kind: 'clase', target: 'historia' });
        });
        await waitFor(() => expect(result.current.items.map((i) => i.label)).toEqual(['matemáticas']));
    });
});
