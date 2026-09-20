// ============================================================
// Health Monitor — Monitoreo de Salud del Sistema FLU
// ============================================================
// Monitorea el estado de todos los componentes críticos del sistema
// y genera diagnósticos para recuperación automática.
//
// Componentes monitoreados:
//   - Servicios de IA (OpenRouter → Gemini / Pollinations)
//   - Reconocimiento de voz (Web Speech API)
//   - Síntesis de voz (SpeechSynthesis)
//   - Base de datos IndexedDB
//   - Estado de memoria/CPU
//   - Conexión de red
//   - Estado de componentes React
//
// Cumple:
//   - Monitoreo continuo con intervalos configurables
//   - Umbrales adaptativos basados en historial
//   - Alertas tempranas antes de fallos críticos
//   - Integración con sistema de recuperación automática
// ============================================================

import { NETWORK_PROBE_URLS, buildTextApiUrl, isLocalTextEndpoint, resolveTextApiKey, TIMEOUT_POLICY_MS } from '../config/appConfig';
import { fetchTextEngine } from '../ai/httpClient';
import { AUTONOMY_THRESHOLD_DEFAULTS } from '../config/sharedConfig';
import { isSpeechSupported, getSpeechVoices } from '../../voice/lib/fluSpeech';

// -----------------------------------------------------------
// Tipos
// -----------------------------------------------------------

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'critical';

export interface ComponentHealth {
    /** Nombre del componente (ej: 'ai-service', 'speech-recognition') */
    name: string;
    /** Estado actual */
    status: HealthStatus;
    /** Última verificación (timestamp) */
    lastCheck: number;
    /** Métricas específicas del componente */
    metrics: Record<string, number | string | boolean>;
    /** Mensaje descriptivo del estado */
    message: string;
    /** Umbrales de advertencia para este componente */
    thresholds: ComponentThresholds;
}

export interface ComponentThresholds {
    /** Tiempo máximo de respuesta en ms */
    responseTimeMax: number;
    /** Tasa de error máxima (0-1) */
    errorRateMax: number;
    /** Disponibilidad mínima (0-1) */
    availabilityMin: number;
    /** Intervalo de verificación en ms */
    checkInterval: number;
}

export interface SystemHealth {
    /** Estado general del sistema */
    overallStatus: HealthStatus;
    /** Salud por componente */
    components: Record<string, ComponentHealth>;
    /** Última actualización */
    timestamp: number;
    /** Recomendaciones de acción */
    recommendations: string[];
    /** Métricas agregadas */
    aggregatedMetrics: {
        /** Tasa de disponibilidad promedio */
        availability: number;
        /** Tiempo de respuesta promedio */
        avgResponseTime: number;
        /** Tasa de error promedio */
        errorRate: number;
        /** Uptime del sistema en segundos */
        uptime: number;
    };
}

export interface HealthMonitorConfig {
    /** Intervalo de monitoreo general en ms */
    monitoringInterval: number;
    /** Umbral para estado degradado (0-1) */
    degradedThreshold: number;
    /** Umbral para estado crítico (0-1) */
    criticalThreshold: number;
    /** Habilitar recuperación automática */
    autoRecoveryEnabled: boolean;
    /** Componentes a monitorear */
    monitoredComponents: string[];
    /** Habilitar logging detallado */
    verboseLogging: boolean;
}

// -----------------------------------------------------------
// Configuración por defecto
// -----------------------------------------------------------

export const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
    monitoringInterval: 30000, // 30 segundos
    degradedThreshold: AUTONOMY_THRESHOLD_DEFAULTS.health.degraded,   // 85% de salud
    criticalThreshold: AUTONOMY_THRESHOLD_DEFAULTS.health.critical,   // 60% de salud
    autoRecoveryEnabled: false, // Deshabilitado por defecto - se habilita solo para componentes específicos
    monitoredComponents: [
        'ai-service',
        'indexed-db',
        'network',
        'memory',
        'react-components',
        // NOTA: 'speech-recognition' y 'speech-synthesis' están EXCLUIDOS por defecto
        // Estos componentes son manejados por el sistema de voz (useFluVoiceAssistant)
        // y no necesitan monitoreo autónomo
    ],
    verboseLogging: false,
};

// -----------------------------------------------------------
// Umbrales por componente
// -----------------------------------------------------------

