// ============================================================
// diag-anchor-head.mjs — Diagnóstico del anclaje al hueso 'head'
// ============================================================
// Pregunta: ¿dec.parent (el hueso ancla elegido por
// DecorationsRenderer) es el MISMO hueso que anima el
// AnimationMixer (scene.getObjectByName('head'))?
// Muestra de identidad + movimiento durante Jump_while_run.
//
// Run:  node tests/e2e/diag-anchor-head.mjs
// Env:  FLU_URL=http://localhost:5174/ (por defecto)
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const browserErrors = [];
page.on('pageerror', (e) => browserErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
    if (m.type() === 'error') browserErrors.push(`console.error: ${m.text()}`);
});

try {
    console.log(`\n=== DIAG · anclaje al hueso 'head' ===\nURL: ${URL}\n`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });

    // Esperar preload
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        const done = await page.evaluate(() => !!window.__bunnyPreloadDone);
        if (done) break;
        await page.waitForTimeout(500);
    }

    // Asegurar handle del store
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

    // 1) Identidad de los huesos 'head'
    const identity = await page.evaluate(async () => {
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const scene = store && store.getState && store.getState().scene;
        if (!scene) return { ok: false, reason: 'no-scene' };

        // Hueso 'root' único (hijo directo del grupo FBX) → target
        let rootBone = null;
        scene.traverse((o) => {
            if (!rootBone && o.name === 'root' && o.type === 'Bone') rootBone = o;
        });
        const target = rootBone ? rootBone.parent : null;
        if (!target) return { ok: false, reason: 'no-target' };

        const sceneHead = scene.getObjectByName ? scene.getObjectByName('head') : null;
        const targetHead = target.getObjectByName ? target.getObjectByName('head') : null;

        // Contar huesos 'head' en toda la escena y bajo target
        let sceneHeadCount = 0;
        scene.traverse((o) => { if (o.name === 'head' && o.type === 'Bone') sceneHeadCount++; });
        let targetHeadCount = 0;
        target.traverse((o) => { if (o.name === 'head' && o.type === 'Bone') targetHeadCount++; });

        // Ruta de cada hueso para distinguir instancias
        const pathOf = (o) => {
            if (!o) return null;
            const p = [];
            let cur = o;
            while (cur && p.length < 10) {
                p.unshift(cur.name || cur.type);
                cur = cur.parent;
            }
            return p.join(' > ');
        };

        return {
            ok: true,
            sceneHeadCount,
            targetHeadCount,
            sceneHeadPath: pathOf(sceneHead),
            targetHeadPath: pathOf(targetHead),
            sameSceneVsTarget: sceneHead === targetHead,
            sceneHeadLocal: sceneHead ? [sceneHead.position.x, sceneHead.position.y, sceneHead.position.z] : null,
            targetHeadLocal: targetHead ? [targetHead.position.x, targetHead.position.y, targetHead.position.z] : null,
            targetName: target.name || target.type,
            targetType: target.type,
        };
    });
    console.log('[identity]', JSON.stringify(identity, null, 2));

    // 2) Anclar 'flag' y comparar dec.parent con sceneHead
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Bind-pose'));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration('flag'));
    await page.waitForTimeout(600);

    const anchor = await page.evaluate(async () => {
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const scene = store && store.getState && store.getState().scene;
        if (!scene) return { ok: false, reason: 'no-scene' };
        let dec = null;
        scene.traverse((o) => { if (o.name === 'decoration-flag') dec = o; });
        if (!dec) return { ok: false, reason: 'dec-not-found' };
        const sceneHead = scene.getObjectByName ? scene.getObjectByName('head') : null;
        const pathOf = (o) => {
            if (!o) return null;
            const p = [];
            let cur = o;
            while (cur && p.length < 10) {
                p.unshift(cur.name || cur.type);
                cur = cur.parent;
            }
            return p.join(' > ');
        };
        return {
            ok: true,
            decParentName: dec.parent ? dec.parent.name : null,
            decParentType: dec.parent ? dec.parent.type : null,
            decParentPath: pathOf(dec.parent),
            sceneHeadPath: pathOf(sceneHead),
            sameAsSceneHead: dec.parent === sceneHead,
            decParentLocal: dec.parent ? [dec.parent.position.x, dec.parent.position.y, dec.parent.position.z] : null,
            sceneHeadLocal: sceneHead ? [sceneHead.position.x, sceneHead.position.y, sceneHead.position.z] : null,
        };
    });
    // THREE no está disponible en ese scope; se usa en el paso de movimiento
    console.log('[anchor]', JSON.stringify(anchor, null, 2));

    // 3) Movimiento durante Jump_while_run: sceneHead vs dec.parent
    const motion = await page.evaluate(async () => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const scene = store && store.getState && store.getState().scene;
        if (!scene) return { ok: false, reason: 'no-scene' };
        const st = window.__bunnyStore && window.__bunnyStore.getState();
        if (!st || !st.playAnimation) return { ok: false, reason: 'no-store' };

        let dec = null;
        scene.traverse((o) => { if (o.name === 'decoration-flag') dec = o; });
        if (!dec || !dec.parent) return { ok: false, reason: 'dec-not-found' };
        const sceneHead = scene.getObjectByName ? scene.getObjectByName('head') : null;
        if (!sceneHead) return { ok: false, reason: 'no-scene-head' };

        st.playAnimation('Jump_while_run');

        const sceneHeadSamples = [];
        const parentSamples = [];
        const decSamples = [];
        const v = new THREE.Vector3();
        for (let i = 0; i < 10; i++) {
            sceneHead.getWorldPosition(v);
            sceneHeadSamples.push([v.x, v.y, v.z]);
            dec.parent.getWorldPosition(v);
            parentSamples.push([v.x, v.y, v.z]);
            dec.getWorldPosition(v);
            decSamples.push([v.x, v.y, v.z]);
            await new Promise((r) => setTimeout(r, 180));
        }
        const delta = (arr) => {
            let m = 0;
            const axis = [0, 0, 0];
            for (let i = 1; i < arr.length; i++) {
                for (let a = 0; a < 3; a++) {
                    const d = Math.abs(arr[i][a] - arr[0][a]);
                    axis[a] = Math.max(axis[a], d);
                    m = Math.max(m, d);
                }
            }
            return { max: m, axis };
        };
        return {
            ok: true,
            sceneHead: delta(sceneHeadSamples),
            parent: delta(parentSamples),
            dec: delta(decSamples),
            sameObject: dec.parent === sceneHead,
            first: { sceneHead: sceneHeadSamples[0], parent: parentSamples[0], dec: decSamples[0] },
            last: { sceneHead: sceneHeadSamples[sceneHeadSamples.length - 1], parent: parentSamples[parentSamples.length - 1], dec: decSamples[decSamples.length - 1] },
        };
    });
    console.log('[motion]', JSON.stringify(motion, null, 2));

    console.log(`\n[browserErrors] ${browserErrors.length ? browserErrors.join('\n') : 'ninguno'}`);
} catch (err) {
    console.error('[diag] ERROR:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
} finally {
    await browser.close();
}
