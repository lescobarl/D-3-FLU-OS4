// ============================================================
// probe-subscribers.mjs — Diagnóstico final del root-motion
// ------------------------------------------------------------
// Preguntas:
//  1. ¿En qué root/canvas está BunnyModel y su useFrame?
//     (enumerar TODOS los canvases + _roots + subscribers)
//  2. ¿Qué deltas recibe REALMENTE el AnimationMixer durante el
//     barrido sintético (settleMixer / measureRootMotion) de
//     verify-decorations.mjs?
//  3. ¿El protocolo actual (oldTime=performance.now() una sola
//     vez) corrompe el reloj de R3F (deltas ≈ ±1.7e9 s)?
//     En R3F update() [dist/events...esm.js]:
//       - SIEMPRE llama primero a clock.getDelta()  → espera
//         oldTime en MILISEGUNDOS (performance.now()).
//       - En frameloop='never' además hace:
//           oldTime = elapsedTime (SEGUNDOS)
//           elapsedTime = timestamp
//       ⇒ en la 2ª advance() getDelta() calcula
//         (now_ms − oldTime_s)/1000 ≈ ±1.7e9 s → el mixer
//         salta el clip a una fase basura (rootLocal ≈ 0).
//  4. ¿El protocolo FIJADO (oldTime=performance.now() en ms
//     ANTES DE CADA advance()) entrega deltas ≈ 0.04/0.06 s
//     y el mixer REALMENTE mueve el root (rootLocal>0.1)?
//  5. ¿Invocar directamente cada useFrame con delta fijo
//     mueve el root (cuál subscriber es el driver del animador)?
//
// Run:  node tests/e2e/probe-subscribers.mjs
// Env:  FLU_URL=http://localhost:5174/ (por defecto)
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';
const KEY = 'flag';

async function pollUntil(page, fn, timeoutMs, intervalMs) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeoutMs) {
        last = await fn();
        if (last) return last;
        await page.waitForTimeout(intervalMs);
    }
    return last;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const browserErrors = [];
page.on('pageerror', (e) => browserErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
    if (m.type() === 'error') browserErrors.push(`console.error: ${m.text()}`);
});

function fmt(v) {
    if (v === null || v === undefined) return String(v);
    if (Array.isArray(v)) return v.map((n) => Number(n).toFixed(4)).join(',');
    return Number(v).toFixed(4);
}
function fmtDelta(d) {
    if (!d) return 'n/a';
    return `max=${d.max.toFixed(4)}  ejes=[${fmt(d.axis)}]  n=${d.n}`;
}

async function waitReady(page, label) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    const preload = await pollUntil(
        page,
        () => page.evaluate(() => !!window.__bunnyPreloadDone),
        60000,
        500,
    );
    const storeSetup = await page.evaluate(async () => {
        if (window.__bunnyStore && window.__bunnyStore.getState) return { ok: true, source: 'window' };
        try {
            const m = await import('/src/avatar/store/bunnyStore.ts');
            window.__bunnyStore = m.useBunnyStore;
            return { ok: !!m.useBunnyStore, source: 'import' };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    });
    console.log(`[${label}] preload=${preload} store=${JSON.stringify(storeSetup)}`);
    return { preload, storeSetup };
}

// ------------------------------------------------------------
// FASE 0 — Enumerar canvases, roots, subscribers y huesos
// ------------------------------------------------------------
async function phase0() {
    const out = await page.evaluate(async () => {
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const canvases = Array.from(document.querySelectorAll('canvas')).map((cv, i) => {
            const cls = cv.className && cv.className.baseVal !== undefined
                ? cv.className.baseVal
                : String(cv.className || '');
            return { i, cls: cls || '(sin clase)', w: cv.width, h: cv.height };
        });
        const roots = [];
        if (R3F.r3fRoots && R3F.r3fRoots instanceof Map) {
            for (const [canvas, root] of R3F.r3fRoots.entries()) {
                const st = root.store ? root.store.getState() : null;
                const subs = (st && st.internal && st.internal.subscribers) || [];
                const sceneInfo = (() => {
                    let bones = 0, rootBone = false, headBone = false, dec = false, bunnyGroup = false;
                    if (st && st.scene) st.scene.traverse((o) => {
                        if (o.isBone) { bones++; if (o.name === 'root') rootBone = true; if (o.name === 'head') headBone = true; }
                        if (o.name === 'decoration-flag') dec = true;
                        if (o.name === 'bunny-model' || (o.userData && o.userData.bunny)) bunnyGroup = true;
                    });
                    return { bones, rootBone, headBone, dec, bunnyGroup };
                })();
                const cls = canvas.className && canvas.className.baseVal !== undefined
                    ? canvas.className.baseVal
                    : String(canvas.className || '');
                roots.push({
                    canvasCls: cls || '(sin clase)',
                    subs: subs.length,
                    subSources: subs.map((s) => String(s.ref.current).slice(0, 140)),
                    scene: sceneInfo,
                    frameloop: st ? st.frameloop : null,
                    clock: st && st.clock ? { elapsedTime: st.clock.elapsedTime, oldTime: st.clock.oldTime, running: st.clock.running } : null,
                });
            }
        }
        return { canvases, roots };
    });
    console.log('\n=== FASE 0 · canvases & roots ===');
    for (const cv of out.canvases) console.log(`  canvas[${cv.i}] cls="${cv.cls}" ${cv.w}x${cv.h}`);
    for (const r of out.roots) {
        console.log(`  root → canvas="${r.canvasCls}" subs=${r.subs} frameloop=${r.frameloop} scene=${JSON.stringify(r.scene)} clock.elapsedTime=${fmt(r.clock && r.clock.elapsedTime)}`);
        r.subSources.forEach((src, i) => console.log(`      sub[${i}] ${src}`));
    }
    return out;
}

