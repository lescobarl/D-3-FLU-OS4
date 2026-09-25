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
