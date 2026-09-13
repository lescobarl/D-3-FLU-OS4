// ============================================================
// Autonomy Integration Hook — Integración de Sistemas Autónomos
// ============================================================
// Hook de React que integra todos los sistemas de autonomía
// y proporciona una interfaz unificada para la aplicación.
//
// Sistemas integrados:
//   - Health Monitor
//   - Auto Recovery
//   - Decision Engine
//   - Auto Optimization
//   - Backup System
//
// Cumple:
//   - Inicialización automática de sistemas
//   - Estado unificado de autonomía
//   - Eventos para notificaciones UI
//   - Integración con componentes existentes
// ============================================================

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { 
    HealthMonitor, 
    getHealthMonitor, 
    startGlobalHealthMonitoring,
    SystemHealth 
} from './healthMonitor';
import { 
    AutoRecoverySystem, 
    getAutoRecoverySystem, 
    startGlobalAutoRecovery,
    RecoveryResult 
} from './autoRecovery';
import { 
    DecisionEngine, 
    getDecisionEngine, 
    startGlobalDecisionEngine,
    AutonomousDecision 
} from './decisionEngine';
import { 
    AutoOptimizationSystem, 
    getAutoOptimizationSystem, 
    startGlobalAutoOptimization 
} from './autoOptimization';
import {
    BackupSystem,
    getBackupSystem,
    startGlobalBackupSystem,
    RestoreResult
} from './backupSystem';
import { onAutonomyEvent, emitAutonomyEvent, type AutonomyEvent } from './autonomyEvents';

// -----------------------------------------------------------
// Tipos
// -----------------------------------------------------------

export interface AutonomyState {
    /** Estado general de autonomía */
    status: 'initializing' | 'active' | 'degraded' | 'critical' | 'disabled';
    /** Sistemas activos */
    activeSystems: {
        healthMonitor: boolean;
        autoRecovery: boolean;
        decisionEngine: boolean;
        autoOptimization: boolean;
        backupSystem: boolean;
    };
    /** Métricas de salud actuales */
    healthMetrics: SystemHealth | null;
    /** Incidentes activos de recuperación */
    activeIncidents: any[];
    /** Decisiones autónomas recientes */
    recentDecisions: AutonomousDecision[];
    /** Estadísticas de backups */
    backupStats: {
        totalBackups: number;
        lastBackupTime: number | null;
        totalSizeMB: number;
    };
    /** Notificaciones pendientes */
    notifications: AutonomyNotification[];
}

export interface AutonomyNotification {
    id: string;
    type: 'info' | 'warning' | 'error' | 'success';
    title: string;
    message: string;
    timestamp: number;
    read: boolean;
    action?: {
        label: string;
        handler: () => void;
    };
}

export interface AutonomyActions {
    /** Iniciar todos los sistemas de autonomía */
    startAllSystems: () => void;
    /** Detener todos los sistemas de autonomía */
    stopAllSystems: () => void;
    /** Crear backup manual */
    createManualBackup: (notes?: string) => void;
    /** Restaurar desde último backup */
    restoreFromLatestBackup: () => Promise<RestoreResult>;
    /** Forzar evaluación de salud */
    forceHealthCheck: () => Promise<SystemHealth>;
    /** Ejecutar optimización manual */
    runManualOptimization: () => void;
    /** Limpiar notificaciones */
    clearNotifications: () => void;
    /** Marcar notificación como leída */
    markNotificationAsRead: (id: string) => void;
    /** Obtener configuración de sistemas */
    getSystemConfig: () => Record<string, any>;
    /** Actualizar configuración de sistema */
    updateSystemConfig: (system: string, config: any) => void;
}

// -----------------------------------------------------------
// Hook principal
// -----------------------------------------------------------