// ------------------------------------------------------------
// Marcha sintética (replica measureRootMotion) con modo de reloj
//   mode='buggy' → protocolo actual (oldTime=ms UNA vez)
//   mode='fixed' → protocolo fijado (oldTime=ms ANTES de CADA advance)
// ------------------------------------------------------------
async function runMarch(mode) {
    const out = await page.evaluate(async ({ mode, k }) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const getState = () => (store && store.getState ? store.getState() : null);
        const s0 = getState();
        if (!s0 || !s0.scene) return { ok: false, reason: 'no-scene' };
        const advance = s0.advance;
        if (typeof advance !== 'function') return { ok: false, reason: 'no-advance' };
        const st = window.__bunnyStore && window.__bunnyStore.getState();
        if (!st || !st.playAnimation) return { ok: false, reason: 'no-store' };

        // 1) Instrumentar el mixer ANTES de tocar nada
        const mixerLog = [];
        const mixerInstances = [];
        const origUpdate = THREE.AnimationMixer.prototype.update;
        THREE.AnimationMixer.prototype.update = function (delta) {
            if (!mixerInstances.includes(this)) mixerInstances.push(this);
            mixerLog.push(delta);
            return origUpdate.call(this, delta);
        };

        try {
            st.setDecoration(k);
            await new Promise((r) => setTimeout(r, 400));
            st.playAnimation('Bind-pose');
            await new Promise((r) => setTimeout(r, 400));
            st.playAnimation('Jump_while_run');
            await new Promise((r) => setTimeout(r, 50)); // React commitea crossFadeTo

            // 2) Marcha sintética
            store.setState({ frameloop: 'never' });
            const clk0 = getState().clock;
            const origElapsed = clk0.elapsedTime;
            let t = origElapsed;
            clk0.oldTime = performance.now();       // ms (inicial)
            clk0.elapsedTime = t;

            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const step = async (sec) => {
                await sleep(1);
                t += sec;
                if (mode === 'fixed') getState().clock.oldTime = performance.now(); // FIX: ms antes de CADA advance
                advance(t);
            };

            // Asentar crossfade (0.8 s) + localizar nodos
            for (let i = 0; i < 20; i++) await step(0.04);
            let dec = null, rootBone = null, headBone = null;
            const scene = getState().scene;
            scene.traverse((o) => {
                if (o.name === `decoration-${k}`) dec = o;
                if (o.name === 'root' && o.type === 'Bone') rootBone = o;
                if (o.name === 'head' && o.type === 'Bone') headBone = o;
            });

            // 3) Muestreo a lo largo del clip
            const decSamples = [], rootLocalSamples = [], headWorldSamples = [];
            const v = new THREE.Vector3();
            const CLIP_S = 20.5, STEP_S = 0.06;
            let subscribersDuring = 0;
            for (let animS = 0; animS < CLIP_S; animS += STEP_S) {
                scene.updateMatrixWorld(true);
                if (dec) { dec.getWorldPosition(v); decSamples.push([v.x, v.y, v.z]); }
                if (rootBone) rootLocalSamples.push([rootBone.position.x, rootBone.position.y, rootBone.position.z]);
                if (headBone) { headBone.getWorldPosition(v); headWorldSamples.push([v.x, v.y, v.z]); }
                subscribersDuring = (getState().internal && getState().internal.subscribers) ? getState().internal.subscribers.length : 0;
                await step(STEP_S);
            }
            const delta = (arr) => {
                if (!arr || arr.length < 2) return { max: 0, axis: [0, 0, 0], n: arr ? arr.length : 0 };
                let m = 0;
                const axis = [0, 0, 0];
                for (let i = 1; i < arr.length; i++) {
                    for (let a = 0; a < 3; a++) {
                        const d = Math.abs(arr[i][a] - arr[0][a]);
                        axis[a] = Math.max(axis[a], d);
                        m = Math.max(m, d);
                    }
                }
                return { max: m, axis, n: arr.length };
            };

            // 4) Estado de las acciones del mixer
            const actions = [];
            for (const mix of mixerInstances) {
                for (const act of (mix._actions || [])) {
                    let clipName = '', duration = 0;
                    try { clipName = act.getClip().name; duration = act.getClip().duration; } catch (e) { /* noop */ }
                    actions.push({
                        clip: clipName,
                        duration,
                        enabled: act.enabled,
                        paused: act.paused,
                        time: act.time,
                        weight: act.getEffectiveWeight ? act.getEffectiveWeight() : null,
                        running: act.isRunning ? act.isRunning() : null,
                        scheduled: act.isScheduled ? act.isScheduled() : null,
                    });
                }
            }

            const clkEnd = getState().clock;
            const mixerStats = (() => {
                if (!mixerLog.length) return { count: 0 };
                let min = Infinity, max = -Infinity;
                for (const d of mixerLog) { if (d < min) min = d; if (d > max) max = d; }
                return { count: mixerLog.length, min, max, first5: mixerLog.slice(0, 5) };
            })();

            return {
                ok: true,
                mode,
                mixerStats,
                deltas: {
                    dec: delta(decSamples),
                    rootLocal: delta(rootLocalSamples),
                    headWorld: delta(headWorldSamples),
                },
                subscribersDuring,
                actions,
                mixerInstances: mixerInstances.length,
                clock: { origElapsed, elapsedEnd: clkEnd.elapsedTime, oldTimeEnd: clkEnd.oldTime },
                firstLast: {
                    rootLocal0: rootLocalSamples[0],
                    rootLocalLast: rootLocalSamples[rootLocalSamples.length - 1],
                },
            };
        } finally {
            THREE.AnimationMixer.prototype.update = origUpdate;
            store.setState({ frameloop: 'always' });
            const clk = getState().clock;
            clk.oldTime = performance.now();
            clk.elapsedTime = 0;
            if (getState().invalidate) getState().invalidate();
        }
    }, { mode, k: KEY });

    if (!out.ok) {
        console.log(`[${mode}] ERROR: ${out.reason}`);
        return out;
    }
    const ms = out.mixerStats;
    console.log(`\n=== MARCHA ${mode.toUpperCase()} (protocolo de reloj ${mode === 'fixed' ? 'FIJADO' : 'ACTUAL'}) ===`);
    console.log(`  mixer.update: ${ms.count} llamadas · instances=${out.mixerInstances}`);
    if (ms.count) {
        console.log(`    deltas: first5=[${ms.first5.map((d) => d.toFixed(3)).join(', ')}]  min=${ms.min.toFixed(3)}  max=${ms.max.toFixed(3)}`);
        const huge = ms.max > 1e6 || ms.min < -1e6;
        console.log(`    → ${huge ? 'DELTAS HUGE (±1e9 s): reloj R3F CORROMPIDO (2ª advance en adelante)' : 'deltas normales (≈ paso): reloj OK'}`);
    }
    console.log(`  deltas  dec       ${fmtDelta(out.deltas.dec)}`);
    console.log(`          rootLocal ${fmtDelta(out.deltas.rootLocal)}`);
    console.log(`          headWorld ${fmtDelta(out.deltas.headWorld)}`);
    console.log(`  subscribersDuring=${out.subscribersDuring}`);
    console.log(`  rootLocal primero=[${fmt(out.firstLast.rootLocal0)}] último=[${fmt(out.firstLast.rootLocalLast)}]`);
    console.log(`  clock: origElapsed=${fmt(out.clock.origElapsed)} elapsedEnd=${fmt(out.clock.elapsedEnd)} oldTimeEnd=${fmt(out.clock.oldTimeEnd)}`);
    for (const a of out.actions) {
        console.log(`  action  clip="${a.clip}" dur=${a.duration.toFixed(3)} time=${a.time.toFixed(3)} enabled=${a.enabled} paused=${a.paused} weight=${a.weight != null ? a.weight.toFixed(3) : 'n/a'} running=${a.running} scheduled=${a.scheduled}`);
    }
    return out;
}

