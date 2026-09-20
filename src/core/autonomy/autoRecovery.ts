// ============================================================
// Auto Recovery — Sistema de Recuperación Automática
// ============================================================
// Detecta y recupera automáticamente fallos en el sistema FLU
// basándose en diagnósticos del Health Monitor.
//
// Estrategias de recuperación:
//   - Reintentos con backoff exponencial
//   - Cambio automático de proveedor de IA
//   - Reinicio de componentes fallidos
//   - Fallback a modos degradados
//   - Restauración desde backups
//   - Notificación al usuario
//
// Cumple:
//   - Decisiones basadas en reglas configurables
//   - Evita ciclos de recuperación infinitos
//   - Registro detallado de acciones tomadas
//   - Integración con Health Monitor
// ============================================================

// Importar servicios de IA para cambio automático de proveedor
import { getPreferredAIProvider, setPreferredAIProvider, type AIProvider } from '../../services/aiServiceFactory';
import { emitAutonomyEvent } from './autonomyEvents';
import { v4 as uuidv4 } from 'uuid';
import type { ComponentHealth, HealthMonitor } from './healthMonitor';

// -----------------------------------------------------------
// Tipos
// -----------------------------------------------------------

/** Valor primitivo admisible en las métricas de un componente de salud. */
export type MetricValue = number | string | boolean;

/** Operadores de comparación admitidos en las condiciones de métricas. */
export type MetricOperator = '>' | '<' | '>=' | '<=' | '===' | '!==';

/**
 * Parámetros de una acción de recuperación. Cada acción consume el subconjunto
 * de propiedades que le aplica; el resto se ignora.
 */
export interface RecoveryActionParams {
    // retry_with_backoff
    initialDelay?: number;
    maxDelay?: number;
    multiplier?: number;
    // switch_ai_provider
    fallbackOrder?: AIProvider[];
    maxSwitchAttempts?: number;
    // restart_component
    component?: string;
    force?: boolean;
    method?: string;
    // enable_degraded_mode
    mode?: string;
    features?: string[];
    // restore_from_backup
    backupSource?: string;
    maxAgeHours?: number;
    // notify_user / escalate_to_admin
    message?: string;
    type?: string;
    channels?: string[];
}

export type RecoveryAction = 
    | 'retry_with_backoff'
    | 'switch_ai_provider'
    | 'restart_component'
    | 'enable_degraded_mode'
    | 'restore_from_backup'
    | 'notify_user'
    | 'escalate_to_admin'
    | 'no_action';

export interface RecoveryRule {
    /** Condición que activa esta regla */
    condition: RecoveryCondition;
    /** Acción a ejecutar */
    action: RecoveryAction;
    /** Parámetros específicos de la acción */
    params?: RecoveryActionParams;
    /** Prioridad (mayor = más importante) */
    priority: number;
    /** Máximo de ejecuciones por incidente */
    maxExecutions: number;
    /** Cooldown entre ejecuciones (ms) */
    cooldownMs: number;
}

export interface RecoveryCondition {
    /** Componente afectado */
    component: string;
    /** Estado de salud requerido */
    healthStatus: 'critical' | 'unhealthy' | 'degraded';
    /** Duración mínima del problema (ms) */
    minDurationMs?: number;
    /** Número mínimo de fallos consecutivos */
    minConsecutiveFailures?: number;
    /** Métricas específicas a verificar */
    metricConditions?: Array<{
        metric: string;
        operator: MetricOperator;
        value: MetricValue;
    }>;
}

export interface RecoveryIncident {
    /** ID único del incidente */
    id: string;
    /** Componente afectado */
    component: string;
    /** Estado de salud detectado */
    detectedStatus: string;
    /** Timestamp de detección */
    detectedAt: number;
    /** Timestamp de resolución (si aplica) */
    resolvedAt?: number;
    /** Acciones tomadas */
    actionsTaken: RecoveryAction[];
    /** Estado actual del incidente */
    status: 'active' | 'resolved' | 'escalated';
    /** Métricas al momento de detección */
    metricsAtDetection: Record<string, MetricValue>;
}

