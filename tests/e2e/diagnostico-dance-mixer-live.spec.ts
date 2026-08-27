// ============================================================
// diagnostico-dance-mixer-live.spec.ts
// INSTRUMENTACIÓN EN VIVO DEL MIXER DURANTE EL CONGELAMIENTO (OS4)
//
// ANTECEDENTE (certezas ya establecidas en pruebas previas):
//   - Dance clip VÁLIDO y 100% bindeado (104/104), Idle_2/Idle_3 iguales.
//   - El repro aislado (diagnostico-dance-repro-aislado) DEMOSTRÓ que la secuencia
//     EXACTA de createOrReuseAction + mixer.update NUNCA congela — ni three.js puro
//     ni con los FBX reales: paused=false, enabled=true, running=true, action.time
//     avanza siempre y el cuerpo se mueve en TODAS las fases.
//   - En la app OS4 real: la 1ª acción nativa (Idle_2) SÍ mueve; toda acción creada
//     después (Idle_3, Dance) queda CONGELADA (bodyMax=0.000e+0).
//
// ESTE TEST: inyecta un monkey-patch en AnimationMixer.prototype.update y
// .clipAction (el three.js REAL que usa la app, vía el mismo módulo 'three'
// optimizado por Vite) para observar EN VIVO, durante la fase congelada, POR FRAME:
//   - qué mixer(es) se tickean (id asignado por WeakMap) y con qué delta;
//   - qué acciones están en _activeActions del mixer, con paused/enabled/running/
//     weight/timeScale/_cacheIndex vs _nActiveActions;
//   - si action.time avanza (dTime>0) o queda congelado;
//   - qué mixer recibió clipAction(Idle_3/Dance).
//
// Distingue con CERTEZA los mecanismos candidatos:
//   (a) mixer obsoleto/partido: la acción vive en un mixer que NUNCA se tickea;
//   (b) acción en _activeActions pero con _cacheIndex >= nActive → three no la
//       actualiza aunque el mixer corra;
//   (c) acción activa pero paused/timeScale=0 → tiempo congelado en la acción;
//   (d) acción sana y con tiempo avanzando → el congelamiento está FUERA del mixer
//       (escena/skeleton/binding).
//
// FASES (idénticas al mecanismo):
//   A. Idle_2 nativo (línea base, se mueve).   B. stopAnimation() → reposo.
//   C. playAnimation('Idle_3') FRESCO sin transición → CONGELADO (discriminador).
//   D. blendAnimation(['Dance']) → EL CAMINO REAL reportado por el usuario.
// ============================================================
import { test, Page } from '@playwright/test';

const BODY_MOVING_THRESHOLD = 0.001; // unidades de mundo
const SUSTAINED_MOVING = 3; // huesos del cuerpo "en movimiento" por ventana
const BODY_MAX_REAL = 0.002; // bodyMax mínimo para considerar "vivo"

interface Sample {
    ok: boolean;
    reason?: string;
    t?: number;
    bones?: Record<string, { p: [number, number, number]; q: [number, number, number, number] }>;
}

interface BoneDelta {
    name: string;
    d: number;
}

interface MotionAnalysis {
    bodyMax: number;
    bodyBone: string;
    movingBones: number;
    topBones: BoneDelta[];
    jawMaxAngle: number;
    boneCount: number;
    elapsedMs: number;
}

interface StoreCtx {
    currentAnimation: string | null;
    isPlaying: boolean;
    blendQueue: string[];
    mixerActive: string[];
}

interface MixerSummary {
    totalFrames: number;
    clipActions: { mixer: number; clip: string; duration: number | null }[];
    mixers: Record<string, any>;
}

// Analiza el movimiento del CUERPO (todos los huesos EXCEPTO boca)
function analyzeMotion(a: Sample, b: Sample): MotionAnalysis {
    const bones = Object.keys(b.bones ?? {});
    let bodyMax = 0;
    let bodyBone = '';
    let jawMaxAngle = 0;
    const deltas: BoneDelta[] = [];
    let movingBones = 0;
    for (const name of bones) {
        const pa = a.bones?.[name]?.p;
        const pb = b.bones?.[name]?.p;
        const qa = a.bones?.[name]?.q;
        const qb = b.bones?.[name]?.q;
        if (!pa || !pb) continue;
        const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
        const isJaw = /jaw|mouth|mand|tongue/i.test(name);
        if (isJaw) {
            if (qa && qb) {
                const dot = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
                const angle = 2 * Math.acos(Math.min(1, dot));
                if (angle > jawMaxAngle) jawMaxAngle = angle;
            }
            continue;
        }
        if (d > bodyMax) {
            bodyMax = d;
            bodyBone = name;
        }
        if (d > BODY_MOVING_THRESHOLD) movingBones++;
        deltas.push({ name, d });
    }
    deltas.sort((x, y) => y.d - x.d);
    const topBones = deltas.slice(0, 5);
    return { bodyMax, bodyBone, movingBones, topBones, jawMaxAngle, boneCount: bones.length, elapsedMs: 0 };
}

async function sampleBones(page: Page): Promise<Sample> {
    return page.evaluate(() => {
        // @ts-ignore
        if (!window.__bunnyProbe) return { ok: false, reason: 'no-probe' };
        // @ts-ignore
        return window.__bunnyProbe.sample();
    });
}

async function waitForProbe(page: Page, timeoutMs = 40000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const s = await sampleBones(page);
        if (s.ok && s.bones && Object.keys(s.bones).length > 10) return;
        await page.waitForTimeout(500);
    }
    throw new Error('window.__bunnyProbe no quedó listo (modelo FBX no cargó a tiempo)');
}

async function waitForReady(page: Page, names: string[], timeoutMs = 60000): Promise<{ ready: boolean; active: string[] }> {
    const start = Date.now();
    let last: { ready: boolean; active: string[] } = { ready: false, active: [] };
    while (Date.now() - start < timeoutMs) {
        last = await page.evaluate((ns) => {
            // @ts-ignore
            return window.__bunnyProbe.ready(ns);
        }, names);
        if (last.ready) return last;
        await page.waitForTimeout(400);
    }
    return last;
}

function formatTop(bones: BoneDelta[]): string {
    if (bones.length === 0) return 'ninguno';
    return bones.map((x) => `${x.name}=${x.d.toExponential(2)}`).join(', ');
}