const COMPONENT_THRESHOLDS: Record<string, ComponentThresholds> = {
    'ai-service': {
        responseTimeMax: 10000,    // 10 segundos máximo
        errorRateMax: 0.2,         // 20% máximo de errores
        availabilityMin: AUTONOMY_THRESHOLD_DEFAULTS.health.aiAvailabilityMin,     // 95% mínimo de disponibilidad
        checkInterval: 15000,      // Verificar cada 15 segundos
    },
    'speech-recognition': {
        responseTimeMax: 5000,     // 5 segundos máximo
        errorRateMax: 0.3,         // 30% máximo de errores
        availabilityMin: AUTONOMY_THRESHOLD_DEFAULTS.health.speechRecognitionAvailabilityMin,     // 90% mínimo de disponibilidad
        checkInterval: 10000,      // Verificar cada 10 segundos
    },
    'speech-synthesis': {
        responseTimeMax: 3000,     // 3 segundos máximo
        errorRateMax: AUTONOMY_THRESHOLD_DEFAULTS.health.ttsErrorRateMax,        // 15% máximo de errores
        availabilityMin: AUTONOMY_THRESHOLD_DEFAULTS.health.ttsAvailabilityMin,     // 98% mínimo de disponibilidad
        checkInterval: 10000,      // Verificar cada 10 segundos
    },
    'indexed-db': {
        responseTimeMax: 2000,     // 2 segundos máximo
        errorRateMax: 0.1,         // 10% máximo de errores
        availabilityMin: AUTONOMY_THRESHOLD_DEFAULTS.health.indexedDbAvailabilityMin,     // 99% mínimo de disponibilidad
        checkInterval: 20000,      // Verificar cada 20 segundos
    },
    'network': {
        responseTimeMax: 3000,     // 3 segundos máximo
        errorRateMax: AUTONOMY_THRESHOLD_DEFAULTS.health.networkErrorRateMax,        // 25% máximo de errores
        availabilityMin: AUTONOMY_THRESHOLD_DEFAULTS.health.networkAvailabilityMin,     // 85% mínimo de disponibilidad
        checkInterval: 5000,       // Verificar cada 5 segundos
    },
    'memory': {
        responseTimeMax: 1000,     // 1 segundo máximo
        errorRateMax: AUTONOMY_THRESHOLD_DEFAULTS.health.memoryErrorRateMax,        // 5% máximo de errores
        availabilityMin: AUTONOMY_THRESHOLD_DEFAULTS.health.memoryAvailabilityMin,     // 95% mínimo de disponibilidad
        checkInterval: 30000,      // Verificar cada 30 segundos
    },
    'react-components': {
        responseTimeMax: 1000,     // 1 segundo máximo
        errorRateMax: 0.1,         // 10% máximo de errores
        availabilityMin: AUTONOMY_THRESHOLD_DEFAULTS.health.reactComponentsAvailabilityMin,     // 98% mínimo de disponibilidad
        checkInterval: 30000,      // Verificar cada 30 segundos
    },
};

// -----------------------------------------------------------
// Historial de métricas
// -----------------------------------------------------------

interface MetricHistory {
    responseTimes: number[];
    errorCounts: number[];
    checkCounts: number[];
    timestamps: number[];
}

class HealthMetricTracker {
    private history: Map<string, MetricHistory> = new Map();
    private readonly maxHistorySize = 100;

    recordMetric(component: string, responseTime: number, hasError: boolean): void {
        if (!this.history.has(component)) {
            this.history.set(component, {
                responseTimes: [],
                errorCounts: [],
                checkCounts: [],
                timestamps: [],
            });
        }

        const hist = this.history.get(component)!;
        hist.responseTimes.push(responseTime);
        hist.errorCounts.push(hasError ? 1 : 0);
        hist.checkCounts.push(1);
        hist.timestamps.push(Date.now());

        // Mantener tamaño máximo
        if (hist.responseTimes.length > this.maxHistorySize) {
            hist.responseTimes.shift();
            hist.errorCounts.shift();
            hist.checkCounts.shift();
            hist.timestamps.shift();
        }
    }

