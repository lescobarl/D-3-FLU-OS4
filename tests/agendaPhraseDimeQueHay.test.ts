// ============================================================
// Guard — la consulta de agenda acepta la frase real del usuario
// ------------------------------------------------------------
// "ok flu, dime qué hay para hoy" debe resolverse por el parser ÚNICO de
// agenda (`agendaCommand` → acción `agenda.list`). Fija la frase literal.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';

describe('agenda — variantes habladas de la consulta', () => {
    it('"dime qué hay para hoy" → agenda.list', () => {
        expect(parseAgendaCommand('dime qué hay para hoy')).toMatchObject({
            handled: true,
            action: 'agenda.list',
        });
    });

    it('"ok flu dime qué hay para hoy" (con wake) → agenda.list', () => {
        expect(parseAgendaCommand('ok flu dime qué hay para hoy')).toMatchObject({
            handled: true,
            action: 'agenda.list',
        });
    });

    it('"¿qué hay para hoy?" sigue funcionando', () => {
        expect(parseAgendaCommand('¿qué hay para hoy?')).toMatchObject({
            handled: true,
            action: 'agenda.list',
        });
    });

    it('una frase que no es agenda no matchea', () => {
        expect(parseAgendaCommand('dime un chiste').handled).toBe(false);
    });
});
