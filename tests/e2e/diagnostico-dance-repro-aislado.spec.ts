// ============================================================
// DIAGNÓSTICO AISLADO: ¿la SECUENCIA three.js de OS4 congela,
// o es el estado de BunnyViewer?
//
// Objetivo: separar con CERTEZA las dos hipótesis que quedan
// después de REFUTAR el binding por nombre (104/104 huesos) y
// los clips "malos" (Cache HIT/MISS idénticos):
//   (i)   la secuencia three.js (mixer → action A play+tick →
//         stop → action B clipAction+play+tick) congela por sí
//         misma, o
//   (ii)  la integración en BunnyViewer (StrictMode / mixer
//         obsoleto / activación) es la que congela.
//
// MÉTODO: dentro de la página real (mismo servidor Vite, mismos
// módulos importados, mismos FBX), se replica la secuencia EXACTA
// de createOrReuseAction (clipAction + reset + LoopRepeat/Infinity
// + weight=1 + play) y se mide:
//   - action.time ANTES/DESPUÉS de tickear (¿avanza el tiempo?)
//   - acción.isRunning(), action.paused, action._cacheIndex,
//     mixer._nActiveActions (¿está activa en el mixer?)
//   - movimiento mundial real de los huesos (¿aplica el clip?)
//
// PARTE 1: three.js puro con esqueleto sintético.
// PARTE 2: FBX reales (Bunny_full + Idle_2 + Dance + Idle_3) a
//           través del loadFbx real de la app.
//
// Solo informativo: NO lanza asserts (aún no sabemos la verdad).
// ============================================================
import { test, expect, Page } from '@playwright/test';