    getComponentMetrics(component: string): {
        avgResponseTime: number;
        errorRate: number;
        availability: number;
        totalChecks: number;
    } {
        const hist = this.history.get(component);
        if (!hist || hist.responseTimes.length === 0) {
            return {
                avgResponseTime: 0,
                errorRate: 0,
                availability: 1,
                totalChecks: 0,
            };
        }

        const totalChecks = hist.checkCounts.length;
        const totalErrors = hist.errorCounts.reduce((a, b) => a + b, 0);
        const totalResponseTime = hist.responseTimes.reduce((a, b) => a + b, 0);

        return {
            avgResponseTime: totalResponseTime / totalChecks,
            errorRate: totalErrors / totalChecks,
            availability: 1 - (totalErrors / totalChecks),
            totalChecks,
        };
    }

    clearHistory(component?: string): void {
        if (component) {
            this.history.delete(component);
        } else {
            this.history.clear();
        }
    }
}

// -----------------------------------------------------------
// Verificadores de componentes
// -----------------------------------------------------------

async function checkAIService(): Promise<ComponentHealth> {
    const startTime = Date.now();
    let hasError = false;
    let message = 'Servicio de IA funcionando correctamente';
    const metrics: Record<string, number | string | boolean> = {};

    try {
        // Verificar si hay API key configurada (Texto: OpenRouter/Gemini).
        // Los endpoints remotos son auth-gated: sin key el HEAD devolvería un
        // 401 garantizado (ruido en consola + falso "critical" para autoRecovery),
        // así que solo se sondea cuando hay credencial o el endpoint es local.
        const apiKey = resolveTextApiKey();
        metrics.hasApiKey = Boolean(apiKey);

        const testUrl = buildTextApiUrl('/models');
        const isLocalEndpoint = isLocalTextEndpoint(testUrl);
        const canProbe = Boolean(apiKey) || isLocalEndpoint;

        if (!canProbe) {
            hasError = true;
            message = 'No hay API key configurada para servicios de IA remotos';
        } else {
            // Verificar conectividad real enviando la credencial (HEAD autorizado)
            try {
                const response = await fetchTextEngine(
                    testUrl,
                    {
                        method: 'HEAD',
                        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
                    },
                    TIMEOUT_POLICY_MS.healthProbeAbort,
                );
                metrics.networkReachable = response.ok;
                if (!response.ok) {
                    hasError = true;
                    message = `Servicio de IA no responde correctamente (HTTP ${response.status})`;
                }
            } catch {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts');
                hasError = true;
                message = 'Error de conexión con servicio de IA';
                metrics.networkReachable = false;
            }
        }
    } catch (error) {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts:', error);
        hasError = true;
        message = `Error verificando servicio de IA: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }

    const responseTime = Date.now() - startTime;
    const thresholds = COMPONENT_THRESHOLDS['ai-service'];
    const status = determineComponentStatus(responseTime, hasError, thresholds);

    return {
        name: 'ai-service',
        status,
        lastCheck: Date.now(),
        metrics: {
            ...metrics,
            responseTime,
            hasError,
        },
        message,
        thresholds,
    };
}

async function checkSpeechRecognition(): Promise<ComponentHealth> {
    const startTime = Date.now();
    let hasError = false;
    let message = 'Reconocimiento de voz disponible';
    const metrics: Record<string, number | string | boolean> = {};

    try {
        // §9 Motor de escucha: Chrome SpeechRecognition (Google, online).
        const hasSpeechRecognition =
            typeof window !== 'undefined' &&
            Boolean((window as Window & { SpeechRecognition?: unknown }).SpeechRecognition ||
                (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
        if (!hasSpeechRecognition) {
            hasError = true;
            message = 'SpeechRecognition no disponible en este navegador';
            metrics.apiAvailable = false;
        } else {
            metrics.apiAvailable = true;
        }

        // Verificar permiso de micrófono SIN abrir un segundo stream: la captura
        // la posee el motor único de escucha. Abrir otro getUserMedia aquí era
        // una segunda captura del mismo micrófono (ruta doble).
        if (navigator.permissions?.query) {
            try {
                const permission = await navigator.permissions.query({
                    name: 'microphone' as PermissionName,
                });
                metrics.microphonePermission = permission.state !== 'denied';
                if (permission.state === 'denied') {
                    hasError = true;
                    message = 'Permiso de micrófono no concedido';
                }
            } catch {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts');
                metrics.microphonePermission = 'unknown';
            }
        } else {
            metrics.microphonePermission = 'unknown';
        }
    } catch (error) {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts:', error);
        hasError = true;
        message = `Error verificando reconocimiento de voz: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }

    const responseTime = Date.now() - startTime;
    const thresholds = COMPONENT_THRESHOLDS['speech-recognition'];
    const status = determineComponentStatus(responseTime, hasError, thresholds);

    return {
        name: 'speech-recognition',
        status,
        lastCheck: Date.now(),
        metrics: {
            ...metrics,
            responseTime,
            hasError,
        },
        message,
        thresholds,
    };
}

