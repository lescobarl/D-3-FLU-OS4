// ============================================================
// probe-r3f-scene.mjs — Sonda RÁPIDA de acceso a escena R3F v9
// ============================================================
// Verifica el acceso a la escena vía r3fProxy (export `_roots`)
// y confirma que un decoration-<key> queda anclado al objeto
// raíz del modelo en el HEAD_ANCHOR.
//
// Run:  node tests/e2e/probe-r3f-scene.mjs
//       (Requiere el dev server en http://localhost:5174/)
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
    console.log(`URL: ${URL}`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    await page.waitForFunction(() => !!window.__bunnyPreloadDone, null, { timeout: 60000 });
    console.log('[ok] canvas + __bunnyPreloadDone');

    const storeSetup = await page.evaluate(async () => {
        if (window.__bunnyStore && window.__bunnyStore.getState) return { ok: true, source: 'window' };
        const m = await import('/src/avatar/store/bunnyStore.ts');
        window.__bunnyStore = m.useBunnyStore;
        return { ok: !!m.useBunnyStore, source: 'import' };
    });
    console.log('[store]', JSON.stringify(storeSetup));

    // 1) Acceso a la escena vía r3fProxy
    const access = await page.evaluate(async () => {
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const canvas = document.querySelector('.flu-bridge-container canvas');
        if (!canvas) return { ok: false, reason: 'no-canvas' };
        const root = R3F.r3fRoots.get(canvas);
        if (!root) return { ok: false, reason: 'no-root-in-_roots' };
        const state = root.store.getState();
        const scene = state && state.scene;
        if (!scene) return { ok: false, reason: 'no-scene-in-store' };
        const top = [];
        scene.traverse((o) => {
            if (o.parent === scene) {
                top.push({ name: o.name, type: o.type, children: o.children.length });
            }
        });
        return { ok: true, top };
    });
    console.log('[scene access]', JSON.stringify(access, null, 2));

    // 2) Poner una decoración y sondearla
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration('flag'));
    await page.waitForTimeout(900);
    const probe = await page.evaluate(async () => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const canvas = document.querySelector('.flu-bridge-container canvas');
        const scene = R3F.r3fRoots.get(canvas).store.getState().scene;
        let dec = null;
        scene.traverse((o) => {
            if (o.name === 'decoration-flag') dec = o;
        });
        if (!dec) return { ok: false, reason: 'decoration-flag not found in scene' };
        const world = new THREE.Vector3();
        dec.getWorldPosition(world);
        const pw = new THREE.Vector3();
        dec.parent && dec.parent.getWorldPosition(pw);
        return {
            ok: true,
            parentName: dec.parent ? dec.parent.name : null,
            parentType: dec.parent ? dec.parent.type : null,
            childCount: dec.children.length,
            localPos: [dec.position.x, dec.position.y, dec.position.z],
            worldPos: [world.x, world.y, world.z],
            parentWorldPos: pw ? [pw.x, pw.y, pw.z] : null,
        };
    });
    console.log('[decoration-flag]', JSON.stringify(probe, null, 2));
} catch (err) {
    console.error('PROBE ERROR:', err);
} finally {
    await browser.close();
}
