// ============================================================
// Decision Engine — Toma de Decisiones Autónomas
// ============================================================
// Analiza métricas de rendimiento y toma decisiones autónomas
// para optimizar el funcionamiento de FLU.
//
// Decisiones soportadas:
//   - Cambio de proveedor de IA basado en rendimiento/costo
//   - Ajuste de parámetros de configuración
//   - Activación/desactivación de características
//   - Optimización de recursos
//   - Planificación de mantenimiento
//
// Cumple:
//   - Basado en datos históricos y en tiempo real
//   - Considera múltiples factores (rendimiento, costo, ecología)
//   - Evita cambios bruscos (histeresis)
//   - Registra justificación de cada decisión
// ============================================================

import { emitAutonomyEvent } from './autonomyEvents';

// -----------------------------------------------------------
// Tipos
// -----------------------------------------------------------

export type DecisionType = 
    | 'switch_ai_provider'
    | 'adjust_config_parameter'
    | 'toggle_feature'
    | 'optimize_resource_usage'
    | 'schedule_maintenance'
    | 'escalate_issue';

export interface DecisionFactor {
    /** Nombre del factor (ej: 'response_time', 'cost', 'accuracy') */
    name: string;
    /** Valor actual (normalizado 0-1) */
    value: number;
    /** Peso en la decisión (0-1) */
    weight: number;
    /** Tendencia (mejorando, empeorando, estable) */
    trend: 'improving' | 'worsening' | 'stable';
}

export interface DecisionOption {
    /** Opción a considerar */
    option: string;
    /** Valor esperado de esta opción (0-1, mayor = mejor) */
    expectedValue: number;
    /** Factores que apoyan esta opción */
    supportingFactors: DecisionFactor[];
    /** Riesgos asociados */
    risks: string[];
    /** Costo estimado de implementación */
    implementationCost: number;
}

export interface AutonomousDecision {
    /** Tipo de decisión */
    type: DecisionType;
    /** Opción seleccionada */
    selectedOption: string;
    /** Opciones consideradas */
    consideredOptions: DecisionOption[];
    /** Factores que influyeron */
    influencingFactors: DecisionFactor[];
    /** Justificación de la decisión */
    justification: string;
    /** Timestamp de la decisión */
    timestamp: number;
    /** Confianza en la decisión (0-1) */
    confidence: number;
    /** Acciones a ejecutar */
    actions: DecisionAction[];
}

export interface DecisionAction {
    /** Acción a realizar */
    action: string;
    /** Parámetros de la acción */
    params: Record<string, any>;
    /** Orden de ejecución */
    order: number;
    /** Dependencias de otras acciones */
    dependencies?: string[];
}

export interface DecisionEngineConfig {
    /** Habilitar toma de decisiones autónoma */
    enabled: boolean;
    /** Intervalo de evaluación (ms) */
    evaluationInterval: number;
    /** Umbral de confianza mínimo para ejecutar */
    minConfidenceThreshold: number;
    /** Considerar factores ecológicos */
    considerEcologicalFactors: boolean;
    /** Considerar factores de costo */
    considerCostFactors: boolean;
    /** Histéresis para evitar cambios frecuentes */
    hysteresisThreshold: number;
    /** Máximo de decisiones por día */
    maxDecisionsPerDay: number;
    /** Habilitar logging detallado */
    verboseLogging: boolean;
}

// -----------------------------------------------------------
// Configuración por defecto
// -----------------------------------------------------------

export const DEFAULT_DECISION_CONFIG: DecisionEngineConfig = {
    enabled: true,
    evaluationInterval: 300000, // 5 minutos
    minConfidenceThreshold: 0.7,
    considerEcologicalFactors: true,
    considerCostFactors: true,
    hysteresisThreshold: 0.15, // 15% de mejora mínima para cambiar
    maxDecisionsPerDay: 10,
    verboseLogging: false,
};

// -----------------------------------------------------------
// Métricas de rendimiento de proveedores de IA
// -----------------------------------------------------------

interface AIProviderMetrics {
    /** Proveedor (openrouter, gemini) */
    provider: string;
    /** Tiempo promedio de respuesta (ms) */
    avgResponseTime: number;
    /** Tasa de éxito (0-1) */
    successRate: number;
    /** Costo por 1000 tokens (USD) */
    costPer1kTokens: number;
    /** Emisiones de CO₂ por solicitud (g) */
    co2Emissions: number;
    /** Latencia percibida por el usuario (ms) */
    perceivedLatency: number;
    /** Calidad de respuestas (0-1, subjetivo) */
    responseQuality: number;
    /** Última actualización */
    lastUpdated: number;
    /** Número de solicitudes */
    requestCount: number;
}