async function checkSpeechSynthesis(): Promise<ComponentHealth> {
    const startTime = Date.now();
    let hasError = false;
    let message = 'Síntesis de voz disponible';
    const metrics: Record<string, number | string | boolean> = {};

    try {
        // Verificar si la síntesis de voz está disponible
        if (!isSpeechSupported()) {
            hasError = true;
            message = 'Síntesis de voz no disponible en este navegador';
            metrics.apiAvailable = false;
        } else {
            metrics.apiAvailable = true;
            
            // Verificar voces disponibles
            const voices = getSpeechVoices();
            metrics.voiceCount = voices.length;
            metrics.hasSpanishVoice = voices.some(voice => 
                voice.lang.startsWith('es') || voice.lang.includes('es')
            );
            
            if (voices.length === 0) {
                hasError = true;
                message = 'No hay voces disponibles para síntesis de voz';
            }
        }
    } catch (error) {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts:', error);
        hasError = true;
        message = `Error verificando síntesis de voz: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }

    const responseTime = Date.now() - startTime;
    const thresholds = COMPONENT_THRESHOLDS['speech-synthesis'];
    const status = determineComponentStatus(responseTime, hasError, thresholds);

    return {
        name: 'speech-synthesis',
        status,
        lastCheck: Date.now(),
        metrics: {
            ...metrics,
            responseTime,
            hasError,
        },
        message,
        thresholds,
    };
}

async function checkIndexedDB(): Promise<ComponentHealth> {
    const startTime = Date.now();
    let hasError = false;
    let message = 'Base de datos IndexedDB funcionando';
    const metrics: Record<string, number | string | boolean> = {};

    try {
        // Verificar si IndexedDB está disponible
        if (!('indexedDB' in window)) {
            hasError = true;
            message = 'IndexedDB no disponible en este navegador';
            metrics.apiAvailable = false;
        } else {
            metrics.apiAvailable = true;
            
            // Intentar abrir una base de datos de prueba
            const testDbName = 'flu-health-test';
            const request = indexedDB.open(testDbName, 1);
            
            await new Promise<void>((resolve, reject) => {
                request.onerror = () => {
                    hasError = true;
                    message = 'Error abriendo base de datos IndexedDB';
                    reject(new Error('IndexedDB open failed'));
                };
                
                request.onsuccess = () => {
                    const db = request.result;
                    db.close();
                    // Eliminar la base de datos de prueba
                    indexedDB.deleteDatabase(testDbName);
                    resolve();
                };
                
                request.onupgradeneeded = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    db.createObjectStore('test');
                };
            });
        }
    } catch (error) {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts:', error);
        hasError = true;
        message = `Error verificando IndexedDB: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }

    const responseTime = Date.now() - startTime;
    const thresholds = COMPONENT_THRESHOLDS['indexed-db'];
    const status = determineComponentStatus(responseTime, hasError, thresholds);

    return {
        name: 'indexed-db',
        status,
        lastCheck: Date.now(),
        metrics: {
            ...metrics,
            responseTime,
            hasError,
        },
        message,
        thresholds,
    };
}

