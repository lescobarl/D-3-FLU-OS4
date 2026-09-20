// ============================================================
// Auto Optimization — Optimización Automática de Parámetros
// ============================================================
// Ajusta automáticamente parámetros de configuración basándose
// en métricas de rendimiento y feedback del usuario.
//
// Parámetros optimizables:
//   - Umbrales de reconocimiento de voz
//   - Timeouts de solicitudes de IA
//   - Parámetros de caché y memoria
//   - Configuración de animaciones
//   - Ajustes de interfaz de usuario
//
// Cumple:
//   - Aprendizaje por refuerzo basado en resultados
//   - Evita cambios que degraden la experiencia
//   - Respeta límites de seguridad y usabilidad
//   - Mantiene historial de cambios para rollback
// ============================================================

import { emitAutonomyEvent } from './autonomyEvents';

// -----------------------------------------------------------
// Tipos
// -----------------------------------------------------------

export type OptimizableParameter = 
    | 'speech_recognition_confidence_threshold'
    | 'ai_request_timeout'
    | 'cache_ttl'
    | 'animation_speed'
    | 'ui_refresh_rate'
    | 'memory_cache_size'
    | 'retry_max_attempts'
    | 'backoff_base_delay';

export interface ParameterValue {
    /** Valor actual */
    current: number;
    /** Valor mínimo permitido */
    min: number;
    /** Valor máximo permitido */
    max: number;
    /** Paso de ajuste */
    step: number;
    /** Unidad de medida */
    unit: string;
}

export interface OptimizationMetric {
    /** Nombre de la métrica */
    name: string;
    /** Valor actual (normalizado 0-1) */
    value: number;
    /** Peso en la optimización */
    weight: number;
    /** Objetivo (maximizar/minimizar) */
    goal: 'maximize' | 'minimize';
}

export interface OptimizationResult {
    /** Parámetro optimizado */
    parameter: OptimizableParameter;
    /** Valor anterior */
    oldValue: number;
    /** Nuevo valor */
    newValue: number;
    /** Mejora esperada (0-1) */
    expectedImprovement: number;
    /** Métricas afectadas */
    affectedMetrics: OptimizationMetric[];
    /** Justificación del cambio */
    justification: string;
    /** Timestamp de la optimización */
    timestamp: number;
    /** Si el cambio fue aplicado */
    applied: boolean;
    /** Resultado real (si está disponible) */
    actualResult?: {
        improvement: number;
        userFeedback: number; // 0-1
        stabilityImpact: number; // 0-1
    };
}

export interface AutoOptimizationConfig {
    /** Habilitar optimización automática */
    enabled: boolean;
    /** Intervalo de evaluación (ms) */
    evaluationInterval: number;
    /** Cambio máximo por ajuste (%) */
    maxChangePerAdjustment: number;
    /** Número mínimo de muestras antes de optimizar */
    minSamples: number;
    /** Considerar feedback del usuario */
    considerUserFeedback: boolean;
    /** Umbral de confianza mínimo para aplicar cambios */
    minConfidenceThreshold: number;
    /** Permitir rollback automático */
    allowAutoRollback: boolean;
    /** Tiempo de evaluación después de cambio (ms) */
    evaluationPeriodAfterChange: number;
    /** Habilitar logging detallado */
    verboseLogging: boolean;
}

// -----------------------------------------------------------
// Configuración por defecto
// -----------------------------------------------------------

export const DEFAULT_OPTIMIZATION_CONFIG: AutoOptimizationConfig = {
    enabled: true,
    evaluationInterval: 600000, // 10 minutos
    maxChangePerAdjustment: 20, // 20%
    minSamples: 50,
    considerUserFeedback: true,
    minConfidenceThreshold: 0.65,
    allowAutoRollback: true,
    evaluationPeriodAfterChange: 300000, // 5 minutos
    verboseLogging: false,
};

// -----------------------------------------------------------
// Definición de parámetros optimizables
// -----------------------------------------------------------

