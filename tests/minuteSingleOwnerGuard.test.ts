/**
 * minuteSingleOwnerGuard — UN solo dueno por simbolo del bloque de minutas.
 *
 * Defecto medido (auditoria de codigo, 2026-10-02): la MISMA responsabilidad
 * estaba escrita dos veces y las copias YA divergian:
 *   - `buildMinuteKey`: `src/voice/lib/minuteKnowledge.js` (cleanForSpeech) y
 *     `src/hooks/useMinuteKnowledge.ts` (trim+toLowerCase). Para un titulo con
 *     guion o espacios dobles las dos formulas dan claves DISTINTAS, asi que el
 *     upsert por `minuteKey` puede DUPLICAR la minuta (AGENTS.md 7.7.c).
 *   - `formatMinuteKnowledgeEntry`: `src/lib/minuteKnowledgeHelpers.ts` (usa el
 *     kind: Minuta/Diario) y `src/voice/lib/minuteKnowledge.js` (fuerza 'Minuta'
 *     y no tiene rama diario).
 *   - `format/parse` del historyCode: copiados en hook y modulo de voz.
 *
 * El guard pregunta DOS cosas (0.12: un guard de conteo NO cierra solo):
 *   1) TEXTO: cuantos ficheros DEFINEN cada simbolo (debe ser <=1).
 *   2) COMPORTAMIENTO: los dos caminos deben producir LA MISMA clave y el mismo
 *      texto de KB, ejecutando las funciones reales.
 *
 * Prueba de DETECTOR real (0.24): el caso sintetico comprueba que la marca
 * discrimina (alimenta una copia y exige que la senale).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildMinuteKey as keyFromVoice, buildVoiceMinuteKnowledgeBase } from '../src/voice/lib/minuteKnowledge.js';
import { buildMinuteKey as keyFromHelpers } from '../src/lib/minuteKnowledgeHelpers';

/** Simbolos del bloque de minutas que deben tener UN dueno (o ninguno, si es alias retirado). */
const MINUTE_SYMBOLS = [
    'buildMinuteKey',
    'formatMinuteKnowledgeEntry',
    'formatMinuteHistoryCode',
    'parseMinuteHistoryCode',
    // alias RETIRADOS: prohibido que vuelvan a nacer en el hook
    'formatHistoryCode',
    'parseHistoryCode',
] as const;

const DEF_RE = (symbol: string) =>
    new RegExp(`function\\s+${symbol}\\s*[<(]|(?:const|let|var)\\s+${symbol}\\s*=`);

/** Duennos de cada simbolo en una lista de fuentes. `archivo:simbolo:linea` (0.11). */
export function findMinuteOwners(sources: ReadonlyArray<{ file: string; source: string }>) {
    const owners: Record<string, string[]> = {};
    for (const { file, source } of sources) {
        const lines = source.split('\n');
        lines.forEach((line, index) => {
            for (const symbol of MINUTE_SYMBOLS) {
                if (DEF_RE(symbol).test(line)) {
                    owners[symbol] = owners[symbol] || [];
                    owners[symbol].push(`${file}:${symbol}:${index + 1}`);
                }
            }
        });
    }
    return owners;
}

/** Duplicados: simbolos con >1 duenno. Lista `archivo:simbolo:linea`. */
export function findMinuteDuplicates(sources: ReadonlyArray<{ file: string; source: string }>) {
    const owners = findMinuteOwners(sources);
    return Object.entries(owners)
        .filter(([, sites]) => sites.length > 1)
        .flatMap(([, sites]) => sites);
}

function srcSources(): Array<{ file: string; source: string }> {
    const files = [
        'src/lib/minuteKnowledgeHelpers.ts',
        'src/voice/lib/minuteKnowledge.js',
        'src/hooks/useMinuteKnowledge.ts',
    ];
    return files.map((file) => ({ file, source: readFileSync(join(process.cwd(), file), 'utf8') }));
}

describe('minuteSingleOwnerGuard — un dueno por simbolo', () => {
    it('ningun simbolo del bloque de minutas esta definido en >1 fichero', () => {
        const duplicates = findMinuteDuplicates(srcSources());
        expect(
            duplicates,
            `Simbolos con dueno multiple (archivo:simbolo:linea):\n  ${duplicates.join('\n  ')}`,
        ).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: una copia sintetica se marca (la marca discrimina)', () => {
        const synthetic = [
            { file: 'src/a.ts', source: 'export function buildMinuteKey(s) {\n  return String(s)\n}' },
            { file: 'src/b.js', source: 'function buildMinuteKey(s) {\n  return s\n}' },
        ];
        const duplicates = findMinuteDuplicates(synthetic);
        expect(duplicates).toContain('src/a.ts:buildMinuteKey:1');
        expect(duplicates).toContain('src/b.js:buildMinuteKey:1');
    });

    it('el codigo LIMPIO no se marca (anti-falso-positivo del detector)', () => {
        const clean = [
            { file: 'src/a.ts', source: 'export function buildMinuteKey(s) {\n  return String(s)\n}' },
            { file: 'src/b.js', source: "export { buildMinuteKey } from './a'\nconst otro = 1" },
        ];
        expect(findMinuteDuplicates(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: los dos caminos comparten la MISMA funcion de clave', () => {
        // Identidad de funcion (AGENTS.md 4: un re-export sin dueño unico se rompe en runtime).
        expect(keyFromVoice).toBe(keyFromHelpers);
        // Y produce la clave canonica con un titulo con guion (el caso que divergia).
        expect(keyFromVoice({ titulo: 'Reunion-2026', tema_sesion: '' })).toBe('reunion 2026|');
        expect(keyFromHelpers({ titulo: '  Reunion   trimestral ', tema_sesion: 'Clase' })).toBe(
            'reunion trimestral|clase',
        );
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

        // La copia local del modulo de voz forzaba 'Minuta' y NO tenia rama diario:
        // el canonico etiqueta por kind. Mismo camino (voz), distinto resultado.
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
