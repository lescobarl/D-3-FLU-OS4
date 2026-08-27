// ============================================================
// diag-blend-race.mjs — ¿la blendQueue residual de la app ANULA
// el playAnimation() de la validación?
// ------------------------------------------------------------
// Hipótesis (confirmada por lectura de código):
//   - playAnimation() (bunnyStore.ts L201-218) NO limpia blendQueue.
//   - El efecto de playback (BunnyModel.tsx L211-254) da PRIORIDAD
//     a la ruta blended: si isPlaying && blendQueue.length > 0 →
//     crossFadeToBlended(...) y return → la animación simple del
//     test se ignora silenciosamente.
//   - setExpression() PUEBLA blendQueue (bunnyStore.ts L305-332).
//     El estado inicial tiene currentExpression='atencion' y la app
//     (AvatarVoiceSync) llama setExpression('hablando'/'Pensando'/...)
//     que dejan blendQueue con [Idle_x, MouthMove], [Emo_blink, ...].
//
// Este diag REPLICA la secuencia del validador verify-decorations.mjs
// (bucle de decoraciones + root-motion step) y, en cada fase, LEE
// window.__bunnyStore.getState() (blendQueue / currentAnimation /
// isPlaying / currentExpression) y además muestrea 8×150ms las
// posiciones de mundo de dec/head/rootBone/pelvis/jaw_01/joint3 y
// el top de huesos móviles, para correlacionar:
//   blendQueue != []  →  cuerpo congelado + boca moviéndose
// (la boca la mueve el clip sintético MouthMove de la blendQueue).
//
// Run:  node tests/e2e/diag-blend-race.mjs
// Env:  FLU_URL=http://localhost:5174/ (por defecto)
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';
const DECORATIONS = ['santa-hat', 'party-hat', 'flag', 'crown'];
const SAMPLES = 8;
const STEP_MS = 150;

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

// settleMixer — MISMA implementación que verify-decorations.mjs (reloj sintético)
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

// Snapshot del estado del STORE (lo que el efecto de playback realmente ve)
async function readStore(page, label) {
    const out = await page.evaluate(() => {
        const st = window.__bunnyStore && window.__bunnyStore.getState ? window.__bunnyStore.getState() : null;
        if (!st) return { ok: false };
        return {
            ok: true,
            currentAnimation: st.currentAnimation,
            isPlaying: st.isPlaying,
            currentExpression: st.currentExpression,
            blendQueue: Array.isArray(st.blendQueue) ? [...st.blendQueue] : null,
            activeDecoration: st.activeDecoration,
        };
    });
    if (!out.ok) { console.log(`[${label}] ERROR: no-store`); return null; }
    // Ruta que activaría el efecto: blended tiene prioridad estricta
    let path = 'STOP';
    if (out.isPlaying && out.blendQueue && out.blendQueue.length > 0) path = 'BLENDED (prioridad → sobreescribe single)';
    else if (out.isPlaying && out.currentAnimation) path = 'SINGLE (crossFadeTo normal)';
    console.log(`[${label}] anim=${out.currentAnimation}  isPlaying=${out.isPlaying}  expr=${out.currentExpression}  blendQueue=${JSON.stringify(out.blendQueue)}  dec=${out.activeDecoration}`);
    console.log(`          → ruta activa: ${path}`);
    return { ...out, path };
}

