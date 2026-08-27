// ============================================================
// diagnostico-dance-mecanismo.spec.ts
// DIAGNÓSTICO DEL MECANISMO DEL CONGELAMIENTO (OS4)
//
// HECHOS YA ESTABLECIDOS (pruebas previas):
//   - Dance clip VÁLIDO + 100% bindeado (26.33s, 315 tracks, 104/104 huesos).
//   - En OS4: la PRIMERA acción nativa (Idle_2) SÍ mueve el cuerpo (96 huesos),
//     pero TODA acción creada después (Idle_3 control, Dance) queda CONGELADA
//     con bodyMax=0.000e+0 (pose de reposo) aunque currentAnimation=Dance,
//     isPlaying=true y mixerActive=[Dance].
//   - mixer.update() corre cada frame (useFrame, frameloop "always").
//   - Por fuente de three.js, un action reset+played (enabled, _startTime=null,
//     weight=1, LoopRepeat/Infinity) en un mixer tickeado DEBE acumular y mover.
//
// PREGUNTA A DISCRIMINAR (certezas, no probabilidades):
//   ¿El congelamiento es de TODA creación posterior al montaje (mixer/acción
//   desincronizado), o SOLO de la ruta de TRANSICIÓN (fade-out del saliente)?
//
// FASES:
//   A. IDLE referencia: Idle_2 nativo se mueve (línea base, mixer vivo).
//   B. stopAnimation() → cuerpo en reposo, mixer sigue existiendo (0 acciones).
//   C. playAnimation('Idle_3') FRESCO en mixer tibio, SIN transición
//      (el saliente ya fue detenido) → ¿se mueve?
//        • SÍ  → el congelamiento es de la ruta de TRANSICIÓN (fade).
//        • NO  → cualquier creación post-montaje se congela (mixer/acción stale).
//   D. Desde Idle_3 ACTIVO, blendAnimation(['Dance']) → EL CAMINO REAL
//      reportado por el usuario (transición con fade-out) → 8 ventanas.
//
// EXTRA: cuenta cuántas veces se reasigna window.__bunnyProbe (cada carga del
// modelo FBX) → detecta el doble montaje de React.StrictMode en dev.
//
// Registra los [DIAG BunnyViewer] (logs incondicionales del renderer) y el
// estado real del mixer en cada fase. No falla en falso: la verdad sale en el log.
// ============================================================
import { test, Page } from '@playwright/test';

const BODY_MOVING_THRESHOLD = 0.001; // unidades de mundo
const SUSTAINED_MOVING = 3; // huesos del cuerpo "en movimiento" por ventana
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

interface StoreCtx {
    currentAnimation: string | null;
    isPlaying: boolean;
    blendQueue: string[];
    mixerActive: string[];
}

// Analiza el movimiento del CUERPO (todos los huesos EXCEPTO boca)
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

