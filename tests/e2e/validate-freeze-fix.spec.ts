// ============================================================
// validate-freeze-fix.spec.ts
// Valida la corrección del CONGELAMIENTO del avatar al terminar
// de hablar ("al terminar de leer se congela, despues se mueve
// y se vuelve a congelar").
//
// Escenario que causaba el bug:
//   Transiciones rápidas SPEAKING→IDLE→SPEAKING→IDLE... que en la
//   versión anterior hacían teardown completo (stopAllAction +
//   remoción de huesos + recarga/rebuild de acciones) en CADA
//   transición, bloqueando el main thread → frames congelados.
//
// La corrección (gestión DIFERENCIAL de acciones/huesos):
//   - Los huesos estáticos IK/FK se añaden UNA sola vez y persisten.
//   - Las acciones se REUTILIZAN si ya existen; solo se hace
//     fadeOut+stop de las animaciones que SALEN del set.
//   - Los clips FBX permanecen cacheados → sin recarga de red.
//
// Qué valida este test (headless-tolerant):
//   1. SIN CHURN de recargas FBX: a lo sumo UNA carga de un clip nuevo en la
//      fase rápida (la primera vez que aparece una variante de animación no
//      pre-cargada, p. ej. Idle_3). El churn del bug era ~1 MISS por ciclo
//      (re-descarga en CADA transición) → bloqueo del main thread.
//   2. Reentrada exitosa a animaciones ya existentes (Cache HIT > 0) y reuso
//      dominante (Cache HIT > Cache MISS).
//   3. Sin congelamiento duro: ningún gap de render > 1000ms durante
//      la fase de transiciones rápidas (los gaps 200-500ms pueden
//      aparecer por el render por software SwiftShader en headless).
//   4. blendQueue coherente y sin errores de página.
// ============================================================
import { test, expect } from '@playwright/test';

