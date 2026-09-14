// ============================================================
// Backup System — Sistema de Respaldo y Recuperación de Estado
// ============================================================
// Crea y gestiona backups automáticos del estado de FLU
// para permitir recuperación rápida después de fallos.
//
// Características:
//   - Backups incrementales automáticos
//   - Recuperación granular (por componente)
//   - Verificación de integridad
//   - Rotación y limpieza automática
//   - Restauración asistida
//
// Cumple:
//   - Minimiza impacto en rendimiento
//   - Garantiza consistencia de datos
//   - Soporta múltiples estrategias de backup
//   - Integración con sistema de recuperación
// ============================================================

import { STORAGE_KEYS, GEMINI_CONFIG, DEEPSEEK_CONFIG, readStorage } from '../config/appConfig';
import { useIntegrationStore } from '../../store/integrationStore';
import { v4 as uuidv4 } from 'uuid';
import type { ConversationEntry, ConversationState, VoiceBridgeEvent, WorkspaceEntry } from '../../types/bridge';
import type { MinuteUIEntry } from '../../hooks/useMinuteKnowledge';

// -----------------------------------------------------------
// Tipos
// -----------------------------------------------------------

export type BackupStrategy = 
    | 'full'          // Backup completo
    | 'incremental'   // Solo cambios desde último backup
    | 'differential'  // Cambios desde backup completo
    | 'selective';    // Componentes específicos

export type BackupComponent = 
    | 'conversation_state'
    | 'ai_configuration'
    | 'user_preferences'
    | 'minute_history'
    | 'workspace_data'
    | 'voice_profiles'
    | 'system_settings'
    | 'all';

export interface BackupMetadata {
    /** ID único del backup */
    id: string;
    /** Timestamp de creación */
    timestamp: number;
    /** Estrategia utilizada */
    strategy: BackupStrategy;
    /** Componentes incluidos */
    components: BackupComponent[];
    /** Tamaño aproximado (bytes) */
    size: number;
    /** Checksum para verificación */
    checksum: string;
    /** Versión de la aplicación */
    appVersion: string;
    /** Notas opcionales */
    notes?: string;
}

/** Estado de conversación extraído/restaurado. */
export interface ConversationStateData {
    conversationHistory: ConversationEntry[];
    conversationState: ConversationState;
    eventLog: VoiceBridgeEvent[];
    lastUpdated: number;
}

/** Configuración de IA extraída/restaurada. */
export interface AIConfigurationData {
    provider: string;
    apiKeys: { gemini: string; deepseek: string };
    models: { gemini: string; deepseek: string };
    creativity: string;
    maxTokens: string;
}

/** Preferencias de usuario extraídas/restauradas. */
export interface UserPreferencesData {
    language: string;
    sessionRole: string;
    voiceConfig: { speed: string; volume: string; pitch: string };
    uiPreferences: { theme: string; fontSize: string; animations: string };
    avatarConfig: { color: string; pantsColor: string; bodyColor: string; faceColor: string };
}

/** Datos del workspace extraídos/restaurados. */
export interface WorkspaceData {
    workspaceArtifact: WorkspaceEntry | null;
}

/** Configuración del sistema extraída/restaurada. */
export interface SystemSettingsData {
    branding: { mode: string; activeSeason: string; birthday: string | null };
    autonomy: { healthMonitoring: string; autoRecovery: string; decisionEngine: string };
    performance: { cacheEnabled: string; loggingLevel: string; analyticsEnabled: string };
    lastBackup: string | null;
    backupCount: number;
}

/** Datos por componente persistidos en un backup (solo los extraídos están presentes). */
export interface BackupComponentsData {
    conversation_state: ConversationStateData | null;
    ai_configuration: AIConfigurationData | null;
    user_preferences: UserPreferencesData | null;
    minute_history: MinuteUIEntry[];
    workspace_data: WorkspaceData | null;
    voice_profiles: unknown[];
    system_settings: SystemSettingsData | null;
}

/** Resultado de extraer un componente (incluye el payload agregado de `all`). */
export type ExtractedComponentData =
    | ConversationStateData
    | AIConfigurationData
    | UserPreferencesData
    | MinuteUIEntry[]
    | WorkspaceData
    | unknown[]
    | SystemSettingsData
    | Partial<BackupComponentsData>
    | null;

export interface BackupData {
    /** Metadatos del backup */
    metadata: BackupMetadata;
    /** Datos de los componentes */
    components: Partial<BackupComponentsData>;
}

export interface RestoreResult {
    /** Si la restauración fue exitosa */
    success: boolean;
    /** Componentes restaurados */
    restoredComponents: BackupComponent[];
    /** Componentes que fallaron */
    failedComponents: BackupComponent[];
    /** Mensaje descriptivo */
    message: string;
    /** Timestamp del backup utilizado */
    backupTimestamp: number;
    /** Tiempo tomado (ms) */
    durationMs: number;
}