// Readiness real del mixer: espera a que las acciones estén creadas y activas.
async function waitForReady(page: Page, names: string[], timeoutMs = 60000): Promise<{ ready: boolean; active: string[] }> {
    const start = Date.now();
    let last: { ready: boolean; active: string[] } = { ready: false, active: [] };
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

function formatTop(bones: BoneDelta[]): string {
    if (bones.length === 0) return 'ninguno';
    return bones.map((x) => `${x.name}=${x.d.toExponential(2)}`).join(', ');
}

async function getStoreCtx(page: Page): Promise<StoreCtx> {
    return page.evaluate(() => {
        // @ts-ignore
        const bs = window.__bunnyStore.getState();
        // @ts-ignore
        const probe = window.__bunnyProbe;
        let active: string[] = [];
        try {
            // @ts-ignore
            active = probe.activeActions();
        } catch (e) {}
        return {
            currentAnimation: bs.currentAnimation,
            isPlaying: bs.isPlaying,
            blendQueue: (bs.blendQueue || []).slice(),
            mixerActive: active,
        };
    });
}

async function measureWindows(page: Page, count: number, gapMs: number, label: string): Promise<MotionAnalysis[]> {
    const windows: MotionAnalysis[] = [];
    for (let i = 0; i < count; i++) {
        const a = await sampleBones(page);
        await page.waitForTimeout(gapMs);
        const b = await sampleBones(page);
        if (a.ok && b.ok) {
            const an = analyzeMotion(a, b);
            an.elapsedMs = (b.t ?? 0) - (a.t ?? 0);
            windows.push(an);
            console.log(
                `[MECANISMO] ${label} ventana ${i + 1}/${count}: bodyMax=${an.bodyMax.toExponential(3)} (${an.bodyBone || 'ninguno'}), ` +
                    `movingBones=${an.movingBones}, jawMax=${an.jawMaxAngle.toFixed(4)}, top=[${formatTop(an.topBones)}]`,
            );
        }
    }
    if (windows.length === 0) throw new Error(`[MECANISMO] No se obtuvo ninguna ventana de muestreo en ${label}`);
    return windows;
}

test('MECANISMO: ¿congelamiento en toda creación post-montaje o solo en la transición?', async ({ page }) => {
    test.setTimeout(300000);

    // Contador de cargas del modelo: cada loadFbx('Bunny_full.fbx') resuelto reasigna
    // window.__bunnyProbe (objeto nuevo). StrictMode en dev → doble montaje → 2.
    await page.addInitScript(() => {
        // @ts-ignore
        const w = window as any;
        w.__bunnyProbeHistory = [];
        const iv = setInterval(() => {
            if (w.__bunnyProbe) {
                const key = String(w.__bunnyProbe.sample);
                const last = w.__bunnyProbeHistory[w.__bunnyProbeHistory.length - 1];
                if (last !== key) w.__bunnyProbeHistory.push(key);
            }
        }, 50);
        w.__stopBunnyHistory = () => clearInterval(iv);
    });

    page.on('console', (msg) => {
        const text = msg.text();
        if (
            text.includes('[DIAG') ||
            text.includes('[MECANISMO') ||
            text.includes('Cache SET') ||
            text.includes('Cache MISS') ||
            text.includes('Cache HIT')
        ) {
            console.log(`[BROWSER] ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // Cargar app + esperar modelo 3D listo
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    console.log('[MECANISMO] Canvas 3D visible — esperando carga del modelo FBX...');
    await waitForProbe(page);
    console.log('[MECANISMO] Modelo 3D cargado');
    const probeCount = await page.evaluate(() => {
        // @ts-ignore
        return window.__bunnyProbeHistory.length;
    });
    console.log(`[MECANISMO] Reasignaciones de __bunnyProbe (cargas del modelo FBX): ${probeCount} — StrictMode en dev espera 2`);

    // ========================================
    // Inyectar stores reales
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
    console.log('[MECANISMO] Stores inyectados');

    // ========================================
    // Fase 0: IDLE asentado (referencia del cuerpo parado).
    // NO se llama setExpression("hablando") en todo el test (pisó Dance antes).
    // ========================================
    console.log('[MECANISMO] Fase IDLE asentado...');
    await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 2500));
    });

    // ========================================
    // FASE A: línea base — la PRIMERA acción nativa (Idle_2) se mueve
    // ========================================
    console.log('[MECANISMO] ===== FASE A: línea base Idle_2 (nativo) =====');
    const idleA = await measureWindows(page, 3, 700, 'A');
    const idleBest = idleA.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), idleA[0]);
    console.log(
        `[MECANISMO] FASE A: bodyMax=${idleBest.bodyMax.toExponential(3)} (${idleBest.bodyBone || 'ninguno'}), ` +
            `movingBones(max)=${Math.max(...idleA.map((w) => w.movingBones))}`,
    );
    let ctx = await getStoreCtx(page);
    console.log(
        `[MECANISMO] FASE A ctx: currentAnimation=${ctx.currentAnimation}, isPlaying=${ctx.isPlaying}, mixerActive=[${ctx.mixerActive.join(', ')}]`,
    );

    // ========================================
    // FASE B: stopAnimation() → cuerpo en reposo, mixer aún existente
    // ========================================
    console.log('[MECANISMO] ===== FASE B: stopAnimation() → reposo =====');
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().stopAnimation();
        await new Promise((r) => setTimeout(r, 600));
    });
    const restW = await measureWindows(page, 1, 500, 'B');
    const restBest = restW[0];
    console.log(`[MECANISMO] FASE B: bodyMax=${restBest.bodyMax.toExponential(3)}, movingBones=${restBest.movingBones} — esperado ≈0`);
    ctx = await getStoreCtx(page);
    console.log(
        `[MECANISMO] FASE B ctx: currentAnimation=${ctx.currentAnimation}, isPlaying=${ctx.isPlaying}, mixerActive=[${ctx.mixerActive.join(', ')}]`,
    );

    // ========================================
    // FASE C: playAnimation('Idle_3') FRESCO en mixer tibio, SIN transición
    // (el saliente ya fue detenido en B). DISCRIMINADOR CLAVE.
    // ========================================
    console.log('[MECANISMO] ===== FASE C: playAnimation("Idle_3") fresco, SIN transición =====');
    await page.evaluate(() => {
        // @ts-ignore
        window.__bunnyStore.getState().playAnimation('Idle_3' as any);
    });
    const readyC = await waitForReady(page, ['Idle_3'], 60000);
    console.log(`[MECANISMO] FASE C ready: ${readyC.ready} — activas=[${readyC.active.join(', ')}]`);
    await page.waitForTimeout(600);
    const idleC = await measureWindows(page, 4, 700, 'C');
    const bestC = idleC.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), idleC[0]);
    const maxMovingC = Math.max(...idleC.map((w) => w.movingBones));
    console.log(
        `[MECANISMO] FASE C: bodyMax=${bestC.bodyMax.toExponential(3)} (${bestC.bodyBone || 'ninguno'}), movingBones(max)=${maxMovingC}, ` +
            `serie=[${idleC.map((w) => w.bodyMax.toExponential(2)).join(', ')}]`,
    );
    ctx = await getStoreCtx(page);
    console.log(
        `[MECANISMO] FASE C ctx: currentAnimation=${ctx.currentAnimation}, isPlaying=${ctx.isPlaying}, mixerActive=[${ctx.mixerActive.join(', ')}]`,
    );

    // ========================================
    // FASE D: desde Idle_3 ACTIVO → blendAnimation(['Dance']) (EL CAMINO REAL:
    // transición con fade-out del saliente via scheduleStopAfterFade)
    // ========================================
    console.log('[MECANISMO] ===== FASE D: blendAnimation(["Dance"]) desde Idle_3 ACTIVO (transición real) =====');
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().blendAnimation(['Dance'] as any);
        await new Promise((r) => setTimeout(r, 800));
    });
    const readyD = await waitForReady(page, ['Dance'], 60000);
    console.log(`[MECANISMO] FASE D ready: ${readyD.ready} — activas=[${readyD.active.join(', ')}]`);
    await page.waitForTimeout(600);
    const danceW = await measureWindows(page, 8, 700, 'D');
    const bestD = danceW.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), danceW[0]);
    const maxMovingD = Math.max(...danceW.map((w) => w.movingBones));
    const sustainedD = danceW.filter((w) => w.movingBones >= SUSTAINED_MOVING && w.bodyMax > BODY_MAX_REAL).length;
    console.log(
        `[MECANISMO] FASE D: bodyMax=${bestD.bodyMax.toExponential(3)} (${bestD.bodyBone || 'ninguno'}), movingBones(max)=${maxMovingD}, ` +
            `sostenidas=${sustainedD}/8, serie=[${danceW.map((w) => w.bodyMax.toExponential(2)).join(', ')}]`,
    );
    ctx = await getStoreCtx(page);
    console.log(
        `[MECANISMO] FASE D ctx: currentAnimation=${ctx.currentAnimation}, isPlaying=${ctx.isPlaying}, blendQueue=[${ctx.blendQueue.join(', ')}], mixerActive=[${ctx.mixerActive.join(', ')}]`,
    );

    // ========================================
    // VEREDICTO (informativo, basado en datos; no es assert duro)
    // ========================================
    const cMoved = maxMovingC >= SUSTAINED_MOVING && bestC.bodyMax > BODY_MAX_REAL;
    const dMoved = maxMovingD >= SUSTAINED_MOVING && bestD.bodyMax > BODY_MAX_REAL;
    console.log('[MECANISMO] ==================== VEREDICTO ====================');
    if (cMoved && !dMoved) {
        console.log(
            '[MECANISMO] C (fresca, sin transición) SE MUEVE; D (transición) NO → el congelamiento es de la ruta de ' +
                'TRANSICIÓN (fade-out del saliente / scheduleStopAfterFade), NO de la creación post-montaje.',
        );
    } else if (!cMoved) {
        console.log(
            '[MECANISMO] C TAMBIÉN congelado → TODA creación post-montaje en mixer tibio se congela ' +
                '(mixer/acción desincronizado, o modelo de la escena ≠ modelo del mixer que se tickea).',
        );
    } else if (dMoved) {
        console.log(
            '[MECANISMO] C y D se mueven → el congelamiento NO se reproduce en este flujo aislado; ' +
                'depende de otro factor del flujo real (SPEAKING/emoción/override "hablando").',
        );
    }
    console.log(`[MECANISMO] Cargas del modelo detectadas: ${probeCount}`);
    console.log('[MECANISMO] ==================== FIN ====================');
});
