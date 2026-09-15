// ============================================================
// Guard — la consulta de agenda acepta la frase real del usuario
// ------------------------------------------------------------
// "ok flu, dime qué hay para hoy" no matcheaba: el trigger exigía
// `dime` + (agenda|plan|resumen|día). Este guard fija la frase literal.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseAgendaIntent } from '../src/core/agenda/agendaIntentParser';

describe('agenda — variantes habladas de la consulta', () => {
    it('"dime qué hay para hoy" → agenda.today', () => {
        expect(parseAgendaIntent('dime qué hay para hoy')).toMatchObject({
            handled: true,
            action: 'agenda.today',
        });
    });

    it('"ok flu dime qué hay para hoy" (con wake) → agenda.today', () => {
        expect(parseAgendaIntent('ok flu dime qué hay para hoy')).toMatchObject({
            handled: true,
            action: 'agenda.today',
        });
    });

    it('"¿qué hay para hoy?" sigue funcionando', () => {
        expect(parseAgendaIntent('¿qué hay para hoy?')).toMatchObject({
            handled: true,
            action: 'agenda.today',
        });
    });

    it('una frase que no es agenda no matchea', () => {
        expect(parseAgendaIntent('dime un chiste').handled).toBe(false);
    });
});
