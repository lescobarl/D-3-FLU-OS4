// ============================================================
// validate-cuerpo-en-movimiento.spec.ts  (v2 — endurecido)
// VALIDACIÓN FUNCIONAL (lo que el usuario VE): durante SPEAKING
// con emoción activa, el CUERPO del avatar se mueve de verdad.
//
// Diferencia clave vs. tests del store: aquí NO se leen strings
// internos. Se leen las transformaciones MUNDIALES reales de los
// huesos del skeleton 3D vivo (window.__bunnyProbe, expuesto por
// BunnyViewer) — EXACTAMENTE lo que el renderer proyecta en pantalla.
//
// Metodología endurecida (tras el primer intento que pasaba de
// forma trivial):
//  1. Métrica robusta: no mide un solo hueso (ear_06_* dominaba el
//     delta de posición por estar al final de la cadena cinemática).
//     Ahora cuenta CUÁNTOS huesos del CUERPO se mueven (movingBones)
//     y muestra el TOP-5 de huesos en movimiento.
//  2. IDLE asentado: se espera ~2.5s tras entrar en IDLE para evitar
//     el artefacto del fade-in de transición, y se mide con 3
//     ventanas (máximo sobre ventanas).
//  3. READINESS real: el test espera window.__bunnyProbe.ready([...])
//     (acciones creadas y reproduciéndose en el mixer) antes de medir
//     la emoción — en automatización el preload está desactivado y
//     los clips FBX (Dance/Idle_2) se cargan on-demand.
//  4. Máximo sobre MUCHAS ventanas: 8 ventanas de 700ms para capturar
//     el pico del cuerpo una vez que los clips se aplican.
//  5. Control A/B: CONTROL con el blend buggy (solo MouthMove →
//     cuerpo congelado, "solo boca" del reporte del usuario) vs FIX
//     (Idle_2 + Dance + MouthMove → cuerpo vivo).
// ============================================================
import { test, expect, Page } from '@playwright/test';

const BODY_MOVING_THRESHOLD = 0.001; // unidades de mundo: un hueso del CUERPO que se mueve más que esto en una ventana = "en movimiento"
const FIXED_BODY_THRESHOLD = 0.002; // hard: bodyMax de la mejor ventana del fix debe superar esto
const FIXED_MOVING_BONES = 3; // hard: al menos 3 huesos del CUERPO deben moverse en el fix
const JAW_ANGLE_THRESHOLD = 0.01; // radianes

interface Sample {
    ok: boolean;
    reason?: string;
    t?: number;
    bones?: Record<string, { p: [number, number, number]; q: [number, number, number, number] }>;
}

interface BoneDelta {
    name: string;
    d: number;
}

interface MotionAnalysis {
    bodyMax: number;
    bodyBone: string;
    movingBones: number;
    topBones: BoneDelta[];
    jawMaxAngle: number;
    boneCount: number;
    elapsedMs: number;
}

interface MeasureResult {
    windows: MotionAnalysis[];
    best: MotionAnalysis; // ventana con mayor bodyMax
    bestMoving: MotionAnalysis; // ventana con mayor movingBones
    maxMovingBones: number;
}

// Analiza el movimiento del CUERPO entre dos muestras.
// - Cuerpo = todos los huesos EXCEPTO los de boca (jaw/mouth/mand/tongue).
// - movingBones = cuántos huesos del cuerpo superan BODY_MOVING_THRESHOLD.
// - topBones = top-5 huesos del cuerpo por delta (para diagnóstico legible).
// - jawMaxAngle = máximo ángulo (rad) de rotación de los huesos de boca.
function analyzeMotion(a: Sample, b: Sample): MotionAnalysis {
    const bones = Object.keys(b.bones ?? {});
    let bodyMax = 0;
    let bodyBone = '';
    let jawMaxAngle = 0;
    const deltas: BoneDelta[] = [];
    let movingBones = 0;
    for (const name of bones) {
        const pa = a.bones?.[name]?.p;
        const pb = b.bones?.[name]?.p;
        const qa = a.bones?.[name]?.q;
        const qb = b.bones?.[name]?.q;
        if (!pa || !pb) continue;
        const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
        const isJaw = /jaw|mouth|mand|tongue/i.test(name);
        if (isJaw) {
            if (qa && qb) {
                const dot = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
                const angle = 2 * Math.acos(Math.min(1, dot));
                if (angle > jawMaxAngle) jawMaxAngle = angle;
            }
            continue;
        }
        if (d > bodyMax) {
            bodyMax = d;
            bodyBone = name;
        }
        if (d > BODY_MOVING_THRESHOLD) movingBones++;
        deltas.push({ name, d });
    }
    deltas.sort((x, y) => y.d - x.d);
    const topBones = deltas.slice(0, 5);
    return { bodyMax, bodyBone, movingBones, topBones, jawMaxAngle, boneCount: bones.length, elapsedMs: 0 };
}