async function getStoreCtx(page: Page): Promise<StoreCtx> {
    return page.evaluate(() => {
        // @ts-ignore
        const bs = window.__bunnyStore.getState();
        // @ts-ignore
        const probe = window.__bunnyProbe;
        let active: string[] = [];
        try {
            // @ts-ignore
            active = probe.activeActions();
        } catch (e) {}
        return {
            currentAnimation: bs.currentAnimation,
            isPlaying: bs.isPlaying,
            blendQueue: (bs.blendQueue || []).slice(),
            mixerActive: active,
        };
    });
}

async function measureWindows(page: Page, count: number, gapMs: number, label: string): Promise<MotionAnalysis[]> {
    const windows: MotionAnalysis[] = [];
    for (let i = 0; i < count; i++) {
        const a = await sampleBones(page);
        await page.waitForTimeout(gapMs);
        const b = await sampleBones(page);
        if (a.ok && b.ok) {
            const an = analyzeMotion(a, b);
            an.elapsedMs = (b.t ?? 0) - (a.t ?? 0);
            windows.push(an);
            console.log(
                `[MIXERLIVE] ${label} ventana ${i + 1}/${count}: bodyMax=${an.bodyMax.toExponential(3)} (${an.bodyBone || 'ninguno'}), ` +
                    `movingBones=${an.movingBones}, jawMax=${an.jawMaxAngle.toFixed(4)}, top=[${formatTop(an.topBones)}]`,
            );
        }
    }
    if (windows.length === 0) throw new Error(`[MIXERLIVE] No se obtuvo ninguna ventana de muestreo en ${label}`);
    return windows;
}

interface SkinSample {
    ok: boolean;
    t?: number;
    reason?: string;
    skinCount?: number;
    skins?: Record<string, any>;
}

async function sampleSkin(page: Page): Promise<SkinSample> {
    return page.evaluate(() => {
        // @ts-ignore
        if (!window.__bunnyProbe) return { ok: false, reason: 'no-probe' };
        // @ts-ignore
        return window.__bunnyProbe.skinSkeleton();
    });
}

// Mide el movimiento de los huesos del skeleton REAL de los SkinnedMesh
// (el que el render consume), NO los clones IK/FK. Decide si FASE A "se mueve"
// de verdad o era un artefacto del muestreo por nombre (sample).
async function measureSkin(page: Page, gapMs: number, label: string): Promise<void> {
    const a = await sampleSkin(page);
    await page.waitForTimeout(gapMs);
    const b = await sampleSkin(page);
    if (!a.ok || !b.ok) {
        console.log(`[MIXERLIVE] ${label} SKIN: no disponible (${a.reason || b.reason})`);
        return;
    }
    let bodyMax = 0;
    let bodyBone = '';
    const movedNames: string[] = [];
    for (const [key, sk] of Object.entries(a.skins ?? {})) {
        const bsk = (b.skins ?? {})[key];
        if (!bsk) continue;
        for (const [name, ba] of Object.entries<any>(sk.bones ?? {})) {
            const bb = (bsk.bones ?? {})[name];
            if (!bb) continue;
            if (/jaw|mouth|mand|tongue/i.test(name)) continue;
            const d = Math.hypot(bb.p[0] - ba.p[0], bb.p[1] - ba.p[1], bb.p[2] - ba.p[2]);
            if (d > bodyMax) {
                bodyMax = d;
                bodyBone = name;
            }
            if (d > BODY_MOVING_THRESHOLD) movedNames.push(name);
        }
    }
    console.log(
        `[MIXERLIVE] ${label} SKIN(skeleton real del mesh): bodyMax=${bodyMax.toExponential(3)} (${bodyBone || 'ninguno'}), ` +
            `moved=${movedNames.length}, ejemplos=[${movedNames.slice(0, 8).join(', ')}]`,
    );
}

interface BindingDiff {
    moved: number;
    total: number;
    maxAngle: number;
    sampleMoved: string[];
}

// Diferencia entre dos bindingInspect: ¿se MUEVEN los nodos a los que apuntan
// los bindings de la acción? (comparación por nodeUuid de la quaternion mundial).
function bindingDiff(bi1: any, bi2: any): BindingDiff {
    const map2 = new Map<string, [number, number, number, number]>();
    for (const act of bi2.actions || []) {
        for (const b of act.bindings || []) {
            if (b.nodeUuid && b.q) map2.set(b.nodeUuid, b.q);
        }
    }
    let moved = 0;
    let total = 0;
    let maxAngle = 0;
    const sampleMoved: string[] = [];
    for (const act of bi1.actions || []) {
        for (const b of act.bindings || []) {
            if (!b.nodeUuid || !b.q) continue;
            total++;
            const q2 = map2.get(b.nodeUuid);
            if (!q2) continue;
            const dot = Math.abs(b.q[0] * q2[0] + b.q[1] * q2[1] + b.q[2] * q2[2] + b.q[3] * q2[3]);
            const angle = 2 * Math.acos(Math.min(1, dot));
            if (angle > 0.001) {
                moved++;
                if (angle > maxAngle) maxAngle = angle;
                if (sampleMoved.length < 8) sampleMoved.push(b.nodeName);
            }
        }
    }
    return { moved, total, maxAngle, sampleMoved };
}

