// ============================================================
// diag-mixer-state.mjs — Diagnóstico del estado del mixer
// ============================================================
// Pregunta central: en la secuencia del validador
//   Bind-pose -> setDecoration('flag') -> Jump_while_run
// ¿el AnimationMixer REALMENTE avanza Jump_while_run y aplica el
// track root.position? O ¿queda congelado / sin root-motion?
//
// Compara DOS secuencias con ventana LARGA (~5.4s, 36 x 150ms):
//   A) validador:  Bind-pose → 500ms → setDecoration('flag')
//                  → 600ms → Jump_while_run
//   B) probe:      Bind-pose → 500ms → Jump_while_run
//
// En cada muestra captura:
//   - rootBone  WORLD y LOCAL position  (¿el mixer avanza root-motion?)
//   - headBone  WORLD y LOCAL position  (cabeza sigue a root)
//   - rootQuat  (giro del hueso root)
//   - dec       WORLD position (solo secuencia A)
//
// Si rootLocal.max ≈ 0 → el mixer NO aplica el track root.position
// (mixer congelado / clip equivocado / warp degenerado).
// Si rootLocal.max > 0 pero headWorld.max < 0.02 → movimiento real
// pero pequeño (problema de umbral/ventana, no de congelamiento).
//
// Run:  node tests/e2e/diag-mixer-state.mjs
// Env:  FLU_URL=http://localhost:5174/ (por defecto)
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';
const SAMPLES = 36;          // 36 x 150ms = 5.4s
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

// ------------------------------------------------------------
// Sonda de movimiento con ventana larga, dentro de page.evaluate
// ------------------------------------------------------------
async function sampleMotion(page, { withDecoration, label }) {
    const out = await page.evaluate(async ({ withDec, n, stepMs }) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const scene = store && store.getState && store.getState().scene;
        if (!scene) return { ok: false, reason: 'no-scene' };

        let rootBone = null;
        scene.traverse((o) => {
            if (!rootBone && o.name === 'root' && o.type === 'Bone') rootBone = o;
        });
        const headBone = scene.getObjectByName ? scene.getObjectByName('head') : null;
        let dec = null;
        if (withDec) scene.traverse((o) => { if (o.name === 'decoration-flag') dec = o; });

        if (!rootBone) return { ok: false, reason: 'no-rootBone' };
        if (!headBone) return { ok: false, reason: 'no-headBone' };

        const rows = [];
        const v = new THREE.Vector3();
        const q0 = rootBone.quaternion.clone();
        for (let i = 0; i < n; i++) {
            rootBone.getWorldPosition(v);
            const rw = [v.x, v.y, v.z];
            const rl = [rootBone.position.x, rootBone.position.y, rootBone.position.z];
            headBone.getWorldPosition(v);
            const hw = [v.x, v.y, v.z];
            const hl = [headBone.position.x, headBone.position.y, headBone.position.z];
            const qAng = THREE.MathUtils.radToDeg(rootBone.quaternion.angleTo(q0));
            let dw = null;
            if (dec) {
                dec.getWorldPosition(v);
                dw = [v.x, v.y, v.z];
            }
            rows.push({ i, rw, rl, hw, hl, qAng, dw, t: performance.now() });
            await new Promise((r) => setTimeout(r, stepMs));
        }

        const delta = (arr) => {
            let ref = null;
            for (let i = 0; i < arr.length; i++) {
                if (arr[i]) { ref = arr[i]; break; }
            }
            if (!ref) return { max: 0, axis: [0, 0, 0], empty: true };
            let m = 0;
            const axis = [0, 0, 0];
            for (let i = 1; i < arr.length; i++) {
                if (!arr[i]) continue;
                for (let a = 0; a < 3; a++) {
                    const d = Math.abs(arr[i][a] - ref[a]);
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
                rootWorld: delta(arrOf('rw')),
                rootLocal: delta(arrOf('rl')),
                headWorld: delta(arrOf('hw')),
                headLocal: delta(arrOf('hl')),
                decWorld: delta(arrOf('dw')),
                rootQuatMaxDeg: rows.reduce((m, r) => Math.max(m, r.qAng), 0),
            },
            decFound: !!dec,
        };
    }, { withDec: withDecoration, n: SAMPLES, stepMs: STEP_MS });

    if (!out.ok) {
        console.log(`[${label}] ERROR: ${out.reason}`);
        return out;
    }

    console.log(`\n--- ${label} (${out.rows.length} muestras x ${STEP_MS}ms) ---`);
    console.log('Delta (máx |componente| vs 1ª muestra):');
    for (const [k, d] of Object.entries(out.delta)) {
        if (k === 'rootQuatMaxDeg') continue;
        console.log(`  ${k.padEnd(12)} max=${d.max.toFixed(4)}  axis=[${fmt(d.axis)}]${d.empty ? '  (sin datos)' : ''}`);
    }
    console.log(`  rootQuatMaxDeg = ${out.delta.rootQuatMaxDeg.toFixed(4)}°`);
    console.log('Muestras (todas; t+gap = ms reales desde la muestra anterior):');
    for (const r of out.rows) {
        const gap = r.i > 0 ? (r.t - out.rows[r.i - 1].t).toFixed(0) : '-';
        console.log(
            `  i=${String(r.i).padStart(2)} t+${String(gap).padStart(5)}ms  rootW[${fmt(r.rw)}]  rootL[${fmt(r.rl)}]` +
            `  headW[${fmt(r.hw)}]  q=${r.qAng.toFixed(2)}°` +
            (r.dw ? `  decW[${fmt(r.dw)}]` : '')
        );
    }
    return out;
}

