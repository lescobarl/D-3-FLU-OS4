// ============================================================
// BunnyStore — Estado Global del Avatar FLU (Zustand)
// ============================================================
// Maneja visibilidad de componentes, animación activa,
// señales visuales, logs y máquina de estados.
// ============================================================

import { create } from 'zustand';
import type {
    BunnyComponent,
    BunnyAnimation,
    AvatarSignal,
    AvatarState,
    BunnyLogEntry,
    BunnyControlState,
} from '../types/bunny';
import { EXPRESSION_MAP } from '../expressionMap';
import { relayLog } from '../../lib/clientLogRelay';
import { logCaughtError } from '../../lib/caughtError';

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/**
 * Genera timestamp ISO para logs.
 */
const nowISO = (): string => new Date().toISOString();

/**
 * Crea una entrada de log.
 */
const makeLog = (
    type: BunnyLogEntry['type'],
    action: string,
    detail: string,
): BunnyLogEntry => ({
    timestamp: nowISO(),
    type,
    action,
    detail,
});

/**
 * Añade una entrada al log si los logs están activos.
 * Dueño único del append que repetían todas las acciones del store.
 * @param state Estado con logs y su interruptor.
 * @param type Categoría del log.
 * @param action Acción registrada.
 * @param detail Detalle legible.
 * @returns Lista de logs resultante.
 */
const withLog = (
    state: Pick<BunnyControlState, 'logs' | 'logsEnabled'>,
    type: BunnyLogEntry['type'],
    action: string,
    detail: string,
): BunnyLogEntry[] => (
    state.logsEnabled ? [...state.logs, makeLog(type, action, detail)] : state.logs
);

/**
 * Entradas de log tras cambiar la visibilidad de un componente.
 * Dueño único del append que compartían toggle y visibilidad fija.
 * @param state Estado con logs y su interruptor.
 * @param component Componente afectado.
 * @param visible Visibilidad resultante.
 * @returns Lista de logs resultante.
 */
const withComponentLog = (
    state: Pick<BunnyControlState, 'logs' | 'logsEnabled'>,
    component: BunnyComponent,
    visible: boolean,
): BunnyLogEntry[] => (
    withLog(state, 'component',
                visible ? 'SHOW' : 'HIDE',
                `${component} → ${visible ? 'visible' : 'oculto'}`)
);

// -----------------------------------------------------------
// Estado inicial
// -----------------------------------------------------------

const initialComponents = (): Record<BunnyComponent, boolean> => ({
    Bunny_full: true,
    Bunny_body: true,
    Bunny_cap: true,
    Bunny_pants: true,
    Bunny_face: true,
    Bunny_eyes: true,
    Bunny_glasses: false,
    Bunny_ears: true,
});

const initialComponentColors = (): Record<BunnyComponent, string | undefined> => ({
    Bunny_full: undefined,
    Bunny_body: undefined,
    Bunny_pants: undefined,
    Bunny_face: undefined,
    Bunny_eyes: undefined,
    Bunny_cap: undefined,
    Bunny_glasses: undefined,
    Bunny_ears: undefined,
});

const initialState: BunnyControlState = {
    components: initialComponents(),
    componentColors: initialComponentColors(),
    currentAnimation: 'Idle_2' as BunnyAnimation,
    currentSignal: 'NONE',
    currentState: 'IDLE',
    logsEnabled: false,
    logs: [],
    isPlaying: true,
    // OS3 integration: expression/blend state
    currentExpression: 'atencion',
    blendQueue: [],
    blendSlots: [],
    activeBlendSlot: null,
    animationSpeed: 1,
    activeDecoration: null,
};

// -----------------------------------------------------------
// Store
// -----------------------------------------------------------

interface BunnyStoreActions {
    /** Toggle visibilidad de un componente */
    toggleComponent: (component: BunnyComponent) => void;
    /** Mostrar/ocultar un componente específico */
    setComponentVisibility: (component: BunnyComponent, visible: boolean) => void;
    /** Establecer color de un componente */
    setComponentColor: (component: BunnyComponent, color: string) => void;
    /** Restablecer todos los colores de componentes a sus valores por defecto */
    resetComponentColors: () => void;
    /** Disparar una animación */
    playAnimation: (animation: BunnyAnimation) => void;
    /** Detener animación actual */
    stopAnimation: () => void;
    /** Cambiar señal visual */
    setSignal: (signal: AvatarSignal) => void;
    /** Cambiar estado del avatar */
    setState: (state: AvatarState) => void;
    /** Toggle de logs */
    toggleLogs: () => void;
    /** Limpiar logs */
    clearLogs: () => void;
    /** Agregar log manual */
    addLog: (entry: BunnyLogEntry) => void;
    /** Resetear todo */
    reset: () => void;

