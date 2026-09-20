// ============================================================
// aiServiceSingleImplGuard.test.ts — Guard de implementación única
// ============================================================
// Defecto: src/services/gemini.ts y src/services/deepseek.ts declaraban
// AMBOS la implementación completa de IAIService (los mismos 9 métodos con
// la misma orquestación), duplicando el motor de IA y habilitando rutas
// dobles por operación (fetchTextEngine vs proxy /api/gemini/*).
//
// Invariante (§8.6 / §10.2): existe UNA sola implementación del motor
// IAIService; gemini/deepseek pasan a ser adapters de transporte (hooks),
// no re-implementan los métodos del contrato.
//
// Nace ROJO mientras N>1 archivos declaren como método de clase (`async
// <metodo>(`) el conjunto completo de métodos de IAIService y lista los
// duplicados como `archivo:símbolo:línea`.
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '../src');
const BASE_IMPL_FILE = 'core/ai/aiServiceBase.ts';

// Métodos de IAIService (el contrato). La detección exige el modificador
// `async` para no confundir la declaración de la interfaz con una
// implementación real.
const IAISERVICE_METHODS = [
    'generateMinute',
    'generateResponse',
    'generateParticipantEvaluation',
    'generateConversationSummary',
    'generateWorkspaceImage',
    'generateVisionAnalysis',
    'analyzeDocument',
    'analyzeApp',
    'generateDocument',
];

function walkDir(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDir(full));
        } else if (/\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

function methodDeclLine(content: string, method: string): number {
    const match = new RegExp(`\\basync\\s+${method}\\s*\\(`).exec(content);
    if (!match) return -1;
    return content.slice(0, match.index).split('\n').length;
}

function implementsEngine(content: string): boolean {
    return IAISERVICE_METHODS.every((m) => methodDeclLine(content, m) > 0);
}

interface EngineImpl {
    rel: string;
    content: string;
}

let engineImpls: EngineImpl[] = [];

beforeAll(() => {
    engineImpls = walkDir(SRC_DIR)
        .map((file) => ({
            rel: path.relative(SRC_DIR, file).split(path.sep).join('/'),
            content: fs.readFileSync(file, 'utf-8'),
        }))
        .filter((f) => implementsEngine(f.content));
});

function duplicateReport(): string {
    return engineImpls
        .flatMap((f) =>
            IAISERVICE_METHODS.map((m) => `  ${f.rel}:${m}:${methodDeclLine(f.content, m)}`),
        )
        .join('\n');
}

describe('Guard — una sola implementación del motor IAIService', () => {
    it('existe exactamente UNA implementación de IAIService (hoy N>1 = duplicación)', () => {
        const report = duplicateReport();
        expect(
            engineImpls.length,
            `Implementaciones duplicadas de IAIService detectadas (${engineImpls.length}):\n${report}`,
        ).toBe(1);
    });

    it('la implementación única vive en la base compartida (no en un adapter)', () => {
        const paths = engineImpls.map((f) => f.rel);
        expect(
            paths,
            `Implementación del motor fuera de ${BASE_IMPL_FILE}: ${paths.join(', ')}`,
        ).toEqual([BASE_IMPL_FILE]);
    });

    it('los adapters de transporte no re-implementan el motor', () => {
        const offenders = engineImpls.filter(
            (f) => f.rel === 'services/gemini.ts' || f.rel === 'services/deepseek.ts',
        );
        expect(
            offenders.map((f) => f.rel),
            `Estos adapters siguen implementando el motor completo: ${offenders.map((f) => f.rel).join(', ')}`,
        ).toEqual([]);
    });
});
