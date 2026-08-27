// ============================================================
// validate-reset-emocion-7s.spec.ts
// VALIDACIÓN RUNTIME: Reset de emoción a los ~7s — SOLO emoción de la IA
//
// Contrato vigente (aprobado por el usuario):
//   1. El reset de 7s aplica ÚNICAMENTE cuando la emoción viene del retorno
//      de la IA (source='ai' escrito por App.tsx). NINGÚN otro escenario.
//   2. La emoción dura ~7s y luego se RESTAURA el estado PREVIO a la emoción
//      (emotionRestoreRef), NO un hardcode "hablando2" ni un toggle forzado.
//   3. Emociones del participante (enojado por mano ignorada) NO tienen 7s:
//      persisten hasta que el flujo cambie.
//   4. Acciones de cuerpo completo (Dance/Run/Walk…) NO se diluyen con el Idle
//      base de habla (THREE.js promediaría poses 50/50 → "shuffle"). Se mezclan
//      SOLO con MouthMove: [Dance, MouthMove].
//
// Este test NO lee código: conduce el store real en runtime.
//   CICLO 1: source='ai' + pendingEmotionAnims=['Dance'] → blend [Dance, MouthMove]
//            (sin Idle base); espera log '7s emoción terminada → setExpression(X)'
//            donde X ∈ {hablando, hablando2} (estado de habla previo). ~7000ms.
//   HABLA NORMAL: SPEAKING sin emoción → setExpression(hablando|hablando2).
//   PARTICIPANTE: source='participant' + SPEAKING → NO debe aparecer el log
//            de reset de 7s (la emoción persiste).
// Guardias: sin pageerror.
// ============================================================
import { test, expect } from '@playwright/test';

interface CycleResult {
    blendQueue: (string | null)[];
    resetExpression: string;
    resetAnimation: string;
    elapsedMs: number;
    resetLog: string | undefined;
}

const SPEAKING_TOGGLES = ['hablando', 'hablando2'];

