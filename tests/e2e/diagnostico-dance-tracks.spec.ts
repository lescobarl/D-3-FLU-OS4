// ============================================================
// diagnostico-dance-tracks.spec.ts
// CAUSA RAÍZ DEL "NO BAILA": ¿los TRACKS del clip Dance se BINDEN
// a los huesos del modelo en OS4?
//
// CONTEXTO (hechos ya probados por diagnostico-dance-aislado.spec.ts):
//   - Dance está ACTIVO en el mixer (ready=true, isPlaying=true,
//     clip cacheado) pero produce bodyMax=0.000e+0 y movingBones=0
//     en 8 ventanas de 700ms.
//   - Idle_2 mueve 97 huesos (bodyMax=1.262e-1) por el MISMO mixer
//     y el mismo useFrame(mixer.update).
//   → La ruta baila/canta→Dance es correcta. El fallo está en el
//     binding/avance del clip en el renderer OS4.
//
// VERSIÓN ANTERIOR ROTADA (evidencia de defecto real):
//   El spec antiguo encendía logsEnabled (toggleLogs) para capturar
//   el log "Único: <anim>". ESO ES AUTODESTRUCTIVO: el efecto de
//   carga del modelo tiene deps [logsEnabled] (BunnyViewer.tsx:806);
//   su cleanup llama mixer.stopAllAction()+uncacheRoot(), y
//   uncacheClip (AnimationMixer.js) lanza "Cannot set properties of
//   undefined (setting '_cacheIndex')" → corrompe el mixer → ninguna
//   acción nueva se crea y no llega ningún "Único:". Por eso la
//   primera corrida no capturó logs y no pudo concluir.
//
// ESTE TEST NO ENCIENDE LOGS. En su lugar INTROSPECTA el clip
// directamente con la MISMA función que usa la app:
//   import('/src/avatar/workers/fbxWorkerClient.ts') + loadFbx(url)
//   → group.animations[0] → duration / tracks / huesos de track.
//
// METODOLOGÍA (certezas, no probabilidades):
//   1. Cargar app en 5175, esperar modelo FBX (__bunnyProbe) →
//      huesos BASE del modelo (sin ensureBones).
//   2. Fijar IDLE y asentar 2.5s.
//   3. CONTROL conocido-bueno: blendAnimation(['Idle_3']) → medir
//      movimiento (posición + rotación) → valida el método.
//   4. blendAnimation(['Dance']) → esperar READINESS real
//      (__bunnyProbe.ready(['Dance'])) → medir 4 ventanas con métrica
//      de POSICIÓN y de ROTACIÓN (cierra el falso negativo
//      "rotación pura", que el métrico anterior no medía).
//   5. Huesos del modelo POST-Dance (ensureBones ya aplicado).
//   6. Introspectar clips Dance e Idle_3 vía loadFbx (en página):
//      duration, trackCount y huesos de track.
//   7. Comparar huesos de track vs huesos reales del modelo (base y
//      post-ensureBones).
//   8. VEREDICTO de causa raíz:
//      - Dance con 0 tracks o duration≈0 → CLIP VACÍO/MALFORMADO.
//      - Dance con tracks cuyos nombres NO existen en el modelo →
//        FALLO DE BINDING POR NOMBRE (unifySkeletons/ensureBones).
//      - Dance con tracks que SÍ existen y duration>0 → el clip
//        debería mover; el fallo sería de avance/timing (pero el
//        control Idle_3/Idle_2 por el mismo mixer lo descarta).
//
// Es DIAGNÓSTICO: registra todo y emite veredicto informativo; solo
// falla si la infraestructura (probe/readiness) no queda lista.
// ============================================================
import { test, Page } from '@playwright/test';

const BODY_MOVING_THRESHOLD = 0.001; // unidades de mundo
const ROT_THRESHOLD = 0.01; // radianes

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
    maxRot: number;
    rotBone: string;
    rotatingBones: number;
    topBones: BoneDelta[];
    jawMaxAngle: number;
    boneCount: number;
}

interface TrackDetail {
    name: string;
    keys: number;
    valueSize: number;
    valMin: number;
    valMax: number;
    spread: number;
    timeMin: number;
    timeMax: number;
}

interface ClipInfo {
    animName: string;
    duration: number;
    trackCount: number;
    trackBones: string[];
    trackDetails?: TrackDetail[];
    error?: string;
}