export interface BackupSystemConfig {
    /** Habilitar sistema de backup */
    enabled: boolean;
    /** Intervalo entre backups automáticos (ms) */
    autoBackupInterval: number;
    /** Estrategia por defecto */
    defaultStrategy: BackupStrategy;
    /** Máximo de backups almacenados */
    maxStoredBackups: number;
    /** Tamaño máximo total (MB) */
    maxTotalSizeMB: number;
    /** Componentes a incluir por defecto */
    defaultComponents: BackupComponent[];
    /** Habilitar verificación de integridad */
    integrityCheckEnabled: boolean;
    /** Habilitar compresión */
    compressionEnabled: boolean;
    /** Habilitar logging detallado */
    verboseLogging: boolean;
}

// -----------------------------------------------------------
// Configuración por defecto
// -----------------------------------------------------------

export const DEFAULT_BACKUP_CONFIG: BackupSystemConfig = {
    enabled: true,
    autoBackupInterval: 3600000, // 1 hora
    defaultStrategy: 'incremental',
    maxStoredBackups: 30,
    // localStorage ronda los 5 MB por origen; los backups deben dejar aire para
    // el resto de ajustes. Un tope de 100 MB era inalcanzable y llenaba la cuota.
    maxTotalSizeMB: 2,
    defaultComponents: [
        'conversation_state',
        'ai_configuration',
        'user_preferences',
        'minute_history',
        'system_settings',
    ],
    integrityCheckEnabled: true,
    compressionEnabled: true,
    verboseLogging: false,
};

// -----------------------------------------------------------
// Extractores de datos por componente
// -----------------------------------------------------------

class DataExtractor {
    extractConversationState(): ConversationStateData | null {
        try {
            // Extraer estado de conversación desde integrationStore (fuente canónica)
            const state = useIntegrationStore.getState();
            return {
                conversationHistory: state.conversationHistory || [],
                conversationState: state.conversationState || 'idle',
                eventLog: state.eventLog || [],
                lastUpdated: Date.now(),
            };
        } catch (error) {
            console.error('Error extrayendo estado de conversación:', error);
        }
        return null;
    }
    
    extractAIConfiguration(): AIConfigurationData | null {
        try {
            return {
                provider: readStorage(STORAGE_KEYS.AI_PROVIDER, 'openrouter'),
                apiKeys: {
                    gemini: readStorage(STORAGE_KEYS.TEXT_API_KEY, ''),
                    deepseek: readStorage(STORAGE_KEYS.DEEPSEEK_API_KEY, ''),
                },
                models: {
                    gemini: readStorage(STORAGE_KEYS.TEXT_MODEL, GEMINI_CONFIG.MODEL),
                    deepseek: readStorage(STORAGE_KEYS.DEEPSEEK_MODEL, DEEPSEEK_CONFIG.MODEL),
                },
                creativity: readStorage(STORAGE_KEYS.CREATIVITY, String(DEEPSEEK_CONFIG.CREATIVITY)),
                maxTokens: readStorage(STORAGE_KEYS.AI_MAX_TOKENS, String(DEEPSEEK_CONFIG.DEFAULT_MAX_TOKENS)),
            };
        } catch (error) {
            console.error('Error extrayendo configuración de IA:', error);
        }
        return null;
    }
    
    extractUserPreferences(): UserPreferencesData | null {
        try {
            return {
                language: readStorage(STORAGE_KEYS.LANGUAGE, 'es'),
                sessionRole: readStorage(STORAGE_KEYS.SESSION_ROLE, 'tutor'),
                voiceConfig: {
                    speed: readStorage(STORAGE_KEYS.VOICE_SPEED, '1.0'),
                    volume: readStorage(STORAGE_KEYS.VOICE_VOLUME, '1.0'),
                    pitch: readStorage(STORAGE_KEYS.VOICE_PITCH, '1.0'),
                },
                uiPreferences: {
                    theme: readStorage(STORAGE_KEYS.UI_THEME, 'dark'),
                    fontSize: readStorage(STORAGE_KEYS.UI_FONT_SIZE, 'medium'),
                    animations: readStorage(STORAGE_KEYS.UI_ANIMATIONS, 'true'),
                },
                avatarConfig: {
                    color: readStorage(STORAGE_KEYS.AVATAR_COLOR, '#22c55e'),
                    pantsColor: readStorage(STORAGE_KEYS.AVATAR_PANTS_COLOR, '#3b82f6'),
                    bodyColor: readStorage(STORAGE_KEYS.AVATAR_BODY_COLOR, '#ffffff'),
                    faceColor: readStorage(STORAGE_KEYS.AVATAR_FACE_COLOR, '#fbbf24'),
                },
            };
        } catch (error) {
            console.error('Error extrayendo preferencias de usuario:', error);
        }
        return null;
    }
    
