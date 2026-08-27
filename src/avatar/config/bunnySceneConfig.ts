// ============================================================
// bunnySceneConfig — Configuración de escena 3D del avatar FLU
// ============================================================
// Valores de escena centralizados: cámara, fondo, luces, órbita,
// señales visuales y colores de estado. Es el ÚNICO lugar para
// ajustar el look & feel 3D sin tocar el componente.
//
// NO es un parche: son valores de configuración del wrapper 3D
// (BunnyViewer.tsx). Los assets 3D (animaciones, texturas,
// componentes) viven en src/avatar/model/.
// ============================================================

// -----------------------------------------------------------
// Cámara y fondo
// -----------------------------------------------------------
export const BUNNY_SCENE = {
    camera: {
        position: [0, 0.8, 3.5] as [number, number, number],
        fov: 40,
    },
    background: '#1a1a2e',
    /** Rotación del modelo en radianes sobre el eje Y (≈ 30°) */
    orientationDefault: 0.525,
};

// -----------------------------------------------------------
// Luces (calibradas para three r155+ — iluminación física)
// -----------------------------------------------------------
export const BUNNY_LIGHTS = {
    ambient: 1.2,
    directional: {
        main: { position: [5, 8, 5] as [number, number, number], intensity: 3.2 },
        fill: { position: [-5, 3, -5] as [number, number, number], intensity: 1.2 },
    },
    hemisphere: { sky: '#87ceeb', ground: '#444', intensity: 1.0 },
};

// -----------------------------------------------------------
// Controles de órbita
// -----------------------------------------------------------
export const BUNNY_ORBIT = {
    enablePan: true,
    enableZoom: true,
    enableRotate: true,
    minDistance: 0.5,
    maxDistance: 50,
    autoRotate: false,
    target: [0, 0, 0] as [number, number, number],
};

// -----------------------------------------------------------
// Señales visuales (SignalOverlay)
// -----------------------------------------------------------
export const BUNNY_SIGNAL_OVERLAY = {
    position: [0, 3.5, 0] as [number, number, number],
    fontSize: '48px',
    pulse: 'pulse 1s ease-in-out infinite',
    signals: {
        WAVE: { icon: '🎤', color: '#00ff88' },
        THINK: { icon: '⚙️', color: '#ffaa00' },
        HIGHLIGHT: { icon: '✨', color: '#00aaff' },
        ALERT: { icon: '❗', color: '#ff4444' },
        CELEBRATE: { icon: '🎉', color: '#ff66ff' },
    } as Record<string, { icon: string; color: string }>,
};

// -----------------------------------------------------------
// Indicador de estado (StateIndicator)
// -----------------------------------------------------------
export const BUNNY_STATE_INDICATOR = {
    position: [0, -2.5, 0] as [number, number, number],
    background: 'rgba(0,0,0,0.7)',
    fallbackColor: '#fff',
    colors: {
        IDLE: '#888',
        LISTENING: '#00ff88',
        THINKING: '#ffaa00',
        SPEAKING: '#00aaff',
        ERROR: '#ff4444',
        SLEEPING: '#4444aa',
        CELEBRATING: '#ff66ff',
        COMPUTING: '#00ffff',
    } as Record<string, string>,
};
