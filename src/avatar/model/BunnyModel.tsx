// ============================================================
// BunnyModel — Componente React del modelo 3D de Bunny
// ============================================================
// Carga el modelo UNA SOLA VEZ. Usa refs para toda la lógica
// 3D (mixer, animator, skeleton) de modo que cambios en React
// state (logsEnabled, etc.) NO recarguen el modelo.
//
// Las animaciones se precargan en segundo plano después de que
// el modelo está listo. play() solo busca el clip en el Map y
// ejecuta mixer.clipAction().play() — sin resolver assets.
//
// Las animaciones sintéticas (MouthMove) se generan bajo demanda
// por el BunnyAnimator y se reproducen a través del mixer como
// cualquier otra animación, permitiendo combinarlas en blends.
//
// CARGA VÍA WORKER (única ruta): el modelo y las animaciones se
// cargan con loadFbx() desde fbxWorkerClient, que descarga +
// parsea en un Web Worker y reconstruye el grupo en el hilo
// principal. No hay doble ruta de carga.
//
// FIX: logsEnabled se usa mediante una ref para evitar stale
// closures en el useEffect de carga del modelo (que tiene [] deps).
// ============================================================

import { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useBunnyStore } from '../store/bunnyStore';
import { unifySkeletons } from './bunnySkeleton';
import { repairFBXMaterials } from './bunnyMaterials';
import { BunnyAnimator } from './bunnyAnimator';
import { applyComponentVisibility, applyComponentColor } from './bunnyComponents';
import { loadFbx } from '../workers/fbxWorkerClient';
import { DecorationsRenderer } from '../decorations/DecorationsRenderer';
import type { BunnyAnimation } from '../types/bunny';
import { logCaughtError } from '../../lib/caughtError';

