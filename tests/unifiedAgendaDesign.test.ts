// ============================================================
// Prueba de ESCRITORIO del modelo unificado de agenda (prototipo)
// ------------------------------------------------------------
// NO es la implementación: es la validación del DISEÑO que pidió la spec
// (9 puntos + reglas técnicas). Reutiliza los primitivos de fecha/hora REALES
// ya validados (`scheduleEngine`) para probar que la parte difícil (fechas,
// semanal, dedup, colores) se resuelve con lo que ya existe.
//
// Decisiones declaradas (para no suponer):
//   - `trigger` es UN SOLO campo (type + parámetros); NO existe `recurrence`.
//   - `personId` SÍ es parte de la fila (multiusuario).
//   - `color` se DERIVA de FLU_CONFIG.agenda.colors[kind] (no se guarda).
//   - Las notas NO son agenda (texto, sin fecha) → no hay kind 'nota'.
//   - dedup key = kind + label normalizado + trigger serializado.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    startOfLocalDay,
    localDayDiff,
    dayOfWeek,
    MS_DAY,
    parseTimeOfDayToMs,
} from '../src/core/temporal/scheduleEngine';

type AgendaKind = 'recordatorio' | 'cita' | 'junta' | 'clase' | 'alarma';

type Trigger =
    | { type: 'absolute'; at: number }
    | { type: 'daily'; timeOfDay: string }
    | { type: 'weekly'; daysOfWeek: number[]; timeOfDay: string }
    | { type: 'countdown'; durationMs: number };

type AgendaStatus = 'pending' | 'done' | 'deleted';

interface AgendaItem {
    id: string;
    kind: AgendaKind;
    label: string;
    personId?: string;
    trigger: Trigger;
    status: AgendaStatus;
    sync: { revision: number; updated_at: string; deleted: boolean };
}

// --- Punto 3: color derivado (aquí prototipo; en real sale de FLU_CONFIG) ---
const COLORS: Record<AgendaKind, string> = {
    recordatorio: '#f59e0b',
    cita: '#3b82f6',
    junta: '#8b5cf6',
    clase: '#22c55e',
    alarma: '#ef4444',
};
function colorFor(kind: AgendaKind): string {
    return COLORS[kind];
}

// --- Trigger → próxima ocurrencia (reutiliza scheduleEngine) ---
function timeOfDayMs(timeOfDay: string): number {
    return parseTimeOfDayToMs(timeOfDay);
}

function nextDue(trigger: Trigger, now: number): number {
    switch (trigger.type) {
        case 'absolute':
            return trigger.at;
        case 'countdown':
            return now + trigger.durationMs;
        case 'daily': {
            const start = startOfLocalDay(now);
            let at = start + timeOfDayMs(trigger.timeOfDay);
            if (at <= now) at += MS_DAY;
            return at;
        }
        case 'weekly': {
            const start = startOfLocalDay(now);
            const todayDow = dayOfWeek(now);
            const target = trigger.daysOfWeek.find((d) => d > todayDow) ?? trigger.daysOfWeek[0];
            let delta = target - todayDow;
            if (delta <= 0) delta += 7;
            return start + delta * MS_DAY + timeOfDayMs(trigger.timeOfDay);
        }
    }
}