export const OPTIMIZABLE_PARAMETERS: Record<OptimizableParameter, ParameterValue> = {
    'speech_recognition_confidence_threshold': {
        current: 0.7,
        min: 0.3,
        max: 0.95,
        step: 0.05,
        unit: 'confidence',
    },
    'ai_request_timeout': {
        current: 30000,
        min: 5000,
        max: 120000,
        step: 5000,
        unit: 'ms',
    },
    'cache_ttl': {
        current: 300000,
        min: 60000,
        max: 1800000,
        step: 60000,
        unit: 'ms',
    },
    'animation_speed': {
        current: 1.0,
        min: 0.5,
        max: 2.0,
        step: 0.1,
        unit: 'multiplier',
    },
    'ui_refresh_rate': {
        current: 60,
        min: 30,
        max: 120,
        step: 5,
        unit: 'fps',
    },
    'memory_cache_size': {
        current: 100,
        min: 10,
        max: 1000,
        step: 10,
        unit: 'items',
    },
    'retry_max_attempts': {
        current: 3,
        min: 1,
        max: 10,
        step: 1,
        unit: 'attempts',
    },
    'backoff_base_delay': {
        current: 1000,
        min: 500,
        max: 5000,
        step: 500,
        unit: 'ms',
    },
};

// -----------------------------------------------------------
// Métricas de evaluación
// -----------------------------------------------------------

interface PerformanceMetrics {
    /** Tasa de reconocimiento de voz exitoso (0-1) */
    speechRecognitionSuccessRate: number;
    /** Tiempo promedio de respuesta de IA (ms) */
    aiResponseTime: number;
    /** Tasa de timeout de solicitudes (0-1) */
    timeoutRate: number;
    /** Uso de memoria (MB) */
    memoryUsage: number;
    /** Tasa de refresco de UI real (fps) */
    actualUIRefreshRate: number;
    /** Feedback del usuario (0-1) */
    userFeedback: number;
    /** Estabilidad del sistema (0-1) */
    systemStability: number;
    /** Timestamp */
    timestamp: number;
}

// -----------------------------------------------------------
// Optimizador de parámetros
// -----------------------------------------------------------

class ParameterOptimizer {
    private metricsHistory: PerformanceMetrics[] = [];
    private optimizationHistory: OptimizationResult[] = [];
    private readonly maxHistorySize = 1000;
    
    evaluateParameter(parameter: OptimizableParameter): OptimizationResult | null {
        const paramDef = OPTIMIZABLE_PARAMETERS[parameter];
        if (!paramDef) return null;
        
        // Obtener métricas recientes
        const recentMetrics = this.getRecentMetrics(100);
        if (recentMetrics.length < DEFAULT_OPTIMIZATION_CONFIG.minSamples) {
            return null;
        }
        
        // Evaluar métricas relevantes para este parámetro
        const relevantMetrics = this.getRelevantMetrics(parameter, recentMetrics);
        
        // Determinar dirección de optimización
        const direction = this.determineOptimizationDirection(parameter, relevantMetrics);
        
        if (direction === 'no_change') {
            return null;
        }
        
        // Calcular nuevo valor
        const newValue = this.calculateNewValue(paramDef, direction);
        
        // Calcular mejora esperada
        const expectedImprovement = this.calculateExpectedImprovement(
            parameter,
            paramDef.current,
            newValue,
            relevantMetrics
        );
        
        if (expectedImprovement < 0.05) { // Mejora mínima del 5%
            return null;
        }
        
        // Crear resultado de optimización
        const result: OptimizationResult = {
            parameter,
            oldValue: paramDef.current,
            newValue,
            expectedImprovement,
            affectedMetrics: this.mapToOptimizationMetrics(relevantMetrics),
            justification: this.generateJustification(parameter, direction, expectedImprovement, relevantMetrics),
            timestamp: Date.now(),
            applied: false,
        };
        
        return result;
    }
    
    applyOptimization(result: OptimizationResult): void {
        // Actualizar valor del parámetro
        OPTIMIZABLE_PARAMETERS[result.parameter].current = result.newValue;
        
        // Aplicar a configuración del sistema
        this.applyToSystemConfig(result.parameter, result.newValue);
        
        // Registrar en historial
        result.applied = true;
        this.optimizationHistory.push(result);
        
        // Limitar historial
        if (this.optimizationHistory.length > this.maxHistorySize) {
            this.optimizationHistory.shift();
        }
        
        // Programar evaluación posterior
        setTimeout(() => {
            this.evaluateOptimizationResult(result);
        }, DEFAULT_OPTIMIZATION_CONFIG.evaluationPeriodAfterChange);
    }
    
