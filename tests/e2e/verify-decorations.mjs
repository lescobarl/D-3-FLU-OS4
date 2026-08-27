// ============================================================
// verify-decorations.mjs — Validación VISUAL de Fase 2
// (decoraciones 3D estacionales del avatar FLU OS4)
// ============================================================
// Objetivo: confirmar en el navegador REAL (dev server) que una
// decoración 3D:
//   1. Se ancla al HUESO 'head' del esqueleto del Bunny
//      (fallback 'root' → target) en la corona de la cabeza, de
//      modo que hereda la transformación COMPLETA (el root-motion
//      vive en el hueso 'root', hijo directo del grupo FBX).
//   2. Se ve en pantalla (los píxeles de la región de la cabeza
//      cambian respecto a la línea base sin decoración).
//   3. Sigue al hueso ancla durante Jump_while_run (root-motion):
//      cuando el modelo salta y se desplaza, la decoración se
//      mueve con la cabeza (NO flota en el Scene estático).
//   4. Se retira limpiamente con setDecoration(null).
//
// Run:  node tests/e2e/verify-decorations.mjs
//       (Requiere el dev server en http://localhost:5174/)
// Env:  FLU_URL=http://localhost:5174/ (por defecto)
// ============================================================
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.FLU_URL || 'http://localhost:5174/';
const REPORT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../reports/decorations');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const DECORATIONS = ['santa-hat', 'party-hat', 'flag', 'crown'];
const HEAD_ANCHOR = [0, 0.6, 0.02];

// Umbrales
const ROOT_MOTION_THRESHOLD = 0.02;        // unidades de mundo (~2cm en un modelo de 2.0)
const PIXEL_MEAN_DELTA_THRESHOLD = 2.0;    // delta del color medio RGB de la región de la cabeza
const PIXEL_NONBG_CHANGE_THRESHOLD = 0.012; // cambio en la fracción de píxeles "no fondo"
const PIXEL_CHANGED_FRACTION_THRESHOLD = 0.004; // fracción de píxeles de la cabeza con cambio > 40 (accesorios pequeños/claros)

const results = [];
function record(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
}

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

// ------------------------------------------------------------
// settleMixer — Asentado DETERMINISTA del mezclador de animación
// con frameloop='never' + tiempo SINTÉTICO en SEGUNDOS.
// En modo 'never', R3F update() calcula
//   delta = timestamp - clock.elapsedTime
// con la MISMA unidad que el timestamp pasado a advance().
// THREE.AnimationMixer.update() interpreta su argumento en
// SEGUNDOS → los timestamps deben avanzar en segundos. (Si se
// pasaran ms, delta≈40 ms se trataría como 40 s ≈ 2 bucles del
// clip y la pose se repetiría → movimiento 0.) Restauramos
// frameloop='always' y el reloj real al terminar (invalidate()).
// ------------------------------------------------------------
async function settleMixer(page, seconds, stepSec = 0.04) {
    return page.evaluate(async ({ total, step }) => {
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const getState = () => (store && store.getState ? store.getState() : null);
        const s0 = getState();
        if (!s0 || typeof s0.advance !== 'function') return { ok: false, steps: 0, reason: 'no-advance' };
        store.setState({ frameloop: 'never' });
        const origElapsed = getState().clock.elapsedTime;
        let t = origElapsed;
        getState().clock.oldTime = performance.now();
        getState().clock.elapsedTime = t;
        try {
            let steps = 0;
            for (let el = 0; el < total; el += step) {
                // RELOJ SINTÉTICO: re-basamos oldTime (ms) ANTES de cada advance
                // para que getDelta() ≈ 0 y el ramal 'never' de R3F entregue
                // delta = paso exacto (evita deltas negativos por corrupción
                // oldTime=segundos que rebobinan el clip y anulan el movimiento).
                getState().clock.oldTime = performance.now();
                t += step;
                s0.advance(t);
                steps++;
                await new Promise((r) => setTimeout(r, 1));
            }
            return { ok: true, steps, deterministic: true, mode: 'synthetic', seconds: total };
        } finally {
            store.setState({ frameloop: 'always' });
            const clk = getState().clock;
            clk.oldTime = performance.now();
            clk.elapsedTime = origElapsed;
            if (getState().invalidate) getState().invalidate();
        }
    }, { total: seconds, step: stepSec });
}

