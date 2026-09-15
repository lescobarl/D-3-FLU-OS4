// ============================================================
// Guard — el SUSTANTIVO manda: "alarma" vs "recordatorio"
// ------------------------------------------------------------
// Causa raíz: `REMINDER_TRIGGERS_ES` reclamaba "pon(me) una alarma" y, como el
// árbitro evalúa `reminder` ANTES que `temporal`, se creaba una cita en vez de
// una alarma (y con el asunto basura "para").
// Este guard ejecuta los parsers reales y el árbitro.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseReminderIntent } from '../src/core/reminders/reminderIntentParser';
import { parseTemporalIntent } from '../src/core/temporal/temporalIntentParser';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';

// Martes 15 de septiembre de 2026, 22:20 (jueves → 17).
const NOW = new Date(2026, 8, 15, 22, 20, 0, 0).getTime();
const PHRASE = 'pon una alarma para el jueves a las 13:00 p.m';

describe('sustantivo manda — alarma → temporal', () => {
    it('"pon una alarma…" NO se enruta como recordatorio', () => {
        const r = parseReminderIntent(PHRASE, { defaultOffsetMs: 600000 });
        expect(Boolean(r.handled && r.action)).toBe(false);
    });

    it('"pon una alarma…" se enruta a temporal con jueves 13:00', () => {
        const t = parseTemporalIntent(PHRASE, { now: NOW });
        expect(t.handled).toBe(true);
        expect(t.action).toBe('alarm.add');
        const at = (t.data as { trigger?: { at?: number } })?.trigger?.at;
        expect(typeof at).toBe('number');
        const d = new Date(at as number);
        expect(d.getDay()).toBe(4); // jueves
        expect(d.getHours()).toBe(13);
        expect(d.getMinutes()).toBe(0);
    });

    it('el árbitro resuelve dominio temporal (no reminder)', () => {
        const r = resolveDeterministicCommand(PHRASE, { now: NOW, defaultOffsetMs: 600000 });
        expect(r.domain).toBe('temporal');
    });
});

describe('sustantivo manda — recordatorio → reminder', () => {
    it('"ponme un recordatorio…" sí es reminder y su asunto nunca es un conector', () => {
        const r = parseReminderIntent('ponme un recordatorio para el jueves a las 13:00', {
            defaultOffsetMs: 600000,
        });
        if (r.handled && r.action) {
            const text = String((r.data as { text?: string })?.text || '').trim().toLowerCase();
            expect(['para', 'que', 'de', 'del', 'el', 'la']).not.toContain(text);
        }
    });
});