try {
    console.log(`\n=== DIAG · estado del mixer (Jump_while_run) ===\nURL: ${URL}\n`);
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

    // --------------------------------------------------------
    // SECUENCIA A — validador: Bind-pose → setDecoration → Jump_while_run
    // --------------------------------------------------------
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Bind-pose'));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration('flag'));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Jump_while_run'));
    await page.waitForTimeout(350); // arranque / crossfade
    const seqA = await sampleMotion(page, { withDecoration: true, label: 'A) validador: Bind→dec→Jump' });

    // --------------------------------------------------------
    // Reset entre secuencias
    // --------------------------------------------------------
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration(null));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Bind-pose'));
    await page.waitForTimeout(500);

    // --------------------------------------------------------
    // SECUENCIA B — probe: Bind-pose → Jump_while_run
    // --------------------------------------------------------
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Jump_while_run'));
    await page.waitForTimeout(350);
    const seqB = await sampleMotion(page, { withDecoration: false, label: 'B) probe: Bind→Jump' });

    // --------------------------------------------------------
    // Resumen
    // --------------------------------------------------------
    const d = (o) => (o && o.delta ? o.delta : null);
    console.log('\n=== RESUMEN ===');
    if (seqA.ok && seqB.ok) {
        const a = d(seqA);
        const b = d(seqB);
        console.log(`  A rootLocal.max=${a.rootLocal.max.toFixed(4)}  B rootLocal.max=${b.rootLocal.max.toFixed(4)}`);
        console.log(`  A headWorld.max=${a.headWorld.max.toFixed(4)}  B headWorld.max=${b.headWorld.max.toFixed(4)}`);
        console.log(`  A rootWorld.max=${a.rootWorld.max.toFixed(4)}  B rootWorld.max=${b.rootWorld.max.toFixed(4)}`);
        const frozenA = a.rootLocal.max < 0.0001 && a.rootWorld.max < 0.0001;
        const frozenB = b.rootLocal.max < 0.0001 && b.rootWorld.max < 0.0001;
        console.log(`  Mixer A (validador): ${frozenA ? 'CONGELADO' : 'AVANZANDO'}`);
        console.log(`  Mixer B (probe):     ${frozenB ? 'CONGELADO' : 'AVANZANDO'}`);
        if (frozenA && !frozenB) {
            console.log('  → CONGELAMIENTO ESPECÍFICO de la secuencia con decoración:');
            console.log('    sospechosos: crossfade warp desde clip de duración 0 (Bind-pose),');
            console.log('    o el re-render de la decoración reinicia el mixer.');
        } else if (!frozenA && a.headWorld.max < 0.02 && !frozenB && b.headWorld.max < 0.02) {
            console.log('  → El mixer AVANZA en ambas, pero el movimiento real de la cabeza es');
            console.log('    pequeño (<0.02). Problema de DISEÑO del test (umbral/animación/ventana),');
            console.log('    no de congelamiento. Considerar Walk/Idle_2 o ventana más larga.');
        } else {
            console.log('  → Diagnóstico mixto: revisar los deltas anteriores.');
        }
    }

    console.log(`\n[browserErrors] ${browserErrors.length ? browserErrors.join('\n') : 'ninguno'}`);
} catch (err) {
    console.error('[diag] ERROR:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
} finally {
    await browser.close();
}
