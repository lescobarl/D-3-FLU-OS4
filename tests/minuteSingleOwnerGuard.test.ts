/**
 * minuteSingleOwnerGuard — UN solo dueno por FAMILIA de simbolos del bloque de minutas.
 *
 * Defecto medido (auditoria de codigo, 2026-10-02): la MISMA responsabilidad estaba
 * escrita dos veces en el bloque de minutas, y en dos oleadas:
 *   1) Con el MISMO nombre: `buildMinuteKey` y `formatMinuteKnowledgeEntry`
 *      (src/voice/lib/minuteKnowledge.js vs src/hooks/useMinuteKnowledge.ts) y el
 *      formato/parseo del historyCode. Las copias YA divergian: para un titulo con
 *      guion la clave no coincidia y el upsert por `minuteKey` duplicaba la minuta.
 *   2) Con NOMBRE DISTINTO (misma regla, dos copias): `compareMinuteHistoryCodeDesc`
 *      vs `compareHistoryCodeDesc`, `nextMinuteHistorySequence` vs
 *      `getNextUniversalHistorySequence` vs `getNextSequence`, y
 *      `formatMinuteHistoryLabel` vs `formatMinuteHistoryLabelForUi`.
 *
 * Por eso el guard pregunta por FAMILIA (conjunto de nombres sinonimos) y exige
 * EXACTAMENTE UNA definicion por familia. Un guard por nombre no ve la oleada 2:
 * contar "cuantas veces se llama X" es teatro si el duplicado se llama Y (§7.7.d).
 *
 * El guard pregunta DOS cosas (0.12: un guard de conteo NO cierra solo):
 *   1) TEXTO: definiciones por familia (debe ser exactamente 1).
 *   2) COMPORTAMIENTO: los dos caminos deben compartir la MISMA funcion (identidad)
 *      y producir el mismo resultado, ejecutando el codigo real.
 *
 * Prueba de DETECTOR real (0.24): el caso sintetico alimenta una copia con otro
 * nombre de una familia y exige que la marca la senale.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    buildMinuteKey as keyFromVoice,
    buildVoiceMinuteKnowledgeBase,
    compareMinuteHistoryCodeDesc as compareFromVoice,
    formatMinuteHistoryLabel as labelFromVoice,
    nextMinuteHistorySequence as nextFromVoice,
} from '../src/voice/lib/minuteKnowledge.js';
import {
    buildMinuteKey as keyFromHelpers,
    compareMinuteHistoryCodeDesc as compareFromHelpers,
    formatMinuteHistoryLabel as labelFromHelpers,
    nextMinuteHistorySequence as nextFromHelpers,
} from '../src/lib/minuteKnowledgeHelpers';

/**
 * Familias de nombres SINONIMOS que deben resolver a UNA sola implementacion.
 * Cada familia: [nombre canonico, ...alias retirados]. Total de definiciones = 1.
 */
const MINUTE_FAMILIES: readonly (readonly string[])[] = [
    ['buildMinuteKey'],
    ['formatMinuteKnowledgeEntry'],
    ['formatMinuteHistoryCode', 'formatHistoryCode'],
    ['parseMinuteHistoryCode', 'parseHistoryCode'],
    ['compareMinuteHistoryCodeDesc', 'compareHistoryCodeDesc'],
    ['compareMinuteHistoryCodeAsc'],
    ['nextMinuteHistorySequence', 'getNextUniversalHistorySequence', 'getNextSequence'],
    ['formatMinuteHistoryLabel', 'formatMinuteHistoryLabelForUi'],
];

const DEF_RE = (symbol: string) =>
    new RegExp(`function\\s+${symbol}\\s*[<(]|(?:const|let|var)\\s+${symbol}\\s*=`);

/** Sitios de definicion por familia: `archivo:simbolo:linea` (0.11). */
export function findMinuteFamilySites(
    sources: ReadonlyArray<{ file: string; source: string }>,
): Record<string, string[]> {
    const sites: Record<string, string[]> = {};
    for (const { file, source } of sources) {
        const lines = source.split('\n');
        for (const family of MINUTE_FAMILIES) {
            lines.forEach((line, index) => {
                for (const symbol of family) {
                    if (DEF_RE(symbol).test(line)) {
                        sites[family[0]] = sites[family[0]] || [];
                        sites[family[0]].push(`${file}:${symbol}:${index + 1}`);
                    }
                }
            });
        }
    }
    return sites;
}

/** Familias cuya cuenta de definiciones NO es exactamente 1 (duplicadas o perdidas). */
export function findMinuteDuplicatedFamilies(
    sources: ReadonlyArray<{ file: string; source: string }>,
): string[] {
    const sites = findMinuteFamilySites(sources);
    return MINUTE_FAMILIES.map((family) => family[0])
        .filter((key) => (sites[key] || []).length !== 1)
        .map((key) => `${key} (${(sites[key] || []).length} defs): ${(sites[key] || []).join(', ') || '(ninguna)'}`);
}