// ------------------------------------------------------------
// Acceso a la escena R3F (R3F v9): el root se guarda en el Map
// interno `_roots` (clave = <canvas>), exportado por el entry.
// r3fProxy.ts resuelve `@react-three/fiber` al MISMO módulo
// pre-bundleado que usa la app -> mismas instancias, mismas claves.
// Devuelve un descriptor (no el objeto Scene, para evitar
// serialización de referencias circulares).
// ------------------------------------------------------------
async function getSceneEval(page) {
    return page.evaluate(async () => {
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const scene = store && store.getState && store.getState().scene;
        if (!scene) return { ok: false };
        const top = scene.children.map((o) => `${o.type}${o.isGroup ? `[${o.children.length}]` : ''}`);
        return { ok: true, childCount: scene.children.length, top };
    });
}

// ------------------------------------------------------------
// Sonda de una decoración en el grafo de escena
// ------------------------------------------------------------
async function probeDecoration(page, key) {
    return page.evaluate(async ({ k, anchor }) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const scene = store && store.getState && store.getState().scene;
        if (!scene) return { ok: false, reason: 'no-scene' };
        let dec = null;
        scene.traverse((o) => {
            if (o.name === `decoration-${k}`) dec = o;
        });
        if (!dec) return { ok: false, reason: 'not-found' };

        // Hueso 'root' (único, hijo directo del grupo FBX) → target del modelo
        let rootBone = null;
        scene.traverse((o) => {
            if (!rootBone && o.name === 'root' && o.type === 'Bone') rootBone = o;
        });
        const target = rootBone ? rootBone.parent : null;

        // Cuaternión MUNDIAL del hueso 'head' (diagnóstico de deriva de pose)
        let headBone = null;
        scene.traverse((o) => {
            if (!headBone && o.type === 'Bone' && o.name === 'head') headBone = o;
        });
        let headQuat = null;
        if (headBone) {
            headBone.updateMatrixWorld(true);
            const q = new THREE.Quaternion();
            headBone.getWorldQuaternion(q);
            headQuat = [q.x, q.y, q.z, q.w];
        }

        // Posición MUNDIAL esperada del HEAD_ANCHOR en la corona de la cabeza
        let anchorWorld = null;
        if (target) {
            target.updateMatrixWorld(true);
            const p = new THREE.Vector3(anchor[0], anchor[1], anchor[2]);
            target.localToWorld(p);
            anchorWorld = [p.x, p.y, p.z];
        }

        const world = new THREE.Vector3();
        dec.getWorldPosition(world);
        const parent = dec.parent;
        const parentWorld = new THREE.Vector3();
        if (parent) parent.getWorldPosition(parentWorld);
        return {
            ok: true,
            name: dec.name,
            childCount: dec.children.length,
            localPos: [dec.position.x, dec.position.y, dec.position.z],
            worldPos: [world.x, world.y, world.z],
            parentName: parent ? parent.name : null,
            parentType: parent ? parent.type : null,
            parentIsGroup: parent ? parent.type === 'Group' : false,
            parentIsBone: parent ? parent.type === 'Bone' : false,
            parentWorldPos: parent ? [parentWorld.x, parentWorld.y, parentWorld.z] : null,
            anchorWorld,
            headQuat,
        };
    }, { k: key, anchor: HEAD_ANCHOR });
}

