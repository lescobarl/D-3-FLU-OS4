/**
 * speechWordsSingleOwnerGuard — la tokenizacion de voz tiene un dueno.
 *
 * Auditoria de codigo 2026-10-02 (P8.10): `src/voice/lib/conversationStream.js`
 * tenia su propia `function speechWords()` (linea 98) mientras el dueno declarado
 * es `src/voice/lib/audioMath.js:432` ("Dueno unico (V18)"). Era una copia
 * DIVERGENTE: la local NO normalizaba a minusculas y la del dueno SI.
 *
 * Medido antes de tocar: los 4 usos de la copia local (countSharedSpeechWords,
 * utterancesSameRevision, isHarmfulSuffixShrink) solo miran el NUMERO de palabras
 * (o ya bajan a minusculas palabra a palabra), asi que la divergencia no producia
 * comportamiento distinto: la copia sobraba sin motivo. Se importa el dueno.
 * `fluTranscriptPause.countSpeechWords` es un RECUENTO (no una copia divergente);
 * el guard fija que coincide con el dueno palabra a palabra.
 *
 * El guard pregunta DOS cosas: que no exista otra `function speechWords` fuera del
 * dueno (texto) y que el recuento siga siendo el del dueno (conducta).
 *
 * Prueba de DETECTOR real (0.24): se alimenta una copia sintetica y se comprueba
 * que el detector la marca; si el guard siguiera verde sin marcarla, seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { speechWords } from '../src/voice/lib/audioMath.js';
import { countSpeechWords } from '../src/voice/lib/fluTranscriptPause.js';
import { countSharedSpeechWords } from '../src/voice/lib/conversationStream.js';

const OWNER = 'src/voice/lib/audioMath.js';

export interface SourceFile {
    file: string;
    source: string;
}

/** `archivo:linea` de cada `function speechWords` FUERA del dueno. */
export function findForeignSpeechWords(
    sources: ReadonlyArray<SourceFile>,
    owner: string = OWNER,
): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        if (file === owner) continue;
        source.split('\n').forEach((line, index) => {
            if (/function\s+speechWords\s*[<(]/.test(line)) hits.push(`${file}:${index + 1}`);
        });
    }
    return hits;
}

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, acc);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
            acc.push(relative(process.cwd(), p).replace(/\\/g, '/'));
        }
    }
    return acc;
}

function voiceSources(): SourceFile[] {
    return walk(join(process.cwd(), 'src', 'voice')).map((file) => ({
        file,
        source: readFileSync(join(process.cwd(), file), 'utf8'),
    }));
}

describe('speechWordsSingleOwnerGuard — la tokenizacion de voz tiene un dueno', () => {
    it('ninguna fuente de src/voice redefine speechWords fuera del dueno', () => {
        const bad = findForeignSpeechWords(voiceSources());
        expect(bad, `Copias de speechWords (archivo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: una copia fuera del dueno se marca', () => {
        const synthetic: SourceFile[] = [
            { file: OWNER, source: "export function speechWords(text = '') {\n  return []\n}" },
            { file: 'src/voice/lib/conversationStream.js', source: "function speechWords(text = '') {\n  return []\n}" },
        ];
        expect(findForeignSpeechWords(synthetic)).toEqual(['src/voice/lib/conversationStream.js:1']);
    });

    it('el codigo limpio no se marca', () => {
        const clean: SourceFile[] = [
            { file: OWNER, source: "export function speechWords(text = '') {\n  return []\n}" },
            { file: 'src/voice/lib/otro.js', source: "import { speechWords } from './audioMath.js'" },
        ];
        expect(findForeignSpeechWords(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: el recuento coincide con el dueno (una sola tokenizacion)', () => {
        // `countSpeechWords` es un RECUENTO (no una copia divergente): usa la misma
        // tokenizacion, y el guard fija la equivalencia con el dueno palabra a palabra.
        for (const sample of ['', '   ', '***', '  hola   mundo ', 'El Nino corre', 'uno']) {
            expect(countSpeechWords(sample), sample).toBe(speechWords(sample).length);
        }
        // El dueno normaliza a minusculas; la copia local (que no lo hacia) solo se
        // usaba para el recuento, por eso no habia diferencia de conducta.
        expect(speechWords('El Nino')).toEqual(['el', 'nino']);
    });

    it('COMPORTAMIENTO: countSharedSpeechWords sigue compartiendo el prefijo (insensible a mayusculas)', () => {
        // Antes la copia no bajaba a minusculas; el bucle ya lo hacia por palabra.
        expect(countSharedSpeechWords('Hola mundo', 'hola mundo y algo mas')).toBe(2);
        expect(countSharedSpeechWords('tactil', 'tactico')).toBe(1);
    });
});
