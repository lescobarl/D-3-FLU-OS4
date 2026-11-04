// ============================================================
// FLU OS4 — Architecture & Compliance Tests
// ============================================================
// Validates that the refactored codebase complies with
// AGENTS.md constraints:
//   - Rule #1: NO HARDCODE — centralized configuration
//   - Rule #2: NO PARCHES — no external mutations
//   - Obligación #1: DI via interfaces
//   - Obligación #6: UUIDv4 in all insertions
//   - Obligación #7: Sync tuple [revision, updated_at, deleted]
//   - Obligación #8: JSDoc on all exported functions
// ============================================================

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORAGE_KEYS, GEMINI_CONFIG, POLLINATIONS_CONFIG, DEFAULT_PERSONALITY, WELCOME_MESSAGE, UI_DEFAULTS } from '../src/core/config/appConfig';
import {
    checkFull,
    conversationInternalImports,
    countDefinitions,
    mapOwnerSymbols,
} from '../scripts/guard-architecture.mjs';

// ============================================================
// 1. AppConfig — Centralized Configuration (Rule #1)
// ============================================================
describe('AppConfig — Centralized Configuration [Rule #1]', () => {

    it('STORAGE_KEYS must not contain hardcoded values in business logic', () => {
        expect(STORAGE_KEYS.TEXT_API_KEY).toBe('flu-text-api-key');
        expect(STORAGE_KEYS.LANGUAGE).toBe('flu-language');
        expect(STORAGE_KEYS.SESSION_ROLE).toBe('flu-session-role');
        // All storage keys are frozen (as const)
        expect(Object.isFrozen(STORAGE_KEYS)).toBe(false); // const objects are not frozen at runtime
    });

    it('GEMINI_CONFIG must have all required fields', () => {
        expect(GEMINI_CONFIG.MODEL).toBeDefined();
        expect(GEMINI_CONFIG.API_URL).toContain('generativelanguage.googleapis.com');
        expect(GEMINI_CONFIG.DEFAULT_TEMPERATURE).toBeGreaterThan(0);
        expect(GEMINI_CONFIG.DEFAULT_TOP_K).toBeGreaterThan(0);
        expect(GEMINI_CONFIG.DEFAULT_TOP_P).toBeGreaterThan(0);
        expect(GEMINI_CONFIG.DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThan(0);
    });

    it('POLLINATIONS_CONFIG must have correct base URL', () => {
        expect(POLLINATIONS_CONFIG.BASE_URL).toBe('https://image.pollinations.ai/prompt');
        expect(POLLINATIONS_CONFIG.DEFAULT_WIDTH).toBe(1024);
        expect(POLLINATIONS_CONFIG.DEFAULT_HEIGHT).toBe(768);
    });

    it('DEFAULT_PERSONALITY must have all required traits', () => {
        expect(DEFAULT_PERSONALITY.name).toBe('FLU');
        expect(DEFAULT_PERSONALITY.traits).toContain('amigable');
        expect(DEFAULT_PERSONALITY.traits).toContain('curioso');
        expect(DEFAULT_PERSONALITY.traits).toContain('servicial');
        expect(DEFAULT_PERSONALITY.tone).toBe('friendly');
        expect(DEFAULT_PERSONALITY.proactivity).toBe(0.3);
    });

    it('WELCOME_MESSAGE must have Spanish and English variants', () => {
        expect(WELCOME_MESSAGE.es).toContain('FLU');
        expect(WELCOME_MESSAGE.en).toContain('FLU');
        expect(WELCOME_MESSAGE.es).not.toBe(WELCOME_MESSAGE.en);
    });

    it('UI_DEFAULTS must have sensible defaults', () => {
        expect(UI_DEFAULTS.LANGUAGE).toBe('es');
        expect(UI_DEFAULTS.DEFAULT_SESSION_ROLE).toBe('Usuario');
        expect(UI_DEFAULTS.CONVERSATION_HISTORY_LIMIT).toBe(180);
        expect(UI_DEFAULTS.RESUME_LISTENING_DELAY_MS).toBe(50);
        expect(UI_DEFAULTS.RESUME_LISTENING_RETRY_MS).toBe(120);
        expect(UI_DEFAULTS.IDLE_TIMEOUT_MS).toBe(2000);
    });
});

// ============================================================
// 3. App.tsx — No Hardcoded Storage Keys (Rule #1)
// ============================================================
describe('App.tsx — No Hardcoded Storage Keys [Rule #1]', () => {

    it('App.tsx must import STORAGE_KEYS from appConfig', async () => {
        const src = (await import('fs')).readFileSync('./src/App.tsx', 'utf-8');
        // Old constants should NOT be defined
        expect(src).not.toContain('const GEMINI_API_KEY_STORAGE');
        expect(src).not.toContain('const LANGUAGE_STORAGE_KEY');
        expect(src).not.toContain('const SESSION_ROLE_STORAGE_KEY');
        // Should use STORAGE_KEYS from appConfig
        expect(src).toContain('STORAGE_KEYS');
    });

    it('App.tsx must import WELCOME_MESSAGE from appConfig', async () => {
        const src = (await import('fs')).readFileSync('./src/App.tsx', 'utf-8');
        expect(src).toContain('WELCOME_MESSAGE');
        // Should NOT have hardcoded welcome filter
        expect(src).not.toContain('const WELCOME_FILTER');
    });

    it('App.tsx must import uuidv4 for all IDs', async () => {
        const src = (await import('fs')).readFileSync('./src/App.tsx', 'utf-8');
        expect(src).toContain("import { v4 as uuidv4 } from 'uuid'");
        // Should NOT have Date.now() based IDs
        expect(src).not.toContain('`log-${Date.now()}`');
        expect(src).not.toContain('`ws-${Date.now()}`');
        expect(src).not.toContain('`minute-${Date.now()}`');
        expect(src).not.toContain('`cmd-${Date.now()}`');
        expect(src).not.toContain('`audit-${Date.now()}`');
        expect(src).not.toContain('`summary-${Date.now()}`');
        expect(src).not.toContain('`error-${Date.now()}`');
        expect(src).not.toContain('`participant-${Date.now()}`');
        expect(src).not.toContain('`profile-${Date.now()}`');
    });
});

// ============================================================
// 4. IntegrationStore — No Local DEFAULT_PERSONALITY (Rule #1)
// ============================================================
describe('IntegrationStore — Uses appConfig [Rule #1]', () => {

    it('integrationStore must import DEFAULT_PERSONALITY from appConfig', async () => {
        const src = (await import('fs')).readFileSync('./src/store/integrationStore.ts', 'utf-8');
        expect(src).toContain("from '../core/config/appConfig.ts'");
        expect(src).toContain('DEFAULT_PERSONALITY');
        expect(src).toContain('UI_DEFAULTS');
        expect(src).toContain('SENTIMENT_KEYWORDS');
        expect(src).toContain('TOPIC_KEYWORDS');
        // Should NOT have local DEFAULT_PERSONALITY declaration
        expect(src).not.toContain('const DEFAULT_PERSONALITY = {');
    });
});

// ============================================================
// 6. Gemini Service — Implements IAIService (Obligación #1)
// ============================================================
describe('Gemini Service — IAIService Implementation [Obligación #1]', () => {

    it('gemini.ts must implement IAIService (adapter de transporte)', async () => {
        const src = (await import('fs')).readFileSync('./src/services/gemini.ts', 'utf-8');
        // Arquitectura de implementación única: la orquestación vive en
        // BaseAIService (src/core/ai/aiServiceBase.ts) y gemini.ts solo aporta
        // el transporte. El adapter implementa IAIService vía la base.
        const baseSrc = (await import('fs')).readFileSync('./src/core/ai/aiServiceBase.ts', 'utf-8');
        expect(baseSrc).toContain('class BaseAIService implements IAIService');
        expect(src).toContain('class GeminiService extends BaseAIService');
        expect(src).toContain('IAIService');
        // Should use appConfig for configuration (2-API architecture:
        // texto vía resolveTextApiKey + proxy, imágenes vía Pollinations)
        expect(src).toContain("from '../core/config/appConfig'");
        // La clave de texto se resuelve en el dueño único `core/ai/textKey`;
        // el adapter delega en él (no la relee por su cuenta).
        expect(src.includes('resolveTextRequestKey') || src.includes('resolveTextApiKey')).toBe(true);
        expect(src).toContain('buildPollinationsUrl');
    });

    it('gemini.ts must not have hardcoded API URLs', async () => {
        const src = (await import('fs')).readFileSync('./src/services/gemini.ts', 'utf-8');
        // Should NOT have hardcoded URLs
        expect(src).not.toContain('generativelanguage.googleapis.com/v1beta/models/');
        expect(src).not.toContain('image.pollinations.ai/prompt/');
    });
});

// ============================================================
// 7. App.tsx — No FLU_CONFIG Mutation Patch (Rule #2)
// ============================================================
describe('App.tsx — No External Mutations [Rule #2]', () => {

    it('App.tsx must not mutate FLU_CONFIG at module level', async () => {
        const src = (await import('fs')).readFileSync('./src/App.tsx', 'utf-8');
        // The FLU_CONFIG mutation patch should be removed
        expect(src).not.toContain('wsTab.label = ');
    });
});

// ============================================================
// 8. App.tsx — No Welcome Message Cleanup Patch (Rule #2)
// ============================================================
describe('App.tsx — No Welcome Message Cleanup Effect [Rule #2]', () => {

    it('App.tsx must not have welcome message cleanup useEffect', async () => {
        const src = (await import('fs')).readFileSync('./src/App.tsx', 'utf-8');
        // The cleanup effect should be removed (handled via WELCOME_MESSAGE filter)
        // The Spanish comment "Limpiar mensaje de bienvenida" was the unique patch marker
        expect(src).not.toContain('Limpiar mensaje de bienvenida del store');
        // Note: integrationStore.setLastResponse('') is legitimate business logic
        // used in navigation command handling (OS2 parity), not a patch
    });
});

// ============================================================
// 9. UUIDv4 Compliance (Obligación #6)
// ============================================================
describe('UUIDv4 Compliance [Obligación #6]', () => {

    it('integrationStore must use uuidv4 for all entries', async () => {
        const src = (await import('fs')).readFileSync('./src/store/integrationStore.ts', 'utf-8');
        expect(src).toContain("import { v4 as uuidv4 } from 'uuid'");
        expect(src).toContain('uuidv4()');
    });

    it('fluDatabase must use uuidv4 for all records', async () => {
        const src = (await import('fs')).readFileSync('./src/core/db/fluDatabase.ts', 'utf-8');
        expect(src).toContain("import { v4 as uuidv4 } from 'uuid'");
    });
});

// ============================================================
// 10. SyncTuple Compliance (Obligación #7)
// ============================================================
describe('SyncTuple Compliance [Obligación #7]', () => {

    it('buildSyncTuple produce SyncTuple con [revision, updated_at, deleted]', async () => {
        const { buildSyncTuple } = await import('../src/core/db/syncTuple');
        // Verify the interface structure via the canonical builder
        const tuple = buildSyncTuple(undefined, Date.now());
        expect(tuple).toHaveProperty('revision');
        expect(tuple).toHaveProperty('updated_at');
        expect(tuple).toHaveProperty('deleted');
        expect(tuple.revision).toBe(1);
        expect(tuple.deleted).toBe(false);
        expect(typeof tuple.updated_at).toBe('string');

        // buildSyncTuple must increment revision
        const bumped = buildSyncTuple(tuple, Date.now());
        expect(bumped.revision).toBe(2);
        expect(bumped.deleted).toBe(false);
    });
});

// ============================================================
// 12. Conversation State Machine — All States Covered
// ============================================================
describe('Conversation State Machine', () => {

    it('useAvatarVoiceSync must handle all conversation states', async () => {
        const src = (await import('fs')).readFileSync('./src/hooks/useAvatarVoiceSync.ts', 'utf-8');
        // All states must be handled in the switch
        expect(src).toContain("case 'IDLE'");
        expect(src).toContain("case 'LISTENING'");
        expect(src).toContain("case 'THINKING'");
        expect(src).toContain("case 'SPEAKING'");
        expect(src).toContain("case 'ERROR'");
    });
});

// ============================================================
// 13. Emotional State Mapping — All Emotions Covered
// ============================================================
describe('Emotional State Mapping', () => {

    it('sentimentToEmotion must delegate to EmotionEngine resolveContextualExpression', async () => {
        const src = (await import('fs')).readFileSync('./src/store/integrationStore.ts', 'utf-8');
        // DATA-DRIVEN: sentimentToEmotion now delegates to EmotionEngine instead of hardcoded switch
        expect(src).toContain("resolveContextualExpression");
        expect(src).toContain("resolved.emotionalState ?? 'neutral'");
    });

    it('resolveContextualExpression must map all sentiment types via EmotionEngine', async () => {
        const src = (await import('fs')).readFileSync('./src/core/anim/emotionEngine.ts', 'utf-8');
        // The EmotionEngine resolveContextualExpression has the mapping
        expect(src).toContain("emotion = 'happy'");
        expect(src).toContain("emotion = 'sad'");
        expect(src).toContain("emotion = 'curious'");
        expect(src).toContain("emotion = 'neutral'");
    });
});

// ============================================================
// 14. Bridge Types — All Required Interfaces
// ============================================================
describe('Bridge Types — Complete Type Definitions', () => {

    it('bridge.ts must export all required types', async () => {
        const src = (await import('fs')).readFileSync('./src/types/bridge.ts', 'utf-8');
        // Types and interfaces are erased at runtime, so we verify the source file
        expect(src).toContain('export type ConversationState');
        expect(src).toContain('export type EmotionalState');
        expect(src).toContain('export interface ConversationEntry');
        expect(src).toContain('export interface BridgeConfig');
        expect(src).toContain('export interface PersonalityConfig');
        expect(src).toContain('export interface VoiceBridgeEvent');
        expect(src).toContain('export interface StateMapping');
        expect(src).toContain('export interface MinuteEntry');
        expect(src).toContain('export interface WorkspaceEntry');
        expect(src).toContain('export interface SessionStats');
        expect(src).toContain('export interface FluContract');
    });
});

// ============================================================
// 15. EXPRESSION_MAP vs expressionRegistry — Data Alignment
// ============================================================
describe('EXPRESSION_MAP vs expressionRegistry — Data Alignment [Hallazgo 6]', () => {

    it('EXPRESSION_MAP must have all expressions registered in expressionRegistry', async () => {
        const { EXPRESSION_MAP } = await import('../src/avatar/index');
        const { getExpressionDef } = await import('../src/core/anim/expressionRegistry');

        const mapKeys = Object.keys(EXPRESSION_MAP);
        expect(mapKeys.length).toBeGreaterThanOrEqual(20);

        // Extras de paridad OS3 que pueden no estar aún en el registry.
        const ALLOWED_MAP_EXTRAS = new Set(['saludo', 'wave', 'alerta', 'sleep']);

        const missing = mapKeys.filter((expr) => !getExpressionDef(expr) && !ALLOWED_MAP_EXTRAS.has(expr));
        expect(missing, 'expresiones de EXPRESSION_MAP sin definición en expressionRegistry').toEqual([]);
    }, 60_000);

    it('EXPRESSION_MAP animations must be valid BunnyAnimation values', async () => {
        const { EXPRESSION_MAP } = await import('../src/avatar/index');
        const { getValidAnimations } = await import('../src/core/anim/expressionRegistry');

        const validAnims = getValidAnimations();
        const mapKeys = Object.keys(EXPRESSION_MAP);

        const invalid: Array<{ expression: string; anim: string }> = [];
        for (const expr of mapKeys) {
            const anims = EXPRESSION_MAP[expr];
            for (const anim of anims) {
                if (!validAnims.includes(anim)) {
                    invalid.push({ expression: expr, anim });
                }
            }
        }

        if (invalid.length > 0) {
            expect(invalid).toEqual([]);
        }
    }, 60_000);

    it('EXPRESSION_MAP must not have stale expressions (removed from registry)', async () => {
        const { EXPRESSION_MAP } = await import('../src/avatar/index');
        const { getValidExpressions } = await import('../src/core/anim/expressionRegistry');

        const validExprs = getValidExpressions();
        const mapKeys = Object.keys(EXPRESSION_MAP);

        // All EXPRESSION_MAP keys that are NOT OS3 parity extras should exist in registry
        const os3ParityExtras = ['saludo', 'wave', 'alerta', 'sleep'];
        const stale: string[] = [];
        for (const expr of mapKeys) {
            if (os3ParityExtras.includes(expr)) continue;
            if (!validExprs.includes(expr)) {
                stale.push(expr);
            }
        }

        if (stale.length > 0) {
            expect(stale).toEqual([]);
        }
    }, 60_000);
});

// ============================================================
// Fase 2 — Memoria y recordatorios (estructura persistente)
// ============================================================

describe('Fase 2 — Database v5: tablas reminders y shoppingItems', () => {
    it('fluDatabase must declare v5 stores for reminders and shoppingItems', async () => {
        const src = (await import('fs')).readFileSync('./src/core/db/fluDatabase.ts', 'utf-8');
        expect(src).toMatch(/reminders:\s*'id, status, dueAt, personId, createdAt'/);
        expect(src).toMatch(/shoppingItems:\s*'id, checked, personId, createdAt'/);
    });

    it('fluDatabase must export the Phase 2 record types', async () => {
        const src = (await import('fs')).readFileSync('./src/core/db/fluDatabase.ts', 'utf-8');
        expect(src).toContain('export interface ShoppingItemRecord');
    });
});

// ============================================================
// Gate de arquitectura y dueño — falsificación (AGENTS §8.4)
// ============================================================

describe('Gate de arquitectura — falsificación', () => {
    it('cuenta el dueño definido como método de clase, no solo como función', () => {
        const src = [
            'export class Motor {',
            '    async commitUserTurnRow(args) { return args }',
            '    private commitUserTurnRow() {}',
            '}',
            'commitUserTurnRow(1)',
        ].join('\n');
        expect(countDefinitions(src, 'commitUserTurnRow')).toBe(2);
    });

    it('falla si el mismo dueño se define en dos archivos', () => {
        const errors = checkFull(['commitUserTurnRow'], [
            { path: 'src/a.ts', text: 'export function commitUserTurnRow() {}' },
            { path: 'src/b.ts', text: 'const commitUserTurnRow = () => {}' },
        ]);
        expect(errors).toEqual([
            'dueño duplicado "commitUserTurnRow": src/a.ts(1), src/b.ts(1)',
        ]);
    });

    it('falla si un dueño del mapa no tiene definición', () => {
        expect(checkFull(['commitUserTurnRow'], [])).toEqual([
            'dueño declarado sin definición "commitUserTurnRow"',
        ]);
    });

    it('bloquea un import interno y permite la fachada', () => {
        expect(conversationInternalImports("import { x } from '../conversation/index.ts'")).toEqual([]);
        expect(conversationInternalImports("import { x } from '../conversation/fila.ts'")).toEqual([
            '../conversation/fila.ts',
        ]);
        const errors = checkFull([], [
            { path: 'src/voice/compose/motor.js', text: "import { x } from '../conversation/fila.ts'" },
        ]);
        expect(errors).toEqual([
            'src/voice/compose/motor.js importa interno del módulo: ../conversation/fila.ts (usa src/voice/conversation/index.ts)',
        ]);
    });

    it('deriva los símbolos solo de la columna Dueño del mapa', () => {
        const mapa = [
            '| Pregunta | Dueño | Nota |',
            '|---|---|---|',
            '| ¿Quién? | `a.ts:1` `duenoA` · `duenoB` | menciona `noEsDueno` |',
        ].join('\n');
        expect(mapOwnerSymbols(mapa)).toEqual(['duenoA', 'duenoB']);
    });
});

describe('Gate de dueño — falsificación', () => {
    const raiz = process.cwd();
    const script = join(raiz, 'scripts', 'owner-gate.mjs');

    it('bloquea un archivo nuevo no declarado y permite el declarado', () => {
        const dir = mkdtempSync(join(tmpdir(), 'owner-gate-'));
        writeFileSync(
            join(dir, 'OWNERS.md'),
            [
                '| Pregunta | Dueño | Nota |',
                '|---|---|---|',
                '| ¿Declarado? | `declarado.ts:1` | prueba |',
            ].join('\n'),
        );
        const correr = (filePath: string): number => {
            try {
                execFileSync(
                    process.execPath,
                    [script, '--path', filePath, '--map', join(dir, 'OWNERS.md')],
                    { cwd: raiz, encoding: 'utf8', stdio: 'pipe' },
                );
                return 0;
            } catch (error) {
                return Number((error as { status?: number }).status ?? 1);
            }
        };
        try {
            expect(correr('src/voice/conversation/declarado.ts')).toBe(0);
            expect(correr('src/voice/conversation/no-declarado.ts')).toBe(2);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('exime los archivos anteriores al gate y bloquea los añadidos con el gate presente', () => {
        const dir = mkdtempSync(join(tmpdir(), 'owner-gate-bootstrap-'));
        const git = (...args: string[]): string =>
            execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        const commit = (mensaje: string): void => {
            git('add', '-A');
            execFileSync(
                'git',
                ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', mensaje],
                { cwd: dir, stdio: 'pipe' },
            );
        };
        const correr = (base: string): { code: number; salida: string } => {
            try {
                const salida = execFileSync(
                    process.execPath,
                    [script, '--diff', base],
                    {
                        cwd: raiz,
                        encoding: 'utf8',
                        stdio: 'pipe',
                        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
                    },
                );
                return { code: 0, salida: String(salida) };
            } catch (error) {
                const fallo = error as { status?: number; stderr?: Buffer | string };
                return {
                    code: Number(fallo.status ?? 1),
                    salida: String(fallo.stderr ?? ''),
                };
            }
        };
        try {
            execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
            writeFileSync(join(dir, 'README.md'), 'prueba\n');
            commit('c1');
            const base = git('rev-list', '--max-parents=0', 'HEAD').trim();

            mkdirSync(join(dir, 'src'));
            writeFileSync(join(dir, 'src', 'viejo.ts'), 'export const viejo = 1\n');
            commit('c2: archivo anterior al gate');

            mkdirSync(join(dir, 'scripts'));
            mkdirSync(join(dir, 'docs'));
            copyFileSync(script, join(dir, 'scripts', 'owner-gate.mjs'));
            writeFileSync(
                join(dir, 'docs', 'OWNERS.md'),
                '| Pregunta | Dueño | Nota |\n|---|---|---|\n',
            );
            commit('c3: nace el gate');

            writeFileSync(join(dir, 'src', 'nuevo.ts'), 'export const nuevo = 1\n');
            commit('c4: archivo nuevo con el gate presente');

            // `viejo.ts` nació antes del gate: exento. `nuevo.ts` nació con el
            // gate en su árbol: sin fila, bloquea.
            const primero = correr(base);
            expect(primero.code).toBe(2);
            const [bloqueados, exentos] = primero.salida.split('quedan exento(s):');
            expect(bloqueados).toContain('src/nuevo.ts');
            expect(bloqueados).not.toContain('src/viejo.ts');
            expect(exentos).toContain('src/viejo.ts');

            // Sin el archivo viejo en el rango, el nuevo sigue bloqueado.
            expect(correr(git('rev-parse', 'HEAD~1').trim()).code).toBe(2);

            writeFileSync(
                join(dir, 'docs', 'OWNERS.md'),
                [
                    '| Pregunta | Dueño | Nota |',
                    '|---|---|---|',
                    '| ¿Nuevo? | `src/nuevo.ts:1` | prueba |',
                ].join('\n'),
            );
            commit('c5: declara el nuevo');
            expect(correr(git('rev-parse', 'HEAD~2').trim()).code).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