async function checkNetwork(): Promise<ComponentHealth> {
    const startTime = Date.now();
    let hasError = false;
    let message = 'Conexión de red estable';
    const metrics: Record<string, number | string | boolean> = {};

    try {
        // Verificar conectividad
        const testUrls = NETWORK_PROBE_URLS;
        
        let successfulPings = 0;
        const pingResults: number[] = [];
        
        for (const url of testUrls) {
            const pingStart = Date.now();
            try {
                await fetchTextEngine(
                    url,
                    {
                        method: 'HEAD',
                        mode: 'no-cors',
                    },
                    TIMEOUT_POLICY_MS.networkPingAbort,
                );
                
                successfulPings++;
                pingResults.push(Date.now() - pingStart);
            } catch {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts');
                // Ignorar errores individuales
            }
        }
        
        metrics.successfulPings = successfulPings;
        metrics.totalPings = testUrls.length;
        metrics.successRate = successfulPings / testUrls.length;
        
        if (pingResults.length > 0) {
            metrics.avgPingTime = pingResults.reduce((a, b) => a + b, 0) / pingResults.length;
        }
        
        if (successfulPings === 0) {
            hasError = true;
            message = 'Sin conectividad de red';
        } else if (successfulPings < testUrls.length / 2) {
            hasError = true;
            message = 'Conectividad de red limitada';
        }
    } catch (error) {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts:', error);
        hasError = true;
        message = `Error verificando red: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }

    const responseTime = Date.now() - startTime;
    const thresholds = COMPONENT_THRESHOLDS['network'];
    const status = determineComponentStatus(responseTime, hasError, thresholds);

    return {
        name: 'network',
        status,
        lastCheck: Date.now(),
        metrics: {
            ...metrics,
            responseTime,
            hasError,
        },
        message,
        thresholds,
    };
}

/** performance.memory no está en el lib DOM (solo Chrome): tipo mínimo. */
interface PerformanceMemory {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
}

async function checkMemory(): Promise<ComponentHealth> {
    const startTime = Date.now();
    let hasError = false;
    let message = 'Memoria dentro de límites normales';
    const metrics: Record<string, number | string | boolean> = {};

    try {
        // Verificar uso de memoria (si está disponible)
        const perfMemory = (performance as Performance & { memory?: PerformanceMemory }).memory;
        if (perfMemory) {
            metrics.usedJSHeapSize = perfMemory.usedJSHeapSize;
            metrics.totalJSHeapSize = perfMemory.totalJSHeapSize;
            metrics.jsHeapSizeLimit = perfMemory.jsHeapSizeLimit;
            
            const usageRatio = perfMemory.usedJSHeapSize / perfMemory.jsHeapSizeLimit;
            metrics.usageRatio = usageRatio;
            
            if (usageRatio > 0.9) {
                hasError = true;
                message = 'Uso de memoria crítico (>90%)';
            } else if (usageRatio > AUTONOMY_THRESHOLD_DEFAULTS.health.loadWarnRatio) {
                hasError = true;
                message = 'Uso de memoria elevado (>75%)';
            }
        } else {
            metrics.memoryApiAvailable = false;
        }
        
        // Verificar rendimiento general
        metrics.navigationTiming = performance.timing.loadEventEnd - performance.timing.navigationStart;
        metrics.nowPerformance = performance.now();
    } catch (error) {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts:', error);
        hasError = true;
        message = `Error verificando memoria: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }

    const responseTime = Date.now() - startTime;
    const thresholds = COMPONENT_THRESHOLDS['memory'];
    const status = determineComponentStatus(responseTime, hasError, thresholds);

    return {
        name: 'memory',
        status,
        lastCheck: Date.now(),
        metrics: {
            ...metrics,
            responseTime,
            hasError,
        },
        message,
        thresholds,
    };
}

async function checkReactComponents(): Promise<ComponentHealth> {
    const startTime = Date.now();
    let hasError = false;
    let message = 'Componentes React funcionando';
    const metrics: Record<string, number | string | boolean> = {};

    try {
        // Verificar errores en componentes (simulado)
        // En una implementación real, esto se integraría con ErrorBoundary
        metrics.errorBoundaryActive = true;
        
        // Verificar si hay errores recientes en la consola
        // (esto es una simulación - en producción se usaría un servicio de logging)
        const consoleErrors = window.__FLU_CONSOLE_ERRORS || [];
        metrics.recentConsoleErrors = consoleErrors.length;
        
        if (consoleErrors.length > 10) {
            hasError = true;
            message = 'Demasiados errores en consola';
        }
    } catch (error) {
        console.warn('[catch] src/core/autonomy/healthMonitor.ts:', error);
        hasError = true;
        message = `Error verificando componentes React: ${error instanceof Error ? error.message : 'Error desconocido'}`;
    }

    const responseTime = Date.now() - startTime;
    const thresholds = COMPONENT_THRESHOLDS['react-components'];
    const status = determineComponentStatus(responseTime, hasError, thresholds);

    return {
        name: 'react-components',
        status,
        lastCheck: Date.now(),
        metrics: {
            ...metrics,
            responseTime,
            hasError,
        },
        message,
        thresholds,
    };
}

