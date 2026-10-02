/**
 * parsersNormalizeSingleOwnerGuard — los parsers no reimplementan la normalizacion.
 *
 * Auditoria de codigo 2026-10-02: `src/core/agenda/agendaCommandParser.ts` y
 * `src/core/reminders/nlDateParser.ts` tenian cada uno su `function normalize()`
 * sobre lo mismo (sin diacriticos y en minusculas). La fuente unica ya existia en
 * `src/lib/textUtils.ts`, y ademas con las DOS variantes que los parsers necesitan:
 *   - `normalizeForMatch`      -> colapsa espacios internos (lo que hacia el de fechas).
 *   - `normalizeForMatchExact` -> NO colapsa (el contrato historico de musicPlayer).
 * El defecto no era que difirieran (difieren a proposito), era que cada uno tuviera
 * su copia sin dueno: al cambiar `stripDiacritics` habia que acordarse de los tres.
 *
 * El guard pregunta DOS cosas: que no queden copias locales (texto) y que el contrato
 * de las dos variantes del dueno siga siendo el que los parsers consumen (conducta).
 * La conducta de los parsers la cubren sus propios tests (agendaCommandParser,
 * remindersDateParser), que ya estan en el gate.
 *
 * Prueba de DETECTOR real (0.24): se alimenta una copia sintetica y se comprueba que
 * el detector la marca; si el guard siguiera verde seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeForMatch, normalizeForMatchExact } from '../src/lib/textUtils';

export interface SourceFile {
    file: string;
    source: string;
}

/** `archivo:linea` de cada `function normalize(` en las fuentes dadas. */
export function findLocalNormalizers(sources: ReadonlyArray<SourceFile>): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            if (/function\s+normalize\s*[<(]/.test(line)) hits.push(`${file}:${index + 1}`);
        });
    }
    return hits;
}

function parserSources(): SourceFile[] {
    const files = [
        'src/core/agenda/agendaCommandParser.ts',
        'src/core/reminders/nlDateParser.ts',
        'src/core/reminders/shoppingIntentParser.ts',
        'src/core/reminders/shoppingList.ts',
        'src/core/reminders/shoppingService.ts',
        'src/core/agenda/agendaModel.ts',
        'src/core/agenda/agendaQuery.ts',
    ];
    return files.map((file) => ({ file, source: readFileSync(join(process.cwd(), file), 'utf8') }));
}

describe('parsersNormalizeSingleOwnerGuard — la normalizacion tiene un dueno', () => {
    it('ningun parser de agenda o recordatorios define su propia normalizacion', () => {
        const bad = findLocalNormalizers(parserSources());
        expect(bad, `Copias locales de normalize (archivo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: una copia local se marca', () => {
        const synthetic: SourceFile[] = [
            { file: 'src/core/agenda/x.ts', source: 'function normalize(text: string): string {\n  return text\n}' },
        ];
        expect(findLocalNormalizers(synthetic)).toEqual(['src/core/agenda/x.ts:1']);
    });

    it('el codigo limpio no se marca', () => {
        const clean: SourceFile[] = [
            { file: 'src/core/agenda/x.ts', source: "import { normalizeForMatch } from '../../lib/textUtils';" },
        ];
        expect(findLocalNormalizers(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: el dueno ofrece las DOS variantes y no son la misma', () => {
        // La de fechas colapsa espacios; la del parser de agenda NO (contrato exacto).
        expect(normalizeForMatch('  El   LUNES ')).toBe('el lunes');
        expect(normalizeForMatchExact('  El   LUNES ')).toBe('el   lunes');
        expect(normalizeForMatchExact('a   b')).toBe('a   b');
        expect(normalizeForMatch('a   b')).toBe('a b');
        // Sin diacriticos y en minusculas, las dos.
        expect(normalizeForMatch('CamiÓn')).toBe('camion');
        expect(normalizeForMatchExact('CamiÓn')).toBe('camion');
    });

    it('COMPORTAMIENTO: los dos parsers consumen el dueno (no una copia)', () => {
        for (const { file, source } of parserSources()) {
            if (!file.endsWith('agendaCommandParser.ts') && !file.endsWith('nlDateParser.ts')) continue;
            expect(source, `${file} debe importar el dueno`).toMatch(
                /import\s*\{[^}]*normalizeForMatch(Exact)?[^}]*\}\s*from\s*'\.\.\/\.\.\/lib\/textUtils'/,
            );
        }
    });
});
