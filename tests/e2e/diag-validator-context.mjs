// ============================================================
// diag-validator-context.mjs — ¿por qué el mixer se congela en
// el contexto de verify-decorations.mjs (una sola página con ~9
// toggles de frameloop vía settleMixer) pero NO en diag-mixer-state?
// ============================================================
// Replica EXACTAMENTE la secuencia del validador:
//   1) Bucle de decoraciones (4 keys): playAnimation('Bind-pose')
//      -> settleMixer(0.8) -> setDecoration(key) -> 150ms
//      -> settleMixer(0.5)     (sin capturas ni screenshots)
//   2) Root-motion: setDecoration('flag') -> 150ms
//      -> settleMixer(0.7) -> playAnimation('Jump_while_run')
//      -> 350ms -> 36 x 150ms de muestreo
// En cada muestra captura: internal.active, internal.frames,
// frameloop, clock.elapsedTime (¿avanza el rAF real?), y las
// posiciones root/head/dec. Si clock.elapsedTime NO avanza entre
// muestras -> el bucle rAF no llama a update() -> useFrame muerto.
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';
const DECORATIONS = ['santa-hat', 'party-hat', 'flag', 'crown'];
const SAMPLES = 36;
const STEP_MS = 150;

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

// settleMixer — MISMA implementación que verify-decorations.mjs
async function settleMixer(page, seconds, stepSec = 0.04) {
    return page.evaluate(async ({ total, step }) => {
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const getState = () => (store && store.getState ? store.getState() : null);
        const s0 = getState();
        if (!s0 || typeof s0.advance !== 'function') return { ok: false, reason: 'no-advance' };
        store.setState({ frameloop: 'never' });
        const origElapsed = getState().clock.elapsedTime;
        let t = origElapsed;
        getState().clock.oldTime = performance.now();
        getState().clock.elapsedTime = t;
        try {
            for (let el = 0; el < total; el += step) {
                getState().clock.oldTime = performance.now();
                t += step;
                s0.advance(t);
                await new Promise((r) => setTimeout(r, 1));
            }
            return { ok: true };
        } finally {
            store.setState({ frameloop: 'always' });
            const clk = getState().clock;
            clk.oldTime = performance.now();
            clk.elapsedTime = origElapsed;
            if (getState().invalidate) getState().invalidate();
        }
    }, { total: seconds, step: stepSec });
}

// Sonda del estado del bucle (fuera de cualquier playAnimation)
async function probeLoop(page, label) {
    const out = await page.evaluate(async () => {
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const getState = () => (root && root.store && root.store.getState ? root.store.getState() : null);
        const s = getState();
        if (!s) return { ok: false };
        const snap = () => ({
            elapsed: s.clock.elapsedTime,
            active: s.internal && s.internal.active,
            frames: s.internal && s.internal.frames,
            frameloop: s.frameloop,
            subs: (s.internal && s.internal.subscribers ? s.internal.subscribers.length : 0),
        });
        const t0 = await snap();
        await new Promise((r) => setTimeout(r, 600)); // 600ms reales
        const t1 = await snap();
        return {
            ok: true,
            before: t0,
            after: t1,
            elapsedDelta: t1.elapsed - t0.elapsed,
        };
    });
    if (!out.ok) {
        console.log(`[${label}] ERROR: no-store`);
        return;
    }
    console.log(`\n--- ${label} (600ms reales) ---`);
    console.log(`  ANTES  : elapsed=${fmt(out.before.elapsed)} active=${out.before.active} frames=${out.before.frames} frameloop=${out.before.frameloop} subs=${out.before.subs}`);
    console.log(`  DESPUES: elapsed=${fmt(out.after.elapsed)} active=${out.after.active} frames=${out.after.frames} frameloop=${out.after.frameloop} subs=${out.after.subs}`);
    console.log(`  elapsedDelta(600ms) = ${fmt(out.elapsedDelta)}  -> ${out.elapsedDelta > 0.2 ? 'EL RELOJ AVANZA (rAF vivo)' : 'RELOJ CONGELADO (rAF muerto)'}`);
}

