// ============================================================
// P7.81 - El EPILOGO de un motor tiene un solo dueno.
// ============================================================
/**
 * CONTEXTO MEDIDO: los 21 motores de src/core/games re-declaraban a mano el
 * objeto de fin de partida (`prompt/valid/gameOver/won/score/animation/emotion`).
 * Medidos 66 bloques literales. Eso no es solo repeticion: ya habia DIVERGIDO
 * (unos 45 gritaban 'Dance' al ganar y otros cerraban con 'Idle'), asi que el
 * mismo cambio de forma habia que hacerlo 21 veces y a mano.
 *
 * REGLA (unica fuente): `gameOverResult(prompt, score, opciones)` en
 * src/core/games/gameUtils.ts es el dueno del epilogo. En el resto de motores no
 * puede quedar ningun objeto literal con `gameOver: true`.
 *
 * El detector no es decorativo: se alimenta una entrada sintetica infractora y
 * tiene que marcarla (y no marcar el uso del dueno). Ver prueba de mutacion.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = 'src/core/games';
/** El dueno del epilogo: se excluye porque es donde el objeto DEBE estar. */
const OWNER = 'gameUtils.ts';

/** Objeto literal con `prompt:` seguido de `gameOver: true` (el epilogo a mano). */
export function countInlineEpilogue(src: string): number {
    return (src.match(/\{\s*\n\s*prompt:[\s\S]{0,400}?gameOver:\s*true/g) || []).length;
}

function engines(): string[] {
    // Un MOTOR es el que crea sesion (`createSession`): deja fuera el andamiaje
    // del directorio (gameCatalog/gameSpeech/gameSessionStore), que no juega.
    return readdirSync(DIR)
        .filter((f) => f.endsWith('.ts') && f !== OWNER && f !== 'types.ts' && f !== 'gameEngine.ts')
        .filter((f) => readFileSync(join(DIR, f), 'utf8').includes('createSession('));
}

describe('P7.81 gameEpilogue - un solo dueno del epilogo', () => {
    it('ningun motor re-declara el objeto de fin de partida', () => {
        const offenders = engines()
            .map((f) => [f, countInlineEpilogue(readFileSync(join(DIR, f), 'utf8'))] as const)
            .filter(([, n]) => n > 0);
        expect(
            offenders.map(([f, n]) => `${f}: ${n}`),
            'Usa gameOverResult() de gameUtils en vez de un objeto literal',
        ).toEqual([]);
    });

    it('el detector no es decorativo: marca lo infractor y respeta al dueno', () => {
        const infractor = `return {\n    prompt: 'Fin',\n    valid: false,\n    gameOver: true,\n};`;
        const correcto = `return gameOverResult('Fin', session.score);`;
        expect(countInlineEpilogue(infractor), 'debe marcar el epilogo a mano').toBe(1);
        expect(countInlineEpilogue(correcto), 'no debe marcar el uso del dueno').toBe(0);
    });

    it('el dueno vive en gameUtils y ningun motor lo reimplementa', () => {
        const owner = readFileSync(join(DIR, OWNER), 'utf8');
        expect(owner).toContain('export function gameOverResult(');
        const set = engines();
        // Si el universo se vaciara, el guard estaria verde sin mirar nada.
        expect(set.length, 'el universo de motores no puede ser vacio').toBeGreaterThanOrEqual(15);
        for (const f of set) {
            const src = readFileSync(join(DIR, f), 'utf8');
            expect(src, `${f} debe importar el dueno`).toContain('gameOverResult');
        }
    });
});
