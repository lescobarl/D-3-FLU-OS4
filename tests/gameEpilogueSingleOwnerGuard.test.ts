// ============================================================
// P7.81 + P7.85 - El ARRANQUE y el EPILOGO de un motor tienen un solo dueno.
// ============================================================
/**
 * P7.81 (EPILOGO): los 21 motores de src/core/games re-declaraban a mano el
 * objeto de fin de partida (`prompt/valid/gameOver/won/score/animation/emotion`).
 * Medidos 66 bloques literales. Eso no es solo repeticion: ya habia DIVERGIDO
 * (unos 45 gritaban 'Dance' al ganar y otros cerraban con 'Idle'), asi que el
 * mismo cambio de forma habia que hacerlo 21 veces y a mano.
 *
 * REGLA (unica fuente): `gameOverResult(prompt, score, opciones)` en
 * src/core/games/gameUtils.ts es el dueno del epilogo. En el resto de motores no
 * puede quedar ningun objeto literal con `gameOver: true`.
 *
 * P7.85 (ARRANQUE, la mitad que P7.81 dejo MEDIDA y abierta): en c467177
 * `phase: 'announce'` aparecia 56 veces en los 21 motores. La forma de arranque
 * se escribia DOS veces por motor (una en `reset` y otra en `createSession`), en
 * `adivinaNumero` TRES (adivinaNumero ademas campo a campo dentro de `start`) y
 * en `respiracion` con `phase: 'breathing'` (por eso un detector anclado a
 * 'announce' la tapaba). Medido por el mismo comando, 56 -> 41 ocurrencias
 * (41 = 21 uniones de tipo + 20 sitios de valor).
 *
 * P7.85 se dejo abierta porque un constructor GLOBAL obligaria a pasar el estado
 * entero por parametro: un parche de tipos, no una fuente unica. El cierre no va
 * por ahi: el dueno es POR MOTOR, con el nombre y la forma que 3 motores YA
 * usaban (`buildState(cfg)`, la de adivinaCancion/loteria/storyteller). REGLA:
 * cada motor construye su arranque en `buildState(cfg)` y en ningun otro sitio.
 *
 * Y el BARAJADO tiene un solo dueno: `shuffleOrder(rng, length)` en gameUtils
 * (13 barridos Fisher-Yates a mano + 4 reimplementaciones locales antes).
 *
 * El detector no es decorativo: se alimenta una entrada sintetica infractora y
 * tiene que marcarla (y no marcar el uso del dueno). Ver pruebas de mutacion.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = 'src/core/games';
/** El dueno del epilogo: se excluye porque es donde el objeto DEBE estar. */
const OWNER = 'gameUtils.ts';

/** Objeto literal con `prompt` seguido de `gameOver: true` (el epilogo a mano).
 *  Caza las DOS formas: `prompt:` y la abreviada `prompt,` (por la que se
 *  colaban ahorcado y memoriaSecuencias, que el detector anterior no veia). */
export function countInlineEpilogue(src: string): number {
    return (src.match(/\{\s*\n\s*prompt[:,][\s\S]{0,400}?gameOver:\s*true/g) || []).length;
}

function engines(): string[] {
    // Un MOTOR es el que crea sesion (`createSession`): deja fuera el andamiaje
    // del directorio (gameCatalog/gameSpeech/gameSessionStore), que no juega.
    return readdirSync(DIR)
        .filter((f) => f.endsWith('.ts') && f !== OWNER && f !== 'types.ts' && f !== 'gameEngine.ts')
        .filter((f) => readFileSync(join(DIR, f), 'utf8').includes('createSession('));
}

/** Definiciones del dueno del arranque. Debe haber EXACTAMENTE una por motor. */
export function countBuildStateOwners(src: string): number {
    return (src.match(/const buildState = \(/g) || []).length;
}

/** Usos del dueno: la definicion + al menos un camino de arranque. */
export function countBuildStateUses(src: string): number {
    return (src.match(/buildState\(/g) || []).length;
}

/** Barrido Fisher-Yates a mano: el dueno del barajado es gameUtils.shuffleOrder. */
export function countManualShuffle(src: string): number {
    return (src.match(/for \(let i = [\w.]+\.length - 1; i > 0; i -= 1\)/g) || []).length;
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

describe('P7.85 gameStart - un solo dueno del arranque y del barajado', () => {
    it('cada motor construye su arranque en un unico buildState(cfg)', () => {
        const offenders = engines()
            .map((f) => [f, countBuildStateOwners(readFileSync(join(DIR, f), 'utf8'))] as const)
            .filter(([, n]) => n !== 1);
        expect(
            offenders.map(([f, n]) => `${f}: ${n} definiciones de buildState`),
            'El arranque de un motor se construye en buildState(cfg) y en ningun otro sitio',
        ).toEqual([]);
    });

    it('el dueno del arranque no es codigo muerto', () => {
        const set = engines();
        expect(set.length, 'el universo de motores no puede ser vacio').toBeGreaterThanOrEqual(21);
        for (const f of set) {
            const src = readFileSync(join(DIR, f), 'utf8');
            expect(countBuildStateUses(src), `${f} define buildState pero no lo usa`).toBeGreaterThanOrEqual(2);
        }
    });

    it('ningun motor baraja a mano: el dueno es gameUtils.shuffleOrder', () => {
        const offenders = engines()
            .map((f) => [f, countManualShuffle(readFileSync(join(DIR, f), 'utf8'))] as const)
            .filter(([, n]) => n > 0);
        expect(
            offenders.map(([f, n]) => `${f}: ${n} barridos`),
            'Usa shuffleOrder(rng, length) de gameUtils en vez de un barrido Fisher-Yates',
        ).toEqual([]);
        const owner = readFileSync(join(DIR, OWNER), 'utf8');
        expect(owner, 'el dueno del barajado vive en gameUtils').toContain('export function shuffleOrder(');
        expect(countManualShuffle(owner), 'y es el unico sitio con el barrido').toBe(1);
    });

    it('el detector no es decorativo: marca lo infractor y respeta al dueno', () => {
        const infractor = [
            'const reset = () => {',
            "    const state: XState = { order: shuffleOrder(rng, BANK.length), phase: 'announce', };",
            '};',
            'const createSession = () => ({',
            "    state: { order: shuffleOrder(rng, BANK.length), phase: 'announce', },",
            '});',
        ].join('\n');
        const correcto = [
            'const buildState = (cfg) => ({',
            '    order: shuffleOrder(rng, BANK.length),',
            "    phase: 'announce',",
            '});',
            'const reset = () => buildState(cfg);',
            'const createSession = () => ({ state: buildState(optionsConfig) });',
        ].join('\n');
        // El infractor no tiene buildState: el detector del dueno lo marca (0 != 1).
        expect(countBuildStateOwners(infractor), 'debe marcar el arranque escrito a mano').toBe(0);
        expect(countBuildStateOwners(correcto), 'no debe marcar el uso del dueno').toBe(1);
        // Y un barrido a mano dentro de un motor se marca.
        const conBarrido = 'const order = BANK.map((_, i) => i);\nfor (let i = order.length - 1; i > 0; i -= 1) {}';
        expect(countManualShuffle(conBarrido), 'debe marcar el barrido a mano').toBe(1);
        expect(countManualShuffle('const order = shuffleOrder(rng, BANK.length);'), 'no debe marcar el uso del dueno').toBe(0);
    });
});