// -----------------------------------------------------------
// Helper functions
// -----------------------------------------------------------

function determineComponentStatus(
    responseTime: number,
    hasError: boolean,
    thresholds: ComponentThresholds
): HealthStatus {
    if (hasError) {
        return 'critical';
    }
    
    if (responseTime > thresholds.responseTimeMax * 1.5) {
        return 'critical';
    }
    
    if (responseTime > thresholds.responseTimeMax) {
        return 'unhealthy';
    }
    
    return 'healthy';
}

function calculateOverallStatus(components: ComponentHealth[]): HealthStatus {
    if (components.length === 0) return 'healthy';
    
    const statusWeights: Record<HealthStatus, number> = {
        'critical': 0,
        'unhealthy': 0.3,
        'degraded': 0.7,
        'healthy': 1,
    };
    
    const totalWeight = components.reduce((sum, comp) => {
        return sum + statusWeights[comp.status];
    }, 0);
    
    const averageWeight = totalWeight / components.length;
    
    if (averageWeight < 0.3) return 'critical';
    if (averageWeight < 0.6) return 'unhealthy';
    if (averageWeight < AUTONOMY_THRESHOLD_DEFAULTS.health.weightDegraded) return 'degraded';
    return 'healthy';
}

// -----------------------------------------------------------
// Clase principal del monitor de salud
// -----------------------------------------------------------

export class HealthMonitor {
    private config: HealthMonitorConfig;
    private metricTracker: HealthMetricTracker;
    private monitoringIntervalId: number | null = null;
    private startPromise: Promise<void> | null = null;
    private lastSystemHealth: SystemHealth | null = null;
    private listeners: Array<(health: SystemHealth) => void> = [];
    private componentCheckers: Record<string, () => Promise<ComponentHealth>>;

    /** Punto de composición de dependencias (§2.4). */
    static create(
        config: Partial<HealthMonitorConfig> = {},
        deps: { metricTracker?: HealthMetricTracker } = {},
    ): HealthMonitor {
        return new HealthMonitor(config, {
            metricTracker: deps.metricTracker ?? new HealthMetricTracker(),
        });
    }

    constructor(
        config: Partial<HealthMonitorConfig> = {},
        deps: { metricTracker: HealthMetricTracker },
    ) {
        this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
        this.metricTracker = deps.metricTracker;
        
        this.componentCheckers = {
            'ai-service': checkAIService,
            'speech-recognition': checkSpeechRecognition,
            'speech-synthesis': checkSpeechSynthesis,
            'indexed-db': checkIndexedDB,
            'network': checkNetwork,
            'memory': checkMemory,
            'react-components': checkReactComponents,
        };
    }

    async start(): Promise<void> {
        // Si el monitoreo ya está en marcha (intervalo activo), no hacer nada.
        if (this.monitoringIntervalId !== null) {
            return;
        }

        // Guard anti-reentrancia: si ya hay un arranque en curso (la verificación
        // inicial aún está pendiente porque se hace ANTES de crear el intervalo),
        // esperar al mismo arranque en lugar de lanzar otra verificación inicial.
        // Esto evita que llamadas start() concurrentes disparen un flood de
        // checkNetwork/performHealthCheck duplicados.
        if (this.startPromise !== null) {
            return this.startPromise;
        }

        this.startPromise = (async () => {
            // Ejecutar verificación inicial
            await this.performHealthCheck();

            // Configurar intervalo de monitoreo
            this.monitoringIntervalId = window.setInterval(() => {
                this.performHealthCheck().catch(error => {
                    console.error('Error en verificación de salud:', error);
                });
            }, this.config.monitoringInterval);

            if (this.config.verboseLogging) {
            }
        })().finally(() => {
            this.startPromise = null;
        });

        return this.startPromise;
    }

    stop(): void {
        if (this.monitoringIntervalId !== null) {
            clearInterval(this.monitoringIntervalId);
            this.monitoringIntervalId = null;
        }
        
        if (this.config.verboseLogging) {
        }
    }

