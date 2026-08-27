// ============================================================
// probe-clip-meta.mjs — DIAGNÓSTICO del contenido de cada clip FBX
// ------------------------------------------------------------
// Pregunta: ¿los clips de animación tienen keyframes REALES en
// los huesos (pelvis/head) o son clips estáticos de una sola
// pose? El probe-root-motion.mjs mostró que Walk y Jump_while_run
// mueven head/pelvis (0.045–0.226) pero Jump_in_place, Run,
// Dance e Idle_1 no (max=0.0000). Esto puede deberse a que esos
// clips NO contienen tracks animados de posición en esos huesos.
//
// Este probe recarga cada FBX vía loadFbx() (misma ruta que el
// animador) y vuelca metadatos del clip:
//   - duración
//   - nº de tracks
//   - por track: nombre, nº de keyframes, y si los valores varían
//   - ¿existe pelvis.position / head.position con >1 keyframe
//     de valor distinto?
//
// Run:  node tests/e2e/probe-clip-meta.mjs
// Env:  FLU_URL=http://localhost:5174/ (por defecto)
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.FLU_URL || 'http://localhost:5174/';

// Misma tabla que bunnyAnimator.ts ANIMATION_PATHS
const ANIMATION_PATHS = {
    'Idle_1': '/models/Animations/Bunny@Idle_1.fbx',
    'Idle_2': '/models/Animations/Bunny@Idle_2.fbx',
    'Idle_3': '/models/Animations/Bunny@Idle_3.fbx',
    'Bind-pose': '/models/Animations/Bunny@Bind-pose.fbx',
    'Walk': '/models/Animations/Bunny@Walk.fbx',
    'Walk_sneaky': '/models/Animations/Bunny@Walk_sneaky.fbx',
    'Run': '/models/Animations/Bunny@Run.fbx',
    'Jump_in_place': '/models/Animations/Bunny@Jump_in_place.fbx',
    'Jump_while_run': '/models/Animations/Bunny@Jump_while_run.fbx',
    'Emo_blink': '/models/Animations/Bunny@Emo_blink.fbx',
    'Emo_neutral': '/models/Animations/Bunny@Emo_neutral.fbx',
    'Cap_back': '/models/Animations/Bunny@Cap_back.fbx',
    'Cap_front': '/models/Animations/Bunny@Cap_front.fbx',
    'Dance': '/models/Animations/Bunny@Dance.fbx',
};

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
    console.log(`\n=== PROBE CLIP META (contenido de cada FBX de animación) ===`);
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
    console.log(`[ok] __bunnyPreloadDone=${!!preload}`);

    // Recargamos cada FBX vía loadFbx (misma ruta que el animador) y
    // volcamos metadatos del clip. El worker ya está vivo en la app,
    // así que la recarga es barata y no toca el estado del viewer.
    const results = await page.evaluate(async (paths) => {
        const mod = await import('/src/avatar/workers/fbxWorkerClient.ts');
        const loadFbx = mod.loadFbx;
        const out = {};
        for (const [name, path] of Object.entries(paths)) {
            try {
                const fbx = await loadFbx(path);
                const clip = fbx.animations && fbx.animations[0];
                if (!clip) {
                    out[name] = { error: 'sin fbx.animations[0]', groups: fbx.animations?.length ?? 0 };
                    continue;
                }
                const tracks = clip.tracks.map((t) => {
                    // Cuántos keyframes y si los valores varían
                    let n = 0;
                    let varies = false;
                    if (t.times && t.times.length) {
                        n = t.times.length;
                        const vals = t.values;
                        if (n > 1 && vals && vals.length) {
                            // comparar primer sample contra el resto
                            const span = t.getValueSize();
                            for (let i = 1; i < n; i++) {
                                let d = 0;
                                for (let k = 0; k < span; k++) {
                                    const a = vals[k];
                                    const b = vals[i * span + k];
                                    const diff = b - a;
                                    d += diff * diff;
                                }
                                if (Math.sqrt(d) > 1e-6) { varies = true; break; }
                            }
                        }
                    }
                    return { name: t.name, keys: n, varies };
                });
                const pelvisPos = tracks.find((t) => t.name === 'pelvis.position');
                const pelvisRot = tracks.find((t) => t.name === 'pelvis.quaternion');
                const headPos = tracks.find((t) => t.name === 'head.position');
                const headRot = tracks.find((t) => t.name === 'head.quaternion');
                out[name] = {
                    duration: +clip.duration.toFixed(3),
                    tracks: tracks.length,
                    pelvis_position: pelvisPos ? { keys: pelvisPos.keys, varies: pelvisPos.varies } : null,
                    pelvis_quaternion: pelvisRot ? { keys: pelvisRot.keys, varies: pelvisRot.varies } : null,
                    head_position: headPos ? { keys: headPos.keys, varies: headPos.varies } : null,
                    head_quaternion: headRot ? { keys: headRot.keys, varies: headRot.varies } : null,
                    trackNames: tracks.slice(0, 12).map((t) => `${t.name}[${t.keys}${t.varies ? '*' : ''}]`),
                    totalTracks: tracks.length,
                };
            } catch (e) {
                out[name] = { error: String(e && e.message ? e.message : e) };
            }
        }
        return out;
    }, ANIMATION_PATHS);

    for (const [name, r] of Object.entries(results)) {
        console.log(`\n--- anim: ${name} ---`);
        if (r.error) { console.log(`  ERROR: ${r.error}`); continue; }
        console.log(`  duration=${r.duration}s  tracks=${r.totalTracks}`);
        console.log(`  pelvis.position   = ${r.pelvis_position ? `${r.pelvis_position.keys} keys, varies=${r.pelvis_position.varies}` : 'AUSENTE'}`);
        console.log(`  pelvis.quaternion = ${r.pelvis_quaternion ? `${r.pelvis_quaternion.keys} keys, varies=${r.pelvis_quaternion.varies}` : 'AUSENTE'}`);
        console.log(`  head.position     = ${r.head_position ? `${r.head_position.keys} keys, varies=${r.head_position.varies}` : 'AUSENTE'}`);
        console.log(`  head.quaternion   = ${r.head_quaternion ? `${r.head_quaternion.keys} keys, varies=${r.head_quaternion.varies}` : 'AUSENTE'}`);
        console.log(`  tracks (primeros 12):`);
        for (const t of r.trackNames) console.log(`    ${t}`);
    }

    console.log(`\n--- errores de consola: ${browserErrors.length} ---`);
    browserErrors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
    console.log('\n=== FIN PROBE CLIP META ===');
} finally {
    await browser.close();
}