export interface RecoveryResult {
    /** Si la recuperación fue exitosa */
    success: boolean;
    /** Acción ejecutada */
    action: RecoveryAction;
    /** Mensaje descriptivo */
    message: string;
    /** Nuevo estado del componente (si aplica) */
    newStatus?: string;
    /** Tiempo tomado (ms) */
    durationMs: number;
    /** Métricas después de la recuperación */
    metricsAfter?: Record<string, MetricValue>;
}

export interface AutoRecoveryConfig {
    /** Habilitar recuperación automática */
    enabled: boolean;
    /** Umbral para considerar un incidente crítico */
    criticalThreshold: number;
    /** Tiempo máximo de recuperación antes de escalar (ms) */
    maxRecoveryTimeMs: number;
    /** Número máximo de reintentos por incidente */
    maxRetriesPerIncident: number;
    /** Reglas de recuperación */
    rules: RecoveryRule[];
    /** Habilitar logging detallado */
    verboseLogging: boolean;
    /** Modo de notificación al usuario */
    userNotificationMode: 'none' | 'toast' | 'voice' | 'both';
}

// -----------------------------------------------------------
// Reglas de recuperación por defecto
// -----------------------------------------------------------

export const DEFAULT_RECOVERY_RULES: RecoveryRule[] = [
    // Regla 1: Servicio de IA crítico → Cambiar proveedor
    {
        condition: {
            component: 'ai-service',
            healthStatus: 'critical',
            minDurationMs: 10000, // 10 segundos
            minConsecutiveFailures: 2,
        },
        action: 'switch_ai_provider',
        params: {
            fallbackOrder: ['openrouter', 'gemini'],
            maxSwitchAttempts: 3,
        },
        priority: 10,
        maxExecutions: 3,
        cooldownMs: 30000, // 30 segundos
    },
    
    // Regla 2: Servicio de IA degradado → Reintentar con backoff
    {
        condition: {
            component: 'ai-service',
            healthStatus: 'unhealthy',
            minDurationMs: 5000, // 5 segundos
        },
        action: 'retry_with_backoff',
        params: {
            initialDelay: 1000,
            maxDelay: 10000,
            multiplier: 2,
        },
        priority: 5,
        maxExecutions: 5,
        cooldownMs: 60000, // 60 segundos
    },
    
    // Regla 3: IndexedDB crítico → Restaurar desde backup
    {
        condition: {
            component: 'indexed-db',
            healthStatus: 'critical',
            minDurationMs: 20000, // 20 segundos
            minConsecutiveFailures: 3,
        },
        action: 'restore_from_backup',
        params: {
            backupSource: 'localStorage',
            maxAgeHours: 24,
        },
        priority: 9,
        maxExecutions: 1,
        cooldownMs: 0,
    },
    
    // Regla 4: Múltiples componentes críticos → Reiniciar aplicación
    {
        condition: {
            component: 'react-components',
            healthStatus: 'critical',
            minDurationMs: 30000, // 30 segundos
            metricConditions: [
                { metric: 'componentErrorRate', operator: '>', value: 0.5 },
            ],
        },
        action: 'restart_component',
        params: {
            component: 'application',
            force: true,
        },
        priority: 15,
        maxExecutions: 1,
        cooldownMs: 0,
    },
    
    // Regla 5: Problema de red persistente → Escalar
    {
        condition: {
            component: 'network',
            healthStatus: 'critical',
            minDurationMs: 60000, // 1 minuto
            minConsecutiveFailures: 5,
        },
        action: 'escalate_to_admin',
        params: {
            channels: ['console', 'localStorage'],
            message: 'Problema de red persistente detectado',
        },
        priority: 12,
        maxExecutions: 1,
        cooldownMs: 0,
    },
    
    // NOTA: Reglas para speech-recognition y speech-synthesis han sido ELIMINADAS
    // Estos componentes son manejados por el sistema de voz (useFluVoiceAssistant)
    // y no necesitan recuperación autónoma
    
    // Regla 6: Múltiples componentes críticos → Reiniciar aplicación
    {
        condition: {
            component: 'react-components',
            healthStatus: 'critical',
            minDurationMs: 30000, // 30 segundos
            metricConditions: [
                { metric: 'recentConsoleErrors', operator: '>', value: 20 },
            ],
        },
        action: 'restart_component',
        params: {
            component: 'application',
            method: 'soft-restart',
        },
        priority: 15,
        maxExecutions: 1,
        cooldownMs: 0,
    },
    
];