test('FUNCIONAL: reset de emoción a los ~7s SOLO para la IA (source=ai) y restaura el estado previo', async ({ page }) => {
    test.setTimeout(180000);

    const browserLogs: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[AvatarVoiceSync]') || text.includes('[DIAG]') || text.includes('[TEST]')) {
            browserLogs.push(text);
            console.log(`[BROWSER] ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        pageErrors.push(err.message);
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // Cargar app + canvas 3D + exponer stores
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 30000 });
    console.log('[TEST] Canvas 3D visible');
    await page.waitForTimeout(5000); // cargar modelo FBX (SwiftShader es lento)

    const storeSetup = await page.evaluate(async () => {
        try {
            // @ts-ignore - ruta válida en runtime
            const bunnyModule = await import('/src/avatar/store/bunnyStore.ts');
            // @ts-ignore
            const intModule = await import('/src/store/integrationStore.ts');
            // @ts-ignore
            window.__bunnyStore = bunnyModule.useBunnyStore;
            // @ts-ignore
            window.__intStore = intModule.useIntegrationStore;
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
    if (!storeSetup.success) throw new Error(`No se pudieron inyectar stores: ${JSON.stringify(storeSetup)}`);

    // ========================================
    // Helper: ir a IDLE estable
    // ========================================
    const goIdle = () =>
        page.evaluate(async () => {
            // @ts-ignore
            const intStore = window.__intStore;
            intStore.getState().setConversationState('IDLE');
            intStore.getState().setFluSpeaking(false);
            await new Promise((r) => setTimeout(r, 400));
        });

    // ========================================
    // Helper: un ciclo emoción IA → reset 7s
    // (source='ai' explícito, igual que escribe App.tsx)
    // ========================================
    async function runEmotionCycle(): Promise<CycleResult> {
        await goIdle();

        const startMs = Date.now();
        const logStart = browserLogs.length;

        const blendQueue = await page.evaluate(async () => {
            // @ts-ignore
            const intStore = window.__intStore;
            // @ts-ignore
            const bunnyStore = window.__bunnyStore;
            intStore.getState().setPendingEmotionAnims(['Dance'], 'ai');
            await new Promise((r) => setTimeout(r, 150)); // propagar el update del store
            intStore.getState().setConversationState('SPEAKING');
            intStore.getState().setFluSpeaking(true);
            await new Promise((r) => setTimeout(r, 700)); // dejar que el blend se aplique
            const bs = bunnyStore.getState();
            return bs.blendQueue ?? [];
        });
        console.log(`[TEST] blendQueue durante emoción = [${blendQueue.join(', ')}]`);

        // Esperar el log del reset de 7s generado EN ESTE ciclo
        const deadline = Date.now() + 16000;
        let resetLog: string | undefined;
        while (Date.now() < deadline) {
            resetLog = browserLogs.slice(logStart).find((l) => l.includes('7s emoción terminada →'));
            if (resetLog) break;
            await page.waitForTimeout(200);
        }
        const elapsedMs = Date.now() - startMs;
        console.log(`[TEST] resetLog=${resetLog ?? '(NO APARECIÓ en 16s)'} elapsed=${elapsedMs}ms`);

        const post = await page.evaluate(async () => {
            // @ts-ignore
            const bunnyStore = window.__bunnyStore;
            const bs = bunnyStore.getState();
            return { expression: bs.currentExpression, animation: bs.currentAnimation };
        });

        const m = resetLog?.match(/setExpression\(([^)]+)\)/);
        const resetExpression = m ? m[1].replace(/"/g, '') : post.expression;

        return {
            blendQueue,
            resetExpression,
            resetAnimation: post.animation,
            elapsedMs,
            resetLog,
        };
    }

    // ========================================
    // Helper: habla NORMAL (SPEAKING sin emoción) → toggle
    // ========================================
    async function runNormalSpeaking(): Promise<string> {
        await goIdle();
        return page.evaluate(async () => {
            // @ts-ignore
            const intStore = window.__intStore;
            // @ts-ignore
            const bunnyStore = window.__bunnyStore;
            intStore.getState().setConversationState('SPEAKING');
            intStore.getState().setFluSpeaking(true);
            await new Promise((r) => setTimeout(r, 700));
            return bunnyStore.getState().currentExpression;
        });
    }

    // ========================================
    // Helper: emoción de PARTICIPANTE (source='participant')
    // → NO debe armar reset de 7s
    // ========================================
    async function runParticipantEmotion(): Promise<{ resetLog: string | undefined }> {
        await goIdle();
        const logStart = browserLogs.length;
        await page.evaluate(async () => {
            // @ts-ignore
            const intStore = window.__intStore;
            intStore.getState().setPendingEmotionAnims(['Walk'], 'participant');
            await new Promise((r) => setTimeout(r, 150));
            intStore.getState().setConversationState('SPEAKING');
            intStore.getState().setFluSpeaking(true);
            await new Promise((r) => setTimeout(r, 8000)); // esperar más de 7s
        });
        const resetLog = browserLogs.slice(logStart).find((l) => l.includes('7s emoción terminada →'));
        console.log(`[TEST] Participante resetLog=${resetLog ?? '(ninguno, correcto)'}`);
        return { resetLog };
    }

    // ========================================
    // CICLO 1 (emoción IA, source='ai')
    // ========================================
    console.log('[TEST] === CICLO 1 (emoción IA) ===');
    const c1 = await runEmotionCycle();
    console.log(`[TEST] C1 → blend=[${c1.blendQueue.join(', ')}], resetExpression=${c1.resetExpression}, resetAnimation=${c1.resetAnimation}, elapsed=${c1.elapsedMs}ms`);

    // ========================================
    // HABLA NORMAL (sin emoción): debe setExpression(hablando|hablando2)
    // ========================================
    await page.waitForTimeout(500);
    console.log('[TEST] === HABLA NORMAL (sin emoción) ===');
    const normalExpr = await runNormalSpeaking();
    console.log(`[TEST] Habla normal → setExpression(${normalExpr})`);

    // ========================================
    // CICLO 2 (emoción IA): repetir para verificar estabilidad
    // ========================================
    await page.waitForTimeout(500);
    console.log('[TEST] === CICLO 2 (emoción IA) ===');
    const c2 = await runEmotionCycle();
    console.log(`[TEST] C2 → blend=[${c2.blendQueue.join(', ')}], resetExpression=${c2.resetExpression}, resetAnimation=${c2.resetAnimation}, elapsed=${c2.elapsedMs}ms`);

    // ========================================
    // PARTICIPANTE: emoción SIN reset de 7s
    // ========================================
    await page.waitForTimeout(500);
    console.log('[TEST] === EMOCIÓN PARTICIPANTE (sin 7s) ===');
    const part = await runParticipantEmotion();
    console.log(`[TEST] Participante → reset=${part.resetLog ?? 'NONE (correcto)'}`);

    // ========================================
    // ASSERT 1: la emoción IA se ejecutó con blend de cuerpo completo SIN Idle base
    // (Fix D: [Dance, MouthMove], NO [Idle_2, Dance, MouthMove])
    // ========================================
    const emotionBlendLogs = browserLogs.filter((l) => /SPEAKING EMOTION → blendAnimation\(\[Dance, MouthMove\]\)/.test(l));
    expect(emotionBlendLogs.length, `Debe haber 2 logs [DIAG] SPEAKING EMOTION con [Dance, MouthMove] (hay ${emotionBlendLogs.length})`).toBeGreaterThanOrEqual(2);

    // El blendQueue real durante la emoción debe ser [Dance, MouthMove] (Dance = principal)
    expect(c1.blendQueue[0], `C1: animación principal debe ser Dance (real=${c1.blendQueue[0]})`).toBe('Dance');
    expect(c2.blendQueue[0], `C2: animación principal debe ser Dance (real=${c2.blendQueue[0]})`).toBe('Dance');

    // ========================================
    // ASSERT 2: el reset apareció en AMBOS ciclos IA
    // ========================================
    expect(c1.resetLog, 'C1: debe aparecer "7s emoción terminada → setExpression(...)"').toBeTruthy();
    expect(c2.resetLog, 'C2: debe aparecer "7s emoción terminada → setExpression(...)"').toBeTruthy();

    // ========================================
    // ASSERT 3: el reset RESTAURA el estado de habla previo (hablando|hablando2),
    // NO un hardcode y NO la emoción
    // ========================================
    expect(SPEAKING_TOGGLES, `C1: reset debe restaurar un estado de habla (real=${c1.resetExpression})`).toContain(c1.resetExpression);
    expect(SPEAKING_TOGGLES, `C2: reset debe restaurar un estado de habla (real=${c2.resetExpression})`).toContain(c2.resetExpression);

    // ========================================
    // ASSERT 4: duración ~7s (no 5s, no inmediato)
    // ========================================
    expect(c1.elapsedMs, `C1: reset debe tardar ~7000ms (real=${c1.elapsedMs}ms)`).toBeGreaterThanOrEqual(6500);
    expect(c1.elapsedMs, `C1: reset no debe tardar más de 16s (real=${c1.elapsedMs}ms)`).toBeLessThan(16000);
    expect(c2.elapsedMs, `C2: reset debe tardar ~7000ms (real=${c2.elapsedMs}ms)`).toBeGreaterThanOrEqual(6500);
    expect(c2.elapsedMs, `C2: reset no debe tardar más de 16s (real=${c2.elapsedMs}ms)`).toBeLessThan(16000);

    // ========================================
    // ASSERT 5: habla normal es un estado de habla válido
    // ========================================
    expect(SPEAKING_TOGGLES, `Habla normal debe ser hablando/hablando2 (real=${normalExpr})`).toContain(normalExpr);

    // ========================================
    // ASSERT 6: la emoción del PARTICIPANTE NO arma el reset de 7s
    // (persiste hasta que el flujo cambie)
    // ========================================
    expect(part.resetLog, 'Participante: NO debe aparecer "7s emoción terminada" (la emoción persiste)').toBeUndefined();

    // ========================================
    // ASSERT 7: sin errores de página (no pantalla negra / no crash)
    // ========================================
    console.log(`[TEST] pageErrors: ${pageErrors.length}`);
    expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

    console.log('[TEST] ✅ VALIDACIÓN COMPLETA: reset de 7s SOLO para la IA + restore del estado previo + participante sin 7s.');
});
