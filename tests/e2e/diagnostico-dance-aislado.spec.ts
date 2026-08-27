// ============================================================
// diagnostico-dance-aislado.spec.ts
// DIAGNÓSTICO AISLADO: ¿Dance mueve el CUERPO en OS4?
//
// POR QUÉ EXISTE:
//   El test validate-cuerpo-en-movimiento.spec.ts PASÓ pero su
//   fase FIX NO midió Dance: `setExpression("hablando")` sobreescribió
//   la cola y el mixer quedó con activas=[MouthMove, Idle_2]. O sea,
//   su bodyMax=1.488e-1 / movingBones=97 fue el movimiento de Idle_2,
//   NO de Dance. Ese test NO prueba que Dance mueva el cuerpo.
//
//   El usuario afirma que en OS2 "baila/canta → dance" funciona
//   perfectamente (el clip tiene keyframes). La pregunta aquí es
//   si el binding del renderer OS4 aplica ese clip a los huesos.
//
// METODOLOGÍA (certezas, no probabilidades):
//   1. Cargar app en 5175, esperar modelo FBX (__bunnyProbe).
//   2. Fijar IDLE y asentar 2.5s (referencia del cuerpo parado).
//   3. Llamar blendAnimation(['Dance']) DIRECTAMENTE (SIN el override
//      "hablando" que dañó al test anterior).
//   4. Esperar READINESS real del mixer: __bunnyProbe.ready(['Dance'])
//      → Dance creado y reproduciéndose.
//   5. Medir el movimiento del CUERPO en 8 ventanas de 700ms.
//      REPORTAR LA SERIE COMPLETA por ventana:
//      - Si Dance está vivo (clip con keyframes) → movingBones>0 y
//        bodyMax alto en TODAS las ventanas (bucle continuo).
//      - Si Dance está congelado (un solo frame / sin binding) →
//        movimiento solo en la ventana 1 (artefacto del fade-in
//        desde el bind pose) y 0 en el resto.
//   6. Log del estado real del mixer al final (activeActions +
//      clipStatus + store currentAnimation/blendQueue).
//
// Es DIAGNÓSTICO: registra todo y emite un veredicto informativo;
// no falla en falso (la verdad sale en el log), pero falla si el
// probe no queda listo (eso sí es un problema de infraestructura).
// ============================================================
import { test, Page } from '@playwright/test';

const BODY_MOVING_THRESHOLD = 0.001; // unidades de mundo
const SUSTAINED_MOVING = 3; // huesos del cuerpo "en movimiento" por ventana
const SUSTAINED_FRACTION = 0.6; // 60% de ventanas con movimiento real
const BODY_MAX_REAL = 0.002; // bodyMax mínimo para considerar "vivo"

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

// Analiza el movimiento del CUERPO (todos los huesos EXCEPTO boca)
// entre dos muestras. Misma métrica endurecida que el test original.
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

// Readiness real del mixer: espera a que la acción Dance esté creada y
// reproduciéndose (clip FBX cargado on-demand).
async function waitForDanceReady(page: Page, timeoutMs = 60000): Promise<{ ready: boolean; active: string[] }> {
    const start = Date.now();
    let last: { ready: boolean; active: string[] } = { ready: false, active: [] };
    while (Date.now() - start < timeoutMs) {
        last = await page.evaluate(() => {
            // @ts-ignore
            return window.__bunnyProbe.ready(['Dance']);
        });
        if (last.ready) return last;
        await page.waitForTimeout(400);
    }
    return last;
}

function formatTop(bones: BoneDelta[]): string {
    if (bones.length === 0) return 'ninguno';
    return bones.map((x) => `${x.name}=${x.d.toExponential(2)}`).join(', ');
}

