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

import { IntervalLifecycle, fireAndForget } from './intervalLifecycle';
import { emitAutonomyEvent } from './autonomyEvents';
import { AUTONOMY_POLICY } from './autonomyPolicy';
import { AUTONOMY_THRESHOLD_DEFAULTS } from '../config/sharedConfig';
import { logCaughtError } from '../../lib/caughtError';
import { localSet } from '../storage/localStore';

/** Alias locales: la política vive en autonomyPolicy.ts (fuente única). */
const OPT = AUTONOMY_POLICY.optimization;
const UNITS = AUTONOMY_POLICY.units;

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
    evaluationInterval: OPT.config.evaluationIntervalMs, // 10 minutos
    maxChangePerAdjustment: OPT.config.maxChangePerAdjustmentPercent, // 20%
    minSamples: OPT.config.minSamples,
    considerUserFeedback: true,
    minConfidenceThreshold: AUTONOMY_THRESHOLD_DEFAULTS.optimization.minConfidence,
    allowAutoRollback: true,
    evaluationPeriodAfterChange: OPT.config.evaluationPeriodAfterChangeMs, // 5 minutos
    verboseLogging: false,
};

// -----------------------------------------------------------
// Definición de parámetros optimizables
// -----------------------------------------------------------

export const OPTIMIZABLE_PARAMETERS: Record<OptimizableParameter, ParameterValue> = {
    'speech_recognition_confidence_threshold': {
        current: OPT.parameters.speechConfidence.current,
        min: OPT.parameters.speechConfidence.min,
        max: AUTONOMY_THRESHOLD_DEFAULTS.optimization.confidenceMax,
        step: AUTONOMY_THRESHOLD_DEFAULTS.optimization.confidenceStep,
        unit: 'confidence',
    },
    'ai_request_timeout': {
        current: OPT.parameters.aiRequestTimeout.currentMs,
        min: OPT.parameters.aiRequestTimeout.minMs,
        max: OPT.parameters.aiRequestTimeout.maxMs,
        step: OPT.parameters.aiRequestTimeout.stepMs,
        unit: 'ms',
    },
    'cache_ttl': {
        current: OPT.parameters.cacheTtl.currentMs,
        min: OPT.parameters.cacheTtl.minMs,
        max: OPT.parameters.cacheTtl.maxMs,
        step: OPT.parameters.cacheTtl.stepMs,
        unit: 'ms',
    },
    'animation_speed': {
        current: OPT.parameters.animationSpeed.current,
        min: OPT.parameters.animationSpeed.min,
        max: OPT.parameters.animationSpeed.max,
        step: OPT.parameters.animationSpeed.step,
        unit: 'multiplier',
    },
    'ui_refresh_rate': {
        current: OPT.parameters.uiRefreshRate.current,
        min: OPT.parameters.uiRefreshRate.min,
        max: OPT.parameters.uiRefreshRate.max,
        step: OPT.parameters.uiRefreshRate.step,
        unit: 'fps',
    },
    'memory_cache_size': {
        current: OPT.parameters.memoryCacheSize.current,
        min: OPT.parameters.memoryCacheSize.min,
        max: OPT.parameters.memoryCacheSize.max,
        step: OPT.parameters.memoryCacheSize.step,
        unit: 'items',
    },
    'retry_max_attempts': {
        current: OPT.parameters.retryMaxAttempts.current,
        min: OPT.parameters.retryMaxAttempts.min,
        max: OPT.parameters.retryMaxAttempts.max,
        step: OPT.parameters.retryMaxAttempts.step,
        unit: 'attempts',
    },
    'backoff_base_delay': {
        current: OPT.parameters.backoffBaseDelay.currentMs,
        min: OPT.parameters.backoffBaseDelay.minMs,
        max: OPT.parameters.backoffBaseDelay.maxMs,
        step: OPT.parameters.backoffBaseDelay.stepMs,
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

export class ParameterOptimizer {
    private metricsHistory: PerformanceMetrics[] = [];
    private optimizationHistory: OptimizationResult[] = [];
    private readonly maxHistorySize = OPT.runtime.historyLimit;
    
    evaluateParameter(parameter: OptimizableParameter): OptimizationResult | null {
        const paramDef = OPTIMIZABLE_PARAMETERS[parameter];
        if (!paramDef) return null;
        
        // Obtener métricas recientes
        const recentMetrics = this.getRecentMetrics(OPT.runtime.evaluationSampleWindow);
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
        
        if (expectedImprovement < AUTONOMY_THRESHOLD_DEFAULTS.optimization.minImprovement) { // Mejora mínima del 5%
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
        const postChangeMetrics = this.getRecentMetrics(OPT.runtime.postChangeSampleWindow); // Últimas 20 muestras
        
        if (postChangeMetrics.length === 0) {
            return;
        }
        
        // Calcular métricas antes del cambio
        const preChangeMetrics = this.metricsHistory.filter(m => 
            m.timestamp < result.timestamp
        ).slice(-OPT.runtime.preChangeSampleWindow);
        
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
                actualResult.improvement < OPT.runtime.rollbackImprovement) { // Empeoró más del 10%
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
        // Una metrica ausente (Partial) no cumple la comparacion: mismo resultado
        // que `metrics.x! < t` (undefined < t es false), pero sin asertar que existe.
        // NO se usa `?? 0`: 0 < 0.6 seria true y cambiaria la decision.
        const lt = (value: number | undefined, threshold: number): boolean =>
            value !== undefined && value < threshold;
        const gt = (value: number | undefined, threshold: number): boolean =>
            value !== undefined && value > threshold;

        // Lógica específica por parámetro
        switch (parameter) {
            case 'speech_recognition_confidence_threshold':
                // Aumentar si la tasa de éxito es baja, disminuir si es alta pero hay muchos falsos negativos
                if (lt(metrics.speechRecognitionSuccessRate, OPT.direction.speech.successRateLow)) {
                    return 'decrease'; // Bajar umbral para capturar más
                } else if (gt(metrics.speechRecognitionSuccessRate, OPT.direction.speech.successRateHigh) && lt(metrics.userFeedback, OPT.direction.speech.userFeedbackLow)) {
                    return 'increase'; // Subir umbral para reducir falsos positivos
                }
                break;
                
            case 'ai_request_timeout':
                // Aumentar si hay muchos timeouts, disminuir si es demasiado largo
                if (gt(metrics.timeoutRate, OPT.direction.aiTimeout.timeoutRateHigh)) {
                    return 'increase';
                } else if (lt(metrics.aiResponseTime, OPT.direction.aiTimeout.responseTimeFastMs) && lt(metrics.timeoutRate, OPT.direction.aiTimeout.timeoutRateLow)) {
                    return 'decrease';
                }
                break;
                
            case 'cache_ttl':
                // Aumentar si la respuesta de IA es lenta, disminuir si el uso de memoria es alto
                if (gt(metrics.aiResponseTime, OPT.direction.cache.responseTimeSlowMs) && lt(metrics.memoryUsage, OPT.direction.cache.memoryUsageLowMb)) {
                    return 'increase';
                } else if (gt(metrics.memoryUsage, OPT.direction.cache.memoryUsageHighMb)) {
                    return 'decrease';
                }
                break;
                
            case 'animation_speed':
                // Ajustar basado en feedback del usuario
                if (lt(metrics.userFeedback, OPT.direction.animation.userFeedbackLow)) {
                    return Math.random() > OPT.direction.animation.explorationThreshold ? 'increase' : 'decrease'; // Exploración
                }
                break;
                
            case 'ui_refresh_rate':
                // Disminuir si el uso de memoria es alto, aumentar si la tasa real es baja
                if (gt(metrics.memoryUsage, OPT.direction.uiRefresh.memoryUsageHighMb)) {
                    return 'decrease';
                } else if (lt(metrics.actualUIRefreshRate, OPT.direction.uiRefresh.actualRefreshRateLow) && lt(metrics.memoryUsage, OPT.direction.uiRefresh.memoryUsageLowMb)) {
                    return 'increase';
                }
                break;
                
            case 'memory_cache_size':
                // Aumentar si la respuesta de IA es lenta, disminuir si el uso de memoria es alto
                if (gt(metrics.aiResponseTime, OPT.direction.memoryCache.responseTimeSlowMs) && lt(metrics.memoryUsage, OPT.direction.memoryCache.memoryUsageLowMb)) {
                    return 'increase';
                } else if (gt(metrics.memoryUsage, OPT.direction.memoryCache.memoryUsageHighMb)) {
                    return 'decrease';
                }
                break;
                
            case 'retry_max_attempts':
                // Aumentar si hay muchos timeouts, disminuir si el sistema es inestable
                if (gt(metrics.timeoutRate, OPT.direction.retry.timeoutRateHigh)) {
                    return 'increase';
                } else if (lt(metrics.systemStability, OPT.direction.retry.systemStabilityLow)) {
                    return 'decrease';
                }
                break;
                
            case 'backoff_base_delay':
                // Aumentar si el sistema es inestable, disminuir si la respuesta es lenta
                if (lt(metrics.systemStability, OPT.direction.backoff.systemStabilityLow)) {
                    return 'increase';
                } else if (gt(metrics.aiResponseTime, OPT.direction.backoff.responseTimeSlowMs)) {
                    return 'decrease';
                }
                break;
        }
        
        return 'no_change';
    }
    
    private calculateNewValue(paramDef: ParameterValue, direction: 'increase' | 'decrease'): number {
        const maxChange = paramDef.current * (DEFAULT_OPTIMIZATION_CONFIG.maxChangePerAdjustment / UNITS.percentScale);
        const change = Math.min(maxChange, paramDef.step * OPT.runtime.maxStepsPerAdjustment); // Máximo 3 pasos
        
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
                    improvement = OPT.improvement.speechDecreaseFactor * (1 - (metrics.speechRecognitionSuccessRate || 0));
                } else {
                    // Subir umbral → debería mejorar precisión
                    improvement = OPT.improvement.speechIncreaseFactor * (1 - (metrics.userFeedback || 0));
                }
                break;
                
            case 'ai_request_timeout':
                if (newValue > oldValue) {
                    // Aumentar timeout → debería reducir tasa de timeout
                    improvement = OPT.improvement.timeoutIncreaseFactor * (metrics.timeoutRate || 0);
                } else {
                    // Disminuir timeout → debería mejorar tiempo de respuesta
                    improvement = OPT.improvement.timeoutDecreaseFactor * Math.max(0, (OPT.improvement.timeoutReferenceMs - (metrics.aiResponseTime || OPT.improvement.timeoutReferenceMs)) / OPT.improvement.timeoutReferenceMs);
                }
                break;
                
            case 'cache_ttl':
                if (newValue > oldValue) {
                    // Cache más larga → debería mejorar tiempo de respuesta
                    improvement = OPT.improvement.cacheIncreaseFactor * Math.max(0, (OPT.improvement.cacheResponseReferenceMs - (metrics.aiResponseTime || OPT.improvement.cacheResponseReferenceMs)) / OPT.improvement.cacheResponseReferenceMs);
                } else {
                    // Cache más corta → debería reducir uso de memoria
                    improvement = OPT.improvement.cacheDecreaseFactor * Math.min(1, (metrics.memoryUsage || OPT.improvement.cacheMemoryReferenceMb) / OPT.improvement.cacheMemoryReferenceMb);
                }
                break;
                
            default:
                improvement = OPT.improvement.defaultFactor; // Mejora base para otros parámetros
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
        const improvementPercent = Math.round(improvement * UNITS.percentScale);
        
        let reason = '';
        
        switch (parameter) {
            case 'speech_recognition_confidence_threshold':
                reason = `Tasa de éxito de reconocimiento: ${Math.round((metrics.speechRecognitionSuccessRate || 0) * UNITS.percentScale)}%`;
                break;
            case 'ai_request_timeout':
                reason = `Tasa de timeout: ${Math.round((metrics.timeoutRate || 0) * UNITS.percentScale)}%, Tiempo de respuesta: ${Math.round((metrics.aiResponseTime || 0) / UNITS.msPerSecond)}s`;
                break;
            case 'cache_ttl':
                reason = `Uso de memoria: ${Math.round(metrics.memoryUsage || 0)}MB, Tiempo de respuesta: ${Math.round((metrics.aiResponseTime || 0) / UNITS.msPerSecond)}s`;
                break;
            default:
                reason = `Métricas actuales dentro de rangos optimizables`;
        }
        
        return `Recomendado ${directionText} ${paramName} (${improvementPercent}% mejora esperada). ${reason}`;
    }
    
    applyToSystemConfig(parameter: OptimizableParameter, value: number): void {
        // En una implementación real, esto actualizaría la configuración del sistema
        
        // Guardar en localStorage para persistencia
        localSet(`flu-param-${parameter}`, value.toString());
        
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
            aiResponseTime: (avgBefore.aiResponseTime - avgAfter.aiResponseTime) / OPT.normalization.responseTimeDivisorMs, // Normalizar
            timeoutRate: avgBefore.timeoutRate - avgAfter.timeoutRate,
            memoryUsage: (avgBefore.memoryUsage - avgAfter.memoryUsage) / OPT.normalization.memoryUsageDivisorMb, // Normalizar
            userFeedback: avgAfter.userFeedback - avgBefore.userFeedback,
            systemStability: avgAfter.systemStability - avgBefore.systemStability,
        };
        
        // Ponderar mejoras
        const weights = {
            speechRecognitionSuccessRate: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightSpeechSuccessRate,
            aiResponseTime: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightAiResponseTime,
            timeoutRate: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightTimeoutRate,
            memoryUsage: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightMemoryUsage,
            userFeedback: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightUserFeedback,
            systemStability: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightSystemStability,
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
                weight: OPT.normalization.speechSuccessRateMetricWeight,
                goal: 'maximize',
            });
        }
        
        if (metrics.aiResponseTime !== undefined) {
            result.push({
                name: 'ai_response_time',
                value: 1 - Math.min(1, metrics.aiResponseTime / OPT.normalization.mapResponseTimeDivisorMs), // Normalizar
                weight: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightAiResponseTime,
                goal: 'maximize', // Queremos menor tiempo = mayor valor
            });
        }
        
        if (metrics.userFeedback !== undefined) {
            result.push({
                name: 'user_feedback',
                value: metrics.userFeedback,
                weight: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightUserFeedback,
                goal: 'maximize',
            });
        }
        
        if (metrics.systemStability !== undefined) {
            result.push({
                name: 'system_stability',
                value: metrics.systemStability,
                weight: AUTONOMY_THRESHOLD_DEFAULTS.optimization.weightSystemStability,
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

export class AutoOptimizationSystem extends IntervalLifecycle<AutoOptimizationConfig> {
    private optimizer: ParameterOptimizer;
    
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
        super({ ...DEFAULT_OPTIMIZATION_CONFIG, ...config }, 'evaluationInterval');
        this.optimizer = deps.optimizer;
    }
    protected tick(): void {
        fireAndForget(() => this.evaluateAndOptimize(), 'Error en optimizacion automatica');
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
                logCaughtError(`Error evaluando parámetro ${parameter}:`, error);
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
            'speech_recognition_confidence_threshold': OPT.parameters.speechConfidence.current,
            'ai_request_timeout': OPT.parameters.aiRequestTimeout.currentMs,
            'cache_ttl': OPT.parameters.cacheTtl.currentMs,
            'animation_speed': OPT.parameters.animationSpeed.current,
            'ui_refresh_rate': OPT.parameters.uiRefreshRate.current,
            'memory_cache_size': OPT.parameters.memoryCacheSize.current,
            'retry_max_attempts': OPT.parameters.retryMaxAttempts.current,
            'backoff_base_delay': OPT.parameters.backoffBaseDelay.currentMs,
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