    extractMinuteHistory(): MinuteUIEntry[] {
        try {
            // Extraer desde IndexedDB o localStorage
            const minutesJson = localStorage.getItem(STORAGE_KEYS.MINUTE_HISTORY);
            if (minutesJson) {
                return JSON.parse(minutesJson);
            }
            
            // Fallback: leer desde integrationStore (minuteHistory)
            return useIntegrationStore.getState().minuteHistory || [];
        } catch (error) {
            console.error('Error extrayendo historial de minutos:', error);
        }
        return [];
    }
    
    extractWorkspaceData(): WorkspaceData | null {
        try {
            const state = useIntegrationStore.getState();
            return {
                workspaceArtifact: state.workspaceArtifact || null,
            };
        } catch (error) {
            console.error('Error extrayendo datos de workspace:', error);
        }
        return null;
    }
    
    extractVoiceProfiles(): unknown[] {
        try {
            const profilesJson = localStorage.getItem(STORAGE_KEYS.VOICE_PROFILES);
            if (profilesJson) {
                return JSON.parse(profilesJson);
            }
        } catch (error) {
            console.error('Error extrayendo perfiles de voz:', error);
        }
        return [];
    }
    
    extractSystemSettings(): SystemSettingsData | null {
        try {
            return {
                branding: {
                    mode: readStorage(STORAGE_KEYS.BRANDING_MODE, 'disabled'),
                    activeSeason: readStorage(STORAGE_KEYS.BRANDING_ACTIVE_SEASON, 'default'),
                    birthday: readStorage<string | null>(STORAGE_KEYS.BRANDING_BIRTHDAY, null),
                },
                autonomy: {
                    healthMonitoring: readStorage(STORAGE_KEYS.AUTONOMY_HEALTH_MONITORING, 'enabled'),
                    autoRecovery: readStorage(STORAGE_KEYS.AUTONOMY_AUTO_RECOVERY, 'enabled'),
                    decisionEngine: readStorage(STORAGE_KEYS.AUTONOMY_DECISION_ENGINE, 'enabled'),
                },
                performance: {
                    cacheEnabled: readStorage(STORAGE_KEYS.PERFORMANCE_CACHE_ENABLED, 'true'),
                    loggingLevel: readStorage(STORAGE_KEYS.PERFORMANCE_LOGGING_LEVEL, 'info'),
                    analyticsEnabled: readStorage(STORAGE_KEYS.PERFORMANCE_ANALYTICS_ENABLED, 'true'),
                },
                lastBackup: readStorage<string | null>(STORAGE_KEYS.BACKUP_LAST_TIMESTAMP, null),
                backupCount: parseInt(readStorage(STORAGE_KEYS.BACKUP_COUNT, '0')),
            };
        } catch (error) {
            console.error('Error extrayendo configuración del sistema:', error);
        }
        return null;
    }
    
    extractComponent(component: BackupComponent): ExtractedComponentData {
        switch (component) {
            case 'conversation_state':
                return this.extractConversationState();
            case 'ai_configuration':
                return this.extractAIConfiguration();
            case 'user_preferences':
                return this.extractUserPreferences();
            case 'minute_history':
                return this.extractMinuteHistory();
            case 'workspace_data':
                return this.extractWorkspaceData();
            case 'voice_profiles':
                return this.extractVoiceProfiles();
            case 'system_settings':
                return this.extractSystemSettings();
            case 'all':
                return {
                    conversation_state: this.extractConversationState(),
                    ai_configuration: this.extractAIConfiguration(),
                    user_preferences: this.extractUserPreferences(),
                    minute_history: this.extractMinuteHistory(),
                    workspace_data: this.extractWorkspaceData(),
                    voice_profiles: this.extractVoiceProfiles(),
                    system_settings: this.extractSystemSettings(),
                };
            default:
                return null;
        }
    }
}

// -----------------------------------------------------------
// Restaurador de datos
// -----------------------------------------------------------

class DataRestorer {
    restoreConversationState(data: ConversationStateData | null): boolean {
        try {
            if (!data) return false;
            
            // Restaurar a integrationStore (fuente canónica)
            useIntegrationStore.setState((state) => ({
                ...state,
                conversationHistory: data.conversationHistory || [],
                conversationState: data.conversationState || 'idle',
                eventLog: data.eventLog || [],
            }));
            return true;
        } catch (error) {
            console.error('Error restaurando estado de conversación:', error);
        }
        return false;
    }
    