// ------------------------------------------------------------
// Captura pose-invariante del ancla — corona de la cabeza en el
// marco LOCAL del hueso 'head' + cuaternión del hueso.
// Se evalúa en la pose de Bind ASENTADA ANTES de anclar; el grupo
// anclado (DecorationsRenderer) fija group.position =
// anchor.worldToLocal(HEAD_ANCHOR·target.matrixWorld) en ESA misma
// pose → comparar dec.localPos (inmutable tras el ancla) contra
// crown.local es VÁLIDO aunque el mezclador derive la pose entre
// el ancla y la sonda posterior.
// ------------------------------------------------------------
async function captureCrownLocal(page) {
    return page.evaluate(async ({ anchor }) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const scene = store && store.getState && store.getState().scene;
        if (!scene) return { ok: false, reason: 'no-scene' };
        let rootBone = null;
        let headBone = null;
        scene.traverse((o) => {
            if (!rootBone && o.name === 'root' && o.type === 'Bone') rootBone = o;
            if (!headBone && o.type === 'Bone' && o.name === 'head') headBone = o;
        });
        const target = rootBone ? rootBone.parent : null;
        if (!target || !headBone) return { ok: false, reason: 'no-rig' };
        target.updateMatrixWorld(true);
        headBone.updateMatrixWorld(true);
        const p = new THREE.Vector3(anchor[0], anchor[1], anchor[2]);
        target.localToWorld(p);                    // corona en mundo
        const local = headBone.worldToLocal(p.clone()); // corona en el marco del hueso 'head'
        const q = new THREE.Quaternion();
        headBone.getWorldQuaternion(q);
        return {
            ok: true,
            crownWorld: [p.x, p.y, p.z],
            local: [local.x, local.y, local.z],
            headQuat: [q.x, q.y, q.z, q.w],
        };
    }, { anchor: HEAD_ANCHOR });
}

// ------------------------------------------------------------
// Deriva angular (grados) entre dos cuaterniones
// ------------------------------------------------------------
function quatDriftDeg(a, b) {
    if (!a || !b) return null;
    const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    const angle = 2 * Math.acos(Math.min(1, dot));
    return (angle * 180) / Math.PI;
}

// ------------------------------------------------------------
// Firma de píxeles de la región de la cabeza
// (flood-fill desde los bordes → silueta → franja superior)
// ------------------------------------------------------------
async function headSignature(page) {
    return page.evaluate(() => {
        const c = document.querySelector('.flu-bridge-container canvas');
        if (!c) return null;
        const w = c.width;
        const h = c.height;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(c, 0, 0);
        const img = ctx.getImageData(0, 0, w, h).data;

        // Fondo de referencia = promedio de las 4 esquinas
        const px = (x, y) => {
            const i = (y * w + x) * 4;
            return [img[i], img[i + 1], img[i + 2]];
        };
        const corners = [px(2, 2), px(w - 3, 2), px(2, h - 3), px(w - 3, h - 3)];
        const bgR = Math.round(corners.reduce((s, cc) => s + cc[0], 0) / 4);
        const bgG = Math.round(corners.reduce((s, cc) => s + cc[1], 0) / 4);
        const bgB = Math.round(corners.reduce((s, cc) => s + cc[2], 0) / 4);
        const isBg = (x, y) => {
            const i = (y * w + x) * 4;
            return Math.abs(img[i] - bgR) + Math.abs(img[i + 1] - bgG) + Math.abs(img[i + 2] - bgB) < 80;
        };

        // Flood-fill desde los bordes para marcar el fondo CONECTADO
        const seen = new Uint8Array(w * h);
        const stack = [];
        for (let x = 0; x < w; x++) {
            stack.push(x, 0);
            stack.push(x, h - 1);
        }
        for (let y = 0; y < h; y++) {
            stack.push(0, y);
            stack.push(w - 1, y);
        }
        while (stack.length) {
            const y = stack.pop();
            const x = stack.pop();
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const idx = y * w + x;
            if (seen[idx]) continue;
            seen[idx] = 1;
            if (!isBg(x, y)) continue;
            stack.push(x + 1, y);
            stack.push(x - 1, y);
            stack.push(x, y + 1);
            stack.push(x, y - 1);
        }

        // Bbox de la silueta (todo lo que NO es fondo conectado)
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!seen[y * w + x]) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < minX) return { ok: false, reason: 'no-silhouette' };

        // Región de la cabeza: franja superior del bbox (gorra + orejas + decoración)
        const hx0 = Math.round(minX + (maxX - minX) * 0.12);
        const hx1 = Math.round(minX + (maxX - minX) * 0.88);
        const hy0 = minY;
        const hy1 = Math.round(minY + (maxY - minY) * 0.42);

        let sr = 0, sg = 0, sb = 0, n = 0, nonBg = 0;
        const headPx = [];
        for (let y = hy0; y < hy1; y++) {
            for (let x = hx0; x < hx1; x++) {
                const i = (y * w + x) * 4;
                sr += img[i];
                sg += img[i + 1];
                sb += img[i + 2];
                n++;
                if (!seen[y * w + x]) nonBg++;
                // Firma downsampled (cada 2º píxel) para detección por-píxel
                if ((y & 1) === 0 && (x & 1) === 0) headPx.push(img[i], img[i + 1], img[i + 2]);
            }
        }
        return {
            ok: true,
            bbox: [minX, minY, maxX, maxY],
            head: [hx0, hy0, hx1, hy1],
            mean: [sr / n, sg / n, sb / n],
            nonBgRatio: nonBg / n,
            headPx,
        };
    });
}