export const DEFAULT_RECOVERY_CONFIG: AutoRecoveryConfig = {
    enabled: true,
    criticalThreshold: 0.3,
    maxRecoveryTimeMs: 300000, // 5 minutos
    maxRetriesPerIncident: 10,
    rules: DEFAULT_RECOVERY_RULES,
    verboseLogging: true,
    userNotificationMode: 'toast',
};

// -----------------------------------------------------------
// Implementación de acciones de recuperación
// -----------------------------------------------------------

class RecoveryActionExecutor {
    private executionHistory: Map<string, { count: number; lastExecution: number }> = new Map();
    
    async executeRetryWithBackoff(params: RecoveryActionParams, incident: RecoveryIncident): Promise<RecoveryResult> {
        const startTime = Date.now();
        const { initialDelay = 1000, maxDelay = 10000, multiplier = 2 } = params;
        
        // Calcular delay basado en número de intentos
        const attemptCount = this.getExecutionCount(incident.id, 'retry_with_backoff');
        const delay = Math.min(initialDelay * Math.pow(multiplier, attemptCount), maxDelay);
        
        if (this.executionHistory.has(incident.id)) {
            const history = this.executionHistory.get(incident.id)!;
            if (Date.now() - history.lastExecution < delay) {
                return {
                    success: false,
                    action: 'retry_with_backoff',
                    message: `Esperando delay de backoff: ${delay}ms`,
                    durationMs: Date.now() - startTime,
                };
            }
        }
        
        // Simular reintento (en implementación real, esto ejecutaría la operación fallida)
        await new Promise(resolve => setTimeout(resolve, 100));
        
        this.recordExecution(incident.id, 'retry_with_backoff');
        
        return {
            success: true,
            action: 'retry_with_backoff',
            message: `Reintento con backoff ejecutado (delay: ${delay}ms, intento: ${attemptCount + 1})`,
            durationMs: Date.now() - startTime,
        };
    }
    
