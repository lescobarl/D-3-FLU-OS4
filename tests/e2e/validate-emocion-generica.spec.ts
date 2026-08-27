// ============================================================
// validate-emocion-generica.spec.ts
// VALIDACIÓN RUNTIME: CUALQUIER emoción del usuario (source='ai')
// se mezcla durante el habla y se restaura a los ~7s.
//
// El mecanismo NO es específico de 'baila': es genérico y data-driven.
// Cualquier emotionLabel → EXPRESSION_MAP → setPendingEmotionAnims(anims,'ai')
// → SPEAKING → blendAnimation([...]) → scheduleEmotionReset() (7s) y, si la
// emoción resuelve a una acción de cuerpo completo (ACTION_ANIMS), además
// scheduleSustainedAction() (8s) que la mantiene viva tras SPEAKING→LISTENING.
//
// Este test conduce el store real (igual que validate-reset-emocion-7s) pero
// RECORRE VARIAS EMOCIONES representativas de ambos tipos:
//   - Cuerpo completo (→ 8s sostenido): baila(Dance), enojado(Walk), yes!(Jump_in_place)
//   - Pose/facial (→ base Idle + emoción + MouthMove, reset 7s): triste, sorprendido, se_me_chispotio
//
// Para cada caso se verifica:
//   1. El blend aplicado contiene las animaciones de la emoción (y la base Idle en pose).
//   2. El reset '7s emoción terminada → setExpression(hablando|hablando2)' aparece (source='ai').
//   3. Sin errores de página.
// Además se valida el sostenimiento de 8s con 'baila' (cuerpo completo) tras LISTENING.
// ============================================================
import { test, expect } from '@playwright/test';

interface EmotionCase {
    name: string;
    anims: string[];
    expectPrimary: string; // animación que debe quedar PRIMERA en el blend (cuerpo completo) o '' si es pose
    isFullBody: boolean;
}

const CASES: EmotionCase[] = [
    // --- Cuerpo completo (ACTION_ANIMS) → 8s sostenido, sin base Idle ---
    { name: 'baila', anims: ['Dance'], expectPrimary: 'Dance', isFullBody: true },
    { name: 'enojado', anims: ['Walk', 'Emo_blink', 'Cap_back', 'MouthMove'], expectPrimary: 'Walk', isFullBody: true },
    { name: 'yes!', anims: ['Jump_in_place'], expectPrimary: 'Jump_in_place', isFullBody: true },
    // --- Pose/facial → base Idle + emoción + MouthMove, reset 7s ---
    { name: 'triste', anims: ['Emo_neutral', 'Cap_front'], expectPrimary: '', isFullBody: false },
    { name: 'sorprendido', anims: ['Emo_neutral', 'Cap_back'], expectPrimary: '', isFullBody: false },
    { name: 'se_me_chispotio', anims: ['Emo_blink', 'MouthMove'], expectPrimary: '', isFullBody: false },
];

const SPEAKING_TOGGLES = ['hablando', 'hablando2'];

