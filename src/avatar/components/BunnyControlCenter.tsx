// ============================================================
// BunnyControlCenter — Pantalla Principal de Control de Bunny
// ============================================================
// Punto de entrada del módulo. Integra el visor 3D, los
// paneles de componentes, animaciones, señales, controles
// del rig y logs.
// ============================================================

import BunnyViewer from './BunnyViewer';
import ComponentPanel from './ComponentPanel';
import AnimationPanel from './AnimationPanel';
import SignalPanel from './SignalPanel';
import ControlsPanel from './ControlsPanel';
import LogPanel from './LogPanel';
import { useBunnyStore } from '../store/bunnyStore';

// -----------------------------------------------------------
// BunnyControlCenter
// -----------------------------------------------------------

export default function BunnyControlCenter() {
    const currentState = useBunnyStore((s) => s.currentState);
    const currentAnimation = useBunnyStore((s) => s.currentAnimation);
    const isPlaying = useBunnyStore((s) => s.isPlaying);
    const currentSignal = useBunnyStore((s) => s.currentSignal);
    const reset = useBunnyStore((s) => s.reset);

    return (
        <div className="bunny-control-center">
            {/* Header */}
            <header className="bcc-header">
                <div className="bcc-header-left">
                    <h1 className="bcc-title">
                        🐰 Bunny Control Center
                    </h1>
                    <span className="bcc-subtitle">FLU OS 2.0 — Avatar Console</span>
                </div>
                <div className="bcc-header-right">
                    <div className="bcc-status-bar">
                        <span className="status-item">
                            Estado: <strong style={{ color: getStateColor(currentState) }}>{currentState}</strong>
                        </span>
                        <span className="status-item">
                            Animación:{' '}
                            <strong>
                                {isPlaying && currentAnimation ? currentAnimation : '—'}
                            </strong>
                        </span>
                        <span className="status-item">
                            Señal: <strong>{currentSignal}</strong>
                        </span>
                    </div>
                    <button className="btn-reset" onClick={reset} title="Resetear todo">
                        🔄 Reset
                    </button>
                </div>
            </header>

            {/* Main Layout */}
            <div className="bcc-main">
                {/* Left: 3D Viewer */}
                <section className="bcc-viewer">
                    <BunnyViewer />
                </section>

                {/* Right: Control Panels (scrollable) */}
                <aside className="bcc-controls">
                    <ComponentPanel />
                    <AnimationPanel />
                    <SignalPanel />
                    <ControlsPanel />
                </aside>
            </div>

            {/* Bottom: Logs */}
            <footer className="bcc-footer">
                <LogPanel />
            </footer>
        </div>
    );
}

// -----------------------------------------------------------
// Helper
// -----------------------------------------------------------

function getStateColor(state: string): string {
    const colors: Record<string, string> = {
        IDLE: '#888',
        LISTENING: '#00ff88',
        THINKING: '#ffaa00',
        SPEAKING: '#00aaff',
        ERROR: '#ff4444',
        SLEEPING: '#4444aa',
        CELEBRATING: '#ff66ff',
        COMPUTING: '#00ffff',
    };
    return colors[state] || '#fff';
}