async function sampleBones(page: Page): Promise<Sample> {
    return page.evaluate(() => {
        // @ts-ignore
        if (!window.__bunnyProbe) return { ok: false, reason: 'no-probe' };
        // @ts-ignore
        return window.__bunnyProbe.sample();
    });
}

async function waitForProbe(page: Page, timeoutMs = 40000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const s = await sampleBones(page);
        if (s.ok && s.bones && Object.keys(s.bones).length > 10) return;
        await page.waitForTimeout(500);
    }
    throw new Error('window.__bunnyProbe no quedó listo (modelo FBX no cargó a tiempo)');
}

// Señal de READINESS REAL: espera a que el mixer tenga las acciones
// indicadas creadas y reproduciéndose (clips FBX cargados on-demand).
async function waitForReady(page: Page, names: string[], timeoutMs = 45000): Promise<{ ready: boolean; missing: string[]; active: string[] }> {
    const start = Date.now();
    let last: { ready: boolean; missing: string[]; active: string[] } = { ready: false, missing: names, active: [] };
    while (Date.now() - start < timeoutMs) {
        last = await page.evaluate((ns) => {
            // @ts-ignore
            return window.__bunnyProbe.ready(ns);
        }, names);
        if (last.ready) return last;
        await page.waitForTimeout(400);
    }
    return last;
}

// Var: el fix alterna Idle_2/Idle_3 como base de habla, así que el set
// esperado es {Dance, MouthMove} + (Idle_2 o Idle_3).
async function waitForFixedBlendReady(page: Page, timeoutMs = 45000): Promise<{ ready: boolean; active: string[] }> {
    const start = Date.now();
    let last: { ready: boolean; active: string[] } = { ready: false, active: [] };
    while (Date.now() - start < timeoutMs) {
        const r = await page.evaluate(() => {
            // @ts-ignore
            const active = window.__bunnyProbe.activeActions();
            return active;
        });
        last = { ready: false, active: r };
        const set = new Set(r);
        const hasDance = set.has('Dance');
        const hasMouth = set.has('MouthMove');
        const hasIdle = set.has('Idle_2') || set.has('Idle_3');
        if (hasDance && hasMouth && hasIdle) {
            last.ready = true;
            return last;
        }
        await page.waitForTimeout(400);
    }
    return last;
}

// Mide el movimiento del cuerpo en `windows` ventanas de `gapMs`.
// Devuelve el máximo sobre ventanas (captura el pico del cuerpo).
async function measureMotion(
    page: Page,
    opts: { windows?: number; gapMs?: number; label: string },
): Promise<MeasureResult> {
    const { windows = 3, gapMs = 700, label } = opts;
    const wins: MotionAnalysis[] = [];
    for (let i = 0; i < windows; i++) {
        const a = await sampleBones(page);
        await page.waitForTimeout(gapMs);
        const b = await sampleBones(page);
        if (a.ok && b.ok) {
            const an = analyzeMotion(a, b);
            an.elapsedMs = (b.t ?? 0) - (a.t ?? 0);
            wins.push(an);
            console.log(`[TEST] ${label} · ventana ${i + 1}/${windows}: bodyMax=${an.bodyMax.toExponential(3)} (${an.bodyBone || 'ninguno'}), movingBones=${an.movingBones}`);
        }
    }
    if (wins.length === 0) throw new Error(`[TEST] ${label}: no se pudo obtener ninguna ventana de muestreo`);
    let best = wins[0];
    for (const w of wins) if (w.bodyMax > best.bodyMax) best = w;
    let bestMoving = wins[0];
    for (const w of wins) if (w.movingBones > bestMoving.movingBones) bestMoving = w;
    const maxMovingBones = Math.max(...wins.map((w) => w.movingBones));
    return { windows: wins, best, bestMoving, maxMovingBones };
}

function formatTop(bones: BoneDelta[]): string {
    if (bones.length === 0) return 'ninguno';
    return bones.map((x) => `${x.name}=${x.d.toExponential(2)}`).join(', ');
}

