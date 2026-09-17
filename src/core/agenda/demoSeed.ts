// ============================================================
// src/core/agenda/demoSeed.ts — Datos de DEMO (solo desarrollo)
// ------------------------------------------------------------
// Simula una sesión productiva: calendario con los 5 tipos
// (alarma, recordatorio, cita, junta, clase) + notas. Se usa
// ÚNICAMENTE para validación visual en local; NO se ejecuta en
// producción (ver gate en App.tsx: import.meta.env.DEV).
// ============================================================
import type { AgendaCreateInput } from './agendaService';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** Hora local 'HH:MM' de hoy (para triggers daily/absolute relativos). */
function atHoursFromNow(hours: number, now: number): number {
    return now + Math.round(hours * HOUR);
}

export function buildDemoAgendaInputs(now: number): AgendaCreateInput[] {
    return [
        { kind: 'alarma', label: 'Tomar medicamento', trigger: { type: 'absolute', at: now + 35 * 1000 } },
        { kind: 'clase', label: 'Clase de Historia', trigger: { type: 'absolute', at: atHoursFromNow(1.5, now) }, fin: '10:30', aula: 'Aula 5' },
        { kind: 'junta', label: 'Junta de comité', trigger: { type: 'absolute', at: atHoursFromNow(3, now) } },
        { kind: 'recordatorio', label: 'Comprar leche', trigger: { type: 'absolute', at: atHoursFromNow(5, now) } },
        { kind: 'cita', label: 'Dentista 17:00', trigger: { type: 'absolute', at: now + DAY + 2 * HOUR } },
        { kind: 'clase', label: 'Matemáticas (Aula 12)', trigger: { type: 'weekly', daysOfWeek: [1], timeOfDay: '08:00' }, fin: '09:30', aula: 'Aula 12' },
        { kind: 'recordatorio', label: 'Llamar a mamá', trigger: { type: 'absolute', at: now + 2 * DAY } },
    ];
}

export function buildDemoNotes(): string[] {
    return [
        'Leer capítulo 3',
        'Pagar la luz',
        'Comprar regalo de cumpleaños',
    ];
}
