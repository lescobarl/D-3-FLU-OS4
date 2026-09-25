// ============================================================
// Guard — el modo conversación tiene UN solo dueño
// ------------------------------------------------------------
// Causa raíz del bug "tras el onboarding transcribe tarde y de golpe":
// el modo lo decidía `conversationActiveRef` y lo escribían varias entradas;
// el arranque automático tras el onboarding NO lo ponía, así que abría la
// escucha en modo comando (wake word + temporizadores de dictado).
// Este guard exige:
//   1) comportamiento: `open()` fija el flag ANTES de arrancar la escucha;
//   2) una sola ruta: App.tsx NO escribe el ref a mano (lo hace el controlador).
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConversationModeController } from '../src/voice/lib/conversationMode';

describe('conversationMode — comportamiento (orden y única llamada)', () => {
    it('open() fija el modo ANTES de arrancar la escucha y la llama una vez', async () => {
        const conversationActiveRef = { current: false };
        const seen: Array<boolean> = [];
        let calls = 0;
        const controller = createConversationModeController({
            conversationActiveRef,
            startListening: async () => {
                calls += 1;
                seen.push(conversationActiveRef.current);
            },
        });

        await controller.open({ resume: true });

        expect(calls).toBe(1);
        expect(seen).toEqual([true]);
        expect(conversationActiveRef.current).toBe(true);
    });

    it('open() propaga el error del arranque (el llamador reintenta)', async () => {
        const controller = createConversationModeController({
            conversationActiveRef: { current: false },
            startListening: async () => {
                const error = new Error('not-allowed');
                error.name = 'not-allowed';
                throw error;
            },
        });
        await expect(controller.open()).rejects.toThrow('not-allowed');
    });

    it('enter() y exit() son las únicas transiciones del modo', () => {
        const ref = { current: false };
        const controller = createConversationModeController({
            conversationActiveRef: ref,
            startListening: async () => undefined,
        });
        controller.enter();
        expect(ref.current).toBe(true);
        controller.exit();
        expect(ref.current).toBe(false);
    });
});

describe('conversationMode — una sola ruta (sin doble escritor del flag)', () => {
    it('App.tsx no escribe conversationActiveRef.current a mano', () => {
        const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
        const codeLines = source
            .split('\n')
            .filter((line) => {
                const trimmed = line.trim();
                return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
            });
        const directWrites = codeLines.flatMap(
            (line) => line.match(/conversationActiveRef\.current\s*=\s*(true|false)/g) || [],
        );
        expect(directWrites).toEqual([]);
    });

    it('el arranque tras onboarding abre la escucha por el controlador', () => {
        const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
        expect(source).toMatch(/conversationMode\.open\(/);
    });

    it('el puente del avatar abre la escucha por el controlador', () => {
        const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
        expect(source).toMatch(/onStartListening:\s*openListeningFromUi/);
        expect(source).toMatch(
            /openListeningFromUi\s*=\s*useCallback\(\(\)\s*=>\s*conversationMode\.open\(\)/,
        );
    });
});