// -----------------------------------------------------------
// Evaluador de factores
// -----------------------------------------------------------

class FactorEvaluator {
    private metricsHistory: Map<string, AIProviderMetrics[]> = new Map();
    private readonly maxHistorySize = 100;
    
    evaluateAIProviderFactors(currentProvider: string): DecisionFactor[] {
        const factors: DecisionFactor[] = [];
        
        // Obtener métricas para todos los proveedores
        const allMetrics = this.getAllProviderMetrics();
        const currentMetrics = allMetrics.find(m => m.provider === currentProvider);
        
        if (!currentMetrics) {
            return factors;
        }
        
        // Factor 1: Tiempo de respuesta
        const avgResponseTimeAll = allMetrics.reduce((sum, m) => sum + m.avgResponseTime, 0) / allMetrics.length;
        const responseTimeFactor = this.normalizeValue(
            currentMetrics.avgResponseTime,
            avgResponseTimeAll * 0.5, // Mejor caso: 50% del promedio
            avgResponseTimeAll * 2    // Peor caso: 200% del promedio
        );
        
        factors.push({
            name: 'response_time',
            value: 1 - responseTimeFactor, // Invertir: menor tiempo = mejor
            weight: 0.25,
            trend: this.analyzeTrend(currentMetrics.provider, 'avgResponseTime'),
        });
        
        // Factor 2: Tasa de éxito
        factors.push({
            name: 'success_rate',
            value: currentMetrics.successRate,
            weight: 0.30,
            trend: this.analyzeTrend(currentMetrics.provider, 'successRate'),
        });
        
        // Factor 3: Costo (si está habilitado)
        if (currentMetrics.costPer1kTokens > 0) {
            const minCost = Math.min(...allMetrics.map(m => m.costPer1kTokens).filter(c => c > 0));
            const maxCost = Math.max(...allMetrics.map(m => m.costPer1kTokens).filter(c => c > 0));
            
            const costFactor = this.normalizeValue(
                currentMetrics.costPer1kTokens,
                minCost,
                maxCost
            );
            
            factors.push({
                name: 'cost',
                value: 1 - costFactor, // Invertir: menor costo = mejor
                weight: 0.20,
                trend: this.analyzeTrend(currentMetrics.provider, 'costPer1kTokens'),
            });
        }
        
        // Factor 4: Impacto ecológico (si está habilitado)
        if (currentMetrics.co2Emissions > 0) {
            const minCo2 = Math.min(...allMetrics.map(m => m.co2Emissions).filter(c => c > 0));
            const maxCo2 = Math.max(...allMetrics.map(m => m.co2Emissions).filter(c => c > 0));
            
            const co2Factor = this.normalizeValue(
                currentMetrics.co2Emissions,
                minCo2,
                maxCo2
            );
            
            factors.push({
                name: 'ecological_impact',
                value: 1 - co2Factor, // Invertir: menor CO₂ = mejor
                weight: 0.15,
                trend: this.analyzeTrend(currentMetrics.provider, 'co2Emissions'),
            });
        }
        
        // Factor 5: Calidad de respuestas
        factors.push({
            name: 'response_quality',
            value: currentMetrics.responseQuality,
            weight: 0.10,
            trend: this.analyzeTrend(currentMetrics.provider, 'responseQuality'),
        });
        
        return factors;
    }
    
    evaluateSwitchAIOptions(currentProvider: string): DecisionOption[] {
        const allProviders = ['openrouter', 'gemini'];
        const options: DecisionOption[] = [];
        
        for (const provider of allProviders) {
            if (provider === currentProvider) {
                // Opción: mantener proveedor actual
                options.push(this.evaluateCurrentProviderOption(currentProvider));
            } else {
                // Opción: cambiar a otro proveedor
                options.push(this.evaluateAlternativeProviderOption(currentProvider, provider));
            }
        }
        
        return options.sort((a, b) => b.expectedValue - a.expectedValue);
    }
    
    private evaluateCurrentProviderOption(provider: string): DecisionOption {
        const factors = this.evaluateAIProviderFactors(provider);
        const weightedScore = factors.reduce((sum, f) => sum + (f.value * f.weight), 0);
        
        return {
            option: `keep_${provider}`,
            expectedValue: weightedScore,
            supportingFactors: factors.filter(f => f.value > 0.6),
            risks: [
                'Posible degradación continua si el proveedor tiene problemas',
                'Oportunidad perdida de mejor rendimiento/costo',
            ],
            implementationCost: 0, // No hay costo de cambio
        };
    }
    
