// @vitest-environment jsdom
// ============================================================
// gameDoesNotHijackCommands - con una partida ACTIVA, el juego NO secuestra
// comandos de otros dominios.
//
// Defecto medido: `resolveGameCommandFromText` solo dejaba pasar el ALTA de nota
// (parseNoteIntentText) y no el borrado, y la lista de reconocimiento era una
// copia parcial de la del arbitro -> se desviaba. Un comando real de notas o
// agenda con la loteria activa caia al paso "cualquier otra cosa -> turn": el
// motor lo consumia como jugada (FLU "seguia el juego", respondia algo del juego
// y NUNCA ejecutaba el comando).
//
// Invariante: si un comando es accionable de otro dominio (notas/agenda), el
// arbitro lo resuelve a SU dominio y el juego lo deja pasar. El juego sigue vivo.
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { isNoteCommand } from '../src/voice/lib/noteIntentParser';
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore';

const LOTERIA_SESSION = {
    id: 'loteria',
    state: { order: [0, 1, 2], cursor: 0, winner: null, phase: 'announce' },
    score: 0,
    round: 1,
};

beforeEach(() => setActiveGameSession(LOTERIA_SESSION as never));
afterEach(() => clearActiveGameSession());

// Frases REALES de la sesion (log del dueno), no variantes curadas.
const NOTE_COMMANDS = [
    'Okay Flow incluye la nota del súper un poco de pan',
    'Okay Flow incluye en la nota del súper insecticida',
    'Okay Flow adiciona en la nota del súper focos',
    'apunta comprar pan',
    'borra la nota del súper',
    'quita la nota de compras',
    'borra todas las notas',
];

describe('con partida activa, un comando de NOTAS se ejecuta (no es jugada)', () => {
    for (const frase of NOTE_COMMANDS) {
        it(`"${frase}" -> dominio note`, () => {
            expect(resolveGameCommandFromText(frase)).toBeNull();
            const arb = resolveDeterministicCommand(frase, { language: 'es' });
            expect(arb.matched).toBe(true);
            expect(arb.domain).toBe('note');
        });
    }
});

const AGENDA_COMMANDS = [
    'Okay Flow borra la junta de comité del jueves',
    'borra la clase de historia del jueves',
    'crea una alarma hoy a las 5:59',
];

describe('con partida activa, un comando de AGENDA se ejecuta (no es jugada)', () => {
    for (const frase of AGENDA_COMMANDS) {
        it(`"${frase}" NO cae en el juego`, () => {
            expect(resolveGameCommandFromText(frase)).toBeNull();
            const arb = resolveDeterministicCommand(frase, { language: 'es' });
            expect(arb.domain).not.toBe('game');
        });
    }
});

describe('el juego sigue funcionando (no se rompio lo validado)', () => {
    it('"siguiente" sigue siendo turno', () => {
        expect(resolveGameCommandFromText('siguiente')).toMatchObject({ action: 'turn' });
    });
    it('una respuesta abierta sigue siendo turno', () => {
        expect(resolveGameCommandFromText('el sol')).toMatchObject({ action: 'turn' });
    });
    it('"salir" termina la partida', () => {
        expect(resolveGameCommandFromText('salir')).toMatchObject({ action: 'end' });
    });
});

describe('isNoteCommand - fuente unica del passthrough', () => {
    it('reconoce el alta Y el borrado, y no confunde una jugada', () => {
        expect(isNoteCommand('apunta comprar pan')).toBe(true);
        expect(isNoteCommand('incluye la nota del súper pan')).toBe(true);
        expect(isNoteCommand('borra la nota del súper')).toBe(true);
        expect(isNoteCommand('borra todas las notas')).toBe(true);
        expect(isNoteCommand('siguiente carta')).toBe(false);
    });
});
