// ============================================================
// Cancelacion POR DIA: "borra la clase de historia del jueves" solo puede caer el
// jueves, no la serie entera (que incluye el martes).
//
// Defecto medido: el parser resolvia la recurrencia ("jueves" -> [4]) y la
// DESCARTA para cancelar, asi que el matcher solo veia kind+label y borraba toda
// la serie. El usuario pedia el jueves y perdia martes y jueves.
//
// Estos casos usan parser y servicio REALES con una DB en memoria.
// ============================================================
import { describe, it, expect } from 'vitest'
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser'
import { createAgendaService, type AgendaDb } from '../src/core/agenda/agendaService'
import type { AgendaItem } from '../src/core/agenda/agendaModel'

const NOW = new Date('2026-09-22T10:00:00').getTime()

function makeDb(): AgendaDb {
    const map = new Map<string, AgendaItem>()
    return {
        async add(item) { map.set(item.id, { ...item, sync: { ...item.sync } }) },
        async put(item) { map.set(item.id, { ...item, sync: { ...item.sync } }) },
        async bulkPut(items) { for (const item of items) map.set(item.id, { ...item, sync: { ...item.sync } }) },
        async delete(id) { map.delete(id) },
        async get(id) { return map.get(id) },
        async toArray() { return Array.from(map.values()).map((i) => ({ ...i, sync: { ...i.sync } })) },
    }
}

let seq = 0
function makeService() {
    return createAgendaService({ db: makeDb(), now: () => 1_000_000, newId: () => `id-${++seq}` })
}

/** La clase de Historia del seed real: semanal martes(2) y jueves(4) a las 10:00. */
async function seedHistoria() {
    const svc = makeService()
    const created = await svc.create({
        kind: 'clase',
        label: 'Historia',
        trigger: { type: 'weekly', daysOfWeek: [2, 4], timeOfDay: '10:00' },
        personId: 'p1',
    })
    return { svc, id: created.item!.id }
}

describe('parser: los dias nombrados viajan como alcance de cancelacion', () => {
    it('"del dia jueves" acota a jueves', () => {
        const cmd = parseAgendaCommand('Okay Flow borra la clase de historia del día jueves', { now: NOW })
        expect(cmd.action).toBe('agenda.cancel')
        expect(cmd.kind).toBe('clase')
        expect(cmd.label).toBe('historia')
        expect(cmd.scopeDays).toEqual([4])
    })

    it('sin dia nombrado no hay alcance (serie completa)', () => {
        const cmd = parseAgendaCommand('borra la clase de historia', { now: NOW })
        expect(cmd.action).toBe('agenda.cancel')
        expect(cmd.scopeDays).toBeUndefined()
    })

    it('varios dias se conservan juntos', () => {
        const cmd = parseAgendaCommand('quita la clase de historia del lunes y el jueves', { now: NOW })
        expect(cmd.scopeDays).toEqual([1, 4])
    })

    it('crear sigue devolviendo trigger, no alcance de cancelacion', () => {
        const cmd = parseAgendaCommand('crea la clase de historia el jueves a las 10', { now: NOW })
        expect(cmd.action).toBe('agenda.create')
        expect(cmd.scopeDays).toBeUndefined()
        expect(cmd.trigger).toBeDefined()
    })
})

describe('servicio: cancelar por dia estrecha la serie en vez de borrarla', () => {
    it('borrar el jueves deja el martes vivo', async () => {
        const { svc, id } = await seedHistoria()
        const count = await svc.cancelByTarget({ personId: 'p1', kind: 'clase', target: 'historia', daysOfWeek: [4] })
        expect(count).toBe(1)
        const [item] = await svc.list({ personId: 'p1' })
        expect(item.id).toBe(id)
        expect(item.status).toBe('pending')
        expect(item.trigger.type === 'weekly' && item.trigger.daysOfWeek).toEqual([2])
        expect(item.trigger.type === 'weekly' && item.trigger.timeOfDay).toBe('10:00')
    })

    it('borrar todos los dias de la serie la elimina', async () => {
        const { svc } = await seedHistoria()
        const count = await svc.cancelByTarget({ personId: 'p1', kind: 'clase', target: 'historia', daysOfWeek: [2, 4] })
        expect(count).toBe(1)
        expect(await svc.list({ personId: 'p1', status: 'pending' })).toEqual([])
    })

    it('sin alcance de dias el comportamiento es el de siempre (serie completa)', async () => {
        const { svc } = await seedHistoria()
        const count = await svc.cancelByTarget({ personId: 'p1', kind: 'clase', target: 'historia' })
        expect(count).toBe(1)
        expect(await svc.list({ personId: 'p1', status: 'pending' })).toEqual([])
    })

    it('un dia que la serie no tiene no toca nada', async () => {
        const { svc } = await seedHistoria()
        const count = await svc.cancelByTarget({ personId: 'p1', kind: 'clase', target: 'historia', daysOfWeek: [5] })
        expect(count).toBe(0)
        const [item] = await svc.list({ personId: 'p1' })
        expect(item.trigger.type === 'weekly' && item.trigger.daysOfWeek).toEqual([2, 4])
    })

    it('un item no semanal (una vez) cae entero aunque se nombre un dia', async () => {
        const svc = makeService()
        await svc.create({ kind: 'cita', label: 'dentista', trigger: { type: 'absolute', at: NOW + 3_600_000 }, personId: 'p1' })
        const count = await svc.cancelByTarget({ personId: 'p1', kind: 'cita', target: 'dentista', daysOfWeek: [4] })
        expect(count).toBe(1)
        expect(await svc.list({ personId: 'p1', status: 'pending' })).toEqual([])
    })
})
describe('conjunto completo: "borra todas las clases" vacia el tipo ENTERO', () => {
    it('parser: etiqueta vacia y sin alcance de dia', () => {
        const cmd = parseAgendaCommand('Okay Flow borra todas las clases', { now: NOW });
        expect(cmd.action).toBe('agenda.cancel');
        expect(cmd.kind).toBe('clase');
        expect(cmd.label).toBe('');
        expect(cmd.scopeDays).toBeUndefined();
    });
    it('servicio: caen TODAS las clases del usuario (aunque se llamen por materia)', async () => {
        const { svc } = await seedHistoria(); // martes y jueves
        await svc.create({
            kind: 'clase',
            label: 'Matemáticas',
            trigger: { type: 'weekly', daysOfWeek: [1], timeOfDay: '08:00' },
            personId: 'p1',
        });
        await svc.create({
            kind: 'clase',
            label: 'Otra',
            trigger: { type: 'weekly', daysOfWeek: [3], timeOfDay: '09:00' },
            personId: 'p2',
        });
        const cmd = parseAgendaCommand('borra todas las clases', { now: NOW });
        const count = await svc.cancelByTarget({
            personId: 'p1',
            kind: cmd.kind!,
            target: cmd.label || '',
        });
        expect(count).toBe(2);
        expect(await svc.list({ personId: 'p1', status: 'pending' })).toHaveLength(0);
        // Aislamiento por usuario: el de p2 no se toca.
        expect(await svc.list({ personId: 'p2', status: 'pending' })).toHaveLength(1);
    });
});
