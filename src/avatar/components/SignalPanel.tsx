// ============================================================
// SignalPanel — Botones de Señales Visuales del Avatar
// ============================================================
// Cada botón activa una señal overlay sobre el modelo 3D.
// ============================================================

import { useBunnyStore } from '../store/bunnyStore';
import type { AvatarSignal } from '../types/bunny';

// -----------------------------------------------------------
// Definición de señales visuales
// -----------------------------------------------------------

interface SignalDef {
    id: AvatarSignal;
    label: string;
    icon: string;
    color: string;
    description: string;
}

const SIGNALS: SignalDef[] = [
    { id: 'WAVE', label: 'Wave', icon: '🎤', color: '#00ff88', description: 'Onda de sonido (escuchando)' },
    { id: 'THINK', label: 'Think', icon: '⚙️', color: '#ffaa00', description: 'Engranaje (pensando)' },
    { id: 'HIGHLIGHT', label: 'Highlight', icon: '✨', color: '#00aaff', description: 'Resplandor (hablando)' },
    { id: 'ALERT', label: 'Alert', icon: '❗', color: '#ff4444', description: 'Alerta' },
    { id: 'CELEBRATE', label: 'Celebrate', icon: '🎉', color: '#ff66ff', description: 'Confeti (logro)' },
    { id: 'NONE', label: 'None', icon: '⭕', color: '#666', description: 'Sin señal' },
];

// -----------------------------------------------------------
// SignalPanel
// -----------------------------------------------------------

export default function SignalPanel() {
    const currentSignal = useBunnyStore((s) => s.currentSignal);
    const setSignal = useBunnyStore((s) => s.setSignal);

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-icon">💡</span>
                <span className="panel-title">SEÑALES VISUALES</span>
            </div>
            <div className="panel-body">
                <div className="signals-grid">
                    {SIGNALS.map((sig) => {
                        const isActive = currentSignal === sig.id;
                        return (
                            <button
                                key={sig.id}
                                className={`btn-signal ${isActive ? 'active' : ''}`}
                                onClick={() => setSignal(sig.id)}
                                title={sig.description}
                                data-signal={sig.id}
                                style={{
                                    '--signal-color': sig.color,
                                    borderColor: isActive ? sig.color : 'transparent',
                                } as React.CSSProperties}
                            >
                                <span className="btn-icon">{sig.icon}</span>
                                <span className="btn-label">{sig.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