test('Valida que el avatar NO se congela al terminar de hablar (transiciones rápidas)', async ({ page }) => {
    test.setTimeout(150000);

    // ========================================
    // Interceptar logs del navegador para contar
    // recargas de FBX vs reusos de cache
    // ========================================
    let cacheMiss = 0;
    let cacheHit = 0;
    let synthetic = 0;
    const browserLogs: string[] = [];

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[DIAG BunnyViewer] Cache MISS')) cacheMiss++;
        if (text.includes('[DIAG BunnyViewer] Cache HIT')) cacheHit++;
        if (text.includes('Sintético')) synthetic++;
        // OJO: '[DIAG' (sin corchete de cierre) captura TAMBIÉN los logs del
        // store de la app ('[DIAG bunnyStore] ...'), que son la evidencia real
        // del estado interno del avatar. El filtro '[DIAG]' exacto los perdía.
        if (text.includes('[DIAG') || text.includes('[TEST]')) {
            browserLogs.push(text);
            console.log(`[BROWSER] ${text}`);
        }
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
        pageErrors.push(err.message);
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // Monitor de frames (gap de render > 200ms = congelamiento)
    // Inyectado ANTES de que cargue cualquier script de la app
    // ========================================
    await page.addInitScript(() => {
        // @ts-ignore
        window.__frameMonitor = {
            phase: 'init',
            gaps: [] as Array<{ delta: number; ts: number; phase: string }>,
            maxGap: 0,
            total: 0,
            lastTs: 0,
        };
        let lastTs = 0;
        const origRAF = window.requestAnimationFrame.bind(window);
        // @ts-ignore
        window.requestAnimationFrame = (cb: FrameRequestCallback) =>
            origRAF((ts: number) => {
                const mon = (window as any).__frameMonitor;
                if (lastTs) {
                    const delta = ts - lastTs;
                    mon.total++;
                    if (delta > 200) {
                        mon.gaps.push({ delta, ts, phase: mon.phase });
                    }
                    if (delta > mon.maxGap) mon.maxGap = delta;
                }
                lastTs = ts;
                return cb(ts);
            });
    });

    // ========================================
    // Cargar la app y esperar el canvas 3D
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 30000 });
    console.log('[TEST] Canvas 3D visible');
    await page.waitForTimeout(4000); // dejar que cargue el modelo

    // ========================================
    // Exponer stores globalmente (mismo patrón que
    // validate-speaking-gesture.spec.ts)
    // ========================================
    const storeSetup = await page.evaluate(async () => {
        try {
            // @ts-ignore - ruta válida en el runtime del navegador
            const bunnyModule = await import('/src/avatar/store/bunnyStore.ts');
            // @ts-ignore - ruta válida en el runtime del navegador
            const intModule = await import('/src/store/integrationStore.ts');
            // @ts-ignore
            window.__bunnyStore = bunnyModule.useBunnyStore;
            // @ts-ignore
            window.__intStore = intModule.useIntegrationStore;
            const bs = bunnyModule.useBunnyStore.getState();
            const is = intModule.useIntegrationStore.getState();
            return {
                success: true,
                bunny: { currentAnimation: bs.currentAnimation, blendQueue: bs.blendQueue, isPlaying: bs.isPlaying },
                int: { conversationState: is.conversationState },
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
    console.log(`[TEST] Stores: ${JSON.stringify(storeSetup)}`);
    if (!storeSetup.success) {
        throw new Error(`No se pudieron inyectar los stores: ${JSON.stringify(storeSetup)}`);
    }

    // ========================================
    // WARM-UP: SPEAKING (carga clips FBX en cache) → IDLE
    // ========================================
    console.log('[TEST] Warm-up: SPEAKING (carga de clips en cache)...');
    const warmUp = await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        intStore.getState().setConversationState('IDLE');
        await new Promise((r) => setTimeout(r, 150));
        intStore.getState().setConversationState('SPEAKING');
        intStore.getState().setFluSpeaking(true);
        await new Promise((r) => setTimeout(r, 2500));
        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 800));
        return { done: true };
    });
    await page.waitForTimeout(1500); // asegurar que callbacks FBX del warm-up terminen

    const warmUpMiss = cacheMiss;
    const warmUpMonitor = await page.evaluate(() => {
        const m = (window as any).__frameMonitor;
        return { maxGap: m.maxGap, total: m.total, gaps: m.gaps.length };
    });
    console.log(`[TEST] Warm-up: Cache MISS=${warmUpMiss}, maxGap=${warmUpMonitor.maxGap}ms, gaps>200ms=${warmUpMonitor.gaps}`);
    console.log('[TEST] Warm-up completado. Reseteando contadores para fase rápida...');

    // Reset de contadores + monitor para la fase rápida
    cacheMiss = 0;
    cacheHit = 0;
    synthetic = 0;
    await page.evaluate(() => {
        const mon = (window as any).__frameMonitor;
        mon.phase = 'rapid';
        mon.gaps = [];
        mon.maxGap = 0;
        mon.total = 0;
        mon.lastTs = 0;
    });

    // ========================================
    // FASE RÁPIDA: 6 ciclos SPEAKING→IDLE
    // (el escenario exacto del bug: "al terminar de leer se
    // congela, despues se mueve y se vuelve a congelar")
    // ========================================
    console.log('[TEST] Fase rápida: 6 ciclos SPEAKING→IDLE...');
    const rapidResult = await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        // @ts-ignore
        const bunnyStore = window.__bunnyStore;
        if (!intStore || !bunnyStore) return { success: false, reason: 'stores not found' };

        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const states: Array<{ phase: string; blendQueue: string[]; currentAnimation: string }> = [];

        for (let i = 0; i < 6; i++) {
            intStore.getState().setConversationState('SPEAKING');
            intStore.getState().setFluSpeaking(true);
            await wait(400);
            const bs = bunnyStore.getState();
            states.push({ phase: 'SPEAKING', blendQueue: bs.blendQueue || [], currentAnimation: bs.currentAnimation || '' });

            intStore.getState().setConversationState('IDLE');
            intStore.getState().setFluSpeaking(false);
            await wait(400);
            const bs2 = bunnyStore.getState();
            states.push({ phase: 'IDLE', blendQueue: bs2.blendQueue || [], currentAnimation: bs2.currentAnimation || '' });
        }

        const final = bunnyStore.getState();
        return {
            success: true,
            states,
            final: {
                currentAnimation: final.currentAnimation,
                currentExpression: final.currentExpression,
                blendQueue: final.blendQueue,
                isPlaying: final.isPlaying,
            },
        };
    });

    // Recoger gaps de la fase rápida
    const rapidMonitor = await page.evaluate(() => {
        const m = (window as any).__frameMonitor;
        return { gaps: m.gaps, maxGap: m.maxGap, total: m.total };
    });

    console.log('[TEST] Fase rápida: Cache MISS=' + cacheMiss + ', Cache HIT=' + cacheHit + ', Sintéticos=' + synthetic);
    console.log(`[TEST] Fase rápida: maxGap=${rapidMonitor.maxGap}ms, total frames=${rapidMonitor.total}, gaps>200ms=${rapidMonitor.gaps.length}`);
    rapidMonitor.gaps.forEach((g: { delta: number; phase: string }) =>
        console.log(`[TEST]   GAP ${g.delta.toFixed(0)}ms (${g.phase})`)
    );
    console.log(`[TEST] Estado final: ${JSON.stringify(rapidResult.final)}`);
    console.log('[TEST] Transiciones por fase:');
    rapidResult.states?.forEach((s, idx) =>
        console.log(`[TEST]   [${idx}] ${s.phase}: blendQueue=${JSON.stringify(s.blendQueue)} currentAnimation=${s.currentAnimation}`)
    );
    const diagLines = browserLogs.filter((l: string) => l.includes('[DIAG') || l.includes('syncAvatarToState') || l.includes('setExpression') || l.includes('blendAnimation'));
    console.log(`[TEST] DIAG browser logs (${diagLines.length}):`);
    diagLines.slice(-40).forEach((l: string) => console.log('[TEST]   ' + l));

    const hardFreezes = rapidMonitor.gaps.filter((g: { delta: number }) => g.delta > 1000);
    console.log(`[TEST] Congelamientos duros (>1000ms) en fase rápida: ${hardFreezes.length}`);
    console.log(`[TEST] Errores de página: ${pageErrors.length}`);
    if (pageErrors.length > 0) console.log(`[TEST]   ${pageErrors.join(' | ')}`);

    // ========================================
    // ASERCIONES
    // ========================================
    expect(rapidResult.success).toBeTruthy();

    // 1. SIN CHURN de recargas FBX durante transiciones rápidas. El bug
    //    original re-descargaba/re-procesaba FBX en CADA transición (≈1 MISS
    //    por ciclo → bloqueo del main thread). Con la gestión diferencial, a
    //    lo sumo se carga UNA vez una variante nueva que no estaba en cache
    //    (p. ej. Idle_3 la primera vez que aparece), pero NUNCA por ciclo.
    //    Umbral: ≤1 MISS total y reuso dominante (HIT > MISS).
    expect(cacheMiss, `Se detectaron ${cacheMiss} recargas de FBX durante transiciones rápidas (churn; máximo esperado 1)`).toBeLessThanOrEqual(1);
    expect(cacheMiss, `El reuso de cache debe dominar: Cache HIT=${cacheHit} debe ser mayor que Cache MISS=${cacheMiss}`).toBeLessThan(cacheHit);

    // 2. Reentrada exitosa a animaciones ya cargadas (reuso diferencial).
    expect(cacheHit, 'Se esperaba al menos una reentrada a cache (Cache HIT > 0) durante transiciones rápidas').toBeGreaterThan(0);

    // 3. Sin congelamiento duro: ningún gap de render > 1000ms durante la fase
    //    de transiciones rápidas (umbral muy por encima del jank de SwiftShader).
    expect(
        hardFreezes.length,
        `Se detectaron ${hardFreezes.length} congelamientos duros (>1000ms) durante transiciones rápidas. maxGap=${rapidMonitor.maxGap}ms`
    ).toBe(0);

    // 4. Invariante real de la app: tras cada transición a IDLE el store de la
    //    app registra setExpression("atencion") → EXPRESSION_MAP=["Idle_2"], es
    //    decir blendQueue=["Idle_2"] (nunca vacío) y currentAnimation=Idle_2.
    //    La evidencia se lee de los logs PROPIOS del store (la instancia real
    //    que usa la app), no de una instancia desacoplada expuesta al test
    //    (window.__bunnyStore queda como copia separada del módulo en Vite dev).
    const storeLogs = browserLogs.filter((l: string) => l.includes('[DIAG bunnyStore]'));
    const storeIdleLog = storeLogs.find((l: string) =>
        l.includes('[DIAG bunnyStore] setExpression("atencion")')
    );
    expect(
        storeLogs.length,
        'El store real de la app debe registrar operaciones ([DIAG bunnyStore]) durante el ciclo de voz'
    ).toBeGreaterThan(0);
    expect(
        storeIdleLog,
        'El store real de la app debe registrar setExpression("atencion") → blendQueue=["Idle_2"] tras IDLE. ' +
        `Logs del store capturados: ${JSON.stringify(storeLogs.slice(-6))}`
    ).toBeTruthy();
    expect(storeIdleLog || '').toContain('EXPRESSION_MAP=["Idle_2"]');

    // 5. Sin errores de página
    expect(pageErrors).toEqual([]);

    await page.screenshot({ path: 'test-results/freeze-fix-final.png', fullPage: true });
    console.log('[TEST] ✅ Validación de no-congelamiento completada');
});