function quatAngle(qa: number[], qb: number[]): number {
    const dot = Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]));
    return 2 * Math.acos(dot);
}

// Mide el CUERPO (todos los huesos EXCEPTO boca) con métrica de
// POSICIÓN (deltas de mundo) y de ROTACIÓN (ángulo del quaternion).
function analyzeMotion(a: Sample, b: Sample): MotionAnalysis {
    const bones = Object.keys(b.bones ?? {});
    let bodyMax = 0;
    let bodyBone = '';
    let maxRot = 0;
    let rotBone = '';
    let jawMaxAngle = 0;
    const deltas: BoneDelta[] = [];
    let movingBones = 0;
    let rotatingBones = 0;
    for (const name of bones) {
        const pa = a.bones?.[name]?.p;
        const pb = b.bones?.[name]?.p;
        const qa = a.bones?.[name]?.q;
        const qb = b.bones?.[name]?.q;
        if (!pa || !pb) continue;
        const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
        let rot = 0;
        if (qa && qb) rot = quatAngle(qa, qb);
        const isJaw = /jaw|mouth|mand|tongue/i.test(name);
        if (isJaw) {
            if (rot > jawMaxAngle) jawMaxAngle = rot;
            continue;
        }
        if (d > bodyMax) {
            bodyMax = d;
            bodyBone = name;
        }
        if (d > BODY_MOVING_THRESHOLD) movingBones++;
        if (rot > maxRot) {
            maxRot = rot;
            rotBone = name;
        }
        if (rot > ROT_THRESHOLD) rotatingBones++;
        deltas.push({ name, d });
    }
    deltas.sort((x, y) => y.d - x.d);
    return { bodyMax, bodyBone, movingBones, maxRot, rotBone, rotatingBones, topBones: deltas.slice(0, 5), jawMaxAngle, boneCount: bones.length };
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

// Mide el movimiento del cuerpo (posición + rotación) en `count`
// ventanas de `gapMs`. Reporta también las acciones activas en cada
// ventana para detectar si el flujo de la app pisa el anim medido.
async function measureBody(page: Page, count: number, gapMs: number, label: string): Promise<void> {
    for (let i = 0; i < count; i++) {
        const a = await sampleBones(page);
        await page.waitForTimeout(gapMs);
        const b = await sampleBones(page);
        let activeNow: string[] = [];
        try {
            activeNow = await page.evaluate(() => {
                // @ts-ignore
                return window.__bunnyProbe.activeActions();
            });
        } catch (e) {}
        if (a.ok && b.ok) {
            const an = analyzeMotion(a, b);
            console.log(
                `[TRACKS] ${label} ventana ${i + 1}/${count}: activas=[${activeNow.join(', ')}] bodyMax=${an.bodyMax.toExponential(3)} (${an.bodyBone || 'ninguno'}), ` +
                    `movingBones=${an.movingBones}, maxRot=${an.maxRot.toExponential(3)} (${an.rotBone || 'ninguno'}), rotatingBones=${an.rotatingBones}, top=[${formatTop(an.topBones)}]`,
            );
        } else {
            console.log(`[TRACKS] ${label} ventana ${i + 1}/${count}: muestra inválida (activas=[${activeNow.join(', ')}])`);
        }
    }
}

// Introspecta clips SIN encender logs: usa la MISMA loadFbx de la app
// (módulo real de Vite) para parsear el FBX y leer group.animations[0].
async function introspectClips(page: Page, paths: Record<string, string>): Promise<Map<string, ClipInfo>> {
    const raw = await page.evaluate(async (pathMap) => {
        // @ts-ignore - ruta válida en runtime (Vite sirve el módulo TS)
        const mod: any = await import('/src/avatar/workers/fbxWorkerClient.ts');
        const out: Record<string, any> = {};
        for (const [name, url] of Object.entries(pathMap)) {
            try {
                const group: any = await mod.loadFbx(url);
                const clip = group && group.animations && group.animations[0];
                if (!clip) {
                    out[name] = { animName: name, duration: 0, trackCount: 0, trackBones: [], error: 'no-animations-en-fbx' };
                    continue;
                }
                const trackBones = [...new Set((clip.tracks || []).map((t: any) => (t.name || '').split('.')[0]))];
                const trackDetails: TrackDetail[] = (clip.tracks || []).map((t: any) => {
                    const times = t.times || [];
                    const vals = t.values || [];
                    let mn = Infinity;
                    let mx = -Infinity;
                    for (let k = 0; k < vals.length; k++) {
                        const vv = vals[k];
                        if (vv < mn) mn = vv;
                        if (vv > mx) mx = vv;
                    }
                    let tmin = Infinity;
                    let tmax = -Infinity;
                    for (let k = 0; k < times.length; k++) {
                        const tt = times[k];
                        if (tt < tmin) tmin = tt;
                        if (tt > tmax) tmax = tt;
                    }
                    return {
                        name: t.name || '?',
                        keys: times.length,
                        valueSize: t.valueSize ?? (typeof t.getValueSize === 'function' ? t.getValueSize() : 0),
                        valMin: mn === Infinity ? null : +mn.toFixed(5),
                        valMax: mx === -Infinity ? null : +mx.toFixed(5),
                        spread: mn === Infinity ? 0 : +Math.abs(mx - mn).toFixed(5),
                        timeMin: tmin === Infinity ? null : +tmin.toFixed(3),
                        timeMax: tmax === -Infinity ? null : +tmax.toFixed(3),
                    };
                });
                out[name] = {
                    animName: name,
                    duration: typeof clip.duration === 'number' ? clip.duration : 0,
                    trackCount: clip.tracks ? clip.tracks.length : 0,
                    trackBones,
                    trackDetails,
                };
            } catch (e: any) {
                out[name] = { animName: name, duration: 0, trackCount: 0, trackBones: [], error: e && e.message ? e.message : String(e) };
            }
        }
        return out;
    }, paths);
    const map = new Map<string, ClipInfo>();
    for (const [name, info] of Object.entries(raw)) map.set(name, info);
    return map;
}

async function captureBoneSet(page: Page): Promise<{ size: number; names: string[] }> {
    const s = await sampleBones(page);
    const names = Object.keys(s.bones ?? {});
    return { size: names.length, names };
}

function reportBinding(clip: ClipInfo | undefined, label: string, boneSet: Set<string>, boneSetLabel: string): void {
    if (!clip) {
        console.log(`[TRACKS] ${label}: SIN clip introspectado`);
        return;
    }
    if (clip.error) {
        console.log(`[TRACKS] ${label}: error de introspcción — ${clip.error}`);
        return;
    }
    const matched = clip.trackBones.filter((b) => boneSet.has(b));
    const unmatched = clip.trackBones.filter((b) => !boneSet.has(b));
    console.log(`[TRACKS] ${label}: ${matched.length}/${clip.trackBones.length} huesos de track existen en el modelo (${boneSetLabel}); duration=${clip.duration.toFixed(2)}s, tracks=${clip.trackCount}`);
    if (unmatched.length > 0) {
        const shown = unmatched.slice(0, 40);
        const suffix = unmatched.length > 40 ? ` … y ${unmatched.length - 40} más` : '';
        console.log(`[TRACKS]   NO existen en modelo (${unmatched.length}): [${shown.join(', ')}]${suffix}`);
    }
}

test('DIAGNÓSTICO CAUSA RAÍZ: ¿los tracks del clip Dance se bindean al modelo en OS4?', async ({ page }) => {
    test.setTimeout(240000);

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[TRACKS]') || text.includes('Cache SET') || text.includes('Cache MISS') || text.includes('Cached bones')) {
            console.log(`[BROWSER] ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // 1. Cargar app + esperar modelo 3D listo → huesos BASE
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    await waitForProbe(page);
    const base = await captureBoneSet(page);
    const baseSet = new Set(base.names);
    console.log(`[TRACKS] Modelo 3D cargado: ${base.size} huesos BASE (sin ensureBones)`);

    // ========================================
    // 2. Inyectar stores reales (misma secuencia que App.tsx).
    //    NO se toca logsEnabled en todo el test (corrompe el mixer).
    // ========================================
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
            // @ts-ignore
            return { success: true, logsEnabled: window.__bunnyStore.getState().logsEnabled };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
    if (!storeSetup.success) throw new Error(`No se pudieron inyectar stores: ${JSON.stringify(storeSetup)}`);
    console.log(`[TRACKS] Stores inyectados (logsEnabled intacto=${storeSetup.logsEnabled})`);

    // ========================================
    // 3. IDLE asentado (referencia del cuerpo parado)
    // ========================================
    console.log('[TRACKS] Fase IDLE asentado (referencia)...');
    await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 2500));
    });

    // ========================================
    // 4. CONTROL conocido-bueno: Idle_3 (mueve el cuerpo).
    //    Valida que el método de medición (posición+rotación)
    //    detecta movimiento a través del MISMO mixer.
    // ========================================
    console.log('[TRACKS] CONTROL: blendAnimation(["Idle_3"])...');
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().blendAnimation(['Idle_3'] as any);
        await new Promise((r) => setTimeout(r, 800));
    });
    const readyIdle = await waitForReady(page, ['Idle_3'], 60000);
    console.log(`[TRACKS] Idle_3 listo: ready=${readyIdle.ready} — activas=[${readyIdle.active.join(', ')}]`);
    await measureBody(page, 2, 700, 'CONTROL Idle_3');

    // ========================================
    // 5. DANCE aislado (misma ruta del diagnóstico anterior, SIN logs)
    // ========================================
    console.log('[TRACKS] DANCE: blendAnimation(["Dance"]) directo (sin override de hablando, sin toggleLogs)...');
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().blendAnimation(['Dance'] as any);
        await new Promise((r) => setTimeout(r, 800));
    });
    const readyDance = await waitForReady(page, ['Dance'], 60000);
    console.log(`[TRACKS] Dance listo: ready=${readyDance.ready} — activas=[${readyDance.active.join(', ')}]`);
    await measureBody(page, 4, 700, 'DANCE');

    // ========================================
    // 6. Huesos POST-Dance (ensureBones ya aplicado al cachear)
    // ========================================
    const post = await captureBoneSet(page);
    const postSet = new Set(post.names);
    const added = post.names.filter((n) => !baseSet.has(n));
    console.log(`[TRACKS] Huesos POST-Dance: ${post.size} (BASE=${base.size}); huesos añadidos por ensureBones: ${added.length}${added.length ? ` [${added.slice(0, 40).join(', ')}]` : ''}`);

    // ========================================
    // 7. Introspectar clips Dance e Idle_3 (loadFbx real, SIN logs)
    // ========================================
    console.log('[TRACKS] Introspectando clips FBX vía loadFbx (sin encender logs)...');
    const clips = await introspectClips(page, {
        Dance: '/models/Animations/Bunny@Dance.fbx',
        Idle_3: '/models/Animations/Bunny@Idle_3.fbx',
        Idle_2: '/models/Animations/Bunny@Idle_2.fbx',
    });
    const dance = clips.get('Dance');
    const idle = clips.get('Idle_3');
    const idle2 = clips.get('Idle_2');
    for (const [name, info] of clips) {
        if (info.error) {
            console.log(`[TRACKS] Clip ${name}: ERROR introspectando — ${info.error}`);
            continue;
        }
        console.log(`[TRACKS] Clip ${name}: duration=${info.duration.toFixed(2)}s, tracks=${info.trackCount}, trackBones[${info.trackBones.length}]=[${info.trackBones.slice(0, 40).join(', ')}]`);
        const td = info.trackDetails || [];
        const constant = td.filter((t) => t.spread <= 0.000001);
        const moving = td.filter((t) => t.spread > 0.000001);
        const dense = td.filter((t) => t.keys > 2);
        const degenerate = td.filter((t) => t.keys <= 2 && t.spread <= 0.000001);
        console.log(
            `[TRACKS] Clip ${name}: tracks=${td.length} → CONSTANTES(spread≈0)=${constant.length}, MOVEDORAS(spread>0)=${moving.length}, ` +
                `con >2 keys=${dense.length}, DEGENERADAS(≤2 keys y spread≈0)=${degenerate.length}`,
        );
        for (const t of td.slice(0, 25)) {
            console.log(
                `[TRACKS] Clip ${name}   track "${t.name}" keys=${t.keys} vs=${t.valueSize} ` +
                    `times=[${t.timeMin},${t.timeMax}] spread=${t.spread} vals=[${t.valMin},${t.valMax}]`,
            );
        }
    }

    // ========================================
    // 8. Comparar huesos de track vs huesos reales del modelo
    // ========================================
    reportBinding(idle, 'CONTROL Idle_3 (debería mover el cuerpo)', baseSet, 'BASE');
    reportBinding(dance, 'DANCE', baseSet, 'BASE');
    reportBinding(dance, 'DANCE', postSet, 'POST-ensureBones');

    // ========================================
    // 9. Veredicto de CAUSA RAÍZ (basado en datos)
    // ========================================
    console.log('[TRACKS] ==================== VEREDICTO CAUSA RAÍZ ====================');
    if (!dance || dance.error) {
        console.log(`[TRACKS] ⚠ No se pudo introspectar el clip Dance (${dance?.error ?? 'sin clip'}). No se puede concluir con certeza; revisar logs.`);
    } else if (dance.trackCount === 0 || dance.duration <= 0) {
        console.log(
            `[TRACKS] CAUSA RAÍZ CONFIRMADA: el clip Dance en OS4 está VACÍO/MALFORMADO ` +
                `(duration=${dance.duration.toFixed(2)}s, tracks=${dance.trackCount}). El clip no tiene keyframes que aplicar; ` +
                `por eso el mixer lo tiene ACTIVO pero no mueve nada.`,
        );
    } else {
        const matchedBase = dance.trackBones.filter((b) => baseSet.has(b)).length;
        const matchedPost = dance.trackBones.filter((b) => postSet.has(b)).length;
        const effectiveMatched = matchedPost;
        if (effectiveMatched === 0) {
            console.log(
                `[TRACKS] CAUSA RAÍZ CONFIRMADA: FALLO DE BINDING POR NOMBRE. El clip Dance tiene ` +
                    `${dance.trackCount} tracks (duration=${dance.duration.toFixed(2)}s, ${dance.trackBones.length} huesos de track) ` +
                    `pero NINGÚN hueso de track existe en el modelo (ni en BASE ni tras ensureBones: ${matchedBase}/${matchedPost}) ` +
                    `→ AnimationMixer los ignora en silencio → movimiento 0.`,
            );
        } else if (effectiveMatched < dance.trackBones.length) {
            console.log(
                `[TRACKS] CAUSA RAÍZ PARCIAL: binding PARCIAL. Solo ${effectiveMatched}/${dance.trackBones.length} ` +
                    `huesos de track existen en el modelo (BASE=${matchedBase}, POST=${matchedPost}); el resto se ignora.`,
            );
        } else {
            console.log(
                `[TRACKS] Todos los huesos de track de Dance SÍ existen en el modelo y el clip tiene ` +
                    `${dance.trackCount} tracks (duration=${dance.duration.toFixed(2)}s). Según esto el clip DEBERÍA mover; ` +
                    `el fallo sería de avance/timing (pero Idle_3/Idle_2 sí avanzan por el mismo mixer). Revisar ` +
                    `pesos/loop/tiempo específicos de la acción Dance.`,
            );
        }
        if (idle && !idle.error) {
            const matchedIdle = idle.trackBones.filter((b) => postSet.has(b)).length;
            console.log(`[TRACKS] Referencia CONTROL: Idle_3 (mueve el cuerpo) → ${matchedIdle}/${idle.trackBones.length} huesos de track en modelo, tracks=${idle.trackCount}, duration=${idle.duration.toFixed(2)}s`);
        }
        if (idle2 && !idle2.error) {
            const matchedIdle2 = idle2.trackBones.filter((b) => postSet.has(b)).length;
            const movIdle2 = (idle2.trackDetails || []).filter((t) => t.spread > 0.000001).length;
            console.log(`[TRACKS] Referencia CONTROL: Idle_2 (mueve 97 huesos) → ${matchedIdle2}/${idle2.trackBones.length} huesos de track en modelo, tracks=${idle2.trackCount}, duration=${idle2.duration.toFixed(2)}s, tracks MOVEDORAS=${movIdle2}/${idle2.trackDetails?.length ?? 0}`);
        }
    }

    // ========================================
    // 10. Contexto final del mixer
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
    console.log(`[TRACKS] Contexto final: currentAnimation=${ctx.storeCurrentAnimation}, blendQueue=[${(ctx.storeBlendQueue || []).join(', ')}], isPlaying=${ctx.storeIsPlaying}`);
    console.log(`[TRACKS] Mixer activo (final): [${ctx.mixerActive.join(', ')}]`);
    if (ctx.clipStatus) console.log(`[TRACKS] clipStatus: ${JSON.stringify(ctx.clipStatus)}`);
    console.log('[TRACKS] ==================== FIN DIAGNÓSTICO ====================');
});