// Muestreo de root/head/dec + estado del bucle, en el momento root-motion
async function sampleMotion(page, label) {
    const out = await page.evaluate(async ({ n, stepMs }) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const getState = () => (store && store.getState ? store.getState() : null);
        const s0 = getState();
        const scene = s0 && s0.scene;
        if (!scene) return { ok: false, reason: 'no-scene' };

        let rootBone = null;
        let headBone = null;
        let dec = null;
        scene.traverse((o) => {
            if (o.name === 'root' && o.type === 'Bone') rootBone = o;
            if (o.name === 'head' && o.type === 'Bone') headBone = o;
            if (o.name === 'decoration-flag') dec = o;
        });
        if (!rootBone) return { ok: false, reason: 'no-rootBone' };

        const rows = [];
        const v = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
            scene.updateMatrixWorld(true);
            const rl = [rootBone.position.x, rootBone.position.y, rootBone.position.z];
            rootBone.getWorldPosition(v);
            const rw = [v.x, v.y, v.z];
            let hl = null;
            let hw = null;
            if (headBone) {
                hl = [headBone.position.x, headBone.position.y, headBone.position.z];
                headBone.getWorldPosition(v);
                hw = [v.x, v.y, v.z];
            }
            let dw = null;
            if (dec) {
                dec.getWorldPosition(v);
                dw = [v.x, v.y, v.z];
            }
            rows.push({
                i,
                elapsed: s0.clock.elapsedTime,
                frames: s0.internal && s0.internal.frames,
                frameloop: s0.frameloop,
                active: s0.internal && s0.internal.active,
                subs: s0.internal && s0.internal.subscribers ? s0.internal.subscribers.length : 0,
                rl, rw, hl, hw, dw,
                t: performance.now(),
            });
            await new Promise((r) => setTimeout(r, stepMs));
        }

        const delta = (arr, ref) => {
            const base = ref || arr[0] || [0, 0, 0];
            let m = 0;
            const axis = [0, 0, 0];
            for (let i = 0; i < arr.length; i++) {
                if (!arr[i]) continue;
                for (let a = 0; a < 3; a++) {
                    const d = Math.abs(arr[i][a] - base[a]);
                    axis[a] = Math.max(axis[a], d);
                    m = Math.max(m, d);
                }
            }
            return { max: m, axis };
        };
        const arrOf = (k) => rows.map((r) => r[k]);
        return {
            ok: true,
            rows,
            delta: {
                rootLocal: delta(arrOf('rl')),
                rootWorld: delta(arrOf('rw')),
                headLocal: headBone ? delta(arrOf('hl')) : null,
                headWorld: headBone ? delta(arrOf('hw')) : null,
                decWorld: dec ? delta(arrOf('dw')) : null,
            },
            elapsedFirst: rows[0].elapsed,
            elapsedLast: rows[rows.length - 1].elapsed,
        };
    }, { n: SAMPLES, stepMs: STEP_MS });

    if (!out.ok) {
        console.log(`[${label}] ERROR: ${out.reason}`);
        return out;
    }

    console.log(`\n--- ${label} (${out.rows.length} muestras x ${STEP_MS}ms) ---`);
    console.log(`  clock.elapsedTime: 1ª=${fmt(out.elapsedFirst)}  última=${fmt(out.elapsedLast)}  Δ=${fmt(out.elapsedLast - out.elapsedFirst)}`);
    for (const [k, d] of Object.entries(out.delta)) {
        if (!d) continue;
        console.log(`  ${k.padEnd(11)} max=${d.max.toFixed(4)}  axis=[${fmt(d.axis)}]`);
    }
    let lastElapsed = null;
    for (const r of out.rows) {
        const eD = lastElapsed === null ? '-' : (r.elapsed - lastElapsed).toFixed(3);
        lastElapsed = r.elapsed;
        console.log(
            `  i=${String(r.i).padStart(2)} t+${String((r.i > 0 ? (r.t - out.rows[r.i - 1].t) : 0).toFixed(0)).padStart(4)}ms` +
            `  el+${eD.padStart(6)}  frame=${String(r.frameloop).padStart(6)} act=${r.active} fr=${r.frames} subs=${r.subs}` +
            `  rootL[${fmt(r.rl)}]  headW[${r.hw ? fmt(r.hw) : 'n/a'}]` +
            (r.dw ? `  decW[${fmt(r.dw)}]` : '')
        );
    }
    return out;
}