// Muestreo 8×150ms: posiciones de mundo + state del store en cada tick
async function sampleWithStore(page, label, anim) {
    const out = await page.evaluate(async ({ n, stepMs, a }) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const rstore = root && root.store;
        const scene = rstore && rstore.getState && rstore.getState().scene;
        if (!scene) return { ok: false, reason: 'no-scene' };

        // UBICAR nodos
        let dec = null;
        let headBone = null;
        let rootBone = null;
        let pelvisBone = null;
        let jaw = null;
        let joint3 = null;
        scene.traverse((o) => {
            if (o.name === 'decoration-flag') dec = o;
            if (o.name === 'head' && o.isBone) headBone = o;
            if (o.name === 'root' && o.isBone) rootBone = o;
            if (o.name === 'pelvis' && o.isBone) pelvisBone = o;
            if (o.name === 'jaw_01' && o.isBone) jaw = o;
            if (o.name === 'joint3' && o.isBone) joint3 = o;
        });

        const readStoreSnap = () => {
            const st = window.__bunnyStore && window.__bunnyStore.getState ? window.__bunnyStore.getState() : null;
            if (!st) return null;
            return {
                currentAnimation: st.currentAnimation,
                isPlaying: st.isPlaying,
                currentExpression: st.currentExpression,
                blendQueue: Array.isArray(st.blendQueue) ? [...st.blendQueue] : null,
            };
        };

        const v = new THREE.Vector3();
        const sample = (obj) => {
            if (!obj) return null;
            obj.getWorldPosition(v);
            return [v.x, v.y, v.z];
        };

        const tracked = { dec: [], head: [], rootBone: [], pelvis: [], jaw: [], joint3: [] };
        const storeSnaps = [];
        const boneSampleMap = new Map();

        for (let i = 0; i < n; i++) {
            scene.updateMatrixWorld(true);
            const d = sample(dec);
            const h = sample(headBone);
            const rb = sample(rootBone);
            const p = sample(pelvisBone);
            const jw = sample(jaw);
            const j3 = sample(joint3);
            if (d) tracked.dec.push(d);
            if (h) tracked.head.push(h);
            if (rb) tracked.rootBone.push(rb);
            if (p) tracked.pelvis.push(p);
            if (jw) tracked.jaw.push(jw);
            if (j3) tracked.joint3.push(j3);
            storeSnaps.push(readStoreSnap());

            // todos los huesos (top movers)
            scene.traverse((o) => {
                if (!o.isBone) return;
                const w = new THREE.Vector3();
                o.getWorldPosition(w);
                let arr = boneSampleMap.get(o.name);
                if (!arr) { arr = []; boneSampleMap.set(o.name, arr); }
                if (arr.length < n) arr.push([w.x, w.y, w.z]);
            });

            await new Promise((r) => setTimeout(r, stepMs));
        }

        const delta = (arr) => {
            if (!arr || arr.length < 2) return 0;
            let m = 0;
            for (let i = 1; i < arr.length; i++) {
                m = Math.max(
                    m,
                    Math.abs(arr[i][0] - arr[0][0]),
                    Math.abs(arr[i][1] - arr[0][1]),
                    Math.abs(arr[i][2] - arr[0][2]),
                );
            }
            return m;
        };

        const movers = [];
        for (const [name, arr] of boneSampleMap.entries()) {
            const m = delta(arr);
            if (m > 0.001) movers.push({ name, max: m });
        }
        movers.sort((x, y) => y.max - x.max);

        return {
            ok: true,
            dec: delta(tracked.dec),
            head: delta(tracked.head),
            rootBone: delta(tracked.rootBone),
            pelvis: delta(tracked.pelvis),
            jaw: delta(tracked.jaw),
            joint3: delta(tracked.joint3),
            storeSnaps,
            topMovers: movers.slice(0, 12),
        };
    }, { n: SAMPLES, stepMs: STEP_MS, a: anim });

    if (!out.ok) { console.log(`[${label}] ERROR: ${out.reason}`); return; }

    const snap = out.storeSnaps[0] || {};
    let path = 'STOP';
    if (snap.isPlaying && snap.blendQueue && snap.blendQueue.length > 0) path = 'BLENDED (blendQueue activa)';
    else if (snap.isPlaying && snap.currentAnimation) path = 'SINGLE';
    console.log(`\n--- ${label} (${SAMPLES}x${STEP_MS}ms) ---`);
    console.log(`  state: anim=${snap.currentAnimation} isPlaying=${snap.isPlaying} expr=${snap.currentExpression} blendQueue=${JSON.stringify(snap.blendQueue)}  → ${path}`);
    console.log(`  deltas: dec=${fmt(out.dec)}  head=${fmt(out.head)}  rootBone=${fmt(out.rootBone)}  pelvis=${fmt(out.pelvis)}  jaw_01=${fmt(out.jaw)}  joint3=${fmt(out.joint3)}`);
    console.log(`  top-movers:`);
    for (const m of out.topMovers) {
        console.log(`    ${m.name.padEnd(32)} max=${m.max.toFixed(4)}`);
    }
    // Veredicto de la hipótesis
    const blendActive = !!snap.blendQueue && snap.blendQueue.length > 0;
    const bodyMoved = out.head > 0.02 || out.rootBone > 0.02 || out.dec > 0.02;
    const mouthMoved = out.jaw > 0.02 || out.joint3 > 0.02;
    if (blendActive && !bodyMoved && mouthMoved) {
        console.log(`  VEREDICTO: >>> HIPÓTESIS CONFIRMADA — blendQueue no vacía, cuerpo congelado, boca moviéndose (MouthMove en blend) <<<`);
    } else if (!blendActive && bodyMoved) {
        console.log(`  VEREDICTO: blendQueue vacía → la animación simple SÍ se reproduce (estado A intermitente)`);
    } else {
        console.log(`  VEREDICTO: caso mixto — blendActive=${blendActive} bodyMoved=${bodyMoved} mouthMoved=${mouthMoved}`);
    }
}