// Instala el monkey-patch en el AnimationMixer REAL de la app.
async function installMixerPatch(page: Page): Promise<{ ok: boolean; error?: string }> {
    return page.evaluate(async () => {
        try {
            // @ts-ignore - ruta válida en runtime; exporta el MISMO three que la app
            const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
            // @ts-ignore
            const w = window as any;
            const AM: any = THREE.AnimationMixer;
            if (AM.prototype.__mixerLivePatched) return { ok: true };

            const origUpdate = AM.prototype.update;
            const origClipAction = AM.prototype.clipAction;
            const mixIds = new WeakMap<object, number>();
            let nextId = 1;
            const getId = (m: any): number => {
                if (!mixIds.has(m)) mixIds.set(m, nextId++);
                return mixIds.get(m) as number;
            };

            w.__mixerLog = [];
            w.__mixerMax = 20000;
            w.__mixerReset = () => {
                w.__mixerLog.length = 0;
            };

            AM.prototype.clipAction = function (this: any, clip: any, ...rest: any[]) {
                const id = getId(this);
                w.__mixerLog.push({
                    kind: 'clipAction',
                    mixer: id,
                    t: performance.now(),
                    clip: clip && clip.name ? clip.name : '?',
                    duration: clip && clip.duration != null ? +clip.duration.toFixed(2) : null,
                });
                return origClipAction.call(this, clip, ...rest);
            };

            AM.prototype.update = function (this: any, delta: number) {
                const id = getId(this);
                // Las acciones ACTIVAS viven en `_actions[0.._nActiveActions)` — exactamente lo
                // que three itera en update(). `_activeActions` NO existe en esta versión (el
                // patch previo leía una propiedad inexistente → siempre [] → falso negativo).
                const nActive = this._nActiveActions || 0;
                const allActions: any[] = this._actions || [];
                const pre = allActions.slice(0, nActive).map((a) => ({ a, t: a.time }));
                const r = origUpdate.call(this, delta);
                const recActions: any[] = [];
                for (const { a, t } of pre) {
                    recActions.push({
                        clip: a.getClip && a.getClip().name ? a.getClip().name : '?',
                        paused: a.paused,
                        enabled: a.enabled,
                        running: a.isRunning ? a.isRunning() : null,
                        weight: +a.weight.toFixed(3),
                        effW: a.getEffectiveWeight ? +(a.getEffectiveWeight()).toFixed(3) : null,
                        ts: +(a.timeScale).toFixed(3),
                        effTs: a.getEffectiveTimeScale ? +(a.getEffectiveTimeScale()).toFixed(3) : null,
                        t0: +t.toFixed(4),
                        tEnd: +a.time.toFixed(4),
                        dTime: +(a.time - t).toFixed(5),
                        ci: a._cacheIndex,
                        loop: a.loop,
                        reps: a.repetitions,
                        // DISCRIMINADOR: ¿los PropertyMixer de la acción RESUELVEN a un bone real?
                        bindTotal: a._propertyBindings ? a._propertyBindings.length : 0,
                        bindResolved: a._propertyBindings
                            ? a._propertyBindings.filter((b: any) => b && b.binding && b.binding.node != null).length
                            : 0,
                    });
                }
                const rec = {
                    kind: 'update',
                    mixer: id,
                    t: performance.now(),
                    delta: +delta.toFixed(5),
                    mtime: +this.time.toFixed(4),
                    nActive: this._nActiveActions,
                    nBindings: this._nActiveBindings,
                    nBindingsTotal: this._bindings ? this._bindings.length : 0,
                    actions: recActions,
                };
                if (w.__mixerLog.length < w.__mixerMax) w.__mixerLog.push(rec);
                return r;
            };

            // ===== SONDEO DEL CAMINO DE ESCRITURA (PropertyMixer.apply / setValue) =====
            // Punto de observación: setValue es propiedad de INSTANCIA (constructor de
            // PropertyBinding), NO método de prototipo → no se puede envolver
            // `prototype.setValue`. El punto correcto es envolver `prototype.bind`, que
            // re-asigna this.setValue con el setter concreto; ahí instalamos un contador
            // por instancia alrededor del setter ya resuelto.
            const origPMApply = THREE.PropertyMixer.prototype.apply;
            const origPBBind = THREE.PropertyBinding.prototype.bind;
            w.__applyLog = [];
            w.__writeStats = { totalApply: 0, totalSetValue: 0, tracks: {} };
            w.__writeReset = () => {
                w.__applyLog.length = 0;
                w.__writeStats = { totalApply: 0, totalSetValue: 0, tracks: {} };
            };
            THREE.PropertyMixer.prototype.apply = function (this: any, accuIndex: number) {
                const pb: any = this;
                const b = pb.binding;
                const track = b ? b.path : '?';
                const node = b && b.node ? b.node.name : null;
                const vs = pb.valueSize || 0;
                const buf = pb.buffer;
                // Compuerta de escritura (PropertyMixer.js 231-242): setValue se omite si
                // accu0 === accu1. Con weight=1 y sin additive, apply NO toca accu0/accu1,
                // así que el gate pre-computado es EXACTAMENTE la decisión de three.
                let gateTrue = false;
                if (buf && vs > 0 && buf.length >= vs * 3) {
                    for (let k = vs; k < vs * 2; k++) {
                        if (buf[k] !== buf[k + vs]) {
                            gateTrue = true;
                            break;
                        }
                    }
                }
                const st = w.__writeStats;
                st.totalApply++;
                st.tracks[track] = st.tracks[track] || { apply: 0, setValue: 0, gateTrue: 0, gateFalse: 0, node };
                const tr = st.tracks[track];
                tr.apply++;
                if (gateTrue) tr.gateTrue++;
                else tr.gateFalse++;
                if (w.__applyLog.length < w.__mixerMax) {
                    w.__applyLog.push({ kind: 'apply', t: performance.now(), track, node, gateTrue, vs });
                }
                return origPMApply.call(this, accuIndex);
            };
            THREE.PropertyBinding.prototype.bind = function (this: any) {
                const ret = origPBBind.call(this);
                const self: any = this;
                if (self && typeof self.setValue === 'function' && !self.__wrappedSetValue) {
                    self.__wrappedSetValue = true;
                    const origSet = self.setValue;
                    self.setValue = function (array: any, offset: number) {
                        const st2 = w.__writeStats;
                        st2.totalSetValue++;
                        const track2 = self.path || '?';
                        st2.tracks[track2] =
                            st2.tracks[track2] || {
                                apply: 0,
                                setValue: 0,
                                gateTrue: 0,
                                gateFalse: 0,
                                node: self.node ? self.node.name : null,
                            };
                        st2.tracks[track2].setValue++;
                        return origSet.call(self, array, offset);
                    };
                }
                return ret;
            };
            w.__writeSummary = (): any => {
                const st = w.__writeStats;
                const tracks = Object.entries(st.tracks).map(([track, v]: any) => ({
                    track,
                    node: v.node,
                    apply: v.apply,
                    setValue: v.setValue,
                    gateTrue: v.gateTrue,
                    gateFalse: v.gateFalse,
                }));
                const totalApply = st.totalApply;
                const totalSetValue = st.totalSetValue;
                const writeRatio = totalApply > 0 ? +((totalSetValue / totalApply) * 100).toFixed(2) : 0;
                return { totalApply, totalSetValue, writeRatio, tracks };
            };

            AM.prototype.__mixerLivePatched = true;

            w.__mixerSummary = (from: number | null): any => {
                const arr = w.__mixerLog;
                const slice = from == null ? arr : arr.slice(from);
                const updates = slice.filter((r: any) => r.kind === 'update');
                const clipActions = slice
                    .filter((r: any) => r.kind === 'clipAction')
                    .map((r: any) => ({ mixer: r.mixer, clip: r.clip, duration: r.duration }));
                const byMixer: Record<number, any[]> = {};
                for (const u of updates) (byMixer[u.mixer] = byMixer[u.mixer] || []).push(u);
                const mixers: Record<string, any> = {};
                for (const [m, frames] of Object.entries(byMixer)) {
                    const dts = frames.map((f: any) => f.delta);
                    const withActions = frames.filter((f: any) => f.actions.length > 0);
                    const clips: Record<string, any> = {};
                    let orphan = 0;
                    let pausedAny = false;
                    let runningAny = false;
                    let enabledAny = false;
                    for (const f of frames) {
                        for (const a of f.actions) {
                            const key = a.clip;
                            clips[key] =
                                clips[key] || {
                                    frames: 0,
                                    totalDt: 0,
                                    maxDt: 0,
                                    orphan: 0,
                                    paused: 0,
                                    running: 0,
                                    enabled: 0,
                                    maxCi: -1,
                                    bindTotal: 0,
                                    bindResolved: 0,
                                    minEffW: Infinity,
                                    minEffTs: Infinity,
                                };
                            const c = clips[key];
                            c.frames++;
                            c.totalDt += Math.abs(a.dTime);
                            c.maxDt = Math.max(c.maxDt, Math.abs(a.dTime));
                            c.maxCi = Math.max(c.maxCi, a.ci);
                            if (a.ci >= f.nActive) {
                                c.orphan++;
                                orphan++;
                            }
                            if (a.paused) {
                                c.paused++;
                                pausedAny = true;
                            }
                            if (a.running) {
                                c.running++;
                                runningAny = true;
                            }
                            if (a.enabled) {
                                c.enabled++;
                                enabledAny = true;
                            }
                            c.bindTotal += a.bindTotal;
                            c.bindResolved += a.bindResolved;
                            c.minEffW = Math.min(c.minEffW, a.effW);
                            c.minEffTs = Math.min(c.minEffTs, a.effTs);
                        }
                    }
                    mixers['mixer' + m] = {
                        frames: frames.length,
                        deltaMean: +(dts.reduce((x: number, y: number) => x + y, 0) / Math.max(1, dts.length)).toFixed(5),
                        deltaZero: dts.filter((d: number) => Math.abs(d) <= 0.000001).length,
                        withActions: withActions.length,
                        orphan,
                        pausedAny,
                        runningAny,
                        enabledAny,
                        nBindings: frames.length ? frames[frames.length - 1].nBindings : 0,
                        nBindingsTotal: frames.length ? frames[frames.length - 1].nBindingsTotal : 0,
                        clips: Object.fromEntries(
                            Object.entries(clips).map(([k, v]) => [
                                k,
                                { ...(v as any), meanDt: +((v as any).totalDt / Math.max(1, (v as any).frames)).toFixed(5) },
                            ]),
                        ),
                        sample: withActions.length
                            ? withActions[Math.floor(withActions.length / 2)]
                            : frames[Math.floor(frames.length / 2)] || null,
                    };
                }
                return { totalFrames: updates.length, clipActions, mixers };
            };

            return { ok: true };
        } catch (e: any) {
            return { ok: false, error: e && e.message ? e.message : String(e) };
        }
    });
}

