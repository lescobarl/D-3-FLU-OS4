// ============================================================
// Guard de COMPORTAMIENTO — alta de horario por voz: scope único
// ------------------------------------------------------------
// Caso 9: la junta creada por voz no aparecía porque se guardaba con el
// NOMBRE del hablante como `personId`, mientras el panel filtra por el
// PARTICIPANTE ACTIVO. Este guard EJECUTA el alta real (servicio con DB en
// memoria) y aplica el MISMO filtro que `useHorario`; falla si la entrada no
// queda visible para el participante activo. Nace ROJO: la ruta única no existe.
// ============================================================
import { describe, expect, it, vi } from 'vitest';
import type { HorarioRecord } from '../src/core/db/fluDatabase';
import { createHorarioService, type HorarioDb } from '../src/core/horario/horarioService';
import { addHorarioVoiceEntry } from '../src/core/horario/horarioVoiceEntry';

vi.mock('../src/core/db/fluDatabase', async () => {
    const actual =
        await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
    return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

const CONFIG = {
    maxClasesPorDia: 16,
    diaMin: 1,
    diaMax: 7,
    defaultColor: 'm1',
    colores: ['m1', 'm2', 'm3'] as const,
};

function createMapDb(): HorarioDb {
    const map = new Map<string, HorarioRecord>();
    return {
        async add(record: HorarioRecord) {
            map.set(record.id, { ...record, sync: { ...record.sync } });
        },
        async put(record: HorarioRecord) {
            map.set(record.id, { ...record, sync: { ...record.sync } });
        },
        async delete(id: string) {
            map.delete(id);
        },
        async get(id: string) {
            return map.get(id);
        },
        async toArray() {
            return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
        },
    };
}

function makeService(db: HorarioDb) {
    let i = 0;
    return createHorarioService({
        db,
        config: CONFIG,
        now: () => NOW,
        newId: () => `h-${++i}`,
    });
}

/** El MISMO filtro de aislamiento que aplica `useHorario.refresh`. */
const visibleFor = (rows: HorarioRecord[], scope?: string): HorarioRecord[] =>
    rows.filter((r) => (r.personId || 'global') === (scope || 'global'));

describe('alta de horario por voz — scope = participante activo (comportamiento)', () => {
    it('la junta queda VISIBLE para el participante activo y aislada de otros', async () => {
        const service = makeService(createMapDb());
        const { result, entry } = await addHorarioVoiceEntry(
            service,
            { materia: 'junta de comité', dia: 4, inicio: '12:00' },
            { personId: 'p1', defaultDurationMinutes: 60 },
        );

        expect(result.ok).toBe(true);
        expect(entry?.fin).toBe('13:00');

        const rows = await service.list();
        expect(visibleFor(rows, 'p1')).toHaveLength(1);
        expect(visibleFor(rows, 'p1')[0].materia).toBe('junta de comité');
        expect(visibleFor(rows, 'p1')[0].personId).toBe('p1');
        // Aislamiento: no pertenece a otro participante.
        expect(visibleFor(rows, 'p2')).toHaveLength(0);
    });

    it('sin hora de fin dictada, deriva la duración por defecto', async () => {
        const service = makeService(createMapDb());
        const { entry } = await addHorarioVoiceEntry(
            service,
            { materia: 'junta', dia: 4, inicio: '12:00' },
            { personId: 'p1', defaultDurationMinutes: 45 },
        );
        expect(entry?.fin).toBe('12:45');
    });

    it('datos incompletos → no persiste nada', async () => {
        const service = makeService(createMapDb());
        const { result, entry } = await addHorarioVoiceEntry(
            service,
            { materia: 'solo materia' },
            { personId: 'p1' },
        );
        expect(result.ok).toBe(false);
        expect(entry).toBeNull();
        expect(await service.list()).toHaveLength(0);
    });
});