export function useAutonomyIntegration(): [AutonomyState, AutonomyActions] {
    const [state, setState] = useState<AutonomyState>({
        status: 'initializing',
        activeSystems: {
            healthMonitor: false,
            autoRecovery: false,
            decisionEngine: false,
            autoOptimization: false,
            backupSystem: false,
        },
        healthMetrics: null,
        activeIncidents: [],
        recentDecisions: [],
        backupStats: {
            totalBackups: 0,
            lastBackupTime: null,
            totalSizeMB: 0,
        },
        notifications: [],
    });

    const healthMonitorRef = useRef<HealthMonitor | null>(null);
    const recoverySystemRef = useRef<AutoRecoverySystem | null>(null);
    const decisionEngineRef = useRef<DecisionEngine | null>(null);
    const optimizationSystemRef = useRef<AutoOptimizationSystem | null>(null);
    const backupSystemRef = useRef<BackupSystem | null>(null);
    // FIX estabilidad: guard idempotente. stopAllSystems se invoca en el cleanup
    // del efecto de App (durante unmount). Sin este guard, su setState repetido
    // en cascada producía "Maximum update depth exceeded" y tumbaba <App>.
    const systemsStoppedRef = useRef(false);
    // Guard idempotente para la notificación de éxito: evita duplicarla cuando
    // React StrictMode remonta el efecto (mount → cleanup → mount) en desarrollo.
    const initNotifiedRef = useRef(false);

    // -----------------------------------------------------------
    // Inicialización
    // -----------------------------------------------------------

    useEffect(() => {
        const initializeAutonomySystems = async () => {
            try {
                // Inicializar Health Monitor - EXCLUIR componentes de speech desde el inicio
                // Speech components son manejados por el sistema de voz y no necesitan monitoreo autónomo
                const healthMonitor = startGlobalHealthMonitoring({
                    verboseLogging: false,
                    monitoredComponents: [
                        'ai-service',
                        'indexed-db',
                        'network',
                        'memory',
                        'react-components'
                        // NOTA: 'speech-recognition' y 'speech-synthesis' están EXCLUIDOS intencionalmente
                        // Estos componentes son manejados por useFluVoiceAssistant
                    ],
                    autoRecoveryEnabled: false, // Deshabilitar recuperación automática desde el inicio
                });
                healthMonitorRef.current = healthMonitor;

                // Configurar listener para actualizaciones de salud
                healthMonitor.addListener((health: SystemHealth) => {
                    setState(prev => ({
                        ...prev,
                        healthMetrics: health,
                        status: mapHealthStatusToAutonomyStatus(health.overallStatus),
                    }));

                    // Agregar notificación si hay problemas críticos
                    if (health.overallStatus === 'critical' || health.overallStatus === 'unhealthy') {
                        addNotification({
                            type: 'warning',
                            title: 'Problema de salud del sistema',
                            message: `Componentes críticos reportan estado ${health.overallStatus}. ${health.recommendations[0] || ''}`,
                        });
                    }

                    // Pasar métricas al sistema de recuperación
                    if (recoverySystemRef.current) {
                        Object.values(health.components).forEach(component => {
                            if (component.status === 'critical' || component.status === 'unhealthy') {
                                recoverySystemRef.current?.evaluateAndRecover(component);
                            }
                        });
                    }
                });

                // Inicializar Auto Recovery
                const recoverySystem = startGlobalAutoRecovery({
                    verboseLogging: false,
                    userNotificationMode: 'toast',
                });
                recoverySystemRef.current = recoverySystem;
                recoverySystem.setHealthMonitor(healthMonitor);

                // Inicializar Decision Engine
                const decisionEngine = startGlobalDecisionEngine({
                    verboseLogging: false,
                    considerEcologicalFactors: true,
                    considerCostFactors: true,
                });
                decisionEngineRef.current = decisionEngine;

                // Inicializar Auto Optimization
                const optimizationSystem = startGlobalAutoOptimization({
                    verboseLogging: false,
                    enabled: true,
                });
                optimizationSystemRef.current = optimizationSystem;

                // Inicializar Backup System
                const backupSystem = startGlobalBackupSystem({
                    verboseLogging: false,
                    enabled: true,
                });
                backupSystemRef.current = backupSystem;

                // Actualizar estado con sistemas activos
                setState(prev => ({
                    ...prev,
                    status: 'active',
                    activeSystems: {
                        healthMonitor: true,
                        autoRecovery: true,
                        decisionEngine: true,
                        autoOptimization: true,
                        backupSystem: true,
                    },
                }));

                // Cargar estadísticas iniciales de backup
                updateBackupStats();

                // Agregar notificación de inicialización exitosa (una sola vez por instancia)
                if (!initNotifiedRef.current) {
                    addNotification({
                        type: 'success',
                        title: 'Sistemas de autonomía activados',
                        message: 'FLU ahora puede monitorear y recuperarse automáticamente de problemas.',
                    });
                    initNotifiedRef.current = true;
                }

            } catch (error) {
                console.error('Error inicializando sistemas de autonomía:', error);
                setState(prev => ({
                    ...prev,
                    status: 'degraded',
                }));
                
                addNotification({
                    type: 'error',
                    title: 'Error en sistemas de autonomía',
                    message: 'Algunas funciones de autonomía no están disponibles.',
                });
            }
        };

        initializeAutonomySystems();

        // Cleanup
        return () => {
            if (healthMonitorRef.current) {
                healthMonitorRef.current.stop();
            }
            if (decisionEngineRef.current) {
                decisionEngineRef.current.stop();
            }
            if (optimizationSystemRef.current) {
                optimizationSystemRef.current.stop();
            }
            if (backupSystemRef.current) {
                backupSystemRef.current.stop();
            }
        };
    }, []);

    // -----------------------------------------------------------
    // Helper functions
    // -----------------------------------------------------------

    const addNotification = useCallback((notification: Omit<AutonomyNotification, 'id' | 'timestamp' | 'read'>) => {
        const newNotification: AutonomyNotification = {
            ...notification,
            id: `notification-${uuidv4()}`,
            timestamp: Date.now(),
            read: false,
        };

        setState(prev => ({
            ...prev,
            notifications: [newNotification, ...prev.notifications].slice(0, 20), // Limitar a 20 notificaciones
        }));

        // Propagar al bus central (solo para suscriptores externos; este hook
        // ignora su propio tipo 'autonomy-notification' para evitar bucles).
        emitAutonomyEvent({
            type: 'autonomy-notification',
            level: notification.type,
            message: `${notification.title} — ${notification.message}`,
        });
    }, []);

    // -----------------------------------------------------------
    // Puente motor → UI: los eventos de los sistemas autónomos se
    // convierten en notificaciones del estado del hook (antes eran
    // CustomEvent 'flu-*' en window sin NINGÚN listener: muertos).
    // -----------------------------------------------------------
    useEffect(() => {
        const titles: Record<AutonomyEvent['type'], string> = {
            'ai-provider-changed': 'Proveedor de IA cambiado',
            'system-notification': 'Notificación del sistema',
            'soft-restart': 'Reinicio suave',
            'degraded-mode-changed': 'Modo degradado',
            'parameter-rollback': 'Optimización revertida',
            'parameter-changed': 'Parámetro aplicado',
            'autonomy-notification': 'FLU',
        };

        const unsubscribe = onAutonomyEvent((event) => {
            if (event.type === 'autonomy-notification') return;
            addNotification({
                type: event.level || 'info',
                title: titles[event.type] || 'Autonomía',
                message: event.message,
            });
        });

        return unsubscribe;
    }, [addNotification]);

    const updateBackupStats = useCallback(() => {
        if (backupSystemRef.current) {
            const stats = backupSystemRef.current.getBackupStats();
            setState(prev => ({
                ...prev,
                backupStats: {
                    totalBackups: stats.totalBackups,
                    lastBackupTime: stats.lastBackupTime,
                    totalSizeMB: stats.totalSizeMB,
                },
            }));
        }
    }, []);

    const mapHealthStatusToAutonomyStatus = useCallback((healthStatus: string): AutonomyState['status'] => {
        switch (healthStatus) {
            case 'critical':
                return 'critical';
            case 'unhealthy':
                return 'degraded';
            case 'degraded':
                return 'degraded';
            case 'healthy':
                return 'active';
            default:
                return 'active';
        }
    }, []);

    // -----------------------------------------------------------
    // Acciones públicas
    // -----------------------------------------------------------

    const startAllSystems = useCallback(() => {
        // Re-armar el guard para permitir un ciclo start→stop→start limpio
        systemsStoppedRef.current = false;
        if (healthMonitorRef.current) {
            healthMonitorRef.current.start();
        }
        if (decisionEngineRef.current) {
            decisionEngineRef.current.start();
        }
        if (optimizationSystemRef.current) {
            optimizationSystemRef.current.start();
        }
        if (backupSystemRef.current) {
            backupSystemRef.current.start();
        }

        setState(prev => ({
            ...prev,
            status: 'active',
            activeSystems: {
                healthMonitor: true,
                autoRecovery: true,
                decisionEngine: true,
                autoOptimization: true,
                backupSystem: true,
            },
        }));

        addNotification({
            type: 'info',
            title: 'Sistemas de autonomía iniciados',
            message: 'Todos los sistemas de monitoreo y recuperación están ahora activos.',
        });
    }, [addNotification]);

    const stopAllSystems = useCallback(() => {
        if (healthMonitorRef.current) {
            healthMonitorRef.current.stop();
        }
        if (decisionEngineRef.current) {
            decisionEngineRef.current.stop();
        }
        if (optimizationSystemRef.current) {
            optimizationSystemRef.current.stop();
        }
        if (backupSystemRef.current) {
            backupSystemRef.current.stop();
        }

        // Idempotente: el setState/addNotification solo se ejecuta UNA vez.
        // Evita el bucle de updates que React detecta como
        // "Maximum update depth exceeded" cuando esto corre durante unmount.
        if (systemsStoppedRef.current) return;
        systemsStoppedRef.current = true;

        try {
            setState(prev => ({
                ...prev,
                status: 'disabled',
                activeSystems: {
                    healthMonitor: false,
                    autoRecovery: false,
                    decisionEngine: false,
                    autoOptimization: false,
                    backupSystem: false,
                },
            }));

            addNotification({
                type: 'info',
                title: 'Sistemas de autonomía detenidos',
                message: 'Las funciones de autonomía han sido desactivadas.',
            });
        } catch (err) {
            // No debe poder tumbar la app aunque el componente esté desmontándose
            console.warn('[Autonomy] stopAllSystems: actualización de estado omitida durante unmount:', err);
        }
    }, [addNotification]);

    const createManualBackup = useCallback((notes?: string) => {
        if (!backupSystemRef.current) {
            addNotification({
                type: 'error',
                title: 'Error creando backup',
                message: 'Sistema de backup no disponible.',
            });
            return;
        }

        const backup = backupSystemRef.current.createManualBackup(undefined, notes);
        
        if (backup) {
            addNotification({
                type: 'success',
                title: 'Backup creado',
                message: `Backup manual creado exitosamente (ID: ${backup.id.slice(0, 8)}...)`,
            });
            updateBackupStats();
        } else {
            addNotification({
                type: 'error',
                title: 'Error creando backup',
                message: 'No se pudo crear el backup manual.',
            });
        }
    }, [addNotification, updateBackupStats]);

    const restoreFromLatestBackup = useCallback(async (): Promise<RestoreResult> => {
        if (!backupSystemRef.current) {
            const errorResult: RestoreResult = {
                success: false,
                restoredComponents: [],
                failedComponents: [],
                message: 'Sistema de backup no disponible',
                backupTimestamp: 0,
                durationMs: 0,
            };
            
            addNotification({
                type: 'error',
                title: 'Error restaurando backup',
                message: 'Sistema de backup no disponible.',
            });
            
            return errorResult;
        }

        addNotification({
            type: 'info',
            title: 'Restauración en progreso',
            message: 'Restaurando desde el último backup...',
        });

        const result = backupSystemRef.current.restoreLatestBackup();
        
        if (result.success) {
            addNotification({
                type: 'success',
                title: 'Restauración completada',
                message: `Sistema restaurado exitosamente (${result.restoredComponents.length} componentes).`,
            });
        } else {
            addNotification({
                type: 'warning',
                title: 'Restauración parcial',
                message: `Restauración completada con ${result.failedComponents.length} errores.`,
            });
        }

        return result;
    }, [addNotification]);

    const forceHealthCheck = useCallback(async (): Promise<SystemHealth> => {
        if (!healthMonitorRef.current) {
            throw new Error('Health Monitor no disponible');
        }

        addNotification({
            type: 'info',
            title: 'Verificación de salud',
            message: 'Ejecutando verificación completa del sistema...',
        });

        const health = await healthMonitorRef.current.performHealthCheck();
        
        addNotification({
            type: 'info',
            title: 'Verificación completada',
            message: `Estado del sistema: ${health.overallStatus}`,
        });

        return health;
    }, [addNotification]);

    const runManualOptimization = useCallback(() => {
        if (!optimizationSystemRef.current) {
            addNotification({
                type: 'error',
                title: 'Error en optimización',
                message: 'Sistema de optimización no disponible.',
            });
            return;
        }

        addNotification({
            type: 'info',
            title: 'Optimización en progreso',
            message: 'Ejecutando optimización manual de parámetros...',
        });

        optimizationSystemRef.current.evaluateAndOptimize().then(() => {
            addNotification({
                type: 'success',
                title: 'Optimización completada',
                message: 'Parámetros del sistema optimizados exitosamente.',
            });
        }).catch(error => {
            addNotification({
                type: 'error',
                title: 'Error en optimización',
                message: `Error durante optimización: ${error.message}`,
            });
        });
    }, [addNotification]);

    const clearNotifications = useCallback(() => {
        setState(prev => ({
            ...prev,
            notifications: [],
        }));
    }, []);

    const markNotificationAsRead = useCallback((id: string) => {
        setState(prev => ({
            ...prev,
            notifications: prev.notifications.map(notification =>
                notification.id === id ? { ...notification, read: true } : notification
            ),
        }));
    }, []);

    const getSystemConfig = useCallback(() => {
        const configs: Record<string, any> = {};
        
        if (healthMonitorRef.current) {
            configs.healthMonitor = healthMonitorRef.current.getConfig();
        }
        if (recoverySystemRef.current) {
            configs.autoRecovery = recoverySystemRef.current.getConfig();
        }
        if (decisionEngineRef.current) {
            configs.decisionEngine = decisionEngineRef.current.getConfig();
        }
        if (optimizationSystemRef.current) {
            configs.autoOptimization = optimizationSystemRef.current.getConfig();
        }
        if (backupSystemRef.current) {
            configs.backupSystem = backupSystemRef.current.getConfig();
        }
        
        return configs;
    }, []);

    const updateSystemConfig = useCallback((system: string, config: any) => {
        switch (system) {
            case 'healthMonitor':
                if (healthMonitorRef.current) {
                    healthMonitorRef.current.updateConfig(config);
                }
                break;
            case 'autoRecovery':
                if (recoverySystemRef.current) {
                    recoverySystemRef.current.updateConfig(config);
                }
                break;
            case 'decisionEngine':
                if (decisionEngineRef.current) {
                    decisionEngineRef.current.updateConfig(config);
                }
                break;
            case 'autoOptimization':
                if (optimizationSystemRef.current) {
                    optimizationSystemRef.current.updateConfig(config);
                }
                break;
            case 'backupSystem':
                if (backupSystemRef.current) {
                    backupSystemRef.current.updateConfig(config);
                }
                break;
        }
        
        addNotification({
            type: 'info',
            title: 'Configuración actualizada',
            message: `Configuración de ${system} actualizada.`,
        });
    }, [addNotification]);

    // -----------------------------------------------------------
    // Retorno del hook
    // -----------------------------------------------------------

    // El objeto de acciones se memoiza: todas sus funciones son useCallback-estables,
    // por lo que su identidad solo cambia si alguna cambia. Sin useMemo, cada render
    // crea un objeto nuevo y cualquier useEffect dependiente de `actions` (p. ej. el
    // de App.tsx) se re-ejecuta en CADA render → bucle de render + arranques repetidos
    // del HealthMonitor → "Maximum update depth exceeded" (caída del portal en escucha).
    const actions: AutonomyActions = useMemo(
        () => ({
            startAllSystems,
            stopAllSystems,
            createManualBackup,
            restoreFromLatestBackup,
            forceHealthCheck,
            runManualOptimization,
            clearNotifications,
            markNotificationAsRead,
            getSystemConfig,
            updateSystemConfig,
        }),
        [
            startAllSystems,
            stopAllSystems,
            createManualBackup,
            restoreFromLatestBackup,
            forceHealthCheck,
            runManualOptimization,
            clearNotifications,
            markNotificationAsRead,
            getSystemConfig,
            updateSystemConfig,
        ]
    );

    return [state, actions];
}