// ------------------------------------------------------------
// Cambio por-píxel entre dos firmas de cabeza (downsampled).
// Robusto para accesorios pequeños y claros (santa-hat) donde el
// promedio regional se diluye: basta con que una fracción mínima
// de píxeles cambie significativamente.
// ------------------------------------------------------------
function headPxChanged(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
    if (a.length !== b.length) return 0; // firmas incompatibles -> no afirmar cambio
    let changed = 0;
    for (let i = 0; i < a.length; i += 3) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d > 40) changed++;
    }
    return changed / (a.length / 3);
}

// ------------------------------------------------------------
// Root-motion: ¿la decoración sigue al HUESO ancla durante Jump_while_run?
// ------------------------------------------------------------
async function measureRootMotion(page, key, anim) {
    return page.evaluate(async ({ k, a }) => {
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        const R3F = await import('/tests/e2e/r3fProxy.ts');
        const c = document.querySelector('.flu-bridge-container canvas');
        const root = c && R3F.r3fRoots ? R3F.r3fRoots.get(c) : null;
        const store = root && root.store;
        const getState = () => (store && store.getState ? store.getState() : null);
        const state0 = getState();
        if (!state0 || !state0.scene) return { ok: false, reason: 'no-scene' };
        const scene = state0.scene;

        // Reproducir la animación vía el store (el MISMO camino real que la
        // app: store -> efecto React -> animator.crossFadeTo(...)). No hay
        // atajo a un animator: no existe window.__bunnyAnimator, y añadirlo
        // sería una ruta doble de prueba. Medimos el comportamiento REAL.
        const st = window.__bunnyStore && window.__bunnyStore.getState();
        if (!st || !st.playAnimation) return { ok: false, reason: 'no-store' };

        // Localizar la decoración y los huesos de referencia ANTES de
        // reproducir. Esta sonda NO cambia frameloop ni usa reloj sintético:
        // mide el mezclador bajo el rAF nativo (metodología PROBADA en
        // diag-mixer-state.mjs: playAnimation -> 350 ms -> 36 x 150 ms).
        let dec = null;
        let rootBone = null;
        let headBone = null;
        scene.traverse((o) => {
            if (o.name === `decoration-${k}`) dec = o;
            if (o.name === 'root' && o.type === 'Bone') rootBone = o;
            if (o.name === 'head' && o.type === 'Bone') headBone = o;
        });
        if (!dec || !dec.parent) return { ok: false, reason: 'not-found' };

        const subscribersEntry = (getState().internal && getState().internal.subscribers) || [];

        // Referencia PREVIA a reproducir: la pose actual está asentada en
        // Bind-pose (settleMixer previo en MAIN). El delta se mide vs esta
        // referencia, de modo que aunque el mixer se congelara temprano en la
        // pose del burst, la diferencia bind -> burst ya queda capturada.
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

        // TIEMPO REAL — ventana PROBADA en diag-mixer-state.mjs:
        //   playAnimation -> 350 ms -> 36 x 150 ms ≈ 5.4 s de muestreo.
        // El burst de Jump_while_run (rootLocal≈19.67, headWorld≈0.199,
        // decWorld≈0.102) cae en las primeras muestras, ANTES del
        // congelamiento eventual del mixer en tiempo real (~1-2.8 s). El
        // enfoque sintético anterior (0.8 s de asentado + barrido sobre reloj
        // simulado) coincidía justo con ese momento -> flakiness (0.0000).
        st.playAnimation(a);
        await new Promise((r) => setTimeout(r, 350));

        const SAMPLES = 36;
        const STEP_MS = 150;
        const decSamples = [];
        const parentSamples = [];
        const rootLocalSamples = [];
        const parentLocalSamples = [];
        const headWorldSamples = [];
        let parentQuatMaxDeg = 0;
        let subscribersDuring = 0;
        for (let i = 0; i < SAMPLES; i++) {
            const row = readRow();
            decSamples.push(row.dec);
            parentSamples.push(row.parent);
            if (row.rootLocal) rootLocalSamples.push(row.rootLocal);
            parentLocalSamples.push(row.parentLocal);
            if (row.headWorld) headWorldSamples.push(row.headWorld);
            const ang = dec.parent.quaternion.angleTo(quat0) * 180 / Math.PI;
            if (ang > parentQuatMaxDeg) parentQuatMaxDeg = ang;
            subscribersDuring = (getState().internal && getState().internal.subscribers) ? getState().internal.subscribers.length : 0;
            await new Promise((r) => setTimeout(r, STEP_MS));
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

        return {
            ok: true,
            anim: a,
            deterministic: false,
            mode: 'real',
            parentName: dec.parent.name || dec.parent.type,
            parentIsBone: dec.parent.type === 'Bone',
            dec: delta(decSamples, ref.dec),
            parent: delta(parentSamples, ref.parent),
            samples: decSamples.length,
            diag: {
                subscribers: { entry: subscribersEntry.length, during: subscribersDuring },
                rootLocal: rootBone ? delta(rootLocalSamples, ref.rootLocal) : null,
                headWorld: headBone ? delta(headWorldSamples, ref.headWorld) : null,
                parentLocal: delta(parentLocalSamples, ref.parentLocal),
                parentQuatMaxDeg,
                direct: null,
            },
            first: { dec: decSamples[0], parent: parentSamples[0] },
            last: { dec: decSamples[decSamples.length - 1], parent: parentSamples[parentSamples.length - 1] },
        };
    }, { k: key, a: anim });
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const browserErrors = [];
page.on('pageerror', (e) => browserErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
    if (m.type() === 'error') browserErrors.push(`console.error: ${m.text()}`);
});

try {
    console.log(`\n=== FASE 2 · Validación visual de decoraciones 3D ===`);
    console.log(`URL: ${URL}\n`);

    // 1) Cargar app + esperar modelo 3D listo
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    record('Canvas 3D presente', true, '.flu-bridge-container canvas encontrado');

    const preload = await pollUntil(
        page,
        () => page.evaluate(() => !!window.__bunnyPreloadDone),
        60000,
        500,
    );
    record('Modelo FBX cargado (__bunnyPreloadDone)', !!preload, preload ? 'skeleton + clips precargados' : 'TIMEOUT esperando preload');

    // 2) Asegurar handle del store
    const storeSetup = await page.evaluate(async () => {
        // @ts-ignore
        if (window.__bunnyStore && window.__bunnyStore.getState) return { ok: true, source: 'window' };
        try {
            // @ts-ignore - ruta válida en runtime (dev server)
            const m = await import('/src/avatar/store/bunnyStore.ts');
            // @ts-ignore
            window.__bunnyStore = m.useBunnyStore;
            return { ok: !!m.useBunnyStore, source: 'import' };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    });
    record('Handle del store (__bunnyStore)', storeSetup.ok, JSON.stringify(storeSetup));

    const sceneEval = await getSceneEval(page);
    const sceneOk = !!(sceneEval && sceneEval.ok);
    record('Acceso a escena R3F (_roots.get(canvas))', sceneOk, sceneOk ? `scene alcanzable · ${sceneEval.childCount} hijos raíz · [${sceneEval.top.join(', ')}]` : 'no hay escena accesible');

    // 3) Línea base: sin decoración + firma de píxeles
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration(null));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(REPORT_DIR, '00-baseline.png') });
    const baseline = await headSignature(page);
    record('Línea base: silueta y región de cabeza', !!(baseline && baseline.ok), baseline ? JSON.stringify({ bbox: baseline.bbox, head: baseline.head }) : 'sin silueta');
    if (baseline && baseline.ok) {
        console.log(`      base mean=${baseline.mean.map((v) => v.toFixed(1)).join(',')} nonBgRatio=${baseline.nonBgRatio.toFixed(4)}`);
    }

    // 4) Por cada decoración: anclar + verificar escena + verificar píxeles + captura
    for (const key of DECORATIONS) {
        console.log(`\n--- Decoración: ${key} ---`);
        // Pose de referencia (bind) ANTES de anclar: el offset se
        // calcula sobre la pose canónica del rig y la sonda lo
        // verifica en la misma pose (tolerancia estricta 0.02).
        await page.evaluate(() => window.__bunnyStore.getState().playAnimation('Bind-pose'));
        await settleMixer(page, 0.8);   // asienta el crossfade a Bind-pose ANTES de anclar
        // Captura pose-invariante ANTES de anclar: corona en el marco
        // local del hueso 'head' + cuaternión (misma pose asentada).
        const crown = await captureCrownLocal(page);
        await page.evaluate((k) => window.__bunnyStore.getState().setDecoration(k), key);
        await page.waitForTimeout(150); // React commitea el ancla ANTES del asentado
        await settleMixer(page, 0.5);   // estabiliza la pose ANTES de sondear el ancla

        const probe = await probeDecoration(page, key);
        if (!probe.ok) {
            record(`[${key}] grupo decoration-${key} en la escena`, false, probe.reason);
            continue;
        }
        // Anclada a un HUESO ('head' → 'root') en la corona de la cabeza
        const boneOk = probe.parentIsBone && (probe.parentName === 'head' || probe.parentName === 'root');
        const childOk = probe.childCount > 0;
        // Verificación POSE-INVARIANTE: dec.localPos (group.position) es
        // inmutable tras el ancla y se fija a head.worldToLocal(corona)
        // en la pose de ancla; la corona capturada aquí se evalúa en la
        // MISMA pose asentada → comparar localPos vs crown.local es
        // válido aunque el mezclador derive la pose entre ancla y sonda.
        let localOk = false;
        let localDelta = null;
        if (crown && crown.ok) {
            localDelta = probe.localPos.map((v, i) => Math.abs(v - crown.local[i]));
            localOk = localDelta.every((d) => d < 0.02);
        }
        // Diagnósticos (no forman el veredicto): Δworld = estabilidad de
        // pose entre ancla y sonda; derivaHead = deriva angular del hueso.
        let worldDelta = null;
        if (probe.anchorWorld) {
            worldDelta = probe.worldPos.map((v, i) => Math.abs(v - probe.anchorWorld[i]));
        }
        const headDrift = quatDriftDeg(crown && crown.headQuat, probe.headQuat);
        record(
            `[${key}] anclada al hueso 'head' en la corona de la cabeza`,
            boneOk && childOk && localOk,
            `hijo de "${probe.parentName}" (${probe.parentType}) · coronaEsperada(local)=[${crown && crown.ok ? crown.local.map((v) => v.toFixed(3)).join(', ') : 'n/a'}] · Δlocal=[${localDelta ? localDelta.map((v) => v.toFixed(3)).join(', ') : 'n/a'}] · Δworld(diag)=[${worldDelta ? worldDelta.map((v) => v.toFixed(3)).join(', ') : 'n/a'}] · derivaHead=${headDrift != null ? headDrift.toFixed(2) + '°' : 'n/a'} · hijos=${probe.childCount}`,
        );

        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(REPORT_DIR, `${key}.png`) });
        const sig = await headSignature(page);
        if (baseline && baseline.ok && sig && sig.ok) {
            const meanDelta = Math.abs(sig.mean[0] - baseline.mean[0]) + Math.abs(sig.mean[1] - baseline.mean[1]) + Math.abs(sig.mean[2] - baseline.mean[2]);
            const nonBgChange = Math.abs(sig.nonBgRatio - baseline.nonBgRatio);
            const changedFraction = headPxChanged(sig.headPx, baseline.headPx);
            const visible =
                meanDelta > PIXEL_MEAN_DELTA_THRESHOLD ||
                nonBgChange > PIXEL_NONBG_CHANGE_THRESHOLD ||
                changedFraction > PIXEL_CHANGED_FRACTION_THRESHOLD;
            record(
                `[${key}] visible en pantalla (región de la cabeza)`,
                visible,
                `meanDelta=${meanDelta.toFixed(2)} (umbral ${PIXEL_MEAN_DELTA_THRESHOLD}) · nonBgChange=${(nonBgChange * 100).toFixed(2)}% (umbral ${(PIXEL_NONBG_CHANGE_THRESHOLD * 100).toFixed(2)}%) · píxelesCambiados=${(changedFraction * 100).toFixed(2)}% (umbral ${(PIXEL_CHANGED_FRACTION_THRESHOLD * 100).toFixed(2)}%) · mean=[${sig.mean.map((v) => v.toFixed(1)).join(', ')}]`,
            );
        } else {
            record(`[${key}] visible en pantalla (región de la cabeza)`, false, 'no se pudo obtener firma de píxeles');
        }
    }

    // 5) Root-motion: la decoración sigue al hueso ancla durante Jump_while_run
    console.log(`\n--- Root-motion (Jump_while_run) ---`);
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration('flag'));
    await page.waitForTimeout(150); // React commitea el ancla ANTES del barrido
    await settleMixer(page, 0.7);
    const motion = await measureRootMotion(page, 'flag', 'Jump_while_run');
    if (motion.ok) {
        const anchorMoved = motion.parent.max > ROOT_MOTION_THRESHOLD;
        const decFollows = motion.dec.max > ROOT_MOTION_THRESHOLD;
        const dg = motion.diag || {};
        const subsTxt = dg.subscribers ? `subs=${dg.subscribers.entry}/${dg.subscribers.during}` : 'subs=n/a';
        const rlTxt = dg.rootLocal ? `rootLocal(max=${dg.rootLocal.max.toFixed(4)})` : 'rootLocal=n/a';
        const plTxt = dg.parentLocal ? `parentLocal(max=${dg.parentLocal.max.toFixed(4)})` : 'parentLocal=n/a';
        const quatTxt = dg.parentQuatMaxDeg != null ? `parentQuat=${dg.parentQuatMaxDeg.toFixed(2)}°` : 'parentQuat=n/a';
        const dirTxt = dg.direct
            ? dg.direct.error
                ? `direct=ERR(${dg.direct.error})`
                : `direct(local=${dg.direct.rootLocalMoved.toFixed(4)}, head=${dg.direct.headWorldMoved.toFixed(4)})`
            : 'direct=n/a';
        record(
            'Root-motion: la decoración sigue al hueso ancla (head)',
            anchorMoved && decFollows && motion.parentIsBone,
            `anim=${motion.anim} · modo=${motion.mode || 'n/a'} · determinista=${motion.deterministic} · muestras=${motion.samples || 'n/a'} · hueso ancla "${motion.parentName}"(max=${motion.parent.max.toFixed(4)}, ejes=[${motion.parent.axis.map((v) => v.toFixed(4)).join(', ')}]) · decoración(max=${motion.dec.max.toFixed(4)}, ejes=[${motion.dec.axis.map((v) => v.toFixed(4)).join(', ')}]) · diag[${subsTxt} · ${rlTxt} · ${plTxt} · ${quatTxt} · ${dirTxt}]`,
        );
    } else {
        record('Root-motion: la decoración sigue al hueso ancla (head)', false, motion.reason);
    }

    // 6) Limpieza: setDecoration(null) retira el grupo
    await page.evaluate(() => window.__bunnyStore.getState().setDecoration(null));
    await page.waitForTimeout(700);
    const after = await probeDecoration(page, 'flag');
    record('Limpieza: setDecoration(null) retira el grupo', !after.ok, after.ok ? 'aún presente en la escena' : 'grupo decoration-flag retirado de la escena');

    // 7) Errores de consola críticos
    const criticalErrors = browserErrors.filter((e) => /decoration|catalog|DecorationsRenderer/i.test(e));
    record('Sin errores de consola en el módulo de decoraciones', criticalErrors.length === 0, criticalErrors.length ? criticalErrors.join(' | ') : 'ninguno');
} catch (err) {
    record('Ejecución general', false, String(err && err.stack ? err.stack : err));
} finally {
    await browser.close();
}

// ------------------------------------------------------------
// Resumen
// ------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
console.log(`\n=== RESUMEN: ${passed}/${results.length} checks OK ===`);
for (const r of results) {
    console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.name}`);
}
console.log(`\nCapturas guardadas en: ${REPORT_DIR}`);
process.exit(passed === results.length ? 0 : 1);
