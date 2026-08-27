// ============================================================
// probe-root-motion.mjs — DIAGNÓSTICO del root-motion del Bunny
// ------------------------------------------------------------
// Pregunta: ¿qué nodo del grafo se mueve realmente durante cada
// animación? El animador solo hace mixer.update(delta) sobre los
// HUESOS dentro del Group raíz del FBX; el Group raíz (donde se
// ancla la decoración) podría NO trasladarse.
//
// Este probe reproduce cada animación y muestrea ~1.2s las
// posiciones de mundo de:
//   - decoration (grupo hijo del root del FBX)
//   - root (dec.parent — Group raíz del FBX)
//   - hueso 'head'
//   - hueso 'pelvis'
// y además escanea TODOS los huesos para listar los 5 que más
// se mueven. El resultado decide si el FAIL de root-motion es
// un problema del script de validación (medir otro nodo) o una
// brecha real de implementación (la decoración flota).
//
// Run:  node tests/e2e/probe-root-motion.mjs
// Env:  FLU_URL=http://localhost:5174/ (por defecto)
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';
const ANIMS = ['Jump_in_place', 'Jump_while_run', 'Walk', 'Run', 'Dance', 'Idle_1'];
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

try {
    console.log(`\n=== PROBE ROOT-MOTION (Bunny rig) ===`);
    console.log(`URL: ${URL}\n`);

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    console.log('[ok] canvas presente');

    const preload = await pollUntil(
        page,
        () => page.evaluate(() => !!window.__bunnyPreloadDone),
        60000,
        500,
    );
    console.log(`[${preload ? 'ok' : 'FAIL'}] preload: ${preload ? 'skeleton + clips precargados' : 'TIMEOUT'}`);

    const storeSetup = await page.evaluate(async () => {
        // @ts-ignore
        if (window.__bunnyStore && window.__bunnyStore.getState) return { ok: true, source: 'window' };
        try {
            // @ts-ignore
            const m = await import('/src/avatar/store/bunnyStore.ts');
            // @ts-ignore
            window.__bunnyStore = m.useBunnyStore;
            return { ok: !!m.useBunnyStore, source: 'import' };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    });
    console.log(`[${storeSetup.ok ? 'ok' : 'FAIL'}] store: ${JSON.stringify(storeSetup)}`);

    if (!storeSetup.ok) throw new Error('no store');

    // Colocar la decoración
    await page.evaluate((k) => window.__bunnyStore.getState().setDecoration(k), KEY);
    await page.waitForTimeout(700);

    // Reproducir en bucle el Bind-pose unos instantes para aplanar la escena
    await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Bind-pose'));
    await page.waitForTimeout(400);

    for (const anim of ANIMS) {
        const res = await page.evaluate(async ({ k, a }) => {
            const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
            const R3F = await import('/tests/e2e/r3fProxy.ts');
            const c = document.querySelector('.flu-bridge-container canvas');
            const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
            const store = root && root.store;
            const scene = store && store.getState && store.getState().scene;
            if (!scene) return { ok: false, reason: 'no-scene' };

            // Reproducir
            window.__bunnyStore.getState().playAnimation(a);
            await new Promise((r) => setTimeout(r, 350)); // calentamiento

            // Ubicar nodos de interés
            let dec = null;
            const bones = {};
            scene.traverse((o) => {
                if (o.name === `decoration-${k}`) dec = o;
                if (o.isBone) {
                    if (!bones[o.name]) bones[o.name] = o;
                }
            });
            const headBone = bones['head'] || null;
            const pelvisBone = bones['pelvis'] || null;
            const rootBone = bones['root'] || null;
            const rootGroup = dec && dec.parent;

            // Jerarquía: ¿rootBone es ancestro de pelvis/head?
            const chain = (o) => {
                const out = [];
                let cur = o;
                while (cur) {
                    out.push(cur.name || cur.type || '(sin nombre)');
                    cur = cur.parent;
                }
                return out;
            };
            const isAncestor = (anc, node) => {
                let cur = node;
                while (cur) {
                    if (cur === anc) return true;
                    cur = cur.parent;
                }
                return false;
            };
            const hierarchy = {
                rootBoneChain: rootBone ? chain(rootBone) : null,
                pelvisParentChain: pelvisBone ? chain(pelvisBone).slice(0, 6) : null,
                headParentChain: headBone ? chain(headBone).slice(0, 6) : null,
                rootIsPelvisAncestor: rootBone && pelvisBone ? isAncestor(rootBone, pelvisBone) : null,
                rootIsHeadAncestor: rootBone && headBone ? isAncestor(rootBone, headBone) : null,
            };

            // Colección de muestras
            const sample = (label, obj) => {
                if (!obj) return null;
                const v = new THREE.Vector3();
                obj.getWorldPosition(v);
                return { label, x: v.x, y: v.y, z: v.z };
            };

            const allBoneSamples = []; // para top-movers al final
            const tracked = {
                dec: [],
                root: [],
                rootBone: [],
                head: [],
                pelvis: [],
            };
            const boneSampleMap = new Map(); // name -> array

            const record = () => {
                const sDec = sample('dec', dec);
                const sRoot = sample('root', rootGroup);
                const sRootBone = sample('rootBone', rootBone);
                const sHead = sample('head', headBone);
                const sPelvis = sample('pelvis', pelvisBone);
                if (sDec) tracked.dec.push(sDec);
                if (sRoot) tracked.root.push(sRoot);
                if (sRootBone) tracked.rootBone.push(sRootBone);
                if (sHead) tracked.head.push(sHead);
                if (sPelvis) tracked.pelvis.push(sPelvis);

                if (dec && rootGroup && headBone) {
                    // Top movers: muestrear TODOS los huesos (una vez al final está bien,
                    // pero para robustez muestreamos todos en cada tick y acumulamos).
                    scene.traverse((o) => {
                        if (!o.isBone) return;
                        const v = new THREE.Vector3();
                        o.getWorldPosition(v);
                        let arr = boneSampleMap.get(o.name);
                        if (!arr) {
                            arr = [];
                            boneSampleMap.set(o.name, arr);
                        }
                        if (arr.length < 8) arr.push([v.x, v.y, v.z]);
                    });
                }
            };

            for (let i = 0; i < 8; i++) {
                record();
                await new Promise((r) => setTimeout(r, 150));
            }

            const delta = (arr) => {
                if (!arr || arr.length < 2) return 0;
                let m = 0;
                for (let i = 1; i < arr.length; i++) {
                    m = Math.max(
                        m,
                        Math.abs(arr[i].x - arr[0].x),
                        Math.abs(arr[i].y - arr[0].y),
                        Math.abs(arr[i].z - arr[0].z),
                    );
                }
                return m;
            };

            // Top movers entre huesos muestreados
            const movers = [];
            for (const [name, arr] of boneSampleMap.entries()) {
                let m = 0;
                for (let i = 1; i < arr.length; i++) {
                    m = Math.max(
                        m,
                        Math.abs(arr[i][0] - arr[0][0]),
                        Math.abs(arr[i][1] - arr[0][1]),
                        Math.abs(arr[i][2] - arr[0][2]),
                    );
                }
                if (m > 0.001) movers.push({ name, max: m });
            }
            movers.sort((a, b) => b.max - a.max);

            return {
                ok: true,
                anim: a,
                parentName: rootGroup ? rootGroup.name || rootGroup.type : null,
                dec: delta(tracked.dec),
                root: delta(tracked.root),
                rootBone: delta(tracked.rootBone),
                head: delta(tracked.head),
                pelvis: delta(tracked.pelvis),
                decFirst: tracked.dec[0],
                headFirst: tracked.head[0],
                headLast: tracked.head[tracked.head.length - 1],
                decLast: tracked.dec[tracked.dec.length - 1],
                topMovers: movers.slice(0, 15),
                boneCount: boneSampleMap.size,
                hierarchy,
            };
        }, { k: KEY, a: anim });

        if (!res.ok) {
            console.log(`[FAIL] ${anim}: ${res.reason}`);
            continue;
        }
        const fmt = (v) => (v == null ? '  n/a ' : v.toFixed(4).padStart(7));
        console.log(`\n--- anim: ${res.anim}  (root='${res.parentName}') ---`);
        console.log(`  dec      max=${fmt(res.dec)}   first=${res.decFirst ? `(${res.decFirst.x.toFixed(3)}, ${res.decFirst.y.toFixed(3)}, ${res.decFirst.z.toFixed(3)})` : 'n/a'}  last=${res.decLast ? `(${res.decLast.x.toFixed(3)}, ${res.decLast.y.toFixed(3)}, ${res.decLast.z.toFixed(3)})` : 'n/a'}`);
        console.log(`  rootGrp  max=${fmt(res.root)}`);
        console.log(`  rootBone max=${fmt(res.rootBone)}`);
        console.log(`  head     max=${fmt(res.head)}   first=${res.headFirst ? `(${res.headFirst.x.toFixed(3)}, ${res.headFirst.y.toFixed(3)}, ${res.headFirst.z.toFixed(3)})` : 'n/a'}  last=${res.headLast ? `(${res.headLast.x.toFixed(3)}, ${res.headLast.y.toFixed(3)}, ${res.headLast.z.toFixed(3)})` : 'n/a'}`);
        console.log(`  pelvis   max=${fmt(res.pelvis)}`);
        if (res.hierarchy) {
            console.log(`  jerarquía: rootIsPelvisAncestor=${res.hierarchy.rootIsPelvisAncestor} rootIsHeadAncestor=${res.hierarchy.rootIsHeadAncestor}`);
            console.log(`    rootBoneChain=${JSON.stringify(res.hierarchy.rootBoneChain)}`);
            console.log(`    pelvisParentChain=${JSON.stringify(res.hierarchy.pelvisParentChain)}`);
            console.log(`    headParentChain=${JSON.stringify(res.hierarchy.headParentChain)}`);
        }
        console.log(`  top-movers (bones, ${res.boneCount} muestreados):`);
        for (const m of res.topMovers) {
            console.log(`    ${m.name.padEnd(32)} max=${m.max.toFixed(4)}`);
        }
    }

    console.log(`\n=== Errores de consola: ${browserErrors.length} ===`);
    browserErrors.slice(0, 5).forEach((e) => console.log('  ' + e));
} catch (e) {
    console.error('ERROR:', e);
    process.exitCode = 1;
} finally {
    await browser.close();
}