    private evaluateAlternativeProviderOption(currentProvider: string, alternativeProvider: string): DecisionOption {
        const currentFactors = this.evaluateAIProviderFactors(currentProvider);
        const alternativeFactors = this.evaluateAIProviderFactors(alternativeProvider);
        
        // Calcular mejora esperada
        currentFactors.reduce((sum, f) => sum + (f.value * f.weight), 0);
        const alternativeScore = alternativeFactors.reduce((sum, f) => sum + (f.value * f.weight), 0);
        
        // Ajustar por costo de cambio (penalización por cambio frecuente)
        const changePenalty = this.calculateChangePenalty(currentProvider, alternativeProvider);
        const adjustedScore = alternativeScore - changePenalty;
        
        return {
            option: `switch_to_${alternativeProvider}`,
            expectedValue: adjustedScore,
            supportingFactors: alternativeFactors.filter(f => f.value > 0.7),
            risks: [
                'Tiempo de adaptación del sistema',
                'Posibles problemas de compatibilidad',
                'Pérdida temporal de contexto/conocimiento',
            ],
            implementationCost: 0.1, // Costo simbólico de cambio
        };
    }
    
    private normalizeValue(value: number, min: number, max: number): number {
        if (max === min) return 0.5;
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }
    
    private analyzeTrend(provider: string, metric: keyof AIProviderMetrics): 'improving' | 'worsening' | 'stable' {
        const history = this.metricsHistory.get(provider) || [];
        if (history.length < 3) return 'stable';
        
        const recent = history.slice(-3);
        const values = recent.map(m => m[metric] as number);
        
        // Calcular tendencia lineal simple
        const avgDiff = (values[2] - values[0]) / 2;
        
        if (metric === 'avgResponseTime' || metric === 'costPer1kTokens' || metric === 'co2Emissions') {
            // Para estas métricas, menor es mejor
            if (avgDiff < -0.1) return 'improving';
            if (avgDiff > 0.1) return 'worsening';
        } else {
            // Para otras métricas, mayor es mejor
            if (avgDiff > 0.1) return 'improving';
            if (avgDiff < -0.1) return 'worsening';
        }
        
        return 'stable';
    }
    
    private calculateChangePenalty(_currentProvider: string, _newProvider: string): number {
        // Penalizar cambios frecuentes
        const changeHistory = JSON.parse(localStorage.getItem('flu-provider-changes') || '[]');
        const recentChanges = changeHistory.filter((c: any) => 
            Date.now() - c.timestamp < 3600000 // Última hora
        );
        
        if (recentChanges.length >= 3) {
            return 0.5; // Penalización alta por cambios muy frecuentes
        }
        
        if (recentChanges.length >= 1) {
            return 0.2; // Penalización moderada
        }
        
        return 0; // Sin penalización
    }
    
    private getAllProviderMetrics(): AIProviderMetrics[] {
        // En una implementación real, esto obtendría métricas reales
        // Por ahora usamos datos de ejemplo basados en análisis previo
        
        return [
            {
                provider: 'openrouter',
                avgResponseTime: 12000, // Gemini 2.5 Flash Lite — 12 segundos
                successRate: 0.92,
                costPer1kTokens: 0.075, // ~$0.30/M input + ~$0.50/M output
                co2Emissions: 1.0,
                perceivedLatency: 15000,
                responseQuality: 0.90,
                lastUpdated: Date.now(),
                requestCount: 150,
            },
            {
                provider: 'gemini',
                avgResponseTime: 45000, // 45 segundos (nativo)
                successRate: 0.85,
                costPer1kTokens: 0.50,
                co2Emissions: 2.5,
                perceivedLatency: 50000,
                responseQuality: 0.88,
                lastUpdated: Date.now(),
                requestCount: 100,
            },
        ];
    }
    
    recordProviderMetrics(metrics: AIProviderMetrics): void {
        const history = this.metricsHistory.get(metrics.provider) || [];
        history.push(metrics);
        
        if (history.length > this.maxHistorySize) {
            history.shift();
        }
        
        this.metricsHistory.set(metrics.provider, history);
    }
}

// -----------------------------------------------------------
// Tomador de decisiones
// -----------------------------------------------------------

class DecisionMaker {
    private factorEvaluator: FactorEvaluator;
    private lastDecisionTime: number = 0;
    private decisionsToday: number = 0;
    