test('DIAGNÓSTICO AISLADO: ¿Dance mueve el CUERPO en OS4?', async ({ page }) => {
    test.setTimeout(240000);

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[DIAG') || text.includes('[DANCE') || text.includes('Cache SET') || text.includes('Cache MISS')) {
            console.log(`[BROWSER] ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // 1. Cargar app + esperar modelo 3D listo
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    console.log('[DANCE] Canvas 3D visible — esperando carga del modelo FBX...');
    await waitForProbe(page);
    console.log('[DANCE] Modelo 3D cargado: skeleton expuesto por __bunnyProbe');

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
    console.log('[DANCE] Stores inyectados');

    // ========================================
    // 3. IDLE asentado (referencia del cuerpo parado)
    //    NOTA: NO se llama setExpression("hablando") en todo el test.
    //    Esa llamada es exactamente la que pisó Dance en el test anterior.
    // ========================================
    console.log('[DANCE] Fase IDLE asentado (referencia)...');
    await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 2500));
    });

    // Referencia IDLE: 3 ventanas
    const idleWindows: MotionAnalysis[] = [];
    for (let i = 0; i < 3; i++) {
        const a = await sampleBones(page);
        await page.waitForTimeout(700);
        const b = await sampleBones(page);
        if (a.ok && b.ok) {
            const an = analyzeMotion(a, b);
            an.elapsedMs = (b.t ?? 0) - (a.t ?? 0);
            idleWindows.push(an);
        }
    }
    const idleBest = idleWindows.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), idleWindows[0]);
    const idleMaxMoving = Math.max(...idleWindows.map((w) => w.movingBones));
    console.log(`[DANCE] IDLE: bodyMax=${idleBest.bodyMax.toExponential(3)} (${idleBest.bodyBone || 'ninguno'}), movingBones(máx)=${idleMaxMoving}, top=[${formatTop(idleBest.topBones)}]`);

    // ========================================
    // 4. AISLAR DANCE: blendAnimation(['Dance']) DIRECTO.
    //    Sin SPEAKING, sin setExpression, sin hablando.
    // ========================================
    console.log('[DANCE] Aislando Dance: blendAnimation(["Dance"]) directo (SIN override de hablando)...');
    await page.evaluate(async () => {
        // @ts-ignore
        const bs = window.__bunnyStore;
        bs.getState().blendAnimation(['Dance'] as any);
        await new Promise((r) => setTimeout(r, 800));
    });

    const ready = await waitForDanceReady(page, 60000);
    console.log(`[DANCE] Readiness del mixer (Dance aislado): ready=${ready.ready} — activas=[${ready.active.join(', ')}]`);

    // ========================================
    // 5. MEDIR el movimiento del cuerpo en 8 ventanas de 700ms.
    //    Serie COMPLETA por ventana: distingue bucle vivo vs fade-in.
    // ========================================
    const windows: MotionAnalysis[] = [];
    for (let i = 0; i < 8; i++) {
        const a = await sampleBones(page);
        await page.waitForTimeout(700);
        const b = await sampleBones(page);
        if (a.ok && b.ok) {
            const an = analyzeMotion(a, b);
            an.elapsedMs = (b.t ?? 0) - (a.t ?? 0);
            windows.push(an);
            console.log(
                `[DANCE] ventana ${i + 1}/8: bodyMax=${an.bodyMax.toExponential(3)} (${an.bodyBone || 'ninguno'}), ` +
                    `movingBones=${an.movingBones}, jawMax=${an.jawMaxAngle.toFixed(4)}, top=[${formatTop(an.topBones)}]`,
            );
        }
    }
    if (windows.length === 0) throw new Error('[DANCE] No se obtuvo ninguna ventana de muestreo');

    const best = windows.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), windows[0]);
    const bestMoving = windows.reduce((p, c) => (c.movingBones > p.movingBones ? c : p), windows[0]);
    const maxMovingBones = Math.max(...windows.map((w) => w.movingBones));
    const sustainedWindows = windows.filter((w) => w.movingBones >= SUSTAINED_MOVING && w.bodyMax > BODY_MAX_REAL).length;
    const sustainedFraction = sustainedWindows / windows.length;

    console.log('[DANCE] ==================== RESUMEN ====================');
    console.log(`[DANCE] IDLE referencia:          bodyMax=${idleBest.bodyMax.toExponential(3)}, movingBones(máx)=${idleMaxMoving}`);
    console.log(`[DANCE] Dance (8 ventanas):       bodyMax(pico)=${best.bodyMax.toExponential(3)} (${best.bodyBone || 'ninguno'}), movingBones(máx)=${maxMovingBones}, movingBones(mejor ventana)=${bestMoving.movingBones}`);
    console.log(`[DANCE] Ventanas con movimiento real: ${sustainedWindows}/${windows.length} (${(sustainedFraction * 100).toFixed(0)}%)`);

    // ========================================
    // 6. Veredicto (informativo, basado en datos; no es assert duro)
    // ========================================
    const sustained = sustainedFraction >= SUSTAINED_FRACTION;
    const movesAtAll = maxMovingBones >= SUSTAINED_MOVING && best.bodyMax > BODY_MAX_REAL;
    let verdict: string;
    if (sustained && movesAtAll) {
        verdict =
            'DANCE SÍ MUEVE EL CUERPO EN OS4 (bucle vivo): el movimiento es sostenido en la mayoría de ventanas. ' +
            'Si el usuario ve el avatar congelado al pedirle bailar, el problema NO es el clip ni el binding — es el CONTEXTO del flujo real ' +
            '(ej. el override "hablando" que pisa Dance en el camino SPEAKING/emoción). Hay que analizar el flujo vivo, no el renderer.';
    } else if (movesAtAll && !sustained) {
        verdict =
            'DANCE MUEVE EL CUERPO SOLO EN EL FADE-IN, LUEGO SE CONGELA (sospechoso): el clip parece tener un solo frame aplicado o no se avanza el tiempo del mixer. ' +
            'OS2 lo hace bien → el clip tiene keyframes; en OS4 el binding/avance falla. Investigar el mixer (time/update) en BunnyViewer para Dance.';
    } else {
        verdict =
            'DANCE NO MUEVE EL CUERPO EN OS4 (prácticamente congelado): movingBones≈0 y bodyMax≈0 mientras Dance está ACTIVO en el mixer. ' +
            'Confirma el fallo de binding del clip en el renderer OS4 (el clip tiene keyframes, como prueba OS2). El problema es el binding/avance del mixer, NO la ruta de comandos.';
    }
    console.log(`[DANCE] VEREDICTO: ${verdict}`);

    // ========================================
    // 7. Estado real del mixer al final (evidencia del contexto)
    // ========================================
    const ctx = await page.evaluate(() => {
        // @ts-ignore
        const bs = window.__bunnyStore.getState();
        // @ts-ignore
        const probe = window.__bunnyProbe;
        let active: string[] = [];
        let clipStatus: any = null;
        try {
            // @ts-ignore
            active = probe.activeActions();
            // @ts-ignore
            clipStatus = probe.clipStatus();
        } catch (e) {}
        return {
            storeCurrentAnimation: bs.currentAnimation,
            storeBlendQueue: bs.blendQueue,
            storeIsPlaying: bs.isPlaying,
            mixerActive: active,
            clipStatus,
        };
    });
    console.log(`[DANCE] Contexto final: currentAnimation=${ctx.storeCurrentAnimation}, blendQueue=[${(ctx.storeBlendQueue || []).join(', ')}], isPlaying=${ctx.storeIsPlaying}`);
    console.log(`[DANCE] Mixer activo (final): [${ctx.mixerActive.join(', ')}]`);
    if (ctx.clipStatus) console.log(`[DANCE] clipStatus: ${JSON.stringify(ctx.clipStatus)}`);

    console.log('[DANCE] ==================== FIN DIAGNÓSTICO ====================');
});