async function markMixer(page: Page): Promise<number> {
    return page.evaluate(() => {
        // @ts-ignore
        const w = window as any;
        return (w.__mixerLog || []).length;
    });
}

async function summarize(page: Page, from: number): Promise<MixerSummary> {
    return page.evaluate((f) => {
        // @ts-ignore
        const w = window as any;
        return w.__mixerSummary(f);
    }, from);
}

function printSummary(label: string, s: MixerSummary) {
    console.log(`[MIXERLIVE] ${label}: ${s.totalFrames} frames de update registrados`);
    if (s.clipActions.length) {
        console.log(
            `[MIXERLIVE] ${label} clipAction: ${s.clipActions
                .map((c) => `${c.clip}(dur=${c.duration})@mixer${c.mixer}`)
                .join(' , ')}`,
        );
    }
    for (const [mk, mv] of Object.entries(s.mixers)) {
        const m = mv as any;
        const clipLines = Object.entries(m.clips || {})
            .map(([k, v]) => {
                const c = v as any;
                return `${k}: f=${c.frames} meanDt=${c.meanDt} maxDt=${c.maxDt} orphan=${c.orphan} paused=${c.paused} running=${c.running} maxCi=${c.maxCi} bind=${c.bindResolved}/${c.bindTotal} minEffW=${c.minEffW} minEffTs=${c.minEffTs}`;
            })
            .join(' | ');
        console.log(
            `[MIXERLIVE] ${label} ${mk}: frames=${m.frames} deltaMean=${m.deltaMean} deltaZero=${m.deltaZero} ` +
                `withActions=${m.withActions} orphan=${m.orphan} pausedAny=${m.pausedAny} runningAny=${m.runningAny} enabledAny=${m.enabledAny} ` +
                `bindings=${m.nBindings}/${m.nBindingsTotal}` +
                (clipLines ? ` clips=[${clipLines}]` : ''),
        );
        if (m.sample && m.sample.actions && m.sample.actions.length) {
            const s0 = m.sample.actions[0];
            console.log(
                `[MIXERLIVE] ${label} ${mk} sample: ${s0.clip} weight=${s0.weight} effW=${s0.effW} effTs=${s0.effTs} ` +
                    `t0=${s0.t0}->tEnd=${s0.tEnd} dTime=${s0.dTime} ci=${s0.ci} bind=${s0.bindResolved}/${s0.bindTotal}`,
            );
        }
    }
}

