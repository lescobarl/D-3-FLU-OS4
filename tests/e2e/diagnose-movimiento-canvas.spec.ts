// ============================================================
// diagnose-movimiento-canvas.spec.ts
// DIAGNÓSTICO: ¿por qué validate-movimiento-despues-de-hablar
// ve 0/6 pares con cambio (PNG idénticos) aunque el store reporta
// que la micro Cap_front/chispas se disparó a los 1500ms?
//
// Hipótesis:
//   (a) Artefacto de render headless (SwiftShader): el canvas NO
//       repinta entre screenshots de Playwright, aunque el bucle
//       requestAnimationFrame de R3F siga vivo y produzca frames.
//   (b) Freeze real: el bucle rAF está detenido / el mixer no avanza.
//
// Este spec distingue ambas midiendo TRES señales independientes:
//   1. rAF liveness  : nº de callbacks de requestAnimationFrame en 1s.
//   2. WebGL backbuffer: diff de píxeles entre 2 lecturas (preserveDrawingBuffer=true).
//   3. PNG screenshots : paridad de bytes (lo que mide el test original).
// ============================================================
import { test, expect } from '@playwright/test';

test('Diagnóstico: rAF liveness + WebGL backbuffer diff vs PNG screenshots', async ({ page }) => {
    test.setTimeout(180000);

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const appLogs: string[] = [];
    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[DIAG BunnyViewer]') || text.includes('[BunnyViewer]')) {
            appLogs.push(text);
        }
    });

    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 30000 });
    await page.waitForTimeout(6000); // cargar modelo FBX (SwiftShader es lento)

    // Exponer stores
    const storeSetup = await page.evaluate(async () => {
        try {
            // @ts-ignore
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
    expect(storeSetup.success, JSON.stringify(storeSetup)).toBeTruthy();

    // SPEAKING 2.5s → IDLE (igual que el test original)
    await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        // @ts-ignore
        const bunnyStore = window.__bunnyStore;
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        intStore.getState().setConversationState('IDLE');
        await wait(200);
        intStore.getState().setConversationState('SPEAKING');
        intStore.getState().setFluSpeaking(true);
        await wait(2500);
        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await wait(1500);
    });

    const canvas = page.locator('.flu-bridge-container canvas').first();
    const canvasInfo = await canvas.evaluate((el: HTMLCanvasElement) => ({
        w: el.width,
        h: el.height,
        cw: el.clientWidth,
        ch: el.clientHeight,
        hasWebGL2: !!el.getContext('webgl2'),
        hasWebGL1: !!el.getContext('webgl'),
    }));
    console.log(`[DIAG] canvas info: ${JSON.stringify(canvasInfo)}`);

    // ============ 1. rAF liveness ============
    const rafCount = await page.evaluate(() =>
        new Promise<number>((resolve) => {
            let n = 0;
            const t0 = performance.now();
            const tick = () => {
                n++;
                if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
                else resolve(n);
            };
            requestAnimationFrame(tick);
        })
    );
    console.log(`[DIAG] rAF callbacks en 1s: ${rafCount} (esperado ~60 si el bucle R3F está vivo)`);

    // ============ 2. WebGL backbuffer diff ============
    const glDiff = await canvas.evaluate(async (el: HTMLCanvasElement) => {
        // @ts-ignore
        const gl = el.getContext('webgl2') || el.getContext('webgl');
        if (!gl) return { ok: false, reason: 'no-webgl-context' };
        // @ts-ignore
        const w = gl.drawingBufferWidth || el.width;
        // @ts-ignore
        const h = gl.drawingBufferHeight || el.height;
        const readPixels = (): Uint8Array => {
            // @ts-ignore
            const buf = new Uint8Array(w * h * 4);
            // @ts-ignore
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            return buf;
        };
        const a = readPixels();
        await new Promise((r) => setTimeout(r, 800));
        const b = readPixels();
        let diff = 0;
        const step = 4; // muestreo: 1 de cada 4 píxeles para no recorrer 2M en el test
        for (let i = 0; i < a.length; i += step * 4) {
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) diff++;
        }
        return { ok: true, w, h, sampled: Math.floor(a.length / (step * 4)), diffPixels: diff };
    });
    console.log(`[DIAG] WebGL backbuffer diff: ${JSON.stringify(glDiff)}`);

    // ============ 2b. EXPERIMENTO DECISIVO: toggle de visibilidad ============
    // Si el backbuffer cambia al alternar la visibilidad de un componente
    // (cambio que NO depende del mixer de animación) pero NO cambia durante
    // IDLE continuo → el render loop funciona on-demand pero el mixer no
    // avanza la animación en headless. Si NI SIQUIERA el toggle produce diff
    // → el headless nunca presenta frames (artefacto de entorno SwiftShader).
    const decisive = await canvas.evaluate(async (el: HTMLCanvasElement) => {
        // @ts-ignore
        const gl = el.getContext('webgl2') || el.getContext('webgl');
        if (!gl) return { ok: false, reason: 'no-webgl-context' };
        // @ts-ignore
        const w = gl.drawingBufferWidth || el.width;
        // @ts-ignore
        const h = gl.drawingBufferHeight || el.height;
        const read = (): Uint8Array => {
            // @ts-ignore
            const buf = new Uint8Array(w * h * 4);
            // @ts-ignore
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            return buf;
        };
        const countDiff = (a: Uint8Array, b: Uint8Array, step: number): number => {
            let d = 0;
            for (let i = 0; i < a.length; i += step * 4) {
                if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) d++;
            }
            return d;
        };
        // @ts-ignore
        const bs = window.__bunnyStore.getState();
        const wasVisible = !!bs.components?.Cap_front;
        const base = read();
        bs.setComponentVisibility('Cap_front', !wasVisible);
        await new Promise((r) => setTimeout(r, 700));
        const toggled = read();
        bs.setComponentVisibility('Cap_front', wasVisible);
        await new Promise((r) => setTimeout(r, 700));
        const restored = read();
        return {
            ok: true,
            w,
            h,
            wasVisible,
            toggleDiff: countDiff(base, toggled, 8),
            restoreDiff: countDiff(toggled, restored, 8),
        };
    });
    console.log(`[DIAG] EXPERIMENTO DECISIVO (visibilidad Cap_front): ${JSON.stringify(decisive)}`);

    // ============ 3. PNG screenshots paridad ============
    const png1 = await canvas.screenshot();
    await page.waitForTimeout(800);
    const png2 = await canvas.screenshot();
    const pngEqual = png1.equals(png2);
    console.log(`[DIAG] PNG screenshots: ${png1.length} bytes vs ${png2.length} bytes → identical=${pngEqual}`);

    // ============ Estado final del store ============
    const finalState = await page.evaluate(() => {
        // @ts-ignore
        const bs = window.__bunnyStore.getState();
        // @ts-ignore
        const is = window.__intStore.getState();
        return {
            conversationState: is.conversationState,
            currentAnimation: bs.currentAnimation,
            currentExpression: bs.currentExpression,
            blendQueue: bs.blendQueue,
            isPlaying: bs.isPlaying,
        };
    });
    console.log(`[DIAG] Estado final: ${JSON.stringify(finalState)}`);
    console.log(`[DIAG] pageErrors: ${JSON.stringify(pageErrors)}`);

    // ============ Conclusión automática ============
    const framesProduced = (glDiff as any).ok === true && (glDiff as any).diffPixels > 0;
    const pngMoves = !pngEqual;
    const toggleChanged =
        (decisive as any).ok === true &&
        ((decisive as any).toggleDiff > 0 || (decisive as any).restoreDiff > 0);
    console.log(`[DIAG] toggleChanged (re-render forzado por visibilidad): ${toggleChanged}`);
    if (!framesProduced && !toggleChanged) {
        console.log(`[DIAG] ⚠️ CONCLUSIÓN: el backbuffer NO cambia ni con IDLE ni con un re-render forzado → el headless SwiftShader NO presenta frames WebGL (artefacto de entorno, NO freeze real del código).`);
    } else if (!framesProduced && toggleChanged) {
        console.log(`[DIAG] ⚠️ CONCLUSIÓN: el backbuffer SÍ cambia al forzar re-render pero NO durante IDLE → el mixer de animación NO avanza en headless (posible bug real o delta=0).`);
    } else {
        console.log(`[DIAG] ✅ CONCLUSIÓN: el backbuffer cambia → render loop activo y frames producidos.`);
    }

    // Resumen de logs de la app: prueba de que las acciones se crean/reproducen
    const summaryLogs = appLogs.filter(
        (l) => l.includes('[DIAG BunnyViewer]') || l.includes('Único:') || l.includes('MouthMove')
    );
    console.log(`[DIAG] appLogs (BunnyViewer) relevantes: ${JSON.stringify(summaryLogs.slice(-25))}`);

    // El spec es informativo: no falla por sí solo salvo que no haya contexto WebGL.
    expect((glDiff as any).ok, `No se pudo leer el contexto WebGL: ${JSON.stringify(glDiff)}`).toBeTruthy();
    expect(pageErrors).toEqual([]);
});
