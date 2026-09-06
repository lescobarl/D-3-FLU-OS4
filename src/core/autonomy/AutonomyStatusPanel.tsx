// ============================================================
// Autonomy Status Panel — Componente de UI para Estado de Autonomía
// ============================================================
// Muestra el estado de todos los sistemas de autonomía
// y permite interacción con ellos.
// ============================================================

import React from 'react';
import type { AutonomyState, AutonomyActions } from './useAutonomyIntegration';

export function AutonomyStatusPanel({
    state,
    actions,
}: {
    state: AutonomyState;
    actions: AutonomyActions;
}) {
    
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'active': return '#22c55e';
            case 'degraded': return '#f59e0b';
            case 'critical': return '#ef4444';
            case 'disabled': return '#6b7280';
            default: return '#6b7280';
        }
    };
    
    const getStatusText = (status: string) => {
        switch (status) {
            case 'active': return 'Activo';
            case 'degraded': return 'Rendimiento reducido';
            case 'critical': return 'Crítico';
            case 'disabled': return 'Desactivado';
            case 'initializing': return 'Inicializando...';
            default: return 'Desconocido';
        }
    };
    
    return (
        <div className="flu-autonomy-panel">
            <div className="flu-autonomy-panel__header">
                <div
                    className="flu-autonomy-panel__status"
                    style={{ color: getStatusColor(state.status) }}
                >
                    {getStatusText(state.status)}
                </div>
            </div>
            
            <div className="flu-autonomy-panel__systems">
                <div className="flu-autonomy-panel__system">
                    <span className="flu-autonomy-panel__system-name">Health Monitor</span>
                    <div className={`flu-autonomy-panel__system-status ${state.activeSystems.healthMonitor ? 'active' : 'inactive'}`}>
                        {state.activeSystems.healthMonitor ? '●' : '○'}
                    </div>
                </div>
                
                <div className="flu-autonomy-panel__system">
                    <span className="flu-autonomy-panel__system-name">Auto Recovery</span>
                    <div className={`flu-autonomy-panel__system-status ${state.activeSystems.autoRecovery ? 'active' : 'inactive'}`}>
                        {state.activeSystems.autoRecovery ? '●' : '○'}
                    </div>
                </div>
                
                <div className="flu-autonomy-panel__system">
                    <span className="flu-autonomy-panel__system-name">Decision Engine</span>
                    <div className={`flu-autonomy-panel__system-status ${state.activeSystems.decisionEngine ? 'active' : 'inactive'}`}>
                        {state.activeSystems.decisionEngine ? '●' : '○'}
                    </div>
                </div>
                
                <div className="flu-autonomy-panel__system">
                    <span className="flu-autonomy-panel__system-name">Auto Optimization</span>
                    <div className={`flu-autonomy-panel__system-status ${state.activeSystems.autoOptimization ? 'active' : 'inactive'}`}>
                        {state.activeSystems.autoOptimization ? '●' : '○'}
                    </div>
                </div>
                
                <div className="flu-autonomy-panel__system">
                    <span className="flu-autonomy-panel__system-name">Backup System</span>
                    <div className={`flu-autonomy-panel__system-status ${state.activeSystems.backupSystem ? 'active' : 'inactive'}`}>
                        {state.activeSystems.backupSystem ? '●' : '○'}
                    </div>
                </div>
            </div>
            
            {state.healthMetrics && (
                <div className="flu-autonomy-panel__health">
                    <div className="flu-autonomy-panel__health-title">Salud del Sistema</div>
                    <div className="flu-autonomy-panel__health-metrics">
                        <div className="flu-autonomy-panel__health-metric">
                            <span>Disponibilidad:</span>
                            <span>{Math.round((state.healthMetrics.aggregatedMetrics.availability || 0) * 100)}%</span>
                        </div>
                        <div className="flu-autonomy-panel__health-metric">
                            <span>Tiempo de respuesta:</span>
                            <span>{Math.round(state.healthMetrics.aggregatedMetrics.avgResponseTime || 0)}ms</span>
                        </div>
                        <div className="flu-autonomy-panel__health-metric">
                            <span>Tasa de error:</span>
                            <span>{Math.round((state.healthMetrics.aggregatedMetrics.errorRate || 0) * 100)}%</span>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="flu-autonomy-panel__actions">
                <button 
                    className="flu-btn flu-btn--secondary"
                    onClick={() => actions.forceHealthCheck()}
                >
                    Verificar Salud
                </button>
                <button 
                    className="flu-btn flu-btn--secondary"
                    onClick={() => actions.createManualBackup()}
                >
                    Crear Backup
                </button>
                <button 
                    className="flu-btn flu-btn--secondary"
                    onClick={() => actions.runManualOptimization()}
                >
                    Optimizar
                </button>
            </div>
            
            {state.notifications.length > 0 && (
                <div className="flu-autonomy-panel__notifications">
                    <div className="flu-autonomy-panel__notifications-title">
                        Notificaciones ({state.notifications.filter(n => !n.read).length})
                    </div>
                    <div className="flu-autonomy-panel__notifications-list">
                        {state.notifications.slice(0, 3).map(notification => (
                            <div 
                                key={notification.id} 
                                className={`flu-autonomy-panel__notification flu-autonomy-panel__notification--${notification.type} ${notification.read ? 'read' : ''}`}
                                onClick={() => actions.markNotificationAsRead(notification.id)}
                            >
                                <div className="flu-autonomy-panel__notification-title">{notification.title}</div>
                                <div className="flu-autonomy-panel__notification-message">{notification.message}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}