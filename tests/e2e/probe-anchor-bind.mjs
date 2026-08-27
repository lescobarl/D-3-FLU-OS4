// ============================================================
// probe-anchor-bind.mjs — Mide los transform de bind-pose para
// el FIX de anclaje de decoraciones 3D (Fase 2).
// ============================================================
// Objetivo: con el modelo en 'Bind-pose', reportar:
//   1. Duplicados de huesos 'root'/'pelvis'/'head' en la escena.
//   2. parentChain del hueso 'root' y si root.parent es el Group
//      raíz del FBX (target de DecorationsRenderer).
//   3. Transform local de 'root' y 'head' relativos a sus padres.
//   4. anchorWorld = target.localToWorld(HEAD_ANCHOR).
//   5. offsets locales para anclar al hueso 'root' o 'head'.
//   6. Durante 'Jump_while_run': delta de world pos de root/head
//      y delta de world quaternion de root (¿rota el hueso root?).
//
// Run:  node tests/e2e/probe-anchor-bind.mjs
//       (Requiere el dev server en http://localhost:5174/)
// Env:  FLU_URL=http://localhost:5174/ (por defecto)
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';
const HEAD_ANCHOR = [0, 0.6, 0.02];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const browserErrors = [];
page.on('pageerror', (e) => browserErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
    if (m.type() === 'error') browserErrors.push(`console.error: ${m.text()}`);
});

async function pollUntil(fn, timeoutMs, intervalMs) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeoutMs) {
        last = await fn();
        if (last) return last;
        await page.waitForTimeout(intervalMs);
    }
    return last;
}