export default function BunnyModel({ orientation = 0.525 }: { orientation?: number }) {
    // ---- Refs (no causan re-render) ----
    const modelRef = useRef<THREE.Group>(null);
    const modelObjRef = useRef<THREE.Object3D | null>(null);
    const animatorRef = useRef<BunnyAnimator | null>(null);
    const prevAnimRef = useRef<BunnyAnimation | null>(null);
    const prevPlayingRef = useRef(false);
    const prevBlendRef = useRef<string>('');
    const prevComponentsRef = useRef<string>('');
    /** Ref para logsEnabled — evita stale closures en useEffect con [] deps */
    const logsEnabledRef = useRef(false);

    // ---- React state (solo para UI) ----
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    // Indica que TODOS los clips ya están precargados. La reproducción de
    // animaciones se difiere hasta que este flag sea true (capa única contra la
    // carrera de preload: las expresiones que llegan durante preloadAll() se
    // reproducen en cuanto termina la precarga, en vez de descartarse en silencio).
    const [preloaded, setPreloaded] = useState(false);

    // ---- Store subscriptions (solo lectura, no triggers de carga) ----
    const currentAnimation = useBunnyStore((s) => s.currentAnimation);
    const blendQueue = useBunnyStore((s) => s.blendQueue);
    const isPlaying = useBunnyStore((s) => s.isPlaying);
    const components = useBunnyStore((s) => s.components);
    const componentColors = useBunnyStore((s) => s.componentColors);
    const logsEnabled = useBunnyStore((s) => s.logsEnabled);
    const animationSpeed = useBunnyStore((s) => s.animationSpeed);

    // Mantener refs sincronizados con el store (evita stale closures)
    logsEnabledRef.current = logsEnabled;

    // ============================================================
    // CARGA DEL MODELO — UNA SOLA VEZ
    // ============================================================
    // NOTA: Este useEffect NO depende de logsEnabled.
    // Usamos logsEnabledRef.current para evitar stale closures.
    // El modelo se carga una vez y se queda en modelObjRef.
    // ============================================================

    useEffect(() => {
        let disposed = false;

        loadFbx('/models/Bunny_full.fbx')
            .then((object) => {
                if (disposed) return;

                // 1. Unify skeletons
                unifySkeletons(object);
                if (logsEnabledRef.current) {
                }

                // 2. Repair materials with textures
                repairFBXMaterials(object);

                // 3. Scale to reasonable size
                const box = new THREE.Box3().setFromObject(object);
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2 / maxDim;
                object.scale.set(scale, scale, scale);

                const newBox = new THREE.Box3().setFromObject(object);
                const center = newBox.getCenter(new THREE.Vector3());
                object.position.set(-center.x, -center.y, -center.z);

                // 4. Create animator (creates mixer internally)
                const animator = new BunnyAnimator(object, (_msg) => {
                });
                animatorRef.current = animator;

                // 5. Preload all animations in background, then mark as ready
                modelObjRef.current = object;

                // Apply initial component visibility now that the model is loaded.
                // The useEffect that watches `components` may have already fired while
                // modelObjRef.current was still null (async FBX load race condition).
                // Without this, components like Bunny_cap remain visible even when
                // the store says they should be hidden.
                const initialComponents = useBunnyStore.getState().components;
                applyComponentVisibility(object, initialComponents);

                // Apply initial component colors now that the model is loaded.
                // Same race condition as visibility: if the user already changed a
                // color while the model was still loading, this guarantees the
                // correct color is applied once the model exists.
                const initialColors = useBunnyStore.getState().componentColors;
                Object.entries(initialColors).forEach(([component, color]) => {
                    if (color) applyComponentColor(object, component, color);
                });

                animator.preloadAll().then(() => {
                    setLoading(false);
                    setPreloaded(true); // habilita la reproducción: el efecto re-ejecuta con el estado actual del store
                    try {
                        if (import.meta.env.DEV) {
                            window.__bunnyPreloadDone = true;
                        }
                    } catch (e) {
        logCaughtError('[catch] src/avatar/model/BunnyModel.tsx', e);
                        /* ignore */
                    }
                });

                if (logsEnabledRef.current) {
                }
            })
            .catch((err) => {
                if (disposed) return;
                console.error('[BunnyViewer] Error:', err);
                setError('Error al cargar el modelo 3D');
                setLoading(false);
            });

        return () => {
            disposed = true;
            if (animatorRef.current) {
                animatorRef.current.dispose();
                animatorRef.current = null;
            }
        };
    }, []); // ← Intencionalmente vacío: el modelo se carga UNA VEZ

    // ============================================================
    // COMPONENT VISIBILITY — se ejecuta en cada render
    // ============================================================

    useEffect(() => {
        const model = modelObjRef.current;
        if (!model) return;

        const compKey = JSON.stringify(components);
        if (compKey === prevComponentsRef.current) return;
        prevComponentsRef.current = compKey;

        applyComponentVisibility(model, components);
    }, [components]);

    // ============================================================
    // COMPONENT COLORS — aplicar colores personalizados por componente
    // ============================================================
    // Se ejecuta cuando cambia componentColors. La aplicación inicial
    // (modelo aún cargando) ya se hizo en el efecto de carga, así que
    // aquí solo replicamos cambios posteriores.

    useEffect(() => {
        const model = modelObjRef.current;
        if (!model) return;

        Object.entries(componentColors).forEach(([component, color]) => {
            if (!color) return;
            applyComponentColor(model, component, color);
        });
    }, [componentColors]);

    // ============================================================
    // ANIMATION PLAYBACK — con cross-fade suave (Phase 5 — Darle Vida)
    // ============================================================
    // Soporta dos modos:
    //   1. Single: currentAnimation → animator.crossFadeTo()
    //   2. Blended: blendQueue → animator.crossFadeToBlended()
    // Ambos modos usan cross-fade de 0.3s para transiciones suaves.
    // ============================================================

    // NOTA (capa única anti-congelamiento en recarga): el efecto depende de
    // `preloaded`. Durante preloadAll() los clips aún no existen y crossFadeTo
    // devuelve false (las expresiones se descartaban en silencio SIN reintento).
    // Al terminar la precarga, `preloaded` cambia → este efecto re-ejecuta y
    // aplica el estado ACTUAL del store (la primera micro-animación pendiente),
    // por lo que en recarga la primera animación ya se mueve.
    useEffect(() => {
        const animator = animatorRef.current;
        if (!animator || !preloaded) return;

        const FADE_DURATION = 0.3; // segundos de cross-fade

        // --- Blended playback (N animaciones simultáneas) ---
        if (isPlaying && blendQueue.length > 0) {
            const blendKey = blendQueue.join('+');
            if (prevBlendRef.current === blendKey && prevPlayingRef.current) return;

            const ok = animator.crossFadeToBlended(blendQueue, FADE_DURATION);
            if (ok) {
                prevAnimRef.current = null;
                prevBlendRef.current = blendKey;
                prevPlayingRef.current = true;
                if (logsEnabledRef.current) {
                }
            }
            return;
        }

        // --- Single playback ---
        if (isPlaying && currentAnimation) {
            // Evitar re-ejecutar si es la misma animación
            if (prevAnimRef.current === currentAnimation && prevPlayingRef.current) return;

            const ok = animator.crossFadeTo(currentAnimation, FADE_DURATION);
            if (ok) {
                prevAnimRef.current = currentAnimation;
                prevBlendRef.current = '';
                prevPlayingRef.current = true;
                if (logsEnabledRef.current) {
                }
            }
        } else if (!isPlaying && prevPlayingRef.current) {
            animator.stop();
            prevAnimRef.current = null;
            prevBlendRef.current = '';
            prevPlayingRef.current = false;
        }
    }, [currentAnimation, blendQueue, isPlaying, preloaded]);

    // ============================================================
    // ANIMATION SPEED — sincronizar con BunnyStore
    // ============================================================

    useEffect(() => {
        const animator = animatorRef.current;
        if (!animator) return;
        animator.setTimeScale(animationSpeed);
        if (logsEnabledRef.current) {
        }
    }, [animationSpeed]);

    // ============================================================
    // useFrame — actualizar mixer cada frame
    // ============================================================

    useFrame((_, delta) => {
        const animator = animatorRef.current;
        if (animator) {
            animator.update(delta);
        }
    });

    // ============================================================
    // Render
    // ============================================================

    if (error) {
        return (
            <Html center>
                <div style={{ color: '#ff4444', fontFamily: 'monospace', fontSize: '14px' }}>
                    {'X'} {error}
                </div>
            </Html>
        );
    }

    if (loading || !modelObjRef.current) {
        return (
            <Html center>
                <div style={{ color: '#888', fontFamily: 'monospace', fontSize: '14px' }}>
                    {'[@'} Cargando modelo 3D...
                </div>
            </Html>
        );
    }

    return (
        <group ref={modelRef} rotation={[0, orientation, 0]}>
            <primitive object={modelObjRef.current} />
            <DecorationsRenderer target={modelObjRef.current} />
        </group>
    );
}
