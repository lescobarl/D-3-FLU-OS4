// ============================================================
// deviationGuard.test.ts — Guard anti-regresión de desviaciones
// ============================================================
// Codifica las invariantes YA cerradas (P0-00). Si alguien reintroduce
// una desviación corregida, esta puerta falla y nombra archivo:línea.
//
// Cobertura actual (verde):
//   P1-01  backups/ eliminado (§2.10, Git es el respaldo)
//   P1-03  funciones muertas no reintroducidas en fluStorage.js
//   P1-04  rama idéntica no reintroducida en imageGeneration.js
//   P7-26  hooks de test expuestos SOLO en DEV
//   P3-10  normalizeForMatch centralizado (<= 2 implementaciones)
//   P3-11  stripDiacritics centralizado (<= 2 implementaciones)
//
// Cuando se resuelvan las divergencias pendientes (audioMath / musicPlayer)
// el límite se endurece a 1 en el mismo hito.
// ============================================================

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

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

interface Hit {
    ref: string;
    text: string;
}

/** Devuelve cada coincidencia de `pattern` como "archivo:línea". */
function scan(pattern: RegExp): Hit[] {
    const hits: Hit[] = [];
    for (const file of walk(SRC)) {
        const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
        lines.forEach((line, index) => {
            if (pattern.test(line)) {
                hits.push({
                    ref: `${path.relative(ROOT, file).replace(/\\/g, '/')}:${index + 1}`,
                    text: line.trim().slice(0, 100),
                });
            }
        });
    }
    return hits;
}

function summary(hits: Hit[]): string {
    return hits.map((h) => `  ${h.ref}  ${h.text}`).join('\n');
}

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

describe('Guard de desviaciones (anti-regresión)', () => {
    it('P1-01: backups/ no debe reaparecer', () => {
        expect(
            fs.existsSync(path.join(ROOT, 'backups')),
            'backups/ existe de nuevo: Git es el único respaldo (§2.10)',
        ).toBe(false);
    });

    it('P1-03: funciones muertas no reintroducidas', () => {
        const hits = scan(/\bfunction\s+(addConversationRow|getLatestAuditLogs|renameAuditLogSpeaker|readLatestFromIndex)\b/);
        expect(hits.length, `funciones muertas reintroducidas:\n${summary(hits)}`).toBe(0);
    });

    it('P1-04: rama idéntica no reintroducida en imageGeneration.js', () => {
        const hits = scan(/primary\s*===\s*['"]pollinations['"]/);
        expect(hits.length, `rama muerta reintroducida:\n${summary(hits)}`).toBe(0);
    });

    it('P7-26: el hook de contrato se expone solo vía helper DEV', () => {
        const app = read('src/App.tsx');
        expect(
            /\(window\.__fluOnContractResolved\s*=/.test(app),
            'App.tsx asigna window.__fluOnContractResolved fuera del helper DEV (debe usar exposeContractHookDev)',
        ).toBe(false);
        expect(app).toContain('exposeContractHookDev');
    });

    it('P7-26: los globals de listenLog están guardados por IS_DEV', () => {
        const source = read('src/voice/lib/listenLog.js');
        expect(
            /function syncListenLogGlobals\(\)\s*\{\s*if \(!IS_DEV/.test(source),
            'syncListenLogGlobals debe salir temprano si !IS_DEV',
        ).toBe(true);
    });

    it('P3-11: stripDiacritics centralizado (<= 2 implementaciones)', () => {
        const hits = scan(/\bfunction\s+stripDiacritics\b/);
        expect(
            hits.length,
            `stripDiacritics duplicado (máx. 2: textUtils + variante audioMath):\n${summary(hits)}`,
        ).toBeLessThanOrEqual(2);
        expect(read('src/lib/textUtils.ts')).toContain('export function stripDiacritics');
    });

    it('P3-10: normalizeForMatch centralizado (<= 2 implementaciones)', () => {
        const hits = scan(/\bfunction\s+normalizeForMatch\b/);
        expect(
            hits.length,
            `normalizeForMatch duplicado (máx. 2: textUtils + variante musicPlayer):\n${summary(hits)}`,
        ).toBeLessThanOrEqual(2);
        expect(read('src/lib/textUtils.ts')).toContain('export function normalizeForMatch');
    });
});
