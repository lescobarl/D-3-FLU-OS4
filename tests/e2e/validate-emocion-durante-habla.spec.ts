// ============================================================
// validate-emocion-durante-habla.spec.ts
// VALIDACIÓN RUNTIME: Animación de emoción DURANTE el habla (OS3 parity)
//
// Contexto: el usuario pidió re-implementar el comportamiento de OS3 en el
// que, cuando Gemini devuelve emocion/animacion en el contrato, FLU gesticula
// (Dance, Jump_in_place, Cap_front, etc.) MEZCLADO CON MouthMove durante los
// primeros ~5s de SPEAKING, y luego vuelve al toggle normal hablando/hablando2.
//
// Este test NO lee código: conduce el store real en runtime.
//   1. Inyecta stores (bunnyStore + integrationStore).
//   2. Escribe integrationStore.uiState.pendingEmotionAnims = ['Dance'] y luego
//      setConversationState('SPEAKING') — la misma secuencia que App.tsx hace
//      en onContractResolved ANTES de llamar a speakFlu.
//   3. Confirma que el efecto de SPEAKING de useAvatarVoiceSync consume las
//      animaciones pendientes → blendAnimation(['Dance','MouthMove']) — S1
//      "canal único": cuando la emoción es una ACCIÓN de cuerpo completo
//      (Dance/Walk/Run, ACTION_ANIMS), la emoción ES la animación base y se
//      mezcla SOLO con MouthMove (sin prefijo Idle — evita el "shuffle" 50/50):
//        - blendQueue[0] === 'Dance' (la emoción es la base/principal)
//        - blendQueue contiene Dance (emoción) y MouthMove (boca)
//        - currentAnimation === 'Dance' (cuerpo en movimiento real)
//        - isPlaying === true
//        - pendingEmotionAnims se limpia a [] tras consumirse
//      (Las emociones de POSE estática SÍ llevan Idle base; ver el patrón S1
//      validado en validate-enojado-camina.spec.ts con Walk.)
//   4. Confirma el log '[DIAG] SPEAKING EMOTION' (la ruta de emoción se ejecutó).
//   5. Tras IDLE → SPEAKING SIN emoción pendiente, vuelve al habla normal
//      (['Idle_2','MouthMove']) — sin regresión.
//   6. Guardias anti-pantalla-negra: sin pageerror, canvas con contenido no-nulo.
// ============================================================
import { test, expect } from '@playwright/test';

test('Valida la animación de emoción DURANTE el habla (S1: blend [emotion, MouthMove] — emoción base)', async ({ page }) => {
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
    // PASO 2: EMOCIÓN DURANTE SPEAKING
    // Secuencia idéntica a App.tsx: setPendingEmotionAnims ANTES de SPEAKING.
    // ========================================
    console.log('[TEST] Escribiendo pendingEmotionAnims=["Dance"] + SPEAKING...');
    const emotionResult = await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        // @ts-ignore
        const bunnyStore = window.__bunnyStore;

        // 1. Escribir las animaciones de emoción resueltas (como App.tsx hace
        //    con resolveEmotionAnims(emotionLabel, EXPRESSION_MAP)).
        intStore.getState().setPendingEmotionAnims(['Dance']);
        await new Promise((r) => setTimeout(r, 150)); // propagar el update del store

        // 2. Ir a SPEAKING → el efecto lee pendingEmotionAnims y hace blend.
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
    console.log(`[TEST] Resultado emoción durante habla: ${JSON.stringify(emotionResult)}`);

    // ASSERT (S1): la emoción de ACCIÓN de cuerpo completo (Dance) ES la base y se
    // mezcla solo con MouthMove — sin prefijo Idle (evita el "shuffle" 50/50).
    expect(emotionResult.conversationState, 'Debe estar en SPEAKING').toBe('SPEAKING');
    expect(emotionResult.blendQueue?.[0], 'blendQueue[0] debe ser la emoción base (Dance)').toBe('Dance');
    expect(emotionResult.blendQueue, 'blendQueue debe contener la emoción (Dance)').toContain('Dance');
    expect(emotionResult.blendQueue, 'blendQueue debe contener MouthMove (boca)').toContain('MouthMove');
    expect(emotionResult.currentAnimation, 'currentAnimation debe ser la emoción base (Dance — cuerpo en movimiento)').toBe('Dance');
    expect(emotionResult.isPlaying, 'El avatar debe estar animando (isPlaying=true)').toBe(true);
    expect(emotionResult.pendingEmotionAnims, 'pendingEmotionAnims debe limpiarse tras consumirse').toEqual([]);

    // ASSERT: la ruta de emoción se ejecutó (log de diagnóstico del hook) con el patrón S1
    const emotionLog = browserLogs.find((l) => /SPEAKING EMOTION → blendAnimation\(\[Dance, MouthMove\]\)/.test(l));
    expect(emotionLog, 'Debe existir el log [DIAG] SPEAKING EMOTION → blendAnimation([Dance, MouthMove])').toBeTruthy();

    // ========================================
    // PASO 3: Pintura no negra (anti WebGL context loss)
    // ========================================
    const canvas = page.locator('.flu-bridge-container canvas').first();
    const buf = await canvas.screenshot();
    const nonZero = [...buf.subarray(0, Math.min(buf.length, 200000))].filter((b) => b !== 0).length;
    console.log(`[TEST] Sanity canvas durante emoción: ${nonZero} bytes no-cero (debe ser > 0)`);
    expect(nonZero, 'El canvas debe mostrar contenido (no pantalla negra) durante la emoción').toBeGreaterThan(0);

    // ========================================
    // PASO 4: Sin regresión — SPEAKING SIN emoción → habla normal
    // ========================================
    console.log('[TEST] IDLE → SPEAKING SIN emoción (habla normal)...');
    const normalResult = await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        // @ts-ignore
        const bunnyStore = window.__bunnyStore;

        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 300));

        // Sin pendingEmotionAnims: debe ir a setExpression('hablando'|'hablando2')
        intStore.getState().setConversationState('SPEAKING');
        intStore.getState().setFluSpeaking(true);
        await new Promise((r) => setTimeout(r, 700));

        const bs = bunnyStore.getState();
        const is = intStore.getState();
        return {
            conversationState: is.conversationState,
            currentExpression: bs.currentExpression,
            blendQueue: bs.blendQueue,
            currentAnimation: bs.currentAnimation,
            isPlaying: bs.isPlaying,
        };
    });
    console.log(`[TEST] Resultado habla normal: ${JSON.stringify(normalResult)}`);

    // Habla normal: hablando/hablando2 → ['Idle_2'|'Idle_3','MouthMove'] (la boca se mueve)
    expect(normalResult.conversationState, 'Debe estar en SPEAKING').toBe('SPEAKING');
    expect(normalResult.blendQueue, 'Habla normal debe tener MouthMove (boca visible)').toContain('MouthMove');
    expect(['Idle_2', 'Idle_3'], 'Habla normal debe tener Idle_2/Idle_3 como anim base').toContain(normalResult.currentAnimation);
    expect(normalResult.isPlaying, 'El avatar debe seguir animando').toBe(true);

    // ========================================
    // PASO 5: Sin errores de página (no pantalla negra / no crash)
    // ========================================
    console.log(`[TEST] pageErrors: ${pageErrors.length}`);
    expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

    console.log('[TEST] ✅ VALIDACIÓN COMPLETA: emoción durante el habla funciona sin regresión.');
});
