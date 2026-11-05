// ============================================================
// adivinaCancion — Motor puro de "Adivina la canción" (plan-juegos §Fase 3).
//   - createAdivinaCancionEngine({ random }) → GameEngine (RNG inyectable).
//   - Banco local SONG_BANK que espeja ids/títulos de FLU_PLAYLIST para
//     que App.tsx mapee `songId` → playSong(trackId).
//   - FLU elige canción + pista + 3 opciones; el niño responde el título.
// Objetivo: validar el comportamiento REAL del motor con un RNG
// determinista (`() => 0.9999` → shuffleOrder identidad [0..8] →
// objetivo = banco[0] = sueño; buildOptions elige cielito y elisa como
// distractores, ordenados por índice del banco → [sueño, elisa, cielito]).
// Sin dummies: cada prompt es el string exacto que FLU verbaliza.
// ============================================================
import { describe, test, expect } from 'vitest';
import { createAdivinaCancionEngine, SONG_BANK } from '../src/core/games/adivinaCancion';

// random:()=>0.9999 → shuffleOrder identidad [0..8] → objetivo banco[0] = sueño.
// buildOptions(0, rng): floor(0.9999*8)=7 → cielito; floor(0.9999*7)=6 → elisa.
// Opciones (ordenadas por índice del banco): ['Sueño de Bunny','Para Elisa','Cielito Lindo'].
function freshAdivina(config: Record<string, unknown> = {}) {
    const engine = createAdivinaCancionEngine({ random: () => 0.9999 });
    const session = engine.createSession(config);
    const startResult = engine.start(session, config);
    return { engine, session, startResult };
}

describe('adivinaCancion — inicio de partida', () => {
    test('start anuncia la primera canción (sueño) con sus opciones', () => {
        const { session, startResult } = freshAdivina();
        expect(startResult.prompt).toBe(
            '¡Vamos a adivinar canciones! Escucha con atención. Pista: Habla de dormir y soñar con conejitos. ¿Es Sueño de Bunny, Para Elisa, Cielito Lindo?'
        );
        expect(startResult.valid).toBe(false);
        expect(startResult.gameOver).toBe(false);
        expect(startResult.score).toBe(0);
        expect(startResult.animation).toBe('Idle');
        expect(startResult.emotion).toBe('excited');
        expect(session.round).toBe(1);
    });

    test('session.state.songId expone el trackId para el disparo de música', () => {
        const { session } = freshAdivina();
        expect(session.state.songId).toBe('sueño');
        expect(Array.isArray(session.state.options)).toBe(true);
        expect(session.state.options).toEqual(['Sueño de Bunny', 'Para Elisa', 'Cielito Lindo']);
    });

    test('el banco tiene 9 canciones con estructura {id, titulo, pista, alias}', () => {
        expect(SONG_BANK).toHaveLength(9);
        for (const song of SONG_BANK) {
            expect(typeof song.id).toBe('string');
            expect(song.id.length).toBeGreaterThan(0);
            expect(typeof song.titulo).toBe('string');
            expect(typeof song.pista).toBe('string');
            expect(Array.isArray(song.alias)).toBe(true);
            expect(song.alias.length).toBeGreaterThan(0);
        }
    });

    test('createSession devuelve una sesión serializable y plana', () => {
        const { session } = freshAdivina();
        expect(session.id).toBe('adivina_cancion');
        expect(Array.isArray(session.state.order)).toBe(true);
        expect(session.state.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(session.state.cursor).toBe(0);
        expect(session.state.maxRounds).toBe(3);
        expect(session.state.phase).toBe('announce');
        const roundTrip = JSON.parse(JSON.stringify(session));
        expect(roundTrip.state.songId).toBe('sueño');
        expect(roundTrip.state.options).toEqual(session.state.options);
    });
});

describe('adivinaCancion — respuesta correcta', () => {
    test('acierta "sueño de bunny" → +1 punto y siguiente canción (baila)', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'sueño de bunny');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(false);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
        expect(session.state.songId).toBe('baila');
        expect(result.prompt).toBe(
            '¡Correcto, era "Sueño de Bunny"! Siguiente canción: Pista: Es para mover el cuerpo y seguir el ritmo. ¿Es Baila, Para Elisa, Cielito Lindo?'
        );
        expect(result.animation).toBe('Jump_in_place');
        expect(result.emotion).toBe('happy');
    });

    test('alias corto "bunny" también acierta', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'bunny');
        expect(result.valid).toBe(true);
        expect(result.score).toBe(1);
        expect(session.round).toBe(2);
    });

    test('completa la partida en 3 aciertos', () => {
        const { engine, session } = freshAdivina();
        engine.turn(session, 'sueño de bunny'); // → baila
        engine.turn(session, 'baila');          // → canta
        const result = engine.turn(session, 'canta');
        expect(result.valid).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.score).toBe(3);
        expect(result.prompt).toBe(
            '¡Correcto, era "Canta"! Adivinaste 3 canciones con 3 puntos. ¡Gran oído musical!'
        );
        expect(result.animation).toBe('Dance');
    });
});