    evaluateOptimizationResult(result: OptimizationResult): void {
        // Obtener métricas después del cambio
        const postChangeMetrics = this.getRecentMetrics(20); // Últimas 20 muestras
        
        if (postChangeMetrics.length === 0) {
            return;
        }
        
        // Calcular métricas antes del cambio
        const preChangeMetrics = this.metricsHistory.filter(m => 
            m.timestamp < result.timestamp
        ).slice(-20);
        
        if (preChangeMetrics.length === 0) {
            return;
        }
        
        // Comparar métricas
        const comparison = this.compareMetrics(preChangeMetrics, postChangeMetrics);
        
        // Actualizar resultado con datos reales
        const actualResult = {
            improvement: comparison.overallImprovement,
            userFeedback: comparison.userFeedbackChange,
            stabilityImpact: comparison.stabilityImpact,
        };
        
        // Buscar y actualizar resultado en historial
        const appliedResult = this.optimizationHistory.find(r => 
            r.parameter === result.parameter && 
            r.timestamp === result.timestamp &&
            r.applied
        );
        
        if (appliedResult) {
            appliedResult.actualResult = actualResult;
            
            // Rollback automático si el resultado es negativo
            if (DEFAULT_OPTIMIZATION_CONFIG.allowAutoRollback && 
                actualResult.improvement < -0.1) { // Empeoró más del 10%
                this.rollbackOptimization(appliedResult);
            }
        }
    }
    
    private rollbackOptimization(result: OptimizationResult): void {
        
        // Revertir al valor anterior
        OPTIMIZABLE_PARAMETERS[result.parameter].current = result.oldValue;
        this.applyToSystemConfig(result.parameter, result.oldValue);
        
        // Marcar como revertido
        result.applied = false;
        
        // Notificar el rollback vía bus central de autonomía
        emitAutonomyEvent({
            type: 'parameter-rollback',
            level: 'warning',
            message: `Parámetro ${result.parameter} revertido: ${result.newValue} → ${result.oldValue} (impacto negativo)`,
            detail: {
                parameter: result.parameter,
                from: result.newValue,
                to: result.oldValue,
                reason: 'negative_impact',
                improvement: result.actualResult?.improvement,
            },
        });
    }
    
    private getRecentMetrics(count: number): PerformanceMetrics[] {
        return this.metricsHistory.slice(-count);
    }
    
    private getRelevantMetrics(parameter: OptimizableParameter, metrics: PerformanceMetrics[]): Partial<PerformanceMetrics> {
        // Determinar qué métricas son relevantes para cada parámetro
        const relevant: Partial<PerformanceMetrics> = {};
        
        switch (parameter) {
            case 'speech_recognition_confidence_threshold':
                relevant.speechRecognitionSuccessRate = this.average(metrics.map(m => m.speechRecognitionSuccessRate));
                relevant.userFeedback = this.average(metrics.map(m => m.userFeedback));
                break;
                
            case 'ai_request_timeout':
                relevant.aiResponseTime = this.average(metrics.map(m => m.aiResponseTime));
                relevant.timeoutRate = this.average(metrics.map(m => m.timeoutRate));
                relevant.systemStability = this.average(metrics.map(m => m.systemStability));
                break;
                
            case 'cache_ttl':
                relevant.aiResponseTime = this.average(metrics.map(m => m.aiResponseTime));
                relevant.memoryUsage = this.average(metrics.map(m => m.memoryUsage));
                break;
                
            case 'animation_speed':
                relevant.userFeedback = this.average(metrics.map(m => m.userFeedback));
                relevant.systemStability = this.average(metrics.map(m => m.systemStability));
                break;
                
            case 'ui_refresh_rate':
                relevant.actualUIRefreshRate = this.average(metrics.map(m => m.actualUIRefreshRate));
                relevant.memoryUsage = this.average(metrics.map(m => m.memoryUsage));
                relevant.userFeedback = this.average(metrics.map(m => m.userFeedback));
                break;
                
            case 'memory_cache_size':
                relevant.aiResponseTime = this.average(metrics.map(m => m.aiResponseTime));
                relevant.memoryUsage = this.average(metrics.map(m => m.memoryUsage));
                break;
                
            case 'retry_max_attempts':
                relevant.timeoutRate = this.average(metrics.map(m => m.timeoutRate));
                relevant.systemStability = this.average(metrics.map(m => m.systemStability));
                break;
                
            case 'backoff_base_delay':
                relevant.aiResponseTime = this.average(metrics.map(m => m.aiResponseTime));
                relevant.systemStability = this.average(metrics.map(m => m.systemStability));
                break;
        }
        
        return relevant;
    }
    
