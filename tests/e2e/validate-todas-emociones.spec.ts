// ============================================================
// validate-todas-emociones.spec.ts
// VALIDACIÓN RUNTIME: TODAS las emociones/expresiones definidas
// en EXPRESSION_MAP ejecutan su animación (ninguna congelada).
//
// Contexto: tras el fix de rebase del timeline (primer keyframe → t=0),
// Dance/Idle_3 ya se mueven. Este test generaliza la validación a las
// 26 expresiones de src/avatar/index.ts (EXPRESSION_MAP):
//   - Para cada expresión: blendAnimation(anims) en el store REAL.
//   - Espera ~1.3s (mitad del clip, fuera del lead-in) y samplea el
//     skeleton REAL (SkinnedMesh.skeleton) + estado del mixer.
//   - Verdict por expresión:
//       MOVES          → hubo movimiento real del cuerpo (bodyMax > umbral)
//       POSE_ESTATICA  → clip cacheado + acción activa + mixer avanza,
//                        pero todos sus tracks son constantes (pose de
//                        reposo: Bind-pose, Emo_neutral, Cap_*). Se
//                        ejecuta correctamente (no congelado).
//       FROZEN/FAIL    → acción activa pero cuerpo inmóvil con keyframes
//                        reales, o clip no cacheado, o error de carga.
//   - NO toca logsEnabled (patrón autodestructivo conocido: corrompe el
//     mixer en tests).
// ============================================================
import { test, expect } from '@playwright/test';

interface SkinSample {
    ok: boolean;
    t: number;
    skinCount: number;
    skins: Record<string, { mesh: string; boneCount: number; bones: Record<string, { p: [number, number, number]; q: [number, number, number, number] }> }>;
}

interface ClipTL {
    ok: boolean;
    animName: string;
    duration: number;
    rebaseOffset: number;
    tracks: { name: string; keys: number; timeMin?: number; timeMax?: number }[];
}

// Clips de POSE estática intencional (no producen movimiento corporal:
// se "ejecutan" correctamente manteniendo una pose de reposo).
const STATIC_POSE_ANIMS = new Set(['Bind-pose', 'Emo_neutral', 'Emo_blink', 'Cap_front', 'Cap_back']);
// Clips SINTÉTICOS generados en BunnyViewer (ensureMouthClip / ensurePalabraClip).
// NO viven en clipCacheRef (viven en mouthClipRef/palabraClipRef), por lo que
// clipTimeline responde ok:false — no es un fallo real.
const SYNTHETIC_CLIPS = new Set(['MouthMove', 'Palabra']);

function maxDelta(a: SkinSample, b: SkinSample): number {
    let max = 0;
    for (const key of Object.keys(a.skins)) {
        const sa = a.skins[key];
        const sb = b.skins[key];
        if (!sb) continue;
        for (const name of Object.keys(sa.bones)) {
            const pa = sa.bones[name].p;
            const qa = sa.bones[name].q;
            const pb = sb.bones[name]?.p;
            const qb = sb.bones[name]?.q;
            if (!pb || !qb) continue;
            const dp = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
            const dot = Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]));
            const dq = 2 * Math.acos(dot);
            const d = Math.max(dp, dq);
            if (d > max) max = d;
        }
    }
    return max;
}

function hasRealKeys(tl: ClipTL): boolean {
    return tl.tracks.some((t) => (t.keys ?? 0) >= 2 && t.timeMin !== undefined && t.timeMax !== undefined && (t.timeMax! - t.timeMin!) > 0.0005);
}