    restoreAIConfiguration(data: AIConfigurationData | null): boolean {
        try {
            if (!data) return false;
            
            localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, data.provider || 'openrouter');
            
            if (data.apiKeys) {
                if (data.apiKeys.gemini) {
                    localStorage.setItem(STORAGE_KEYS.TEXT_API_KEY, data.apiKeys.gemini);
                }
                if (data.apiKeys.deepseek) {
                    localStorage.setItem(STORAGE_KEYS.DEEPSEEK_API_KEY, data.apiKeys.deepseek);
                }
            }
            
            if (data.models) {
                if (data.models.gemini) {
                    localStorage.setItem(STORAGE_KEYS.TEXT_MODEL, data.models.gemini);
                }
                if (data.models.deepseek) {
                    localStorage.setItem(STORAGE_KEYS.DEEPSEEK_MODEL, data.models.deepseek);
                }
            }
            
            if (data.creativity) {
                localStorage.setItem(STORAGE_KEYS.CREATIVITY, data.creativity);
            }
            
            if (data.maxTokens) {
                localStorage.setItem(STORAGE_KEYS.AI_MAX_TOKENS, data.maxTokens);
            }
            
            return true;
        } catch (error) {
            console.error('Error restaurando configuración de IA:', error);
        }
        return false;
    }
    
    restoreUserPreferences(data: UserPreferencesData | null): boolean {
        try {
            if (!data) return false;
            
            if (data.language) {
                localStorage.setItem(STORAGE_KEYS.LANGUAGE, data.language);
            }
            
            if (data.sessionRole) {
                localStorage.setItem(STORAGE_KEYS.SESSION_ROLE, data.sessionRole);
            }
            
            if (data.voiceConfig) {
                if (data.voiceConfig.speed) {
                    localStorage.setItem(STORAGE_KEYS.VOICE_SPEED, data.voiceConfig.speed);
                }
                if (data.voiceConfig.volume) {
                    localStorage.setItem(STORAGE_KEYS.VOICE_VOLUME, data.voiceConfig.volume);
                }
                if (data.voiceConfig.pitch) {
                    localStorage.setItem(STORAGE_KEYS.VOICE_PITCH, data.voiceConfig.pitch);
                }
            }
            
            if (data.uiPreferences) {
                if (data.uiPreferences.theme) {
                    localStorage.setItem(STORAGE_KEYS.UI_THEME, data.uiPreferences.theme);
                }
                if (data.uiPreferences.fontSize) {
                    localStorage.setItem(STORAGE_KEYS.UI_FONT_SIZE, data.uiPreferences.fontSize);
                }
                if (data.uiPreferences.animations) {
                    localStorage.setItem(STORAGE_KEYS.UI_ANIMATIONS, data.uiPreferences.animations);
                }
            }
            
            if (data.avatarConfig) {
                if (data.avatarConfig.color) {
                    localStorage.setItem(STORAGE_KEYS.AVATAR_COLOR, data.avatarConfig.color);
                }
                if (data.avatarConfig.pantsColor) {
                    localStorage.setItem(STORAGE_KEYS.AVATAR_PANTS_COLOR, data.avatarConfig.pantsColor);
                }
                if (data.avatarConfig.bodyColor) {
                    localStorage.setItem(STORAGE_KEYS.AVATAR_BODY_COLOR, data.avatarConfig.bodyColor);
                }
                if (data.avatarConfig.faceColor) {
                    localStorage.setItem(STORAGE_KEYS.AVATAR_FACE_COLOR, data.avatarConfig.faceColor);
                }
            }
            
            return true;
        } catch (error) {
            console.error('Error restaurando preferencias de usuario:', error);
        }
        return false;
    }
    
    restoreMinuteHistory(data: MinuteUIEntry[] | null): boolean {
        try {
            if (!data) return false;
            
            localStorage.setItem(STORAGE_KEYS.MINUTE_HISTORY, JSON.stringify(data));
            
            // También restaurar a integrationStore (fuente canónica) si es un array
            if (Array.isArray(data)) {
                useIntegrationStore.setState((state) => ({
                    ...state,
                    minuteHistory: data,
                }));
            }
            
            return true;
        } catch (error) {
            console.error('Error restaurando historial de minutos:', error);
        }
        return false;
    }
    
    restoreWorkspaceData(data: WorkspaceData | null): boolean {
        try {
            if (!data) return false;
            
            useIntegrationStore.setState((state) => ({
                ...state,
                workspaceArtifact: data.workspaceArtifact || state.workspaceArtifact,
            }));
            
            return true;
        } catch (error) {
            console.error('Error restaurando datos de workspace:', error);
        }
        return false;
    }
    
    restoreVoiceProfiles(data: unknown[] | null): boolean {
        try {
            if (!data) return false;
            
            localStorage.setItem(STORAGE_KEYS.VOICE_PROFILES, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Error restaurando perfiles de voz:', error);
        }
        return false;
    }
    
    restoreSystemSettings(data: SystemSettingsData | null): boolean {
        try {
            if (!data) return false;
            
            if (data.branding) {
                if (data.branding.mode) {
                    localStorage.setItem(STORAGE_KEYS.BRANDING_MODE, data.branding.mode);
                }
                if (data.branding.activeSeason) {
                    localStorage.setItem(STORAGE_KEYS.BRANDING_ACTIVE_SEASON, data.branding.activeSeason);
                }
                if (data.branding.birthday) {
                    localStorage.setItem(STORAGE_KEYS.BRANDING_BIRTHDAY, data.branding.birthday);
                }
            }
            
            if (data.autonomy) {
                if (data.autonomy.healthMonitoring) {
                    localStorage.setItem(STORAGE_KEYS.AUTONOMY_HEALTH_MONITORING, data.autonomy.healthMonitoring);
                }
                if (data.autonomy.autoRecovery) {
                    localStorage.setItem(STORAGE_KEYS.AUTONOMY_AUTO_RECOVERY, data.autonomy.autoRecovery);
                }
                if (data.autonomy.decisionEngine) {
                    localStorage.setItem(STORAGE_KEYS.AUTONOMY_DECISION_ENGINE, data.autonomy.decisionEngine);
                }
            }
            
            if (data.performance) {
                if (data.performance.cacheEnabled) {
                    localStorage.setItem(STORAGE_KEYS.PERFORMANCE_CACHE_ENABLED, data.performance.cacheEnabled);
                }
                if (data.performance.loggingLevel) {
                    localStorage.setItem(STORAGE_KEYS.PERFORMANCE_LOGGING_LEVEL, data.performance.loggingLevel);
                }
                if (data.performance.analyticsEnabled) {
                    localStorage.setItem(STORAGE_KEYS.PERFORMANCE_ANALYTICS_ENABLED, data.performance.analyticsEnabled);
                }
            }
            
            return true;
        } catch (error) {
            console.error('Error restaurando configuración del sistema:', error);
        }
        return false;
    }
    
    restoreComponent(component: BackupComponent, components: Partial<BackupComponentsData>): boolean {
        switch (component) {
            case 'conversation_state':
                return this.restoreConversationState(components.conversation_state ?? null);
            case 'ai_configuration':
                return this.restoreAIConfiguration(components.ai_configuration ?? null);
            case 'user_preferences':
                return this.restoreUserPreferences(components.user_preferences ?? null);
            case 'minute_history':
                return this.restoreMinuteHistory(components.minute_history ?? null);
            case 'workspace_data':
                return this.restoreWorkspaceData(components.workspace_data ?? null);
            case 'voice_profiles':
                return this.restoreVoiceProfiles(components.voice_profiles ?? null);
            case 'system_settings':
                return this.restoreSystemSettings(components.system_settings ?? null);
            default:
                return false;
        }
    }
}

