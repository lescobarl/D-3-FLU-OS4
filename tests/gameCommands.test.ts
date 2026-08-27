// ============================================================
// tests/gameCommands.test.ts
// Valida el fast-path determinista de juegos por voz:
// - resolveGameCommandFromText (partida activa vs. intención de
//   inicio; guardia estricta: sin partida no inicia nada casual).
// - normalizeJuego (sanitiza el contrato emitido por el modelo).
// ============================================================
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resolveGameCommandFromText } from '../src/voice/lib/gameCommands';
import { normalizeJuego } from '../src/voice/lib/configCommands';
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore';

describe('gameCommands — resolveGameCommandFromText (sin partida activa)', () => {
    afterEach(() => {
        clearActiveGameSession();
    });

    test('intención de inicio → start adivinanzas', () => {
        expect(resolveGameCommandFromText('vamos a jugar a las adivinanzas')).toEqual({
            gameId: 'adivinanzas',
            action: 'start',
        });
    });

    test('intención de inicio con wake → start simon_dice', () => {
        expect(resolveGameCommandFromText('ok flu juguemos a simon dice')).toEqual({
            gameId: 'simon_dice',
            action: 'start',
        });
    });

    test('"simón dice que te calles" NO inicia nada', () => {
        expect(resolveGameCommandFromText('simón dice que te calles')).toBeNull();
    });

    test('conversación casual no dispara', () => {
        expect(resolveGameCommandFromText('hola flu')).toBeNull();
        expect(resolveGameCommandFromText('')).toBeNull();
    });

    test('frase de salida SIN partida activa no dispara', () => {
        expect(resolveGameCommandFromText('salir del juego')).toBeNull();
        expect(resolveGameCommandFromText('ya basta')).toBeNull();
    });
});

describe('gameCommands — resolveGameCommandFromText (con partida activa)', () => {
    beforeEach(() => {
        setActiveGameSession({ id: 'simon_dice', state: {}, score: 0, round: 1 });
    });

    afterEach(() => {
        clearActiveGameSession();
    });

    test('respuesta del jugador → turn con playerText', () => {
        expect(resolveGameCommandFromText('baila')).toEqual({
            gameId: 'simon_dice',
            action: 'turn',
            playerText: 'baila',
        });
    });

    test('frases de salida → end', () => {
        expect(resolveGameCommandFromText('salir del juego')).toEqual({ gameId: 'simon_dice', action: 'end' });
        expect(resolveGameCommandFromText('ya basta')).toEqual({ gameId: 'simon_dice', action: 'end' });
        expect(resolveGameCommandFromText('terminemos')).toEqual({ gameId: 'simon_dice', action: 'end' });
        expect(resolveGameCommandFromText('se acabó')).toEqual({ gameId: 'simon_dice', action: 'end' });
    });
});

describe('normalizeJuego — sanitiza el contrato emitido por el modelo', () => {
    test('objeto válido start', () => {
        expect(normalizeJuego({ gameId: 'simon_dice', action: 'start' })).toEqual({
            gameId: 'simon_dice',
            action: 'start',
        });
    });

    test('JSON string válido turn', () => {
        expect(normalizeJuego('{"gameId":"adivinanzas","action":"turn","playerText":"es la pera"}')).toEqual({
            gameId: 'adivinanzas',
            action: 'turn',
            playerText: 'es la pera',
        });
    });

    test('claves juego/accion (alias en español)', () => {
        expect(normalizeJuego({ juego: 'simon_dice', accion: 'start' })).toEqual({
            gameId: 'simon_dice',
            action: 'start',
        });
    });

    test('gameId inválido → null', () => {
        expect(normalizeJuego({ gameId: 'piedra_papel', action: 'start' })).toBeNull();
    });

    test('acción inválida → null', () => {
        expect(normalizeJuego({ gameId: 'simon_dice', action: 'jugar' })).toBeNull();
    });

    test('turn sin playerText (o en blanco) → null', () => {
        expect(normalizeJuego({ gameId: 'simon_dice', action: 'turn' })).toBeNull();
        expect(normalizeJuego({ gameId: 'simon_dice', action: 'turn', playerText: '   ' })).toBeNull();
    });

    test('narrate sanitiza escenas (texto, animacion, emocion)', () => {
        const raw = {
            gameId: 'cuentacuentos',
            action: 'narrate',
            narrative: {
                scenes: [
                    { texto: '  Hola  ', animacion: 'Dance', emocion: 'alegre' },
                    { texto: '   ', animacion: 'Run' },
                    { texto: 'Segundo', emocion: '  ' },
                ],
            },
        };
        expect(normalizeJuego(raw)).toEqual({
            gameId: 'cuentacuentos',
            action: 'narrate',
            narrative: {
                scenes: [
                    { texto: 'Hola', animacion: 'Dance', emocion: 'alegre' },
                    { texto: 'Segundo' },
                ],
            },
        });
    });

    test('narrate sin escenas válidas → null', () => {
        expect(normalizeJuego({ gameId: 'cuentacuentos', action: 'narrate', narrative: { scenes: [{ texto: '  ' }] } })).toBeNull();
    });

    test('entradas no objeto → null', () => {
        expect(normalizeJuego(null)).toBeNull();
        expect(normalizeJuego(undefined)).toBeNull();
        expect(normalizeJuego(42)).toBeNull();
        expect(normalizeJuego([1, 2])).toBeNull();
        expect(normalizeJuego('')).toBeNull();
        expect(normalizeJuego('no es json')).toBeNull();
    });
});
