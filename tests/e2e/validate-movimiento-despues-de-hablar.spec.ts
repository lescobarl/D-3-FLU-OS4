// ============================================================
// validate-movimiento-despues-de-hablar.spec.ts
// VALIDACIÓN RUNTIME (pixel + estado): ¿el avatar SE MUEVE de forma
// visible DESPUÉS de salir de SPEAKING → IDLE?
//
// Contexto: el usuario reporta que al terminar de hablar el conejito
// "se congela sin movimiento" y "después de un rato ya se mueve".
//
// Este test NO lee código: mide el comportamiento REAL en runtime.
//   1. Conduce SPEAKING (2.5s) → IDLE vía integrationStore.
//   2. Confirma invariantes del store (isPlaying=true, Idle_2, sin
//      log "isPlaying=false o sin currentAnimation → limpiado").
//   3. Toma screenshots del canvas 3D a intervalos y compara bytes:
//      si el idle realmente anima (respiración/balanceo), los frames
//      sucesivos DIFIEREN; si está congelado, son IDÉNTICOS.
//   4. Muestrea durante ~9s para capturar también la micro-expresión
//      idle (8-15s) que explicaría el "después de un rato se mueve".
//
// ⚠️ HALLAZGO CI (diagnose-movimiento-canvas.spec.ts): en headless
//    SwiftShader el compositor NO presenta frames al backbuffer WebGL —
//    incluso un toggle de visibilidad de un componente 3D produce
//    diffPixels=0 y PNG byte-idénticos, mientras rAF está vivo y el
//    pipeline crea/reproduce acciones. Por tanto en CI headless la
//    paridad de PNG NO puede medir movimiento (sí en navegador real).
//    La validación anti-freeze se apoya en señales de ESTADO + PIPELINE
//    (fiables): isPlaying=true, sin guard de limpieza, micro-expresión
//    visible disparada, y acciones creadas/reproducidas. El muestreo de
//    píxeles se conserva como reporte informativo.
// ============================================================
import { test, expect } from '@playwright/test';