    private determineOptimizationDirection(
        parameter: OptimizableParameter,
        metrics: Partial<PerformanceMetrics>
    ): 'increase' | 'decrease' | 'no_change' {
        // Lógica específica por parámetro
        switch (parameter) {
            case 'speech_recognition_confidence_threshold':
                // Aumentar si la tasa de éxito es baja, disminuir si es alta pero hay muchos falsos negativos
                if (metrics.speechRecognitionSuccessRate! < 0.6) {
                    return 'decrease'; // Bajar umbral para capturar más
                } else if (metrics.speechRecognitionSuccessRate! > 0.9 && metrics.userFeedback! < 0.7) {
                    return 'increase'; // Subir umbral para reducir falsos positivos
                }
                break;
                
            case 'ai_request_timeout':
                // Aumentar si hay muchos timeouts, disminuir si es demasiado largo
                if (metrics.timeoutRate! > 0.3) {
                    return 'increase';
                } else if (metrics.aiResponseTime! < 10000 && metrics.timeoutRate! < 0.1) {
                    return 'decrease';
                }
                break;
                
            case 'cache_ttl':
                // Aumentar si la respuesta de IA es lenta, disminuir si el uso de memoria es alto
                if (metrics.aiResponseTime! > 20000 && metrics.memoryUsage! < 500) {
                    return 'increase';
                } else if (metrics.memoryUsage! > 800) {
                    return 'decrease';
                }
                break;
                
            case 'animation_speed':
                // Ajustar basado en feedback del usuario
                if (metrics.userFeedback! < 0.6) {
                    return Math.random() > 0.5 ? 'increase' : 'decrease'; // Exploración
                }
                break;
                
            case 'ui_refresh_rate':
                // Disminuir si el uso de memoria es alto, aumentar si la tasa real es baja
                if (metrics.memoryUsage! > 700) {
                    return 'decrease';
                } else if (metrics.actualUIRefreshRate! < 45 && metrics.memoryUsage! < 400) {
                    return 'increase';
                }
                break;
                
            case 'memory_cache_size':
                // Aumentar si la respuesta de IA es lenta, disminuir si el uso de memoria es alto
                if (metrics.aiResponseTime! > 15000 && metrics.memoryUsage! < 600) {
                    return 'increase';
                } else if (metrics.memoryUsage! > 900) {
                    return 'decrease';
                }
                break;
                
            case 'retry_max_attempts':
                // Aumentar si hay muchos timeouts, disminuir si el sistema es inestable
                if (metrics.timeoutRate! > 0.4) {
                    return 'increase';
                } else if (metrics.systemStability! < 0.7) {
                    return 'decrease';
                }
                break;
                
            case 'backoff_base_delay':
                // Aumentar si el sistema es inestable, disminuir si la respuesta es lenta
                if (metrics.systemStability! < 0.7) {
                    return 'increase';
                } else if (metrics.aiResponseTime! > 25000) {
                    return 'decrease';
                }
                break;
        }
        
        return 'no_change';
    }
    
    private calculateNewValue(paramDef: ParameterValue, direction: 'increase' | 'decrease'): number {
        const maxChange = paramDef.current * (DEFAULT_OPTIMIZATION_CONFIG.maxChangePerAdjustment / 100);
        const change = Math.min(maxChange, paramDef.step * 3); // Máximo 3 pasos
        
        let newValue = direction === 'increase' 
            ? paramDef.current + change
            : paramDef.current - change;
        
        // Asegurar límites
        newValue = Math.max(paramDef.min, Math.min(paramDef.max, newValue));
        
        // Redondear al paso más cercano
        newValue = Math.round(newValue / paramDef.step) * paramDef.step;
        
        return newValue;
    }
    
