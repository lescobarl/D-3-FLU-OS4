// ============================================================
// Autonomy Systems Index — Exportación Unificada
// ============================================================
// Exporta todos los sistemas de autonomía para facilitar
// la integración con la aplicación principal.
// ============================================================

// Health Monitor
import {
    HealthMonitor,
    getHealthMonitor,
    startGlobalHealthMonitoring,
    stopGlobalHealthMonitoring,
    getSystemHealth,
    type SystemHealth,
    type HealthStatus,
    type ComponentHealth,
    type HealthMonitorConfig,
    DEFAULT_HEALTH_CONFIG,
} from './healthMonitor';

// Auto Recovery
import {
    AutoRecoverySystem,
    getAutoRecoverySystem,
    startGlobalAutoRecovery,
    type RecoveryResult,
    type RecoveryAction,
    type RecoveryRule,
    type AutoRecoveryConfig,
    DEFAULT_RECOVERY_CONFIG,
} from './autoRecovery';

// Decision Engine
import {
    DecisionEngine,
    getDecisionEngine,
    startGlobalDecisionEngine,
    stopGlobalDecisionEngine,
    getRecentAutonomousDecisions,
    type AutonomousDecision,
    type DecisionType,
    type DecisionEngineConfig,
    DEFAULT_DECISION_CONFIG,
} from './decisionEngine';

// Auto Optimization
import {
    AutoOptimizationSystem,
    getAutoOptimizationSystem,
    startGlobalAutoOptimization,
    stopGlobalAutoOptimization,
    getCurrentParameterValues,
    type OptimizableParameter,
    type OptimizationResult,
    type AutoOptimizationConfig,
    DEFAULT_OPTIMIZATION_CONFIG,
} from './autoOptimization';

// Backup System
import {
    BackupSystem,
    getBackupSystem,
    startGlobalBackupSystem,
    stopGlobalBackupSystem,
    createEmergencyBackup,
    restoreFromLatestBackup,
    type BackupMetadata,
    type RestoreResult,
    type BackupSystemConfig,
    DEFAULT_BACKUP_CONFIG,
} from './backupSystem';

// Re-export everything
export {
    HealthMonitor,
    getHealthMonitor,
    startGlobalHealthMonitoring,
    stopGlobalHealthMonitoring,
    getSystemHealth,
    type SystemHealth,
    type HealthStatus,
    type ComponentHealth,
    type HealthMonitorConfig,
    DEFAULT_HEALTH_CONFIG,
};

export {
    AutoRecoverySystem,
    getAutoRecoverySystem,
    startGlobalAutoRecovery,
    type RecoveryResult,
    type RecoveryAction,
    type RecoveryRule,
    type AutoRecoveryConfig,
    DEFAULT_RECOVERY_CONFIG,
};

export {
    DecisionEngine,
    getDecisionEngine,
    startGlobalDecisionEngine,
    stopGlobalDecisionEngine,
    getRecentAutonomousDecisions,
    type AutonomousDecision,
    type DecisionType,
    type DecisionEngineConfig,
    DEFAULT_DECISION_CONFIG,
};

export {
    AutoOptimizationSystem,
    getAutoOptimizationSystem,
    startGlobalAutoOptimization,
    stopGlobalAutoOptimization,
    getCurrentParameterValues,
    type OptimizableParameter,
    type OptimizationResult,
    type AutoOptimizationConfig,
    DEFAULT_OPTIMIZATION_CONFIG,
};

export {
    BackupSystem,
    getBackupSystem,
    startGlobalBackupSystem,
    stopGlobalBackupSystem,
    createEmergencyBackup,
    restoreFromLatestBackup,
    type BackupMetadata,
    type RestoreResult,
    type BackupSystemConfig,
    DEFAULT_BACKUP_CONFIG,
};

// Integration Hook
export {
    useAutonomyIntegration,
    type AutonomyState,
    type AutonomyNotification,
    type AutonomyActions,
} from './useAutonomyIntegration';

// UI Components
export { AutonomyStatusPanel } from './AutonomyStatusPanel';

// -----------------------------------------------------------
// Inicialización de todos los sistemas
// -----------------------------------------------------------

