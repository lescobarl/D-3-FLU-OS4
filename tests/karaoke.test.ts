// ============================================================
// karaoke — Motor puro de Karaoke (plan-juegos §Fase 3, Riesgo 3, MVP).
//   - createKaraokeEngine({ random }) → GameEngine (RNG inyectable).
//   - FLU pone una pista (session.state.songId espejo de FLU_PLAYLIST),
//     muestra la letra línea a línea y avanza con "sigue"/"paso".
//   - NO hay validación de canto: el niño canta libremente.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0` → KARAOKE_SONG_BANK[0] = Estrellita).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createKaraokeEngine, KARAOKE_SONG_BANK } from '../src/core/games/karaoke';

// random:()=>0 → floor(0*9) = 0 → canción = KARAOKE_SONG_BANK[0] = 'Estrellita'.
function freshKaraoke() {
    const engine = createKaraokeEngine({ random: () => 0 });
    const session = engine.createSession();
    const startResult = engine.start(session);
    return { engine, session, startResult };
}

describe('karaoke — inicio de partida', () => {
    test('start anuncia la canción "Estrellita" y su primera línea', () => {
        const { session, startResult } = freshKaraoke();
        expect(startResult.prompt).toBe(
            '¡Hora de cantar! Vamos a cantar "Estrellita" juntos. La pista ya suena. Escucha la primera línea: "Estrellita, ¿dónde estás?" Cántala conmigo y dime "sigue" para la siguiente.'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.state.songId).toBe('estrellita');
        expect(session.round).toBe(1);
    });

    test('el banco tiene 9 canciones con estructura {id, titulo, lineas} de 4 líneas', () => {
        expect(KARAOKE_SONG_BANK).toHaveLength(9);
        for (const song of KARAOKE_SONG_BANK) {
            expect(typeof song.id).toBe('string');
            expect(song.id.length).toBeGreaterThan(0);
            expect(typeof song.titulo).toBe('string');
            expect(song.titulo.length).toBeGreaterThan(0);
            expect(song.lineas).toHaveLength(4);
            for (const linea of song.lineas) {
                expect(typeof linea).toBe('string');
                expect(linea.length).toBeGreaterThan(0);
            }
        }
        expect(KARAOKE_SONG_BANK[0].id).toBe('estrellita');
        expect(KARAOKE_SONG_BANK[0].titulo).toBe('Estrellita');
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const engine = createKaraokeEngine({ random: () => 0 });
        const session = engine.createSession();
        expect(session.id).toBe('karaoke');
        expect(session.state.songId).toBe('estrellita');
        expect(session.state.titulo).toBe('Estrellita');
        expect(session.state.cursor).toBe(0);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.songId).toBe('estrellita');
        expect(roundTrip.state.cursor).toBe(0);
        engine.start(session);
        expect(session.state.phase).toBe('singing');
    });
});

describe('karaoke — avance de líneas con "sigue"', () => {
    test('"sigue" avanza a la segunda línea', () => {
        const { engine, session } = freshKaraoke();
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe(
            '¡Sigue así! Siguiente línea: "Me pregunto qué serás." Cántala y dime "sigue".'
        );
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(session.state.cursor).toBe(1);
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
    });

    test('segundo "sigue" avanza a la tercera línea', () => {
        const { engine, session } = freshKaraoke();
        engine.turn(session, 'sigue');
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe(
            '¡Sigue así! Siguiente línea: "En el cielo y en el mar" Cántala y dime "sigue".'
        );
        expect(result.valid).toBe(true);
        expect(session.state.cursor).toBe(2);
    });

    test('tercer "sigue" avanza a la cuarta línea', () => {
        const { engine, session } = freshKaraoke();
        engine.turn(session, 'sigue');
        engine.turn(session, 'sigue');
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe(
            '¡Sigue así! Siguiente línea: "un diamante de verdad." Cántala y dime "sigue".'
        );
        expect(result.valid).toBe(true);
        expect(session.state.cursor).toBe(3);
    });

    test('cuarto "sigue" completa la canción → gameOver', () => {
        const { engine, session } = freshKaraoke();
        engine.turn(session, 'sigue');
        engine.turn(session, 'sigue');
        engine.turn(session, 'sigue');
        const result = engine.turn(session, 'sigue');
        expect(result.prompt).toBe(
            '¡Cantamos toda la canción "Estrellita"! un diamante de verdad. ¡Bravo, eres una estrella!'
        );
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.animation).toBe('Dance');
        expect(result.emotion).toBe('happy');
    });
});

describe('karaoke — sin validación de canto', () => {
    test('cantar libremente ("la la la") → invita a cantar la línea actual, sin error', () => {
        const { engine, session } = freshKaraoke();
        const result = engine.turn(session, 'la la la');
        expect(result.prompt).toBe(
            '¡Canta conmigo! "Estrellita, ¿dónde estás?" Cuando la cantes, dime "sigue" para la siguiente línea.'
        );
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBeUndefined();
        expect(session.state.cursor).toBe(0);
        expect(result.emotion).toBe('encouraging');
    });
});

describe('karaoke — controles del jugador (pista / saltar)', () => {
    test('"pista" repite la línea actual', () => {
        const { engine, session } = freshKaraoke();
        const result = engine.turn(session, 'pista');
        expect(result.prompt).toBe(
            'Claro, la repito: "Estrellita, ¿dónde estás?" Cántala conmigo y dime "sigue" para la siguiente.'
        );
        expect(result.valid).toBe(false);
        expect(result.emotion).toBe('thinking');
    });

    test('"repite" entrega pista (no avanza: hint tiene prioridad)', () => {
        const { engine, session } = freshKaraoke();
        const result = engine.turn(session, 'repite');
        expect(result.prompt).toBe(
            'Claro, la repito: "Estrellita, ¿dónde estás?" Cántala conmigo y dime "sigue" para la siguiente.'
        );
        expect(session.state.cursor).toBe(0);
    });

    test('"paso" salta a la siguiente línea', () => {
        const { engine, session } = freshKaraoke();
        const result = engine.turn(session, 'paso');
        expect(result.prompt).toBe(
            '¡Sigue así! Siguiente línea: "Me pregunto qué serás." Cántala y dime "sigue".'
        );
        expect(result.valid).toBe(true);
        expect(result.score).toBe(0);
        expect(session.state.cursor).toBe(1);
    });
});

describe('karaoke — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshKaraoke();
        engine.turn(session, 'sigue');
        engine.turn(session, 'sigue');
        engine.turn(session, 'sigue');
        engine.turn(session, 'sigue');
        const result = engine.turn(session, 'hola flu');
        expect(result.prompt).toBe('Ya terminamos de cantar. ¿Cantamos otra canción?');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(true);
        expect(result.emotion).toBe('happy');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createKaraokeEngine({ random: () => 0 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('sigue')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('la la la')).toBe(false);
    });
});

describe('karaoke — selección data-driven (sin hardcode)', () => {
    test('el RNG elige la canción del banco (sin canción hardcodeada)', () => {
        const enginePrimera = createKaraokeEngine({ random: () => 0 });
        const sessionPrimera = enginePrimera.createSession();
        expect(sessionPrimera.state.songId).toBe(KARAOKE_SONG_BANK[0].id);
        expect(sessionPrimera.state.songId).toBe('estrellita');

        const engineUltima = createKaraokeEngine({ random: () => 0.9999 });
        const sessionUltima = engineUltima.createSession();
        expect(sessionUltima.state.songId).toBe(KARAOKE_SONG_BANK[8].id);
        expect(sessionUltima.state.songId).toBe('elisa');
    });
});
