// ============================================================
// BunnyViewer — Visor 3D del Avatar FLU (thin wrapper)
// ============================================================
// Wrapper delgado sobre el Canvas de @react-three/fiber. Toda la
// lógica 3D (carga del modelo, animaciones, skeletons, materiales,
// visibilidad/colores de componentes) vive en src/avatar/model/:
//   - BunnyModel.tsx   → componente React del modelo 3D
//   - bunnyAnimator.ts → precarga/reproducción de animaciones
//   - bunnySkeleton.ts → unificación de skeletons
//   - bunnyMaterials.ts→ materiales/texturas originales
//   - bunnyTextures.ts → generación de texturas
//   - bunnyComponents.ts → visibilidad/colores por componente
//
// Ruta de carga ÚNICA: tanto el modelo como las animaciones se
// cargan con loadFbx() desde src/avatar/workers/fbxWorkerClient
// (Web Worker). No hay doble ruta ni parches visuales.
// ============================================================

import { useEffect, useMemo } from 'react';
import { Canvas, useThree, type RootState } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { useBunnyStore } from '../store/bunnyStore';
import BunnyModel from '../model/BunnyModel';
import { BRANDING_SCOPE_SELECTOR } from '../../core/branding/seasonalPalettes';
import {
    BUNNY_LIGHTS,
    BUNNY_ORBIT,
    BUNNY_SCENE,
    BUNNY_SIGNAL_OVERLAY,
    BUNNY_STATE_INDICATOR,
} from '../config/bunnySceneConfig';

// -----------------------------------------------------------
// Senales Visuales Overlay
// -----------------------------------------------------------

function SignalOverlay() {
    const currentSignal = useBunnyStore((s) => s.currentSignal);

    const signalConfig = useMemo(() => {
        if (currentSignal === 'NONE' || !BUNNY_SIGNAL_OVERLAY.signals[currentSignal]) return null;
        return BUNNY_SIGNAL_OVERLAY.signals[currentSignal];
    }, [currentSignal]);

    if (!signalConfig) return null;

    return (
        <Html position={BUNNY_SIGNAL_OVERLAY.position} center>
            <div
                style={{
                    fontSize: BUNNY_SIGNAL_OVERLAY.fontSize,
                    filter: `drop-shadow(0 0 20px ${signalConfig.color})`,
                    animation: BUNNY_SIGNAL_OVERLAY.pulse,
                    pointerEvents: 'none',
                    userSelect: 'none',
                }}
            >
                {signalConfig.icon}
            </div>
        </Html>
    );
}

// -----------------------------------------------------------
// Indicador de Estado
// -----------------------------------------------------------

function StateIndicator() {
    const currentState = useBunnyStore((s) => s.currentState);

    const stateColors: Record<string, string> = BUNNY_STATE_INDICATOR.colors;

    return (
        <Html position={BUNNY_STATE_INDICATOR.position} center>
            <div
                style={{
                    background: BUNNY_STATE_INDICATOR.background,
                    color: stateColors[currentState] || BUNNY_STATE_INDICATOR.fallbackColor,
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                    border: `1px solid ${stateColors[currentState] || BUNNY_STATE_INDICATOR.fallbackColor}`,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    userSelect: 'none',
                }}
            >
                {currentState}
            </div>
        </Html>
    );
}

// -----------------------------------------------------------
// Escena 3D
// -----------------------------------------------------------

function Scene({ orientation = 0.525 }: { orientation?: number }) {
    return (
        <>
            {/* Luces — corregidas para three r184 (modelo de iluminación física).
                Los valores originales (ambient 0.6, dir 1.8/0.6, hemi 0.5) fueron
                calibrados para iluminación "legacy" pre-r155; bajo física (r155+)
                aplastan las texturas a gris oscuro. Subir intensidades es una
                corrección de configuración de escena, NO un parche al modelo. */}
            <ambientLight intensity={BUNNY_LIGHTS.ambient} />
            <directionalLight
                position={BUNNY_LIGHTS.directional.main.position}
                intensity={BUNNY_LIGHTS.directional.main.intensity}
            />
            <directionalLight
                position={BUNNY_LIGHTS.directional.fill.position}
                intensity={BUNNY_LIGHTS.directional.fill.intensity}
            />
            <hemisphereLight
                args={[BUNNY_LIGHTS.hemisphere.sky, BUNNY_LIGHTS.hemisphere.ground, BUNNY_LIGHTS.hemisphere.intensity]}
            />

            <BunnyModel orientation={orientation} />

            <SignalOverlay />
            <StateIndicator />

            <OrbitControls
                enablePan={BUNNY_ORBIT.enablePan}
                enableZoom={BUNNY_ORBIT.enableZoom}
                enableRotate={BUNNY_ORBIT.enableRotate}
                minDistance={BUNNY_ORBIT.minDistance}
                maxDistance={BUNNY_ORBIT.maxDistance}
                autoRotate={BUNNY_ORBIT.autoRotate}
                target={BUNNY_ORBIT.target}
            />
        </>
    );
}