    // ---- OS3 Integration Methods ----
    /** Establecer expresión facial (mapea a animaciones vía EXPRESSION_MAP) */
    setExpression: (expression: string) => void;
    /** Limpiar expresión facial */
    clearExpression: () => void;
    /** Mezclar múltiples animaciones en cola */
    blendAnimation: (anims: BunnyAnimation[]) => void;
    /** Ajustar velocidad de animación */
    setAnimationSpeed: (speed: number) => void;
    /** Establecer la decoración estacional 3D activa (key del catálogo) */
    setDecoration: (decoration: string | null) => void;
}

export type BunnyStore = BunnyControlState & BunnyStoreActions;

/** Cambio de visibilidad con su log (dueño único del par components/logs). */
const withComponentVisibility = (
    state: Pick<BunnyControlState, 'components' | 'logs' | 'logsEnabled'>,
    component: BunnyComponent,
    visible: boolean,
): Pick<BunnyControlState, 'components' | 'logs'> => ({
    components: { ...state.components, [component]: visible },
    logs: withComponentLog(state, component, visible),
});

export const useBunnyStore = create<BunnyStore>((set, _get) => ({
    // --- Estado ---
    ...initialState,

    // --- Acciones ---

    toggleComponent: (component: BunnyComponent) => {
        set((state) => {
            const visible = !state.components[component];
            return withComponentVisibility(state, component, visible);
        });
    },

    setComponentVisibility: (component: BunnyComponent, visible: boolean) => {
        set((state) => withComponentVisibility(state, component, visible));
    },

    setComponentColor: (component: BunnyComponent, color: string) => {
        set((state) => {
            const newComponentColors = { ...state.componentColors, [component]: color };
            const logs = withLog(state, 'component',
                        'COLOR',
                        `${component} → ${color}`);
            return { componentColors: newComponentColors, logs };
        });
    },
    resetComponentColors: () => {
        set((state) => ({
            componentColors: initialComponentColors(),
            logs: withLog(state, 'component', 'RESET_COLORS', 'Todos los colores restablecidos'),
        }));
    },

    playAnimation: (animation: BunnyAnimation) => {
        set((state) => {
            const logs = withLog(state, 'animation',
                        'PLAY',
                        `Reproduciendo: ${animation}`);
            // La animación única es autoritativa: se limpia cualquier blend/expresión
            // residual para que la ruta SINGLE del efecto de reproducción tenga prioridad
            // (evita que un blendQueue del sistema de expresiones silencie la animación).
            return {
                currentAnimation: animation,
                isPlaying: true,
                blendQueue: [],
                currentExpression: null,
                logs,
            };
        });
    },

    stopAnimation: () => {
        set((state) => {
            const logs = withLog(state, 'animation', 'STOP', 'Animación detenida');
            return { currentAnimation: null, isPlaying: false, logs };
        });
    },

    setSignal: (signal: AvatarSignal) => {
        set((state) => {
            const logs = withLog(state, 'signal', 'SET', `Señal: ${signal}`);
            return { currentSignal: signal, logs };
        });
    },

    setDecoration: (decoration: string | null) => {
        set((state) => {
            const logs = withLog(state, 'decoration', 'SET', `Decoración: ${decoration ?? 'ninguna'}`);
            return { activeDecoration: decoration, logs };
        });
    },

    setState: (state: AvatarState) => {
        set((current) => {
            const logs = current.logsEnabled
                ? [
                    ...current.logs,
                    makeLog('state', 'TRANSITION', `${current.currentState} → ${state}`),
                ]
                : current.logs;
            return { currentState: state, logs };
        });
    },

    toggleLogs: () => {
        set((state) => {
            const enabled = !state.logsEnabled;
            return {
                logsEnabled: enabled,
                // El toggle SIEMPRE asienta el cambio, incluso al apagar.
                logs: withLog(
                    { logs: state.logs, logsEnabled: true },
                    'system',
                    'LOGS_TOGGLE',
                    `Logs ${enabled ? 'activados' : 'desactivados'}`,
                ),
            };
        });
    },

    clearLogs: () => {
        set({ logs: [] });
    },

    addLog: (entry: BunnyLogEntry) => {
        set((state) => ({
            logs: [...state.logs, entry],
        }));
    },

    reset: () => {
        set({ ...initialState, logs: [] });
    },

    // ---- OS3 Integration Methods ----

    setExpression: (expression: string) => {
        set((state) => {
            // 🚀 GUARD: Si ya estamos en esta expresión, NO actualizar nada.
            // Esto evita recargas innecesarias de animaciones FBX cada ~10s
            // causadas por idleMicroExpressions que re-aplican "atencion"
            // cuando el avatar ya está mostrando esa expresión.
            if (state.currentExpression === expression) {
                return {}; // ← no-op: evita re-render y recarga de animación
            }
            const logs = withLog(state, 'animation', 'EXPRESSION', `Expresión: ${expression}`);
            // Look up expression in EXPRESSION_MAP to set currentAnimation
            // so BunnyViewer can pick it up via its subscription
            const anims = EXPRESSION_MAP[expression];
            const firstAnim = anims && anims.length > 0 ? anims[0] : state.currentAnimation;
            const blendQueueStr = JSON.stringify(anims || []);
            relayLog('LOG', 'bunnyStore', `setExpression("${expression}") → anims=${blendQueueStr}, firstAnim=${firstAnim}`);
            return {
                currentExpression: expression,
                currentAnimation: firstAnim,
                // ALSO populate blendQueue with ALL animations from EXPRESSION_MAP,
                // so BunnyViewer can load and play multiple animations simultaneously
                // (e.g., Idle_2 + MouthMove for 'hablando' expression).
                blendQueue: anims || ([] as BunnyAnimation[]),
                isPlaying: true,
                logs,
            };
        });
    },

    clearExpression: () => {
        set((state) => {
            const logs = withLog(state, 'animation', 'CLEAR_EXPRESSION', 'Expresión limpiada');
            return { currentExpression: null, logs };
        });
    },

    blendAnimation: (anims: BunnyAnimation[]) => {
        set((state) => {
            // 🚀 GUARD: Si el blendQueue ya contiene exactamente estas animaciones,
            // no actualizar nada. Esto evita recargas innecesarias de animaciones
            // FBX cuando idleMicroExpressions re-aplica las mismas animaciones.
            const currentQueueStr = JSON.stringify(state.blendQueue || []);
            const newQueueStr = JSON.stringify(anims);
            if (currentQueueStr === newQueueStr && state.isPlaying) {
                return {}; // ← no-op: misma cola de animaciones, no recargar
            }
            const logs = withLog(state, 'animation', 'BLEND', `Mezcla: [${anims.join(', ')}]`);
            const animsStr = anims.join(', ');
            relayLog('LOG', 'bunnyStore', `blendAnimation([${animsStr}]) → currentAnimation=${anims.length > 0 ? anims[0] : state.currentAnimation}`);
            return {
                blendQueue: anims,
                currentAnimation: anims.length > 0 ? anims[0] : state.currentAnimation,
                isPlaying: anims.length > 0,
                logs,
            };
        });
    },

    setAnimationSpeed: (speed: number) => {
        set((state) => {
            const logs = withLog(state, 'animation', 'SPEED', `Velocidad: ${speed}`);
            return { ...state, animationSpeed: speed, logs };
        });
    },
}));

/**
 * Fuerza la visibilidad y un color válido de `Bunny_pants` al arrancar.
 * Es determinista y síncrono: el store de Zustand es síncrono (sin persist),
 * por lo que `getState()` está disponible inmediatamente — no se requieren timers.
 * Reemplaza el parche previo de `setTimeout(1000ms)` en App.tsx (Rule #2: NO PARCHES).
 */
export function ensureAvatarPantsVisible(): void {
    try {
        const state = useBunnyStore.getState();
        if (state.components && state.components.Bunny_pants === false) {
            state.setComponentVisibility('Bunny_pants', true);
        }
        const pantsColor = state.componentColors?.Bunny_pants;
        if (pantsColor) {
            const colorLower = pantsColor.toLowerCase();
            if (colorLower === '#ffffff' || colorLower === 'white' || colorLower === '#fff' ||
                colorLower === 'transparent' || colorLower === 'rgba(255,255,255,0)') {
                state.setComponentColor('Bunny_pants', '#8B4513');
            }
        }
    } catch (error) {
        logCaughtError('[Avatar Init] Could not check avatar pants', error);
    }
}

// Exponer bunnyStore globalmente para E2E tests
if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__bunnyStore = useBunnyStore;
}