describe('adivinaCancion — opción equivocada y no reconocido', () => {
    test('opción equivocada → reintenta la misma canción', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'estrellita');
        expect(result.valid).toBe(false);
        expect(result.gameOver).toBe(false);
        expect(result.error).toBe('canción incorrecta');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            '¡Casi! Esa no era. Escucha otra vez. Pista: Habla de dormir y soñar con conejitos. ¿Es Sueño de Bunny, Para Elisa, Cielito Lindo?'
        );
        expect(result.emotion).toBe('encouraging');
    });

    test('respuesta no reconocida → error amigable y se queda en la misma canción', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'hola flu');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('respuesta no reconocida');
        expect(session.round).toBe(1);
        expect(result.prompt).toBe(
            'No te escuché bien. Pista: Habla de dormir y soñar con conejitos. ¿Es Sueño de Bunny, Para Elisa, Cielito Lindo?'
        );
    });
});

describe('adivinaCancion — controles del jugador (pista / saltar)', () => {
    test('"pista" repite la canción actual', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'dame una pista');
        expect(result.valid).toBe(false);
        expect(result.prompt).toBe(
            'Escúchala otra vez. Pista: Habla de dormir y soñar con conejitos. ¿Es Sueño de Bunny, Para Elisa, Cielito Lindo?'
        );
        expect(result.emotion).toBe('thinking');
        expect(session.round).toBe(1);
    });

    test('"no sé" entrega pista (no salta: hint tiene prioridad)', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'no sé');
        expect(result.prompt).toBe(
            'Escúchala otra vez. Pista: Habla de dormir y soñar con conejitos. ¿Es Sueño de Bunny, Para Elisa, Cielito Lindo?'
        );
        expect(session.round).toBe(1);
    });

    test('"paso" salta a la siguiente canción sin puntuar', () => {
        const { engine, session } = freshAdivina();
        const result = engine.turn(session, 'paso');
        expect(result.valid).toBe(false);
        expect(result.score).toBe(0);
        expect(session.round).toBe(2);
        expect(result.prompt).toBe(
            '¡Claro! Otra canción: Pista: Es para mover el cuerpo y seguir el ritmo. ¿Es Baila, Para Elisa, Cielito Lindo?'
        );
        expect(result.emotion).toBe('neutral');
    });

    test('saltar la última canción termina la partida', () => {
        const { engine, session } = freshAdivina({ rounds: 1 });
        const result = engine.turn(session, 'paso');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Terminamos con 0 puntos. ¡Muy bien jugado!');
    });
});

describe('adivinaCancion — fin de partida', () => {
    test('tras gameOver, cualquier turno repite el cierre', () => {
        const { engine, session } = freshAdivina({ rounds: 1 });
        engine.turn(session, 'sueño de bunny');
        const result = engine.turn(session, 'hola');
        expect(result.gameOver).toBe(true);
        expect(result.prompt).toBe('Ya terminamos de adivinar canciones. ¿Jugamos otra vez?');
    });

    test('isGameCommand reconoce controles y frases de salida', () => {
        const engine = createAdivinaCancionEngine({ random: () => 0.9999 });
        expect(engine.isGameCommand('salir del juego')).toBe(true);
        expect(engine.isGameCommand('dame una pista')).toBe(true);
        expect(engine.isGameCommand('otra')).toBe(true);
        expect(engine.isGameCommand('paso')).toBe(true);
        expect(engine.isGameCommand('hola flu')).toBe(false);
    });
});

describe('adivinaCancion — configuración (data-driven, sin hardcode)', () => {
    test('aplica rounds y clamps al rango [1,9]', () => {
        const { session } = freshAdivina({ rounds: 2 });
        expect(session.state.maxRounds).toBe(2);

        const low = createAdivinaCancionEngine({ random: () => 0.9999 });
        const lowSession = low.createSession({ rounds: -5 });
        expect(lowSession.state.maxRounds).toBe(1);

        const high = createAdivinaCancionEngine({ random: () => 0.9999 });
        const highSession = high.createSession({ rounds: 99 });
        expect(highSession.state.maxRounds).toBe(9);

        const alias = createAdivinaCancionEngine({ random: () => 0.9999 });
        const aliasSession = alias.createSession({ defaultRounds: 4 });
        expect(aliasSession.state.maxRounds).toBe(4);
    });
});
