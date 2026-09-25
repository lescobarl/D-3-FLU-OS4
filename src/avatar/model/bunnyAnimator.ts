// ============================================================
// bunnyAnimator — Precarga y reproducción de animaciones
// ============================================================
// Carga todos los FBX de animación en segundo plano después de
// que el modelo está listo. Almacena los AnimationClip en un Map
// para que play() solo ejecute mixer.clipAction().play()
// sin resolver assets en ese momento.
//
// CRÍTICO: Los IK/FK bones (root, ik_foot_*, ik_hand_*, hat, etc.)
// se extraen y cachean DURANTE preloadAll(), no en play().
// Esto elimina la latencia de ~100-500ms al hacer clic.
//
// FIX: Los FBX exportados desde Blender/Maya pueden tener keyframes
// empezando en ~16-18s en lugar de 0s. shiftClipToZero() desplaza
// todos los tiempos al origen para eliminar el gap inicial.
//
// SYNTHETIC ANIMATIONS: 'MouthMove' no tiene archivo FBX. Se genera
// proceduralmente como un AnimationClip sintético con keyframes de
// jaw_01.quaternion interpolando entre Idle_2 (boca cerrada) y
// Emo_blink (boca abierta). Se reproduce a través del mixer como
// cualquier otra animación, permitiendo combinarlo en blends.
//
// CARGA VÍA WORKER: Todos los FBX (modelo y animaciones) se cargan
// con loadFbx() desde fbxWorkerClient, que descarga + parsea en un
// Web Worker (única ruta de carga) y reconstruye el grupo en el
// hilo principal con ObjectLoader. fbx.animations[0] sobrevive el
// round-trip JSON (Object3D.toJSON serializa .animations).
// ============================================================

import * as THREE from 'three';
import { loadFbx } from '../workers/fbxWorkerClient';
import type { BunnyAnimation } from '../types/bunny';

// ============================================================
// Mapa de rutas de animación (solo animaciones con FBX)
// ============================================================

