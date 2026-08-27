// ============================================================
// AnimationPanel — Botones de Animaciones de Bunny
// ============================================================
// Cada botón dispara una animación del personaje.
// Los nombres son exactamente los de los archivos FBX.
// ============================================================

import { useBunnyStore } from '../store/bunnyStore';
import type { BunnyAnimation } from '../types/bunny';

// -----------------------------------------------------------
// Definición de animaciones agrupadas por categoría
// -----------------------------------------------------------

interface AnimDef {
    id: BunnyAnimation;
    label: string;
    icon: string;
    category: 'idle' | 'locomotion' | 'facial' | 'action' | 'celebrate';
    description: string;
}

const ANIMATIONS: AnimDef[] = [
    // --- Idle ---
    { id: 'Idle_1', label: 'Idle 1', icon: '😐', category: 'idle', description: 'Reposo variante 1' },
    { id: 'Idle_2', label: 'Idle 2', icon: '😶', category: 'idle', description: 'Reposo variante 2' },
    { id: 'Idle_3', label: 'Idle 3', icon: '😑', category: 'idle', description: 'Reposo variante 3' },
    { id: 'Bind-pose', label: 'Bind Pose', icon: '🧘', category: 'idle', description: 'Pose base de referencia' },

    // --- Locomoción ---
    { id: 'Walk', label: 'Walk', icon: '🚶', category: 'locomotion', description: 'Caminar' },
    { id: 'Walk_sneaky', label: 'Walk Sneaky', icon: '🥷', category: 'locomotion', description: 'Caminar sigiloso' },
    { id: 'Run', label: 'Run', icon: '🏃', category: 'locomotion', description: 'Correr' },
    { id: 'Jump_in_place', label: 'Jump in Place', icon: '⬆️', category: 'locomotion', description: 'Saltar en el lugar' },
    { id: 'Jump_while_run', label: 'Jump While Run', icon: '🏃‍♂️', category: 'locomotion', description: 'Saltar mientras corre' },

    // --- Faciales ---
    { id: 'Emo_blink', label: 'Blink', icon: '😉', category: 'facial', description: 'Parpadeo de ojos' },
    { id: 'Emo_mouth_open', label: 'Mouth Open', icon: '😮', category: 'facial', description: 'Abrir boca (hablar)' },
    { id: 'Emo_neutral', label: 'Neutral', icon: '😐', category: 'facial', description: 'Expresión neutral' },

    // --- Acciones ---
    { id: 'Cap_back', label: 'Cap Back', icon: '🧢⬅️', category: 'action', description: 'Gorra hacia atrás' },
    { id: 'Cap_front', label: 'Cap Front', icon: '🧢➡️', category: 'action', description: 'Gorra hacia adelante' },

    // --- Celebración ---
    { id: 'Dance', label: 'Dance', icon: '💃', category: 'celebrate', description: 'Bailar (celebración)' },
];

// -----------------------------------------------------------
// Categorías para agrupar visualmente
// -----------------------------------------------------------

const CATEGORIES: Record<string, { label: string; color: string }> = {
    idle: { label: 'Reposo', color: '#555' },
    locomotion: { label: 'Locomoción', color: '#2d7d46' },
    facial: { label: 'Faciales', color: '#7d4e2d' },
    action: { label: 'Acciones', color: '#2d4e7d' },
    celebrate: { label: 'Celebración', color: '#7d2d6b' },
};

// -----------------------------------------------------------
// AnimationPanel
// -----------------------------------------------------------

export default function AnimationPanel() {
    const currentAnimation = useBunnyStore((s) => s.currentAnimation);
    const isPlaying = useBunnyStore((s) => s.isPlaying);
    const playAnimation = useBunnyStore((s) => s.playAnimation);
    const stopAnimation = useBunnyStore((s) => s.stopAnimation);

    // Agrupar por categoría
    const grouped = ANIMATIONS.reduce(
        (acc, anim) => {
            if (!acc[anim.category]) acc[anim.category] = [];
            acc[anim.category].push(anim);
            return acc;
        },
        {} as Record<string, AnimDef[]>,
    );

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-icon">🎬</span>
                <span className="panel-title">ANIMACIONES</span>
                {isPlaying && (
                    <button className="btn-stop-all" onClick={stopAnimation}>
                        ⏹ DETENER
                    </button>
                )}
            </div>
            <div className="panel-body">
                {Object.entries(grouped).map(([cat, anims]) => (
                    <div key={cat} className="anim-category">
                        <div
                            className="category-label"
                            style={{ color: CATEGORIES[cat]?.color || '#888' }}
                        >
                            {CATEGORIES[cat]?.label || cat}
                        </div>
                        <div className="anim-grid">
                            {anims.map((anim) => {
                                const isActive = currentAnimation === anim.id && isPlaying;
                                return (
                                    <button
                                        key={anim.id}
                                        className={`btn-animation ${isActive ? 'active' : ''}`}
                                        onClick={() => playAnimation(anim.id)}
                                        disabled={isPlaying && !isActive}
                                        title={anim.description}
                                        data-animation={anim.id}
                                    >
                                        <span className="btn-icon">{anim.icon}</span>
                                        <span className="btn-label">{anim.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