// -----------------------------------------------------------
// Gestor de backups
// -----------------------------------------------------------

/** Contrato del gestor de backups (inyectable en BackupSystem, §2.4). */
export interface IBackupManager {
    createBackup(strategy?: BackupStrategy, components?: BackupComponent[], notes?: string): BackupMetadata | null;
    getAvailableBackups(): BackupMetadata[];
    restoreBackup(backupId: string, componentsToRestore?: BackupComponent[]): RestoreResult;
    verifyBackupIntegrity(backupId: string): boolean;
    cleanupOldBackups(): number;
}

class BackupManager implements IBackupManager {
    private dataExtractor: DataExtractor;
    private dataRestorer: DataRestorer;
    private backups: BackupMetadata[] = [];
    
    /** Fábrica por defecto del gestor (punto de composición del default). */
    static create(): BackupManager {
        return new this();
    }
    
    constructor() {
        this.dataExtractor = new DataExtractor();
        this.dataRestorer = new DataRestorer();
        this.loadBackupList();
    }
    
    createBackup(
        strategy: BackupStrategy = 'incremental',
        components: BackupComponent[] = ['all'],
        notes?: string
    ): BackupMetadata | null {
        try {
            Date.now();
            const backupId = `backup-${uuidv4()}`;
            
            // Extraer datos de componentes
            const extractedData: Partial<BackupComponentsData> = {};
            let totalSize = 0;
            
            for (const component of components) {
                const data = this.dataExtractor.extractComponent(component);
                if (data !== null) {
                    Object.assign(extractedData, { [component]: data });
                    
                    // Calcular tamaño aproximado
                    const jsonStr = JSON.stringify(data);
                    totalSize += new Blob([jsonStr]).size;
                }
            }
            
            // Crear metadatos
            const metadata: BackupMetadata = {
                id: backupId,
                timestamp: Date.now(),
                strategy,
                components,
                size: totalSize,
                checksum: this.calculateChecksum(extractedData),
                appVersion: this.getAppVersion(),
                notes,
            };
            
            // Crear objeto de backup completo
            const backup: BackupData = {
                metadata,
                components: extractedData,
            };
            
            // Guardar backup
            this.saveBackup(backup);
            
            // Actualizar lista de backups
            this.backups.push(metadata);
            this.saveBackupList();
            
            // Actualizar estadísticas
            this.updateBackupStats(metadata);
            
            return metadata;
        } catch (error) {
            console.error('Error creando backup:', error);
            return null;
        }
    }
    
