// ============================================================
// Guard de comportamiento — Caso 9
// ------------------------------------------------------------
// "crea una junta … para hoy a las 12:00" debe resolverse de forma
// determinista como UNA entrada de horario (no caer a Gemini ni
// quedar duplicada por dos rutas). El sustantivo "junta/reunión"
// también dispara el alta sin verbo previo.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseHorarioIntent } from '../src/core/horario/horarioIntentParser';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';

describe('Caso 9 — junta como entrada de horario, ruta única', () => {
    it('reconoce "junta" sin verbo previo (dictado real)', () => {
        const r = parseHorarioIntent('junta de equipo hoy a las 12:00');
        expect(r.handled).toBe(true);
        expect(r.action).toBe('horario.add');
        expect(r.data?.inicio).toBe('12:00');
        expect(String(r.data?.materia || '').toLowerCase()).toContain('equipo');
    });

    it('el árbitro enruta "crea una junta …" a agendaCommand (una sola ruta)', () => {
        const r = resolveDeterministicCommand('crea una junta para hoy a las 12:00');
        expect(r.matched).toBe(true);
        expect(r.domain).toBe('agendaCommand');
        expect((r.action as { action?: string }).action).toBe('agenda.create');
        expect((r.action as { kind?: string }).kind).toBe('junta');
    });

    it('"reunión" también se reconoce como agenda (junta)', () => {
        const r = resolveDeterministicCommand('reunión del equipo hoy a las 12:00');
        expect(r.domain).toBe('agendaCommand');
        expect((r.action as { action?: string }).action).toBe('agenda.create');
        expect((r.action as { kind?: string }).kind).toBe('junta');
    });
});