test('FUNCIONAL: cualquier emoción (source=ai) se mezcla durante el habla y se restaura a los ~7s; acciones de cuerpo completo se sostienen 8s', async ({ page }) => {
    test.setTimeout(240000);

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
    // Helper: ir a IDLE estable (cancela timers pendientes)
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
    // Helper: un ciclo de emoción genérica (source='ai')
    // ========================================
    async function runEmotionCase(c: EmotionCase): Promise<{
        blendQueue: (string | null)[];
        resetLog: string | undefined;
        resetExpression: string;
        elapsedMs: number;
    }> {
        await goIdle();
        const startMs = Date.now();
        const logStart = browserLogs.length;

        const blendQueue = await page.evaluate(async ({ anims }) => {
            // @ts-ignore
            const intStore = window.__intStore;
            // @ts-ignore
            const bunnyStore = window.__bunnyStore;
            intStore.getState().setPendingEmotionAnims(anims, 'ai');
            await new Promise((r) => setTimeout(r, 150)); // propagar el update del store
            intStore.getState().setConversationState('SPEAKING');
            intStore.getState().setFluSpeaking(true);
            await new Promise((r) => setTimeout(r, 700)); // dejar que el blend se aplique
            return bunnyStore.getState().blendQueue ?? [];
        }, { anims: c.anims });
        console.log(`[TEST] [${c.name}] blendQueue durante emoción = [${blendQueue.join(', ')}]`);

        // Esperar el reset de 7s de ESTE ciclo (source='ai')
        const deadline = Date.now() + 12000;
        let resetLog: string | undefined;
        while (Date.now() < deadline) {
            resetLog = browserLogs.slice(logStart).find((l) => l.includes('7s emoción terminada →'));
            if (resetLog) break;
            await page.waitForTimeout(200);
        }
        const elapsedMs = Date.now() - startMs;
        const m = resetLog?.match(/setExpression\(([^)]+)\)/);
        const resetExpression = m ? m[1].replace(/"/g, '') : '(no log)';
        console.log(`[TEST] [${c.name}] reset=${resetLog ?? '(NO APARECIÓ en 12s)'} elapsed=${elapsedMs}ms restore=${resetExpression}`);
        return { blendQueue, resetLog, resetExpression, elapsedMs };
    }

    const results: Record<string, Awaited<ReturnType<typeof runEmotionCase>>> = {};

    // ========================================
    // Recorrer TODAS las emociones representativas
    // ========================================
    for (const c of CASES) {
        console.log(`[TEST] === EMOCIÓN: ${c.name} (${c.isFullBody ? 'cuerpo completo' : 'pose'}) ===`);
        results[c.name] = await runEmotionCase(c);
    }

    // ========================================
    // Sostenimiento de 8s (cuerpo completo): baila debe seguir vivo tras LISTENING
    // ========================================
    console.log('[TEST] === SOSTENIMIENTO 8s (baila) ===');
    await goIdle();
    const sustainStart = browserLogs.length;
    const dancePersists = await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        // @ts-ignore
        const bunnyStore = window.__bunnyStore;
        intStore.getState().setPendingEmotionAnims(['Dance'], 'ai');
        await new Promise((r) => setTimeout(r, 150));
        intStore.getState().setConversationState('SPEAKING');
        intStore.getState().setFluSpeaking(true);
        await new Promise((r) => setTimeout(r, 900)); // blend aplicado
        const duringSpeaking = bunnyStore.getState().blendQueue ?? [];
        // Pasar a LISTENING (termina la voz) — la acción debe SOSTENERSE (8s)
        intStore.getState().setConversationState('LISTENING');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 600));
        const duringListening = bunnyStore.getState().blendQueue ?? [];
        return { duringSpeaking, duringListening };
    });
    console.log(`[TEST] baila duringSpeaking=[${dancePersists.duringSpeaking.join(', ')}] duringListening=[${dancePersists.duringListening.join(', ')}]`);

    const sustainDeadline = Date.now() + 12000;
    let sustainLog: string | undefined;
    while (Date.now() < sustainDeadline) {
        sustainLog = browserLogs.slice(sustainStart).find((l) => l.includes('Acción sostenida terminada (8s)'));
        if (sustainLog) break;
        await page.waitForTimeout(200);
    }
    console.log(`[TEST] baila sustainLog=${sustainLog ?? '(NO APARECIÓ)'}`);

    // ========================================
    // ASSERT 1: TODAS las emociones aplicaron su blend (genérico)
    // ========================================
    for (const c of CASES) {
        const r = results[c.name];
        expect(r.blendQueue.length, `[${c.name}] el blend no debe estar vacío`).toBeGreaterThan(0);
        for (const anim of c.anims) {
            expect(r.blendQueue, `[${c.name}] debe contener la animación ${anim}`).toContain(anim);
        }
        if (c.isFullBody) {
            // Acción de cuerpo completo: sin diluir con base Idle — queda PRIMERA
            expect(r.blendQueue[0], `[${c.name}] cuerpo completo: animación principal debe ser ${c.expectPrimary} (real=${r.blendQueue[0]})`).toBe(c.expectPrimary);
        } else {
            // Pose: la base Idle de habla (Idle_2/Idle_3) da movimiento al cuerpo
            expect(r.blendQueue.some((a) => a === 'Idle_2' || a === 'Idle_3'), `[${c.name}] pose: debe incluir base Idle_2/Idle_3`).toBe(true);
        }
    }

    // ========================================
    // ASSERT 2: TODAS las emociones (source='ai') arman el reset de 7s
    // ========================================
    for (const c of CASES) {
        const r = results[c.name];
        expect(r.resetLog, `[${c.name}] debe aparecer "7s emoción terminada → setExpression(...)"`).toBeTruthy();
        expect(SPEAKING_TOGGLES, `[${c.name}] restore debe ser hablando/hablando2 (real=${r.resetExpression})`).toContain(r.resetExpression);
        expect(r.elapsedMs, `[${c.name}] reset debe tardar ~7000ms (real=${r.elapsedMs}ms)`).toBeGreaterThanOrEqual(6500);
        expect(r.elapsedMs, `[${c.name}] reset no debe tardar más de 12s (real=${r.elapsedMs}ms)`).toBeLessThan(12000);
    }

    // ========================================
    // ASSERT 3: baila (cuerpo completo) se SOSTIENE 8s tras LISTENING
    // ========================================
    expect(dancePersists.duringSpeaking, 'baila: durante SPEAKING el blend debe contener Dance').toContain('Dance');
    expect(dancePersists.duringListening, 'baila: tras SPEAKING→LISTENING Dance debe SOSTENERSE (8s), no morir a los ~2s').toContain('Dance');
    expect(sustainLog, 'baila: debe aparecer "Acción sostenida terminada (8s)"').toBeTruthy();

    // ========================================
    // ASSERT 4: sin errores de página
    // ========================================
    console.log(`[TEST] pageErrors: ${pageErrors.length}`);
    expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

    console.log('[TEST] ✅ VALIDACIÓN GENÉRICA COMPLETA: cualquier emoción (ai) se mezcla + reset 7s + restore; cuerpo completo se sostiene 8s.');
});
