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
 * UMBRAL 40 (2026-10-09): medido otra vez con el arbol limpio, 40 -> 0 y 30 -> 1 grupo REAL
 * (la comparacion recortada de isBilingualListenMode/isFluSpeaker/isCalculatingSpeakerId).
 * El umbral NO baja a 30 mientras ese grupo siga vivo: se declara en el ledger (P9.41) y NO
 * en el baseline (el baseline no se amplia). El umbral es un DATO medido, no una comodidad.
 *
 * COBERTURA DE FORMAS (2026-10-08b): antes el detector solo veia `function` y `const = () => {}`.
 * MEDIDO: con eso daba 0 grupos mientras existian 6 con METODOS (`start`/`stop`/`updateConfig`/
 * `turn` en los motores de juego y en autonomy). Ahora cubre funcion, flecha con llaves,
 * METODO de objeto/clase y flecha concisa. La forma METODO se acota a UNA linea (2026-10-09):
 * con `\s*[^{;]*` el detector cruzaba el `}` de un `catch` y atribuia su cuerpo a la LLAMADA
 * anterior (falso positivo medido en los dos workers: un metodo `reply` que no existia).
 *
 * EL BASELINE ES DEUDA DECLARADA, NO PERDON (shrink-only): hoy son 13 grupos / 77 sitios
 * (catalogos, paneles, servicios, autonomy y motores de juego) -> P9.35. El caso "el baseline
 * no tiene entradas muertas" OBLIGA a encogerlo: al cerrar cualquiera, su entrada tiene que
 * salir o este guard cae. NO se puede AMPLIAR: un grupo nuevo es una violacion.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    blindGroups,
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
        // El control POSITIVO del detector es SINTETICO (describe de abajo). Aqui NO se
        // exige un numero de grupos: el objetivo del trinquete es PRECISAMENTE llegar a 0,
        // y exigir "3 grupos" convertiria la meta en un suelo.
        expect(Array.isArray(BASELINE)).toBe(true);
        // CEGUERA por el filtro de lineas (minLines=3): si un duplicado solo aparece con
        // minLines=1, la barrera lo esta escondiendo. Hoy es 0; tiene que seguir siendolo.
        expect(blindGroups(sources), 'grupos que solo aparecen con minLines=1').toEqual([]);
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

    it('un ENVOLTORIO de UNA sola llamada (façade) NO es una copia: no sobre-contar (7.7.e(5))', () => {
        const args = 'a, b, c, d, e, f, g, h, i, j, k, l, m, n';
        const facade = (name: string) => `export function ${name}() {\n  return helperWithLongName(down, ${args})\n}`;
        expect(
            structuralGroups([
                { file: 'src/a.js', source: facade('getUno') },
                { file: 'src/b.js', source: facade('getDos') },
            ]),
        ).toEqual([]);
    });

    it('la forma METODO no cruza lineas: una llamada con `new Error(...)` antes de un `catch` no presta su cuerpo', () => {
        // Falso positivo MEDIDO (2026-10-09): en los dos workers `reply(false, null, new Error(...))`
        // iba seguido de `} catch (error) {`, y el detector reportaba un metodo `reply` cuyo
        // cuerpo era el catch. El grupo era un artefacto, no una copia.
        const worker = (contexto: string): string =>
            `async function handle(type) {\n` +
            `  try {\n` +
            `    if (type === 'x') {\n` +
            `      reply(false, null, new Error(\`unknown type: \${type}\`))\n` +
            `      return\n` +
            `    }\n` +
            `  } catch (error) {\n` +
            `    logCaughtError('${contexto}', error);\n` +
            `    reply(false, null, error);\n` +
            `  }\n` +
            `}`;
        const claves = structuralGroups([
            { file: 'src/a.js', source: worker('worker a') },
            { file: 'src/b.js', source: worker('worker b') },
        ])
            .map((g) => g.key)
            .join(' ');
        expect(claves).not.toContain(':reply');
    });

    it('y SIGUE viendo el metodo real con tipo de retorno copiado', () => {
        const metodo = (name: string, campo: string): string =>
            `class X {\n` +
            `  ${name}(): number {\n` +
            `    const total = this.${campo}.length;\n` +
            `    const extra = this.limite + 1;\n` +
            `    return total + extra;\n` +
            `  }\n` +
            `}`;
        expect(
            structuralGroups([
                { file: 'src/a.js', source: metodo('totalA', 'items') },
                { file: 'src/b.js', source: metodo('totalB', 'cosas') },
            ]),
        ).toHaveLength(1);
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
