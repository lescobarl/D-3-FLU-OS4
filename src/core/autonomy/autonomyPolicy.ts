// ============================================================
// autonomyPolicy — Política numérica de los subsistemas de autonomía
// ============================================================
// FUENTE ÚNICA (Rule #1: NO HARDCODE) de los intervalos, cooldowns, umbrales,
// límites de historial y constantes de fórmula que usan:
//   - healthMonitor.ts     → monitoreo de salud del sistema
//   - autoRecovery.ts      → reglas y acciones de recuperación
//   - autoOptimization.ts  → catálogo de parámetros y modelo de mejora
//
// Los umbrales COMPARTIDOS con el resto de la app siguen viviendo en
// AUTONOMY_THRESHOLD_DEFAULTS (src/core/config/sharedConfig.ts). Aquí vive la
// política PRIVADA de la autonomía: duraciones, ventanas de muestreo, límites
// de historial y factores de las fórmulas de decisión.
//
// Todos los valores son EXACTAMENTE los que estaban inline (mismo
// comportamiento); este módulo solo les pone nombre y unidad.
// Convención de sufijos: `Ms` = milisegundos, `Mb` = megabytes,
// `Percent` = porcentaje (0-100), `Ratio` = fracción (0-1).
// ============================================================

export const AUTONOMY_POLICY = {
    /** Conversiones de unidad compartidas por las fórmulas. */
    units: {
        /** Milisegundos de un segundo (ms ↔ s). */
        msPerSecond: 1000,
        /** Escala de porcentaje (fracción 0-1 ↔ valor 0-100). */
        percentScale: 100,
    },

    /** ------------------------------------------------------------
     *  Auto-optimización (autoOptimization.ts)
     *  ------------------------------------------------------------ */
    optimization: {
        /** Configuración por defecto (DEFAULT_OPTIMIZATION_CONFIG). */
        config: {
            /** Intervalo entre evaluaciones (ms). */
            evaluationIntervalMs: 600_000, // 10 min
            /** Cambio máximo por ajuste (%). */
            maxChangePerAdjustmentPercent: 20,
            /** Nº mínimo de muestras antes de proponer cambios. */
            minSamples: 50,
            /** Ventana de evaluación tras aplicar un cambio (ms). */
            evaluationPeriodAfterChangeMs: 300_000, // 5 min
        },

        /** Catálogo de parámetros optimizables (OPTIMIZABLE_PARAMETERS).
         *  `speechConfidence` toma su max/step de AUTONOMY_THRESHOLD_DEFAULTS. */
        parameters: {
            speechConfidence: { current: 0.7, min: 0.3 }, // confianza 0-1
            aiRequestTimeout: { currentMs: 30_000, minMs: 5_000, maxMs: 120_000, stepMs: 5_000 },
            cacheTtl: { currentMs: 300_000, minMs: 60_000, maxMs: 1_800_000, stepMs: 60_000 },
            animationSpeed: { current: 1.0, min: 0.5, max: 2.0, step: 0.1 }, // multiplicador
            uiRefreshRate: { current: 60, min: 30, max: 120, step: 5 }, // fps
            memoryCacheSize: { current: 100, min: 10, max: 1_000, step: 10 }, // items
            retryMaxAttempts: { current: 3, min: 1, max: 10, step: 1 }, // intentos
            backoffBaseDelay: { currentMs: 1_000, minMs: 500, maxMs: 5_000, stepMs: 500 },
        },

        /** Límites y ventanas del ParameterOptimizer. */
        runtime: {
            /** Tamaño máximo del historial de métricas (y de optimizaciones). */
            historyLimit: 1_000,
            /** Muestras recientes usadas para evaluar un parámetro. */
            evaluationSampleWindow: 100,
            /** Muestras post-cambio para medir el resultado real. */
            postChangeSampleWindow: 20,
            /** Muestras pre-cambio con las que se compara el resultado. */
            preChangeSampleWindow: 20,
            /** Mejora (normalizada) por debajo de la cual se hace rollback. */
            rollbackImprovement: -0.1, // empeoró > 10%
            /** Pasos máximos que puede moverse un parámetro por ajuste. */
            maxStepsPerAdjustment: 3,
        },

        /** Umbrales de dirección del ajuste (determineOptimizationDirection). */
        direction: {
            speech: {
                successRateLow: 0.6, // tasa de éxito baja → bajar umbral
                successRateHigh: 0.9, // tasa de éxito alta + mal feedback → subir
                userFeedbackLow: 0.7,
            },
            aiTimeout: {
                timeoutRateHigh: 0.3,
                responseTimeFastMs: 10_000,
                timeoutRateLow: 0.1,
            },
            cache: {
                responseTimeSlowMs: 20_000,
                memoryUsageLowMb: 500,
                memoryUsageHighMb: 800,
            },
            animation: {
                userFeedbackLow: 0.6,
                /** Corte de la exploración aleatoria (50/50). */
                explorationThreshold: 0.5,
            },
            uiRefresh: {
                memoryUsageHighMb: 700,
                actualRefreshRateLow: 45,
                memoryUsageLowMb: 400,
            },
            memoryCache: {
                responseTimeSlowMs: 15_000,
                memoryUsageLowMb: 600,
                memoryUsageHighMb: 900,
            },
            retry: {
                timeoutRateHigh: 0.4,
                systemStabilityLow: 0.7,
            },
            backoff: {
                systemStabilityLow: 0.7,
                responseTimeSlowMs: 25_000,
            },
        },

        /** Factores del modelo de mejora esperada (calculateExpectedImprovement). */
        improvement: {
            speechDecreaseFactor: 0.3,
            speechIncreaseFactor: 0.2,
            timeoutIncreaseFactor: 0.4,
            timeoutDecreaseFactor: 0.2,
            /** Tiempo de respuesta de referencia al acortar el timeout (ms). */
            timeoutReferenceMs: 30_000,
            cacheIncreaseFactor: 0.3,
            /** Tiempo de respuesta de referencia al alargar el TTL (ms). */
            cacheResponseReferenceMs: 50_000,
            cacheDecreaseFactor: 0.3,
            /** Uso de memoria de referencia al acortar el TTL (Mb). */
            cacheMemoryReferenceMb: 1_000,
            /** Mejora base de los parámetros sin modelo propio. */
            defaultFactor: 0.1,
        },

        /** Normalizaciones de compareMetrics y mapToOptimizationMetrics. */
        normalization: {
            /** Divisor del tiempo de respuesta en compareMetrics (ms). */
            responseTimeDivisorMs: 10_000,
            /** Divisor del uso de memoria en compareMetrics (Mb). */
            memoryUsageDivisorMb: 100,
            /** Divisor del tiempo de respuesta al mapear métricas (ms). */
            mapResponseTimeDivisorMs: 60_000,
            /** Peso de la métrica de éxito de voz al mapear métricas. */
            speechSuccessRateMetricWeight: 0.2,
        },
    },

    /** ------------------------------------------------------------
     *  Recuperación automática (autoRecovery.ts)
     *  ------------------------------------------------------------ */
    recovery: {
        /** Configuración por defecto (DEFAULT_RECOVERY_CONFIG). */
        config: {
            /** Umbral para considerar un incidente crítico (ratio 0-1). */
            criticalThreshold: 0.3,
            /** Tiempo máximo antes de escalar (ms). */
            maxRecoveryTimeMs: 300_000, // 5 min
            /** Reintentos máximos por incidente. */
            maxRetriesPerIncident: 10,
        },
        /** Nº máximo de incidentes conservados en el historial. */
        incidentHistoryLimit: 100,
        /** Tiempo asumido por acción registrada al estimar el cooldown (ms). */
        assumedMsPerAction: 1_000,
        /** Duración de un reintento simulado por el ejecutor (ms). */
        simulatedRetryMs: 100,
        /** Backoff por defecto cuando la regla no define parámetros. */
        retryDefaults: {
            initialDelayMs: 1_000,
            maxDelayMs: 10_000,
            multiplier: 2,
        },
        /** Parámetros de las reglas por defecto (DEFAULT_RECOVERY_RULES). */
        rules: {
            // Regla 1 — ai-service crítico → cambiar proveedor
            aiServiceCriticalMinDurationMs: 10_000,
            aiServiceCriticalMinFailures: 2,
            switchMaxAttempts: 3,
            switchPriority: 10,
            switchMaxExecutions: 3,
            switchCooldownMs: 30_000,
            // Regla 2 — ai-service unhealthy → reintentar con backoff
            aiServiceDegradedMinDurationMs: 5_000,
            retryPriority: 5,
            retryMaxExecutions: 5,
            retryCooldownMs: 60_000,
            retryInitialDelayMs: 1_000,
            retryMaxDelayMs: 10_000,
            retryMultiplier: 2,
            // Regla 3 — indexed-db crítico → restaurar desde backup
            indexedDbCriticalMinDurationMs: 20_000,
            indexedDbCriticalMinFailures: 3,
            restoreMaxAgeHours: 24,
            restorePriority: 9,
            // Regla 4 — react-components crítico (error rate) → reiniciar
            reactComponentsCriticalMinDurationMs: 30_000,
            componentErrorRateThreshold: 0.5,
            restartPriority: 15, // reglas 4 y 6 (reinicio de react-components)
            // Regla 5 — network crítico persistente → escalar
            networkCriticalMinDurationMs: 60_000,
            networkCriticalMinFailures: 5,
            escalatePriority: 12,
            // Regla 6 — react-components crítico (errores de consola) → reiniciar
            recentConsoleErrorsThreshold: 20,
        },
    },

    /** ------------------------------------------------------------
     *  Monitor de salud (healthMonitor.ts)
     *  ------------------------------------------------------------ */
    health: {
        /** Configuración por defecto (DEFAULT_HEALTH_CONFIG). */
        config: {
            /** Intervalo de monitoreo general (ms). */
            monitoringIntervalMs: 30_000, // 30 s
        },
        /** Nº máximo de métricas guardadas por componente. */
        metricHistoryLimit: 100,
        /** Uso de memoria considerado crítico (ratio 0-1). */
        criticalLoadRatio: 0.9,
        /** Nº de errores de consola que marca el componente como fallido. */
        consoleErrorMax: 10,
        /** Factor sobre responseTimeMax que convierte el estado en crítico. */
        criticalResponseTimeFactor: 1.5,
        /** Pesos de cada estado al agregar la salud general (0-1). */
        statusWeights: {
            critical: 0,
            unhealthy: 0.3,
            degraded: 0.7,
            healthy: 1,
        },
        /** Cortes del peso medio que determinan el estado general. */
        overall: {
            criticalBelow: 0.3,
            unhealthyBelow: 0.6,
        },
        /** Umbrales por componente (COMPONENT_THRESHOLDS). La disponibilidad
         *  mínima que falte aquí sale de AUTONOMY_THRESHOLD_DEFAULTS.health. */
        thresholds: {
            aiService: { responseTimeMaxMs: 10_000, errorRateMax: 0.2, checkIntervalMs: 15_000 },
            speechRecognition: { responseTimeMaxMs: 5_000, errorRateMax: 0.3, checkIntervalMs: 10_000 },
            speechSynthesis: { responseTimeMaxMs: 3_000, checkIntervalMs: 10_000 },
            indexedDb: { responseTimeMaxMs: 2_000, errorRateMax: 0.1, checkIntervalMs: 20_000 },
            network: { responseTimeMaxMs: 3_000, checkIntervalMs: 5_000 },
            memory: { responseTimeMaxMs: 1_000, checkIntervalMs: 30_000 },
            reactComponents: { responseTimeMaxMs: 1_000, errorRateMax: 0.1, checkIntervalMs: 30_000 },
        },
        /** Umbrales de reserva para un componente sin entrada propia. */
        fallbackThresholds: {
            responseTimeMaxMs: 5_000,
            errorRateMax: 0.5,
            availabilityMin: 0.5,
            checkIntervalMs: 30_000,
        },
    },
} as const;