function srcSources(): Array<{ file: string; source: string }> {
    const files = [
        'src/lib/minuteKnowledgeHelpers.ts',
        'src/voice/lib/minuteKnowledge.js',
        'src/hooks/useMinuteKnowledge.ts',
    ];
    return files.map((file) => ({ file, source: readFileSync(join(process.cwd(), file), 'utf8') }));
}

describe('minuteSingleOwnerGuard — un dueno por familia', () => {
    it('cada familia del bloque de minutas tiene EXACTAMENTE una definicion', () => {
        const bad = findMinuteDuplicatedFamilies(srcSources());
        expect(bad, `Familias sin dueno unico (archivo:simbolo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: dos nombres de la misma familia se marcan', () => {
        const synthetic = [
            { file: 'src/a.js', source: 'function compareMinuteHistoryCodeDesc(l, r) {\n  return 0\n}' },
            { file: 'src/b.ts', source: 'function compareHistoryCodeDesc(l, r) {\n  return 0\n}' },
        ];
        const bad = findMinuteDuplicatedFamilies(synthetic);
        expect(bad.join('\n')).toContain('compareMinuteHistoryCodeDesc (2 defs)');
    });

    it('PRUEBA DE DETECTOR: una familia PERDIDA tambien se marca (anti-vacuidad)', () => {
        const sinImplementacion = [{ file: 'src/a.js', source: 'const x = 1' }];
        const bad = findMinuteDuplicatedFamilies(sinImplementacion);
        expect(bad.length).toBe(MINUTE_FAMILIES.length);
        expect(bad.join('\n')).toContain('(ninguna)');
    });

    it('el codigo LIMPIO no se marca (anti-falso-positivo del detector)', () => {
        const families = MINUTE_FAMILIES.map((f) => f[0]);
        const clean = families.map((name) => ({
            file: `src/${name}.ts`,
            source: `export function ${name}(a) {\n  return a\n}`,
        }));
        expect(findMinuteDuplicatedFamilies(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: los dos caminos comparten la MISMA funcion (clave, comparador, secuencia, etiqueta)', () => {
        expect(keyFromVoice).toBe(keyFromHelpers);
        expect(compareFromVoice).toBe(compareFromHelpers);
        expect(nextFromVoice).toBe(nextFromHelpers);
        expect(labelFromVoice).toBe(labelFromHelpers);
    });

    it('COMPORTAMIENTO: la clave y el comparador funcionan en el caso que divergia', () => {
        expect(keyFromVoice({ titulo: 'Reunion-2026', tema_sesion: '' })).toBe('reunion 2026|');
        expect(keyFromHelpers({ titulo: '  Reunion   trimestral ', tema_sesion: 'Clase' })).toBe(
            'reunion trimestral|clase',
        );
        // El comparador acepta el code como string (hook) y como entrada (voz).
        expect(compareFromHelpers('260102-01', '260101-09')).toBeLessThan(0);
        expect(compareFromHelpers({ historyCode: '260102-01' }, { historyCode: '260101-09' })).toBeLessThan(0);
        expect(compareFromHelpers('260101-02', '260101-02')).toBe(0);
    });

    it('COMPORTAMIENTO: la secuencia siguiente y la etiqueta son las del canonico', () => {
        expect(nextFromHelpers([{ historyCode: '260101-01' }, { historyCode: '260102-07' }])).toBe(8);
        expect(nextFromVoice([{ historyCode: '260101-03' }])).toBe(4);
        expect(labelFromHelpers({ historyCode: '260101-01', description: 'Reunion' })).toBe('260101-01-Reunion');
        expect(labelFromVoice({ historyCode: '260101-01' })).toBe('260101-01');
    });

    it('COMPORTAMIENTO: la KB de voz usa el formateador canonico (rama diario incluida)', () => {
        const minuta = buildVoiceMinuteKnowledgeBase([
            {
                description: 'Reunion trimestral',
                historyCode: '260101-01',
                summarySnapshot: { titulo: 'Reunion trimestral' },
            },
        ]);
        expect(minuta).toContain('[Minuta 1');
        expect(minuta).toContain('Reunion trimestral');

        const diario = buildVoiceMinuteKnowledgeBase([
            {
                kind: 'diario',
                description: 'Dia uno',
                summarySnapshot: { kind: 'diario', titulo: 'Dia uno', date: '2026-01-01', content: 'Camine' },
            },
        ]);
        expect(diario).toContain('[Diario 1');
        expect(diario).toContain('Camine');
    });
});