    private calculateExpectedImprovement(
        parameter: OptimizableParameter,
        oldValue: number,
        newValue: number,
        metrics: Partial<PerformanceMetrics>
    ): number {
        // Modelo simplificado de mejora esperada
        let improvement = 0;
        
        switch (parameter) {
            case 'speech_recognition_confidence_threshold':
                if (newValue < oldValue) {
                    // Bajar umbral → debería aumentar tasa de éxito
                    improvement = 0.3 * (1 - (metrics.speechRecognitionSuccessRate || 0));
                } else {
                    // Subir umbral → debería mejorar precisión
                    improvement = 0.2 * (1 - (metrics.userFeedback || 0));
                }
                break;
                
            case 'ai_request_timeout':
                if (newValue > oldValue) {
                    // Aumentar timeout → debería reducir tasa de timeout
                    improvement = 0.4 * (metrics.timeoutRate || 0);
                } else {
                    // Disminuir timeout → debería mejorar tiempo de respuesta
                    improvement = 0.2 * Math.max(0, (30000 - (metrics.aiResponseTime || 30000)) / 30000);
                }
                break;
                
            case 'cache_ttl':
                if (newValue > oldValue) {
                    // Cache más larga → debería mejorar tiempo de respuesta
                    improvement = 0.3 * Math.max(0, (50000 - (metrics.aiResponseTime || 50000)) / 50000);
                } else {
                    // Cache más corta → debería reducir uso de memoria
                    improvement = 0.3 * Math.min(1, (metrics.memoryUsage || 1000) / 1000);
                }
                break;
                
            default:
                improvement = 0.1; // Mejora base para otros parámetros
        }
        
        return Math.max(0, Math.min(1, improvement));
    }
    
    private generateJustification(
        parameter: OptimizableParameter,
        direction: 'increase' | 'decrease',
        improvement: number,
        metrics: Partial<PerformanceMetrics>
    ): string {
        const paramName = parameter.replace(/_/g, ' ');
        const directionText = direction === 'increase' ? 'aumentar' : 'disminuir';
        const improvementPercent = Math.round(improvement * 100);
        
        let reason = '';
        
        switch (parameter) {
            case 'speech_recognition_confidence_threshold':
                reason = `Tasa de éxito de reconocimiento: ${Math.round((metrics.speechRecognitionSuccessRate || 0) * 100)}%`;
                break;
            case 'ai_request_timeout':
                reason = `Tasa de timeout: ${Math.round((metrics.timeoutRate || 0) * 100)}%, Tiempo de respuesta: ${Math.round((metrics.aiResponseTime || 0) / 1000)}s`;
                break;
            case 'cache_ttl':
                reason = `Uso de memoria: ${Math.round(metrics.memoryUsage || 0)}MB, Tiempo de respuesta: ${Math.round((metrics.aiResponseTime || 0) / 1000)}s`;
                break;
            default:
                reason = `Métricas actuales dentro de rangos optimizables`;
        }
        
        return `Recomendado ${directionText} ${paramName} (${improvementPercent}% mejora esperada). ${reason}`;
    }
    
    applyToSystemConfig(parameter: OptimizableParameter, value: number): void {
        // En una implementación real, esto actualizaría la configuración del sistema
        
        // Guardar en localStorage para persistencia
        localStorage.setItem(`flu-param-${parameter}`, value.toString());
        
        // Notificar el cambio de parámetro vía bus central de autonomía
        emitAutonomyEvent({
            type: 'parameter-changed',
            level: 'info',
            message: `Parámetro ${parameter} aplicado = ${value}`,
            detail: { parameter, value },
        });
    }
    
    private compareMetrics(before: PerformanceMetrics[], after: PerformanceMetrics[]): {
        overallImprovement: number;
        userFeedbackChange: number;
        stabilityImpact: number;
    } {
        if (before.length === 0 || after.length === 0) {
            return { overallImprovement: 0, userFeedbackChange: 0, stabilityImpact: -1 };
        }
        
        // Calcular promedios
        const avgBefore = {
            speechRecognitionSuccessRate: this.average(before.map(m => m.speechRecognitionSuccessRate)),
            aiResponseTime: this.average(before.map(m => m.aiResponseTime)),
            timeoutRate: this.average(before.map(m => m.timeoutRate)),
            memoryUsage: this.average(before.map(m => m.memoryUsage)),
            userFeedback: this.average(before.map(m => m.userFeedback)),
            systemStability: this.average(before.map(m => m.systemStability)),
        };
        
        const avgAfter = {
            speechRecognitionSuccessRate: this.average(after.map(m => m.speechRecognitionSuccessRate)),
            aiResponseTime: this.average(after.map(m => m.aiResponseTime)),
            timeoutRate: this.average(after.map(m => m.timeoutRate)),
            memoryUsage: this.average(after.map(m => m.memoryUsage)),
            userFeedback: this.average(after.map(m => m.userFeedback)),
            systemStability: this.average(after.map(m => m.systemStability)),
        };
        
        // Calcular mejoras (normalizadas)
        const improvements = {
            speechRecognitionSuccessRate: avgAfter.speechRecognitionSuccessRate - avgBefore.speechRecognitionSuccessRate,
            aiResponseTime: (avgBefore.aiResponseTime - avgAfter.aiResponseTime) / 10000, // Normalizar
            timeoutRate: avgBefore.timeoutRate - avgAfter.timeoutRate,
            memoryUsage: (avgBefore.memoryUsage - avgAfter.memoryUsage) / 100, // Normalizar
            userFeedback: avgAfter.userFeedback - avgBefore.userFeedback,
            systemStability: avgAfter.systemStability - avgBefore.systemStability,
        };
        
        // Ponderar mejoras
        const weights = {
            speechRecognitionSuccessRate: 0.2,
            aiResponseTime: 0.15,
            timeoutRate: 0.15,
            memoryUsage: 0.1,
            userFeedback: 0.25,
            systemStability: 0.15,
        };
        
        const overallImprovement = Object.entries(weights).reduce((sum, [metric, weight]) => {
            return sum + (improvements[metric as keyof typeof improvements] * weight);
        }, 0);
        
        return {
            overallImprovement,
            userFeedbackChange: improvements.userFeedback,
            stabilityImpact: improvements.systemStability,
        };
    }
    
