// @vitest-environment node
// ============================================================
// agendaQueryScenarios — datos PRODUCTIVOS inyectados en la tabla real
// ------------------------------------------------------------
// Recrea los escenarios de consulta de agenda por voz con datos reales:
//   1) frases canónicas → las resuelve el parser determinista ÚNICO y la
//      respuesta hablada incluye los items inyectados;
//   2) frases "similares" NO enumeradas (sin hardcode) → el determinista no las
//      reclama, así que las resuelve la IA con el contexto de agenda.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createAgendaService, type AgendaDb } from '../src/core/agenda/agendaService';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';
import { summarizeAgenda, agendaSummaryText } from '../src/core/agenda/agendaSummary';
import { appendPendingCalendar, formatAgendaForPrompt } from '../src/lib/dailyAgenda';
import { nextAgendaDue } from '../src/core/agenda/agendaModel';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import type { AgendaItem } from '../src/core/agenda/agendaModel';

const NOW = new Date(2026, 8, 18, 9, 0, 0, 0).getTime(); // viernes 18-sep-2026
const PERSON = 'luis';
const COLORS = ((FLU_CONFIG.agenda as Record<string, unknown>)?.colors ?? {}) as never;
const EMPTY = { es: 'No tienes nada programado.', en: 'Nothing scheduled.' };

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
            for (const item of items) map.set(item.id, { ...item, sync: { ...item.sync } });
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

/** Datos productivos: una serie de cada tipo, como los de uso real. */
async function seedProductiveAgenda() {
    let n = 0;
    const service = createAgendaService({
        db: makeDb(),
        now: () => NOW,
        newId: () => `seed-${++n}`,
    });
    const items = [
        { kind: 'clase' as const, label: 'matematicas', trigger: { type: 'weekly' as const, daysOfWeek: [1], timeOfDay: '08:00' } },
        { kind: 'cita' as const, label: 'dentista', trigger: { type: 'absolute' as const, at: NOW + 2 * 3600_000 } },
        { kind: 'recordatorio' as const, label: 'tomar medicina', trigger: { type: 'daily' as const, timeOfDay: '09:00' } },
        { kind: 'alarma' as const, label: 'despertar', trigger: { type: 'absolute' as const, at: NOW + 8 * 3600_000 } },
        { kind: 'junta' as const, label: 'reunion equipo', trigger: { type: 'absolute' as const, at: NOW + 1 * 3600_000 } },
    ];
    for (const input of items) {
        const result = await service.create({ ...input, personId: PERSON });
        expect(result.ok, `seed ${input.label}`).toBe(true);
    }
    return service;
}

async function speakAgendaQuery(service: Awaited<ReturnType<typeof seedProductiveAgenda>>, phrase: string) {
    const cmd = parseAgendaCommand(phrase, { now: NOW });
    if (!cmd.handled || cmd.action !== 'agenda.list') return { handled: false, text: '' };
    const items = await service.list({ personId: PERSON, status: 'pending' });
    const view = cmd.when === 'semana' ? 'week' : cmd.when === 'mes' ? 'month' : 'day';
    const summary = summarizeAgenda(items, view, NOW, COLORS);
    return { handled: true, text: agendaSummaryText(summary, 'es', EMPTY) };
}