test('Valida que TODAS las expresiones definidas ejecutan su animación (ninguna congelada)', async ({ page }) => {
    test.setTimeout(240000);

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 30000 });
    await page.waitForTimeout(5000); // carga modelo FBX (SwiftShader lento)

    // Inyectar stores y leer EXPRESSION_MAP del propio módulo (fuente de verdad)
    const setup = await page.evaluate(async () => {
        try {
            // @ts-ignore
            const bunnyModule = await import('/src/avatar/store/bunnyStore.ts');
            // @ts-ignore
            const idxModule = await import('/src/avatar/index.ts');
            // @ts-ignore
            window.__bunnyStore = bunnyModule.useBunnyStore;
            const map: Record<string, string[]> = idxModule.EXPRESSION_MAP ?? {};
            return { success: true, expressions: Object.keys(map), map };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
    expect(setup.success).toBe(true);
    const expressions = (setup as any).expressions as string[];
    const map = (setup as any).map as Record<string, string[]>;
    console.log(`[TEST] Expresiones definidas (${expressions.length}): ${expressions.join(', ')}`);
    expect(expressions.length).toBeGreaterThanOrEqual(20);

    // Estado inicial estable: IDLE
    await page.evaluate(async () => {
        // @ts-ignore
        const st = window.__bunnyStore.getState();
        st.stopAnimation();
        await new Promise((r) => setTimeout(r, 600));
    });

    const sampleSkin = async (): Promise<SkinSample> => {
        return page.evaluate(() => {
            const probe = (window as any).__bunnyProbe;
            if (!probe || !probe.skinSkeleton) return { ok: false } as SkinSample;
            return probe.skinSkeleton() as SkinSample;
        });
    };

    const clipOf = async (name: string): Promise<ClipTL> => {
        return page.evaluate((n: string) => {
            const probe = (window as any).__bunnyProbe;
            return probe.clipTimeline(n) as ClipTL;
        }, name);
    };

    // Basal: pose en reposo con la que comparar movimiento
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().blendAnimation(['Idle_1']);
        await new Promise((r) => setTimeout(r, 1500));
    });
    const idleSample = await sampleSkin();
    expect(idleSample.ok).toBe(true);

    const results: { expr: string; anims: string[]; verdict: string; bodyMax: number; detail: string }[] = [];
    let movesCount = 0;
    let poseCount = 0;
    let failCount = 0;

    for (const expr of expressions) {
        const anims = map[expr];
        const stateName = `S-${expr}`;
        console.log(`[TEST] ▶ ${stateName} → anims=${anims.join(',')}`);
        await page.evaluate(({ anims }) => {
            // @ts-ignore
            window.__bunnyStore.getState().blendAnimation(anims);
        }, { anims });
        await page.waitForTimeout(700);
        const sampleA = await sampleSkin();
        await page.waitForTimeout(900);
        const sampleB = await sampleSkin();

        const tlInfos: ClipTL[] = [];
        for (const a of anims) tlInfos.push(await clipOf(a));
        const active = await page.evaluate(() => {
            const probe = (window as any).__bunnyProbe;
            return probe.activeActions ? probe.activeActions() : [];
        });
        const clipStatus = await page.evaluate(() => {
            const probe = (window as any).__bunnyProbe;
            return probe.clipStatus ? probe.clipStatus() : { cached: [], mouthMove: false, palabra: false };
        });

        const bodyMax = maxDelta(sampleA, sampleB);
        const anyRealKeys = tlInfos.some((tl) => tl.ok && hasRealKeys(tl));
        // Un clip "falta" solo si no está cacheado Y no es sintético disponible.
        const anyMissing = tlInfos.some((tl) => {
            if (!tl.ok) {
                const name = tl.animName;
                if (SYNTHETIC_CLIPS.has(name)) {
                    return !(name === 'MouthMove' ? clipStatus.mouthMove : clipStatus.palabra);
                }
                return true;
            }
            return false;
        });
        const anyActive = active.some((a: any) => anims.includes(typeof a === 'string' ? a : a.name ?? a));
        const rebased = tlInfos.filter((tl) => tl.ok).map((tl) => `${tl.animName}=${tl.rebaseOffset.toFixed(3)}`).join(' ');
        const isAllStaticPose = anims.every((a: string) => STATIC_POSE_ANIMS.has(a));

        let verdict: string;
        if (anyMissing) {
            verdict = 'FAIL_CLIP_NO_CACHEADO';
            failCount++;
        } else if (bodyMax > 0.001) {
            verdict = 'MOVES';
            movesCount++;
        } else if (isAllStaticPose) {
            // Poses de reposo intencionales (Bind-pose/Emo_*/Cap_*): se ejecutan
            // correctamente manteniendo la pose → NO son un congelamiento.
            verdict = 'POSE_ESTATICA';
            poseCount++;
        } else if (!anyActive) {
            verdict = 'FAIL_ACCION_NO_ACTIVA';
            failCount++;
        } else {
            verdict = 'FROZEN';
            failCount++;
        }

        const detail = `bodyMax=${bodyMax.toExponential(2)} active=${anyActive} rebase=[${rebased}]`;
        results.push({ expr, anims, verdict, bodyMax, detail });
        console.log(`[TEST] ${stateName} → ${verdict} ${detail}`);
    }

    console.log('============================================================');
    console.log('[TEST] RESUMEN COBERTURA EMOCIONES');
    for (const r of results) console.log(`[TEST] ${r.verdict.padEnd(16)} ${r.expr.padEnd(16)} bodyMax=${r.bodyMax.toExponential(2)} ${r.detail}`);
    console.log(`[TEST] TOTAL=${results.length}  MOVES=${movesCount}  POSE_ESTATICA=${poseCount}  FAIL=${failCount}`);
    console.log('[TEST] FROZEN/FAIL (detallar):');
    for (const r of results) if (r.verdict.startsWith('FAIL') || r.verdict === 'FROZEN') console.log(`[TEST]   ✗ ${r.expr}: ${r.detail}`);
    console.log('[TEST] pageErrors=' + JSON.stringify(pageErrors));

    // Aserción definitiva: ninguna expresión congelada ni sin ejecutar
    const failures = results.filter((r) => r.verdict.startsWith('FAIL') || r.verdict === 'FROZEN');
    expect(failures, `Expresiones congeladas/fail: ${JSON.stringify(failures.map((f) => ({ expr: f.expr, detail: f.detail })))}`).toEqual([]);
    expect(movesCount).toBeGreaterThanOrEqual(6); // al menos las de movimiento real se mueven
});