    private mapToOptimizationMetrics(metrics: Partial<PerformanceMetrics>): OptimizationMetric[] {
        const result: OptimizationMetric[] = [];
        
        if (metrics.speechRecognitionSuccessRate !== undefined) {
            result.push({
                name: 'speech_recognition_success_rate',
                value: metrics.speechRecognitionSuccessRate,
                weight: 0.2,
                goal: 'maximize',
            });
        }
        
        if (metrics.aiResponseTime !== undefined) {
            result.push({
                name: 'ai_response_time',
                value: 1 - Math.min(1, metrics.aiResponseTime / 60000), // Normalizar
                weight: 0.15,
                goal: 'maximize', // Queremos menor tiempo = mayor valor
            });
        }
        
        if (metrics.userFeedback !== undefined) {
            result.push({
                name: 'user_feedback',
                value: metrics.userFeedback,
                weight: 0.25,
                goal: 'maximize',
            });
        }
        
        if (metrics.systemStability !== undefined) {
            result.push({
                name: 'system_stability',
                value: metrics.systemStability,
                weight: 0.15,
                goal: 'maximize',
            });
        }
        
        return result;
    }
    
    private average(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
    
    recordMetrics(metrics: PerformanceMetrics): void {
        this.metricsHistory.push(metrics);
        
        // Limitar historial
        if (this.metricsHistory.length > this.maxHistorySize) {
            this.metricsHistory.shift();
        }
    }
    
    getOptimizationHistory(): OptimizationResult[] {
        return [...this.optimizationHistory];
    }
    
    getParameterValue(parameter: OptimizableParameter): number {
        return OPTIMIZABLE_PARAMETERS[parameter]?.current || 0;
    }
}

// -----------------------------------------------------------
// Clase principal de Auto Optimization
// -----------------------------------------------------------

export class AutoOptimizationSystem {
    private config: AutoOptimizationConfig;
    private optimizer: ParameterOptimizer;
    private evaluationIntervalId: number | null = null;
    
    /** Punto de composición de dependencias (§2.4). */
    static create(
        config: Partial<AutoOptimizationConfig> = {},
        deps: { optimizer?: ParameterOptimizer } = {},
    ): AutoOptimizationSystem {
        return new AutoOptimizationSystem(config, {
            optimizer: deps.optimizer ?? new ParameterOptimizer(),
        });
    }

    constructor(
        config: Partial<AutoOptimizationConfig> = {},
        deps: { optimizer: ParameterOptimizer },
    ) {
        this.config = { ...DEFAULT_OPTIMIZATION_CONFIG, ...config };
        this.optimizer = deps.optimizer;
    }
    
    start(): void {
        if (this.evaluationIntervalId !== null || !this.config.enabled) {
            return;
        }
        
        this.evaluationIntervalId = window.setInterval(() => {
            this.evaluateAndOptimize().catch(error => {
                console.error('Error en optimización automática:', error);
            });
        }, this.config.evaluationInterval);
        
        if (this.config.verboseLogging) {
        }
    }
    
    stop(): void {
        if (this.evaluationIntervalId !== null) {
            clearInterval(this.evaluationIntervalId);
            this.evaluationIntervalId = null;
        }
        
        if (this.config.verboseLogging) {
        }
    }
    