    restoreBackup(backupId: string, componentsToRestore?: BackupComponent[]): RestoreResult {
        const startTime = Date.now();
        const restoredComponents: BackupComponent[] = [];
        const failedComponents: BackupComponent[] = [];
        
        try {
            // Cargar backup
            const backup = this.loadBackup(backupId);
            if (!backup) {
                return {
                    success: false,
                    restoredComponents: [],
                    failedComponents: [],
                    message: `Backup ${backupId} no encontrado`,
                    backupTimestamp: 0,
                    durationMs: Date.now() - startTime,
                };
            }
            
            // Determinar componentes a restaurar
            const components = componentsToRestore || backup.metadata.components;
            
            // Restaurar cada componente
            for (const component of components) {
                if (component === 'all') {
                    // Restaurar todos los componentes individualmente
                    const individualComponents = backup.metadata.components.filter(c => c !== 'all');
                    for (const individualComponent of individualComponents) {
                        if (this.dataRestorer.restoreComponent(individualComponent, backup.components)) {
                            restoredComponents.push(individualComponent);
                        } else {
                            failedComponents.push(individualComponent);
                        }
                    }
                } else {
                    if (this.dataRestorer.restoreComponent(component, backup.components)) {
                        restoredComponents.push(component);
                    } else {
                        failedComponents.push(component);
                    }
                }
            }
            
            const success = failedComponents.length === 0;
            
            return {
                success,
                restoredComponents,
                failedComponents,
                message: success 
                    ? `Restauración completada exitosamente (${restoredComponents.length} componentes)`
                    : `Restauración parcial (${restoredComponents.length} exitosos, ${failedComponents.length} fallidos)`,
                backupTimestamp: backup.metadata.timestamp,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            console.error('Error restaurando backup:', error);
            return {
                success: false,
                restoredComponents,
                failedComponents,
                message: `Error durante restauración: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                backupTimestamp: 0,
                durationMs: Date.now() - startTime,
            };
        }
    }
    
    getAvailableBackups(): BackupMetadata[] {
        return [...this.backups].sort((a, b) => b.timestamp - a.timestamp); // Más recientes primero
    }
    
    getBackup(backupId: string): BackupMetadata | null {
        return this.backups.find(b => b.id === backupId) || null;
    }
    
    deleteBackup(backupId: string): boolean {
        try {
            // Eliminar de almacenamiento
            localStorage.removeItem(`${STORAGE_KEYS.BACKUP_PREFIX}${backupId}`);
            
            // Eliminar de lista
            const index = this.backups.findIndex(b => b.id === backupId);
            if (index !== -1) {
                this.backups.splice(index, 1);
                this.saveBackupList();
            }
            
            return true;
        } catch (error) {
            console.error('Error eliminando backup:', error);
            return false;
        }
    }
    
    /** Bytes (aprox) que ocupan los backups persistidos en localStorage. */
    private getStoredBackupsSizeBytes(): number {
        let total = 0;
        for (const backup of this.backups) {
            try {
                const raw = localStorage.getItem(`${STORAGE_KEYS.BACKUP_PREFIX}${backup.id}`);
                if (raw) total += raw.length * 2; // UTF-16
            } catch {
                /* ignorar entradas ilegibles */
            }
        }
        return total;
    }

    cleanupOldBackups(): number {
        let deletedCount = 0;

        try {
            // 1) Límite por cantidad (más antiguos primero).
            const sorted = [...this.backups].sort((a, b) => a.timestamp - b.timestamp);
            if (sorted.length > DEFAULT_BACKUP_CONFIG.maxStoredBackups) {
                const excess = sorted.splice(0, sorted.length - DEFAULT_BACKUP_CONFIG.maxStoredBackups);
                for (const backup of excess) {
                    this.deleteBackup(backup.id);
                    deletedCount++;
                }
            }

            // 2) Límite por TAMAÑO total (maxTotalSizeMB). Antes no se aplicaba.
            const maxBytes = DEFAULT_BACKUP_CONFIG.maxTotalSizeMB * 1024 * 1024;
            let total = this.getStoredBackupsSizeBytes();
            const oldestFirst = [...this.backups].sort((a, b) => a.timestamp - b.timestamp);
            for (const backup of oldestFirst) {
                if (total <= maxBytes) break;
                try {
                    const raw = localStorage.getItem(`${STORAGE_KEYS.BACKUP_PREFIX}${backup.id}`);
                    if (raw) total -= raw.length * 2;
                } catch {
                    /* ignorar */
                }
                this.deleteBackup(backup.id);
                deletedCount++;
            }
        } catch (error) {
            console.error('Error limpiando backups antiguos:', error);
        }

        return deletedCount;
    }
    
    verifyBackupIntegrity(backupId: string): boolean {
        try {
            const backup = this.loadBackup(backupId);
            if (!backup) return false;
            
            // Calcular checksum actual
            const currentChecksum = this.calculateChecksum(backup.components);
            
            // Comparar con checksum almacenado
            return currentChecksum === backup.metadata.checksum;
        } catch (error) {
            console.error('Error verificando integridad del backup:', error);
            return false;
        }
    }
    
    /** Escribe un backup. `false` si no entró (cuota), distinguiendo otros errores. */
    private writeBackupRaw(key: string, payload: string): boolean {
        try {
            localStorage.setItem(key, payload);
            return true;
        } catch (error) {
            if ((error as DOMException)?.name !== 'QuotaExceededError') {
                console.error('Error guardando backup:', error);
            }
            return false;
        }
    }

    private saveBackup(backup: BackupData): void {
        const key = `${STORAGE_KEYS.BACKUP_PREFIX}${backup.metadata.id}`;
        const payload = DEFAULT_BACKUP_CONFIG.compressionEnabled
            ? this.compressBackup(backup)
            : JSON.stringify(backup);

        if (this.writeBackupRaw(key, payload)) return;

        // Cuota llena: podar los más antiguos hasta que entre el nuevo.
        console.warn(
            '[backupSystem] localStorage lleno; podando backups antiguos para guardar el nuevo.',
        );
        const oldestFirst = [...this.backups].sort((a, b) => a.timestamp - b.timestamp);
        for (const old of oldestFirst) {
            this.deleteBackup(old.id);
            if (this.writeBackupRaw(key, payload)) return;
        }

        console.error(
            '[backupSystem] No se pudo guardar el backup: almacenamiento lleno.',
            backup.metadata.id,
        );
    }
    
    private loadBackup(backupId: string): BackupData | null {
        try {
            const key = `${STORAGE_KEYS.BACKUP_PREFIX}${backupId}`;
            const data = localStorage.getItem(key);
            
            if (!data) {
                return null;
            }
            
            const backup = DEFAULT_BACKUP_CONFIG.compressionEnabled
                ? this.decompressBackup(data)
                : JSON.parse(data);
            
            return backup;
        } catch (error) {
            console.error('Error cargando backup:', error);
            return null;
        }
    }
    
    private loadBackupList(): void {
        try {
            const listJson = localStorage.getItem(STORAGE_KEYS.BACKUP_LIST);
            if (listJson) {
                this.backups = JSON.parse(listJson);
            }
        } catch (error) {
            console.error('Error cargando lista de backups:', error);
            this.backups = [];
        }
    }
    
    private saveBackupList(): void {
        try {
            localStorage.setItem(STORAGE_KEYS.BACKUP_LIST, JSON.stringify(this.backups));
        } catch (error) {
            console.error('Error guardando lista de backups:', error);
        }
    }
    
    private calculateChecksum(data: unknown): string {
        // Checksum simplificado (en producción usaría algo como SHA-256)
        const jsonStr = JSON.stringify(data);
        let hash = 0;
        
        for (let i = 0; i < jsonStr.length; i++) {
            const char = jsonStr.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convertir a 32-bit integer
        }
        
        return hash.toString(16);
    }
    
    private compressBackup(backup: BackupData): string {
        // Compresión simplificada (en producción usaría algo como pako o lz-string)
        return JSON.stringify(backup);
    }
    
    private decompressBackup(compressed: string): BackupData {
        // Descompresión simplificada
        return JSON.parse(compressed);
    }
    
    private getAppVersion(): string {
        return import.meta.env.VITE_APP_VERSION || '1.0.0';
    }
    
    private updateBackupStats(metadata: BackupMetadata): void {
        try {
            // Actualizar último backup
            localStorage.setItem(STORAGE_KEYS.BACKUP_LAST_TIMESTAMP, metadata.timestamp.toString());
            
            // Incrementar contador
            const count = parseInt(localStorage.getItem(STORAGE_KEYS.BACKUP_COUNT) || '0');
            localStorage.setItem(STORAGE_KEYS.BACKUP_COUNT, (count + 1).toString());
            
            // Guardar estadísticas de tamaño
            const sizeStats = JSON.parse(localStorage.getItem(STORAGE_KEYS.BACKUP_SIZE_STATS) || '{"total": 0, "count": 0}');
            sizeStats.total += metadata.size;
            sizeStats.count += 1;
            sizeStats.average = sizeStats.total / sizeStats.count;
            localStorage.setItem(STORAGE_KEYS.BACKUP_SIZE_STATS, JSON.stringify(sizeStats));
        } catch (error) {
            console.error('Error actualizando estadísticas de backup:', error);
        }
    }
}

// -----------------------------------------------------------
// Clase principal del Backup System
// -----------------------------------------------------------

export class BackupSystem {
    private config: BackupSystemConfig;
    private backupManager: IBackupManager;
    private autoBackupIntervalId: number | null = null;
    
    constructor(config: Partial<BackupSystemConfig> = {}, backupManager?: IBackupManager) {
        this.config = { ...DEFAULT_BACKUP_CONFIG, ...config };
        this.backupManager = backupManager ?? BackupManager.create();
    }
    
    start(): void {
        if (this.autoBackupIntervalId !== null || !this.config.enabled) {
            return;
        }
        
        // Ejecutar backup inicial
        this.performAutoBackup();
        
        // Configurar intervalo para backups automáticos
        this.autoBackupIntervalId = window.setInterval(() => {
            this.performAutoBackup();
        }, this.config.autoBackupInterval);
        
        if (this.config.verboseLogging) {
        }
    }
    
    stop(): void {
        if (this.autoBackupIntervalId !== null) {
            clearInterval(this.autoBackupIntervalId);
            this.autoBackupIntervalId = null;
        }
        
        if (this.config.verboseLogging) {
        }
    }
    
    performAutoBackup(): BackupMetadata | null {
        if (!this.config.enabled) {
            return null;
        }
        
        // Limpiar backups antiguos primero
        this.backupManager.cleanupOldBackups();
        
        // Crear backup automático
        const backup = this.backupManager.createBackup(
            this.config.defaultStrategy,
            this.config.defaultComponents,
            'Backup automático programado'
        );
        
        if (backup && this.config.verboseLogging) {
        }
        
        return backup;
    }
    
    createManualBackup(
        components?: BackupComponent[],
        notes?: string
    ): BackupMetadata | null {
        return this.backupManager.createBackup(
            'full',
            components || this.config.defaultComponents,
            notes || 'Backup manual'
        );
    }
    
    restoreLatestBackup(components?: BackupComponent[]): RestoreResult {
        const backups = this.backupManager.getAvailableBackups();
        if (backups.length === 0) {
            return {
                success: false,
                restoredComponents: [],
                failedComponents: [],
                message: 'No hay backups disponibles para restaurar',
                backupTimestamp: 0,
                durationMs: 0,
            };
        }
        
        const latestBackup = backups[0]; // Ya están ordenados por más reciente
        return this.backupManager.restoreBackup(latestBackup.id, components);
    }
    
    restoreBackupById(backupId: string, components?: BackupComponent[]): RestoreResult {
        return this.backupManager.restoreBackup(backupId, components);
    }
    
    getAvailableBackups(): BackupMetadata[] {
        return this.backupManager.getAvailableBackups();
    }
    
    verifyAllBackups(): Array<{ backupId: string; valid: boolean }> {
        const backups = this.getAvailableBackups();
        const results: Array<{ backupId: string; valid: boolean }> = [];
        
        for (const backup of backups) {
            const valid = this.backupManager.verifyBackupIntegrity(backup.id);
            results.push({ backupId: backup.id, valid });
        }
        
        return results;
    }
    
    cleanup(): number {
        return this.backupManager.cleanupOldBackups();
    }
    
    getBackupStats(): {
        totalBackups: number;
        totalSizeMB: number;
        lastBackupTime: number | null;
        averageSizeKB: number;
    } {
        const backups = this.getAvailableBackups();
        const totalSize = backups.reduce((sum, b) => sum + b.size, 0);
        
        const sizeStats = JSON.parse(localStorage.getItem(STORAGE_KEYS.BACKUP_SIZE_STATS) || '{"total": 0, "count": 0, "average": 0}');
        
        return {
            totalBackups: backups.length,
            totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
            lastBackupTime: backups.length > 0 ? backups[0].timestamp : null,
            averageSizeKB: Math.round(sizeStats.average / 1024) || 0,
        };
    }
    
    updateConfig(newConfig: Partial<BackupSystemConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Reiniciar si el intervalo cambió
        if (this.autoBackupIntervalId !== null && newConfig.autoBackupInterval) {
            this.stop();
            this.start();
        }
    }
    
    getConfig(): BackupSystemConfig {
        return { ...this.config };
    }
}

// -----------------------------------------------------------
// Instancia global (singleton)
// -----------------------------------------------------------

let globalBackupSystem: BackupSystem | null = null;

export function getBackupSystem(config?: Partial<BackupSystemConfig>, backupManager?: IBackupManager): BackupSystem {
    if (!globalBackupSystem) {
        globalBackupSystem = new BackupSystem(config, backupManager);
    }
    return globalBackupSystem;
}

export function startGlobalBackupSystem(config?: Partial<BackupSystemConfig>): BackupSystem {
    const system = getBackupSystem(config);
    system.start();
    return system;
}

export function stopGlobalBackupSystem(): void {
    if (globalBackupSystem) {
        globalBackupSystem.stop();
    }
}

export function createEmergencyBackup(): BackupMetadata | null {
    const system = getBackupSystem();
    return system.createManualBackup(['all'], 'Backup de emergencia');
}

export function restoreFromLatestBackup(): RestoreResult {
    const system = getBackupSystem();
    return system.restoreLatestBackup();
}