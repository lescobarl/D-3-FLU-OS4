/**
 * gameAccessorSingleOwnerGuard — el accesor del banco y el prompt del turno tienen
 * UN solo cuerpo (en `gameUtils`), no una copia por motor.
 *
 * Defecto medido (auditoria de codigo, 2026-10-02): `function itemAt(state)` estaba
 * repetida en 6 motores con el MISMO cuerpo (`state.order[state.cursor]` -> banco
 * del juego) y `function currentPrompt(state)` en 4 mas, todas con el mismo
 * esqueleto ("coge el item; si no hay, mensaje de fin; si hay, render"). 10 copias
 * de 2 lineas de logica, una por motor: al arreglar un caso (indice fuera de rango,
 * cursor al final) habia que acordarse de los 10.
 *
 * El guard pregunta DOS cosas:
 *   1) TEXTO: cuantas definiciones LOCALES quedan de esos 2 simbolos en src/core/games (0).
 *   2) COMPORTAMIENTO: el cuerpo compartido hace lo que hacian las copias (indice,
 *      cursor al final, mensaje de fin y render). Los motores siguen ejercitados de
 *      punta a punta por sus propios tests, que ya estan en el gate.
 *
 * Prueba de DETECTOR real (0.24): se alimenta una copia sintetica y se comprueba
 * que el detector la marca; si el guard siguiera verde seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bankItemAt, gamePrompt } from '../src/core/games/gameUtils';

const SYMBOLS = ['itemAt', 'currentPrompt'] as const;
const GAMES_DIR = 'src/core/games';

export interface GameSource {
    file: string;
    source: string;
}

/** Definiciones locales de los accesores por motor: `archivo:simbolo:linea`. */
export function findLocalAccessors(sources: ReadonlyArray<GameSource>): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            for (const symbol of SYMBOLS) {
                if (new RegExp(`function\\s+${symbol}\\s*[<(]`).test(line)) {
                    hits.push(`${file}:${symbol}:${index + 1}`);
                }
            }
        });
    }
    return hits;
}

function gameSources(): GameSource[] {
    const dir = join(process.cwd(), GAMES_DIR);
    return readdirSync(dir)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => ({ file: `${GAMES_DIR}/${name}`, source: readFileSync(join(dir, name), 'utf8') }));
}

describe('gameAccessorSingleOwnerGuard — un cuerpo por accesor', () => {
    it('ningun motor define su propio itemAt/currentPrompt', () => {
        const bad = findLocalAccessors(gameSources());
        expect(bad, `Accesores con cuerpo propio (archivo:simbolo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: la copia local se marca', () => {
        const synthetic: GameSource[] = [
            { file: 'src/core/games/x.ts', source: 'function itemAt(state) {\n  return null;\n}' },
            { file: 'src/core/games/y.ts', source: 'function currentPrompt(state) {\n  return "";\n}' },
        ];
        const bad = findLocalAccessors(synthetic);
        expect(bad).toContain('src/core/games/x.ts:itemAt:1');
        expect(bad).toContain('src/core/games/y.ts:currentPrompt:1');
    });

    it('el codigo limpio no se marca (una llamada al compartido no es una copia)', () => {
        const clean: GameSource[] = [
            { file: 'src/core/games/x.ts', source: 'const itemAt = (state: S) => bankItemAt(state, BANK);' },
        ];
        expect(findLocalAccessors(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: bankItemAt recorre el banco por el cursor', () => {
        const state = { order: [2, 0, 1], cursor: 1 };
        expect(bankItemAt(state, ['a', 'b', 'c'])).toBe('a');
        expect(bankItemAt({ order: [2, 0, 1], cursor: 0 }, ['a', 'b', 'c'])).toBe('c');
        // Cursor al final: no hay item.
        expect(bankItemAt({ order: [2, 0, 1], cursor: 3 }, ['a', 'b', 'c'])).toBeNull();
    });

    it('COMPORTAMIENTO: gamePrompt rinde el item o el mensaje de fin', () => {
        const state = { order: [1], cursor: 0 };
        expect(gamePrompt(state, (s) => bankItemAt(s, ['a', 'b']), (item) => `dime ${item}`, 'fin')).toBe('dime b');
        expect(gamePrompt(state, () => null, () => 'nunca', 'fin')).toBe('fin');
    });
});
