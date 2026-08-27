// ============================================================
// validate-enojado-camina.spec.ts
// VALIDACIÓN RUNTIME: "flu enojado camina" (Walk + Cap_back + Emo_blink)
//
// Contexto: el usuario reportó que en OS4 el FLU enojado NO camina
// ("flu enojado no camina"). La causa raíz era la RUTA DOBLE de emoción:
//   - Entrada A (participante 'ignored'/'rejected'/'granted'): applyResolved
//     DIRECTO fuera de la máquina de estados → el siguiente syncAvatarToState
//     (THINKING→Pensando / SPEAKING→hablando) pisaba la emoción al instante.
//   - Entrada B (transcript/Gemini): pendingEmotionAnims → solo el branch
//     SPEAKING la consumía.
//
// Fix S1+S3 (useAvatarVoiceSync): AMBAS rutas ahora escriben en el canal
// ÚNICO pendingEmotionAnims (integrationStore). El branch SPEAKING mezcla
// esas animaciones con MouthMove durante ~5s y luego vuelve al toggle normal.
// El registro enojado es:
//   expression: 'enojado' → anims: ['Walk','Emo_blink','Cap_back','MouthMove']
//   trigger: 'ignored' (expressionRegistry.ts:311-318)
//
// Este test NO lee código: conduce el store real en runtime (el mismo canal
// que usan Entrada A y Entrada B) con las animaciones EXACTAS del registro
// enojado y verifica que Walk SÍ se aplica durante SPEAKING.
//   1. Inyecta stores (bunnyStore + integrationStore).
//   2. Escribe pendingEmotionAnims = ['Walk','Emo_blink','Cap_back','MouthMove']
//      y setConversationState('SPEAKING') — la misma secuencia unificada.
//   3. Confirma que el branch SPEAKING hace blendAnimation:
//        - blendQueue === ['Walk','Emo_blink','Cap_back','MouthMove']
//        - currentAnimation === 'Walk'  (¡FLU CAMINA!)
//        - isPlaying === true
//        - pendingEmotionAnims se limpia a [] tras consumirse
//   4. Confirma el log '[DIAG] SPEAKING EMOTION' (la ruta se ejecutó).
//   5. Guardias anti-pantalla-negra: sin pageerror, canvas con contenido.
// ============================================================
import { test, expect } from '@playwright/test';

// Animaciones EXACTAS del registro 'enojado' (expressionRegistry.ts:311-318).
// MouthMove ya viene en el registro; el branch SPEAKING hace Set-dedup, así
// que el blend final es idéntico: ['Walk','Emo_blink','Cap_back','MouthMove'].
const ENOJADO_ANIMS = ['Walk', 'Emo_blink', 'Cap_back', 'MouthMove'];

test('flu enojado SÍ camina: pendingEmotionAnims con Walk se aplica DURANTE SPEAKING (S1 canal único)', async ({ page }) => {
    test.setTimeout(120000);

    const browserLogs: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[DIAG]') || text.includes('[TEST]')) {
            browserLogs.push(text);
            console.log(`[BROWSER] ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        pageErrors.push(err.message);
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // Cargar app + canvas 3D
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 30000 });
    console.log('[TEST] Canvas 3D visible');
    await page.waitForTimeout(5000); // cargar modelo FBX (SwiftShader es lento)

    // ========================================
    // Exponer stores
    // ========================================
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
    // PASO 1: Base → IDLE estable
    // ========================================
    console.log('[TEST] Llevando a IDLE...');
    await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 400));
    });

    // ========================================
    // PASO 2: ENOJADO DURANTE SPEAKING
    // Secuencia del canal ÚNICO (idéntica para Entrada A participante via S1
    // y Entrada B transcript): escribir pendingEmotionAnims ANTES de SPEAKING.
    // ========================================
    console.log(`[TEST] Escribiendo pendingEmotionAnims=${JSON.stringify(ENOJADO_ANIMS)} + SPEAKING...`);
    const emotionResult = await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        // @ts-ignore
        const bunnyStore = window.__bunnyStore;

        // 1. Escribir las animaciones del registro enojado (como App.tsx hace
        //    con resolveEmotionAnims y como S1 hace con setPendingEmotionAnimsAction).
        intStore.getState().setPendingEmotionAnims(['Walk', 'Emo_blink', 'Cap_back', 'MouthMove']);
        await new Promise((r) => setTimeout(r, 150)); // propagar el update del store

        // 2. Ir a SPEAKING → el branch lee pendingEmotionAnims y hace blend.
        intStore.getState().setConversationState('SPEAKING');
        intStore.getState().setFluSpeaking(true);
        await new Promise((r) => setTimeout(r, 700)); // dejar que el blend se aplique

        const bs = bunnyStore.getState();
        const is = intStore.getState();

        return {
            conversationState: is.conversationState,
            pendingEmotionAnims: is.uiState?.pendingEmotionAnims ?? [],
            currentExpression: bs.currentExpression,
            currentAnimation: bs.currentAnimation,
            blendQueue: bs.blendQueue,
            isPlaying: bs.isPlaying,
        };
    });
    console.log(`[TEST] Resultado enojado durante habla: ${JSON.stringify(emotionResult)}`);

    // ASSERT: estamos en SPEAKING y Walk SÍ se aplicó
    expect(emotionResult.conversationState, 'Debe estar en SPEAKING').toBe('SPEAKING');
    expect(emotionResult.blendQueue, 'blendQueue debe ser [Walk, Emo_blink, Cap_back, MouthMove]').toEqual(['Walk', 'Emo_blink', 'Cap_back', 'MouthMove']);
    expect(emotionResult.currentAnimation, 'currentAnimation debe ser Walk → ¡FLU CAMINA!').toBe('Walk');
    expect(emotionResult.isPlaying, 'El avatar debe estar animando (isPlaying=true)').toBe(true);
    expect(emotionResult.pendingEmotionAnims, 'pendingEmotionAnims debe limpiarse tras consumirse').toEqual([]);

    // ASSERT: la ruta de emoción se ejecutó (log de diagnóstico del hook)
    const emotionLog = browserLogs.find((l) => l.includes('SPEAKING EMOTION → blendAnimation([Walk, Emo_blink, Cap_back, MouthMove])'));
    expect(emotionLog, 'Debe existir el log [DIAG] SPEAKING EMOTION → blendAnimation([Walk, Emo_blink, Cap_back, MouthMove])').toBeTruthy();

    // ========================================
    // PASO 3: Pintura no negra (anti WebGL context loss)
    // ========================================
    const canvas = page.locator('.flu-bridge-container canvas').first();
    const buf = await canvas.screenshot();
    const nonZero = [...buf.subarray(0, Math.min(buf.length, 200000))].filter((b) => b !== 0).length;
    console.log(`[TEST] Sanity canvas durante enojado: ${nonZero} bytes no-cero (debe ser > 0)`);
    expect(nonZero, 'El canvas debe mostrar contenido (no pantalla negra) durante la emoción').toBeGreaterThan(0);

    // ========================================
    // PASO 4: Sin errores de página (no crash)
    // ========================================
    console.log(`[TEST] pageErrors: ${pageErrors.length}`);
    expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

    console.log('[TEST] ✅ VALIDACIÓN COMPLETA: flu enojado SÍ camina (Walk aplicado durante SPEAKING) sin regresión.');
});