try {
    console.log(`\n=== PROBE anclaje decoraciones · URL: ${URL} ===`);

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    const preload = await pollUntil(() => page.evaluate(() => !!window.__bunnyPreloadDone), 60000, 500);
    console.log(`[probe] __bunnyPreloadDone = ${!!preload}`);

    // Asegurar handle del store
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
    console.log(`[probe] storeSetup = ${JSON.stringify(storeSetup)}`);
    if (!storeSetup.ok) throw new Error('No hay handle del store');

    // ------------------------------------------------------------
    // 1) Reporte en Bind-pose
    // ------------------------------------------------------------
    const bind = await page.evaluate(async (headAnchor) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const scene = store && store.getState && store.getState().scene;
        if (!scene) return { ok: false, reason: 'no-scene' };

        const st = window.__bunnyStore && window.__bunnyStore.getState();
        if (!st || !st.playAnimation) return { ok: false, reason: 'no-store' };

        // Normalizar a Bind-pose
        st.playAnimation('Bind-pose');
        await new Promise((r) => setTimeout(r, 500));

        // Contar duplicados y recolectar cadenas de padres
        const byName = {};
        scene.traverse((o) => {
            if (o.isBone) {
                const n = o.name || '(sin nombre)';
                (byName[n] = byName[n] || []).push(o);
            }
        });

        const chain = (o) => {
            const out = [];
            let cur = o;
            while (cur) {
                out.push(cur.name || cur.type);
                cur = cur.parent;
            }
            return out;
        };

        // El Group raíz del FBX = padre del hueso 'root' (por la cadena conocida)
        // Buscar el primer 'root' (el que anima el mixer por nombre).
        const firstRoot = scene.getObjectByName ? scene.getObjectByName('root') : null;
        const firstHead = scene.getObjectByName ? scene.getObjectByName('head') : null;

        // Hueso 'root' cuyo padre es un Group que a su vez es hijo de otro Group (estructura FBX)
        let rootBone = null;
        scene.traverse((o) => {
            if (!rootBone && o.isBone && o.name === 'root' && o.parent && o.parent.isGroup && o.parent.parent && o.parent.parent.isGroup) {
                rootBone = o;
            }
        });

        const report = { ok: true, headAnchor, counts: {}, bones: [] };
        for (const n of Object.keys(byName)) {
            if (['root', 'pelvis', 'head', 'neck_01', 'spine_03'].includes(n)) {
                report.counts[n] = byName[n].length;
                report.bones.push({
                    name: n,
                    count: byName[n].length,
                    chains: byName[n].slice(0, 4).map((b) => ({ chain: chain(b), localPos: [b.position.x, b.position.y, b.position.z] })),
                });
            }
        }

        report.firstRootChain = firstRoot ? chain(firstRoot) : null;
        report.firstHeadChain = firstHead ? chain(firstHead) : null;
        report.rootBoneFound = !!rootBone;
        report.rootBoneChain = rootBone ? chain(rootBone) : null;
        report.rootIsFirst = rootBone ? rootBone === firstRoot : null;

        if (rootBone) {
            const target = rootBone.parent; // Group raíz del FBX (modelObjRef)
            report.targetIsRootParent = target ? (target.name || target.type) : null;
            report.targetChildren = target ? target.children.map((ch) => `${ch.name || ch.type}${ch.isBone ? '(bone)' : ''}`) : null;

            // local de root relativo al target
            report.rootLocal = {
                pos: [rootBone.position.x, rootBone.position.y, rootBone.position.z],
                quat: [rootBone.quaternion.x, rootBone.quaternion.y, rootBone.quaternion.z, rootBone.quaternion.w],
            };

            // anchorWorld (corona) en frame del target
            const targetMatrix = new THREE.Matrix4();
            target.updateMatrixWorld(true);
            const anchorWorld = new THREE.Vector3(headAnchor[0], headAnchor[1], headAnchor[2]);
            target.localToWorld(anchorWorld);
            report.anchorWorld = [anchorWorld.x, anchorWorld.y, anchorWorld.z];

            // offset local para anclar al hueso 'root'
            const rootLocalAnchor = new THREE.Vector3().copy(anchorWorld);
            rootBone.worldToLocal(rootLocalAnchor);
            report.rootLocalAnchor = [rootLocalAnchor.x, rootLocalAnchor.y, rootLocalAnchor.z];

            // offset local para anclar al hueso 'head' (si existe)
            const headBone = firstHead;
            if (headBone) {
                const headLocalAnchor = new THREE.Vector3().copy(anchorWorld);
                headBone.worldToLocal(headLocalAnchor);
                report.headLocalAnchor = [headLocalAnchor.x, headLocalAnchor.y, headLocalAnchor.z];
                report.headLocal = {
                    pos: [headBone.position.x, headBone.position.y, headBone.position.z],
                    quat: [headBone.quaternion.x, headBone.quaternion.y, headBone.quaternion.z, headBone.quaternion.w],
                };
                const headWorldPos = new THREE.Vector3();
                headBone.getWorldPosition(headWorldPos);
                report.headWorldPos = [headWorldPos.x, headWorldPos.y, headWorldPos.z];
                // orientación del target en frame local del head (para fijar quaternion del grupo)
                const headWorldQuat = headBone.getWorldQuaternion(new THREE.Quaternion());
                const targetWorldQuat = target.getWorldQuaternion(new THREE.Quaternion());
                report.groupQuatInHead = headWorldQuat.clone().invert().multiply(targetWorldQuat).toArray();
            }

            // Misma comprobación con el primer 'root' por getObjectByName (¿el que anima el mixer?)
            if (firstRoot && firstRoot !== rootBone) {
                const la = new THREE.Vector3().copy(anchorWorld);
                firstRoot.worldToLocal(la);
                report.firstRootLocalAnchor = [la.x, la.y, la.z];
                report.firstRootLocal = { pos: [firstRoot.position.x, firstRoot.position.y, firstRoot.position.z] };
            }
        }

        return report;
    }, HEAD_ANCHOR);

    console.log('[bind-pose]', JSON.stringify(bind, null, 2));

    // ------------------------------------------------------------
    // 2) Movimiento durante Jump_while_run
    // ------------------------------------------------------------
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

        let rootBone = null;
        scene.traverse((o) => {
            if (!rootBone && o.isBone && o.name === 'root' && o.parent && o.parent.isGroup && o.parent.parent && o.parent.parent.isGroup) {
                rootBone = o;
            }
        });
        const headBone = scene.getObjectByName ? scene.getObjectByName('head') : null;
        if (!rootBone || !headBone) return { ok: false, reason: 'no-bones', root: !!rootBone, head: !!headBone };

        st.playAnimation('Jump_while_run');
        const v = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const rootPos = [];
        const headPos = [];
        const rootQuat = [];
        for (let i = 0; i < 10; i++) {
            rootBone.getWorldPosition(v);
            rootPos.push([v.x, v.y, v.z]);
            headBone.getWorldPosition(v);
            headPos.push([v.x, v.y, v.z]);
            rootBone.getWorldQuaternion(q);
            rootQuat.push(q.toArray());
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
        // delta angular del quaternion del root (producto entre 1º y cada muestra)
        let maxAngle = 0;
        for (let i = 1; i < rootQuat.length; i++) {
            const q0 = new THREE.Quaternion(rootQuat[0][0], rootQuat[0][1], rootQuat[0][2], rootQuat[0][3]);
            const q1 = new THREE.Quaternion(rootQuat[i][0], rootQuat[i][1], rootQuat[i][2], rootQuat[i][3]);
            const angle = 2 * Math.acos(Math.min(1, Math.abs(q0.dot(q1))));
            maxAngle = Math.max(maxAngle, angle);
        }
        return {
            ok: true,
            anim: 'Jump_while_run',
            root: delta(rootPos),
            head: delta(headPos),
            rootQuatMaxAngleDeg: (maxAngle * 180) / Math.PI,
            firstHead: headPos[0],
            lastHead: headPos[headPos.length - 1],
        };
    });
    console.log('[jump_while_run]', JSON.stringify(motion, null, 2));

    console.log(`\n[browserErrors] ${browserErrors.length ? browserErrors.join('\n') : 'ninguno'}`);
} catch (err) {
    console.error('[probe] ERROR:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
} finally {
    await browser.close();
}