// Interpreta la evidencia del mixer para una acción congelada.
function analyzeC(logLabel: string, phase: MixerSummary, actionName: string) {
    const ca = phase.clipActions.filter((c) => c.clip === actionName);
    const actionMixerIds = [...new Set(ca.map((c) => c.mixer))];
    for (const mid of actionMixerIds) {
        const m = phase.mixers['mixer' + mid];
        if (!m) {
            console.log(
                `[MIXERLIVE] ${logLabel}: ¡MECANISMO (a) PROBADO! clipAction(${actionName}) se creó en mixer#${mid}, ` +
                    `pero ese mixer NO aparece en el frame-log (nunca se tickea con update) → mixer obsoleto/partido: ` +
                    `la acción vive en un mixer que useFrame NO tickea.`,
            );
            continue;
        }
        const c = m.clips[actionName];
        if (!c) {
            console.log(
                `[MIXERLIVE] ${logLabel}: mixer#${mid} SÍ se tickea (${m.frames} frames) pero ${actionName} NO está en ` +
                    `las acciones activas (_actions[0..nActive)) de las muestras → la acción no se actualiza pese a existir el mixer (¿stop/fade la sacó?).`,
            );
            continue;
        }
        if (c.orphan > 0) {
            console.log(
                `[MIXERLIVE] ${logLabel}: ¡MECANISMO (b) PROBADO! ${actionName} en _activeActions pero con _cacheIndex ` +
                    `>= nActive en ${c.orphan} muestras → three NO la actualiza aunque el mixer corra (estado interno inconsistente).`,
            );
        }
        if (c.meanDt <= 0.0001) {
            console.log(
                `[MIXERLIVE] ${logLabel}: ¡MECANISMO (c) PROBADO! ${actionName} activa en el mixer tickeado pero ` +
                    `action.time NO avanza (meanDt=${c.meanDt}) → paused/timeScale=0 (pausedAny=${m.pausedAny}).`,
            );
        } else {
            console.log(
                `[MIXERLIVE] ${logLabel}: ${actionName} está en el mixer tickeado y su tiempo AVANZA (meanDt=${c.meanDt}, ` +
                    `frames=${c.frames}) → mixer+acción SANOS; el congelamiento está FUERA del mixer (escena/skeleton/binding).`,
            );
        }
        const bindInfo =
            c.bindTotal > 0
                ? `bindings=${c.bindResolved}/${c.bindTotal} resueltas, minEffW=${c.minEffW}, minEffTs=${c.minEffTs}`
                : 'bindings=0/0';
        if (c.bindTotal === 0) {
            console.log(
                `[MIXERLIVE] ${logLabel}: ${actionName} ${bindInfo} → la acción NUNCA se bindeó (nunca pasó por ` +
                    `_activateAction/_bindAction) → three no tiene PropertyMixer que aplicar (variante de MECANISMO (A)).`,
            );
        } else if (c.bindResolved < c.bindTotal * 0.5) {
            console.log(
                `[MIXERLIVE] ${logLabel}: ¡MECANISMO (A) PROBADO! ${actionName} ${bindInfo} → la mayoría de tracks NO ` +
                    `resuelven a un bone real (PropertyBinding.node==null) → three anima en vacío y el cuerpo queda en la pose de bind.`,
            );
        } else if (c.minEffW <= 0.001) {
            console.log(
                `[MIXERLIVE] ${logLabel}: ¡MECANISMO (B) PROBADO! ${actionName} ${bindInfo} → los bindings resuelven pero ` +
                    `el peso efectivo es 0 → la pose se acumula a escala 0 (no mueve el cuerpo).`,
            );
        } else {
            console.log(
                `[MIXERLIVE] ${logLabel}: ${actionName} ${bindInfo} → bindings RESUELVEN y peso>0, pero el cuerpo NO se mueve → ` +
                    `MECANISMO (C): la pose se aplica a OTRO skeleton/objeto distinto del muestreado (master vs clon/unify) o ` +
                    `el render no consume el modelo que el mixer anima.`,
            );
        }
    }
    if (actionMixerIds.length === 0) {
        console.log(
            `[MIXERLIVE] ${logLabel}: NO hay registro clipAction(${actionName}) → la acción ni siquiera se creó vía ` +
                `clipAction en esta fase (¿el efecto no corrió / estado del store no disparó creación?).`,
        );
    }
}

// Análisis rico de bindingInspect: agrega inSkinByName, nodePath y muestras de tracks.
// Clave para comparar Idle_2 (mueve) vs Dance/Idle_3 (congelado):
//  - inSkin:      el nodo RESUELTO es un hueso del skeleton del SkinnedMesh.
//  - inSkinByName: existe un hueso skin con ESE nombre (aunque el nodo resuelto sea otro → duplicado).
//  - nodePath:    cadena de ancestros → revela si el nodo resuelto está en un árbol duplicado.
function printBindingAnalysis(label: string, bi: any): void {
    console.log(
        `[MIXERLIVE] ${label}: nActive=${bi.nActive}, actionClips=[${bi.actionClips.join(', ')}], ` +
            `actionsByClipKeys=[${bi.actionsByClipKeys.join(', ')}]`,
    );
    for (const act of bi.actions || []) {
        const bindings: any[] = act.bindings || [];
        const inSkin = bindings.filter((b: any) => b.inSkin).length;
        const inMaster = bindings.filter((b: any) => b.inMaster).length;
        const inDesc = bindings.filter((b: any) => b.inModelDesc).length;
        const inSkinByName = bindings.filter((b: any) => b.inSkinByName).length;
        const rootMaster = bindings.filter((b: any) => b.rootNodeIsMasterBone).length;
        const sampleInSkin = bindings.filter((b: any) => b.inSkin && b.nodeName).slice(0, 8);
        const sampleNotInSkin = bindings.filter((b: any) => !b.inSkin && b.nodeName).slice(0, 8);
        // PRUEBA DECISIVA: ¿re-resolver con el rootNode parcheado daría un hueso skin?
        const freshSkin = bindings.filter((b: any) => b.freshIsSkin && b.freshNodeName).length;
        const freshMatches = bindings.filter((b: any) => b.freshMatchesNode === true).length;
        const rootHasSk = bindings.filter((b: any) => b.rootNodeHasSkeleton).length;
        console.log(
            `[MIXERLIVE] ${label} action ${act.clip}: uuid=${act.clipUuid} bindTotal=${act.bindTotal} ` +
                `node→inSkin=${inSkin} inMaster=${inMaster} inModelDesc=${inDesc} inSkinByName=${inSkinByName} ` +
                `rootNodeIsMasterBone=${rootMaster} rootNodeHasSkeleton=${rootHasSk} ` +
                `FRESH→inSkin=${freshSkin} freshMatchesNode=${freshMatches} weight=${act.weight} time=${act.time}`,
        );
        console.log(
            `[MIXERLIVE] ${label}  inSkin=true ejemplos: ${sampleInSkin
                .map((b: any) => `${b.nodeName}(${b.rootNode})`)
                .join(', ')}`,
        );
        console.log(
            `[MIXERLIVE] ${label}  inSkin=false ejemplos: ${sampleNotInSkin
                .map((b: any) => `${b.nodeName}(root=${b.rootNode},isBone=${b.isBone},nodePath=${b.nodePath || '-'})`)
                .join(', ')}`,
        );
        for (const b of bindings.slice(0, 12)) {
            console.log(
                `[MIXERLIVE] ${label}  path="${b.path || b.track || '?'}" node="${b.nodeName}" ` +
                    `inSkin=${b.inSkin} inSkinByName=${b.inSkinByName} inMaster=${b.inMaster} isBone=${b.isBone} ` +
                    `nodePath="${b.nodePath || ''}" fresh="${b.freshNodeName || '-'}" ` +
                    `freshInSkin=${b.freshIsSkin} freshMatches=${b.freshMatchesNode}`,
            );
        }
    }
}

