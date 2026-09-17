// ============================================================
// Prueba de escritorio del servicio ÚNICO de agenda (CRUD + dedup + lógico)
// ------------------------------------------------------------
// P5/P8 de la spec: editar/cancelar cualquier tipo; cancelar = borrado lógico;
// pedir dos veces lo mismo no duplica. Con una DB en memoria (sin Dexie real).
// ============================================================
import { describe, it, expect } from 'vitest';
import { createAgendaService, type AgendaDb } from '../src/core/agenda/agendaService';
import type { AgendaItem, AgendaKind, AgendaTrigger } from '../src/core/agenda/agendaModel';

function makeDb(): AgendaDb {
    const map = new Map<string, AgendaItem>();
    return {
        async add(item) {
            map.set(item.id, { ...item, sync: { ...item.sync } });
        },
        async put(item) {
            map.set(item.id, { ...item, sync: { ...item.sync } });
        },
        async bulkPut(items) {
            for (const item of items) {
                map.set(item.id, { ...item, sync: { ...item.sync } });
            }
        },
        async delete(id) {
            map.delete(id);
        },
        async get(id) {
            return map.get(id);
        },
        async toArray() {
            return Array.from(map.values()).map((i) => ({ ...i, sync: { ...i.sync } }));
        },
    };
}

let seq = 0;
function makeService() {
    return createAgendaService({
        db: makeDb(),
        now: () => 1_000_000,
        newId: () => `id-${++seq}`,
    });
}

const TOMORROW = new Date(2026, 8, 16, 11, 0, 0, 0).getTime();
const ABS: AgendaTrigger = { type: 'absolute', at: TOMORROW };

describe('agendaService — CRUD unificado', () => {
    it('crea cualquier tipo con su fecha y lo lista por participante', async () => {
        const s = makeService();
        const r = await s.create({ kind: 'alarma', label: 'Despertador', trigger: ABS, personId: 'p1' });
        expect(r.ok).toBe(true);
        expect(r.item?.kind).toBe('alarma');
        expect(r.item?.status).toBe('pending');
        expect(r.item?.sync.deleted).toBe(false);

        const listP1 = await s.list({ personId: 'p1' });
        const listP2 = await s.list({ personId: 'p2' });
        expect(listP1).toHaveLength(1);
        expect(listP2).toHaveLength(0); // aislamiento por participante
    });

    it('pedir dos veces lo mismo NO duplica (dedup)', async () => {
        const s = makeService();
        await s.create({ kind: 'alarma', label: 'Despertador', trigger: { type: 'daily', timeOfDay: '07:00' } });
        const dup = await s.create({ kind: 'alarma', label: 'despertador', trigger: { type: 'daily', timeOfDay: '07:00' } });
        expect(dup.ok).toBe(false);
        expect(dup.reason).toBe('duplicado');
        expect(await s.list({})).toHaveLength(1);
    });

    it('editar cambia label/fecha de CUALQUIER tipo', async () => {
        const s = makeService();
        const created = await s.create({ kind: 'clase', label: 'Matemáticas', trigger: { type: 'weekly', daysOfWeek: [1], timeOfDay: '09:00' } });
        const id = created.item!.id;
        const upd = await s.update(id, { label: 'Matemáticas avanzadas', trigger: { type: 'weekly', daysOfWeek: [3], timeOfDay: '10:00' } });
        expect(upd.ok).toBe(true);
        const items = await s.list({});
        expect(items[0].label).toBe('Matemáticas avanzadas');
        expect(items[0].trigger).toEqual({ type: 'weekly', daysOfWeek: [3], timeOfDay: '10:00' });
    });

    it('cancelar es borrado LÓGICO (sigue en la base, marcado deleted)', async () => {
        const s = makeService();
        const created = await s.create({ kind: 'junta', label: 'Comité', trigger: ABS });
        const id = created.item!.id;
        const cancel = await s.cancel(id);
        expect(cancel.ok).toBe(true);
        const all = await s.list({});
        expect(all).toHaveLength(1);
        expect(all[0].status).toBe('deleted');
        expect(all[0].sync.deleted).toBe(true);
        // el borrado lógico no aparece en pendientes
        expect(await s.list({ status: 'pending' })).toHaveLength(0);
    });

    it('restore devuelve un item cancelado a pendiente', async () => {
        const s = makeService();
        const created = await s.create({ kind: 'cita', label: 'Doctor', trigger: ABS });
        await s.cancel(created.item!.id);
        const restored = await s.restore(created.item!.id);
        expect(restored.ok).toBe(true);
        expect((await s.list({ status: 'pending' }))[0].status).toBe('pending');
    });
});
