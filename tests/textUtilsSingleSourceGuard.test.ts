// ============================================================
// textUtilsSingleSourceGuard.test.ts
// ============================================================
// Guard de FUENTE ÚNICA de las utilidades de texto. Falla si vuelve a
// aparecer una segunda definición de un símbolo canónico de
// src/lib/textUtils.ts, y nombra cada duplicado como archivo:símbolo:línea.
//
// Invariantes:
//   I1  stripDiacritics        → 1 implementación (textUtils.ts)
//   I2  normalizeForMatch      → 1 implementación (textUtils.ts)
//   I3  shortText              → 1 implementación (textUtils.ts)
//   I4  normalizeSpaces        → 1 implementación (textUtils.ts)
//   I5  normalizeText (alias)  → 0 definiciones (se usa normalizeSpaces)
//
// NO unificados A PROPÓSITO (§D5 — parecidos-pero-distintos, NO duplicados):
//   - normalizadores de comando (audioMath.normalizeVoiceCommandText /
//     normalizeCommandForDeterministic / normalizeSpokenCommand): distinta
//     firma y umbral; no comparten cuerpo.
//   - normalización de transcripción (speechMerge.normalizeMicText vs
//     turnTranscript.normalizeTranscriptText / normalizeTurnCapture):
//     pipelines distintos (<48 chars vs collapse con minRepeatChars=24).
//   - colapso ASR (collapseRepeatedSpeech / collapseAsrStutter /
//     collapseEchoPhrase / collapseStutterRepeat / collapseInlineRepeat):
//     algoritmos y parámetros distintos (bloque de palabras, eco, tail-inline).
//   Unificarlos cambiaría el comportamiento del motor de voz (prohibido:
//   no afectar lo validado). Se documentan aquí como decisión, no como deuda.
//
// Cubre también el CONTRATO de comportamiento (no solo conteo por nombre).
// ============================================================

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    normalizeForMatch,
    normalizeSpaces,
    shortText,
    stripDiacritics,
} from '../src/lib/textUtils';
import { stripDiacritics as stripDiacriticsFromAudioMath, detectTranscriptLanguage } from '../src/voice/lib/audioMath.js';
import { clasificarDia } from '../src/core/agenda/agendaShared';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CANONICAL = 'src/lib/textUtils.ts';

interface Hit {
    ref: string;
    text: string;
}

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, acc);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
            acc.push(full);
        }
    }
    return acc;
}

function rel(file: string): string {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function read(relPath: string): string {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

/** Cada coincidencia de `pattern` en src/ como archivo:línea. */
function scan(pattern: RegExp): Hit[] {
    const hits: Hit[] = [];
    for (const file of walk(SRC)) {
        const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
        lines.forEach((line, index) => {
            if (pattern.test(line)) {
                hits.push({ ref: `${rel(file)}:${index + 1}`, text: line.trim().slice(0, 100) });
            }
        });
    }
    return hits;
}

function summary(hits: Hit[]): string {
    return hits.map((h) => `  ${h.ref}  ${h.text}`).join('\n');
}

function outsideCanonical(hits: Hit[]): Hit[] {
    return hits.filter((h) => !h.ref.startsWith(`${CANONICAL}:`));
}

function defPattern(name: string): RegExp {
    return new RegExp(`(?:export\\s+)?(?:function|const)\\s+${name}\\b`);
}

function expectSingleSource(name: string, expected: number): void {
    const hits = outsideCanonical(scan(defPattern(name)));
    expect(
        hits.length,
        `${name} debe tener UNA sola definición en ${CANONICAL}; duplicados:\n${summary(hits)}`,
    ).toBe(expected);
}

describe('Guard — utilidades de texto de fuente única', () => {
    it('I1: stripDiacritics solo se define en textUtils.ts (audioMath re-exporta)', () => {
        // Detecta cualquier definición de una variante de stripDiacritics
        // (stripDiacritics, stripDiacriticsHorario, …) fuera del canónico.
        // Los re-exports (`export { stripDiacritics }`) no cuentan: no definen algoritmo.
        const hits = outsideCanonical(
            scan(/(?:export\s+)?(?:function|const)\s+stripDiacritics\w*\s*[=(]/),
        );
        expect(
            hits.length,
            `stripDiacritics duplicado; definiciones:\n${summary(hits)}`,
        ).toBe(0);
        expect(read(CANONICAL)).toContain('function stripDiacritics');
    });

    it('I2: normalizeForMatch tiene una sola definición (textUtils.ts)', () => {
        expectSingleSource('normalizeForMatch', 0);
    });

    it('I3: shortText tiene una sola definición (textUtils.ts)', () => {
        expectSingleSource('shortText', 0);
    });

    it('I4: normalizeSpaces tiene una sola definición (textUtils.ts)', () => {
        expectSingleSource('normalizeSpaces', 0);
    });

    it('I5: normalizeText ya no se define (se usa normalizeSpaces)', () => {
        const hits = scan(defPattern('normalizeText'));
        expect(
            hits.length,
            `normalizeText debe usar normalizeSpaces; definiciones:\n${summary(hits)}`,
        ).toBe(0);
    });
});

describe('Contrato de comportamiento de las utilidades canónicas', () => {
    it('stripDiacritics quita acentos sin alterar mayúsculas', () => {
        expect(stripDiacritics('Café Ñandú')).toBe('Cafe Nandu');
    });

    it('normalizeForMatch minúsculas + sin acentos + espacios colapsados', () => {
        expect(normalizeForMatch('  Canción   Ñoña ')).toBe('cancion nona');
    });

    it('normalizeSpaces colapsa espacios y recorta', () => {
        expect(normalizeSpaces('  a   b \n c ')).toBe('a b c');
    });

    it('shortText colapsa espacios, trunca con elipsis y respeta max no válido', () => {
        expect(shortText('  hola   mundo  ', 7)).toBe('hola mu…');
        expect(shortText('corto', 7)).toBe('corto');
        expect(shortText('sin límite')).toBe('sin límite');
        expect(shortText('sin límite', Number.NaN)).toBe('sin límite');
    });

    it('audioMath.stripDiacritics conserva su contrato de minúsculas', () => {
        expect(stripDiacriticsFromAudioMath('Café ÑANDÚ')).toBe('cafe nandu');
        expect(detectTranscriptLanguage('What is the homework, please?')).toBe('en');
    });

    it('agendaShared.clasificarDia sigue resolviendo días con acentos/mayúsculas', () => {
        expect(clasificarDia('Miércoles')).toBe(3);
        expect(clasificarDia('SÁBADO')).toBe(6);
    });

    it('musicPlayer.normalizeForMatch NO colapsa espacios internos (contrato histórico)', async () => {
        const { normalizeForMatch: mpNormalize } = await import('../src/services/musicPlayer');
        expect(mpNormalize('la   cancion')).toBe('la   cancion');
        expect(mpNormalize('  Canción  ')).toBe('cancion');
    });
});