describe('agenda por voz — consultas canónicas con datos productivos', () => {
    it('"qué hay para hoy" resoluciona e incluye los items de hoy', async () => {
        const service = await seedProductiveAgenda();
        const r = await speakAgendaQuery(service, 'qué hay para hoy');
        expect(r.handled).toBe(true);
        expect(r.text).toContain('dentista');
        expect(r.text).toContain('despertar');
    });

    it('"ok flu dime qué hay para hoy" (con wake) resoluciona igual', async () => {
        const service = await seedProductiveAgenda();
        const r = await speakAgendaQuery(service, 'ok flu dime qué hay para hoy');
        expect(r.handled).toBe(true);
        expect(r.text).toContain('dentista');
    });

    it('"qué hay este mes" incluye la clase semanal', async () => {
        const service = await seedProductiveAgenda();
        const r = await speakAgendaQuery(service, 'qué hay este mes');
        expect(r.handled).toBe(true);
        expect(r.text).toContain('matematicas');
    });

    it('"qué cosas tengo que hacer hoy" resoluciona como agenda', async () => {
        const service = await seedProductiveAgenda();
        const r = await speakAgendaQuery(service, 'qué cosas tengo que hacer hoy');
        expect(r.handled).toBe(true);
        expect(r.text).toContain('dentista');
    });

    it('"qué pendientes hay" resoluciona como agenda', async () => {
        const service = await seedProductiveAgenda();
        const r = await speakAgendaQuery(service, 'qué pendientes hay');
        expect(r.handled).toBe(true);
        expect(r.text.length).toBeGreaterThan(0);
    });

    it('"muéstrame mi agenda" resoluciona como agenda', async () => {
        const service = await seedProductiveAgenda();
        const r = await speakAgendaQuery(service, 'muéstrame mi agenda');
        expect(r.handled).toBe(true);
    });
});

describe('agenda por voz — vaciar la agenda (veracidad + scope)', () => {
    it('"Okay Flow borra la agenda" se reconoce como agenda.clear', () => {
        const cmd = parseAgendaCommand('Okay Flow borra la agenda', { now: NOW });
        expect(cmd.handled).toBe(true);
        expect(cmd.action).toBe('agenda.clear');
    });

    it('con datos: vacía EXACTAMENTE lo que lista el panel', async () => {
        const service = await seedProductiveAgenda();
        const before = await service.list({ personId: PERSON, status: 'pending' });
        expect(before.length).toBeGreaterThan(0);
        const cleared = await service.clearAll({ personId: PERSON });
        expect(cleared).toBe(before.length);
        const after = await service.list({ personId: PERSON, status: 'pending' });
        expect(after).toHaveLength(0);
    });

    it('sin datos: clearAll devuelve 0 (base de la respuesta veraz, no "vacié")', async () => {
        const service = await seedProductiveAgenda();
        await service.clearAll({ personId: PERSON });
        const again = await service.clearAll({ personId: PERSON });
        expect(again).toBe(0);
    });
});

describe('agenda por voz — frases similares NO enumeradas (las decide la IA)', () => {
    // Sin hardcode: estas frases no están en ninguna lista; el parser determinista
    // NO las reclama a propósito, de modo que pasan al cerebro IA, que recibe el
    // contexto de agenda pendiente y responde la intención.
    const SIMILAR = [
        'dime qué pendientes tengo',
        'cuáles son mis pendientes',
        'tengo algo para hoy',
        'recuérdame qué tengo agendado',
    ];

    it('no las reclama el determinista (evita hardcode de variantes)', () => {
        for (const phrase of SIMILAR) {
            const cmd = parseAgendaCommand(phrase, { now: NOW });
            expect(cmd.handled, `"${phrase}" no debe quedar atrapada por frames`).toBe(false);
        }
    });

    it('el contexto IA incluye TODOS los kinds pendientes (alarma, junta, clase)', async () => {
        const service = await seedProductiveAgenda();
        const pending = await service.list({ personId: PERSON, status: 'pending' });
        const kindLabels = ((FLU_CONFIG.agenda as Record<string, unknown>)?.labels ?? {}) as Record<string, string>;
        const context = formatAgendaForPrompt(
            appendPendingCalendar(
                [],
                pending.map((it) => ({
                    text: it.label,
                    dueAt: nextAgendaDue(it.trigger, NOW),
                    status: it.status,
                    kindLabel: kindLabels[it.kind] || it.kind,
                })),
                { maxReminders: 20 },
                'es',
            ),
            'es',
        );
        expect(context).toContain('dentista');
        expect(context).toContain('matematicas');
        expect(context).toContain('tomar medicina');
        expect(context).toContain('despertar');
        expect(context).toContain('reunion equipo');
    });
});