// --- Punto 8: dedup key ---
function normalizeLabel(label: string): string {
    return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function dedupKey(item: Omit<AgendaItem, 'id' | 'status' | 'sync'>): string {
    return `${item.kind}|${normalizeLabel(item.label)}|${JSON.stringify(item.trigger)}`;
}

// --- Punto 7: acción de disparo por kind ---
function triggerAction(kind: AgendaKind): 'sonar' | 'avisar' | 'marcar' {
    if (kind === 'alarma') return 'sonar';
    if (kind === 'recordatorio') return 'avisar';
    return 'marcar'; // cita/junta/clase
}

const NOW = new Date(2026, 8, 15, 22, 0, 0, 0).getTime(); // martes 15-sep-2026

describe('agenda unificada — diseño (prototipo)', () => {
    it('P1: todos los tipos son UNA lista con el MISMO tipo', () => {
        const kinds: AgendaKind[] = ['recordatorio', 'cita', 'junta', 'clase', 'alarma'];
        const items: AgendaItem[] = kinds.map((kind) => ({
            id: `id-${kind}`,
            kind,
            label: kind,
            trigger: { type: 'absolute', at: NOW + MS_DAY },
            status: 'pending',
            sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
        }));
        expect(items).toHaveLength(5);
        expect(items.every((i) => typeof i.kind === 'string')).toBe(true);
    });

    it('P2: vista día/semana/mes filtra por próxima ocurrencia', () => {
        const hoy = { type: 'absolute', at: NOW + 30 * 60 * 1000 } as Trigger; // 22:30, mismo día
        const manana = { type: 'absolute', at: startOfLocalDay(NOW) + MS_DAY + 11 * 60 * 60 * 1000 } as Trigger;
        const enUnMes = { type: 'absolute', at: startOfLocalDay(NOW) + 32 * MS_DAY } as Trigger;

        expect(localDayDiff(NOW, nextDue(hoy, NOW))).toBe(0); // hoy
        expect(localDayDiff(NOW, nextDue(manana, NOW))).toBe(1); // mañana
        expect(localDayDiff(NOW, nextDue(enUnMes, NOW))).toBeGreaterThanOrEqual(28); // otro mes
    });

    it('P3: el color se deriva del kind (config), no se guarda', () => {
        expect(colorFor('alarma')).not.toBe(colorFor('clase'));
        expect(colorFor('cita')).not.toBe(colorFor('junta'));
    });

    it('P4: "mañana a las 11" ≠ "hoy", y "los lunes" es weekly', () => {
        const manana = nextDue({ type: 'daily', timeOfDay: '11:00' }, NOW);
        // "mañana" se modela como absolute +1 día; "diaria" cae a la próxima 11:00.
        const absoluteManana = { type: 'absolute', at: startOfLocalDay(NOW) + MS_DAY + timeOfDayMs('11:00') } as Trigger;
        expect(localDayDiff(NOW, nextDue(absoluteManana, NOW))).toBe(1);
        expect(manana).toBeGreaterThan(NOW);

        // weekly: lunes (1) a las 9.
        const lunes = nextDue({ type: 'weekly', daysOfWeek: [1], timeOfDay: '09:00' }, NOW);
        expect(dayOfWeek(lunes)).toBe(1);
        expect(lunes).toBeGreaterThan(NOW);
    });

    it('P5: editar cambia fecha/label; cancelar es borrado LÓGICO', () => {
        const item: AgendaItem = {
            id: 'x',
            kind: 'alarma',
            label: 'Alarma',
            trigger: { type: 'absolute', at: NOW + MS_DAY },
            status: 'pending',
            sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
        };
        // editar
        const editado: AgendaItem = { ...item, label: 'Alarma editada', trigger: { type: 'absolute', at: NOW + 2 * MS_DAY } };
        expect(editado.label).not.toBe(item.label);
        expect(editado.trigger).not.toEqual(item.trigger);
        // cancelar
        const cancelado: AgendaItem = { ...item, status: 'deleted', sync: { ...item.sync, deleted: true, revision: item.sync.revision + 1 } };
        expect(cancelado.status).toBe('deleted');
        expect(cancelado.sync.deleted).toBe(true);
    });

    it('P6: "qué hay para hoy" devuelve TODOS los kinds en una sola lista', () => {
        const items: AgendaItem[] = ['alarma', 'cita', 'junta', 'clase', 'recordatorio'].map((kind, i) => ({
            id: `k${i}`,
            kind: kind as AgendaKind,
            label: kind,
            trigger: { type: 'absolute', at: NOW + i * 60 * 1000 } as Trigger,
            status: 'pending',
            sync: { revision: 1, updated_at: '', deleted: false },
        }));
        const deHoy = items.filter((i) => localDayDiff(NOW, nextDue(i.trigger, NOW)) === 0);
        expect(deHoy.map((i) => i.kind).sort()).toEqual(
            ['alarma', 'cita', 'junta', 'clase', 'recordatorio'].sort(),
        );
    });

    it('P7: a la hora, cada kind hace lo suyo', () => {
        expect(triggerAction('alarma')).toBe('sonar');
        expect(triggerAction('recordatorio')).toBe('avisar');
        expect(triggerAction('cita')).toBe('marcar');
        expect(triggerAction('junta')).toBe('marcar');
        expect(triggerAction('clase')).toBe('marcar');
    });

    it('P8: pedir dos veces lo mismo NO duplica (misma dedup key)', () => {
        const a = { kind: 'alarma' as AgendaKind, label: 'Despertador', trigger: { type: 'daily', timeOfDay: '07:00' } as Trigger };
        const b = { kind: 'alarma' as AgendaKind, label: 'despertador', trigger: { type: 'daily', timeOfDay: '07:00' } as Trigger };
        expect(dedupKey(a)).toBe(dedupKey(b));
    });

    it('P9: las notas quedan FUERA (no hay kind nota en agenda)', () => {
        const kinds: AgendaKind[] = ['recordatorio', 'cita', 'junta', 'clase', 'alarma'];
        expect(kinds).not.toContain('nota' as AgendaKind);
    });
});
