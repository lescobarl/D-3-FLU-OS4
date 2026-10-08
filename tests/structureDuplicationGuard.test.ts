/**
 * structureDuplicationGuard — la barrera que cierra el agujero de 7.7.d:
 * una copia RENOMBRADA (misma implementacion, otros identificadores) tiene que
 * ponerse ROJA el mismo dia.
 *
 * POR QUE EXISTE (medido 2026-10-08, HEAD ae6611c): `lint:guards` estaba VERDE
 * (219 ficheros / 1837 tests) con 3 copias de `concat` de PCM y 2 de `novelWords`
 * vivas. Los guards de duplicacion existentes miden NOMBRES (`function downsample`)
 * o el cuerpo byte a byte (`duplicateBodies`), asi que renombrar las variables o
 * cambiar `for..of` por `forEach` los esquiva. Este guard mide el ESQUELETO: la
 * implementacion, no el nombre.
 *
 * EL BASELINE ES DEUDA DECLARADA, NO PERDON (shrink-only):
 *   - handleSubmit en los 2 editores de catalogo            -> P9.28 (pendiente)
 *   - isFluDevConsolePanelEnabled / isListenTraceEnabled    -> P9.27 (pendiente)
 *   - getXxxCfg (4-6 accesores de FLU_CONFIG)               -> P9.26 (pendiente)
 * El caso "el baseline no tiene entradas muertas" OBLIGA a encogerlo: al cerrar
 * cualquiera de esos pendientes, su entrada tiene que salir o este guard cae.
 * NO se puede AMPLIAR: cualquier grupo nuevo es una violacion.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    evaluate,
    findFunctions,
    formatGroup,
    groupKey,
    readSources,
    structuralGroups,
} from '../scripts/duplication.mjs';

const ROOT = process.cwd();
const BASELINE: string[] = JSON.parse(
    readFileSync(join(ROOT, 'tests/structureDuplicationGuard.baseline.json'), 'utf8'),
);

/**
 * Cuerpo sintetico de un `concat` de chunks: SOLO cambian los NOMBRES de las
 * variables (misma implementacion). Es la forma real del defecto: concatFrames
 * vs concatChunks diferian en identificadores, no en algoritmo.
 */
function copiaConcat(name: string, acc: string, chunk: string, out: string, offset: string): string {
    return (
        `export function ${name}(chunks) {\n` +
        `  const ${acc} = chunks.reduce((sum, ${chunk}) => sum + ${chunk}.length, 0)\n` +
        `  const ${out} = new Float32Array(${acc})\n` +
        `  let ${offset} = 0\n` +
        `  for (const ${chunk} of chunks) {\n` +
        `    ${out}.set(${chunk}, ${offset})\n` +
        `    ${offset} += ${chunk}.length\n` +
        `  }\n` +
        `  return ${out}\n` +
        `}`
    );
}

const COPIA_A = copiaConcat('concatFrames', 'total', 'frame', 'out', 'offset');
const COPIA_B = copiaConcat('concatChunks', 'length', 'c', 'result', 'at');

describe('duplicacion estructural — un dueno por implementacion (no por nombre)', () => {
    const sources = readSources('src');
    const groups = structuralGroups(sources);
    const { violations, stale } = evaluate(groups, BASELINE);

    it('ninguna implementacion esta copiada (con otro nombre) fuera del baseline', () => {
        const detalle = violations.map((v) => `  ${formatGroup(v)}`).join('\n');
        expect(
            violations.map((v) => v.key),
            `Implementaciones duplicadas NO declaradas (archivo:simbolo:linea):\n${detalle}\n` +
                'Deja la logica en UN dueno (importa el helper) o, si difieren a proposito, ' +
                'declara el motivo y que no son el mismo resultado.',
        ).toEqual([]);
    });

    it('el baseline no tiene entradas muertas (obliga a encogerlo al cerrar la deuda)', () => {
        expect(
            stale,
            'Estos grupos del baseline YA no se duplican: hay que sacarlos de ' +
                'tests/structureDuplicationGuard.baseline.json (trinquete shrink-only).\n  ' +
                stale.join('\n  '),
        ).toEqual([]);
    });

    it('ANTI-VACUIDAD: el detector VE la fuente (no pasa por no mirar)', () => {
        expect(sources.length, 'se leyeron muy pocos ficheros de src').toBeGreaterThan(300);
        const funciones = sources.flatMap((s) => findFunctions(s.file, s.source));
        expect(funciones.length, 'se escanearon muy pocas funciones').toBeGreaterThan(500);
        // Control positivo: el arbol real TIENE grupos (los 3 declarados). Si el
        // detector se quedara sordo, groups=0 y el guard pasaria por vaciedad.
        expect(groups.length).toBeGreaterThanOrEqual(3);
        expect(BASELINE.length).toBe(3);
    });
});

describe('el detector no es decorativo (prueba de mutacion)', () => {
    it('marca la copia RENOMBRADA con OTRO bucle; no marca al dueno unico', () => {
        const groups = structuralGroups([
            { file: 'src/a.js', source: COPIA_A },
            { file: 'src/b.js', source: COPIA_B },
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('src/a.js:concatFrames | src/b.js:concatChunks');
        // Una funcion sola (implementacion en un dueno) NO se marca.
        expect(structuralGroups([{ file: 'src/a.js', source: copiaConcat('concatFloat32', 'total', 'chunk', 'out', 'offset') }])).toEqual([]);
        // La misma funcion repetida en SU fichero tampoco (no es ruta doble).
        const dosVeces = COPIA_A + '\n' + COPIA_A;
        expect(structuralGroups([{ file: 'src/a.js', source: dosVeces }])).toEqual([]);
    });

    it('la METRICA del gate cuenta lo mismo que el guard (un solo dueno de la logica)', () => {
        const falso = [{ key: 'src/a.js:a | src/b.js:b', sites: [] }];
        expect(evaluate(falso, []).violations).toHaveLength(1);
        expect(evaluate(falso, ['src/a.js:a | src/b.js:b']).violations).toEqual([]);
        // Y detecta la entrada muerta (fuerza a encoger el baseline).
        expect(evaluate([], ['clave.muerta']).stale).toEqual(['clave.muerta']);
        expect(groupKey([{ file: 'b', name: 'y' }, { file: 'a', name: 'x' }])).toBe('a:x | b:y');
    });
});