    async evaluateAndOptimize(): Promise<void> {
        if (!this.config.enabled) {
            return;
        }
        
        // Evaluar cada parámetro optimizable
        const parameters: OptimizableParameter[] = [
            'speech_recognition_confidence_threshold',
            'ai_request_timeout',
            'cache_ttl',
            'animation_speed',
            'ui_refresh_rate',
            'memory_cache_size',
            'retry_max_attempts',
            'backoff_base_delay',
        ];
        
        for (const parameter of parameters) {
            try {
                const result = this.optimizer.evaluateParameter(parameter);
                
                if (result && result.expectedImprovement >= this.config.minConfidenceThreshold) {
                    this.optimizer.applyOptimization(result);
                }
            } catch (error) {
                console.error(`Error evaluando parámetro ${parameter}:`, error);
            }
        }
    }
    
    recordPerformanceMetrics(metrics: Partial<PerformanceMetrics>): void {
        const fullMetrics: PerformanceMetrics = {
            speechRecognitionSuccessRate: metrics.speechRecognitionSuccessRate || 0,
            aiResponseTime: metrics.aiResponseTime || 0,
            timeoutRate: metrics.timeoutRate || 0,
            memoryUsage: metrics.memoryUsage || 0,
            actualUIRefreshRate: metrics.actualUIRefreshRate || 0,
            userFeedback: metrics.userFeedback || 0,
            systemStability: metrics.systemStability || -1,
            timestamp: Date.now(),
        };
        
        this.optimizer.recordMetrics(fullMetrics);
    }
    
    getOptimizationHistory(): OptimizationResult[] {
        return this.optimizer.getOptimizationHistory();
    }
    
    getParameterValue(parameter: OptimizableParameter): number {
        return this.optimizer.getParameterValue(parameter);
    }
    
    updateConfig(newConfig: Partial<AutoOptimizationConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Reiniciar si el intervalo cambió
        if (this.evaluationIntervalId !== null && newConfig.evaluationInterval) {
            this.stop();
            this.start();
        }
    }
    
    getConfig(): AutoOptimizationConfig {
        return { ...this.config };
    }
    
    resetParameter(parameter: OptimizableParameter): void {
        const paramDef = OPTIMIZABLE_PARAMETERS[parameter];
        if (!paramDef) return;
        
        // Restaurar valor por defecto (podría ser el valor inicial o un valor predefinido)
        const defaultValue = this.getDefaultParameterValue(parameter);
        paramDef.current = defaultValue;
        
        // Aplicar al sistema
        this.optimizer.applyToSystemConfig(parameter, defaultValue);
        
    }
    
    private getDefaultParameterValue(parameter: OptimizableParameter): number {
        // Valores por defecto basados en análisis inicial
        const defaults: Record<OptimizableParameter, number> = {
            'speech_recognition_confidence_threshold': 0.7,
            'ai_request_timeout': 30000,
            'cache_ttl': 300000,
            'animation_speed': 1.0,
            'ui_refresh_rate': 60,
            'memory_cache_size': 100,
            'retry_max_attempts': 3,
            'backoff_base_delay': 1000,
        };
        
        return defaults[parameter];
    }
}

// -----------------------------------------------------------
// Instancia global (singleton)
// -----------------------------------------------------------

let globalAutoOptimization: AutoOptimizationSystem | null = null;

export function getAutoOptimizationSystem(config?: Partial<AutoOptimizationConfig>): AutoOptimizationSystem {
    if (!globalAutoOptimization) {
        globalAutoOptimization = AutoOptimizationSystem.create(config);
    }
    return globalAutoOptimization;
}

export function startGlobalAutoOptimization(config?: Partial<AutoOptimizationConfig>): AutoOptimizationSystem {
    const system = getAutoOptimizationSystem(config);
    system.start();
    return system;
}

export function stopGlobalAutoOptimization(): void {
    if (globalAutoOptimization) {
        globalAutoOptimization.stop();
    }
}

export function getCurrentParameterValues(): Record<OptimizableParameter, number> {
    const values: Partial<Record<OptimizableParameter, number>> = {};
    
    Object.keys(OPTIMIZABLE_PARAMETERS).forEach(key => {
        const param = key as OptimizableParameter;
        values[param] = OPTIMIZABLE_PARAMETERS[param].current;
    });
    
    return values as Record<OptimizableParameter, number>;
}