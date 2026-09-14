// ============================================================
// Guard de comportamiento — Caso 6
// ------------------------------------------------------------
// "alarma mañana 11:25" debe crear una alarma para mañana, no
// responder "ya existe". La deduplicación compara el DATETIME
// completo (no sólo HH:MM).
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseTemporalIntent } from '../src/core/temporal/temporalIntentParser';
import { isDuplicateTemporalItem } from '../src/core/temporal/temporalDedup';
import type { TemporalItemRecord } from '../src/core/temporal/temporalTypes';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime(); // Jueves 10:00
const TODAY_1125 = new Date(2026, 0, 15, 11, 25, 0, 0).getTime();
const TOMORROW_1125 = new Date(2026, 0, 16, 11, 25, 0, 0).getTime();
const SYNCHRONIZED_AT = new Date(NOW).toISOString();

function alarmAt(at: number, label = 'Alarma a las 11:25'): TemporalItemRecord {
    return {
        id: 'alarma-hoy',
        kind: 'alarm',
        label,
        trigger: { kind: 'absolute', at },
        recurrence: { kind: 'once' },
        nextAt: at,
        status: 'pending',
        createdAt: NOW,
        updatedAt: NOW,
        sync: { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
    };
}

describe('Caso 6 — dedup por datetime completo', () => {
    it('la alarma de mañana 11:25 NO es duplicado de la de hoy 11:25', () => {
        const intent = parseTemporalIntent('pon una alarma mañana a las 11:25', { now: NOW });
        expect(intent.action).toBe('alarm.add');
        expect(intent.data?.trigger).toEqual({ kind: 'absolute', at: TOMORROW_1125 });

        const existing = alarmAt(TODAY_1125);
        const wanted = {
            trigger: intent.data?.trigger,
            recurrence: intent.data?.recurrence,
            label: intent.data?.label,
        };

        expect(isDuplicateTemporalItem(existing, wanted)).toBe(false);
    });

    it('repetir el MISMO datetime sí es duplicado', () => {
        const existing = alarmAt(TOMORROW_1125);
        expect(
            isDuplicateTemporalItem(existing, {
                trigger: { kind: 'absolute', at: TOMORROW_1125 },
                recurrence: { kind: 'once' },
                label: 'Alarma a las 11:25',
            }),
        ).toBe(true);
    });

    it('una alarma diaria a la misma hora sí es duplicado', () => {
        const existing: TemporalItemRecord = {
            ...alarmAt(TODAY_1125),
            trigger: { kind: 'daily', timeOfDay: '11:25' },
            recurrence: { kind: 'daily' },
        };
        expect(
            isDuplicateTemporalItem(existing, {
                trigger: { kind: 'daily', timeOfDay: '11:25' },
                recurrence: { kind: 'daily' },
                label: 'Alarma a las 11:25',
            }),
        ).toBe(true);
    });
});
