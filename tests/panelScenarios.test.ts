// ============================================================
// panelScenarios — set de validación por OBJETO del panel derecho
// ------------------------------------------------------------
// Inyecta escenarios reales (dictado natural, con wake word, ecos del ASR,
// acentos, "mañana"/días, horas de la mañana/tarde, recurrencia) para:
// citas, recordatorios, horario/clase, alarma y notas.
// Corre por la RUTA REAL: `resolveDeterministicCommand` (el árbitro único).
// Cada fila valida: dominio/acción, etiqueta LIMPIA y disparo (día + hora).
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { parseAgendaIntent } from '../src/core/agenda/agendaIntentParser';

// Jueves 2026-09-17 10:00 local.
const NOW = new Date(2026, 8, 17, 10, 0, 0, 0).getTime();

const norm = (v: unknown) =>
    String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

function run(phrase: string) {
    return resolveDeterministicCommand(phrase, { now: NOW } as never);
}

function agenda(phrase: string) {
    const r = run(phrase);
    expect(r?.domain, `dominio de "${phrase}"`).toBe('agendaCommand');
    return r?.action as {
        handled: boolean;
        action: string;
        kind?: string;
        label?: string;
        trigger?: { type: string; at?: number; daysOfWeek?: number[]; timeOfDay?: string };
    };
}

function note(phrase: string) {
    const r = run(phrase);
    expect(r?.domain, `dominio de "${phrase}"`).toBe('note');
    return (r?.action as { action?: string; data?: { label?: string; body?: string; target?: string } });
}

function dayDiff(at: number): number {
    const a = new Date(NOW);
    const b = new Date(at);
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.round((db - da) / 86_400_000);
}

const hourOf = (at: number) => new Date(at).getHours();

// ------------------------------------------------------------
describe('CITAS', () => {
    it('"crea una cita con el dentista mañana a las 4 de la tarde"', () => {
        const a = agenda('crea una cita con el dentista mañana a las 4 de la tarde');
        expect(a.action).toBe('agenda.create');
        expect(a.kind).toBe('cita');
        expect(norm(a.label)).toBe('dentista');
        expect(dayDiff(a.trigger!.at!)).toBe(1);
        expect(hourOf(a.trigger!.at!)).toBe(16);
    });

    it('"agenda una cita para el viernes a las 11"', () => {
        const a = agenda('agenda una cita para el viernes a las 11');
        expect(a.kind).toBe('cita');
        expect(dayDiff(a.trigger!.at!)).toBe(1); // viernes 18
        expect(hourOf(a.trigger!.at!)).toBe(11);
    });

    it('"Okay flow crea una cita para mañana a las 3 de la tarde con el homeópata"', () => {
        const a = agenda('Okay flow crea una cita para mañana a las 3 de la tarde con el homeópata');
        expect(a.kind).toBe('cita');
        expect(norm(a.label)).toBe('homeopata');
        expect(dayDiff(a.trigger!.at!)).toBe(1);
        expect(hourOf(a.trigger!.at!)).toBe(15);
    });

    it('"cita con el doctor el lunes a las 9 a.m."', () => {
        const a = agenda('cita con el doctor el lunes a las 9 a.m.');
        expect(a.kind).toBe('cita');
        expect(norm(a.label)).toBe('doctor');
        expect(dayDiff(a.trigger!.at!)).toBe(4); // lunes 21
        expect(hourOf(a.trigger!.at!)).toBe(9);
    });

    it('"crea una cita para con el doctor a las 3 de la tarde es el homeópata"', () => {
        const a = agenda('crea una cita para con el doctor a las 3 de la tarde es el homeópata');
        expect(a.kind).toBe('cita');
        expect(norm(a.label)).toBe('doctor homeopata');
    });
});

// ------------------------------------------------------------
describe('RECORDATORIOS', () => {
    it('"crea un recordatorio para mañana que me recuerde tomar la medicina a las 9:00 a.m"', () => {
        const a = agenda('crea un recordatorio para mañana que me recuerde tomar la medicina a las 9:00 a.m');
        expect(a.action).toBe('agenda.create');
        expect(a.kind).toBe('recordatorio');
        expect(norm(a.label)).toBe('tomar medicina');
        expect(dayDiff(a.trigger!.at!)).toBe(1);
        expect(hourOf(a.trigger!.at!)).toBe(9);
    });

    it('"recuérdame regar las plantas mañana a las 7"', () => {
        const a = agenda('recuérdame regar las plantas mañana a las 7');
        expect(a.kind).toBe('recordatorio');
        expect(norm(a.label)).toBe('regar plantas');
        expect(hourOf(a.trigger!.at!)).toBe(7);
    });

    it('"recuérdame llamar a mamá a las 6 de la tarde"', () => {
        const a = agenda('recuérdame llamar a mamá a las 6 de la tarde');
        expect(a.kind).toBe('recordatorio');
        expect(norm(a.label)).toBe('llamar mama');
        expect(dayDiff(a.trigger!.at!)).toBe(0); // hoy, 18:00 aún no pasó
        expect(hourOf(a.trigger!.at!)).toBe(18);
    });

    it('"pon un recordatorio para el sábado a las 8 para sacar la basura"', () => {
        const a = agenda('pon un recordatorio para el sábado a las 8 para sacar la basura');
        expect(a.kind).toBe('recordatorio');
        expect(norm(a.label)).toBe('sacar basura');
        expect(dayDiff(a.trigger!.at!)).toBe(2); // sábado 19
        expect(hourOf(a.trigger!.at!)).toBe(8);
    });
});