test('REPRO AISLADO: la secuencia three.js de OS4 ¿congela la 2ª acción?', async ({ page }) => {
    test.setTimeout(240000);

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[REPRO]')) console.log(`[BROWSER] ${text}`);
    });
    page.on('pageerror', (err) => {
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // 1. Cargar la app (necesaria para servir los módulos y FBX)
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 60000 });
    await page.waitForTimeout(1500);

    // ========================================
    // 2. Ejecutar el repro EN LA PÁGINA (contexto real de Vite)
    // ========================================
    const ctx = await page.evaluate(async () => {
        const results: string[] = [];
        const log = (s: string) => {
            console.log(`[REPRO] ${s}`);
            results.push(s);
        };

        // @ts-ignore
        const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
        // @ts-ignore
        const fbxMod = await import('/src/avatar/workers/fbxWorkerClient.ts');

        // ---------- utilidades ----------
        const capture = (root: any) => {
            root.updateMatrixWorld(true);
            const bones: Record<string, { p: number[]; q: number[] }> = {};
            root.traverse((c: any) => {
                if (c.isBone) {
                    const p = new THREE.Vector3();
                    const q = new THREE.Quaternion();
                    c.getWorldPosition(p);
                    c.getWorldQuaternion(q);
                    bones[c.name] = { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] };
                }
            });
            return bones;
        };
        const motion = (A: any, B: any) => {
            let maxQ = 0, maxP = 0, topQ: string | null = null, topP: string | null = null;
            for (const n of Object.keys(B)) {
                const a = A[n], b = B[n];
                if (!a || !b) continue;
                const dot = Math.min(1, Math.abs(a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3]));
                const ang = 2 * Math.acos(dot);
                if (ang > maxQ) { maxQ = ang; topQ = n; }
                const dp = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
                if (dp > maxP) { maxP = dp; topP = n; }
            }
            return { maxQ: +maxQ.toExponential(3), maxP: +maxP.toExponential(3), topQ, topP };
        };
        const tickN = (mixer: any, n: number, dt: number) => {
            for (let i = 0; i < n; i++) mixer.update(dt);
        };
        // Secuencia EXACTA de createOrReuseAction (ruta nueva) de BunnyViewer
        const makeAction = (mixer: any, clip: any) => {
            const a = mixer.clipAction(clip);
            a.reset();
            a.setLoop(THREE.LoopRepeat, Infinity);
            a.weight = 1.0;
            a.play();
            return a;
        };
        // Mide avance de tiempo + movimiento de una acción activa
        const runPhase = (label: string, mixer: any, action: any, root: any, windows = 2) => {
            const before = action.time;
            const snap0 = capture(root);
            tickN(mixer, 5, 1 / 60); // asentar
            const snap1 = capture(root);
            const m1 = motion(snap0, snap1);
            let dTime = action.time - before;
            // siguiente ventana
            tickN(mixer, 30, 1 / 60);
            const snap2 = capture(root);
            const m2 = motion(snap1, snap2);
            dTime = action.time - before;
            let dTime2 = 0;
            if (windows > 1) {
                tickN(mixer, 30, 1 / 60);
                const snap3 = capture(root);
                const m3 = motion(snap2, snap3);
                dTime2 = action.time - (before + (30 + 5) * (1 / 60) + (windows > 1 ? 30 * (1 / 60) : 0));
                log(`${label}: time ${before.toFixed(4)}→${action.time.toFixed(4)} (Δ${(action.time - before).toFixed(4)}s) | running=${action.isRunning()} paused=${action.paused} enabled=${action.enabled} cacheIndex=${action._cacheIndex} nActive=${mixer._nActiveActions} | M1 rot=${m1.maxQ} pos=${m1.maxP} (${m1.topQ}) | M2 rot=${m2.maxQ} pos=${m2.maxP} (${m2.topQ}) | ΔT2=${dTime2.toFixed(4)}`);
                return { time: action.time, m1, m2 };
            }
            log(`${label}: time ${before.toFixed(4)}→${action.time.toFixed(4)} (Δ${(action.time - before).toFixed(4)}s) | running=${action.isRunning()} paused=${action.paused} enabled=${action.enabled} cacheIndex=${action._cacheIndex} nActive=${mixer._nActiveActions} | M1 rot=${m1.maxQ} pos=${m1.maxP} (${m1.topQ}) | M2 rot=${m2.maxQ} pos=${m2.maxP} (${m2.topQ})`);
            return { time: action.time, m1, m2 };
        };

        // ==========================================
        // PARTE 1 — three.js PURO (esqueleto sintético)
        // ==========================================
        try {
            log('=== PARTE 1: three.js puro, esqueleto sintético ===');
            const scene = new THREE.Scene();
            const root = new THREE.Group();
            scene.add(root);
            const b0 = new THREE.Bone(); b0.name = 'rootBone'; b0.position.set(0, 1, 0);
            const b1 = new THREE.Bone(); b1.name = 'hipBone'; b1.position.set(0, 0.2, 0);
            const b2 = new THREE.Bone(); b2.name = 'armBone'; b2.position.set(0.1, 0.1, 0);
            b0.add(b1); b1.add(b2); root.add(b0);

            const times = [0, 1];
            // clip A: rota armBone 90° (identidad → rotY 90°)
            const qA = [0, 0, 0, 1, Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)];
            const clipA = new THREE.AnimationClip('WalkA', 1, [
                new THREE.QuaternionKeyframeTrack('armBone.quaternion', times, qA),
                new THREE.VectorKeyframeTrack('hipBone.position', times, [0, 0.2, 0, 0, 0.4, 0]),
            ]);
            const mixer1 = new THREE.AnimationMixer(root);
            const actA = makeAction(mixer1, clipA);
            log(`P1-A creada: clipA "${clipA.name}" (${clipA.duration}s, ${clipA.tracks.length} tracks)`);
            runPhase('P1-A (1ª acción)', mixer1, actA, root);

            // caso 1: A → stop → B (misma secuencia que el mecanismo FASE B→C)
            actA.stop();
            const clipB = new THREE.AnimationClip('WalkB', 1, [
                new THREE.QuaternionKeyframeTrack('hipBone.quaternion', times, [0, 0, 0, 1, 0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]),
                new THREE.VectorKeyframeTrack('armBone.position', times, [0.1, 0.1, 0, 0.3, 0.1, 0]),
            ]);
            const actB = makeAction(mixer1, clipB);
            log(`P1-B creada tras stop de A (mismo mixer): clipB "${clipB.name}"`);
            runPhase('P1-B (2ª acción tras stop)', mixer1, actB, root);

            // caso 2: A sigue activa y se crea B encima (transición sin stop)
            const actA2 = makeAction(mixer1, clipA);
            const actB2 = makeAction(mixer1, clipB);
            log(`P1-C creadas A2+B2 simultáneas (mismo mixer, sin stop): nActive=${(mixer1 as any)._nActiveActions}`);
            runPhase('P1-C (A+B simultáneas)', mixer1, actB2, root);
        } catch (e: any) {
            log(`PARTE 1 ERROR: ${e.message}`);
        }

        // ==========================================
        // PARTE 2 — FBX REALES (Bunny_full + Idle_2/Dance/Idle_3)
        // ==========================================
        try {
            log('=== PARTE 2: FBX reales de la app ===');
            const root2: any = await fbxMod.loadFbx('/models/Bunny_full.fbx');
            const mixer2 = new THREE.AnimationMixer(root2);
            log(`P2 modelo cargado: ${root2.children.length} hijos directos`);

            // CONTROL conocido-bueno: Idle_2 (Cache MISS en la app → SÍ mueve)
            const fbxIdle2: any = await fbxMod.loadFbx('/models/Animations/Bunny@Idle_2.fbx');
            const clip2A = fbxIdle2.animations[0];
            const act2A = makeAction(mixer2, clip2A);
            log(`P2-A (Idle_2, 1ª acción): "${clip2A.name}" (${clip2A.duration.toFixed(2)}s, ${clip2A.tracks.length} tracks)`);
            runPhase('P2-A (Idle_2 control)', mixer2, act2A, root2, 2);

            // DANCE creada sobre el MISMO mixer mientras Idle_2 sigue (transición real)
            const fbxDance: any = await fbxMod.loadFbx('/models/Animations/Bunny@Dance.fbx');
            const clip2B = fbxDance.animations[0];
            const act2B = makeAction(mixer2, clip2B);
            log(`P2-B (Dance, 2ª acción, Idle_2 sigue activa): "${clip2B.name}" (${clip2B.duration.toFixed(2)}s, ${clip2B.tracks.length} tracks)`);
            runPhase('P2-B (Dance con Idle_2 activa)', mixer2, act2B, root2, 2);

            // Ahora detener Idle_2 (equivalente al fade-out/stop del efecto) y seguir midiendo Dance
            act2A.stop();
            log(`P2-C (Dance tras stop de Idle_2): nActive=${(mixer2 as any)._nActiveActions}`);
            runPhase('P2-C (Dance, Idle_2 detenida)', mixer2, act2B, root2, 2);

            // Idle_3 fresca tras stop de Dance (la fase C/D del mecanismo)
            act2B.stop();
            const fbxIdle3: any = await fbxMod.loadFbx('/models/Animations/Bunny@Idle_3.fbx');
            const clip2C = fbxIdle3.animations[0];
            const act2C = makeAction(mixer2, clip2C);
            log(`P2-D (Idle_3 fresca tras stop de Dance): "${clip2C.name}" (${clip2C.duration.toFixed(2)}s, ${clip2C.tracks.length} tracks)`);
            runPhase('P2-D (Idle_3 fresca tras stop)', mixer2, act2C, root2, 2);
        } catch (e: any) {
            log(`PARTE 2 ERROR: ${e.message}`);
        }

        return { results };
    });

    // ========================================
    // 3. Volcar resultado
    // ========================================
    console.log('========== RESULTADO REPRO AISLADO ==========');
    for (const r of ctx.results) console.log(`  ${r}`);

    // Solo informativo: el test siempre "pasa" (el veredicto se lee en el log)
    expect(ctx.results.length).toBeGreaterThan(0);
});