function printWritePath(label: string, wp: any, ws: any): void {
    console.log(
        `[MIXERLIVE] ${label} writePath: nActive=${wp && wp.nActive} nActiveBindings=${wp && wp.nActiveBindings} ` +
            `nBindingsTotal=${wp && wp.nBindingsTotal} writeStats: apply=${ws && ws.totalApply} ` +
            `setValue=${ws && ws.totalSetValue} writeRatio=${ws ? ws.writeRatio : '-'}%`,
    );
    for (const tr of (ws && ws.tracks) || []) {
        if (tr.apply > 0 || tr.setValue > 0 || tr.gateTrue > 0 || tr.gateFalse > 0) {
            console.log(
                `[MIXERLIVE] ${label}  track "${tr.track}" node=${tr.node} apply=${tr.apply} setValue=${tr.setValue} ` +
                    `gateTrue=${tr.gateTrue} gateFalse=${tr.gateFalse}`,
            );
        }
    }
    for (const act of (wp && wp.actions) || []) {
        console.log(
            `[MIXERLIVE] ${label}  action ${act.clip}: time=${act.time} weight=${act.weight} paused=${act.paused} ` +
                `enabled=${act.enabled} nBindings=${act.nBindings}`,
        );
        for (const d of act.detail || []) {
            const c = d.clip || {};
            console.log(
                `[MIXERLIVE] ${label}    [${d.i}] "${d.track}" node=${d.node} vs=${d.vs} sameBuffer=${d.sameBuffer} ` +
                    `inPool=${d.inPool} pos=${d.inActivePos} cumW=${d.cumW} use=${d.useCount} ref=${d.refCount} ci=${d.ci} ` +
                    `gate(accu0ne1)=${d.accu0ne1} incomingNe0=${d.incomingNe0} ` +
                    `clip(times=${c.times} vs=${c.valueSize} spread=${c.spread} [${c.valMin},${c.valMax}])`,
            );
        }
    }
}

