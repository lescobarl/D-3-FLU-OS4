// ============================================================
// Autonomy Systems Index — Exportación Unificada
// ------------------------------------------------------------
// Una sola re-exportación por módulo: sin listas de import repetidas.
// ============================================================

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
} from './healthMonitor';

export {
    AutoRecoverySystem,
    getAutoRecoverySystem,
    startGlobalAutoRecovery,
    type RecoveryResult,
    type RecoveryAction,
    type RecoveryRule,
    type AutoRecoveryConfig,
    DEFAULT_RECOVERY_CONFIG,
} from './autoRecovery';

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
} from './decisionEngine';

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
} from './autoOptimization';

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
} from './backupSystem';

export {
    useAutonomyIntegration,
    type AutonomyState,
    type AutonomyNotification,
    type AutonomyActions,
} from './useAutonomyIntegration';

export { AutonomyStatusPanel } from './AutonomyStatusPanel';
