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
        // ALARMA — suena una vez (hoy, en breve, para ver el banner "Detener").
        { kind: 'alarma', label: 'Tomar medicamento', trigger: { type: 'absolute', at: now + 35 * 1000 } },
        // JUNTA — cita puntual de hoy.
        { kind: 'junta', label: 'Junta de comité', trigger: { type: 'absolute', at: atHoursFromNow(3, now) } },
        // RECORDATORIO — aviso puntual de hoy.
        { kind: 'recordatorio', label: 'Comprar leche', trigger: { type: 'absolute', at: atHoursFromNow(5, now) } },
        // CITA — turno puntual de mañana.
        { kind: 'cita', label: 'Dentista', trigger: { type: 'absolute', at: now + DAY + 2 * HOUR } },
        // CLASES — horario escolar semanal (recurrente), varios días.
        { kind: 'clase', label: 'Matemáticas', trigger: { type: 'weekly', daysOfWeek: [1], timeOfDay: '08:00' }, fin: '09:30', aula: 'Aula 12' },
        { kind: 'clase', label: 'Historia', trigger: { type: 'weekly', daysOfWeek: [2, 4], timeOfDay: '10:00' }, fin: '11:00', aula: 'Aula 3' },
        { kind: 'clase', label: 'Ciencias', trigger: { type: 'weekly', daysOfWeek: [3], timeOfDay: '12:00' }, fin: '13:00', aula: 'Laboratorio' },
        // RECORDATORIO futuro.
        { kind: 'recordatorio', label: 'Llamar a mamá', trigger: { type: 'absolute', at: now + 2 * DAY } },
    ];
}

export function buildDemoNotes(): Array<{ label: string; body?: string }> {
    return [
        { label: 'Super', body: 'huevo\npan\ncloro\njamón\ncroquetas' },
        { label: 'Leer capítulo 3' },
        { label: 'Pagar la luz' },
    ];
}