test('Valida que el avatar se MUEVE visiblemente tras SPEAKING→IDLE (pixel diff)', async ({ page }) => {
    test.setTimeout(180000);

    const browserLogs: string[] = [];
    const animLogs: string[] = []; // logs de creación/reuso de acciones (Cache HIT/SET, Único, Clip sintético)
    let cleanupLogged = 0; // "[DIAG BunnyViewer] isPlaying=false o sin currentAnimation → limpiado"
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('isPlaying=false o sin currentAnimation')) cleanupLogged++;
        if (
            text.includes('Cache HIT') ||
            text.includes('Cache SET') ||
            text.includes('Único:') ||
            text.includes('Clip sintético') ||
            text.includes('Sintético (retry)')
        ) {
            animLogs.push(text);
        }
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
    await page.waitForTimeout(6000); // cargar modelo FBX (SwiftShader es lento)

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
    // SPEAKING 2.5s → IDLE
    // ========================================
    console.log('[TEST] Conduciendo SPEAKING (2.5s) → IDLE...');
    const transition = await page.evaluate(async () => {
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
        await wait(1500); // dejar que aterrice en idle

        const bs = bunnyStore.getState();
        return {
            conversationState: intStore.getState().conversationState,
            currentAnimation: bs.currentAnimation,
            currentExpression: bs.currentExpression,
            blendQueue: bs.blendQueue,
            isPlaying: bs.isPlaying,
        };
    });
    console.log(`[TEST] Estado tras IDLE: ${JSON.stringify(transition)}`);

    // ========================================
    // Helper: snapshot del canvas (bytes PNG del frame compuesto)
    // ========================================
    const canvas = page.locator('.flu-bridge-container canvas').first();
    const snap = async (label: string) => {
        const buf = await canvas.screenshot();
        console.log(`[TEST] snapshot ${label}: ${buf.length} bytes`);
        return buf;
    };

    // Sanity: el canvas no debe ser uniforme (el conejito se ve)
    const sanity = await snap('sanity');
    const sanityNonZero = [...sanity.subarray(0, Math.min(sanity.length, 200000))].filter((b) => b !== 0).length;
    console.log(`[TEST] Sanity: ${sanityNonZero} bytes no-cero en primeros 200KB (debe ser > 0)`);
    expect(sanityNonZero, 'El canvas debe mostrar contenido (conejito visible)').toBeGreaterThan(0);

    // ========================================
    // Muestreo de movimiento durante ~9s
    // ========================================
    const samples: Array<{ label: string; bytes: number; equalToPrev: boolean }> = [];
    const storeSamples: Array<{ t: number; anim: string | null; expr: string | null; playing: boolean; bq: string[] }> = [];
    // Micro-expresiones VISIBLES (no 'atencion' → Idle_2 que ya corre en idle)
    const VISIBLE_MICROS = new Set(['chispas', 'se_me_chispotio', 'baila', 'canta']);

    let prev = await snap('idle-0s');
    samples.push({ label: 'idle-0s', bytes: prev.length, equalToPrev: false });

    const readStore = () =>
        page.evaluate(() => {
            // @ts-ignore
            const bs = window.__bunnyStore.getState();
            return { anim: bs.currentAnimation, expr: bs.currentExpression, playing: bs.isPlaying, bq: bs.blendQueue || [] };
        });

    for (let i = 1; i <= 6; i++) {
        await page.waitForTimeout(1500);
        const st = await readStore();
        storeSamples.push({ t: i * 1500, ...st });
        console.log(`[TEST] idle-${i * 1500}ms expr=${st.expr} anim=${st.anim}`);
        const buf = await snap(`idle-${i * 1500}ms`);
        const equal = buf.equals(prev);
        samples.push({ label: `idle-${i * 1500}ms`, bytes: buf.length, equalToPrev: equal });
        console.log(`[TEST] idle-${i * 1500}ms: equalToPrev=${equal} (${buf.length} bytes vs ${prev.length})`);
        prev = buf; // comparación CONSECUTIVA (cada frame vs el inmediato anterior)
    }

    // ========================================
    // Reporte
    // ========================================
    const movingPairs = samples.slice(1).filter((s) => !s.equalToPrev).length;
    console.log(`[TEST] === REPORTE ===`);
    console.log(`[TEST] Estado tras IDLE : ${JSON.stringify(transition)}`);
    console.log(`[TEST] Samples          : ${JSON.stringify(samples.map((s) => ({ ...s, equalToPrev: s.equalToPrev })))}`);
    console.log(`[TEST] Store timeline   : ${JSON.stringify(storeSamples)}`);
    console.log(`[TEST] Pares con cambio : ${movingPairs}/${samples.length - 1}`);
    console.log(`[TEST] cleanupLogged    : ${cleanupLogged} (debe ser 0 tras IDLE)`);
    console.log(`[TEST] pageErrors       : ${pageErrors.length}`);

    // Micro-expresiones visibles detectadas en la ventana de IDLE (post-fix:
    // cadencia 4-8s + primera visible ~1.5s tras SPEAKING→IDLE)
    const visibleMicros = storeSamples.filter((s) => s.expr && VISIBLE_MICROS.has(s.expr)).map((s) => `${s.t}ms:${s.expr}`);
    console.log(`[TEST] Micros visibles  : ${JSON.stringify(visibleMicros)}`);

    // ========================================
    // ASERCIONES
    // ========================================

    // 1. Invariantes del store tras IDLE: el motor dice que ESTÁ reproduciendo
    expect(transition.isPlaying, 'isPlaying debe ser true tras IDLE').toBeTruthy();
    expect(transition.currentAnimation, 'currentAnimation debe ser Idle_2 tras IDLE').toBe('Idle_2');
    expect(transition.blendQueue, 'blendQueue debe contener Idle_2').toContain('Idle_2');

    // 2. Nunca debe haberse limpiado por isPlaying=false (el guard de congelado)
    expect(cleanupLogged, 'El guard "isPlaying=false → limpiado" NO debe dispararse tras IDLE').toBe(0);

    // 3. MOVIMIENTO del motor: al menos una micro-expresión VISIBLE (≠ 'atencion')
    //    debe dispararse en la ventana de ~9s de IDLE. Esta es la prueba REAL del
    //    anti-freeze: la máquina de estado AVANZA tras hablar (no está congelada)
    //    y encola una animación distinta a la ya activa (Idle_2). Antes del fix,
    //    las micros resolvían a 'atencion'→Idle_2 (la misma animación) → sin
    //    cambio perceptible → se veía "congelado".
    expect(
        visibleMicros.length,
        `Se esperaba ≥1 micro-expresión visible (${[...VISIBLE_MICROS].join(', ')}) en los primeros ~9s de IDLE. ` +
            `Expresiones vistas: ${JSON.stringify(storeSamples.map((s) => `${s.t}ms:${s.expr}`))}`
    ).toBeGreaterThan(0);

    // 4. El pipeline de animación creó/reusó acciones (prueba de que el mixer tiene
    //    clips activos y reproduce → en un navegador real se ve movimiento).
    console.log(`[TEST] animLogs (pipeline): ${JSON.stringify(animLogs.slice(-12))}`);
    expect(
        animLogs.length,
        'El pipeline de animación debe crear/reusar ≥1 acción (Cache HIT/SET, Único, Clip sintético) tras IDLE'
    ).toBeGreaterThan(0);

    // 5. MOVIMIENTO VISIBLE por píxeles: señal INFORMATIVA, NO bloqueante.
    //    Diagnóstico probado: en headless SwiftShader el compositor NO presenta
    //    frames al backbuffer WebGL — incluso un toggle de visibilidad de un
    //    componente 3D produce diffPixels=0 (ver diagnose-movimiento-canvas.spec.ts).
    //    Por tanto la paridad de PNG no puede medir movimiento en CI headless
    //    (sí en navegadores reales). Se mantiene el muestreo como reporte.
    console.log(
        `[TEST] AVISO (informativo): pares de PNG con cambio = ${movingPairs}/${samples.length - 1}. ` +
            `En headless SwiftShader el backbuffer WebGL nunca presenta frames (artefacto de entorno probado); ` +
            `el movimiento se valida por las aserciones de estado (3) y pipeline (4), que SÍ son fiables en CI.`
    );

    // 6. Sin errores de página
    expect(pageErrors).toEqual([]);

    await page.screenshot({ path: 'test-results/movimiento-despues-de-hablar.png', fullPage: true });
    console.log('[TEST] ✅ Validación de movimiento tras hablar completada');
});