test('MIXER LIVE: ¿qué mixer tickea useFrame y qué mixer recibe Idle_3/Dance durante el congelamiento?', async ({ page }) => {
    test.setTimeout(300000);

    page.on('console', (msg) => {
        const text = msg.text();
        if (
            text.includes('[MIXERLIVE') ||
            text.includes('[DIAG') ||
            text.includes('Cache SET') ||
            text.includes('Cache MISS') ||
            text.includes('Cache HIT')
        ) {
            console.log(`[BROWSER] ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        console.log(`[PAGEERROR] ${err.message}`);
    });

    // ========================================
    // Cargar app + esperar modelo 3D listo
    // ========================================
    await page.goto('/');
    await page.waitForSelector('.flu-bridge-container canvas', { timeout: 40000 });
    console.log('[MIXERLIVE] Canvas 3D visible — esperando carga del modelo FBX...');
    await waitForProbe(page);
    console.log('[MIXERLIVE] Modelo 3D cargado');

    // ========================================
    // Inyectar stores reales
    // ========================================
    const storeSetup = await page.evaluate(async () => {
        try {
            // @ts-ignore - ruta válida en runtime
            const bunnyModule = await import('/src/avatar/store/bunnyStore.ts');
            // @ts-ignore
            const intModule = await import('/src/store/integrationStore.ts');
            // @ts-ignore
            window.__bunnyStore = bunnyModule.useBunnyStore;
            // @ts-ignore
            window.__intStore = intModule.useIntegrationStore;
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
    if (!storeSetup.success) throw new Error(`No se pudieron inyectar stores: ${JSON.stringify(storeSetup)}`);
    console.log('[MIXERLIVE] Stores inyectados');

    // ========================================
    // Instalar monkey-patch del mixer ANTES de las fases
    // ========================================
    const inst = await installMixerPatch(page);
    if (!inst.ok) throw new Error(`No se pudo instalar el patch del mixer: ${inst.error}`);
    console.log('[MIXERLIVE] Monkey-patch AnimationMixer instalado (three real de la app)');

    // ========================================
    // Fase 0: IDLE asentado (referencia del cuerpo parado)
    // ========================================
    console.log('[MIXERLIVE] Fase IDLE asentado...');
    await page.evaluate(async () => {
        // @ts-ignore
        const intStore = window.__intStore;
        intStore.getState().setConversationState('IDLE');
        intStore.getState().setFluSpeaking(false);
        await new Promise((r) => setTimeout(r, 2500));
    });

    // ========================================
    // FASE A: línea base — la PRIMERA acción nativa (Idle_2) se mueve
    // ========================================
    const markA = await markMixer(page);
    console.log('[MIXERLIVE] ===== FASE A: línea base Idle_2 (nativo) =====');
    const idleA = await measureWindows(page, 3, 700, 'A');
    await measureSkin(page, 700, 'A');
    const idleBest = idleA.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), idleA[0]);
    console.log(
        `[MIXERLIVE] FASE A: bodyMax=${idleBest.bodyMax.toExponential(3)} (${idleBest.bodyBone || 'ninguno'}), ` +
            `movingBones(max)=${Math.max(...idleA.map((w) => w.movingBones))}`,
    );
    const sumA = await summarize(page, markA);
    printSummary('FASE A', sumA);
    let ctx = await getStoreCtx(page);
    console.log(
        `[MIXERLIVE] FASE A ctx: currentAnimation=${ctx.currentAnimation}, isPlaying=${ctx.isPlaying}, mixerActive=[${ctx.mixerActive.join(', ')}]`,
    );

    // ========================================
    // FASE B: stopAnimation() → cuerpo en reposo
    // ========================================
    const markB = await markMixer(page);
    console.log('[MIXERLIVE] ===== FASE B: stopAnimation() → reposo =====');
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().stopAnimation();
        await new Promise((r) => setTimeout(r, 600));
    });
    const restW = await measureWindows(page, 1, 500, 'B');
    const restBest = restW[0];
    console.log(`[MIXERLIVE] FASE B: bodyMax=${restBest.bodyMax.toExponential(3)}, movingBones=${restBest.movingBones} — esperado ≈0`);
    const sumB = await summarize(page, markB);
    printSummary('FASE B', sumB);

    // ========================================
    // FASE C: playAnimation('Idle_3') FRESCO sin transición (DISCRIMINADOR)
    // ========================================
    const markC = await markMixer(page);
    console.log('[MIXERLIVE] ===== FASE C: playAnimation("Idle_3") fresco, SIN transición =====');
    await page.evaluate(() => {
        // @ts-ignore
        window.__bunnyStore.getState().playAnimation('Idle_3' as any);
    });
    const readyC = await waitForReady(page, ['Idle_3'], 60000);
    console.log(`[MIXERLIVE] FASE C ready: ${readyC.ready} — activas=[${readyC.active.join(', ')}]`);
    await page.waitForTimeout(600);
    const idleC = await measureWindows(page, 4, 700, 'C');
    await measureSkin(page, 700, 'C');
    const bestC = idleC.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), idleC[0]);
    const maxMovingC = Math.max(...idleC.map((w) => w.movingBones));
    console.log(
        `[MIXERLIVE] FASE C: bodyMax=${bestC.bodyMax.toExponential(3)} (${bestC.bodyBone || 'ninguno'}), movingBones(max)=${maxMovingC}, ` +
            `serie=[${idleC.map((w) => w.bodyMax.toExponential(2)).join(', ')}]`,
    );
    const sumC = await summarize(page, markC);
    printSummary('FASE C', sumC);
    analyzeC('FASE C', sumC, 'Idle_3');
    ctx = await getStoreCtx(page);
    console.log(
        `[MIXERLIVE] FASE C ctx: currentAnimation=${ctx.currentAnimation}, isPlaying=${ctx.isPlaying}, mixerActive=[${ctx.mixerActive.join(', ')}]`,
    );

    // ========================================
    // FASE D: desde Idle_3 ACTIVO → blendAnimation(['Dance']) (EL CAMINO REAL)
    // ========================================
    const markD = await markMixer(page);
    console.log('[MIXERLIVE] ===== FASE D: blendAnimation(["Dance"]) desde Idle_3 (transición real) =====');
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().blendAnimation(['Dance'] as any);
        await new Promise((r) => setTimeout(r, 800));
    });
    const readyD = await waitForReady(page, ['Dance'], 60000);
    console.log(`[MIXERLIVE] FASE D ready: ${readyD.ready} — activas=[${readyD.active.join(', ')}]`);
    await page.waitForTimeout(600);
    const danceW = await measureWindows(page, 8, 700, 'D');
    await measureSkin(page, 700, 'D');
    const bestD = danceW.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), danceW[0]);
    const maxMovingD = Math.max(...danceW.map((w) => w.movingBones));
    console.log(
        `[MIXERLIVE] FASE D: bodyMax=${bestD.bodyMax.toExponential(3)} (${bestD.bodyBone || 'ninguno'}), movingBones(max)=${maxMovingD}, ` +
            `serie=[${danceW.map((w) => w.bodyMax.toExponential(2)).join(', ')}]`,
    );
    const sumD = await summarize(page, markD);
    printSummary('FASE D', sumD);
    analyzeC('FASE D', sumD, 'Dance');
    ctx = await getStoreCtx(page);
    console.log(
        `[MIXERLIVE] FASE D ctx: currentAnimation=${ctx.currentAnimation}, isPlaying=${ctx.isPlaying}, blendQueue=[${ctx.blendQueue.join(', ')}], ` +
            `mixerActive=[${ctx.mixerActive.join(', ')}]`,
    );

    // ========================================
    // FASE E: inspección de bindings + origen del clip (Cache HIT vs MISS)
    // ========================================

    // E1: ¿a qué nodos apuntan los bindings de la acción Dance congelada, y se mueven?
    console.log('[MIXERLIVE] ===== FASE E1: bindingInspect(Dance) sobre el estado congelado =====');
    const bi1 = await page.evaluate(() => {
        // @ts-ignore
        return window.__bunnyProbe.bindingInspect('Dance');
    });
    await page.waitForTimeout(500);
    const bi2 = await page.evaluate(() => {
        // @ts-ignore
        return window.__bunnyProbe.bindingInspect('Dance');
    });
    printBindingAnalysis('E1', bi1);
    const bd = bindingDiff(bi1, bi2);
    console.log(
        `[MIXERLIVE] E1 binding DIFF (500ms): moved=${bd.moved}/${bd.total} maxAngle=${bd.maxAngle.toFixed(4)} ` +
            `ejemplos=[${bd.sampleMoved.join(', ')}]`,
    );
    // E1-WRITE: sonda del camino de escritura mientras Dance está congelado
    await page.evaluate(async () => {
        // @ts-ignore
        const w = window as any;
        if (w.__writeReset) w.__writeReset();
    });
    await page.waitForTimeout(500);
    const wpE1 = await page.evaluate(() => {
        // @ts-ignore
        return (window as any).__bunnyProbe.writePathProbe('Dance');
    });
    const wsE1 = await page.evaluate(() => {
        // @ts-ignore
        const w = window as any;
        return w.__writeSummary ? w.__writeSummary() : null;
    });
    printWritePath('E1-Dance', wpE1, wsE1);
    await measureSkin(page, 600, 'E1');

    // E2: replay Idle_2 vía Cache HIT — ¿también se congela (origen del clip)?
    const markE2 = await markMixer(page);
    console.log('[MIXERLIVE] ===== FASE E2: replay Idle_2 vía Cache HIT (origen cacheado) =====');
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().stopAnimation();
        await new Promise((r) => setTimeout(r, 500));
        // @ts-ignore
        window.__bunnyStore.getState().playAnimation('Idle_2' as any);
    });
    const readyE2 = await waitForReady(page, ['Idle_2'], 60000);
    console.log(`[MIXERLIVE] FASE E2 ready: ${readyE2.ready} — activas=[${readyE2.active.join(', ')}]`);
    await page.waitForTimeout(600);
    const idleE2 = await measureWindows(page, 4, 700, 'E2');
    const bestE2 = idleE2.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), idleE2[0]);
    console.log(
        `[MIXERLIVE] FASE E2 (Cache HIT Idle_2): bodyMax=${bestE2.bodyMax.toExponential(3)} (${bestE2.bodyBone || 'ninguno'}), ` +
            `serie=[${idleE2.map((w) => w.bodyMax.toExponential(2)).join(', ')}]`,
    );
    await measureSkin(page, 700, 'E2');
    const sumE2 = await summarize(page, markE2);
    printSummary('FASE E2', sumE2);
    analyzeC('FASE E2', sumE2, 'Idle_2');

    // E3: fuerza Cache MISS en Dance → recarga FBX fresco → ¿se mueve?
    const markE3 = await markMixer(page);
    console.log('[MIXERLIVE] ===== FASE E3: forceCacheMiss(Dance) + playAnimation(Dance) fresco =====');
    const fcm = await page.evaluate(() => {
        // @ts-ignore
        return window.__bunnyProbe.forceCacheMiss('Dance');
    });
    console.log(`[MIXERLIVE] FASE E3 forceCacheMiss: hadClip=${fcm.hadClip} hadBones=${fcm.hadBones}`);
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().stopAnimation();
        await new Promise((r) => setTimeout(r, 500));
        // @ts-ignore
        window.__bunnyStore.getState().playAnimation('Dance' as any);
    });
    const readyE3 = await waitForReady(page, ['Dance'], 60000);
    console.log(`[MIXERLIVE] FASE E3 ready: ${readyE3.ready} — activas=[${readyE3.active.join(', ')}]`);
    await page.waitForTimeout(600);
    const danceE3 = await measureWindows(page, 6, 700, 'E3');
    const bestE3 = danceE3.reduce((p, c) => (c.bodyMax > p.bodyMax ? c : p), danceE3[0]);
    console.log(
        `[MIXERLIVE] FASE E3 (Cache MISS Dance fresco): bodyMax=${bestE3.bodyMax.toExponential(3)} (${bestE3.bodyBone || 'ninguno'}), ` +
            `serie=[${danceE3.map((w) => w.bodyMax.toExponential(2)).join(', ')}]`,
    );
    await measureSkin(page, 700, 'E3');
    const sumE3 = await summarize(page, markE3);
    printSummary('FASE E3', sumE3);
    analyzeC('FASE E3', sumE3, 'Dance');

    // E4: bindingInspect de Idle_2 (control que SÍ se mueve) para comparación directa.
    // Clave: si Idle_2 compartiera trackNames con Dance, sus bindings serían LOS MISMOS
    // objetos resueltos; si Idle_2 muestra inSkin>0, sus tracks NO se comparten con Dance
    // y resuelven a huesos skin reales → discrimina "bindings a nodo equivocado" vs "contenido del clip".
    console.log('[MIXERLIVE] ===== FASE E4: bindingInspect(Idle_2) control que SÍ se mueve =====');
    await page.evaluate(async () => {
        // @ts-ignore
        window.__bunnyStore.getState().stopAnimation();
        await new Promise((r) => setTimeout(r, 500));
        // @ts-ignore
        window.__bunnyStore.getState().playAnimation('Idle_2' as any);
    });
    const readyE4 = await waitForReady(page, ['Idle_2'], 60000);
    console.log(`[MIXERLIVE] FASE E4 ready: ${readyE4.ready} — activas=[${readyE4.active.join(', ')}]`);
    await page.waitForTimeout(600);
    const biE4 = await page.evaluate(() => {
        // @ts-ignore
        return window.__bunnyProbe.bindingInspect('Idle_2');
    });
    printBindingAnalysis('E4', biE4);
    // E4-WRITE: sonda del camino de escritura del control que SÍ se mueve
    await page.evaluate(async () => {
        // @ts-ignore
        const w = window as any;
        if (w.__writeReset) w.__writeReset();
    });
    await page.waitForTimeout(500);
    const wpE4 = await page.evaluate(() => {
        // @ts-ignore
        return (window as any).__bunnyProbe.writePathProbe('Idle_2');
    });
    const wsE4 = await page.evaluate(() => {
        // @ts-ignore
        const w = window as any;
        return w.__writeSummary ? w.__writeSummary() : null;
    });
    printWritePath('E4-Idle_2', wpE4, wsE4);
    await measureSkin(page, 700, 'E4');

    const cacheHitMoving = bestE2.bodyMax > BODY_MAX_REAL;
    const missMoving = bestE3.bodyMax > BODY_MAX_REAL;
    console.log(
        `[MIXERLIVE] VEREDICTO origen-clip: Cache HIT Idle_2 bodyMax=${bestE2.bodyMax.toExponential(3)} ` +
            `(¿se mueve? ${cacheHitMoving}) | Cache MISS Dance fresco bodyMax=${bestE3.bodyMax.toExponential(3)} ` +
            `(¿se mueve? ${missMoving})`,
    );

    console.log('[MIXERLIVE] ==================== FIN ====================');
});