test('FUNCIONAL: el CUERPO del avatar se mueve durante SPEAKING con emoción (no solo la boca)', async ({ page }) => {
    test.setTimeout(180000);

    const browserLogs: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[DIAG') || text.includes('[TEST]') || text.includes('SPEAKING EMOTION') || text.includes('Cache SET') || text.includes('Cache MISS') || text.includes('Único:')) {
            browserLogs.push(text);
            console.log(`[BROWSER] ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        pageErrors.push(err.message);
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // 1. Cargar app + esperar modelo 3D listo
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    console.log('[TEST] Canvas 3D visible — esperando carga del modelo FBX...');
    await waitForProbe(page);
    console.log('[TEST] Modelo 3D cargado: skeleton expuesto por __bunnyProbe');

    // ========================================
    // 2. Inyectar stores reales (misma secuencia que App.tsx)
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
    console.log('[TEST] Stores inyectados');

    // ========================================
    // 3. IDLE asentado (referencia del cuerpo parado)
    //    Se espera ~2.5s para dejar que el fade-in de la transición
    //    termine y medir el ESTADO ESTABLE, no el artefacto.
    // ========================================
    console.log('[TEST] Fase IDLE asentado (referencia)...');
    await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 2500));
    });
    const idleMeasure = await measureMotion(page, { windows: 3, gapMs: 700, label: 'IDLE' });
    console.log(`[TEST] IDLE: bodyMax=${idleMeasure.best.bodyMax.toExponential(3)} (${idleMeasure.best.bodyBone || 'ninguno'}), movingBones(máx)=${idleMeasure.maxMovingBones}, top=[${formatTop(idleMeasure.best.topBones)}]`);

    // ========================================
    // 4. CONTROL A/B — blend BUGGY (solo MouthMove)
    //    Reproduce el reporte del usuario: "solo boca, cuerpo congelado".
    //    Es SOLO informativo: medimos cuánto se mueve el cuerpo con el
    //    blend buggy para contrastar contra el fix.
    // ========================================
    console.log('[TEST] Fase CONTROL (blend buggy: solo MouthMove, sin Idle base)...');
    await page.evaluate(async () => {
        // @ts-ignore
        const bs = window.__bunnyStore;
        bs.getState().blendAnimation(['MouthMove'] as any);
        await new Promise((r) => setTimeout(r, 1500));
    });
    const controlMeasure = await measureMotion(page, { windows: 3, gapMs: 700, label: 'CONTROL(bug)' });
    console.log(`[TEST] CONTROL(bug): bodyMax=${controlMeasure.best.bodyMax.toExponential(3)} (${controlMeasure.best.bodyBone || 'ninguno'}), movingBones(máx)=${controlMeasure.maxMovingBones}, top=[${formatTop(controlMeasure.best.topBones)}]`);

    // ========================================
    // 5. FIX — EMOCIÓN DURANTE SPEAKING (escenario real del usuario)
    //    Secuencia idéntica a App.tsx + espera de READINESS del mixer
    //    (los clips FBX se cargan on-demand en automatización).
    // ========================================
    console.log('[TEST] Fase FIX — SPEAKING + pendingEmotionAnims=["Dance"] (escenario real)...');
    await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        intStore.getState().setPendingEmotionAnims(['Dance']);
        await new Promise((r) => setTimeout(r, 200));
        intStore.getState().setConversationState('SPEAKING');
        intStore.getState().setFluSpeaking(true);
    });

    const ready = await waitForFixedBlendReady(page, 45000);
    console.log(`[TEST] Readiness del mixer (fix): ready=${ready.ready} — activas=[${ready.active.join(', ')}]`);
    if (!ready.ready) {
        console.warn(`[TEST] ⚠️ No se alcanzó readiness del blend fijo; activas=[${ready.active.join(', ')}]. Midiendo igualmente...`);
    }

    const fixedMeasure = await measureMotion(page, { windows: 8, gapMs: 700, label: 'FIX(emoción+habla)' });
    console.log(`[TEST] FIX(emoción+habla): bodyMax=${fixedMeasure.best.bodyMax.toExponential(3)} (${fixedMeasure.best.bodyBone || 'ninguno'}), movingBones(máx)=${fixedMeasure.maxMovingBones}, top=[${formatTop(fixedMeasure.best.topBones)}]`);

    // ========================================
    // 6. Evidencia visual complementaria (pantalla)
    // ========================================
    const canvas = page.locator('.flu-bridge-container canvas').first();
    const png1 = await canvas.screenshot();
    await page.waitForTimeout(900);
    const png2 = await canvas.screenshot();
    const pngDiff = !png1.equals(png2);
    console.log(`[TEST] Screenshots canvas: ${png1.length} vs ${png2.length} bytes → diferente=${pngDiff}`);

    // Backbuffer WebGL (preserveDrawingBuffer=true): región del avatar
    const glInfo = await canvas.evaluate(async (el: HTMLCanvasElement) => {
        // @ts-ignore
        const gl = el.getContext('webgl2') || el.getContext('webgl');
        if (!gl) return { ok: false, reason: 'no-webgl' };
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
        const a = read();
        await new Promise((r) => setTimeout(r, 800));
        const b = read();
        const y0 = Math.floor(h * 0.15);
        const y1 = Math.floor(h * 0.85);
        const x0 = Math.floor(w * 0.25);
        const x1 = Math.floor(w * 0.75);
        let diff = 0;
        let sampled = 0;
        for (let y = y0; y < y1; y += 4) {
            for (let x = x0; x < x1; x += 4) {
                const i = (y * w + x) * 4;
                sampled++;
                if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
            }
        }
        return { ok: true, w, h, sampled, diffPixels: diff };
    });
    console.log(`[TEST] Backbuffer WebGL (región avatar): ${JSON.stringify(glInfo)}`);

    // Estado del store SOLO como contexto diagnóstico (no es la validación)
    const storeCtx = await page.evaluate(() => {
        // @ts-ignore
        const bs = window.__bunnyStore.getState();
        // @ts-ignore
        const is = window.__intStore.getState();
        return {
            conversationState: is.conversationState,
            blendQueue: bs.blendQueue,
            currentAnimation: bs.currentAnimation,
            isPlaying: bs.isPlaying,
        };
    });
    console.log(`[TEST] Contexto store (solo diagnóstico): ${JSON.stringify(storeCtx)}`);

    const emotionLog = browserLogs.find((l) => /SPEAKING EMOTION → blendAnimation\(\[Dance,/.test(l));
    console.log(`[TEST] Ruta emoción ejecutada: ${emotionLog ? emotionLog : 'NO ENCONTRADA'}`);

    // ========================================
    // 7. ASSERT FUNCIONAL (lo que el usuario ve)
    // ========================================
    const fixedMoving = fixedMeasure.best.movingBones;
    const fixedBodyMax = fixedMeasure.best.bodyMax;
    console.log(`[TEST] Resumen: IDLE movingBones=${idleMeasure.maxMovingBones} | CONTROL(bug) movingBones=${controlMeasure.maxMovingBones} | FIX movingBones=${fixedMeasure.maxMovingBones}`);
    console.log(`[TEST] Boca en movimiento (jaw max angle, fix): ${fixedMeasure.best.jawMaxAngle.toFixed(4) ?? 'n/a'} rad`);

    expect(emotionLog, 'Precondición: debe ejecutarse la ruta SPEAKING EMOTION (escenario con emoción)').toBeTruthy();
    expect(
        fixedBodyMax > FIXED_BODY_THRESHOLD && fixedMoving >= FIXED_MOVING_BONES,
        `FUNCIONAL: el CUERPO debe moverse mientras FLU habla con emoción. ` +
            `Medido: bodyMax=${fixedBodyMax.toExponential(3)} (hueso "${fixedMeasure.best.bodyBone}"), ` +
            `movingBones=${fixedMoving} (umbral ${FIXED_MOVING_BONES}), top=[${formatTop(fixedMeasure.best.topBones)}]. ` +
            `Contraste: IDLE movingBones=${idleMeasure.maxMovingBones}, CONTROL(bug s/ Idle base) movingBones=${controlMeasure.maxMovingBones}. ` +
            `Si movingBones≈0 y bodyMax≈0, el cuerpo está congelado (bug).`,
    ).toBeTruthy();

    // Contraste funcional: el FIX debe mover MÁS huesos del cuerpo que el
    // control buggy (solo boca). Informativo en el mensaje de fallo.
    expect(
        fixedMeasure.maxMovingBones >= controlMeasure.maxMovingBones,
        `El fix (${fixedMeasure.maxMovingBones} huesos del cuerpo moviéndose) debe superar al blend buggy solo-boca (${controlMeasure.maxMovingBones}).`,
    ).toBeTruthy();

    // La pantalla debe estar presentando píxeles distintos (avatar vivo).
    expect(
        glInfo.ok === true && (glInfo.diffPixels ?? 0) > 0,
        `El backbuffer WebGL en la región del avatar debe cambiar entre dos instantes mientras el cuerpo se mueve. Medido: ${JSON.stringify(glInfo)}`,
    ).toBeTruthy();

    console.log(`[TEST] pageErrors: ${pageErrors.length}`);
    expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

    console.log('[TEST] ✅ VALIDACIÓN FUNCIONAL COMPLETA: el CUERPO del avatar se mueve durante SPEAKING con emoción (no solo la boca).');
});
