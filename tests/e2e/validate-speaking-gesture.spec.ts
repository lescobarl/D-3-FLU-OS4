// ============================================================
// validate-speaking-gesture.spec.ts
// Valida que el avatar gesticule (mueva la boca) al hablar
// ============================================================
import { test, expect } from '@playwright/test';

test('Validar que el avatar mueve la boca al hablar', async ({ page }) => {
    test.setTimeout(120000);

    // Interceptar console.log del navegador para diagnosticar
    const browserLogs: string[] = [];
    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[DIAG]') || text.includes('[TEST]')) {
            browserLogs.push(text);
            console.log(`[BROWSER] ${text}`);
        }
    });

    await page.goto('/');
    await page.waitForSelector('.app-header', { timeout: 15000 });
    await page.waitForTimeout(3000);

    // Verificar elementos clave
    await expect(page.locator('.flu-bridge-container canvas')).toBeVisible();
    await expect(page.locator('.app-avatar-column')).toBeVisible();

    // ========================================
    // PASO 1: Exponer stores globalmente para diagnóstico
    // ========================================
    console.log('[TEST] Exponiendo stores globalmente...');
    await page.evaluate(() => {
        // Los stores de zustand ya están disponibles como módulos.
        // Los expondremos globalmente para poder accederlos desde evaluate.
        // Vite expone los módulos via import(), pero necesitamos los stores
        // que ya están cargados en el bundle.
        
        // Buscar el store en el objeto window (algunos stores se exponen)
        // Si no están expuestos, intentamos acceder via React devtools
        const root = document.getElementById('root');
        if (root) {
            // @ts-ignore
            window.__fluRoot = root;
        }
    });

    // ========================================
    // PASO 2: Verificar estado inicial del bunnyStore
    // ========================================
    console.log('[TEST] Verificando estado inicial del bunnyStore...');
    
    // Intentar acceder al store via page.evaluate
    // Los stores de zustand se importan como módulos ES, no están en window.
    // Necesitamos otra estrategia.
    
    // Estrategia: inyectar un script que importe dinámicamente los stores
    // y los exponga en window
    const storeSetup = await page.evaluate(async () => {
        try {
            // Vite HMR runtime expone los módulos
            // @ts-ignore
            if (window.__vite_hot) {
                console.log('[TEST] Vite HMR disponible');
            }
            
            // Intentar import dinámico (Vite lo resuelve)
            // @ts-ignore - ruta de módulo válida en el runtime del navegador (page.evaluate), TS no la resuelve
            const bunnyModule = await import('/src/avatar/store/bunnyStore.ts');
            // @ts-ignore - ruta de módulo válida en el runtime del navegador (page.evaluate), TS no la resuelve
            const intModule = await import('/src/store/integrationStore.ts');
            
            // @ts-ignore
            window.__bunnyStore = bunnyModule.useBunnyStore;
            // @ts-ignore
            window.__intStore = intModule.useIntegrationStore;
            
            const bunnyState = bunnyModule.useBunnyStore.getState();
            const intState = intModule.useIntegrationStore.getState();
            
            return {
                success: true,
                bunnyState: {
                    currentAnimation: bunnyState.currentAnimation,
                    currentExpression: bunnyState.currentExpression,
                    blendQueue: bunnyState.blendQueue,
                    isPlaying: bunnyState.isPlaying,
                },
                intState: {
                    conversationState: intState.conversationState,
                },
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
    
    console.log(`[TEST] Estado inicial: ${JSON.stringify(storeSetup)}`);

    // ========================================
    // PASO 3: Forzar SPEAKING vía integrationStore
    // ========================================
    console.log('[TEST] Forzando SPEAKING...');
    
    const speakResult = await page.evaluate(async () => {
        try {
            // @ts-ignore
            const intStore = window.__intStore;
            // @ts-ignore
            const bunnyStore = window.__bunnyStore;
            
            if (!intStore || !bunnyStore) {
                return { success: false, reason: 'stores not found' };
            }
            
            // 1. Ir a IDLE primero
            intStore.getState().setConversationState('IDLE');
            await new Promise(r => setTimeout(r, 100));
            
            // 2. Ir a SPEAKING
            intStore.getState().setConversationState('SPEAKING');
            intStore.getState().setFluSpeaking(true);
            await new Promise(r => setTimeout(r, 500));
            
            // 3. Verificar estado del bunnyStore
            const bunnyState = bunnyStore.getState();
            
            return {
                success: true,
                bunnyState: {
                    currentAnimation: bunnyState.currentAnimation,
                    currentExpression: bunnyState.currentExpression,
                    blendQueue: bunnyState.blendQueue,
                    isPlaying: bunnyState.isPlaying,
                },
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
    
    console.log(`[TEST] Estado después de SPEAKING: ${JSON.stringify(speakResult)}`);

    // ========================================
    // PASO 4: Verificar que MouthMove está en blendQueue
    // ========================================
    if (speakResult.success) {
        const bq = speakResult.bunnyState?.blendQueue || [];
        const hasMouthMove = bq.includes('MouthMove');
        const hasIdle2 = bq.includes('Idle_2');
        
        console.log(`[TEST] blendQueue: [${bq.join(', ')}]`);
        console.log(`[TEST] hasMouthMove: ${hasMouthMove}, hasIdle2: ${hasIdle2}`);
        
        expect(hasMouthMove).toBeTruthy();
        expect(hasIdle2).toBeTruthy();
        expect(speakResult.bunnyState?.currentAnimation).toBe('Idle_2');
    } else {
        // Si los stores no se pudieron inyectar (p. ej. fallo del servidor de
        // desarrollo), el test NO puede validar el gesto: fallar explícitamente
        // en lugar de pasar en falso saltándose las aserciones de MouthMove.
        console.log(`[TEST] No se pudieron inyectar los stores: ${JSON.stringify(storeSetup)}`);
        throw new Error(`No se pudieron inyectar los stores para validar MouthMove: ${JSON.stringify(storeSetup)}`);
    }

    // ========================================
    // PASO 5: Tomar screenshot
    // ========================================
    await page.screenshot({ path: 'test-results/speaking-gesture-final.png', fullPage: true });
    
    // Verificar canvas
    const canvasBox = await page.locator('.flu-bridge-container canvas').boundingBox();
    console.log(`[TEST] Canvas 3D: ${canvasBox?.width}x${canvasBox?.height}`);
    expect(canvasBox).not.toBeNull();

    console.log('[TEST] ✅ Validación completada');
});