/**
 * Inicializa todos los sistemas de autonomía con configuraciones por defecto.
 * Esta función debe llamarse al inicio de la aplicación.
 */
export function initializeAllAutonomySystems(): {
    healthMonitor: any;
    recoverySystem: any;
    decisionEngine: any;
    optimizationSystem: any;
    backupSystem: any;
} {
    try {
        console.log('Inicializando sistemas de autonomía...');
        
        // Inicializar Health Monitor
        const healthMonitor = startGlobalHealthMonitoring({
            verboseLogging: false,
            monitoringInterval: 30000,
        });
        
        // Inicializar Auto Recovery
        const recoverySystem = startGlobalAutoRecovery({
            verboseLogging: false,
            userNotificationMode: 'toast',
        });
        
        // Inicializar Decision Engine
        const decisionEngine = startGlobalDecisionEngine({
            verboseLogging: false,
            considerEcologicalFactors: true,
            considerCostFactors: true,
        });
        
        // Inicializar Auto Optimization
        const optimizationSystem = startGlobalAutoOptimization({
            verboseLogging: false,
            enabled: true,
        });
        
        // Inicializar Backup System
        const backupSystem = startGlobalBackupSystem({
            verboseLogging: false,
            enabled: true,
        });
        
        // Conectar sistemas entre sí
        recoverySystem.setHealthMonitor(healthMonitor);
        
        console.log('Sistemas de autonomía inicializados exitosamente');
        
        return {
            healthMonitor,
            recoverySystem,
            decisionEngine,
            optimizationSystem,
            backupSystem,
        };
    } catch (error) {
        console.error('Error inicializando sistemas de autonomía:', error);
        throw error;
    }
}

/**
 * Detiene todos los sistemas de autonomía.
 * Esta función debe llamarse al cerrar la aplicación.
 */
export function stopAllAutonomySystems(): void {
    try {
        console.log('Deteniendo sistemas de autonomía...');
        
        stopGlobalHealthMonitoring();
        stopGlobalDecisionEngine();
        stopGlobalAutoOptimization();
        stopGlobalBackupSystem();
        
        console.log('Sistemas de autonomía detenidos');
    } catch (error) {
        console.error('Error deteniendo sistemas de autonomía:', error);
    }
}

/**
 * Obtiene el estado consolidado de todos los sistemas de autonomía.
 */
export function getConsolidatedAutonomyStatus(): {
    overallStatus: 'healthy' | 'degraded' | 'critical' | 'unknown';
    systems: Array<{
        name: string;
        status: string;
        enabled: boolean;
        lastCheck?: number;
    }>;
    recommendations: string[];
} {
    const systems = [];
    const recommendations = [];
    
    try {
        // Obtener estado del Health Monitor
        const health = getSystemHealth();
        if (health) {
            systems.push({
                name: 'health-monitor',
                status: health.overallStatus,
                enabled: true,
                lastCheck: health.timestamp,
            });
            
            if (health.overallStatus === 'critical' || health.overallStatus === 'unhealthy') {
                recommendations.push(...health.recommendations);
            }
        }
        
        // Verificar otros sistemas (simplificado)
        systems.push(
            { name: 'auto-recovery', status: 'active', enabled: true },
            { name: 'decision-engine', status: 'active', enabled: true },
            { name: 'auto-optimization', status: 'active', enabled: true },
            { name: 'backup-system', status: 'active', enabled: true },
        );
        
        // Determinar estado general
        const criticalSystems = systems.filter(s => s.status === 'critical').length;
        const unhealthySystems = systems.filter(s => s.status === 'unhealthy').length;
        
        let overallStatus: 'healthy' | 'degraded' | 'critical' | 'unknown' = 'unknown';
        
        if (criticalSystems > 0) {
            overallStatus = 'critical';
        } else if (unhealthySystems > 0) {
            overallStatus = 'degraded';
        } else if (systems.every(s => s.status === 'healthy' || s.status === 'active')) {
            overallStatus = 'healthy';
        }
        
        return {
            overallStatus,
            systems,
            recommendations,
        };
    } catch (error) {
        console.error('Error obteniendo estado de autonomía:', error);
        return {
            overallStatus: 'unknown',
            systems: [],
            recommendations: ['Error obteniendo estado de sistemas de autonomía'],
        };
    }
}