// -----------------------------------------------------------
// WebGL Context Manager
// -----------------------------------------------------------
// Maneja la perdida y restauracion del contexto WebGL.
// Puppeteer/headless Chrome a veces pierde el contexto WebGL
// cuando hay cambios de pagina o HMR. Este componente asegura
// que el contexto se restaure correctamente.
// -----------------------------------------------------------

function WebGLContextManager() {
    const { gl, invalidate } = useThree();

    useEffect(() => {
        const canvas = gl.domElement;

        const handleContextLost = (e: Event) => {
            e.preventDefault();
            console.warn('[BunnyViewer] WebGL context lost');
        };

        const handleContextRestored = () => {
            invalidate();
        };

        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        return () => {
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
        };
    }, [gl, invalidate]);

    return null;
}

// -----------------------------------------------------------
// Sincronización de Fondo con la Paleta de Branding
// -----------------------------------------------------------
// El fondo 3D (clear color) se deriva de la variable CSS --bg-secondary.
// El branding de temporada se aplica en los contenedores .flu-branding-scope
// (área de FLU), así que se lee el color desde el contenedor más cercano al
// canvas; si no hay scope, se cae al :root. Un MutationObserver sobre el scope
// y el documentElement reaplica el clear color cuando cambian la clase
// (season-*) o las variables de color (style). No hay ruta doble: la única
// fuente de verdad son las variables CSS de la paleta.
// -----------------------------------------------------------

const BG_CSS_VAR = '--bg-secondary';

function readBgColor(scope: Element | null): string {
    const source = scope || document.documentElement;
    const computed = getComputedStyle(source).getPropertyValue(BG_CSS_VAR).trim();
    return computed || BUNNY_SCENE.background;
}

function SceneBackgroundSync() {
    const { gl, invalidate } = useThree();

    useEffect(() => {
        const canvas = gl.domElement as HTMLCanvasElement;
        const scope = canvas.closest(BRANDING_SCOPE_SELECTOR);

        const apply = () => {
            gl.setClearColor(readBgColor(scope), 1);
            invalidate();
        };

        // Aplicar al montar
        apply();

        // Reaplicar cuando cambie la paleta (clase season-* o variables de color).
        // Observa el scope de branding (si existe) y el :root como respaldo.
        const targets = scope ? [scope, document.documentElement] : [document.documentElement];
        const observer = new MutationObserver(apply);
        for (const target of targets) {
            observer.observe(target, { attributes: true, attributeFilter: ['class', 'style'] });
        }

        return () => observer.disconnect();
    }, [gl, invalidate]);

    return null;
}

// -----------------------------------------------------------
// BunnyViewer
// -----------------------------------------------------------

interface BunnyViewerProps {
    /** Rotación del modelo en radianes sobre el eje Y (default: 0.525 ≈ 30°) */
    orientation?: number;
}

export default function BunnyViewer({ orientation = BUNNY_SCENE.orientationDefault }: BunnyViewerProps) {
    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <Canvas
                camera={{ position: BUNNY_SCENE.camera.position, fov: BUNNY_SCENE.camera.fov }}
                gl={{
                    antialias: true,
                    alpha: false,
                    powerPreference: 'high-performance',
                    preserveDrawingBuffer: true,
                }}
                style={{ background: `var(--bg-secondary, ${BUNNY_SCENE.background})` }}
                onCreated={(state: RootState) => {
                    const gl = state.gl;
                    // Con alpha:false, el clear color del WebGL es lo que se ve;
                    // lo reaplica SceneBackgroundSync según la paleta de branding.
                    gl.domElement.addEventListener('webglcontextlost', (e: Event) => {
                        e.preventDefault();
                        console.warn('[BunnyViewer] WebGL context lost');
                    });
                    gl.domElement.addEventListener('webglcontextrestored', () => {
                        state.invalidate();
                    });
                }}
            >
                <Scene orientation={orientation} />
                <WebGLContextManager />
                <SceneBackgroundSync />
            </Canvas>
        </div>
    );
}