// ------------------------------------------------------------
// FASE 3 — Invocación DIRECTA de cada subscriber (delta fijo 0.04)
// ------------------------------------------------------------
async function phase3() {
    const out = await page.evaluate(async () => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const getState = () => (store && store.getState ? store.getState() : null);
        const s0 = getState();
        if (!s0 || !s0.scene) return { ok: false, reason: 'no-scene' };
        let rootBone = null, headBone = null;
        s0.scene.traverse((o) => {
            if (o.name === 'root' && o.type === 'Bone') rootBone = o;
            if (o.name === 'head' && o.type === 'Bone') headBone = o;
        });
        const subs = (getState().internal && getState().internal.subscribers) || [];
        const origUpdate = THREE.AnimationMixer.prototype.update;
        const mixerLog = [];
        THREE.AnimationMixer.prototype.update = function (delta) {
            mixerLog.push(delta);
            return origUpdate.call(this, delta);
        };
        try {
            store.setState({ frameloop: 'never' }); // detener el rAF real
            const per = [];
            for (let si = 0; si < subs.length; si++) {
                const s = subs[si];
                const cb = s && s.ref ? s.ref.current : null;
                const rl0 = rootBone ? [rootBone.position.x, rootBone.position.y, rootBone.position.z] : null;
                const hw0 = headBone ? headBone.getWorldPosition(new THREE.Vector3()) : null;
                let rlMax = 0, hwMax = 0;
                for (let j = 0; j < 5; j++) {
                    if (cb) cb(getState(), 0.04);
                    s0.scene.updateMatrixWorld(true);
                    if (rootBone) {
                        rlMax = Math.max(rlMax,
                            Math.abs(rootBone.position.x - rl0[0]),
                            Math.abs(rootBone.position.y - rl0[1]),
                            Math.abs(rootBone.position.z - rl0[2]));
                    }
                    if (headBone) {
                        const w = headBone.getWorldPosition(new THREE.Vector3());
                        hwMax = Math.max(hwMax, Math.abs(w.x - hw0.x), Math.abs(w.y - hw0.y), Math.abs(w.z - hw0.z));
                    }
                }
                per.push({ idx: si, src: String(cb).slice(0, 140), rlMax, hwMax, mixerCalls: mixerLog.length });
            }
            return { ok: true, subs: subs.length, per, mixerTotal: mixerLog.length };
        } finally {
            THREE.AnimationMixer.prototype.update = origUpdate;
            store.setState({ frameloop: 'always' });
            if (getState().invalidate) getState().invalidate();
        }
    });
    console.log('\n=== FASE 3 · invocación DIRECTA de cada subscriber (5× delta 0.04) ===');
    if (!out.ok) {
        console.log(`  ERROR: ${out.reason}`);
        return out;
    }
    for (const p of out.per) {
        console.log(`  sub[${p.idx}] rlMax=${p.rlMax.toFixed(4)} hwMax=${p.hwMax.toFixed(4)} mixerCalls=${p.mixerCalls} src=${p.src}`);
    }
    console.log(`  mixer.update total=${out.mixerTotal} (solo el sub animador debería invocarlo)`);
    return out;
}

