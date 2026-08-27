// ============================================================
// LogPanel — Panel de Logs con Toggle ON/OFF
// ============================================================
// Muestra un historial detallado de todas las acciones.
// El toggle permite activar/desactivar la captura de logs
// para no afectar el rendimiento de la aplicación.
// ============================================================

import { useRef, useEffect } from 'react';
import { useBunnyStore } from '../store/bunnyStore';

// -----------------------------------------------------------
// Colores por tipo de log
// -----------------------------------------------------------

const LOG_COLORS: Record<string, string> = {
    component: '#4ecdc4',
    animation: '#ffe66d',
    signal: '#ff6b6b',
    state: '#a8e6cf',
    system: '#aaa',
};

// -----------------------------------------------------------
// LogPanel
// -----------------------------------------------------------

export default function LogPanel() {
    const logsEnabled = useBunnyStore((s) => s.logsEnabled);
    const logs = useBunnyStore((s) => s.logs);
    const toggleLogs = useBunnyStore((s) => s.toggleLogs);
    const clearLogs = useBunnyStore((s) => s.clearLogs);

    const logEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll al último log
    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    return (
        <div className="panel log-panel">
            <div className="panel-header">
                <span className="panel-icon">📋</span>
                <span className="panel-title">LOGS</span>
                <div className="log-controls">
                    <button
                        className={`btn-log-toggle ${logsEnabled ? 'active' : ''}`}
                        onClick={toggleLogs}
                        title={logsEnabled ? 'Desactivar logs' : 'Activar logs'}
                    >
                        <span className="toggle-track">
                            <span className={`toggle-thumb ${logsEnabled ? 'on' : 'off'}`} />
                        </span>
                        <span className="toggle-label">
                            {logsEnabled ? 'LOGS ON' : 'LOGS OFF'}
                        </span>
                    </button>
                    {logs.length > 0 && (
                        <button className="btn-clear-logs" onClick={clearLogs} title="Limpiar logs">
                            🗑️
                        </button>
                    )}
                </div>
            </div>
            <div className="panel-body log-body">
                {logs.length === 0 ? (
                    <div className="log-empty">
                        {logsEnabled
                            ? 'Esperando eventos...'
                            : 'Logs desactivados. Actívalos con el toggle.'}
                    </div>
                ) : (
                    <div className="log-list">
                        {logs.map((log, i) => (
                            <div key={i} className="log-entry">
                                <span className="log-time">
                                    {log.timestamp.split('T')[1]?.split('.')[0] || log.timestamp}
                                </span>
                                <span
                                    className="log-type"
                                    style={{ color: LOG_COLORS[log.type] || '#fff' }}
                                >
                                    [{log.type.toUpperCase()}]
                                </span>
                                <span className="log-action">{log.action}</span>
                                <span className="log-detail">{log.detail}</span>
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}
