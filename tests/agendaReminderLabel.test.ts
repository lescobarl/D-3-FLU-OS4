// ============================================================
// agendaReminderLabel — etiqueta limpia de recordatorio por dictado real
// ------------------------------------------------------------
// Bug real: "crea un recordatorio Okay flu crea un recordatorio para mañana
// que me recuerde tomar la medicina a las 9:00 a.m" creaba el recordatorio
// con etiqueta sucia ("Okay flu crea recordatorio que me recuerde …").
// Invariante: la etiqueta es SOLO el contenido y el disparo es mañana 9:00.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';

const NOW = new Date(2026, 8, 17, 16, 30, 0, 0).getTime();
const PHRASE =
    'crea un recordatorio Okay flu crea un recordatorio para mañana que me recuerde tomar la medicina a las 9:00 a.m';

function localDayDiff(from: number, to: number): number {
    const a = new Date(from);
    const b = new Date(to);
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.round((db - da) / 86_400_000);
}

describe('agenda — etiqueta limpia de recordatorio (dictado real)', () => {
    it('"crea un recordatorio … que me recuerde tomar la medicina a las 9" → contenido limpio', () => {
        const r = parseAgendaCommand(PHRASE, { now: NOW });
        expect(r.handled).toBe(true);
        expect(r.kind).toBe('recordatorio');
        expect(r.action).toBe('agenda.create');
        const label = String(r.label || '').toLowerCase();
        expect(label).toBe('tomar medicina');
        expect(label).not.toContain('recuerde');
        expect(label).not.toContain('recordatorio');
        expect(label).not.toContain('okay');
        expect(label).not.toContain('crea');
    });

    it('el disparo es MAÑANA a las 9:00 (no hoy, no otra hora)', () => {
        const r = parseAgendaCommand(PHRASE, { now: NOW });
        expect(r.trigger?.type).toBe('absolute');
        const at = (r.trigger as { at: number }).at;
        expect(localDayDiff(NOW, at)).toBe(1);
        expect(new Date(at).getHours()).toBe(9);
        expect(new Date(at).getMinutes()).toBe(0);
    });

    it('GENERALIZA: otra frase también queda limpia (sin lista de contenidos)', () => {
        const r = parseAgendaCommand('recuérdame regar las plantas mañana a las 7', { now: NOW });
        expect(r.kind).toBe('recordatorio');
        expect(String(r.label || '').toLowerCase()).toBe('regar plantas');
        expect(new Date((r.trigger as { at: number }).at).getHours()).toBe(7);
    });
});