const ANIMATION_PATHS: Record<string, string> = {
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

// ============================================================
// shiftClipToZero — Desplaza todos los keyframes al origen
// ============================================================
// Los FBX exportados pueden tener keyframes que empiezan en
// ~16-18s (dependiendo de dónde estuviera el playhead en el
// software de modelado). Esto causa un delay de ~15s al
// reproducir porque el mixer debe avanzar por el timeline vacío.
//
// Esta función encuentra el tiempo mínimo entre TODAS las tracks
// y lo resta, desplazando la animación completa a t=0.
// ============================================================

function shiftClipToZero(clip: THREE.AnimationClip): void {
    let minTime = Infinity;

    for (const track of clip.tracks) {
        const times = track.times;
        if (times.length > 0) {
            const trackMin = times[0];
            if (trackMin < minTime) {
                minTime = trackMin;
            }
        }
    }

    if (!isFinite(minTime) || minTime <= 0) {
        return;
    }

    for (const track of clip.tracks) {
        const times = track.times;
        for (let i = 0; i < times.length; i++) {
            times[i] -= minTime;
        }
    }

    clip.duration -= minTime;

}

// ============================================================
// MouthPose — Quaternion de jaw_01 para un estado de boca
// ============================================================

interface MouthPose {
    jawQuat: THREE.Quaternion;
}

// ============================================================
// ArmPose — Quaternions de los huesos del brazo derecho
// ============================================================

interface ArmPose {
    clavicle_r: THREE.Quaternion;
    upperarm_r: THREE.Quaternion;
    lowerarm_r: THREE.Quaternion;
    hand_r: THREE.Quaternion;
}

// ============================================================
// BunnyAnimator
// ============================================================

export class BunnyAnimator {
    private mixer: THREE.AnimationMixer;
    /** Clips cargados desde FBX (excluye sintéticas) */
    private clips: Map<string, THREE.AnimationClip> = new Map();
    private currentAction: THREE.AnimationAction | null = null;
    /** Additional actions for blended playback (N animaciones simultáneas) */
    private blendActions: THREE.AnimationAction[] = [];
    private animBones: THREE.Bone[] = [];
    /** IK/FK bones extraídos durante preloadAll(), reutilizados en play() */
    private cachedAnimBones: THREE.Bone[] | null = null;
    private model: THREE.Object3D;
    private onLog: (msg: string) => void;

    /** Mouth pose for "closed" (from Idle_2) */
    private mouthClosedPose: MouthPose | null = null;
    /** Mouth pose for "open" (from Emo_blink) */
    private mouthOpenPose: MouthPose | null = null;
    /** Cached synthetic MouthMove clip (generated once) */
    private mouthClip: THREE.AnimationClip | null = null;

    /** Rest pose of right arm bones (captured from model after preload) */
    private armRestPose: ArmPose | null = null;
    /** Cached synthetic Palabra clip (generated once) */
    private palabraClip: THREE.AnimationClip | null = null;

    constructor(model: THREE.Object3D, onLog?: (msg: string) => void) {
        this.model = model;
        this.mixer = new THREE.AnimationMixer(model);
        this.onLog = onLog || (() => { });
    }

    /** Called each frame by useFrame to advance the mixer */
    update(delta: number): void {
        this.mixer.update(delta);
    }

    /**
     * Clip por nombre: los sintéticos se generan al vuelo. Lanza si no existe
     * (antes se asertaba con `!`, así que un clip ausente explotaba más tarde
     * y con un error peor, dentro del mixer).
     */
    private resolveClip(name: BunnyAnimation): THREE.AnimationClip {
        const clip = this.isSynthetic(name)
            ? (name === 'MouthMove' ? this.ensureMouthClip() : this.ensurePalabraClip())
            : this.clips.get(name) ?? null;
        if (!clip) {
            throw new Error(`[Animator] clip no disponible: ${name}`);
        }
        return clip;
    }

    /**
     * Creates the synthetic MouthMove clip if poses are available.
     * The clip oscillates jaw_01.quaternion between closed (Idle_2)
     * and open (Emo_blink) poses using a sinusoidal wave.
     *
     * AMPLITUDE FACTOR: When MouthMove is blended with other animations
     * (e.g., Idle_1 + MouthMove), the AnimationMixer averages the
     * jaw_01.quaternion tracks. Since other animations keep the jaw
     * closed, the blend results in ~50% opening. To compensate, we
     * extrapolate the open pose beyond its original value using
     * spherical cubic (squad) interpolation, so that when the mixer
     * blends at 50%, the visual result matches the intended open pose.
     *
     * The factor is computed as:
     *   overshoot = 1 / (1 - blendWeight)
     * where blendWeight ≈ 0.5 (equal contribution from two animations).
     * This gives factor = 2.0, meaning we go twice as far from closed
     * toward open, so a 50% blend lands exactly at the original open.
     */
    private ensureMouthClip(): THREE.AnimationClip | null {
        if (this.mouthClip) return this.mouthClip;
        if (!this.mouthClosedPose || !this.mouthOpenPose) return null;

        const duration = 2.0;
        const frequency = 1.5;
        const numKeys = Math.ceil(duration * 30);
        const times = new Float32Array(numKeys);
        const values = new Float32Array(numKeys * 4);

        // Amplitude compensation factor for blends.
        // When 2 animations blend at equal weight (0.5 each), the mixer
        // averages the quaternions. To make the result match the original
        // open pose, we need to overshoot by 1/(1-0.5) = 2.0x.
        // For 3+ animations the blend weight per anim is lower, but 2.0
        // is a good practical balance that works well for most cases.
        const AMPLITUDE_FACTOR = 2.0;

        // Pre-compute the overshoot open pose: extrapolate beyond open
        // by the amplitude factor using spherical interpolation.
        const overshootOpen = new THREE.Quaternion().slerpQuaternions(
            this.mouthClosedPose.jawQuat,
            this.mouthOpenPose.jawQuat,
            AMPLITUDE_FACTOR,
        );

        for (let i = 0; i < numKeys; i++) {
            const t = i / (numKeys - 1);
            times[i] = t * duration;

            // Sinusoidal oscillation: closed ↔ overshootOpen
            const phase = (Math.sin(t * frequency * Math.PI * 2 * duration) + 1) / 2;
            const q = new THREE.Quaternion();
            q.slerpQuaternions(this.mouthClosedPose.jawQuat, overshootOpen, phase);

            values[i * 4] = q.x;
            values[i * 4 + 1] = q.y;
            values[i * 4 + 2] = q.z;
            values[i * 4 + 3] = q.w;
        }

        const track = new THREE.QuaternionKeyframeTrack('jaw_01.quaternion', times, values);
        this.mouthClip = new THREE.AnimationClip('MouthMove', duration, [track]);
        return this.mouthClip;
    }

    /**
     * Creates the synthetic Palabra clip that raises the right hand.
     * The clip animates clavicle_r, upperarm_r, lowerarm_r, and hand_r
     * from rest pose → raised pose → rest pose over 2 seconds.
     *
     * The delta rotations are derived from the Cap_front FBX animation,
     * which is known to move the arm in the correct forward direction.
     * We scale the delta by AMPLITUDE_FACTOR (via slerp from identity)
     * to achieve a visible arm raise while preserving the correct axis.
     *
     * AMPLITUDE FACTOR: When blended with Idle_2 at 50/50, the mixer
     * averages quaternions. We overshoot by 2.0x so the blend result
     * matches the intended raised pose.
     */
    private ensurePalabraClip(): THREE.AnimationClip | null {
        if (this.palabraClip) return this.palabraClip;
        if (!this.armRestPose) return null;
        const rest = this.armRestPose;

        const duration = 2.0;
        const times = new Float32Array([0, 0.5, 2.0]);

        // Delta quaternions extracted from Cap_front FBX animation.
        // These represent the rotation from rest pose to the Cap_front
        // pose for each right arm bone. The direction is correct (forward).
        // Values: [x, y, z, w]
        const CAP_FRONT_DELTAS: Record<string, [number, number, number, number]> = {
            clavicle_r: [-0.032663, 0.022509, 0.005780, 0.999196],
            upperarm_r: [-0.162268, -0.141934, 0.003789, 0.976478],
            lowerarm_r: [0.062494, -0.004097, 0.079525, 0.994864],
            hand_r: [-0.167530, -0.006308, 0.109109, 0.979790],
        };

        // Scale factor: Cap_front barely moves the arm (~19° on upperarm_r).
        // We scale by this factor using slerp(identity, delta, factor) to
        // get a more pronounced raise while preserving the rotation axis.
        // Increased from 3.0 to 5.0 for a more exaggerated arm raise.
        const SCALE = 5.0;
        const IDENTITY = new THREE.Quaternion();

        // Compute raised pose by applying scaled delta rotations to rest pose.
        // raisedPose = scaledDelta * restQuat (world-space delta)
        const raisedPose: ArmPose = {
            clavicle_r: rest.clavicle_r.clone(),
            upperarm_r: (() => {
                const capDelta = new THREE.Quaternion(
                    ...CAP_FRONT_DELTAS.upperarm_r);
                const scaled = new THREE.Quaternion().slerpQuaternions(
                    IDENTITY, capDelta, SCALE);
                return scaled.multiply(rest.upperarm_r);
            })(),
            lowerarm_r: (() => {
                const capDelta = new THREE.Quaternion(
                    ...CAP_FRONT_DELTAS.lowerarm_r);
                const scaled = new THREE.Quaternion().slerpQuaternions(
                    IDENTITY, capDelta, SCALE);
                return scaled.multiply(rest.lowerarm_r);
            })(),
            hand_r: (() => {
                const capDelta = new THREE.Quaternion(
                    ...CAP_FRONT_DELTAS.hand_r);
                const scaled = new THREE.Quaternion().slerpQuaternions(
                    IDENTITY, capDelta, SCALE);
                return scaled.multiply(rest.hand_r);
            })(),
        };

        const tracks: THREE.KeyframeTrack[] = [];
        const boneNames = ['clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'] as const;

        for (const boneName of boneNames) {
            const restQuat = this.armRestPose[boneName];
            const raisedQuat = raisedPose[boneName];

            const values = new Float32Array(4 * 3);
            // Keyframe 0 (t=0): rest pose
            values[0] = restQuat.x; values[1] = restQuat.y;
            values[2] = restQuat.z; values[3] = restQuat.w;
            // Keyframe 1 (t=0.5): raised pose
            values[4] = raisedQuat.x; values[5] = raisedQuat.y;
            values[6] = raisedQuat.z; values[7] = raisedQuat.w;
            // Keyframe 2 (t=2.0): back to rest
            values[8] = restQuat.x; values[9] = restQuat.y;
            values[10] = restQuat.z; values[11] = restQuat.w;

            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, times, values));
        }

        this.palabraClip = new THREE.AnimationClip('Palabra', duration, tracks);
        return this.palabraClip;
    }

    /**
     * Checks if an animation name is synthetic (procedurally generated).
     * Synthetic animations have no FBX file and are created on demand.
     */
    private isSynthetic(name: BunnyAnimation): boolean {
        return name === 'MouthMove' || name === 'Palabra';
    }

    /**
     * Precarga todas las animaciones FBX en paralelo.
     * También extrae y cachea los IK/FK bones del primer FBX exitoso
     * para que play() sea instantáneo.
     *
     * Las animaciones sintéticas (MouthMove) no se precargan aquí;
     * se generan bajo demanda en ensureMouthClip().
     */
    async preloadAll(): Promise<void> {
        const entries = Object.entries(ANIMATION_PATHS) as [string, string][];
        let bonesCached = false;

        const promises = entries.map(([name, path]) =>
            new Promise<void>((resolve) => {
                loadFbx(path).then(
                    (fbx) => {
                        const clip = fbx.animations[0];
                        if (clip) {
                            shiftClipToZero(clip);
                            this.clips.set(name, clip);

                            // Extract mouth poses from Idle_2 (closed) and Emo_blink (open)
                            if (name === 'Idle_2' || name === 'Emo_blink') {
                                for (const track of clip.tracks) {
                                    if (track.name === 'jaw_01.quaternion' && track.times.length > 0) {
                                        const quat = new THREE.Quaternion(
                                            track.values[0],
                                            track.values[1],
                                            track.values[2],
                                            track.values[3],
                                        );
                                        if (name === 'Idle_2') {
                                            this.mouthClosedPose = { jawQuat: quat };
                                        } else {
                                            this.mouthOpenPose = { jawQuat: quat };
                                        }
                                    }
                                }
                            }

                            // Extract arm rest pose from Idle_2 (right arm bones at rest)
                            if (name === 'Idle_2' && !this.armRestPose) {
                                const armBoneNames = ['clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'];
                                const armQuats: Record<string, THREE.Quaternion | null> = {
                                    clavicle_r: null,
                                    upperarm_r: null,
                                    lowerarm_r: null,
                                    hand_r: null,
                                };
                                for (const track of clip.tracks) {
                                    for (const boneName of armBoneNames) {
                                        if (track.name === `${boneName}.quaternion` && track.times.length > 0) {
                                            armQuats[boneName] = new THREE.Quaternion(
                                                track.values[0],
                                                track.values[1],
                                                track.values[2],
                                                track.values[3],
                                            );
                                        }
                                    }
                                }
                                const { clavicle_r, upperarm_r, lowerarm_r, hand_r } = armQuats;
                                if (clavicle_r && upperarm_r && lowerarm_r && hand_r) {
                                    this.armRestPose = { clavicle_r, upperarm_r, lowerarm_r, hand_r };
                                }
                            }
                        }

                        if (!bonesCached) {
                            const animBones: THREE.Bone[] = [];
                            fbx.traverse((child) => {
                                if (child instanceof THREE.Bone) {
                                    animBones.push(child);
                                }
                            });
                            if (animBones.length > 0) {
                                this.cachedAnimBones = animBones;
                                bonesCached = true;
                            }
                        }

                        resolve();
                    },
                    () => {
                        console.warn(`[Animator] Failed to preload: ${name}`);
                        resolve();
                    },
                );
            }),
        );

        await Promise.all(promises);
        this.onLog(`[Animator] Preloaded ${this.clips.size}/${entries.length} animations` +
            (this.cachedAnimBones ? `, ${this.cachedAnimBones.length} IK/FK bones cached` : ', no bones cached'));
    }

    /**
     * Reproduce una animación (FBX o sintética).
     * Para animaciones FBX: el clip ya debe estar precargado.
     * Para sintéticas (MouthMove): se genera bajo demanda.
     * Los IK/FK bones se agregan desde el caché.
     */
    play(name: BunnyAnimation): boolean {
        let clip: THREE.AnimationClip | null = null;

        if (this.isSynthetic(name)) {
            if (name === 'MouthMove') {
                clip = this.ensureMouthClip();
            } else if (name === 'Palabra') {
                clip = this.ensurePalabraClip();
            }
        } else {
            clip = this.clips.get(name) || null;
        }

        if (!clip) {
            console.warn(`[Animator] Clip not available: ${name}`);
            return false;
        }

        // Stop all current actions (both main and blend)
        this.stopAllActions();

        // Remove previously added animation bones
        this.clearAnimBones();

        // Add cached IK/FK bones to the model (instant, no FBX reload)
        this.ensureAnimBones();

        // Create and play action
        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();

        this.currentAction = action;

        this.onLog(`[Animator] Playing: ${name} (${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks)` +
            (this.animBones.length > 0 ? `, ${this.animBones.length} IK/FK bones added` : ''));

        return true;
    }

    /**
     * Reproduce 2 animaciones simultáneamente (blending).
     * Soporta animaciones FBX y sintéticas (MouthMove).
     */
    playBlended(bodyAnim: BunnyAnimation, faceAnim: BunnyAnimation): boolean {
        return this.playBlendedList([bodyAnim, faceAnim]);
    }

    /**
     * Reproduce N animaciones simultáneamente (blending).
     * Soporta animaciones FBX y sintéticas (MouthMove).
     * Cada animación se reproduce como una acción independiente en el mixer.
     */
    playBlendedList(anims: BunnyAnimation[]): boolean {
        if (anims.length === 0) return false;

        // Validate all clips are available
        for (const name of anims) {
            if (this.isSynthetic(name)) {
                if (name === 'MouthMove') {
                    if (!this.ensureMouthClip()) {
                        console.warn(`[Animator] Cannot create synthetic clip: ${name}`);
                        return false;
                    }
                } else if (name === 'Palabra') {
                    if (!this.ensurePalabraClip()) {
                        console.warn(`[Animator] Cannot create synthetic clip: ${name}`);
                        return false;
                    }
                }
            } else if (!this.clips.has(name)) {
                console.warn(`[Animator] Clip not preloaded: ${name}`);
                return false;
            }
        }

        // Stop all current actions
        this.stopAllActions();

        // Remove previously added animation bones
        this.clearAnimBones();

        // Add cached IK/FK bones to the model
        this.ensureAnimBones();

        // --- First animation: main action ---
        const firstClip = this.resolveClip(anims[0]);
        const mainAction = this.mixer.clipAction(firstClip);
        mainAction.reset();
        mainAction.setLoop(THREE.LoopRepeat, Infinity);
        mainAction.setEffectiveWeight(1.0);
        mainAction.play();
        this.currentAction = mainAction;

        // --- Remaining animations: blend actions ---
        this.blendActions = [];
        for (let i = 1; i < anims.length; i++) {
            const clip = this.resolveClip(anims[i]);
            const action = this.mixer.clipAction(clip);
            action.reset();
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.setEffectiveWeight(1.0);
            action.play();
            this.blendActions.push(action);
        }

        this.onLog(`[Animator] Blended: ${anims.join(' + ')}` +
            (this.animBones.length > 0 ? `, ${this.animBones.length} IK/FK bones added` : ''));

        return true;
    }

    /**
     * Cross-fade to a new animation (single playback).
     * Smoothly transitions from the current animation to the new one
     * over `fadeDuration` seconds using THREE.AnimationMixer cross-fade.
     */
    crossFadeTo(name: BunnyAnimation, fadeDuration: number = 0.3): boolean {
        let clip: THREE.AnimationClip | null = null;

        if (this.isSynthetic(name)) {
            if (name === 'MouthMove') {
                clip = this.ensureMouthClip();
            } else if (name === 'Palabra') {
                clip = this.ensurePalabraClip();
            }
        } else {
            clip = this.clips.get(name) || null;
        }

        if (!clip) {
            console.warn(`[Animator] Clip not available for cross-fade: ${name}`);
            return false;
        }

        // Create the new action
        const newAction = this.mixer.clipAction(clip);
        newAction.reset();
        newAction.setLoop(THREE.LoopRepeat, Infinity);
        newAction.setEffectiveWeight(1.0);

        // If there's a current action, cross-fade from it
        if (this.currentAction) {
            // Stop the old action after cross-fade completes
            this.currentAction.crossFadeTo(newAction, fadeDuration, true);
        }

        // Stop blend actions immediately (they'd interfere)
        for (const action of this.blendActions) {
            action.stop();
        }
        this.blendActions = [];

        newAction.play();
        this.currentAction = newAction;

        this.onLog(`[Animator] Cross-fade to: ${name} (${fadeDuration.toFixed(2)}s)`);

        return true;
    }

    /**
     * Cross-fade to a blended list of animations.
     * Smoothly transitions from current blend to the new blend.
     */
    crossFadeToBlended(anims: BunnyAnimation[], fadeDuration: number = 0.3): boolean {
        if (anims.length === 0) return false;

        // Validate all clips are available
        for (const name of anims) {
            if (this.isSynthetic(name)) {
                if (name === 'MouthMove') {
                    if (!this.ensureMouthClip()) {
                        console.warn(`[Animator] Cannot create synthetic clip: ${name}`);
                        return false;
                    }
                } else if (name === 'Palabra') {
                    if (!this.ensurePalabraClip()) {
                        console.warn(`[Animator] Cannot create synthetic clip: ${name}`);
                        return false;
                    }
                }
            } else if (!this.clips.has(name)) {
                console.warn(`[Animator] Clip not preloaded: ${name}`);
                return false;
            }
        }

        // Stop old blend actions FIRST to avoid Three.js clipAction() cache conflict.
        // Three.js AnimationMixer.clipAction() returns a CACHED AnimationAction for the
        // same clip. If we create new blend actions BEFORE stopping old ones, and a blend
        // animation (e.g. MouthMove) appears in BOTH the old and new blend lists,
        // this.mixer.clipAction(clip) returns the SAME action object. We'd reset+play it,
        // then immediately stop it in the old blend actions loop → the blend never plays.
        for (const action of this.blendActions) {
            action.stop();
        }
        this.blendActions = [];

        // Remove previously added animation bones
        this.clearAnimBones();
        this.ensureAnimBones();

        // --- First animation: main action ---
        const firstClip = this.resolveClip(anims[0]);
        const mainAction = this.mixer.clipAction(firstClip);
        mainAction.reset();
        mainAction.setLoop(THREE.LoopRepeat, Infinity);
        mainAction.setEffectiveWeight(1.0);

        // Cross-fade main action if there's a current action
        if (this.currentAction) {
            this.currentAction.crossFadeTo(mainAction, fadeDuration, true);
        }

        mainAction.play();

        // --- Remaining animations: blend actions ---
        const newBlendActions: THREE.AnimationAction[] = [];
        for (let i = 1; i < anims.length; i++) {
            const clip = this.resolveClip(anims[i]);
            const action = this.mixer.clipAction(clip);
            action.reset();
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.setEffectiveWeight(1.0);
            action.play();
            newBlendActions.push(action);
        }

        this.currentAction = mainAction;
        this.blendActions = newBlendActions;

        this.onLog(`[Animator] Cross-fade to blend: ${anims.join(' + ')} (${fadeDuration.toFixed(2)}s)`);

        return true;
    }

    /**
     * Sets the global playback speed for all animations.
     * 1.0 = normal speed, 0.5 = half speed, 2.0 = double speed.
     * Delegates to THREE.AnimationMixer.timeScale.
     */
    setTimeScale(speed: number): void {
        this.mixer.timeScale = Math.max(0.1, Math.min(10, speed));
    }

    stop(): void {
        this.stopAllActions();
        this.clearAnimBones();
    }

    /** Returns the names of currently playing animations */
    getPlayingAnimations(): BunnyAnimation[] {
        const result: BunnyAnimation[] = [];
        const allActions = this.currentAction
            ? [this.currentAction, ...this.blendActions]
            : [...this.blendActions];
        for (const action of allActions) {
            const clipName = action.getClip().name;
            // Check FBX clips
            for (const [name] of this.clips) {
                if (name === clipName) {
                    result.push(name as BunnyAnimation);
                    break;
                }
            }
            // Check synthetic clips
            if (clipName === 'MouthMove') {
                result.push('MouthMove');
            } else if (clipName === 'Palabra') {
                result.push('Palabra');
            }
        }
        return result;
    }

    private stopAllActions(): void {
        if (this.currentAction) {
            this.currentAction.stop();
            this.currentAction = null;
        }
        for (const action of this.blendActions) {
            action.stop();
        }
        this.blendActions = [];
    }

    private ensureAnimBones(): void {
        if (this.cachedAnimBones) {
            const addedBones: THREE.Bone[] = [];
            for (const bone of this.cachedAnimBones) {
                let exists = false;
                this.model.traverse((child) => {
                    if (child instanceof THREE.Bone && child.name === bone.name) {
                        exists = true;
                    }
                });
                if (!exists) {
                    const boneClone = new THREE.Bone();
                    boneClone.name = bone.name;
                    boneClone.position.copy(bone.position);
                    boneClone.quaternion.copy(bone.quaternion);
                    boneClone.scale.copy(bone.scale);
                    this.model.add(boneClone);
                    addedBones.push(boneClone);
                }
            }
            this.animBones = addedBones;
        }
    }

    private clearAnimBones(): void {
        for (const bone of this.animBones) {
            bone.removeFromParent();
        }
        this.animBones = [];
    }

    dispose(): void {
        this.stop();
        this.mixer.stopAllAction();
        this.clips.clear();
        this.cachedAnimBones = null;
        this.mouthClip = null;
        this.palabraClip = null;
    }
}