// ------------------------------------------------------------
describe('HORARIO / CLASE', () => {
    it('"agrega matemáticas los lunes a las 8"', () => {
        const a = agenda('agrega matemáticas los lunes a las 8');
        expect(a.kind).toBe('clase');
        expect(a.trigger!.type).toBe('weekly');
        expect(a.trigger!.daysOfWeek).toEqual([1]);
        expect(a.trigger!.timeOfDay).toBe('08:00');
        expect(norm(a.label)).toBe('matematicas');
    });

    it('"crea una clase de historia el miércoles a las 10"', () => {
        const a = agenda('crea una clase de historia el miércoles a las 10');
        expect(a.kind).toBe('clase');
        expect(a.trigger!.type).toBe('weekly');
        expect(a.trigger!.daysOfWeek).toEqual([3]);
        expect(norm(a.label)).toBe('historia');
    });

    it('"programa inglés toda la semana a las 7"', () => {
        const a = agenda('programa inglés toda la semana a las 7');
        expect(a.kind).toBe('clase');
        expect(a.trigger!.type).toBe('weekly');
        expect(a.trigger!.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(a.trigger!.timeOfDay).toBe('07:00');
    });
});

// ------------------------------------------------------------
describe('ALARMAS', () => {
    it('"pon una alarma para las 6 de la mañana" (hora pasada → mañana)', () => {
        const a = agenda('pon una alarma para las 6 de la mañana');
        expect(a.action).toBe('agenda.create');
        expect(a.kind).toBe('alarma');
        expect(dayDiff(a.trigger!.at!)).toBe(1);
        expect(hourOf(a.trigger!.at!)).toBe(6);
    });

    it('"despiértame mañana a las 5:30"', () => {
        const a = agenda('despiértame mañana a las 5:30');
        expect(a.kind).toBe('alarma');
        expect(dayDiff(a.trigger!.at!)).toBe(1);
        expect(hourOf(a.trigger!.at!)).toBe(5);
        expect(new Date(a.trigger!.at!).getMinutes()).toBe(30);
    });

    it('"ponme un despertador a las 6" (hora pasada → mañana)', () => {
        const a = agenda('ponme un despertador a las 6');
        expect(a.kind).toBe('alarma');
        expect(dayDiff(a.trigger!.at!)).toBe(1);
        expect(hourOf(a.trigger!.at!)).toBe(6);
    });
});

// ------------------------------------------------------------
describe('NOTAS', () => {
    it('"apunta comprar pan"', () => {
        const n = note('apunta comprar pan');
        expect(n.action).toBe('notes.add');
        expect(norm(n.data?.label)).toBe('comprar pan');
    });

    it('"nota para el super" → Super', () => {
        const n = note('nota para el super');
        expect(n.action).toBe('notes.add');
        expect(norm(n.data?.label)).toBe('super');
    });

    it('"crea una lista para el súper en las notas que traiga jabón pan huevo y queso"', () => {
        const n = note('crea una lista para el súper en las notas que traiga jabón pan huevo y queso');
        expect(n.action).toBe('notes.add');
        expect(norm(n.data?.label)).toBe('super');
        expect(norm(n.data?.body)).toContain('jabon');
        expect(norm(n.data?.body)).toContain('queso');
    });

    it('"una nota del super con pan y huevo"', () => {
        const n = note('una nota del super con pan y huevo');
        expect(n.action).toBe('notes.add');
        expect(norm(`${n.data?.label} ${n.data?.body}`)).toContain('pan');
    });

    it('"borra la nota del súper" → notes.remove', () => {
        const n = note('borra la nota del súper');
        expect(n.action).toBe('notes.remove');
        expect(norm(n.data?.target)).toBe('super');
    });
});

// ------------------------------------------------------------
describe('CANCELAR / VACIAR / CONSULTAR', () => {
    it('"borra la cita con el dentista"', () => {
        const a = agenda('borra la cita con el dentista');
        expect(a.action).toBe('agenda.cancel');
        expect(a.kind).toBe('cita');
        expect(norm(a.label)).toBe('dentista');
    });

    it('"cancela la alarma de las 6"', () => {
        const a = agenda('cancela la alarma de las 6');
        expect(a.action).toBe('agenda.cancel');
        expect(a.kind).toBe('alarma');
    });

    it('"quita matemáticas del viernes"', () => {
        const a = agenda('quita matemáticas del viernes');
        expect(a.action).toBe('agenda.cancel');
        expect(a.kind).toBe('clase');
        expect(norm(a.label)).toBe('matematicas');
    });

    it('"borra toda la agenda"', () => {
        const a = agenda('borra toda la agenda');
        expect(a.action).toBe('agenda.clear');
    });

    it('"dime qué hay para hoy" (consulta: su resolver es agendaIntentParser)', () => {
        expect(parseAgendaIntent('dime qué hay para hoy')).toMatchObject({
            handled: true,
            action: 'agenda.today',
        });
    });
});