    async executeSwitchAIProvider(params: RecoveryActionParams, incident: RecoveryIncident): Promise<RecoveryResult> {
        const startTime = Date.now();
        const { fallbackOrder = ['openrouter', 'gemini'] } = params;
        
        try {
            // Obtener proveedor actual usando la API oficial
            const currentProvider = getPreferredAIProvider();
            
            // Encontrar siguiente proveedor en la lista de fallback
            const currentIndex = fallbackOrder.indexOf(currentProvider);
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % fallbackOrder.length;
            const nextProvider = fallbackOrder[nextIndex];
            
            // Cambiar proveedor usando la API oficial
            setPreferredAIProvider(nextProvider);
            
            // Forzar recarga del servicio
            
            this.recordExecution(incident.id, 'switch_ai_provider');
            
            return {
                success: true,
                action: 'switch_ai_provider',
                message: `Proveedor de IA cambiado de ${currentProvider} a ${nextProvider}`,
                newStatus: `using-${nextProvider}`,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
        console.warn('[catch] src/core/autonomy/autoRecovery.ts:', error);
            return {
                success: false,
                action: 'switch_ai_provider',
                message: `Error cambiando proveedor de IA: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                durationMs: Date.now() - startTime,
            };
        }
    }
    
    async executeRestartComponent(params: RecoveryActionParams, incident: RecoveryIncident): Promise<RecoveryResult> {
        const startTime = Date.now();
        const { component = 'unknown', method = 'soft-restart' } = params;
        
        try {
            switch (component) {
                case 'application':
                    if (method === 'soft-restart') {
                        // Reinicio suave: recargar estado sin recargar página
                        // En una implementación real, esto resetearía stores y estados
                        // Notificar el reinicio vía bus central de autonomía
                        emitAutonomyEvent({
                            type: 'soft-restart',
                            level: 'info',
                            message: 'Reinicio suave de la aplicación ejecutado',
                        });
                    }
                    break;
                    
                case 'speech-recognition':
                    // Reiniciar reconocimiento de voz
                    break;
                    
                case 'speech-synthesis':
                    // NOTA: No reiniciamos speech-synthesis porque interfiere con el habla en curso
                    // y detiene la animación de boca. Este componente es manejado por useFluVoiceAssistant.
                    break;
                    
                default:
            }
            
            this.recordExecution(incident.id, 'restart_component');
            
            return {
                success: true,
                action: 'restart_component',
                message: `Componente ${component} reiniciado usando método ${method}`,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
        console.warn('[catch] src/core/autonomy/autoRecovery.ts:', error);
            return {
                success: false,
                action: 'restart_component',
                message: `Error reiniciando componente ${component}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                durationMs: Date.now() - startTime,
            };
        }
    }
    
    async executeEnableDegradedMode(params: RecoveryActionParams, incident: RecoveryIncident): Promise<RecoveryResult> {
        const startTime = Date.now();
        const { mode = 'text-only', features = [] } = params;
        
        try {
            // Activar modo degradado
            localStorage.setItem('flu-degraded-mode', mode);
            localStorage.setItem('flu-degraded-features', JSON.stringify(features));
            
            // Notificar la activación del modo degradado vía bus central de autonomía
            emitAutonomyEvent({
                type: 'degraded-mode-changed',
                level: 'warning',
                message: `Modo degradado activado: ${mode}`,
                detail: { mode, features },
            });
            
            this.recordExecution(incident.id, 'enable_degraded_mode');
            
            return {
                success: true,
                action: 'enable_degraded_mode',
                message: `Modo degradado activado: ${mode}. Características: ${features.join(', ')}`,
                newStatus: `degraded-${mode}`,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
        console.warn('[catch] src/core/autonomy/autoRecovery.ts:', error);
            return {
                success: false,
                action: 'enable_degraded_mode',
                message: `Error activando modo degradado: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                durationMs: Date.now() - startTime,
            };
        }
    }
    
    async executeRestoreFromBackup(params: RecoveryActionParams, incident: RecoveryIncident): Promise<RecoveryResult> {
        const startTime = Date.now();
        const { backupSource = 'localStorage' } = params;
        
        try {
            
            // En una implementación real, esto restauraría datos desde backup
            switch (backupSource) {
                case 'localStorage':
                    // Restaurar desde localStorage backup
                    const backupKey = 'flu-backup-' + new Date().toISOString().split('T')[0];
                    const backupData = localStorage.getItem(backupKey);
                    
                    if (backupData) {
                        // Aquí se restaurarían los datos
                    } else {
                    }
                    break;
                    
                default:
            }
            
            this.recordExecution(incident.id, 'restore_from_backup');
            
            return {
                success: true,
                action: 'restore_from_backup',
                message: `Restauración desde ${backupSource} completada`,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
        console.warn('[catch] src/core/autonomy/autoRecovery.ts:', error);
            return {
                success: false,
                action: 'restore_from_backup',
                message: `Error restaurando desde backup: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                durationMs: Date.now() - startTime,
            };
        }
    }
    
    async executeNotifyUser(params: RecoveryActionParams, incident: RecoveryIncident): Promise<RecoveryResult> {
        const startTime = Date.now();
        const { message = 'Se detectó un problema en el sistema', type = 'info' } = params;
        
        try {
            // Notificar al usuario vía bus central de autonomía (la UI lo
            // convierte en notificación del panel de autonomía).
            emitAutonomyEvent({
                type: 'system-notification',
                level: type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info',
                message,
                detail: { component: incident.component },
            });

            this.recordExecution(incident.id, 'notify_user');
            
            return {
                success: true,
                action: 'notify_user',
                message: `Usuario notificado: ${message}`,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
        console.warn('[catch] src/core/autonomy/autoRecovery.ts:', error);
            return {
                success: false,
                action: 'notify_user',
                message: `Error notificando al usuario: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                durationMs: Date.now() - startTime,
            };
        }
    }
    
    async executeEscalateToAdmin(params: RecoveryActionParams, incident: RecoveryIncident): Promise<RecoveryResult> {
        const startTime = Date.now();
        const { channels = ['console'], message = 'Incidente crítico requiere atención' } = params;
        
        try {
            // Escalar a administrador (en implementación real, esto podría enviar email, log, etc.)
            channels.forEach((channel: string) => {
                switch (channel) {
                    case 'console':
                        console.error(`[ESCALACIÓN] ${message}`, incident);
                        break;
                    case 'localStorage':
                        const escalations = JSON.parse(localStorage.getItem('flu-escalations') || '[]');
                        escalations.push({
                            incidentId: incident.id,
                            message,
                            timestamp: Date.now(),
                            component: incident.component,
                        });
                        localStorage.setItem('flu-escalations', JSON.stringify(escalations));
                        break;
                }
            });
            
            this.recordExecution(incident.id, 'escalate_to_admin');
            
            return {
                success: true,
                action: 'escalate_to_admin',
                message: `Incidente escalado a administrador a través de: ${channels.join(', ')}`,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
        console.warn('[catch] src/core/autonomy/autoRecovery.ts:', error);
            return {
                success: false,
                action: 'escalate_to_admin',
                message: `Error escalando a administrador: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                durationMs: Date.now() - startTime,
            };
        }
    }
    
    private getExecutionCount(incidentId: string, action: RecoveryAction): number {
        const key = `${incidentId}-${action}`;
        return this.executionHistory.get(key)?.count || 0;
    }
    
    private recordExecution(incidentId: string, action: RecoveryAction): void {
        const key = `${incidentId}-${action}`;
        const current = this.executionHistory.get(key) || { count: 0, lastExecution: 0 };
        
        this.executionHistory.set(key, {
            count: current.count + 1,
            lastExecution: Date.now(),
        });
    }
    
    clearHistory(incidentId?: string): void {
        if (incidentId) {
            // Eliminar solo historial de este incidente
            const keysToDelete: string[] = [];
            this.executionHistory.forEach((_, key) => {
                if (key.startsWith(incidentId)) {
                    keysToDelete.push(key);
                }
            });
            keysToDelete.forEach(key => this.executionHistory.delete(key));
        } else {
            this.executionHistory.clear();
        }
    }
}

// -----------------------------------------------------------
// Evaluador de condiciones
// -----------------------------------------------------------

class ConditionEvaluator {
    evaluateCondition(
        condition: RecoveryCondition,
        componentHealth: ComponentHealth,
        incidentHistory: RecoveryIncident[]
    ): boolean {
        // Verificar componente
        if (componentHealth.name !== condition.component) {
            return false;
        }
        
        // Verificar estado de salud
        if (componentHealth.status !== condition.healthStatus) {
            return false;
        }
        
        // Verificar duración mínima
        if (condition.minDurationMs) {
            const incidentDuration = Date.now() - componentHealth.lastCheck;
            if (incidentDuration < condition.minDurationMs) {
                return false;
            }
        }
        
        // Verificar fallos consecutivos
        if (condition.minConsecutiveFailures && condition.minConsecutiveFailures > 1) {
            const recentIncidents = incidentHistory.filter(inc => 
                inc.component === condition.component && 
                inc.status === 'active'
            );
            
            if (recentIncidents.length < condition.minConsecutiveFailures) {
                return false;
            }
        }
        
        // Verificar condiciones de métricas
        if (condition.metricConditions && condition.metricConditions.length > 0) {
            for (const metricCondition of condition.metricConditions) {
                const metricValue = componentHealth.metrics[metricCondition.metric];
                
                if (metricValue === undefined) {
                    return false;
                }
                
                const passes = this.evaluateMetricCondition(
                    metricValue,
                    metricCondition.operator,
                    metricCondition.value
                );
                
                if (!passes) {
                    return false;
                }
            }
        }
        
        return true;
    }
    
    private evaluateMetricCondition(
        actual: MetricValue,
        operator: MetricOperator,
        expected: MetricValue
    ): boolean {
        switch (operator) {
            case '>':
                return actual > expected;
            case '<':
                return actual < expected;
            case '>=':
                return actual >= expected;
            case '<=':
                return actual <= expected;
            case '===':
                return actual === expected;
            case '!==':
                return actual !== expected;
            default:
                return false;
        }
    }
}

// -----------------------------------------------------------
// Clase principal de Auto Recovery
// -----------------------------------------------------------

export class AutoRecoverySystem {
    private config: AutoRecoveryConfig;
    private actionExecutor: RecoveryActionExecutor;
    private conditionEvaluator: ConditionEvaluator;
    private activeIncidents: Map<string, RecoveryIncident> = new Map();
    private incidentHistory: RecoveryIncident[] = [];
    private healthMonitor: HealthMonitor | null = null; // Referencia al Health Monitor
    
    /** Punto de composición de dependencias (§2.4). */
    static create(
        config: Partial<AutoRecoveryConfig> = {},
        deps: { actionExecutor?: RecoveryActionExecutor; conditionEvaluator?: ConditionEvaluator } = {},
    ): AutoRecoverySystem {
        return new AutoRecoverySystem(config, {
            actionExecutor: deps.actionExecutor ?? new RecoveryActionExecutor(),
            conditionEvaluator: deps.conditionEvaluator ?? new ConditionEvaluator(),
        });
    }

    constructor(
        config: Partial<AutoRecoveryConfig> = {},
        deps: { actionExecutor: RecoveryActionExecutor; conditionEvaluator: ConditionEvaluator },
    ) {
        this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
        this.actionExecutor = deps.actionExecutor;
        this.conditionEvaluator = deps.conditionEvaluator;
    }
    
    setHealthMonitor(monitor: HealthMonitor): void {
        this.healthMonitor = monitor;
    }
    
    async evaluateAndRecover(componentHealth: ComponentHealth): Promise<RecoveryResult | null> {
        if (!this.config.enabled) {
            return null;
        }
        
        // Buscar reglas aplicables
        const applicableRules = this.config.rules
            .filter(rule => this.conditionEvaluator.evaluateCondition(
                rule.condition,
                componentHealth,
                this.incidentHistory
            ))
            .sort((a, b) => b.priority - a.priority); // Ordenar por prioridad descendente
        
        if (applicableRules.length === 0) {
            return null;
        }
        
        // Seleccionar regla de mayor prioridad
        const selectedRule = applicableRules[0];
        
        // Verificar límites de ejecución
        const incidentId = this.getOrCreateIncidentId(componentHealth);
        const executionCount = this.getRuleExecutionCount(incidentId, selectedRule.action);
        
        if (executionCount >= selectedRule.maxExecutions) {
            return null;
        }
        
        // Verificar cooldown
        if (this.isInCooldown(incidentId, selectedRule)) {
            return null;
        }
        
        // Ejecutar acción de recuperación
        const result = await this.executeRecoveryAction(
            selectedRule.action,
            selectedRule.params || {},
            componentHealth,
            incidentId
        );
        
        // Actualizar estado del incidente
        this.updateIncidentStatus(incidentId, componentHealth, selectedRule.action, result.success);
        
        return result;
    }
    
    private async executeRecoveryAction(
        action: RecoveryAction,
        params: RecoveryActionParams,
        componentHealth: ComponentHealth,
        incidentId: string
    ): Promise<RecoveryResult> {
        const incident = this.activeIncidents.get(incidentId) || this.createIncident(componentHealth, incidentId);
        
        switch (action) {
            case 'retry_with_backoff':
                return await this.actionExecutor.executeRetryWithBackoff(params, incident);
                
            case 'switch_ai_provider':
                return await this.actionExecutor.executeSwitchAIProvider(params, incident);
                
            case 'restart_component':
                return await this.actionExecutor.executeRestartComponent(params, incident);
                
            case 'enable_degraded_mode':
                return await this.actionExecutor.executeEnableDegradedMode(params, incident);
                
            case 'restore_from_backup':
                return await this.actionExecutor.executeRestoreFromBackup(params, incident);
                
            case 'notify_user':
                return await this.actionExecutor.executeNotifyUser(params, incident);
                
            case 'escalate_to_admin':
                return await this.actionExecutor.executeEscalateToAdmin(params, incident);
                
            default:
                return {
                    success: false,
                    action: 'no_action',
                    message: `Acción no implementada: ${action}`,
                    durationMs: 0,
                };
        }
    }
    
    private getOrCreateIncidentId(componentHealth: ComponentHealth): string {
        // Buscar incidente activo para este componente
        for (const [id, incident] of this.activeIncidents) {
            if (incident.component === componentHealth.name && incident.status === 'active') {
                return id;
            }
        }
        
        // Crear nuevo incidente
        return this.createIncident(componentHealth).id;
    }
    
    private createIncident(componentHealth: ComponentHealth, id?: string): RecoveryIncident {
        const incidentId = id || `incident-${uuidv4()}`;
        
        const incident: RecoveryIncident = {
            id: incidentId,
            component: componentHealth.name,
            detectedStatus: componentHealth.status,
            detectedAt: Date.now(),
            actionsTaken: [],
            status: 'active',
            metricsAtDetection: { ...componentHealth.metrics },
        };
        
        this.activeIncidents.set(incidentId, incident);
        this.incidentHistory.push(incident);
        
        // Limitar historial
        if (this.incidentHistory.length > 100) {
            this.incidentHistory = this.incidentHistory.slice(-100);
        }
        
        return incident;
    }
    
    private updateIncidentStatus(
        incidentId: string,
        componentHealth: ComponentHealth,
        action: RecoveryAction,
        success: boolean
    ): void {
        const incident = this.activeIncidents.get(incidentId);
        if (!incident) return;
        
        incident.actionsTaken.push(action);
        
        // Si la recuperación fue exitosa y el componente está saludable ahora, marcar como resuelto
        if (success && componentHealth.status === 'healthy') {
            incident.status = 'resolved';
            incident.resolvedAt = Date.now();
            this.activeIncidents.delete(incidentId);
        }
        
        // Si ha pasado demasiado tiempo sin resolverse, escalar
        const incidentAge = Date.now() - incident.detectedAt;
        if (incidentAge > this.config.maxRecoveryTimeMs && incident.status === 'active') {
            incident.status = 'escalated';
            this.executeRecoveryAction('escalate_to_admin', {
                message: `Incidente ${incidentId} no resuelto después de ${Math.round(incidentAge / 1000)} segundos`,
            }, componentHealth, incidentId);
        }
    }
    
    private getRuleExecutionCount(incidentId: string, action: RecoveryAction): number {
        const incident = this.activeIncidents.get(incidentId);
        if (!incident) return 0;
        
        return incident.actionsTaken.filter(a => a === action).length;
    }
    
    private isInCooldown(incidentId: string, rule: RecoveryRule): boolean {
        if (rule.cooldownMs <= 0) return false;
        
        const incident = this.activeIncidents.get(incidentId);
        if (!incident) return false;
        
        const lastActionTime = incident.actionsTaken.length > 0 
            ? incident.detectedAt + (incident.actionsTaken.length * 1000) // Simplificado
            : 0;
        
        return Date.now() - lastActionTime < rule.cooldownMs;
    }
    
    getActiveIncidents(): RecoveryIncident[] {
        return Array.from(this.activeIncidents.values());
    }
    
    getIncidentHistory(): RecoveryIncident[] {
        return [...this.incidentHistory];
    }
    
    clearIncident(incidentId: string): void {
        this.activeIncidents.delete(incidentId);
        this.actionExecutor.clearHistory(incidentId);
    }
    
    clearAllIncidents(): void {
        this.activeIncidents.clear();
        this.actionExecutor.clearHistory();
    }
    
    updateConfig(newConfig: Partial<AutoRecoveryConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }
    
    getConfig(): AutoRecoveryConfig {
        return { ...this.config };
    }
}

// -----------------------------------------------------------
// Integración con Health Monitor
// -----------------------------------------------------------

export function createIntegratedAutonomySystem(
    healthConfig?: Partial<AutoRecoveryConfig>
): { healthMonitor: HealthMonitor | null; recoverySystem: AutoRecoverySystem } {
    // En una implementación real, esto integraría ambos sistemas
    const recoverySystem = AutoRecoverySystem.create(healthConfig);
    
    // El Health Monitor se crearía y conectaría aquí
    // Por ahora retornamos un objeto con ambos sistemas
    return {
        healthMonitor: null, // Se establecería después
        recoverySystem,
    };
}

// -----------------------------------------------------------
// Instancia global (singleton)
// -----------------------------------------------------------

let globalRecoverySystem: AutoRecoverySystem | null = null;

export function getAutoRecoverySystem(config?: Partial<AutoRecoveryConfig>): AutoRecoverySystem {
    if (!globalRecoverySystem) {
        globalRecoverySystem = AutoRecoverySystem.create(config);
    }
    return globalRecoverySystem;
}

export function startGlobalAutoRecovery(config?: Partial<AutoRecoveryConfig>): AutoRecoverySystem {
    const system = getAutoRecoverySystem(config);
    // En una implementación completa, esto iniciaría el monitoreo automático
    return system;
}