try {
    console.log(`\n=== PROBE SUBSCRIBERS / MIXER (root-motion) ===\nURL: ${URL}\n`);

    // FASE 0
    await waitReady(page, 'fase0');
    await phase0();

    // FASE 1 — protocolo ACTUAL (buggy): recargar para mixer limpio
    await waitReady(page, 'fase1');
    const buggy = await runMarch('buggy');

    // FASE 2 — protocolo FIJADO: recargar para mixer limpio
    await waitReady(page, 'fase2');
    const fixed = await runMarch('fixed');

    // FASE 3 — invocación directa (misma página que fase2)
    await phase3();

    // VEREDICTO
    console.log('\n=== VEREDICTO ===');
    if (buggy.ok && fixed.ok) {
        const b = buggy.deltas, f = fixed.deltas;
        const buggyHuge = buggy.mixerStats.max > 1e6 || buggy.mixerStats.min < -1e6;
        console.log(`  ACTUAL (buggy): deltas huge=${buggyHuge}  rootLocal.max=${b.rootLocal.max.toFixed(4)}  headWorld.max=${b.headWorld.max.toFixed(4)}`);
        console.log(`  FIJADO (fixed): rootLocal.max=${f.rootLocal.max.toFixed(4)}  headWorld.max=${f.headWorld.max.toFixed(4)}  dec.max=${f.dec.max.toFixed(4)}`);
        if (buggyHuge && f.rootLocal.max > 0.02) {
            console.log('  → CONFIRMADO: el protocolo actual corrompe el reloj (deltas ±1e9 s) y');
            console.log('    el mixer salta a fase basura. El FIX (oldTime=performance.now() en ms');
            console.log('    ANTES de cada advance) produce deltas ≈ paso y el root SÍ se mueve.');
        } else if (f.rootLocal.max < 0.02) {
            console.log('  → El protocolo fijado NO mueve el root: revisar subscribers/animador.');
        } else {
            console.log('  → El protocolo actual NO produjo deltas huge: revisar hipótesis.');
        }
    }

    console.log(`\n[browserErrors] ${browserErrors.length ? browserErrors.join('\n') : 'ninguno'}`);
} catch (err) {
    console.error('[probe] ERROR:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
} finally {
    await browser.close();
}