// Réplica EXACTA de measureRootMotion del validador: captura las
// referencias dec/rootBone/headBone y ref=readRow() ANTES de
// playAnimation, y muestrea con ESAS referencias precapturadas.
// Si devuelve 0.0000 -> las referencias precapturadas quedaron
// huérfanas (el re-render de React reemplazó la decoración/huesos).
async function measureValidatorStyle(page, label) {
    const out = await page.evaluate(async ({ n, stepMs }) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const getState = () => (store && store.getState ? store.getState() : null);
        const s0 = getState();
        const scene = s0 && s0.scene;
        const st = window.__bunnyStore && window.__bunnyStore.getState();
        if (!scene || !st || !st.playAnimation) return { ok: false, reason: 'no-scene-or-store' };

        let dec = null;
        let rootBone = null;
        let headBone = null;
        scene.traverse((o) => {
            if (o.name === 'decoration-flag') dec = o;
            if (o.name === 'root' && o.type === 'Bone') rootBone = o;
            if (o.name === 'head' && o.type === 'Bone') headBone = o;
        });
        if (!dec || !dec.parent) return { ok: false, reason: 'no-dec' };

        const v = new THREE.Vector3();
        const readRow = () => {
            scene.updateMatrixWorld(true);
            const row = { dec: null, parent: null, rootLocal: null, parentLocal: null, headWorld: null };
            dec.getWorldPosition(v);
            row.dec = [v.x, v.y, v.z];
            dec.parent.getWorldPosition(v);
            row.parent = [v.x, v.y, v.z];
            if (rootBone) row.rootLocal = [rootBone.position.x, rootBone.position.y, rootBone.position.z];
            row.parentLocal = [dec.parent.position.x, dec.parent.position.y, dec.parent.position.z];
            if (headBone) {
                headBone.getWorldPosition(v);
                row.headWorld = [v.x, v.y, v.z];
            }
            return row;
        };
        const ref = readRow();
        const quat0 = dec.parent.quaternion.clone();

        st.playAnimation('Jump_while_run');
        await new Promise((r) => setTimeout(r, 350));

        const decSamples = [];
        const parentSamples = [];
        const rootLocalSamples = [];
        const parentLocalSamples = [];
        const headWorldSamples = [];
        let parentQuatMaxDeg = 0;
        for (let i = 0; i < n; i++) {
            const row = readRow();
            decSamples.push(row.dec);
            parentSamples.push(row.parent);
            if (row.rootLocal) rootLocalSamples.push(row.rootLocal);
            parentLocalSamples.push(row.parentLocal);
            if (row.headWorld) headWorldSamples.push(row.headWorld);
            const ang = dec.parent.quaternion.angleTo(quat0) * 180 / Math.PI;
            if (ang > parentQuatMaxDeg) parentQuatMaxDeg = ang;
            await new Promise((r) => setTimeout(r, stepMs));
        }

        const delta = (arr, base) => {
            let m = 0;
            const axis = [0, 0, 0];
            const refArr = base || arr[0] || [0, 0, 0];
            for (let i = 0; i < arr.length; i++) {
                if (!arr[i]) continue;
                for (let a = 0; a < 3; a++) {
                    const d = Math.abs(arr[i][a] - refArr[a]);
                    axis[a] = Math.max(axis[a], d);
                    m = Math.max(m, d);
                }
            }
            return { max: m, axis };
        };

        let decStillInScene = false;
        let rootBoneStillInScene = false;
        if (dec) { scene.traverse((o) => { if (o === dec) decStillInScene = true; }); }
        if (rootBone) { scene.traverse((o) => { if (o === rootBone) rootBoneStillInScene = true; }); }

        return {
            ok: true,
            parentName: dec.parent.name || dec.parent.type,
            parentIsBone: dec.parent.type === 'Bone',
            dec: delta(decSamples, ref.dec),
            parent: delta(parentSamples, ref.parent),
            diag: {
                rootLocal: rootBone ? delta(rootLocalSamples, ref.rootLocal) : null,
                headWorld: headBone ? delta(headWorldSamples, ref.headWorld) : null,
                parentLocal: delta(parentLocalSamples, ref.parentLocal),
                parentQuatMaxDeg,
                alive: { decStillInScene, rootBoneStillInScene },
                decParentName: dec.parent.name,
                decParentType: dec.parent.type,
            },
        };
    }, { n: SAMPLES, stepMs: STEP_MS });

    if (!out.ok) {
        console.log(`[${label}] ERROR: ${out.reason}`);
        return;
    }
    console.log(`\n--- ${label} (réplica exacta del validador, refs ANTES de play) ---`);
    console.log(`  parentName=${out.parentName} parentIsBone=${out.parentIsBone}  decParent=${out.diag.decParentName}/${out.diag.decParentType}`);
    console.log(`  dec(max=${out.dec.max.toFixed(4)} axis=[${fmt(out.dec.axis)}])  parent(max=${out.parent.max.toFixed(4)})`);
    console.log(`  diag: rootLocal(max=${fmt(out.diag.rootLocal ? out.diag.rootLocal.max : null)})  headWorld(max=${fmt(out.diag.headWorld ? out.diag.headWorld.max : null)})  parentLocal(max=${fmt(out.diag.parentLocal.max)})  parentQuat=${out.diag.parentQuatMaxDeg.toFixed(2)}°`);
    console.log(`  alive: decStillInScene=${out.diag.alive.decStillInScene}  rootBoneStillInScene=${out.diag.alive.rootBoneStillInScene}  ${(out.diag.alive.decStillInScene && out.diag.alive.rootBoneStillInScene) ? '(refs VIVAS)' : '>>> REFS HUÉRFANAS (React reemplazó los objetos)'}`);
}