    constructor() {
        this.factorEvaluator = new FactorEvaluator();
        this.loadDailyDecisionCount();
    }
    
    evaluateAISwitchDecision(currentProvider: string): AutonomousDecision | null {
        const now = Date.now();
        
        // Verificar límite diario
        if (this.decisionsToday >= 10) { // DEFAULT_DECISION_CONFIG.maxDecisionsPerDay
            return null;
        }
        
        // Verificar intervalo mínimo desde última decisión
        if (now - this.lastDecisionTime < 300000) { // 5 minutos
            return null;
        }
        
        // Evaluar opciones
        const options = this.factorEvaluator.evaluateSwitchAIOptions(currentProvider);
        const factors = this.factorEvaluator.evaluateAIProviderFactors(currentProvider);
        
        // Seleccionar mejor opción
        const bestOption = options[0];
        const currentOption = options.find(o => o.option === `keep_${currentProvider}`);
        
        if (!bestOption || !currentOption) {
            return null;
        }
        
        // Calcular mejora
        const improvement = bestOption.expectedValue - currentOption.expectedValue;
        
        // Aplicar histéresis: solo cambiar si la mejora supera el umbral
        if (improvement < 0.15) { // DEFAULT_DECISION_CONFIG.hysteresisThreshold
            return null;
        }
        
        // Calcular confianza
        const confidence = this.calculateConfidence(bestOption, factors, improvement);
        
        if (confidence < 0.7) { // DEFAULT_DECISION_CONFIG.minConfidenceThreshold
            return null;
        }
        
        // Crear decisión
        const decision: AutonomousDecision = {
            type: 'switch_ai_provider',
            selectedOption: bestOption.option,
            consideredOptions: options,
            influencingFactors: factors,
            justification: this.generateJustification(bestOption, currentOption, improvement, factors),
            timestamp: now,
            confidence,
            actions: this.generateSwitchActions(bestOption.option, currentProvider),
        };
        
        // Actualizar contadores
        this.lastDecisionTime = now;
        this.decisionsToday++;
        this.saveDailyDecisionCount();
        
        return decision;
    }
    
    private calculateConfidence(
        bestOption: DecisionOption,
        factors: DecisionFactor[],
        improvement: number
    ): number {
        let confidence = 0.5; // Base
        
        // Aumentar confianza basado en mejora
        confidence += Math.min(0.3, improvement * 2);
        
        // Aumentar confianza basado en factores de apoyo
        const strongSupport = bestOption.supportingFactors.filter(f => f.value > 0.8).length;
        confidence += strongSupport * 0.05;
        
        // Reducir confianza basado en riesgos
        confidence -= bestOption.risks.length * 0.05;
        
        // Aumentar confianza si hay tendencias claras
        const improvingTrends = factors.filter(f => f.trend === 'improving').length;
        const worseningTrends = factors.filter(f => f.trend === 'worsening').length;
        
        if (improvingTrends > worseningTrends * 2) {
            confidence += 0.1;
        }
        
        return Math.max(0, Math.min(1, confidence));
    }
    
    private generateJustification(
        bestOption: DecisionOption,
        currentOption: DecisionOption,
        improvement: number,
        factors: DecisionFactor[]
    ): string {
        const providerName = bestOption.option.startsWith('switch_to_') 
            ? bestOption.option.replace('switch_to_', '')
            : 'current';
        
        const improvementPercent = Math.round(improvement * 100);
        
        const topFactors = factors
            .sort((a, b) => (b.value * b.weight) - (a.value * a.weight))
            .slice(0, 3);
        
        const factorDescriptions = topFactors.map(f => 
            `${f.name}: ${Math.round(f.value * 100)}% (${f.trend})`
        ).join(', ');
        
        return `Recomendado cambiar a ${providerName} con ${improvementPercent}% de mejora esperada. ` +
               `Factores principales: ${factorDescriptions}. ` +
               `Esta decisión considera rendimiento, costo e impacto ecológico.`;
    }
    
