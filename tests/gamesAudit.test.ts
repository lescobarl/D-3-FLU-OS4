// @vitest-environment node
// ============================================================
// gamesAudit — validación de TODOS los motores de juego
// ------------------------------------------------------------
// Invariantes estructurales por motor (catálogo completo):
//   - start devuelve un prompt no vacío.
//   - los controles (pista/paso/siguiente) y el texto libre
//     devuelven siempre un prompt y nunca lanzan.
//   - "salir del juego" es comando de juego.
// Más invariantes de REALISMO por juego (que la pista sea jugable).
// ============================================================
import { describe, it, expect } from 'vitest';
import { GAME_CATALOG } from '../src/core/games/gameCatalog';
import { createVeoVeoEngine, VEO_VEO_BANK } from '../src/core/games/veoVeo';
import { createAdivinaCancionEngine } from '../src/core/games/adivinaCancion';
import { getGameEngine } from '../src/core/games/gameCatalog';
import { createQuienSoyEngine } from '../src/core/games/quienSoy';
import { setActiveGameSession } from '../src/core/games/gameSessionStore';
import { resolveGameCommandFromText, setAudioPlayingProbe } from '../src/voice/lib/gameCommands';

const RANDOM = () => 0.42;

describe('gamesAudit — catálogo completo, invariantes estructurales', () => {
    for (const entry of GAME_CATALOG) {
        it(`${entry.id}: start y controles responden siempre`, () => {
            const engine = entry.engine();
            const session = engine.createSession({ random: RANDOM });
            const start = engine.start(session, { random: RANDOM });
            expect(typeof start.prompt, `${entry.id} start.prompt`).toBe('string');
            expect(start.prompt.length, `${entry.id} start.prompt vacío`).toBeGreaterThan(5);

            for (const control of ['pista', 'paso', 'siguiente']) {
                const result = engine.turn(session, control);
                expect(typeof result.prompt, `${entry.id} turn(${control})`).toBe('string');
                expect(result.prompt.length, `${entry.id} turn(${control}) vacío`).toBeGreaterThan(0);
            }

            const free = engine.turn(session, 'zxqv plof');
            expect(typeof free.prompt, `${entry.id} turn(texto libre)`).toBe('string');
            expect(free.prompt.length, `${entry.id} turn(texto libre) vacío`).toBeGreaterThan(0);

            expect(engine.isGameCommand('salir del juego'), `${entry.id} isGameCommand`).toBe(true);
        });
    }
});

describe('gamesAudit — realismo por juego', () => {
    it('veo_veo: la pista siempre incluye la categoría (no solo la letra)', () => {
        for (let i = 0; i < 12; i += 1) {
            const seed = (i + 1) / 13;
            const rng = () => seed;
            const engine = createVeoVeoEngine({ random: rng });
            const session = engine.createSession({ random: rng });
            const start = engine.start(session, { random: rng });
            expect(start.prompt, `semilla ${seed}: "${start.prompt}"`).toContain('empieza con la letra');
            expect(start.prompt, `sin categoría con semilla ${seed}: "${start.prompt}"`).toContain(' y es ');
        }
        expect(VEO_VEO_BANK.length).toBeGreaterThan(0);
    });

    it('adivina_cancion: el prompt ofrece opciones para responder', () => {
        const engine = createAdivinaCancionEngine({ random: RANDOM });
        const session = engine.createSession({ random: RANDOM });
        const start = engine.start(session, { random: RANDOM });
        expect(start.prompt).toMatch(/¿Es |Es '|o '|opci/i);
    });
});

describe('gamesAudit — no intervenir mientras suena la música', () => {
    it('con karaoke sonando: la voz ambiente no cambia de canción ni de juego', () => {
        const engine = getGameEngine('karaoke');
        const session = engine!.createSession({ random: RANDOM });
        engine!.start(session, { random: RANDOM });
        setActiveGameSession(session);

        setAudioPlayingProbe(() => true);
        // "juguemos a adivina la canción" NO debe cambiar la partida mientras suena.
        expect(resolveGameCommandFromText('juguemos a adivina la cancion')).toBeNull();
        // Voz ambiente tampoco genera turno.
        expect(resolveGameCommandFromText('cielito lindo canta y no llores')).toBeNull();
        // Control explícito sí.
        expect(resolveGameCommandFromText('sigue')?.action).toBe('turn');
        // Salir siempre se permite.
        expect(resolveGameCommandFromText('salir del juego')?.action).toBe('end');

        setAudioPlayingProbe(() => false);
        // Sin audio, el cambio de juego vuelve a permitirse (intención explícita).
        expect(resolveGameCommandFromText('juguemos a adivina la cancion')?.action).toBe('switch');
        setActiveGameSession(null);
    });

    it('adivina cancion sonando: el niño SÍ puede responder (no suprime)', () => {
        const engine = getGameEngine('adivina_cancion');
        const session = engine!.createSession({ random: RANDOM });
        engine!.start(session, { random: RANDOM });
        setActiveGameSession(session);

        setAudioPlayingProbe(() => true);
        expect(resolveGameCommandFromText('la opcion 2')?.action).toBe('turn');
        expect(resolveGameCommandFromText('estrellita')?.action).toBe('turn');

        setAudioPlayingProbe(() => false);
        setActiveGameSession(null);
    });
});

describe('gamesAudit — quien soy, rol invertido', () => {
    it('el niño piensa el animal y FLU adivina con preguntas sí/no', () => {
        const engine = createQuienSoyEngine({ random: RANDOM });
        const session = engine.createSession({ random: RANDOM });
        engine.start(session, { random: RANDOM });

        const first = engine.turn(session, 'yo pienso un animal');
        expect(first.gameOver).toBe(false);
        expect(first.prompt).toMatch(/sí|no/i);

        let result = first;
        let guard = 0;
        while (!result.gameOver && guard < 20) {
            result = engine.turn(session, 'no');
            guard += 1;
        }
        expect(result.gameOver).toBe(true);
    });
});