    async performHealthCheck(): Promise<SystemHealth> {
        Date.now();
        const components: ComponentHealth[] = [];
        const recommendations: string[] = [];

        // Verificar cada componente configurado
        for (const componentName of this.config.monitoredComponents) {
            const checker = this.componentCheckers[componentName];
            if (!checker) continue;

            try {
                const startTime = Date.now();
                const health = await checker();
                const responseTime = Date.now() - startTime;
                
                // Registrar métrica
                this.metricTracker.recordMetric(
                    componentName,
                    responseTime,
                    health.status === 'critical' || health.status === 'unhealthy'
                );
                
                components.push(health);
                
                // Generar recomendaciones si hay problemas
                if (health.status === 'critical' || health.status === 'unhealthy') {
                    recommendations.push(`[${componentName}] ${health.message}`);
                }
            } catch (error) {
                console.error(`Error verificando componente ${componentName}:`, error);
                
                const errorHealth: ComponentHealth = {
                    name: componentName,
                    status: 'critical',
                    lastCheck: Date.now(),
                    metrics: { error: error instanceof Error ? error.message : 'Error desconocido' },
                    message: `Error durante verificación: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                    thresholds: COMPONENT_THRESHOLDS[componentName] || {
                        responseTimeMax: 5000,
                        errorRateMax: 0.5,
                        availabilityMin: 0.5,
                        checkInterval: 30000,
                    },
                };
                
                components.push(errorHealth);
                recommendations.push(`[${componentName}] Error en verificación: ${errorHealth.message}`);
            }
        }

        // Calcular métricas agregadas
        const componentMetrics = components.map(comp => {
            const metrics = this.metricTracker.getComponentMetrics(comp.name);
            return {
                availability: metrics.availability,
                avgResponseTime: metrics.avgResponseTime,
                errorRate: metrics.errorRate,
            };
        });

        const aggregatedMetrics = {
            availability: componentMetrics.length > 0 
                ? componentMetrics.reduce((sum, m) => sum + m.availability, 0) / componentMetrics.length
                : 1,
            avgResponseTime: componentMetrics.length > 0
                ? componentMetrics.reduce((sum, m) => sum + m.avgResponseTime, 0) / componentMetrics.length
                : 0,
            errorRate: componentMetrics.length > 0
                ? componentMetrics.reduce((sum, m) => sum + m.errorRate, 0) / componentMetrics.length
                : 0,
            uptime: performance.now() / 1000, // segundos desde carga de página
        };

        // Determinar estado general
        const overallStatus = calculateOverallStatus(components);

        // Crear objeto de salud del sistema
        const systemHealth: SystemHealth = {
            overallStatus,
            components: components.reduce((acc, comp) => {
                acc[comp.name] = comp;
                return acc;
            }, {} as Record<string, ComponentHealth>),
            timestamp: Date.now(),
            recommendations,
            aggregatedMetrics,
        };

        this.lastSystemHealth = systemHealth;

        // Notificar listeners
        this.listeners.forEach(listener => listener(systemHealth));

        return systemHealth;
    }

    getLastHealth(): SystemHealth | null {
        return this.lastSystemHealth;
    }

    getComponentHistory(componentName: string) {
        return this.metricTracker.getComponentMetrics(componentName);
    }

    addListener(listener: (health: SystemHealth) => void): void {
        this.listeners.push(listener);
    }

    removeListener(listener: (health: SystemHealth) => void): void {
        const index = this.listeners.indexOf(listener);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    updateConfig(newConfig: Partial<HealthMonitorConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Reiniciar monitoreo si el intervalo cambió
        if (this.monitoringIntervalId !== null && newConfig.monitoringInterval) {
            this.stop();
            this.start();
        }
    }

    getConfig(): HealthMonitorConfig {
        return { ...this.config };
    }

    clearHistory(): void {
        this.metricTracker.clearHistory();
    }
}

// -----------------------------------------------------------
// Instancia global (singleton)
// -----------------------------------------------------------

let globalHealthMonitor: HealthMonitor | null = null;

export function getHealthMonitor(config?: Partial<HealthMonitorConfig>): HealthMonitor {
    if (!globalHealthMonitor) {
        globalHealthMonitor = HealthMonitor.create(config);
    }
    return globalHealthMonitor;
}

export function startGlobalHealthMonitoring(config?: Partial<HealthMonitorConfig>): HealthMonitor {
    const monitor = getHealthMonitor(config);
    monitor.start();
    return monitor;
}

export function stopGlobalHealthMonitoring(): void {
    if (globalHealthMonitor) {
        globalHealthMonitor.stop();
    }
}

export function getSystemHealth(): SystemHealth | null {
    return globalHealthMonitor?.getLastHealth() || null;
}