    private generateSwitchActions(selectedOption: string, currentProvider: string): DecisionAction[] {
        if (selectedOption.startsWith('keep_')) {
            return [{
                action: 'monitor_continue',
                params: { provider: currentProvider, reason: 'optimal_performance' },
                order: 1,
            }];
        }
        
        const newProvider = selectedOption.replace('switch_to_', '');
        
        return [
            {
                action: 'update_provider_config',
                params: { newProvider, oldProvider: currentProvider },
                order: 1,
                dependencies: [],
            },
            {
                action: 'notify_system',
                params: { 
                    message: `AI provider switching from ${currentProvider} to ${newProvider}`,
                    type: 'info'
                },
                order: 2,
                dependencies: ['update_provider_config'],
            },
            {
                action: 'record_decision',
                params: { 
                    decisionType: 'switch_ai_provider',
                    from: currentProvider,
                    to: newProvider,
                    timestamp: Date.now()
                },
                order: 3,
                dependencies: ['update_provider_config', 'notify_system'],
            },
        ];
    }
    
    private loadDailyDecisionCount(): void {
        const today = new Date().toDateString();
        const stored = localStorage.getItem('flu-decisions-today');
        
        if (stored) {
            const { date, count } = JSON.parse(stored);
            if (date === today) {
                this.decisionsToday = count;
            } else {
                this.decisionsToday = 0;
            }
        }
    }
    
    private saveDailyDecisionCount(): void {
        const today = new Date().toDateString();
        localStorage.setItem('flu-decisions-today', JSON.stringify({
            date: today,
            count: this.decisionsToday,
        }));
    }
    
    resetDailyCount(): void {
        this.decisionsToday = 0;
        this.saveDailyDecisionCount();
    }
}

// -----------------------------------------------------------
// Clase principal del Decision Engine
// -----------------------------------------------------------

export class DecisionEngine {
    private config: DecisionEngineConfig;
    private decisionMaker: DecisionMaker;
    private factorEvaluator: FactorEvaluator;
    private evaluationIntervalId: number | null = null;
    private decisionHistory: AutonomousDecision[] = [];
    
    /**
     * Fábrica por defecto del motor. Punto de composición del singleton:
     * permite inyectar otra fábrica vía setDecisionEngineFactory (§2.4).
     */
    static create(config: Partial<DecisionEngineConfig> = {}): DecisionEngine {
        return new this(config);
    }
    
    constructor(config: Partial<DecisionEngineConfig> = {}) {
        this.config = { ...DEFAULT_DECISION_CONFIG, ...config };
        this.decisionMaker = new DecisionMaker();
        this.factorEvaluator = new FactorEvaluator();
    }
    
