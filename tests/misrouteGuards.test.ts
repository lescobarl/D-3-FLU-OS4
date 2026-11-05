// @vitest-environment jsdom
// ============================================================
// misrouteGuards — una PREGUNTA no debe disparar agenda ni juego
// ------------------------------------------------------------
// Bug real: "qué otro juego tienes" → la consulta de agenda era demasiado laxa
// (`que ` + `tienes`) y devolvía un recordatorio ("11:00 tomar medicina").
// Y "dime cuántas cartas tiene la lotería" iniciaba la partida en vez de ir a
// la IA. Además el ganador se anunciaba como UUID crudo.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { clearActiveGameSession } from '../src/core/games/gameSessionStore';
import { createLoteriaEngine } from '../src/core/games/loteria';

describe('consulta de agenda — solo con término de agenda o marcador temporal', () => {
    it.each([
        'qué otro juego tienes',
        'dime cuántas cartas tiene el juego de la lotería',
        'qué juegos tienes',
    ])('"%s" NO es consulta de agenda', (p) => {
        const r = parseAgendaCommand(p, { now: Date.now() });
        expect(r.handled, `"${p}" no debe resolverse como agenda`).toBe(false);
    });

    it.each(['qué hay hoy', 'qué hay para mañana', 'qué hay esta semana', 'qué citas tengo'])(
        '"%s" SÍ es consulta de agenda',
        (p) => {
            const r = parseAgendaCommand(p, { now: Date.now() });
            expect(r.handled, `"${p}" debe ser agenda.list`).toBe(true);
            expect(r.action).toBe('agenda.list');
        },
    );
});

describe('juego — preguntas van a la IA, no inician partida', () => {
    it('sin partida, "dime cuántas cartas tiene la lotería" NO inicia', () => {
        clearActiveGameSession();
        expect(resolveGameCommandFromText('dime cuántas cartas tiene la lotería')).toBeNull();
    });

    it('sin partida, "qué otro juego tienes" NO inicia', () => {
        clearActiveGameSession();
        expect(resolveGameCommandFromText('qué otro juego tienes')).toBeNull();
    });

    it('una invitación explícita SÍ inicia', () => {
        clearActiveGameSession();
        expect(resolveGameCommandFromText('juguemos a la lotería')?.action).toBe('start');
    });
});

describe('lotería — el ganador nunca es un id crudo', () => {
    it('sin nombre ⇒ "¡Ganaste!" (no UUID)', () => {
        const engine = createLoteriaEngine({ random: () => 0.5 });
        const session = engine.createSession({});
        engine.start(session, {});
        const r = engine.turn(session, 'lotería', { playerId: '7dc2e584-fd3e-4099-bfad-de47fcd08e1d' });
        expect(r.prompt).not.toContain('7dc2e584');
        expect(r.prompt).toContain('Ganaste');
    });

    it('con nombre ⇒ usa el nombre', () => {
        const engine = createLoteriaEngine({ random: () => 0.5 });
        const session = engine.createSession({});
        engine.start(session, {});
        const r = engine.turn(session, 'lotería', { playerName: 'Luis' });
        expect(r.prompt).toContain('Luis');
    });
});

/**
 * Marca vigilada: la frase es consulta de AGENDA. Exportada para poder
 * falsificarla (guardMutationGuard: sin prueba de detector es teatro).
 * @param texto Frase del usuario.
 */
export function agendaMarcada(texto: string): boolean {
    const r = parseAgendaCommand(texto, { now: Date.now() });
    return r.handled === true && r.action === 'agenda.list';
}

describe('PRUEBA DE DETECTOR - la marca de agenda discrimina', () => {
    it('PRUEBA DE DETECTOR: el detector marca la consulta con marcador y no marca la pregunta de juego', () => {
        // Entrada infractora sintetica (el bug medido): pregunta de juego con "tienes".
        expect(agendaMarcada('qué otro juego tienes')).toBe(false);
        expect(agendaMarcada('qué juegos tienes')).toBe(false);
        // Y no puede ser vacua: una consulta con marcador temporal SI se marca.
        expect(agendaMarcada('qué hay hoy')).toBe(true);
    });
});