try {
    console.log(`\n=== DIAG · contexto del validador (una sola página, ~9 settleMixer) ===\nURL: ${URL}\n`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });

    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        const done = await page.evaluate(() => !!window.__bunnyPreloadDone);
        if (done) break;
        await page.waitForTimeout(500);
    }

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
    console.log('[store]', JSON.stringify(storeSetup));

    // ---- Estado del bucle en página FRESCA (baseline) ----
    await probeLoop(page, 'BASELINE (página fresca, frameloop nativo)');

    // ---- 1) Bucle de decoraciones (idéntico al validador) ----
    console.log('\n=== Bucle de decoraciones (4 keys) ===');
    for (const key of DECORATIONS) {
        await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Bind-pose'));
        await settleMixer(page, 0.8);
        await page.evaluate((k) => window.__bunnyStore.getState().setDecoration(k), key);
        await page.waitForTimeout(150);
        await settleMixer(page, 0.5);
        console.log(`  [${key}] decorado + settleMixer(0.5) OK`);
    }

    // ---- Estado del bucle DESPUÉS del bucle de decoraciones ----
    await probeLoop(page, 'TRAS 8 settleMixer (fin bucle decoraciones)');

    // ---- 2) Root-motion: setDecoration('flag') -> settleMixer(0.7) ----
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration('flag'));
    await page.waitForTimeout(150);
    await settleMixer(page, 0.7);
    await probeLoop(page, 'TRAS settleMixer(0.7) PRE-Jump (momento exacto del validador)');

    // ---- 3) playAnimation('Jump_while_run') + muestreo ----
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Jump_while_run'));
    await page.waitForTimeout(350);
    await sampleMotion(page, 'ROOT-MOTION (Jump_while_run, 36 muestras)');

    // ---- Réplica EXACTA del validador: reset a Bind-pose, asentar y medir con
    //      referencias capturadas ANTES de playAnimation (igual que measureRootMotion) ----
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Bind-pose'));
    await settleMixer(page, 0.8);
    await measureValidatorStyle(page, 'REPLICA VALIDADOR (refs ANTES de play)');

    console.log(`\n[browserErrors] ${browserErrors.length ? browserErrors.join('\n') : 'ninguno'}`);
} catch (err) {
    console.error('[diag] ERROR:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
} finally {
    await browser.close();
}