    start(): void {
        if (this.evaluationIntervalId !== null || !this.config.enabled) {
            return;
        }
        
        this.evaluationIntervalId = window.setInterval(() => {
            this.evaluateAndDecide().catch(error => {
                console.error('Error en evaluación de decisiones:', error);
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
    
    async evaluateAndDecide(): Promise<AutonomousDecision | null> {
        if (!this.config.enabled) {
            return null;
        }
        
        // Obtener proveedor actual
        const currentProvider = localStorage.getItem('flu-ai-provider') || 'openrouter';
        
        // Evaluar decisión de cambio de proveedor
        const decision = this.decisionMaker.evaluateAISwitchDecision(currentProvider);
        
        if (!decision) {
            return null;
        }
        
        // Ejecutar acciones si la confianza es suficiente
        if (decision.confidence >= this.config.minConfidenceThreshold) {
            await this.executeDecisionActions(decision);
            
            // Registrar decisión
            this.decisionHistory.push(decision);
            
            // Limitar historial
            if (this.decisionHistory.length > 50) {
                this.decisionHistory = this.decisionHistory.slice(-50);
            }
        }
        
        return decision;
    }
    
    private async executeDecisionActions(decision: AutonomousDecision): Promise<void> {
        // Ordenar acciones por orden
        const sortedActions = [...decision.actions].sort((a, b) => a.order - b.order);
        
        for (const action of sortedActions) {
            try {
                await this.executeSingleAction(action, decision);
            } catch (error) {
                console.error(`Error ejecutando acción ${action.action}:`, error);
                // Continuar con siguientes acciones si es posible
            }
        }
    }
    
    private async executeSingleAction(action: DecisionAction, decision: AutonomousDecision): Promise<void> {
        switch (action.action) {
            case 'update_provider_config':
                await this.executeUpdateProviderConfig(action.params);
                break;
                
            case 'notify_system':
                await this.executeNotifySystem(action.params);
                break;
                
            case 'record_decision':
                await this.executeRecordDecision(action.params, decision);
                break;
                
            case 'monitor_continue':
                // No action needed
                break;
                
            default:
                console.warn(`Acción no implementada: ${action.action}`);
        }
    }
    
    private async executeUpdateProviderConfig(params: any): Promise<void> {
        const { newProvider, oldProvider } = params;
        
        // Actualizar configuración
        localStorage.setItem('flu-ai-provider', newProvider);
        
        // Registrar cambio
        const changeHistory = JSON.parse(localStorage.getItem('flu-provider-changes') || '[]');
        changeHistory.push({
            from: oldProvider,
            to: newProvider,
            timestamp: Date.now(),
            reason: 'autonomous_decision',
        });
        
        // Limitar historial
        if (changeHistory.length > 100) {
            changeHistory.shift();
        }
        
        localStorage.setItem('flu-provider-changes', JSON.stringify(changeHistory));
        
        // Notificar del cambio de proveedor vía bus central de autonomía
        emitAutonomyEvent({
            type: 'ai-provider-changed',
            level: 'info',
            message: `Proveedor de IA cambiado: ${oldProvider} → ${newProvider}`,
            detail: { oldProvider, newProvider },
        });
    }
    
    private async executeNotifySystem(params: any): Promise<void> {
        const { message, type } = params;
        
        emitAutonomyEvent({
            type: 'system-notification',
            level: type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info',
            message: message || 'Notificación del sistema',
            detail: { source: 'decision_engine' },
        });
    }
    
    private async executeRecordDecision(params: any, decision: AutonomousDecision): Promise<void> {
        const decisionHistory = JSON.parse(localStorage.getItem('flu-autonomous-decisions') || '[]');
        
        decisionHistory.push({
            ...decision,
            executedAt: Date.now(),
        });
        
        // Limitar historial
        if (decisionHistory.length > 100) {
            decisionHistory.shift();
        }
        
        localStorage.setItem('flu-autonomous-decisions', JSON.stringify(decisionHistory));
    }
    
    getDecisionHistory(): AutonomousDecision[] {
        return [...this.decisionHistory];
    }
    
    getRecentDecisions(count: number = 10): AutonomousDecision[] {
        return this.decisionHistory.slice(-count).reverse();
    }
    
    clearDecisionHistory(): void {
        this.decisionHistory = [];
    }
    
    updateConfig(newConfig: Partial<DecisionEngineConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Reiniciar si el intervalo cambió
        if (this.evaluationIntervalId !== null && newConfig.evaluationInterval) {
            this.stop();
            this.start();
        }
    }
    
    getConfig(): DecisionEngineConfig {
        return { ...this.config };
    }
    
    recordProviderMetrics(provider: string, metrics: Partial<AIProviderMetrics>): void {
        const fullMetrics: AIProviderMetrics = {
            provider,
            avgResponseTime: metrics.avgResponseTime || 0,
            successRate: metrics.successRate || 0,
            costPer1kTokens: metrics.costPer1kTokens || 0,
            co2Emissions: metrics.co2Emissions || 0,
            perceivedLatency: metrics.perceivedLatency || 0,
            responseQuality: metrics.responseQuality || 0,
            lastUpdated: Date.now(),
            requestCount: metrics.requestCount || 0,
        };
        
        this.factorEvaluator.recordProviderMetrics(fullMetrics);
    }
}

// -----------------------------------------------------------
// Instancia global (singleton)
// -----------------------------------------------------------

let globalDecisionEngine: DecisionEngine | null = null;

/** Fábrica inyectable del motor global (seam de DI, §2.4). */
export type DecisionEngineFactory = (config?: Partial<DecisionEngineConfig>) => DecisionEngine;

let decisionEngineFactory: DecisionEngineFactory = (config) => DecisionEngine.create(config);

/**
 * Inyecta la fábrica usada al crear el motor global. Debe llamarse antes de
 * la primera creación; si el singleton ya existe, esta llamada no lo reemplaza.
 */
export function setDecisionEngineFactory(factory: DecisionEngineFactory): void {
    decisionEngineFactory = factory;
}

export function getDecisionEngine(config?: Partial<DecisionEngineConfig>): DecisionEngine {
    if (!globalDecisionEngine) {
        globalDecisionEngine = decisionEngineFactory(config);
    }
    return globalDecisionEngine;
}

export function startGlobalDecisionEngine(config?: Partial<DecisionEngineConfig>): DecisionEngine {
    const engine = getDecisionEngine(config);
    engine.start();
    return engine;
}

export function stopGlobalDecisionEngine(): void {
    if (globalDecisionEngine) {
        globalDecisionEngine.stop();
    }
}

export function getRecentAutonomousDecisions(count: number = 5): AutonomousDecision[] {
    return globalDecisionEngine?.getRecentDecisions(count) || [];
}