try {
    console.log(`\n=== DIAG BLEND-RACE (¿la blendQueue residual anula playAnimation?) ===`);
    console.log(`URL: ${URL}\n`);

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    console.log('[ok] canvas presente');

    const preload = await pollUntil(page, () => page.evaluate(() => !!window.__bunnyPreloadDone), 60000, 500);
    console.log(`[${preload ? 'ok' : 'FAIL'}] preload: ${preload ? 'skeleton + clips precargados' : 'TIMEOUT'}`);

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
    console.log(`[${storeSetup.ok ? 'ok' : 'FAIL'}] store: ${JSON.stringify(storeSetup)}`);
    if (!storeSetup.ok) throw new Error('no store');

    console.log('\n=== ESTADO INICIAL DEL STORE (página fresca) ===');
    await readStore(page, 'INICIAL');

    console.log('\n=== Bucle de decoraciones (idéntico al validador) ===');
    for (const key of DECORATIONS) {
        await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Bind-pose'));
        await settleMixer(page, 0.8);
        await page.evaluate((k) => window.__bunnyStore.getState().setDecoration(k), key);
        await page.waitForTimeout(150);
        await settleMixer(page, 0.5);
        console.log(`  [${key}] decorado + settleMixer(0.5) OK`);
    }
    await readStore(page, 'TRAS BUCLE DECORACIONES');

    console.log('\n=== Root-motion step (idéntico al validador) ===');
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration('flag'));
    await page.waitForTimeout(150);
    await settleMixer(page, 0.7);
    await readStore(page, 'PRE playAnimation (momento exacto del validador)');

    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Jump_while_run'));
    await page.waitForTimeout(350);
    await readStore(page, 'POST playAnimation (tras 350ms)');

    await sampleWithStore(page, 'ROOT-MOTION Jump_while_run', 'Jump_while_run');

    // Mismo muestreo para otra animación (corroborar que el estado es general)
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Dance'));
    await page.waitForTimeout(350);
    await readStore(page, 'POST playAnimation(Dance)');
    await sampleWithStore(page, 'ROOT-MOTION Dance', 'Dance');

    console.log(`\n[browserErrors] ${browserErrors.length ? browserErrors.join('\n') : 'ninguno'}`);
} catch (err) {
    console.error('[diag] ERROR:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
} finally {
    await browser.close();
}
