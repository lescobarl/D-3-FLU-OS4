// ============================================================
// FLU OS3 — Aplicación Principal Integrada
// ============================================================
// Integra el avatar 3D (OS1) con los servicios de voz (OS2):
//   - Panel izquierdo: Avatar 3D con controles de voz
//   - Panel derecho: Pestañas con workspace, bitácora, minutas,
//     configuración (usa componentes OS2 directamente)
//
// Flujo de datos:
//   FluAvatarVoiceBridge (STT + TTS + Avatar)
//     → integrationStore (Zustand)
//       → Paneles OS2 (FluParticipantSettingsPanel, etc.)
//
// Cumple:
//   - Rule #1: NO HARDCODE — configuración desde appConfig
//   - Rule #2: NO PARCHES — sin mutaciones externas
//   - Rule #9: NO entregas parciales — features completas
//   - Obligación #5: Log de auditoría
//   - Obligación #6: UUIDv4 en toda inserción
//   - Obligación #7: Sync tuple [revision, updated_at, deleted]
// ============================================================

import React, { useState, useCallback, useRef, useMemo, useEffect, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useConfigPersistence } from './hooks/useConfigPersistence';
import { useCatalogsSettings } from './hooks/useCatalogsSettings';
import { useDocumentGenerationBridge } from './hooks/useDocumentGenerationBridge';
import { useBunnyStore, ensureAvatarPantsVisible, EXPRESSION_MAP } from './avatar';
import { relayLog } from './lib/clientLogRelay';
import { cleanForSpeech, normalizeSpaces, pickLabel } from './lib/textUtils';
import type { BunnyComponent } from './avatar/types/bunny';
import { v4 as uuidv4 } from 'uuid';
import { NotificationCenterBell } from './components/NotificationCenterBell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FluBridgeProvider } from './context/FluBridgeContext';
import { FluAvatarVoiceBridge } from './components/FluAvatarVoiceBridge';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { useIntegrationStore, detectSentiment } from './store/integrationStore';
import { useAuditLog } from './hooks/useAuditLog';
import { useMinuteKnowledge } from './hooks/useMinuteKnowledge';
import { useVoiceProfiles } from './hooks/useVoiceProfiles';
import { useConversationPersistence } from './hooks/useConversationPersistence';
import { useFluParticipant } from './hooks/useFluParticipant';
import { useSessionPersistence, loadSessionState } from './hooks/useSessionPersistence';
import { useWorkspaceImage } from './hooks/useWorkspaceImage';
import { useMinuteHandlers, type MinuteDraft } from './hooks/useMinuteHandlers';
import { useNavigationCommands } from './hooks/useNavigationCommands';
import { useCommunicationProfiles } from './hooks/useCommunicationProfiles';
import { useBrowserProfiles } from './hooks/useBrowserProfiles';
import { useSearchSites } from './hooks/useSearchSites';
import { buildSelfManifesto, isSelfKnowledgeRequest } from './core/selfKnowledge/selfKnowledge';
import { FLU_EVENTS, dispatchFluEvent, dispatchFluResetSearch, onFluEvent } from './core/events/fluEvents';
import { STORAGE_KEYS, WELCOME_MESSAGE, APP_BRANDING, TIMEOUT_POLICY_MS } from './core/config/appConfig';
import { dayKey, shouldRolloverDay } from './core/days/dayRollover';
import type { ConversationEntry, ConversationState, FluContract, FluProfile, VoiceConfig, PersonalityConfig, AdvancedConfig, ImageConfig } from './types/bridge';
import type { VoiceProfileRow } from './voice/components/VoiceProfilesPanel';
import { FLU_PROFILES } from './core/config/appConfig';
import { geminiService } from './services/gemini';
import { playSong, pauseMusic, stopMusic } from './services/musicPlayer';
import { getPreferredAIProvider, setPreferredAIProvider, type AIProvider } from './services/aiServiceFactory';
import { extractTextFromImage } from './services/ocrService';
import { useDocumentAnalysis } from './hooks/useDocumentAnalysis';
import { useAppAnalysis } from './hooks/useAppAnalysis';
import { useDocumentGeneration } from './hooks/useDocumentGeneration';
import { buildGenerationTopic, normalizeWorkspaceDocumentFields, type GenerationConversationSlice } from './lib/generationTopic';
import { createMediaRequestGate } from './core/media/mediaRequestGate';
import { buildResponseKey, isDuplicateResponse } from './core/voice/responseGate';
import {
    loadSearchConfigOverrides,
    saveSearchConfigOverrides,
    clearSearchConfigOverrides,
    type SearchConfigOverrides,
} from './core/search/searchConfigOverrides';
import { isSupportedDocument } from './lib/documentParser';
import { useAutonomyIntegration } from './core/autonomy';
import {
    detectActionInTranscript,
    detectEmotionInTranscript,
    resolveEmotionAnims,
} from './lib/transcriptProcessor';
import { useEnhancedBranding } from './core/branding/useEnhancedBranding';
import { SeasonalEffects } from './core/branding/SeasonalEffects';
import {
    VOICE_CONFIG_CATALOG,
    BRANDING_MODES,
    UI_LANGUAGES,
    AI_PROVIDERS,
    FLU_PROFILE_IDS,
    type ConfigCatalogEntry,
} from './core/config/voiceConfigCatalog';
// Fase 4: el CSS de la app (antes App.css) vive en src/styles/unified.css
// (vía @import desde src/index.css). Aquí solo queda el CSS del BunnyViewer.
// OS1 visual parity: import BunnyViewer styles for 3D avatar rendering
import './avatar/App.css';

// ============================================================
// OS2 Component Imports — local paths (formerly flu-voz alias)
// ============================================================
import { FluShellTabs } from './voice/components/FluShellTabs';
import { VoiceAssistantBarWrapper } from './components/VoiceAssistantBarWrapper';
import type { SettingsGroupId } from './components/FluSettingsTabView';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { useOnboarding } from './hooks/useOnboarding';
import { useOnboardingVoiceCapture } from './hooks/useOnboardingVoiceCapture';
import { useNotificationCenter } from './hooks/useNotificationCenter';
import { useDoNotDisturb } from './hooks/useDoNotDisturb';
// ---- Fase 2 — Memoria y recordatorios: hooks, paneles y parser de intención ----
import { useReminders } from './hooks/useReminders';
import { useShoppingList } from './hooks/useShoppingList';
import { parseReminderIntent, type ReminderIntent, type ReminderIntentData } from './core/reminders/reminderIntentParser';
// ---- Motor temporal genérico — alarmas y temporizadores (despertador + temporizador) ----
import { useTemporalItems } from './hooks/useTemporalItems';
import { parseTemporalIntent, formatDurationMs, type TemporalIntent, type TemporalIntentData } from './core/temporal/temporalIntentParser';
// ---- Fase 7 — Acciones de dispositivo: llamar, WhatsApp, SMS y correo (Módulo I+) ----
import { useDeviceActions } from './hooks/useDeviceActions';
import { parseDeviceActionIntent, type DeviceActionIntentData } from './core/deviceActions/deviceActionIntentParser';
// ---- Horario de clases (Pizarrón): hook temprano y panel presentacional ----
import { useHorario } from './hooks/useHorario';
import { clasesDelDia, type HorarioModo } from './components/HorarioPizarron';
import { diaDeFecha, toMin, toHHMM, type HorarioClaseEstructurada } from './core/horario/horarioService';
import { createScheduleAdapter } from './core/documents/scheduleAdapter';
import { buildDocumentInsumo } from './core/documents/documentInsumo';
import { parseHorarioIntent, type HorarioIntent, type HorarioIntentData } from './core/horario/horarioIntentParser';
import type { NotificationService } from './core/notifications/notificationService';
import { nameCaptureKey, promptForStep, type OnboardingState } from './core/onboarding/onboardingFlow';
import {
    DEFAULT_ONBOARDING_USER,
    resolveActiveUser,
    setActiveUser,
} from './core/onboarding/onboardingService';
// ---- Fase 3 — Multi-usuario: participantes, materia gris y paneles ----
import { useParticipants } from './hooks/useParticipants';
import { resolveKindRole } from './core/multiuser/participantRegistry';
import { useMateriaGris } from './hooks/useMateriaGris';
// ---- Fase 4 — Módulo G: hábitos y metas ----
import { useHabits } from './hooks/useHabits';
// ---- Fase 5 — Módulo H: bienestar y ánimo ----
import { useMood } from './hooks/useMood';
// ---- Fase 6 — Módulos I y J: contactos y diario personal ----
import { useContacts } from './hooks/useContacts';
import { useDiary } from './hooks/useDiary';
import { useNotes } from './hooks/useNotes';
import { useDocuments } from './hooks/useDocuments';
import type { ParticipantRecord, ReminderRecord } from './core/db/fluDatabase';
import { fluDb } from './core/db/fluDatabase';

// ============================================================
// OS2 Library Imports — local paths (formerly flu-voz alias)
// ============================================================
import { useFluVoiceAssistant } from './voice/hooks/useFluVoiceAssistant';
import { speakResponse, waitForSpeechIdle } from './voice/lib/fluSpeech';
import { FLU_CONFIG } from './voice/lib/fluConfig';
import {
    normalizeCommandForDeterministic,
    actionBelongsToTranscript,
    isRecoverableRecognitionError,
    isMinuteGenerationRequest,
} from './voice/lib/audioMath';
import { resolveDeterministicCommand } from './voice/lib/deterministicArbiter';
import { normalizeJuego } from './voice/lib/configCommands';
import { parseNoteIntentText } from './voice/lib/noteIntentParser';
import { resolveNoteRescue } from './voice/lib/noteRescue';
import { normalizeEnvironment } from './core/environments/environmentIntents';
import { applyEnvironment, resetEnvironment } from './core/environments/applyEnvironment';
import {
    getVisibleTabIds,
    DEFAULT_AMBIENTE_ID,
} from './core/environments/environmentRegistry';
import { useEnvironmentStore } from './store/environmentStore';
import { getGameEngine } from './core/games/gameCatalog';
import {
    getActiveGameSession,
    setActiveGameSession,
    clearActiveGameSession,
} from './core/games/gameSessionStore';
import type { GameId, GameSession } from './core/games/types';
import { resolveGameSpeechOptions, type GameSpeechOptions } from './core/games/gameSpeech';
import { getCommandSpeech } from './voice/lib/voiceCommands';
import { formatStreamSttUiStatus } from './voice/lib/transcriptConfig';
import {
    getFluParticipantConfig,
    setFluParticipantOverrides,
    resetFluParticipantOverrides,
    isFluParticipantEnabled,
} from './voice/lib/fluParticipantConfig';
import {
    buildMinuteKnowledgeBase2,
    resolveMinuteQuery,
    selectMinuteForLookup,
    type MinuteLookupSelection,
} from './lib/minuteKnowledgeHelpers';
import {
    buildDailyAgenda,
    formatAgendaForPrompt,
    mergeRemindersIntoAgenda,
} from './lib/dailyAgenda';
import {
    buildSystemConversationEntry,
    type SystemEvent,
} from './lib/systemEventLog';
import { buildFluSpeechAuditRows, deriveUserLastText, selectVisiblePhrase } from './voice/lib/conversationDialogue';
import { evaluateListenParity } from './voice/lib/listenParity';
import { resolveGeminiErrorPresentation } from './voice/lib/geminiDiagnostics';
import { deleteAuditLogsBySpeaker, findVoiceProfileByLabel, deleteVoiceProfile } from './voice/lib/fluStorage';
import { planRawCommit } from './voice/lib/rawCommitPlan';

// ============================================================
// Tipo para las pestañas del panel derecho
// ============================================================
type RightTab = 'workspace' | 'conversation' | 'minutes' | 'settings' | 'system';

// ============================================================
// Rutas por tab — React Router v6 (Fase 3: code-split por tab)
// ============================================================
const TAB_ROUTES: ReadonlyArray<{ tab: RightTab; path: string }> = [
    { tab: 'workspace', path: '/workspace' },
    { tab: 'conversation', path: '/conversation' },
    { tab: 'minutes', path: '/minutes' },
    { tab: 'settings', path: '/settings' },
    { tab: 'system', path: '/system' },
];

const DEFAULT_TAB: RightTab = 'workspace';

function tabFromPath(pathname: string): RightTab {
    const match = TAB_ROUTES.find((r) => r.path === pathname);
    return match ? match.tab : DEFAULT_TAB;
}

function pathForTab(tab: RightTab): string {
    return TAB_ROUTES.find((r) => r.tab === tab)?.path || `/${tab}`;
}

// Vistas por tab cargadas con lazy (cada una es un chunk separado).
const FluWorkspaceTabView = lazy(() => import('./components/FluWorkspaceTabView'));
const FluConversationTabView = lazy(() => import('./components/FluConversationTabView'));
const FluMinutesTabView = lazy(() => import('./components/FluMinutesTabView'));
const FluSettingsTabView = lazy(() => import('./components/FluSettingsTabView'));
const FluSystemTabView = lazy(() => import('./components/FluSystemTabView'));

// ============================================================
// ErrorBoundary — Captura errores de renderizado y los muestra en la UI
// ============================================================
// Helpers
// ============================================================

// Storage keys now come from appConfig (STORAGE_KEYS)
// - STORAGE_KEYS.TEXT_API_KEY
// - STORAGE_KEYS.LANGUAGE
// - STORAGE_KEYS.SESSION_ROLE

// ============================================================
// applyConfigAction — Procesa configuracion por voz desde Gemini
// ============================================================
// Se ejecuta al final de onContractResolved, después de todo lo demás.
// Si falla, no afecta el resto del contrato (try/catch en el caller).
// ============================================================

/**
 * Miembros válidos de BunnyComponent. El Record tipado obliga a listar todos
 * los componentes del tipo: es la fuente runtime del guard (sin lista paralela
 * sin tipar) y mantiene el parámetro real de ctx.setComponentColor.
 */
const BUNNY_COMPONENTS: Record<BunnyComponent, true> = {
    Bunny_full: true,
    Bunny_body: true,
    Bunny_cap: true,
    Bunny_pants: true,
    Bunny_face: true,
    Bunny_eyes: true,
    Bunny_glasses: true,
    Bunny_ears: true,
};

function isBunnyComponent(value: string): value is BunnyComponent {
    return Object.prototype.hasOwnProperty.call(BUNNY_COMPONENTS, value);
}

function isAIProvider(value: string): value is AIProvider {
    return (AI_PROVIDERS as readonly string[]).includes(value);
}

interface ApplyConfigContext {
    branding: ReturnType<typeof useEnhancedBranding>;
    languageRef: React.MutableRefObject<string>;
    setLanguage?: (lang: 'es' | 'en' | 'both') => void;
    setSessionRole?: (role: string) => void;
    handleTextApiKeyCommit?: (key: string) => void;
    handleTextModelCommit?: (model: string) => void;
    handleTextApiUrlCommit?: (url: string) => void;
    handleImageApiKeyCommit?: (key: string) => void;
    handleImageModelCommit?: (model: string) => void;
    handleImageApiUrlCommit?: (url: string) => void;
    handleOcrApiKeyCommit?: (key: string) => void;
    handleOcrModelCommit?: (model: string) => void;
    handleOcrApiUrlCommit?: (url: string) => void;
    setComponentColor?: (component: BunnyComponent, color: string) => void;
    resetComponentColors?: () => void;
    /** Aplicar configuración de voz (rate/volume) al integrationStore */
    setVoiceConfig?: (config: Partial<VoiceConfig>) => void;
    /** Establecer configuración de personalidad (setPersonality del integrationStore) */
    setPersonality?: (config: Partial<PersonalityConfig>) => void;
    /** Establecer configuración avanzada (setAdvancedConfig del integrationStore) */
    setAdvancedConfig?: (config: Partial<AdvancedConfig>) => void;
    /** Establecer configuración de imagen del avatar (setImageConfig del integrationStore) */
    setImageConfig?: (config: Partial<ImageConfig>) => void;
    /** Voces TTS instaladas (para la clave "voice") */
    voices?: SpeechSynthesisVoice[];
    /** Cambiar el proveedor de IA preferido */
    handleSetAiProvider?: (provider: string) => void;
    /** Activar/desactivar celebraciones por logros (branding) */
    setCelebrateAchievements?: (enabled: boolean) => void;
    /** Aplicar un perfil completo de FLU */
    applyProfile?: (profileId: FluProfile) => void;
    /** Limpiar caché y recargar (useConfigPersistence) */
    handleClearCache?: () => void;
    /** Palabras de activación actuales (ref fresca para onContractResolved memoizado) */
    wakeWordsRef: React.MutableRefObject<string>;
    setWakeWords?: (value: string) => void;
    /** Logs de depuración persistidos */
    setDebugLogsEnabled?: (enabled: boolean) => void;
}

// ============================================================
// Despachador de configuración por voz (data-driven)
// ============================================================
// VOICE_CONFIG_CATALOG es la ÚNICA fuente de verdad: la entrada
// (accion + clave) → handler → acción real. Añadir una opción al
// módulo de configuración = añadir una entrada al catálogo; aquí
// no hay que tocar nada más (sin hardcode, sin parches).
// ============================================================

/** Convierte un valor booleano lenient ("true"/"false"/"1"/"0"/"sí"/"no"). */
function parseBoolean(value: string): boolean | null {
    const v = value.trim().toLowerCase();
    const truthy = ['true', '1', 'yes', 'si', 'sí', 'on', 'activar', 'activa', 'encender', 'mostrar', 'visible'];
    const falsy = ['false', '0', 'no', 'off', 'desactivar', 'desactiva', 'apagar', 'ocultar', 'oculta', 'invisible'];
    if (truthy.includes(v)) return true;
    if (falsy.includes(v)) return false;
    return null;
}

/**
 * Aplica un valor numérico validando el rango del catálogo (entry.min/max)
 * y convirtiendo unidades de entrada (minutes/seconds) a ms si hace falta.
 * `apply` recibe el número ya validado para el store objetivo.
 */
function applyNumberConfig(
    entry: ConfigCatalogEntry,
    raw: string,
    apply: (n: number) => void,
): boolean {
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) {
        console.warn(`[applyConfigAction] Valor numérico inválido para "${entry.clave}":`, raw);
        return false;
    }
    let value = parsed;
    if (entry.inputUnit === 'minutes') value = value * 60_000;
    else if (entry.inputUnit === 'seconds') value = value * 1_000;
    if (entry.min !== undefined && value < entry.min) {
        console.warn(`[applyConfigAction] "${entry.clave}" fuera de rango (min ${entry.min}):`, value);
        return false;
    }
    if (entry.max !== undefined && value > entry.max) {
        console.warn(`[applyConfigAction] "${entry.clave}" fuera de rango (max ${entry.max}):`, value);
        return false;
    }
    apply(value);
    return true;
}

/**
 * Despacha una acción de configuración del contrato a la acción real,
 * usando el catálogo como fuente de verdad (sin switches hardcodeados).
 */
async function applyConfigAction(
    configAction: { accion: string; componente: string; clave: string; valor: string; subvalor?: string; meta?: Record<string, unknown> },
    ctx: ApplyConfigContext,
): Promise<void> {
    const { accion, clave, valor, subvalor } = configAction;

    const entry = VOICE_CONFIG_CATALOG.find((e) => e.accion === accion && e.clave === clave);
    if (!entry) {
        console.warn('[applyConfigAction] Clave sin entrada en catálogo:', accion, clave);
        return;
    }
    if (entry.handler === 'unsupported') {
        console.info('[applyConfigAction] Opción no soportada por voz, omitida:', clave, entry.motivoNoSoportado ?? '');
        return;
    }

    switch (entry.handler) {
        // --------------------------------------------------------
        // BRANDING (set_branding) — useSeasonalBranding
        // --------------------------------------------------------
        case 'brandingActiveSeason': {
            // Cambiar temporada activa (fuerza modo manual automáticamente)
            await ctx.branding.seasonalActions.setMode('manual');
            await ctx.branding.seasonalActions.setActiveSeason(valor);
            break;
        }
        case 'brandingMode': {
            // Modo: auto | manual | disabled
            if ((BRANDING_MODES as readonly string[]).includes(valor)) {
                await ctx.branding.seasonalActions.setMode(valor as 'auto' | 'manual' | 'disabled');
            } else {
                console.warn('[applyConfigAction] Modo branding inválido:', valor);
            }
            break;
        }
        case 'brandingBirthday': {
            // Cumpleaños: "YYYY-MM-DD"
            await ctx.branding.seasonalActions.setBirthday(valor || null);
            break;
        }
        case 'brandingCelebrateAchievements': {
            const enabled = parseBoolean(valor);
            if (enabled !== null) {
                await ctx.setCelebrateAchievements?.(enabled);
            } else {
                console.warn('[applyConfigAction] Booleano inválido para celebrateAchievements:', valor);
            }
            break;
        }
        case 'brandingCustomEvent': {
            // Festividad personalizada: valor "nombre|MM-DD|paleta", subvalor "add"|"remove"
            const mode = subvalor?.trim().toLowerCase();
            const parts = valor.split('|').map((s) => s.trim());
            if (mode === 'add' || mode === 'agregar' || mode === 'añade' || mode === 'añadir') {
                const [name = '', mmdd = '', palette = 'cumpleanos'] = parts;
                const m = mmdd.match(/^(\d{1,2})-(\d{1,2})$/);
                if (!name || !m) {
                    console.warn('[applyConfigAction] Festividad personalizada inválida (esperaba "nombre|MM-DD|paleta"):', valor);
                    break;
                }
                const id = `custom-${uuidv4()}`;
                await ctx.branding.seasonalActions.addCustomEvent({ id, name, month: Number(m[1]), day: Number(m[2]), palette });
            } else if (mode === 'remove' || mode === 'quitar' || mode === 'eliminar') {
                const targetName = parts[0] || '';
                const events = ctx.branding.config.customEvents ?? [];
                const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
                const match = events.find((e) => norm(e.name) === norm(targetName));
                if (match) {
                    await ctx.branding.seasonalActions.removeCustomEvent(match.id);
                } else {
                    console.warn('[applyConfigAction] Festividad personalizada no encontrada:', targetName);
                }
            } else {
                console.warn('[applyConfigAction] customEvent requiere subvalor "add"|"remove":', subvalor);
            }
            break;
        }

        // --------------------------------------------------------
        // TEXTO / IMAGEN (set_config) — useConfigPersistence
        // --------------------------------------------------------
        case 'textApiKey':
            ctx.handleTextApiKeyCommit?.(valor);
            break;
        case 'textModel':
            ctx.handleTextModelCommit?.(valor);
            break;
        case 'textApiUrl':
            ctx.handleTextApiUrlCommit?.(valor);
            break;
        case 'imageApiKey':
            ctx.handleImageApiKeyCommit?.(valor);
            break;
        case 'imageModel':
            ctx.handleImageModelCommit?.(valor);
            break;
        case 'imageApiUrl':
            ctx.handleImageApiUrlCommit?.(valor);
            break;
        case 'ocrApiKey':
            ctx.handleOcrApiKeyCommit?.(valor);
            break;
        case 'ocrModel':
            ctx.handleOcrModelCommit?.(valor);
            break;
        case 'ocrApiUrl':
            ctx.handleOcrApiUrlCommit?.(valor);
            break;

        // --------------------------------------------------------
        // GENERAL (set_config)
        // --------------------------------------------------------
        case 'language': {
            if ((UI_LANGUAGES as readonly string[]).includes(valor)) {
                ctx.setLanguage?.(valor as 'es' | 'en' | 'both');
            } else {
                console.warn('[applyConfigAction] Idioma inválido:', valor);
            }
            break;
        }
        case 'sessionRole':
            ctx.setSessionRole?.(valor);
            break;

        // --------------------------------------------------------
        // VOZ (set_config → setVoiceConfig)
        // --------------------------------------------------------
        case 'voiceSpeed': {
            // Velocidad TTS: el catálogo admite 0.1-10.0 pero se acota al
            // rango seguro del slider de la UI (0.5-2.0).
            const speed = Number.parseFloat(valor);
            if (!Number.isNaN(speed) && speed >= 0.1 && speed <= 10.0) {
                const clamped = Math.min(2.0, Math.max(0.5, speed));
                ctx.setVoiceConfig?.({ rate: clamped });
            }
            break;
        }
        case 'voiceNumber': {
            applyNumberConfig(entry, valor, (n) => {
                ctx.setVoiceConfig?.({ [entry.clave]: n } as Partial<VoiceConfig>);
            });
            break;
        }
        case 'voice': {
            // Match por voiceURI exacto → nombre exacto → coincidencia parcial.
            const voices = ctx.voices ?? [];
            const target = valor.trim();
            if (!target) break;
            const exact = voices.find((v) => v.voiceURI === target || v.name === target);
            const partial = !exact
                ? voices.find(
                      (v) =>
                          v.name.toLowerCase().includes(target.toLowerCase()) ||
                          v.voiceURI.toLowerCase().includes(target.toLowerCase()),
                  )
                : undefined;
            const selected = exact ?? partial;
            if (selected) {
                ctx.setVoiceConfig?.({ voiceURI: selected.voiceURI, voiceName: selected.name });
            } else {
                console.warn('[applyConfigAction] Voz no encontrada (¿voces aún cargándose?):', target);
            }
            break;
        }

        // --------------------------------------------------------
        // PERSONALIDAD (set_config → setPersonality)
        // --------------------------------------------------------
        case 'personalityTraits': {
            const trait = valor.trim();
            if (!trait) break;
            const current = useIntegrationStore.getState().config.personality?.traits ?? [];
            const mode = subvalor?.trim().toLowerCase();
            let next: string[];
            if (mode === 'add' || mode === 'agregar' || mode === 'añadir') {
                next = current.includes(trait) ? current : [...current, trait];
            } else if (mode === 'remove' || mode === 'quitar' || mode === 'eliminar') {
                next = current.filter((t) => t !== trait);
            } else {
                console.warn('[applyConfigAction] traits requiere subvalor "add"|"remove":', subvalor);
                break;
            }
            ctx.setPersonality?.({ traits: next } as Partial<PersonalityConfig>);
            break;
        }
        case 'personalitySelect': {
            if (entry.opciones && !entry.opciones.includes(valor)) {
                console.warn(`[applyConfigAction] Valor inválido para "${entry.clave}":`, valor);
                break;
            }
            ctx.setPersonality?.({ [entry.clave]: valor } as Partial<PersonalityConfig>);
            break;
        }
        case 'personalityText': {
            ctx.setPersonality?.({ [entry.clave]: valor } as Partial<PersonalityConfig>);
            break;
        }
        case 'personalityNumber': {
            applyNumberConfig(entry, valor, (n) => {
                ctx.setPersonality?.({ [entry.clave]: n } as Partial<PersonalityConfig>);
            });
            break;
        }

        // --------------------------------------------------------
        // AVANZADO (set_config → setAdvancedConfig)
        // Claves del catálogo == campos de AdvancedConfig.
        // --------------------------------------------------------
        case 'advancedNumber': {
            applyNumberConfig(entry, valor, (n) => {
                ctx.setAdvancedConfig?.({ [entry.clave]: n } as Partial<AdvancedConfig>);
            });
            break;
        }

        // --------------------------------------------------------
        // IMAGEN DEL AVATAR (set_config → setImageConfig)
        // Claves del catálogo == campos de ImageConfig.
        // --------------------------------------------------------
        case 'imageBoolean': {
            const enabled = parseBoolean(valor);
            if (enabled !== null) {
                ctx.setImageConfig?.({ [entry.clave]: enabled } as Partial<ImageConfig>);
            } else {
                console.warn(`[applyConfigAction] Booleano inválido para "${entry.clave}":`, valor);
            }
            break;
        }

        // --------------------------------------------------------
        // COLORES DEL AVATAR (set_config → BunnyStore)
        // --------------------------------------------------------
        case 'avatarColor': {
            // Formato: "component:color" (ej. "Bunny_pants:#8B4513")
            const [component, color] = valor.split(':');
            if (component && color && isBunnyComponent(component)) {
                ctx.setComponentColor?.(component, color);
            } else {
                console.warn('[applyConfigAction] avatarColor requiere "componente:color":', valor);
            }
            break;
        }
        case 'avatarComponentColor': {
            const map: Record<string, BunnyComponent> = {
                pantsColor: 'Bunny_pants',
                bodyColor: 'Bunny_body',
                faceColor: 'Bunny_face',
            };
            const component = map[entry.clave];
            if (component) {
                ctx.setComponentColor?.(component, valor);
            }
            break;
        }
        case 'resetAvatarColors': {
            ctx.resetComponentColors?.();
            break;
        }

        // --------------------------------------------------------
        // MOTOR IA / PERFIL (set_config)
        // --------------------------------------------------------
        case 'aiProvider': {
            if ((AI_PROVIDERS as readonly string[]).includes(valor)) {
                ctx.handleSetAiProvider?.(valor);
            } else {
                console.warn('[applyConfigAction] Proveedor IA inválido:', valor);
            }
            break;
        }
        case 'applyProfile': {
            if ((FLU_PROFILE_IDS as readonly string[]).includes(valor)) {
                ctx.applyProfile?.(valor as FluProfile);
            } else {
                console.warn('[applyConfigAction] Perfil inválido:', valor);
            }
            break;
        }
        case 'wakeWords': {
            const word = valor.trim();
            if (!word) break;
            const mode = subvalor?.trim().toLowerCase();
            const current = (ctx.wakeWordsRef?.current ?? '')
                .split('\n')
                .map((w) => w.trim())
                .filter(Boolean);
            let next: string[];
            if (mode === 'add' || mode === 'agregar' || mode === 'añadir') {
                next = current.includes(word) ? current : [...current, word];
            } else if (mode === 'remove' || mode === 'quitar' || mode === 'eliminar') {
                next = current.filter((w) => w !== word);
            } else {
                console.warn('[applyConfigAction] wakeWords requiere subvalor "add"|"remove":', subvalor);
                break;
            }
            ctx.setWakeWords?.(next.join('\n'));
            break;
        }
        case 'debugLogs': {
            const enabled = parseBoolean(valor);
            if (enabled !== null) {
                ctx.setDebugLogsEnabled?.(enabled);
            } else {
                console.warn('[applyConfigAction] Booleano inválido para debugLogs:', valor);
            }
            break;
        }
        case 'clearCache': {
            ctx.handleClearCache?.();
            break;
        }

        default:
            console.warn('[applyConfigAction] Handler no implementado:', entry.handler);
    }
}

// ============================================================
// Juegos por voz (fast-path determinista) — plan-juegos §7
// ============================================================
// Cada motor vive en src/core/games/* y es 100% local y
// determinista: Gemini NUNCA arbitra el estado de la partida.
// applyGameAction recibe el contrato ya normalizado por
// normalizeJuego desde onContractResolved (ruta única) y ejecuta
// el motor, aplica la emoción resultante al avatar (source='game')
// y habla el prompt con el mismo mecanismo de la ruta de Gemini.
// ============================================================

interface ApplyGameContext {
    languageRef: React.MutableRefObject<string>;
    conversationActiveRef: React.MutableRefObject<boolean>;
    speakFluRef: React.MutableRefObject<(text: string, lang: string, opts?: GameSpeechOptions) => Promise<void>>;
    /** Reanuda la escucha tras hablar (useNavigationCommands, estable). */
    scheduleResumeListening: (textLength?: number) => void;
}

/** Aplica la emoción/animación de un resultado de motor al avatar. */
function applyGameEmotion(result: { animation?: string; emotion?: string }): void {
    const emotionLabel = result.animation || result.emotion || '';
    const resolvedEmotionAnims: string[] = emotionLabel
        ? (resolveEmotionAnims(emotionLabel, EXPRESSION_MAP) ?? [])
        : [];
    if (resolvedEmotionAnims.length > 0) {
        useIntegrationStore.getState().setPendingEmotionAnims(resolvedEmotionAnims, 'game', null);
        relayLog('LOG', 'App', `[Juego] pendingEmotionAnims ← [${resolvedEmotionAnims.join(', ')}] (emotionLabel="${emotionLabel}" source='game')`);
    }
}

/**
 * Habla el prompt del motor replicando el mecanismo de habla de
 * onContractResolved (SPEAKING → habla → LISTENING/IDLE + resume).
 */
async function speakGameText(text: string, ctx: ApplyGameContext, opts?: GameSpeechOptions): Promise<void> {
    if (!text) return;

    const currentSpeakFlu = ctx.speakFluRef.current;
    const speakPromise = currentSpeakFlu(text, ctx.languageRef.current, opts).catch((speechErr: unknown) => {
        console.warn('[Juego] speakFlu failed:', speechErr);
    });

    useIntegrationStore.getState().setConversationState('SPEAKING');
    useIntegrationStore.getState().setFluSpeaking(true);
    useIntegrationStore.getState().incrementInteractionCount();
    useIntegrationStore.getState().pushBridgeEvent({ type: 'speaking:start', timestamp: Date.now() });

    if (speakPromise) {
        try {
            await speakPromise;
        } catch (speechErr) {
            console.warn('[Juego] speakFlu failed:', speechErr);
        }
    }
    const nextResumeState = ctx.conversationActiveRef.current ? 'LISTENING' : 'IDLE';
    useIntegrationStore.getState().setConversationState(nextResumeState);
    useIntegrationStore.getState().setFluSpeaking(false);
    ctx.scheduleResumeListening(text.length);
}

/** Configuración de motor data-driven desde FLU_CONFIG.games. */
function buildGameConfig(gameId: string): Record<string, unknown> {
    const games = FLU_CONFIG.games || {};
    const base: Record<string, unknown> = { rounds: games.defaultRounds };
    if (gameId === 'simon_dice') {
        const simon = games.simonDice || {};
        return { ...base, verbos: [...(simon.verbos || [])], longMax: simon.longMax };
    }
    if (gameId === 'adivina_numero') {
        const cfg = games.adivinaNumero || {};
        return { ...base, min: cfg.min, max: cfg.max, pistasMax: cfg.pistasMax };
    }
    if (gameId === 'calculo_mental') {
        const cfg = games.calculoMental || {};
        return { ...base, maxSuma: cfg.maxSuma, operaciones: [...(cfg.operaciones || [])] };
    }
    if (gameId === 'ahorcado') {
        const cfg = games.ahorcado || {};
        return { ...base, intentos: cfg.intentos };
    }
    if (gameId === 'memoria_secuencias') {
        const cfg = games.memoriaSecuencias || {};
        return { ...base, longMax: cfg.longMax };
    }
    if (gameId === 'cuento_colaborativo') {
        const cfg = games.cuentoColaborativo || {};
        return { ...base, turnos: cfg.turnos };
    }
    if (gameId === 'cuenta_conmigo') {
        const cfg = games.cuentaConmigo || {};
        return { ...base, hasta: cfg.hasta };
    }
    if (gameId === 'respiracion') {
        const cfg = games.respiracion || {};
        return { ...base, rondas: cfg.rondas };
    }
    if (gameId === 'loteria') {
        const cfg = games.loteria || {};
        return { ...base, tablaSize: cfg.tablaSize };
    }
    if (gameId === 'cuentacuentos') {
        const cfg = games.cuentacuentos || {};
        return { ...base, escenasMax: cfg.escenasMax };
    }
    return base;
}

/** Los juegos que reproducen pista musical real (FLU_PLAYLIST) en `session.state.songId`. */
const MUSIC_GAME_IDS: ReadonlySet<string> = new Set(['adivina_cancion', 'karaoke']);

/** Detiene la música si el juego activo la está usando. */
function stopMusicForGame(gameId: string): void {
    if (MUSIC_GAME_IDS.has(gameId)) {
        stopMusic();
    }
}

/** Reproduce la pista que el motor eligió (songId) para juegos musicales. */
function playSongForGame(session: GameSession, gameId: string): void {
    if (!MUSIC_GAME_IDS.has(gameId)) return;
    const songId = (session.state as { songId?: string } | null)?.songId;
    if (songId) {
        void playSong(songId);
    }
}

interface NormalizedGameAction {
    gameId: string;
    action: string;
    playerText?: string;
    narrative?: { scenes: Array<{ texto: string; animacion?: string; emocion?: string }> };
}

/**
 * Ejecuta una acción de juego (start/turn/end/narrate) con el motor
 * local del catálogo. No relanza excepciones: cualquier error se
 * registra y se responde de forma amigable.
 */
async function applyGameAction(juegoAction: NormalizedGameAction, ctx: ApplyGameContext): Promise<void> {
    if (juegoAction.action === 'narrate') {
        const engine = getGameEngine(juegoAction.gameId as GameId);
        const scenes = juegoAction.narrative?.scenes;
        if (!engine?.narrate || !scenes || scenes.length === 0) {
            await speakGameText('No puedo narrar esa historia ahora mismo. ¿Probamos otra cosa?', ctx);
            return;
        }
        const config = buildGameConfig(juegoAction.gameId);
        const session = getActiveGameSession() ?? engine.createSession(config);
        if (!getActiveGameSession()) setActiveGameSession(session);
        const result = engine.narrate(session, scenes, config);
        applyGameEmotion(result);
        await speakGameText(result.prompt, ctx);
        return;
    }

    const engine = getGameEngine(juegoAction.gameId as GameId);
    if (!engine) {
        await speakGameText('Ese juego todavía no está disponible. Prueba con Simón dice o adivinanzas.', ctx);
        return;
    }

    if (juegoAction.action === 'end') {
        clearActiveGameSession();
        stopMusicForGame(juegoAction.gameId);
        await speakGameText('¡Hasta la próxima partida! ¿Qué más hacemos?', ctx);
        return;
    }

    if (juegoAction.action === 'start') {
        const config = buildGameConfig(juegoAction.gameId);
        const session = engine.createSession(config);
        const result = engine.start(session, config);
        setActiveGameSession(session);
        applyGameEmotion(result);
        playSongForGame(session, juegoAction.gameId);
        await speakGameText(result.prompt, ctx);
        return;
    }

    const activeSession = getActiveGameSession();
    if (!activeSession) {
        await speakGameText('No hay una partida activa. Dime a qué juego quieres jugar.', ctx);
        return;
    }
    const result = engine.turn(activeSession, juegoAction.playerText || '');
    if (result.gameOver) {
        clearActiveGameSession();
        stopMusicForGame(juegoAction.gameId);
    }
    applyGameEmotion(result);
    const speechOpts = resolveGameSpeechOptions(result);
    await speakGameText(result.prompt, ctx, speechOpts);
}

// ============================================================
// App
// ============================================================

/**
 * Determina si un workspace de tipo 'text' es una respuesta conversacional
 * redundante (el contenido escrito duplica la respuesta hablada) en lugar de
 * contenido estructurado genuino.
 *
 * El contrato de IA (deepseek.ts/gemini.ts) instruye: "workspace debe
 * establecerse cuando el usuario pide crear contenido". Sin embargo, los
 * modelos suelen rellenar workspace.contenido con la MISMA respuesta hablada
 * para preguntas conversacionales simples ("platícame de los autos a
 * gasolina"). Eso provoca que la pestaña «respuesta» del Pizarrón muestre el
 * texto en 2 lugares (latestResponse + workspaceArtifact.contenido).
 *
 * Se considera contenido genuino (NO redundante) cuando:
 *   - hay puntos_clave distintos (estructura real), o
 *   - el contenido escrito difiere sustancialmente de la respuesta hablada
 *     (p. ej. una versión escrita más extensa/detallada).
 */
function isRedundantTextWorkspace(opts: {
    contenido: string;
    titulo: string;
    puntosClave: string[];
    respuestaVoz: string;
}): boolean {
    const { contenido, titulo, puntosClave, respuestaVoz } = opts;
    // Puntos clave reales ⇒ contenido estructurado, no redundante.
    if (puntosClave.length > 0) return false;

    const spoken = normalizeSpaces(respuestaVoz);
    const written = normalizeSpaces(contenido || titulo || '');
    if (!spoken || !written) return false;

    // Si el contenido escrito es esencialmente la respuesta hablada (mismo
    // texto o subconjunto casi idéntico), es redundante.
    const spokenTokens = spoken.toLowerCase().split(' ').filter(Boolean);
    const writtenTokens = written.toLowerCase().split(' ').filter(Boolean);
    if (!spokenTokens.length || !writtenTokens.length) return false;

    const writtenSet = new Set(writtenTokens);
    let overlap = 0;
    for (const token of spokenTokens) {
        if (writtenSet.has(token)) overlap += 1;
    }
    const overlapRatio = overlap / spokenTokens.length;
    // Umbral alto: solo se suprime cuando el escrito replica casi por completo
    // lo hablado (respuesta conversacional duplicada), no cuando añade detalle.
    return overlapRatio >= 0.85;
}

// ============================================================
// Helpers de despacho determinista (nivel módulo)
// ============================================================
// Se extraen a nivel módulo para que la RUTA CONVERSACIONAL (acciones del
// LLM) y el FALLBACK OFFLINE (re-parseo del transcript crudo) compartan el
// MISMO conjunto de manejadores __fluHandle* y las MISMAS options del
// árbitro. Esto unifica la ejecución: el LLM decide la intención de forma
// conversacional (Siri/Alexa/Google-style) y los parsers deterministas
// ejecutan la intención estructurada precisa (dueAt, durationMs, etc.).
// ============================================================

/**
 * Construye las options del árbitro determinista a partir de FLU_CONFIG.
 * Misma fuente que usan los manejadores __fluHandle* para que el `action`
 * devuelto sea COMPLETO (con defaultOffsetMs, defaultAlarmTimeOfDay y
 * defaultTimerMinutes aplicados) y el despacho no tenga que re-parcear.
 */
interface ArbiterOptions {
    defaultOffsetMs: number;
    now: number;
    defaultAlarmTimeOfDay: string | undefined;
    defaultTimerMinutes: number;
}

function buildArbiterOptions(): ArbiterOptions {
    const arbiterRemindersConfig = FLU_CONFIG?.reminders || {};
    const arbiterOffsetMinutes = Number(
        arbiterRemindersConfig.defaultReminderOffsetMinutes,
    );
    const arbiterDefaultOffsetMs = (Number.isFinite(arbiterOffsetMinutes)
        ? arbiterOffsetMinutes
        : 10) * 60 * 1000;
    const arbiterTemporalConfig = FLU_CONFIG?.temporal || {};
    return {
        defaultOffsetMs: arbiterDefaultOffsetMs,
        now: Date.now(),
        defaultAlarmTimeOfDay: arbiterTemporalConfig.defaultAlarmTimeOfDay,
        defaultTimerMinutes: Number(arbiterTemporalConfig.defaultTimerMinutes) || 5,
    };
}

/** Marca si la última acción despachada NO logró escribir (para no confirmar en falso). */
let lastActionFailed = false;

/**
 * Adaptador OCR→horario (config-driven). Solo PROPONE si el texto parece un
 * horario real; con documentos genéricos devuelve null (evita falsos positivos).
 */
const scheduleAdapter = createScheduleAdapter({
    minEntries: Number(FLU_CONFIG?.horario?.ocrAdapter?.minEntries) || 2,
});

/** Resultado del árbitro determinista (contrato de deterministicArbiter.js). */
interface ArbiterResult {
    matched: boolean;
    domain: string | null;
    action: unknown;
    channel: string | null;
}

/** Diagnóstico del contrato resuelto (incluye la ruta de minuta). */
interface ContractDiagnostics {
    route?: string;
    historyCode?: string | null;
    [key: string]: unknown;
}

/** Workspace del contrato con el campo extra `modo` (horario). */
type ResolvedWorkspace = NonNullable<FluContract['workspace']> & { modo?: unknown };

/** Contrato FLU con los campos extra que el motor de voz adjunta. */
type ResolvedContract = Omit<FluContract, 'workspace'> & {
    workspace?: ResolvedWorkspace | null;
    juego?: unknown;
    ambiente?: unknown;
};

/** Payload entregado por el motor de voz al resolver un contrato. */
interface ContractResolution {
    userCommitOnly?: boolean;
    transcript?: string;
    speakerName?: string;
    rawOnly?: boolean;
    phase?: string;
    replaceLastRawLog?: boolean;
    contract?: ResolvedContract | null;
    diagnostics?: ContractDiagnostics;
    fastPathGame?: unknown;
    fastPathEnvironment?: unknown;
}

/** Intención estructurada de nota aceptada por el manejador de voz. */
interface NoteVoiceIntent {
    action?: string;
    handled?: boolean;
    data?: { label?: unknown };
}

/** Intención estructurada de diario aceptada por el manejador de voz. */
interface DiaryVoiceIntent {
    action?: string;
    handled?: boolean;
    data?: { content?: unknown };
}

/** Lee una propiedad string de un valor desconocido (para logs). */
function readStringProp(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const prop = Reflect.get(value, key);
    return typeof prop === 'string' ? prop : undefined;
}

/**
 * Resuelve una intención ESTRUCTURADA a partir del `dominio` que el cerebro
 * conversacional ya clasificó (`accion.dominio`), cuando el re-parseo del texto
 * libre con el árbitro NO matcheó. No cambia la autoridad del parser: usa el
 * MISMO parser de dominio, solo que sin exigir el trigger verbal.
 */
function resolveDomainScopedIntent(
    domain: string | null | undefined,
    text: string,
    opts: { defaultOffsetMs?: number; now?: number; language?: 'es' | 'en' },
): ArbiterResult | null {
    if (!domain || !text) return null;
    if (domain === 'reminder') {
        const intent = parseReminderIntent(text, {
            now: opts.now ? () => opts.now as number : undefined,
            defaultOffsetMs: opts.defaultOffsetMs,
            assumedDomain: 'reminder',
            language: opts.language,
        });
        if (intent?.handled && intent?.action) {
            return { matched: true, domain: 'reminder', action: intent, channel: 'flu' };
        }
        return null;
    }
    if (domain === 'note') {
        const parsed = parseNoteIntentText(text);
        if (parsed?.label) {
            return {
                matched: true,
                domain: 'note',
                action: { handled: true, action: 'notes.add', data: { label: parsed.label } },
                channel: 'flu',
            };
        }
        return null;
    }
    if (domain === 'horario') {
        const intent = parseHorarioIntent(String(text || '').trim());
        if (intent?.handled && intent?.action) {
            return { matched: true, domain: 'horario', action: intent, channel: 'flu' };
        }
        return null;
    }
    if (domain === 'temporal') {
        const temporalCfg = FLU_CONFIG.temporal || {};
        const intent = parseTemporalIntent(String(text || ''), {
            now: opts.now ?? Date.now(),
            defaultAlarmTimeOfDay: temporalCfg.defaultAlarmTimeOfDay,
            defaultTimerMinutes: Number(temporalCfg.defaultTimerMinutes) || 5,
        });
        if (intent?.handled && intent?.action) {
            return { matched: true, domain: 'temporal', action: intent, channel: 'flu' };
        }
        return null;
    }
    if (domain === 'diary') {
        // Mismo punto de parseo que __fluHandleDiaryText (texto crudo).
        const clean = String(text || '').trim();
        const enDiario =
            /^(?:escribe|guarda|anota|apunta|registra)\s+(?:en\s+)?(?:el\s+|mi\s+)?diario\s*[:,\-]?\s+(.+)$/i.exec(
                clean,
            );
        const diarioPrefijo = /^diario\s*[:,\-]?\s+(.+)$/i.exec(clean);
        const match = enDiario || diarioPrefijo;
        const content = match?.[1]?.trim();
        if (content) {
            return {
                matched: true,
                domain: 'diary',
                action: { handled: true, action: 'diary.add', data: { content } },
                channel: 'flu',
            };
        }
        return null;
    }
    return null;
}

/**
 * Despacha el intent COMPLETO de un resultado del árbitro determinista al
 * manejador __fluHandle* correspondiente según su dominio. Devuelve la
 * confirmación hablada del manejador (o '' si no hubo dominio/intent).
 * Los manejadores se invocan vía window en runtime (siempre tienen closures
 * frescas porque se reasignan cada render).
 */
async function dispatchArbiterIntent(
    arbiterResult: ArbiterResult,
    opts: { speakerName?: string },
): Promise<string> {
    const w = window;
    const domain = arbiterResult?.matched ? arbiterResult.domain : null;
    const intent: unknown = arbiterResult?.action || null;
    const intentLabel = readStringProp(intent, 'action')
        ?? readStringProp(intent, 'gameId')
        ?? readStringProp(intent, 'comando')
        ?? JSON.stringify(intent ?? null)?.slice(0, 120);
    relayLog('LOG', 'App', `dispatchArbiterIntent: domain="${domain}" action="${intentLabel}"`);
    if (!domain || !intent) {
        relayLog('LOG', 'App', 'dispatchArbiterIntent: SIN domain/intent → no se despacha');
        return '';
    }
    let reply = '';
    try {
        if (domain === 'reminder' && typeof w.__fluHandleReminderText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleReminderText (reminder)');
            reply =
                (await w.__fluHandleReminderText(intent, {
                    personId: undefined,
                    personName: opts.speakerName || undefined,
                })) || '';
        } else if (domain === 'temporal' && typeof w.__fluHandleTemporalText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleTemporalText (temporal)');
            reply = (await w.__fluHandleTemporalText(intent)) || '';
        } else if (domain === 'diary' && FLU_CONFIG.diary?.enabled && typeof w.__fluHandleDiaryText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleDiaryText (diary)');
            reply =
                (await w.__fluHandleDiaryText(intent, {
                    personId: undefined,
                    personName: opts.speakerName || undefined,
                })) || '';
        } else if (domain === 'note' && typeof w.__fluHandleNoteText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleNoteText (note)');
            reply =
                (await w.__fluHandleNoteText(intent, {
                    personId: undefined,
                    personName: opts.speakerName || undefined,
                })) || '';
        } else if (domain === 'horario' && typeof w.__fluHandleHorarioText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleHorarioText (horario)');
            reply = (await w.__fluHandleHorarioText(intent)) || '';
        } else {
            relayLog('LOG', 'App', `dispatchArbiterIntent: dominio "${domain}" sin manejador window registrado (o deshabilitado)`);
        }
    } catch (err) {
        console.warn('[App] dispatchArbiterIntent threw (non-critical):', err);
        relayLog('WARN', 'App', `dispatchArbiterIntent threw: ${err}`);
    }
    relayLog('LOG', 'App', `dispatchArbiterIntent → reply="${String(reply).slice(0, 120)}"`);
    return reply;
}

function App() {
    const [_currentState, setCurrentState] = useState<ConversationState>('IDLE');
    // Foco del Pizarrón por turno (señal monotónica): garantiza que el feed
    // salte al tipo del resultado del turno, incluso si el tipo se repite, y
    // que una respuesta de texto regrese a "Todo".
    const turnFocusSeqRef = useRef(0);
    const [turnFocus, setTurnFocus] = useState<{
        kind: 'video' | 'doc' | 'image' | 'text';
        seq: number;
    } | null>(null);
    const integrationStore = useIntegrationStore();
    // Ambiente activo (rebranding por oficio): pestañas visibles derivadas del catálogo
    const activeAmbienteId = useEnvironmentStore((s) => s.activeAmbienteId);
    const visibleTabIds = useMemo(() => getVisibleTabIds(activeAmbienteId), [activeAmbienteId]);

    const auditLog = useAuditLog();
    // Usuario activo (se declara temprano: lo consumen varios hooks con aislamiento).
    const [activeParticipantId, setActiveParticipantId] = useState<string | undefined>(() => resolveActiveUser());
    const minuteKnowledge = useMinuteKnowledge(activeParticipantId);
    const voiceProfiles = useVoiceProfiles();
    // Historial de documentos/imágenes generados o cargados (por usuario).
    const documentHistory = useDocuments({ participantId: activeParticipantId });

    // ---- Autonomy Systems Integration ----
    const [autonomyState, autonomyActions] = useAutonomyIntegration();

    // PERMANENT CONFIGURATION: Autonomy systems should NOT monitor or interfere with speech components
    // Speech synthesis and recognition are managed by the voice system and don't need autonomous recovery
    useEffect(() => {
        // Start all autonomy systems
        autonomyActions.startAllSystems();
        
        // Configure HealthMonitor to EXCLUDE speech components from monitoring
        // Speech components are managed by the voice system and don't need autonomous health checks
        autonomyActions.updateSystemConfig('healthMonitor', {
            monitoredComponents: [
                'ai-service',
                'indexed-db',
                'network',
                'memory',
                'react-components'
                // NOTE: 'speech-recognition' and 'speech-synthesis' are EXCLUDED intentionally
                // These components are managed by the voice system (useFluVoiceAssistant)
            ],
            autoRecoveryEnabled: false // Health monitor should not trigger auto-recovery
        });
        
        // Configure AutoRecoverySystem to be disabled for speech components
        // The voice system has its own error handling and recovery mechanisms
        autonomyActions.updateSystemConfig('autoRecovery', {
            enabled: true, // Keep enabled for other components
            // Recovery rules will still work for AI service, network, etc.
            // but speech components won't be monitored, so they won't trigger recovery
        });
        
        return () => {
            autonomyActions.stopAllSystems();
        };
    }, [autonomyActions]);

    // Ensure avatar pants are visible and have proper color on startup
    // Determinista y sin timers: el store de Zustand es síncrono (sin persist),
    // por lo que getState() está disponible inmediatamente al montar.
    useEffect(() => {
        ensureAvatarPantsVisible();
    }, []);

    // ---- OS2 parity: refs (FluShell.jsx lines 154-161) ----
    const savedSession = useRef(loadSessionState());
    const conversationActiveRef = useRef(false);
    const resumeListeningTimerRef = useRef<number | null>(null);
    const _lastRawLogRef = useRef<string>('');
    // Indica si FLU ya produjo una respuesta sustantiva en ESTA carga de página.
    // Se usa para que latestResponse NO resucite una respuesta vieja del historial
    // persistido (IndexedDB) al recargar, antes de que FLU responda de nuevo.
    const hasLiveResponseRef = useRef(false);

    // Ref for speakFlu to fix closure issue: useCallback with [] deps captures
    // speakFlu from the FIRST render's closure. Keeping a ref ensures the callback
    // always reads the latest speakFlu even across re-renders.
    const speakFluRef = useRef<(text: string, lang: string) => Promise<void>>(async () => {});
    // Guarda "ya se anunció el saludo de cierre" para no repetirlo con cada
    // re-render/re-efecto del mismo participante (una vez por activación).
    const onboardingAckSpokenForRef = useRef<string | null>(null);

    // Cache for rawOnly speaker lookup: Map<speakerName, { index, entry }>
    // Avoids O(n) backward scan of conversation history on every raw transcript.
    const speakerIndexRef = useRef<Map<string, { index: number; entry: ConversationEntry }>>(new Map());

    // §9 — Identidad de la emisión cruda en curso: id de la última fila cruda
    // commiteada. Permite que `replaceLastRawLog` (decisión del motor) actualice
    // ESA fila aunque el hablante recién se resuelva y difiera del provisional.
    const lastRawEntryIdRef = useRef<string | null>(null);

    // ---- Medios (video/documento): ruta ÚNICA e idempotente ----
    // El ASR puede re-capturar el mismo comando; sin gate, cada captura
    // dispararía una generación PAGA nueva. `mediaGateRef` es la fuente única
    // del criterio y `requestMediaRef` la única puerta de generación.
    const mediaGateRef = useRef(
        createMediaRequestGate(Number(FLU_CONFIG?.media?.dedupWindowMs) || 120000),
    );
    const requestMediaRef = useRef<
        (tipo: 'video' | 'doc', commandText: string, prepare?: () => void) => boolean
    >(() => false);

    // Idempotencia por turno de la RESPUESTA: si el mismo turno (texto+respuesta)
    // se vuelve a entregar por una re-captura/eco, NO se repite el habla/fila.
    const lastResponseRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });

    // ---- Pestaña activa del panel derecho ----
    // Always start on Pizarron (workspace) tab as default
    const location = useLocation();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<RightTab>(() => tabFromPath(location.pathname));

    // Sincroniza la tab activa con la URL (React Router Fase 3).
    useEffect(() => {
        setActiveTab(tabFromPath(location.pathname));
    }, [location.pathname]);

    // Navegación de tab: actualiza la URL; el efecto superior sincroniza el estado.
    const changeTab = useCallback(
        (tab: RightTab) => {
            if (tab !== tabFromPath(location.pathname)) {
                navigate(pathForTab(tab));
            } else {
                setActiveTab(tab);
            }
        },
        [navigate, location.pathname]
    );

    // Mantener la pestaña activa dentro de las visibles del ambiente activo
    useEffect(() => {
        if (visibleTabIds.length > 0 && !visibleTabIds.includes(activeTab)) {
            changeTab(visibleTabIds[0]);
        }
    }, [visibleTabIds, activeTab, changeTab]);

    // ---- Estado para imagen subida (digitalización OCR) ----
    const [uploadedImage, setUploadedImage] = useState<{ dataUrl: string; mimeType: string; fileName: string } | null>(null);
    const [homeworkContext, setHomeworkContext] = useState<{ materia: string; problemas: string[]; instrucciones: string; nivel: string; texto_extraido: string } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ---- Estado para maximizar/restaurar paneles (PanelFrame expandable) ----
    const [expandedFrameId, setExpandedFrameId] = useState<string>(savedSession.current.expandedFrameId);

    const handleToggleExpand = useCallback((frameId: string) => {
        setExpandedFrameId((prev) => (prev === frameId ? '' : frameId));
    }, []);

    // ---- Estado para la minuta actual en edición ----
    const [minuteDraft, setMinuteDraft] = useState<MinuteDraft | null>(null);

    // ---- Estado para la minuta seleccionada en el historial ----
    const [selectedMinuteId, setSelectedMinuteId] = useState<string | null>(savedSession.current.selectedMinuteId);

    // ---- Sub-sección activa del panel de Ajustes (Fase A2: FLU / Mis datos / Gestión) ----
    const [settingsGroup, setSettingsGroup] = useState<SettingsGroupId>('flu');

    // ---- Ref para MinuteDraftPanel (accede a .save()) ----
    const minutePanelRef = useRef<{ save: () => void }>(null);

    // Suscribirse a la expresión/animación actual del avatar (para mostrar en header)
    const avatarCurrentExpression = useBunnyStore((s) => s.currentExpression ?? null);
    const avatarCurrentAnimation = useBunnyStore((s) => s.currentAnimation ?? null);
    const avatarBlendQueue = useBunnyStore((s) => s.blendQueue ?? []);

    // ---- Acciones del avatar (colores por voz — usadas en onContractResolved) ----
    const setComponentColor = useBunnyStore((s) => s.setComponentColor);
    const resetComponentColors = useBunnyStore((s) => s.resetComponentColors);

    // ---- Config Persistence (extraído a hook dedicado) ----
    const {
        apiKey,
        textModel,
        textApiUrl,
        geminiApiKey,
        imageApiKey,
        imageModel,
        imageApiUrl,
        falApiKey,
        falVideoModel,
        ocrApiKey,
        ocrModel,
        ocrApiUrl,
        language,
        sessionRole,
        voices,
        languageRef,
        sessionRoleRef,
        handleTextApiKeyCommit,
        handleTextModelCommit,
        handleTextApiUrlCommit,
        handleGeminiApiKeyCommit,
        handleImageApiKeyCommit,
        handleImageModelCommit,
        handleImageApiUrlCommit,
        handleFalApiKeyCommit,
        handleFalVideoModelCommit,
        handleOcrApiKeyCommit,
        handleOcrModelCommit,
        handleOcrApiUrlCommit,
        handleClearCache,
        setLanguage,
        setSessionRole,
        wakeWords,
        setWakeWords,
        debugLogsEnabled,
        setDebugLogsEnabled,
        wakeWordsRef,
    } = useConfigPersistence();

    // ---- Fase 2 — Memoria y recordatorios: hooks tempranos ----
    // useReminders debe declararse ANTES de useFluVoiceAssistant porque
    // getDailyAgenda (más abajo) lo referencia. speakFlu y el servicio de
    // notificaciones se resuelven después (línea 1726 y 1740), así que se
    // inyectan vía refs:
    //   - speakFluRef (declarado arriba, sincronizado en la línea 1733)
    //   - notificationServiceRef (actualizado tras useNotificationCenter)
    const notificationServiceRef = useRef<NotificationService | null>(null);
    const reminders = useReminders({
        speak: (text, lang) => speakFluRef.current(text, lang),
        notify: (input) => notificationServiceRef.current?.notify(input),
        language,
        participantId: activeParticipantId,
    });
    // ---- Motor temporal genérico: alarmas y temporizadores (despertador + temporizador) ----
    const temporals = useTemporalItems({
        speak: (text, lang) => speakFluRef.current(text, lang),
        notify: (input) => notificationServiceRef.current?.notify(input),
        language,
        participantId: activeParticipantId,
    });
    const shopping = useShoppingList({});

    // ---- Horario de clases: hook temprano (Pizarrón + consulta por voz) ----
    const horario = useHorario({ participantId: activeParticipantId });
    const [horarioModo, setHorarioModo] = useState<HorarioModo>('semana');
    // Entradas de horario pendientes de confirmar (parseadas desde una imagen
    // digitalizada). Nada se escribe en fluDb.horario sin el visto bueno del
    // usuario (Regla #1: sin hardcode; el parseo es genérico vía structureHorarioText).
    const [pendingHorarioImport, setPendingHorarioImport] = useState<HorarioClaseEstructurada[] | null>(null);
    const [horarioImportBusy, setHorarioImportBusy] = useState(false);

    // Confirma el parseo: persiste cada entrada estructurada en fluDb.horario.
    // Genérico: mapea {materia, tipo, dia, inicio, fin, aula} → NewHorarioInput.
    const confirmHorarioImport = useCallback(async () => {
        const entries = pendingHorarioImport;
        if (!entries || entries.length === 0) return;
        setHorarioImportBusy(true);
        try {
            for (const entry of entries) {
                await horario.add({
                    materia: entry.materia,
                    tipo: entry.tipo,
                    dia: entry.dia,
                    inicio: entry.inicio,
                    fin: entry.fin,
                    aula: entry.aula,
                });
            }
            const voice = FLU_CONFIG.horario?.voice || {};
            const okMsg = String(
                voice.structureOk ||
                (language === 'en' ? 'I registered the schedule entries.' : 'Registré las entradas del horario.')
            );
            speakFluRef.current?.(okMsg, language);
        } finally {
            setPendingHorarioImport(null);
            setHorarioImportBusy(false);
        }
    }, [pendingHorarioImport, horario, language]);

    // Descarta el parseo sin escribir nada.
    const cancelHorarioImport = useCallback(() => {
        setPendingHorarioImport(null);
        setHorarioImportBusy(false);
    }, []);

    // ---- Fase 3 — Multi-usuario: participantes del hogar y materia gris ----
    const participants = useParticipants({});
    // Onboarding multiusuario: usuario activo (undefined/'default' → ruta legacy)
    // y selector "¿Quién eres?" para elegir/crear el perfil que personaliza FLU.
    // (La declaración de activeParticipantId vive arriba, antes de useReminders.)
    // Aislamiento por usuario: la conversación persistida se filtra por el
    // participante activo (cada usuario ve sólo la suya).
    useConversationPersistence(activeParticipantId);
    // Guard de montaje: el onboarding se reinicia (para pedirlo SIEMPRE al
    // entrar) solo después de que los participantes carguen y el estado del
    // onboarding esté resuelto (ready). Evita resetear antes de tiempo.
    const onboardingMountSettledRef = useRef(false);
    // Registro/activación del participante al completar el onboarding: se
    // dispara desde el MISMO flujo que completa (onCompleted del hook), sin
    // depender de un efecto que la lista refrescada pueda cancelar (Bug #1).
    const handleOnboardingCompletedRef = useRef<(state: OnboardingState) => void>(() => undefined);
    const materiaGris = useMateriaGris({});
    // ---- FASE P — Personalización profunda por persona (nivel de explicación + tono) ----
    const communicationProfiles = useCommunicationProfiles({});
    // ---- Punto 2 — Navegador curado: perfil de navegador por participante ----
    const browserProfiles = useBrowserProfiles({});
    // ---- Punto 2 — Catálogo de sitios: catálogo fusionado del buscador ----
    const searchSites = useSearchSites();
    // ---- Fase 4 — Módulo G: hábitos y metas por participante ----
    const _habits = useHabits({});
    // ---- Fase 5 — Módulo H: bienestar y ánimo por participante ----
    const _mood = useMood({});
    // ---- Fase 6 — Módulos I y J: contactos y diario personal ----
    const contacts = useContacts({});
    const diary = useDiary({});
    const notes = useNotes({ participantId: activeParticipantId });
    // ---- Fase 7 — Acciones de dispositivo: servicio sobre la agenda de contactos ----
    const deviceActions = useDeviceActions({
        service: contacts.service,
        contacts: contacts.contacts,
    });

    // B9: cumpleaños próximos dentro de la ventana configurada (FLU_CONFIG.multiuser).
    // Se recalcula cuando cambia el registro de participantes.
    const [birthdayNear, setBirthdayNear] = useState<ParticipantRecord[]>([]);
    useEffect(() => {
        let active = true;
        participants
            .participantsWithBirthdayNear()
            .then((rows) => {
                if (active) setBirthdayNear(rows);
            })
            .catch((err) => console.error('[App] birthdayNear error:', err));
        return () => {
            active = false;
        };
    }, [participants.participants, participants.participantsWithBirthdayNear]);

    // B11: pendientes filtrados por autor (listPendingByAuthor) desde el filtro del panel.
    // Se recalcula al escribir el autor y cuando cambia la lista de recordatorios.
    const [remindersAuthor, setRemindersAuthor] = useState('');
    const [pendingByAuthor, setPendingByAuthor] = useState<ReminderRecord[]>([]);
    useEffect(() => {
        let active = true;
        const author = remindersAuthor.trim();
        if (!author) {
            setPendingByAuthor([]);
            return undefined;
        }
        reminders.service
            .listPendingByAuthor(author)
            .then((rows) => {
                if (active) setPendingByAuthor(rows);
            })
            .catch((err) => console.error('[App] pendingByAuthor error:', err));
        return () => {
            active = false;
        };
    }, [remindersAuthor, reminders.service, reminders.reminders]);

    // ---- AI Provider Selection ----
    const [aiProvider, setAiProviderState] = useState<string>(() => getPreferredAIProvider());
    const handleSetAiProvider = useCallback((provider: string) => {
        if (!isAIProvider(provider)) return;
        setPreferredAIProvider(provider);
        setAiProviderState(provider);
    }, []);

    // ---- Flu participant state (OS2 parity: useFluParticipant hook) ----
    // Memoized snapshot: use a ref to avoid re-creating the callback on every render.
    // Only recompute when history length or last entry changes.
    const getLogSnapshot = useCallback(() => {
        const history = integrationStore.conversationHistory;
        return {
            texts: history.map((e) => e.text || ''),
            speakers: history.map((e) => e.speakerName || ''),
        };
    }, [integrationStore.conversationHistory]);

    // Última frase completa del usuario (para el área del personaje / barra):
    // fuente única desde el historial real, usada como fallback de transcripción
    // cuando liveTranscript se limpió tras ejecutar el comando. La derivación vive
    // en la lib (deriveUserLastText), no inline en el componente.
    const avatarLastUserText = useMemo(() => {
        return deriveUserLastText(integrationStore.conversationHistory);
    }, [integrationStore.conversationHistory]);

    // Cache for isDuplicateSystemEvent: store recent dedup keys in a Set to avoid
    // O(n) scan of the entire conversation history on every ignored event.
    // The cache is bounded by time (entries older than systemEventDedupBucketMs are pruned).
    const dedupCacheRef = useRef<Set<string>>(new Set());
    const dedupCacheLastPruneRef = useRef(0);

    // Ref para recibir triggerParticipantEmotion desde FluAvatarVoiceBridge
    const participantEmotionRef = useRef<((event: 'granted' | 'ignored' | 'rejected' | 'raised' | 'dismissed') => void) | null>(null);
    // Ref para recibir applyContextualEmotion desde FluAvatarVoiceBridge
    const contextualEmotionRef = useRef<((sentiment: 'positive' | 'negative' | 'neutral' | 'question' | undefined) => void) | null>(null);
    // Ref para enviar animaciones de emoción resueltas vía callback directo (Fase 7)
    // Reemplaza integrationStore.uiState.pendingEmotionAnims
    const emotionAnimsRef = useRef<((anims: string[]) => void) | null>(null);
    // Ref for setRecentMemory to avoid stale closure in onEmotion callback.
    // useFluParticipant is called BEFORE useFluVoiceAssistant, so setRecentMemory
    // is undefined during first render. Even on subsequent renders, scheduleHandTimeout's
    // setTimeout captures onEmotion at creation time. Using a ref ensures the callback
    // always reads the latest setRecentMemory regardless of when it was captured.
    const setRecentMemoryRef = useRef<((text: string) => void) | undefined>(undefined);
    const fluParticipant = useFluParticipant({
        apiKey,
        language,
        conversationActiveRef,
        session: { role: sessionRole, theme: '' },
        getLogSnapshot,
        // Conecta la config real (FLU_CONFIG.fluParticipant + overrides de localStorage)
        // al hook activo. Antes se usaba DEFAULT_PARTICIPANT_CONFIG hardcodeado y los
        // ajustes del panel de participación (3 min de mano alzada, 0.65 confianza, etc.)
        // nunca llegaban al hook en ejecución. El hook sincroniza cfgRef vía useEffect.
        config: getFluParticipantConfig(),
        onEmotion: (event) => {
            participantEmotionRef.current?.(event);
            if (event === 'ignored') {
                const now = Date.now();
                const systemEvent: SystemEvent = {
                    type: 'participant_ignored',
                    timestamp: now,
                    participantName: 'Hablante',
                    waitedMs: 8000,
                };
                // Fast dedup check using cached Set (O(1) instead of O(n))
                const dedupKey = `participant_ignored:Hablante:${Math.floor(now / 3000)}`;
                if (!dedupCacheRef.current.has(dedupKey)) {
                    dedupCacheRef.current.add(dedupKey);
                    // Prune old entries every 30 seconds to prevent memory leak
                    if (now - dedupCacheLastPruneRef.current > 30000) {
                        dedupCacheRef.current = new Set([dedupKey]);
                        dedupCacheLastPruneRef.current = now;
                    }
                    const entry = buildSystemConversationEntry(systemEvent, language === 'en' ? 'en' : 'es');
                    // Store único (§9): el evento entra al historial (única fuente de
                    // verdad) y Gemini lo ve por derivación; no hay canal lateral.
                    integrationStore.addConversationEntry(entry);
                    // FIX "¿por qué estás enojado?": además de la línea de contexto,
                    // forzar el bloque CRÍTICO del system prompt (gemini.js:458-463) en el
                    // SIGUIENTE contract request vía setRecentMemory, para que FLU EXPRESE
                    // la emoción "antes que cualquier otra cosa" y no la parafrasee genérica.
                    // setRecentMemory es ONE-SHOT: useFluVoiceAssistant.js:988-989 lee y
                    // limpia recentMemoryRef antes de cada contract, así que NO persiste en
                    // requests posteriores (el comentario anterior estaba obsoleto).
                    setRecentMemoryRef.current?.(
                        `El participante "Hablante" levantó la mano para participar y fue ignorado (no se le dio la palabra). Estás enojado por eso: debes decirlo explícitamente y explicar por qué te enojaste, ANTES de continuar con cualquier otro tema.`
                    );
                }
            }
        },
    });
    // OS2 parity: expose the local participant instance via ref so OS2's useFluVoiceAssistant
    // can use the same instance for voice commands (FLU_ADELANTE).
    // This fixes the bug where "ok flu adelante" by voice responded "No tengo nada pendiente"
    // because OS2 had its own separate instance without the draft.
    const fluParticipantRef = useRef(fluParticipant);
    fluParticipantRef.current = fluParticipant;
    const fluParticipantPresentation = fluParticipant.presentation;
    const [participantConfig, setParticipantConfig] = useState(() => getFluParticipantConfig());
    const [searchOverrides, setSearchOverrides] = useState<SearchConfigOverrides>(() => loadSearchConfigOverrides());
    // Ref sincronizada: permite que varios commits de la barra GLOBAL de
    // Configuración (buscador + búsqueda web) compongan en el mismo tick sin
    // pisarse con estado obsoleto.
    const searchOverridesRef = useRef<SearchConfigOverrides>(searchOverrides);
    searchOverridesRef.current = searchOverrides;


    // ============================================================
    // OS2: useFluVoiceAssistant — Instanciado AQUÍ en App.tsx
    // ============================================================
    // OS2 hook que maneja:
    //   - Web Speech API (startListening, stopListening, toggleListening)
    //   - getUserMedia + audio fingerprinting (diarización por audio)
    //   - VAD + speaker clusters
    //   - processCapture con pendingSpillRef
    //   - scheduleAutoProcess + scheduleResumeListening
    //   - onContractResolved callback
    //
    // Los valores se pasan como props a:
    //   - FluAvatarVoiceBridge (voiceStatus, voiceError, liveTranscript, etc.)
    //   - VoiceAssistantBar (listeningAck, isSupported, fluParticipantPresentation, etc.)
    //
    // Esto elimina los hardcodes anteriores en VoiceAssistantBar y
    // asegura que OS3 use EXACTAMENTE la misma funcionalidad de OS2.
    // ============================================================
    // Fase E: nombre del participante activo (Juan/Luis) para sembrar
    // sessionPrimary en la diarización. Solo perfiles reales con nombre
    // propio (excluye legacy/default y la semilla anónima, config-driven).
    const activeParticipantNameForVoice = useMemo(() => {
        if (!activeParticipantId || activeParticipantId === DEFAULT_ONBOARDING_USER) return undefined;
        const profile = participants.participants.find((p) => p.id === activeParticipantId);
        if (!profile?.name) return undefined;
        const skipDefaults = (FLU_CONFIG.multiuser?.skipDefaults) || {};
        const anonymousName = String(skipDefaults.anonymousName || 'Anónimo').trim().toLowerCase();
        if (profile.name.trim().toLowerCase() === anonymousName) return undefined;
        return profile.name;
    }, [activeParticipantId, participants.participants]);
    const {
        status: voiceStatus,
        error: voiceError,
        liveTranscript,
        lastTranscript,
        isSupported,
        listeningAck,
        activeKnowledgeBase,
        // NOTE: fluParticipantPresentation is now sourced from local useFluParticipant hook
        // fluParticipantPresentation is no longer destructured from useFluVoiceAssistant
        startListening: os2StartListening,
        stopListening: os2StopListening,
        showListeningAck,
        removeSessionSpeaker: os2RemoveSessionSpeaker,
        renameSessionSpeaker: os2RenameSessionSpeaker,
        // OS2 parity: additional actions from useFluVoiceAssistant (FluShell.jsx lines 3444-3457)
        resetConversationSession: os2ResetConversationSession,
        resetVoiceDisplay: os2ResetVoiceDisplay,
        suspendRecognitionForAssistantSpeech: os2SuspendRecognition,
        /** Set recent memory text that gets injected into the system prompt on next contract request. */
        setRecentMemory,
    } = useFluVoiceAssistant({
        apiKey,
        language,
        // Wake words configurables (Ajustes) — fuente única de resolución de comandos.
        wakeWords,
        // OS2 parity: pass conversationActiveRef for resume logic (FluShell.jsx line 154)
        conversationActiveRef,
        // OS2 parity: pasar knowledgeBase para resolución de minutas
        knowledgeBase: '',
        getMinuteKnowledgeBase: () => {
            // OS2 parity: useMinuteKnowledge ↔ minuteKnowledgeRef.getKnowledgeBaseForMode('minutes')
            // Devolvemos el texto formateado de TODAS las minutas persistidas en IndexedDB
            // para inyectarlo en el prompt de Gemini como knowledgeBase2.
            // Si no hay minutas, devolvemos '' (Gemini dirá "KB minutas vacía" como en OS2).
            return buildMinuteKnowledgeBase2(minuteKnowledge.minutes, { diary: diary.entries || [] });
        },
        getDailyAgenda: () => {
            // Compila pendientes de todas las minutas en una "orden del día"
            // y la formatea para inyectar en el prompt de Gemini.
            // Si no hay pendientes, devuelve '' (Gemini ignora el campo).
            const agendaConfig = FLU_CONFIG.agenda || {};
            if (!agendaConfig.enabled) return '';
            let items = buildDailyAgenda(minuteKnowledge.minutes, {
                maxItems: agendaConfig.maxItems,
                minImportance: agendaConfig.minImportance,
            });
            // Fase 2 — B5: fusiona los recordatorios pendientes como un item
            // sintético al final de la agenda, aunque no haya minutas.
            items = mergeRemindersIntoAgenda(
                items,
                reminders.reminders,
                { maxReminders: agendaConfig.maxReminders },
                languageRef.current as 'es' | 'en',
            );
            if (items.length === 0) return '';
            return formatAgendaForPrompt(items, languageRef.current as 'es' | 'en');
        },
        // Autoconocimiento (§1.4): manifiesto 1ª persona de FLU compilado desde
        // la config real. useFluVoiceAssistant solo lo pide cuando el turno es
        // una petición de autoconocimiento (isSelfKnowledgeRequest).
        getSelfManifesto: () => buildSelfManifesto(languageRef.current as 'es' | 'en'),
        // Radar de contexto (Pizarrón un solo objeto — Paso 5): bloques 6-9.
        // Cada getter compila texto dinámico desde su fuente (Dexie) y devuelve
        // '' si no hay datos (Rule #1). useFluVoiceAssistant los lee vía refs en
        // el callback de contrato y los inyecta en el user prompt de Gemini.
        getDiaryContext: () => {
            // Bloque 7 — DIARIO (+ánimo): última entrada (una sola).
            const entries = diary.entries || [];
            if (entries.length === 0) return '';
            const last = entries[0];
            const moodTxt = last.mood ? ` (ánimo ${last.mood})` : '';
            const titleTxt = last.title ? ` ${last.title}` : '';
            return `[${last.date}]${titleTxt}${moodTxt}: ${last.content}`;
        },
        getNotesContext: () => {
            // Bloque 8 — NOTAS: pendientes (top-N, sin hardcode de N).
            const pending = (notes.notes || []).filter((n) => !n.done);
            if (pending.length === 0) return '';
            return pending.map((n) => `- ${n.label}`).join('\n');
        },
        getHorarioContext: () => {
            // Bloque 9 — Horario del día (HOY): clases de hoy ordenadas por hora.
            const items = horario.horario || [];
            if (items.length === 0) return '';
            const hoy = diaDeFecha(Date.now());
            const clasesHoy = clasesDelDia(items, hoy);
            if (clasesHoy.length === 0) return '';
            return clasesHoy
                .map((c) => `${c.inicio}–${c.fin} ${c.materia}${c.aula ? ` (${c.aula})` : ''}`)
                .join('\n');
        },
        getResultadosContext: () => {
            // Bloque 6 — Resultados: última consulta/respuesta + feed reciente.
            const parts: string[] = [];
            const lastResp = (integrationStore.lastResponse || '').trim();
            if (lastResp) parts.push(`Última respuesta: ${lastResp}`);
            const artifact = integrationStore.workspaceArtifact;
            if (artifact?.contenido) parts.push(`Contenido activo: ${artifact.contenido}`);
            if (parts.length === 0) return '';
            return parts.join('\n');
        },
        resolveMinuteLookup: (query?: string, lang?: string) => {
            // OS2 parity: useMinuteKnowledge ↔ minuteKnowledgeRef.resolveMinuteQuery
            // Intenta resolver localmente (parseMinuteSequenceFromQuery +
            // findMinuteRecordBySequence + buildMinuteLookupContract).
            // Si no hay número de secuencia, retorna { mode: 'gemini' } para fallback.
            return resolveMinuteQuery(String(query ?? ''), minuteKnowledge.minutes, { language: lang || languageRef.current });
        },
        // Test hook e2e: exponer el callback REAL onContractResolved en window
        // (window.__fluOnContractResolved) para que las pruebas de verificación
        // puedan disparar un contrato play_music de forma determinista. Se asigna
        // en CREACIÓN (expresión de asignación), disponible desde el montaje.
        onContractResolved: (window.__fluOnContractResolved = useCallback(async (resolved: ContractResolution) => {
            // §9 — Fila del USUARIO inmediata: el motor la pide al terminar de
            // capturar (antes de la IA). Aquí SOLO se agrega la fila y se sale;
            // la resolución posterior deduplica y agrega la respuesta de FLU.
            if (resolved?.userCommitOnly) {
                const early = cleanForSpeech(String(resolved?.transcript || ''));
                if (early) {
                    const hist0 = useIntegrationStore.getState().conversationHistory;
                    const last0 = hist0[hist0.length - 1];
                    const already0 =
                        last0?.role === 'user' &&
                        cleanForSpeech(last0.text || '').toLowerCase() === early.toLowerCase();
                    if (!already0) {
                        useIntegrationStore.getState().addConversationEntry({
                            id: uuidv4(),
                            role: 'user',
                            text: early,
                            speakerName: String(resolved?.speakerName || '') || undefined,
                            timestamp: Date.now(),
                            sentiment: 'neutral',
                        });
                    }
                }
                return;
            }
            const contract: Partial<ResolvedContract> = resolved?.contract || {};
            const transcript: string = resolved?.transcript || '';
            const rawOnly: boolean = resolved?.rawOnly === true;
            const speakerName: string = resolved?.speakerName || '';
            const phase: string = resolved?.phase || '';

            // §9: la frase canónica del usuario debe verse SIEMPRE, también en
            // turnos de COMANDO (navegación/medios) que NO pasan por la ruta
            // rawOnly. Commit único por texto (dedup contra la última fila user).
            if (!rawOnly && transcript) {
                const norm = cleanForSpeech(transcript).toLowerCase();
                const hist = useIntegrationStore.getState().conversationHistory;
                const last = hist[hist.length - 1];
                const alreadyLogged =
                    last?.role === 'user' &&
                    cleanForSpeech(last.text || '').toLowerCase() === norm;
                if (!alreadyLogged) {
                    useIntegrationStore.getState().addConversationEntry({
                        id: uuidv4(),
                        role: 'user',
                        text: transcript,
                        speakerName: speakerName || undefined,
                        timestamp: Date.now(),
                        sentiment: 'neutral',
                    });
                }
            }

            // ============================================================
            // OS2 parity: raw transcript logging with dedup
            // (FluShell.jsx lines 332-448: rawOnly path)
            // Usamos cleanForSpeech inline (OS2 audioMath.js) para evitar
            // dependencia de tipos en el barrel JS de flu-voz.
            // ============================================================
            if (rawOnly && transcript) {
                const normalizedTranscript = cleanForSpeech(transcript);
                if (!normalizedTranscript) return;

                // Decisión ÚNICA de commit (§9): el motor ya calculó si esta emisión
                // reemplaza la última fila (misma emisión creciendo) o si es una fila
                // nueva, y lo envía en el payload como `replaceLastRawLog`. App OBEDECE
                // esa señal; NO re-decide con heurística propia.
                const liveStore = useIntegrationStore.getState();
                const history = liveStore.conversationHistory;
                const targetSpeaker = String(speakerName || '').trim().toLowerCase();
                const speakerKey = targetSpeaker || '__default__';
                const replaceLastRawLog = resolved?.replaceLastRawLog === true;

                // §9 — La decisión de reemplazo la toma el MOTOR (`replaceLastRawLog`).
                // `planRawCommit` resuelve la fila objetivo por el id de la emisión
                // cruda en curso, NO por la etiqueta de hablante: entre commits la voz
                // puede resolverse (provisional "Hablante 1" → nombre real) y la
                // búsqueda por nombre fallaba, duplicando la fila.
                const plan = planRawCommit(history, {
                    replaceLastRawLog,
                    lastRawEntryId: lastRawEntryIdRef.current,
                    speakerName,
                });

                if (plan.action === 'replace') {
                    const prev = history[plan.index];
                    const updated = [...history];
                    updated[plan.index] = {
                        ...prev,
                        text: transcript,
                        speakerName: plan.speakerName,
                        timestamp: Date.now(),
                    };
                    useIntegrationStore.getState().batchLoadHistory(updated);
                    speakerIndexRef.current.set(speakerKey, { index: plan.index, entry: updated[plan.index] });
                    return;
                }

                let lastEntryForSpeaker: ConversationEntry | null = null;
                let lastEntryIndex = -1;
                const cached = speakerIndexRef.current.get(speakerKey);
                if (cached && cached.index >= 0 && cached.index < history.length && history[cached.index] === cached.entry) {
                    lastEntryForSpeaker = cached.entry;
                    lastEntryIndex = cached.index;
                } else {
                    // Cache miss or stale — fall back to backward scan and update cache
                    for (let i = history.length - 1; i >= 0; i--) {
                        const entry = history[i];
                        const entrySpeaker = String(entry.speakerName || '').trim().toLowerCase();
                        const matches = targetSpeaker ? entrySpeaker === targetSpeaker : !entrySpeaker;
                        if (matches) {
                            lastEntryForSpeaker = entry;
                            lastEntryIndex = i;
                            break;
                        }
                    }
                    if (lastEntryForSpeaker) {
                        speakerIndexRef.current.set(speakerKey, { index: lastEntryIndex, entry: lastEntryForSpeaker });
                    }
                }

                if (!replaceLastRawLog && lastEntryForSpeaker) {
                    // Duplicado exacto de la fila del hablante: descartar (re-entrada idéntica).
                    if (cleanForSpeech(lastEntryForSpeaker.text || '') === normalizedTranscript) {
                        return;
                    }
                }

                // Agregar entrada raw al historial (OS2: optimisticRow)
                // Obligación #6: UUIDv4
                const rawEntryId = uuidv4();
                useIntegrationStore.getState().addConversationEntry({
                    id: rawEntryId,
                    role: 'user',
                    text: transcript,
                    speakerName: speakerName || undefined,
                    timestamp: Date.now(),
                    sentiment: 'neutral',
                });
                // La emisión cruda en curso pasa a ser esta fila (identidad para el reemplazo).
                lastRawEntryIdRef.current = rawEntryId;

                // Update cache: new entry appended at the end
                const newHistory = useIntegrationStore.getState().conversationHistory;
                speakerIndexRef.current.set(speakerKey, { index: newHistory.length - 1, entry: newHistory[newHistory.length - 1] });

                // OS2 parity: audit log for rawOnly entries (Gap 4)
                // FluShell.jsx lines 430-438: addAuditLog after rawOnly entry
                // Obligación #6: UUIDv4
                auditLog.logEvent('transcript:raw', 'conversation', uuidv4(), {
                    speaker: speakerName || undefined,
                    transcript,
                    phase,
                }, 'Raw transcript logged').catch(console.error);

                // NOTE: Do NOT call fluParticipant.onTurnCommitted() here.
                // conversationStreamCommit.js already calls
                // fluParticipantRef.current?.onTurnCommitted?.() after
                // finalizeTurnCommit() (lines 379 and 427). Calling it here
                // would double-increment turnsSinceLastEval, causing the
                // participant evaluation to trigger on turn 2 instead of turn 3
                // (evaluateEveryNTurns=3), and then immediately reset the counter.
                // This is the root cause of FLU never reaching 'raised' phase.

                return;
            }

            let respuestaVoz = contract?.respuesta_voz || '';
            const navegacion: FluContract['navegacion'] = contract?.navegacion || { comando: null, destino: null, parametros: {} };
            const workspace = contract?.workspace || null;
            const musica = contract?.musica || null;

            // ============================================================
            // EJECUCIÓN DE INTENCIONES — Recordatorios, compras, alarmas,
            // temporizadores, notas, diario y horario por voz.
            // ============================================================
            // RUTA CONVERSACIONAL (LLM como cerebro único, estilo Siri/Alexa/
            // Google): el LLM decide la intención de forma conversacional y la
            // emite en su contrato como `acciones: [{dominio, texto}]`. Cada
            // `texto` es el fragmento del mandato del usuario; aquí se re-resuelve
            // con el árbitro determinista (para obtener la intención estructurada
            // precisa: dueAt, durationMs, etc.) y se despacha al MISMO manejador
            // __fluHandle* que usa el flujo offline. Así la ejecución queda
            // UNIFICADA en un solo conjunto de manejadores.
            //
            // Cuando el LLM emite `acciones`, se OMITE el re-parseo del transcript
            // crudo (evita doble creación). El re-parseo del transcript crudo queda
            // como FALLBACK OFFLINE puro: solo corre cuando el LLM NO produjo
            // ninguna acción (p. ej. sin API key o respuesta genérica).
            //
            // La respuesta conversacional del LLM (respuesta_voz) tiene PRIORIDAD
            // sobre la confirmación del manejador: esta última solo se usa como
            // respaldo cuando NO hay respuesta conversacional (offline).
            //
            // onContractResolved es useCallback con deps [] y se define ANTES
            // de los manejadores, por lo que se invocan vía window en runtime
            // (siempre tienen closures frescas porque se reasignan cada render).
            // ============================================================
            let localHandledReply = '';
            const acciones = Array.isArray(contract?.acciones) ? contract.acciones : null;
            const hasAcciones = Boolean(acciones && acciones.length > 0);

            // ============================================================
            // RUTA LLM — despachar cada acción emitida por el cerebro
            // conversacional al manejador determinista correspondiente.
            // ============================================================
            if (hasAcciones && !rawOnly) {
                try {
                    const wakeWords: string[] =
                        (FLU_CONFIG?.voiceCommands?.wakeWords as string[]) || [];
                    const arbiterOptions = buildArbiterOptions();
                    lastActionFailed = false;
                    // Paso 1 — RESOLVER: cada acción del turno se re-resuelve con el
                    // árbitro determinista (fuente única del parseo preciso). No se
                    // despacha todavía para poder garantizar antes que una nota del
                    // turno no se pierda si el LLM la omitió.
                    const resolvedActions: Array<{ result: ArbiterResult; viaDomain: boolean }> = [];
                    for (const accion of acciones ?? []) {
                        const texto = String(accion?.texto || '').trim();
                        if (!texto) continue;
                        // Guard anti-arrastre (Bug #5): el contrato exige que
                        // accion.texto sea un fragmento del mandato ACTUAL. Si el
                        // LLM repite una acción de turnos anteriores (historial en
                        // el prompt), se omite: evita re-crear alarmas/notas que el
                        // usuario no pidió en este turno.
                        const belongsToTurn = actionBelongsToTranscript(texto, transcript, wakeWords);
                        if (!belongsToTurn) {
                            relayLog(
                                'WARN',
                                'App',
                                `onContractResolved: acción LLM ignorada (no pertenece al turno) → "${texto.slice(0, 100)}"`,
                            );
                            continue;
                        }
                        const commandText = normalizeCommandForDeterministic(texto, wakeWords);
                        const arbiterResult: ArbiterResult = resolveDeterministicCommand(commandText, arbiterOptions);
                        // El cerebro LLM ya clasificó el dominio (`accion.dominio`).
                        // Si el re-parseo del texto libre no matchea, se resuelve la
                        // estructura con el MISMO parser de dominio sin exigir trigger
                        // (evita "respondió bien pero no hizo nada").
                        const effectiveResult: ArbiterResult | null = arbiterResult?.matched
                            ? arbiterResult
                            : resolveDomainScopedIntent(accion?.dominio, commandText, {
                                defaultOffsetMs: (arbiterOptions)?.defaultOffsetMs,
                                now: (arbiterOptions)?.now,
                                language: (languageRef.current as 'es' | 'en') || 'es',
                            });
                        if (effectiveResult?.matched) {
                            resolvedActions.push({
                                result: effectiveResult,
                                viaDomain: !arbiterResult?.matched,
                            });
                        }
                    }
                    // Garantía de nota: el LLM puede omitir la acción de nota aunque
                    // el turno sea una nota determinista. Se agrega UNA sola por el
                    // MISMO pipeline; `resolveNoteRescue` devuelve null si ya había
                    // nota o si el turno resuelve otro dominio (sin ruta doble).
                    const noteRescue = resolveNoteRescue({
                        transcript,
                        resolvedDomains: resolvedActions
                            .map((entry) => entry.result.domain)
                            .filter((domain): domain is string => domain !== null),
                        wakeWords,
                        arbiterOptions,
                    });
                    if (noteRescue) resolvedActions.push({ result: noteRescue, viaDomain: false });

                    // Paso 2 — DESPACHAR: punto único, en orden, por el helper único.
                    for (const { result: effectiveResult, viaDomain } of resolvedActions) {
                        relayLog(
                            'LOG',
                            'App',
                            `onContractResolved: acción LLM → dominio "${effectiveResult.domain}" (${JSON.stringify(
                                readStringProp(effectiveResult.action, 'action') ?? effectiveResult.action,
                            )})${viaDomain ? ' [vía dominio LLM]' : ''}`,
                        );
                        const reply = await dispatchArbiterIntent(effectiveResult, { speakerName });
                        if (reply) {
                            localHandledReply = reply;
                            // Para acciones de ESTADO (alarma/timer) el manejador es
                            // la fuente de verdad: su reply describe lo que REALMENTE
                            // se creó (p. ej. "todos los días"). Se habla ese texto en
                            // vez del del LLM, que puede omitir la recurrencia.
                            const actionName = String(
                                readStringProp(effectiveResult.action, 'action') ?? effectiveResult.action ?? '',
                            );
                            if (actionName === 'alarm.add' || actionName === 'timer.start') {
                                respuestaVoz = reply;
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[App] acciones dispatch threw (non-critical):', err);
                    relayLog('WARN', 'App', `acciones dispatch threw: ${err}`);
                }
                // §1 (sin éxito falso): si la acción se despachó pero la ESCRITURA
                // falló, la respuesta de fallo del manejador reemplaza la del LLM.
                if (lastActionFailed && localHandledReply) {
                    respuestaVoz = localHandledReply;
                    relayLog(
                        'WARN',
                        'App',
                        `onContractResolved: acción falló → respuesta de fallo reemplaza la del LLM → "${localHandledReply}"`,
                    );
                }
            }

            // ============================================================
            // FALLBACK OFFLINE — re-parseo determinista del transcript crudo.
            // Solo corre cuando el LLM NO emitió acciones (sin API key, etc.).
            // ============================================================
            if (transcript && !rawOnly && !hasAcciones) {
                try {
                    // ============================================================
                    // PUNTO ÚNICO DE NORMALIZACIÓN DEL MANDATO (hub de integración)
                    // ============================================================
                    // El transcript crudo llega CON la wake word pegada ("Okay Blue
                    // generame una cita...") y con fragmentos ASR duplicados ("Okay
                    // Flow generame Una Okay flu genérame una nota..."). Los parsers
                    // deterministas (parseReminderIntent, __fluHandleNoteText, etc.)
                    // anclan sus regex al inicio del mandato, así que aquí se limpia
                    // TODO el prefijo de wake word (una sola vez, para todos los
                    // manejadores) y se colapsan los fragmentos duplicados antes de
                    // despachar. Este es EL ÚNICO punto donde se separa la wake word
                    // del mandato para la resolución determinista de intención.
                    const wakeWords: string[] =
                        (FLU_CONFIG?.voiceCommands?.wakeWords as string[]) || [];
                    // PUNTO ÚNICO DE NORMALIZACIÓN: delega en la función pura
                    // normalizeCommandForDeterministic (audioMath.js) que quita la
                    // wake word y colapsa el eco ASR para TODOS los manejadores.
                    const commandText = normalizeCommandForDeterministic(transcript, wakeWords);
                    if (commandText !== transcript) {
                        relayLog(
                            'LOG',
                            'App',
                            `onContractResolved: mandato normalizado (wake word + eco ASR) → "${commandText}"`,
                        );
                    }
                    // ============================================================
                    // DESPACHO UNIFICADO POR DOMINIO (árbitro determinista)
                    // ============================================================
                    // En lugar de encadenar los 5 manejadores a ciegas (cada uno
                    // re-parseando el mandato), se consulta UNA sola vez al árbitro
                    // unificado (deterministicArbiter.resolveDeterministicCommand),
                    // que devuelve { matched, domain, action, channel }. El dominio
                    // ganador decide QUÉ manejador se invoca; si ninguno matchea,
                    // el mandato cae a la IA (flu). Esto hace que "la última frase
                    // sea consistente": un solo camino de respuesta por mandato.
                    //
                    // El árbitro evalúa los dominios en orden de prioridad y ya
                    // resuelve la ambigüedad diario-vs-nota (diario gana cuando el
                    // texto dice "en el diario"). Los dominios de estado (config/
                    // game/environment) y navegación NO se despachan aquí: se
                    // resuelven por sus propios fast-paths (configAction, juegos,
                    // navegacion) más abajo en este mismo callback.
                    // PUNTO ÚNICO DE PARSEO (Point B): el árbitro y el manejador
                    // __fluHandleReminderText deben usar LOS MISMOS options para no
                    // divergir. buildArbiterOptions() deriva las options desde la
                    // MISMA fuente que los manejadores (defaultOffsetMs, now,
                    // defaultAlarmTimeOfDay, defaultTimerMinutes) y se pasa al
                    // árbitro, que lo reenvía al parser.
                    const arbiterOptions = buildArbiterOptions();
                    const arbiterResult: ArbiterResult = resolveDeterministicCommand(commandText, arbiterOptions);
                    const arbiterDomain = arbiterResult?.matched ? arbiterResult.domain : null;
                    if (arbiterDomain) {
                        relayLog(
                            'LOG',
                            'App',
                            `onContractResolved: árbitro → dominio "${arbiterDomain}" (acción ${JSON.stringify(
                                readStringProp(arbiterResult.action, 'action') ?? arbiterResult.action,
                            )})`,
                        );
                    } else {
                        relayLog(
                            'LOG',
                            'App',
                            `onContractResolved: árbitro NO matcheó. commandText="${commandText}" (transcript="${String(transcript).slice(0, 80)}") → cae a IA/flu`,
                        );
                    }
                    // ============================================================
                    // DESPACHO ÚNICO POR CONTRATO ESTRUCTURADO (Point F / §Estructura)
                    // ------------------------------------------------------------
                    // El árbitro YA parceó el transcript una sola vez y devolvió el
                    // intent COMPLETO en `arbiterResult.action` ({handled, action,
                    // reply, data}). Aquí se pasa ESE intent al manejador, NO la
                    // cadena cruda: el manejador ejecuta `intent.data` sin re-parcear.
                    // Esto elimina la duplicación de regex/parsers (rutas dobles) y
                    // hace del árbitro la ÚNICA fuente de verdad del parseo.
                    // Los manejadores conservan compatibilidad con texto crudo para
                    // su uso autónomo (E2E/integración): detectan si el primer
                    // argumento ya es un intent ({handled, action}) o una cadena.
                    // ============================================================
                    // DESPACHO ÚNICO (Point F): el intent COMPLETO que devolvió el
                    // árbitro en `arbiterResult.action` se pasa al manejador
                    // correspondiente vía dispatchArbiterIntent (el MISMO helper que
                    // usa la RUTA LLM). Esto unifica la ejecución: tanto las acciones
                    // emitidas por el cerebro conversacional (contract.acciones) como
                    // el fallback offline del transcript crudo despachan por el mismo
                    // camino, al mismo conjunto de manejadores __fluHandle*.
                    let reply = '';
                    if (arbiterDomain === 'navigation') {
                        // Navegación (BUSCAR/NAVEGAR/GENERAR_VIDEO/GENERAR_DOCUMENTO) NO se
                        // despacha por dispatchArbiterIntent (que no tiene rama navigation):
                        // se marca el comando en `navegacion` y lo ejecuta handleNavigationCommand
                        // más abajo, por el MISMO camino que el contrato navegacion del LLM.
                        navegacion.comando = typeof arbiterResult.action === 'string' ? arbiterResult.action : null;
                        relayLog('LOG', 'App', `onContractResolved: navigation → comando="${arbiterResult.action}" (handleNavigationCommand)`);
                    } else {
                        reply = await dispatchArbiterIntent(arbiterResult, { speakerName });
                    }
                    if (reply) localHandledReply = reply;
                } catch (err) {
                    console.warn('[App] Deterministic feature interception threw (non-critical):', err);
                    relayLog('WARN', 'App', `feature interception threw: ${err}`);
                }
                // La respuesta conversacional del LLM (respuesta_voz) tiene
                // PRIORIDAD. La confirmación del manejador local solo se usa como
                // respaldo cuando NO hay respuesta conversacional (fallback offline).
                if (localHandledReply && !respuestaVoz) {
                    respuestaVoz = localHandledReply;
                    relayLog('LOG', 'App', `onContractResolved: intención local resuelta (sin respuesta conversacional) → "${localHandledReply}"`);
                }
            }
            // ============================================================
            // FAST-PATH DETERMINISTA (configuración por voz instantánea)
            // ============================================================
            // Un contrato solo-configuración (sin respuesta_voz ni navegacion)
            // llega por el fast-path determinista (metadata.provider ===
            // 'deterministic-fast-path'): el comando se resuelve y aplica de
            // inmediato, mientras la IA aún genera la confirmación verbal.
            // configAction se declara aquí (hoisted) para que el gate de abajo
            // lo admita y se REUTILIZA al final del callback (no se re-declara).
            const configAction = contract?.configuracion;

            // Juego por voz (fast-path determinista): contrato normalizado por
            // normalizeJuego (gameId del catálogo + acción válida). Se declara
            // aquí (hoisted) para que el gate de abajo lo admita y se REUTILIZA
            // al final del callback (no se re-declara). El motor local es la
            // fuente de verdad de la partida.
            const juegoAction = normalizeJuego(contract?.juego);

            // Ambiente por voz (fast-path determinista): contrato normalizado por
            // normalizeEnvironment (tipo 'activar' | 'reset' + ambienteId del
            // catálogo). Se declara aquí (hoisted) para que el gate de abajo lo
            // admita y se REUTILIZA al final del callback (no se re-declara).
            // El catálogo de ambientes (src/core/environments/*) es la fuente de
            // verdad del rebranding por oficio.
            const environmentAction = normalizeEnvironment(contract?.ambiente);

            // ============================================================
            // MÚSICA REAL (F3): ejecutar la acción de música del contrato
            // ANTES del gate de voz para que funcione incluso cuando no hay
            // respuesta_voz (ej. "FLU para la música"). cancion puede ser un
            // id/título del playlist (suena al instante) o cualquier canción
            // (FLU la busca en línea, dominio público). playSong() es
            // fire-and-forget: no bloquea el procesamiento del contrato.
            // ============================================================
            if (musica?.accion === 'play_music') {
                playSong(musica?.cancion).then((result) => {
                    relayLog('LOG', 'App', `[Música] play_music → "${result.title}" (${result.source})`);
                });
            } else if (musica?.accion === 'pause_music') {
                pauseMusic();
                relayLog('LOG', 'App', '[Música] pause_music');
            } else if (musica?.accion === 'stop_music') {
                stopMusic();
                relayLog('LOG', 'App', '[Música] stop_music');
            }

            // Gate único: se admiten contratos con respuesta_voz, navegación,
            // configuración o acciones (contract.acciones). Antes, un contrato
            // SOLO-configuración (fast-path) era descartado aquí en silencio; ahora
            // pasa para aplicar applyConfigAction. Los contratos con `acciones`
            // (cerebro conversacional) también pasan aunque no traigan respuesta_voz,
            // para que el resto del procesamiento (workspace, feed, etc.) continúe.
            if (
                !respuestaVoz &&
                !navegacion.comando &&
                !configAction?.accion &&
                !juegoAction?.action &&
                !environmentAction?.tipo &&
                !hasAcciones
            )
                return;

            // ============================================================
            // OS2 parity: cuando viene de una consulta de minuta local exitosa
            // (resolveMinuteQuery → diagnostics.route === 'minute-lookup-hit'),
            // poblar el panel "Minuta de acuerdos" con la minuta consultada,
            // resaltarla en el historial y (si NO estamos en conversación
            // activa) cambiar a la pestaña de minutas para que el usuario
            // la vea visualmente. FluShell.jsx:464-583 hace el equivalente.
            // ============================================================
            let minuteSelection: MinuteLookupSelection | null = null;
            try {
                minuteSelection = selectMinuteForLookup({
                    diagnostics: resolved?.diagnostics,
                    minutes: minuteKnowledge.minutes,
                    conversationActive: Boolean(conversationActiveRef?.current),
                    fallbackTheme: sessionRoleRef.current,
                });
            } catch (err) {
                console.warn('[App] selectMinuteForLookup threw (non-critical):', err);
                relayLog('WARN', 'App', `selectMinuteForLookup threw: ${err}`);
            }
            if (minuteSelection) {
                try {
                    setMinuteDraft(minuteSelection.draft);
                    if (minuteSelection.matched?.id) {
                        setSelectedMinuteId(minuteSelection.matched.id);
                    }
                    if (minuteSelection.shouldSwitchTab) {
                        changeTab('minutes');
                    }
                } catch (err) {
                    console.warn('[App] minuteSelection handler threw (non-critical):', err);
                    relayLog('WARN', 'App', `minuteSelection handler threw: ${err}`);
                }
            }

            // ============================================================
            // LIMPIEZA POR TURNO del estado VIVO (imagen/artifact)
            // Al iniciar un turno real se limpia la imagen generada y el artifact
            // vivos para que NO queden "pegados" los resultados del turno anterior
            // (p. ej. imágenes de una consulta previa). Lo persistido (Historial
            // por usuario en `documents`) y la restauración por prioridad NO viven
            // aquí: siguen intactos.
            // ============================================================
            try {
                workspaceImage.clear();
            } catch (err) {
                relayLog('WARN', 'App', `workspaceImage.clear() threw: ${err}`);
            }
            integrationStore.setWorkspaceArtifact(null);

            // ============================================================
            // PROCESAR WORKSPACE ARTIFACT — INMEDIATAMENTE (en paralelo con la voz)
            // ============================================================
            // OS2 parity: procesar workspace artifact. Este bloque corre ANTES del
            // bloque de habla (if respuestaVoz) para que la petición de imagen
            // (workspaceImage.generateFromContract) se dispare EN EL MOMENTO en que
            // la IA responde, en paralelo con (incluso antes de) que FLU hable.
            // generateFromContract es async fire-and-forget: no bloquea el habla.
            // El artifact/imagen vivos se limpian al iniciar el turno (arriba).

            // Limpiar también el estado de búsqueda del Pizarrón al iniciar un
            // turno real: si el turno anterior fue una búsqueda web (BUSCAR/
            // NAVEGAR o manual), sus resultados y la consulta de la barra NO deben
            // quedar "pegados" cuando la IA responde otra cosa (conversación,
            // generación de imagen, etc.). WorkspaceHub escucha RESET_SEARCH y
            // llama a resetSearch(). Si este turno SÍ es una búsqueda, el
            // dispatchFluSearch posterior (más abajo) re-puebla resultados frescos.
            // Invariante (searchSingleRouteGuard G8): en un turno de BÚSQUEDA el
            // FILL (`dispatchFluSearch`) es el ÚNICO escritor del estado de Buscar.
            // Limpiar aquí borraba los resultados recién pintados cuando el ASR
            // emitía más revisiones del mismo comando (barra con query, grilla vacía).
            const comandoNavegacion = String((navegacion)?.comando || '').toUpperCase();
            const isSearchFillTurn = comandoNavegacion === 'BUSCAR' || comandoNavegacion === 'NAVEGAR';
            if (!isSearchFillTurn) dispatchFluResetSearch();
            // Foco del turno: el feed del Pizarrón salta al tipo del resultado.
            // `text` (respuesta conversacional) → vuelve a "Todo".
            {
                const wsTipoFocus = String((workspace)?.tipo || '').trim().toLowerCase();
                const navFocus = String((navegacion)?.comando || '').toUpperCase();
                const focusKindNow: 'video' | 'doc' | 'image' | 'text' =
                    wsTipoFocus === 'video' || navFocus === 'GENERAR_VIDEO'
                        ? 'video'
                        : wsTipoFocus === 'doc' || navFocus === 'GENERAR_DOCUMENTO'
                            ? 'doc'
                            : ['image_prompt', 'diagram', '3d'].includes(wsTipoFocus)
                                ? 'image'
                                : 'text';
                turnFocusSeqRef.current += 1;
                setTurnFocus({ kind: focusKindNow, seq: turnFocusSeqRef.current });
            }
            if (workspace) {
                const tipo = String(workspace.tipo || 'text').trim().toLowerCase();
                // Fuente única de normalización: si el cuerpo (carta/documento)
                // llega en `titulo` y `contenido` viene vacío, se reasigna aquí
                // para que todo el pipeline reciba body no vacío y título corto.
                const { titulo, contenido } = normalizeWorkspaceDocumentFields({
                    titulo: workspace.titulo || '',
                    contenido: workspace.contenido || '',
                });
                const promptVisual = workspace.prompt_visual || '';
                const puntos_clave = Array.isArray(workspace.puntos_clave)
                    ? workspace.puntos_clave.map((item: string) => String(item || '').trim()).filter(Boolean)
                    : [];

                const VISUAL_TIPOS = ['image_prompt', 'diagram', '3d'];
                const isVisualTipo = VISUAL_TIPOS.includes(tipo);
                if (isVisualTipo) {
                    const visualCore = promptVisual || contenido || titulo;
                    if (visualCore && visualCore.length >= 5) {
                        // Obligación #6: UUIDv4
                        const wsId = uuidv4();
                        integrationStore.setWorkspaceArtifact({
                            id: wsId,
                            respuesta: contenido || titulo || respuestaVoz,
                            titulo: titulo || visualCore,
                            tipo: tipo as 'text' | 'image_prompt' | 'diagram' | '3d' | null,
                            contenido: contenido || visualCore,
                            prompt_visual: visualCore,
                            puntos_clave,
                            origen: 'ia',
                            timestamp: Date.now(),
                        });

                        // SOLO usar workspace.prompt_visual (lo que Gemini diseña específicamente como prompt de imagen).
                        // NO caer en contenido/titulo — eso es texto para mostrar, NO para generar imagen.
                        // Si prompt_visual está vacío, NO generar imagen (fail-fast con mensaje claro).
                        if (promptVisual && promptVisual.length >= 5) {
                            workspaceImage.generateFromContract(promptVisual, workspace.tipo as string | null);
                        }
                    }
                } else if (tipo === 'horario' && (titulo || contenido || puntos_clave.length > 0 || promptVisual)) {
                    // Horario de clases en el Pizarrón: preservar tipo + modo
                    // (semana/dia/proxima/recordatorios). Los modos válidos vienen de
                    // FLU_CONFIG.horario.modos — nada hardcodeado.
                    const horarioConfig = FLU_CONFIG.horario || {};
                    const modoValido = horarioConfig.modos ? Object.keys(horarioConfig.modos) : ['semana', 'dia', 'proxima', 'recordatorios'];
                    const rawModo = String(workspace.modo || '').trim().toLowerCase();
                    const modo: HorarioModo = modoValido.includes(rawModo) ? (rawModo as HorarioModo) : 'semana';
                    // Obligación #6: UUIDv4
                    integrationStore.setWorkspaceArtifact({
                        id: uuidv4(),
                        respuesta: contenido || titulo || respuestaVoz,
                        titulo: titulo || 'Horario de clases',
                        tipo: 'horario',
                        contenido: contenido || '',
                        prompt_visual: promptVisual || '',
                        modo,
                        puntos_clave,
                        origen: 'ia',
                        timestamp: Date.now(),
                    });
                    setHorarioModo(modo);
                } else if (tipo === 'doc' || tipo === 'video') {
                    // Una petición de MINUTA no es un documento: se genera la minuta
                    // (comando determinista GENERAR_RESUMEN) y se OMITE el PDF/video.
                    if (isMinuteGenerationRequest(transcript)) {
                        relayLog('LOG', 'App', 'onContractResolved: petición de minuta → GENERATE_SUMMARY (se omite documento)');
                        dispatchFluEvent(FLU_EVENTS.GENERATE_SUMMARY);
                    } else {
                    // RUTA ÚNICA de medios: se crea el artifact (fuente de
                    // buildGenerationTopic) y se genera por `requestMediaRef`
                    // (idempotente por comando). NO se despacha evento: el bus
                    // era la segunda ruta y permitía re-generar (fuga de crédito).
                    const isVideo = tipo === 'video';
                    const ran = requestMediaRef.current(isVideo ? 'video' : 'doc', transcript, () => {
                        integrationStore.setWorkspaceArtifact({
                            id: uuidv4(),
                            respuesta: contenido || titulo || respuestaVoz,
                            titulo: titulo || (isVideo ? 'Video' : 'Documento'),
                            tipo: isVideo ? 'video' : 'doc',
                            contenido: contenido || '',
                            prompt_visual: promptVisual || '',
                            puntos_clave,
                            origen: 'ia',
                            timestamp: Date.now(),
                        });
                    });
                    if (ran) {
                        relayLog('LOG', 'App', `onContractResolved: workspace ${isVideo ? 'video' : 'doc'} → generación ÚNICA (ruta idempotente)`);
                        // Bug #5: para un video, además del guion/ensamblado se genera
                        // una ESCENA visual del asunto (imagen real en el Pizarrón).
                        if (isVideo) {
                            const scenePrompt = cleanForSpeech(promptVisual || contenido || titulo || '');
                            if (scenePrompt.length >= 5) {
                                workspaceImage.generateFromContract(scenePrompt, 'image_prompt');
                            }
                        }
                    }
                    }
                } else if (titulo || contenido || puntos_clave.length > 0 || promptVisual) {
                    // Guard anti-duplicado: si el workspace de tipo 'text' es una
                    // respuesta conversacional redundante (el contenido escrito
                    // replica la respuesta hablada y no hay puntos clave reales),
                    // NO crear un artifact. La pestaña «respuesta» ya muestra la
                    // respuesta hablada (latestResponse); crearlo duplicaría el
                    // texto en 2 lugares del Pizarrón.
                    const redundantText = isRedundantTextWorkspace({
                        contenido,
                        titulo,
                        puntosClave: puntos_clave,
                        respuestaVoz,
                    });
                    if (redundantText) {
                        relayLog('LOG', 'App', 'onContractResolved: workspace text redundante (duplica respuesta_voz) — se omite artifact para evitar doble render en Pizarrón');
                    } else {
                        // Obligación #6: UUIDv4
                        integrationStore.setWorkspaceArtifact({
                            id: uuidv4(),
                            respuesta: contenido || titulo || respuestaVoz,
                            titulo: titulo || 'Contenido',
                            tipo: 'text',
                            contenido: contenido || '',
                            prompt_visual: promptVisual || '',
                            puntos_clave,
                            origen: 'ia',
                            timestamp: Date.now(),
                        });
                    }
                }
            }

            // Si hay respuesta de voz, actualizar el store.
            // En juegos por voz la voz es SIEMPRE del motor local (determinista):
            // se suprime la respuesta_voz de cortesía de Gemini para evitar doble
            // habla (juegoAction) y la del contrato fast-path (fastPathGame).
            // El cambio de ambiente (environmentAction) también suprime la respuesta
            // SOLO cuando el ambiente va a CAMBIAR de verdad (el bloque de ambiente
            // hablará su bienvenida como reemplazo). Si el ambiente objetivo ya está
            // activo (reset idempotente a "asistente" que el LLM manda por defecto),
            // NO hay bienvenida que hablar: la respuesta_voz conversacional debe
            // hablarse normal. Un reset espurio NO debe dejar el turno mudo.
            const environmentTargetId =
                environmentAction?.tipo === 'reset'
                    ? DEFAULT_AMBIENTE_ID
                    : environmentAction?.tipo === 'activar'
                        ? environmentAction.ambienteId
                        : null;
            const environmentWillChange =
                environmentTargetId !== null &&
                environmentTargetId !== useEnvironmentStore.getState().activeAmbienteId;
            // Idempotencia por turno: la MISMA respuesta para el mismo texto en una
            // ventana corta es una re-captura/eco → se omite (no repite el habla).
            const responseKey = buildResponseKey(String(transcript || ''), String(respuestaVoz || ''));
            const responseWindowMs = Number(FLU_CONFIG?.timing?.responseDedupWindowMs) || 8000;
            const nowMs = Date.now();
            const dupResponse = isDuplicateResponse(
                lastResponseRef.current,
                responseKey,
                nowMs,
                responseWindowMs,
            );
            if (dupResponse) {
                relayLog(
                    'WARN',
                    'App',
                    'respuesta duplicada del mismo turno → se omite (evita repetir el habla)',
                );
            }
            if (
                respuestaVoz &&
                !dupResponse &&
                !juegoAction?.action &&
                !environmentWillChange &&
                !(resolved)?.fastPathGame &&
                !(resolved)?.fastPathEnvironment
            ) {
                lastResponseRef.current = { key: responseKey, at: nowMs };
                integrationStore.setLastResponse(respuestaVoz);
                integrationStore.addFluMessage(respuestaVoz);

                // ============================================================
                // APLICAR EMOCIÓN DE GEMINI ANTES DE SPEAKING
                // ============================================================
                // La IA (Gemini) responde con un elemento a animar (emocion/animacion).
                // Aplicamos la expresión EMOCIONAL de Gemini DIRECTAMENTE al store
                // (bypassing reactivity engine) MIENTRAS aún estamos en THINKING.
                //
                // Flujo correcto:
                //   1. Gemini responde con emocion (ej: "feliz", "sorprendido", "Yupi")
                //      y/o animacion (ej: "Dance", "Jump_in_place")
                //   2. Aplicamos la emoción DIRECTAMENTE via store.setExpression()
                //      → el avatar muestra la reacción emocional brevemente
                //   3. Después aplicamos el toggle speaking (hablando/hablando2)
                //      → el avatar habla con MouthMove
                //
                // La emoción se muestra durante la transición THINKING→SPEAKING,
                // y el toggle speaking la reemplaza inmediatamente después.
                // Esto da la ilusión de que FLU reacciona emocionalmente ANTES de hablar.
                // ============================================================
                const geminiEmocionRaw: string | undefined = contract?.emocion;
                const geminiAnimacionRaw: string | undefined = contract?.animacion;

                // ============================================================
                // POST-PROCESSING: Resolución determinista de intenciones
                // (acciones físicas y emociones) a partir del transcript
                // ============================================================
                // Complementa la salida de Gemini resolviendo de forma
                // determinista las intenciones del usuario que Gemini puede
                // perder (p.ej. "baila" → Dance, "chispas" → se_me_chispotio).
                //
                // La resolución corre DESPUÉS de que Gemini respondió y se
                // basa en las palabras clave mapeadas en TRANSCRIPT_ACTION_MAP
                // y TRANSCRIPT_EMOTION_MAP (src/lib/transcriptProcessor.ts),
                // garantizando que la acción/emoción final del avatar sea la
                // intención explícita del usuario.
                // ============================================================
                let geminiEmocion = geminiEmocionRaw;
                let geminiAnimacion = geminiAnimacionRaw;

                // Música activa → el avatar baila mientras suena la canción
                if (musica?.accion === 'play_music') {
                    geminiAnimacion = 'Dance';
                    geminiEmocion = undefined;
                }

                // Fuente de análisis para alinear emociones/acciones al evento REAL:
                // se escanea tanto el transcript (lo que dijo el usuario) como la
                // respuesta_voz de FLU (ej. anuncio de canción "¡vamos a bailar!" → Dance).
                const speechSource = [transcript, respuestaVoz].filter(Boolean).join(' ');
                if (speechSource) {
                    // 1. Detectar acciones físicas (baila→Dance, salta→Jump_in_place, etc.)
                    const detectedAnim = detectActionInTranscript(speechSource);
                    if (detectedAnim) {
                        // Acción física → forzar animacion y limpiar emocion
                        geminiAnimacion = detectedAnim;
                        geminiEmocion = undefined;
                        if (integrationStore.config.debug) {
                        }
                    }

                    // 2. Detectar emociones específicas (chispas, se_me_chispotio, etc.)
                    // SÓLO si no se detectó una acción física (para no pisar Dance con chispas)
                    if (!detectedAnim) {
                        const detectedEmotion = detectEmotionInTranscript(speechSource);
                        if (detectedEmotion) {
                            geminiEmocion = detectedEmotion;
                            // FIX 2026-08-16: cuando las palabras del usuario expresan una
                            // EMOCIÓN definida (enojado, triste, chispas, se_me_chispotio,
                            // palabra, llorando, serio, feliz, sorprendido), la emoción GANA
                            // sobre la animación que la IA haya elegido mal (ej: Gemini devolvió
                            // animacion="Jump_in_place" para "ok flow enojado"). Se limpia la
                            // animación para que emotionLabel caiga a la emoción y se ejecute SU
                            // mapping definido (enojado → Walk + Emo_blink + Cap_back + MouthMove).
                            // No aplica en modo canción (play_music → Dance, Regla 3: bailar/cantar
                            // durante toda la canción).
                            if (musica?.accion !== 'play_music') {
                                geminiAnimacion = undefined;
                            }
                            if (integrationStore.config.debug) {
                            }
                        }
                    }

                }

                // Guardar en el store para monitoreo (se muestra en el botón Hablar).
                // La ANIMACIÓN (acción física) manda sobre la emoción: si hay Dance
                // por "baila", el label debe reflejar la animación (OS3 parity).
                const emotionLabel = geminiAnimacion || geminiEmocion || '';
                integrationStore.setLastGeminiEmotion(emotionLabel);

                // ============================================================
                // RESOLVER ANIMACIONES DE EMOCIÓN (OS3 parity)
                // Resolver emotionLabel contra EXPRESSION_MAP para obtener las
                // animaciones reales (Dance, Jump_in_place, Cap_front, etc.).
                // Se guardan en integrationStore.pendingEmotionAnims para que el
                // efecto de SPEAKING en useAvatarVoiceSync las mezcle con MouthMove
                // durante los primeros 5 segundos: FLU reacciona MIENTRAS habla.
                // ============================================================
                const resolvedEmotionAnims: string[] = emotionLabel
                    ? (resolveEmotionAnims(emotionLabel, EXPRESSION_MAP) ?? [])
                    : [];
                // Si ya hay una emoción activa pendiente (p.ej. el ENOJO del participante
                // por mano alzada ignorada, set por onEmotion('ignored') → S1), la respuesta
                // de Gemini NO debe borrarla: FLU responde MIENTRAS sigue enojado.
                // Solo cuando no hay emoción pendiente se aplica la emoción del contrato.
                // También se excluye el toggle neutro de habla (hablando/hablando2) que nunca
                // debe pisar una emoción previa (OS3 parity para emociones reales se conserva).
                // ============================================================
                // EXCEPCIÓN (FIX "canta 8s / música 30s"): si el turno es play_music, la
                // canción SIEMPRE se lleva la emoción como 'song' (sostenida MIENTRAS dure la
                // música), incluso si existe un leftover pendiente. Ese leftover era la causa
                // del bug: el guard se saltaba setPendingEmotionAnims con sustainMode='song',
                // el leftover se consumía como 'fixed' (SUSTAINED_ACTION_MS=8000) y el avatar
                // cantaba solo 8s mientras la música seguía sonando. Las reglas 1-2 (turnos
                // sin música) conservan la protección contra pisar el enojo del participante.
                // ============================================================
                const isNeutralSpeakingEmotion = emotionLabel === 'hablando' || emotionLabel === 'hablando2';
                const hasActivePendingEmotion = useIntegrationStore.getState().uiState.pendingEmotionAnims.length > 0;
                if (resolvedEmotionAnims.length > 0 && !isNeutralSpeakingEmotion && (musica?.accion === 'play_music' || !hasActivePendingEmotion)) {
                    // REGLA 3: si la emoción viene de reproducir una canción (play_music),
                    // se sostiene MIENTRAS dure la música ('song'), no solo 8s.
                    const sustainMode = musica?.accion === 'play_music' ? 'song' : null;
                    integrationStore.setPendingEmotionAnims(resolvedEmotionAnims, 'ai', sustainMode);
                    relayLog('LOG', 'App', `[Emotion] pendingEmotionAnims ← [${resolvedEmotionAnims.join(', ')}] (emotionLabel="${emotionLabel}" source='ai'${sustainMode ? ` sustainMode='${sustainMode}'` : ''})`);
                }

                // ============================================================
                // INICIAR SPEAKING INMEDIATAMENTE
                // ============================================================
                // CRÍTICO: NO aplicar animaciones de emoción (Dance, Jump, etc.)
                // durante THINKING. Hacerlo cambia currentAnimation y blendQueue,
                // lo que dispara una recarga completa del pipeline de animación
                // de BunnyViewer (limpieza de huesos + recarga de FBX). Si luego
                // cambiamos a SPEAKING 5s después, se dispara OTRA recarga,
                // causando una doble recarga en rápida sucesión que corrompe el
                // estado de Three.js (AnimationMixer con referencias a huesos
                // eliminados) → WebGL context loss → pantalla negra.
                //
                // Flujo correcto y ÚNICO:
                //   1. Ir directo a SPEAKING
                //   2. syncAvatarToState aplica setExpression('hablando')/etc.
                //      → currentAnimation='Idle_2', blendQueue=['Idle_2','MouthMove']
                //   3. BunnyViewer carga UNA SOLA VEZ: Idle_2 + MouthMove
                //   4. La boca se mueve (MouthMove) mientras la voz suena
                //
                // La emoción de Gemini (emocion/animacion) se guarda SOLO para
                // diagnóstico en el header chip, NO se aplica al avatar.
                // ============================================================
                relayLog('LOG', 'App', `onContractResolved: emocion="${geminiEmocionRaw}", animacion="${geminiAnimacionRaw}", emotionLabel="${emotionLabel}" — yendo directo a SPEAKING`);

                let speakPromise: Promise<void> | null = null;
                if (respuestaVoz) {
                    // Use speakFluRef.current to always read the latest speakFlu function
                    // regardless of useCallback stale closure
                    const currentSpeakFlu = speakFluRef.current;
                    speakPromise = currentSpeakFlu(respuestaVoz, languageRef.current).catch((speechErr: unknown) => {
                        console.warn('[App] speakFlu failed:', speechErr);
                    });
                }

                // Ir directo a SPEAKING — syncAvatarToState aplicará
                // setExpression('hablando')/etc. que da ['Idle_2', 'MouthMove'].
                // Una sola recarga de BunnyViewer, sin doble carga.
                relayLog('LOG', 'App', `onContractResolved: calling setConversationState('SPEAKING')`);
                integrationStore.setConversationState('SPEAKING');
                integrationStore.setFluSpeaking(true);
                integrationStore.incrementInteractionCount();
                integrationStore.pushBridgeEvent({ type: 'speaking:start', timestamp: Date.now() });

                // ============================================================
                // RESET DE EMOCIÓN A LOS 7s — CENTRALIZADO EN EL HOOK
                // El reset de la emoción (volver al toggle hablando/hablando2 con
                // alternancia estricta) lo programa useAvatarVoiceSync
                // (scheduleEmotionReset) para TODAS las rutas (transcript y
                // participante S1). Ya NO hay timer duplicado aquí en App.tsx.
                // ============================================================

                // speakFlu ya se inició arriba (en paralelo).
                // Aquí solo esperamos a que termine y limpiamos el estado.
                if (speakPromise) {
                    try {
                        await speakPromise;
                    } catch (speechErr) {
                        console.warn('[App] speakFlu failed:', speechErr);
                    }
                }
                // Continuous mode: SPEAKING → LISTENING directly (no frozen IDLE
                // gap while the mic reopens). IDLE (true rest + idle micros)
                // only when the conversation is not active.
                const nextResumeState = conversationActiveRef.current ? 'LISTENING' : 'IDLE';
                relayLog('LOG', 'App', `onContractResolved: calling setConversationState('${nextResumeState}')`);
                integrationStore.setConversationState(nextResumeState);
                integrationStore.setFluSpeaking(false);
                scheduleResumeListening(respuestaVoz?.length);
            }

            // OS2 parity: detectar emoción del transcript
            if (transcript) {
                integrationStore.detectAndSetEmotion(transcript);
                // DATA-DRIVEN: aplicar expresión contextual basada en sentimiento del usuario
                // Crea un arco emocional natural: usuario dice algo positivo → FLU reacciona feliz
                // Usa el EmotionEngine (resolveContextualExpression) en lugar de switch hardcodeado
                const sentiment = detectSentiment(transcript);
                contextualEmotionRef.current?.(sentiment);
            }


            // ============================================================
            // OS2 parity: unified navigation command handler
            // (FluShell.jsx lines 476-579)
            // ============================================================
            if (navegacion.comando) {
                const resolvedLanguage = languageRef.current;
                const commandSpeech = getCommandSpeech(navegacion.comando, resolvedLanguage);
                await handleNavigationCommand({
                    navegacion,
                    transcript,
                    speakerName,
                    phase,
                    resolvedLanguage,
                    commandSpeech,
                    showListeningAck,
                    integrationStore,
                    auditLog,
                    fluParticipant,
                    os2ResetVoiceDisplay,
                    requestMedia: (tipo, text) => requestMediaRef.current(tipo, text),
                });
            }

            // ============================================================
            // OS2 parity: audit rows for normal contract (Gap 24)
            // FluShell.jsx lines 637-698: buildFluSpeechAuditRows + addAuditLog
            // ============================================================
            if (respuestaVoz && transcript) {
                // OS2 parity: buildFluSpeechAuditRows creates separate rows for human and FLU
                // FluShell.jsx lines 638-647
                const auditInput = {
                    timestamp: new Date().toISOString(),
                    humanSpeaker: speakerName || 'Hablante 1',
                    humanTranscript: transcript,
                    fluText: respuestaVoz,
                    phase,
                    navigation: navegacion,
                    navigationComando: navegacion.comando || null,
                };
                const auditRows = buildFluSpeechAuditRows(auditInput);

                // OS2 parity: addAuditLog for each row (FluShell.jsx lines 688-693)
                // Obligación #6: UUIDv4
                for (const row of auditRows) {
                    auditLog.logEvent(
                        row.speaker === 'FLU' ? 'contract:flu' : 'contract:human',
                        'conversation',
                        uuidv4(),
                        row,
                        `${row.speaker} transcript logged`,
                    ).catch(console.error);
                }
            }

            // ============================================================
            // APPLY GAME ACTION — Juegos por voz (fast-path determinista)
            // ============================================================
            // El motor local (src/core/games/*) es la fuente de verdad de la
            // partida. Se despacha ANTES que la configuración para que el juego
            // avance de inmediato sin depender de Gemini. Si falla, no afecta
            // el resto del contrato (ya procesado).
            // ============================================================
            if (juegoAction?.action) {
                try {
                    await applyGameAction(juegoAction, {
                        languageRef,
                        conversationActiveRef,
                        speakFluRef,
                        scheduleResumeListening,
                    });
                } catch (err) {
                    console.error('[App] applyGameAction failed (non-critical):', err);
                }
            }

            // ============================================================
            // APPLY ENVIRONMENT ACTION — Ambientes por voz (fast-path)
            // ============================================================
            // El catálogo de ambientes (src/core/environments/*) es la fuente de
            // verdad del rebranding por oficio (Identidad, Tema visual, Escena 3D,
            // Atuendo, Voz/personalidad, Pestañas/contenido). `reset` devuelve al
            // ambiente por defecto (asistente). Se aplica ANTES que la configuración
            // para que el rebranding se refleje de inmediato y FLU salude con la
            // bienvenida del ambiente. Si falla, no afecta el resto del contrato.
            // ============================================================
            if (environmentAction?.tipo) {
                try {
                    // Idempotencia: si el ambiente resuelto YA es el activo, no se
                    // re-aplica (evita que un `ambiente: "asistente"` espurio del LLM
                    // dispare un reset innecesario que re-activa el perfil por defecto).
                    // Un cambio legítimo de rol sigue funcionando porque el id objetivo
                    // difiere del activo (ej. en "chef" + "vuelve al modo asistente").
                    const resolvedId =
                        environmentAction.tipo === 'reset'
                            ? DEFAULT_AMBIENTE_ID
                            : environmentAction.ambienteId;
                    const currentId = useEnvironmentStore.getState().activeAmbienteId;
                    if (resolvedId === currentId) {
                        relayLog(
                            'LOG',
                            'App',
                            `[Ambiente] "${resolvedId}" ya activo — se omite re-aplicación (idempotente).`
                        );
                    } else {
                        const ambiente =
                            environmentAction.tipo === 'reset'
                                ? resetEnvironment()
                                : applyEnvironment(environmentAction.ambienteId);
                        const envLang = languageRef.current === 'en' ? 'en' : 'es';
                        await speakFluRef.current?.(ambiente.bienvenida[envLang], envLang);
                    }
                } catch (err) {
                    console.error('[App] applyEnvironment failed (non-critical):', err);
                }
            }

            // ============================================================
            // APPLY CONFIG ACTION — Configuración por voz desde Gemini
            // ============================================================
            // Gemini puede devolver un campo configuracion cuando el usuario
            // da instrucciones explícitas como "OK FLU configura...", "FLU cambia...",
            // "pon tema de...", "activa...".
            //
            // Este bloque se ejecuta AL FINAL del callback, después de todo lo demás
            // (voz, navegación, workspace, emociones). Si falla, no afecta el resto
            // del contrato porque ya está todo procesado.
            // ============================================================
            if (configAction?.accion) {
                try {
                    await applyConfigAction(configAction, {
                        branding,
                        languageRef,
                        setLanguage,
                        setSessionRole,
                        handleTextApiKeyCommit,
                        handleTextModelCommit,
                        handleTextApiUrlCommit,
                        handleImageApiKeyCommit,
                        handleImageModelCommit,
                        handleImageApiUrlCommit,
                        handleOcrApiKeyCommit,
                        handleOcrModelCommit,
                        handleOcrApiUrlCommit,
                        setVoiceConfig: integrationStore.setVoiceConfig,
                        setPersonality: integrationStore.setPersonality,
                        setAdvancedConfig: integrationStore.setAdvancedConfig,
                        setImageConfig: integrationStore.setImageConfig,
                        voices,
                        handleSetAiProvider,
                        setCelebrateAchievements: branding.seasonalActions.setCelebrateAchievements,
                        applyProfile: integrationStore.applyProfile,
                        setComponentColor,
                        resetComponentColors,
                        handleClearCache,
                        wakeWordsRef,
                        setWakeWords,
                        setDebugLogsEnabled,
                    });
                } catch (err) {
                    console.error('[App] applyConfigAction failed (non-critical):', err);
                    // No relanzar — el contrato ya se procesó exitosamente
                }
            }

            // Devolver la respuesta hablada (respuestaVoz) para que los llamadores
            // (y las pruebas E2E de intercepción) puedan conocer qué dijo FLU.
            // Puede ser '' si no hubo respuesta hablada (p. ej. solo navegación).
            return respuestaVoz;
        }, [])),
        // OS2 parity: inject the local useFluParticipant instance so OS2's voice commands
        // (FLU_ADELANTE) use the same participant state as the UI button.
        // Fixes: voice "ok flu adelante" responding "No tengo nada pendiente por ahora"
        participantRef: fluParticipantRef,
        // Fase E: nombre del participante activo (Juan/Luis) para sembrar
        // sessionPrimary en la diarización (config-gated en el hook).
        activeParticipantName: activeParticipantNameForVoice,
    });

    // Keep the ref in sync so onEmotion (captured by useFluParticipant before
    // useFluVoiceAssistant) always reads the latest setRecentMemory.
    setRecentMemoryRef.current = setRecentMemory;

    // ---- Navigation commands (extraído a hook) ----
    const navigationCommands = useNavigationCommands(
        conversationActiveRef,
        resumeListeningTimerRef,
        os2SuspendRecognition,
        os2StartListening,
        voiceStatus,
    );
    const {
        speakFlu,
        scheduleResumeListening,
        handleNavigationCommand,
    } = navigationCommands;

    // Keep speakFluRef in sync so onContractResolved always reads the latest speakFlu
    speakFluRef.current = speakFlu;

    // ---- Asistente personal (Fase 1): DND, onboarding y notificaciones ----
    // Regla #1: el estado vive en hooks config-driven (FLU_CONFIG + STORAGE_KEYS),
    // sin valores hardcodeados en este componente.
    const [dnd, dndActions] = useDoNotDisturb();
    // Puente para romper la dependencia circular: `onboarding.speak` necesita
    // suspender/reanudar el micrófono del onboarding, pero el hook de voz
    // necesita `onboarding.answer`. El ref se sincroniza tras crear ambos.
    const onboardingVoiceControlRef = useRef<{ suspend: () => void; resume: () => void }>({
        suspend: () => undefined,
        resume: () => undefined,
    });
    // Escucha activa (mismo modelo anti-eco que FLU): antes de que FLU hable
    // se SUSPENDE el micrófono del onboarding y al terminar el TTS se REANUDA.
    const onboardingSpeak = useCallback(
        async (text: string, lang: string) => {
            onboardingVoiceControlRef.current.suspend();
            try {
                await speakFlu(text, lang);
            } finally {
                onboardingVoiceControlRef.current.resume();
            }
        },
        [speakFlu],
    );
    const onboarding = useOnboarding({
        speak: onboardingSpeak,
        language,
        participantId: activeParticipantId,
        onCompleted: (completed) => {
            handleOnboardingCompletedRef.current?.(completed);
        },
    });
    // Embudo ÚNICO de respuestas del onboarding (teclado, chip y voz). Atajo
    // para perfiles EXISTENTES: si la respuesta del paso de captura del NOMBRE
    // coincide con un participante ya registrado (p. ej. tocar el chip "luis"
    // en vez de teclear), se completa de inmediato (completeWithName) y se
    // OMITE la pregunta "¿Eres niño o adulto?" — el rol de ese perfil ya está
    // guardado y no se vuelve a preguntar (kind→role solo se usa al REGISTRAR
    // un perfil NUEVO en el efecto de completado). Los nombres nuevos siguen
    // por kind (niño/adulto) para derivar su rol inicial.
    const handleOnboardingAnswer = useCallback(
        (text: string) => {
            const step = onboarding.currentStep;
            const nameKey = nameCaptureKey(onboarding.config.steps);
            const isKindStep = !!step && step.type === 'capture' && (step.options?.length || 0) > 0;
            const isNameStep =
                !isKindStep && !!step && step.type === 'capture' && !!step.key && step.key === nameKey;
            if (isNameStep) {
                const typed = String(text || '').trim().toLowerCase();
                const exists =
                    typed !== '' &&
                    participants.participants.some((p) => p.name.trim().toLowerCase() === typed);
                if (exists) {
                    onboarding.completeWithName(String(text || '').trim());
                    return;
                }
            }
            onboarding.answer(text);
        },
        [onboarding, participants.participants, activeParticipantId],
    );
    // Rescate: si el onboarding quedó (p. ej. de una sesión previa ya abierta)
    // en la pregunta redundante "¿Eres niño o adulto?" (kind) con un NOMBRE ya
    // capturado que pertenece a un perfil EXISTENTE, se completa al instante
    // para no volver a pedir un rol que el perfil ya tiene guardado.
    useEffect(() => {
        const step = onboarding.currentStep;
        const nameKey = nameCaptureKey(onboarding.config.steps);
        const capturedName = nameKey ? onboarding.state.captured[nameKey] : undefined;
        let reason = '';
        if (!onboarding.visible) reason = '!visible';
        else if (!step || step.type !== 'capture' || !(step.options && step.options.length > 0))
            reason = 'not-a-kind-step';
        else if (!capturedName) reason = 'no-captured-name';
        else if (
            !participants.participants.some(
                (p) => p.name.trim().toLowerCase() === capturedName.trim().toLowerCase(),
            )
        )
            reason = 'name-not-existing';
        if (reason) {
            return;
        }
        onboarding.completeWithName(capturedName as string);
    }, [onboarding.visible, onboarding.currentStep, onboarding.state.captured, participants.participants, activeParticipantId]);
    // Captura dual TEXTO + VOZ: la voz alimenta el MISMO embudo `answer`
    // del teclado. Solo se activa en pasos capture/decision con
    // acceptVoice !== false (config-driven, sin hardcode). Escucha activa:
    // el micrófono se abre automáticamente al activarse el paso y se
    // suspende mientras FLU habla (anti-eco). `listening` solo es true
    // con onstart real del navegador.
    const onboardingVoiceEnabled =
        onboarding.visible &&
        ((onboarding.currentStep?.type === 'capture' ||
            onboarding.currentStep?.type === 'decision') &&
            onboarding.currentStep.acceptVoice !== false);
    const onboardingVoice = useOnboardingVoiceCapture({
        enabled: onboardingVoiceEnabled,
        language: language === 'en' ? 'en' : 'es',
        onFinal: handleOnboardingAnswer,
    });
    // Mantener el ref en sync con los métodos reales del hook de voz.
    onboardingVoiceControlRef.current = {
        suspend: onboardingVoice.suspend,
        resume: onboardingVoice.resume,
    };
    const notificationCenter = useNotificationCenter({
        speak: speakFlu,
        language,
        dnd: { isActive: dnd.active, allowUrgent: dnd.allowUrgent },
    });
    // Sincroniza el servicio de notificaciones en el ref temprano para que
    // useReminders (declarado antes de useFluVoiceAssistant) pueda notificar
    // los vencimientos de recordatorios.
    notificationServiceRef.current = notificationCenter.service;

    // ---- Onboarding multiusuario: selección/creación de participante ----
    const handleSelectActiveUser = useCallback(
        (participantId: string) => {
            setActiveUser(undefined, participantId);
            setActiveParticipantId(participantId);
        },
        [],
    );

    /**
     * Borra un participante de forma consistente (lo usa el botón del perfil
     * activo y el botón de cada fila del panel). Al eliminar se limpian:
     *  - su perfil de navegador (browserProfiles),
     *  - su registro Dexie + onboarding per-user + estado huérfano,
     *  - ACTIVE_USER / activeParticipantId si era el usuario activo (para que
     *    el onboarding siguiente NO herede el id borrado ni su nombre capturado),
     *  - la referencia "pending" y el estado legacy, para que la próxima
     *    entrada vuelva a preguntar "¿Quién eres?" SIN sugerencias fantasma.
     */
    const handleRemoveMultiuserParticipant = useCallback(
        async (id: string): Promise<void> => {
            if (!id || id === DEFAULT_ONBOARDING_USER) return;
            await browserProfiles.reset(id);
            const removed = await participants.remove(id);
            const wasActive = activeParticipantId === id;
            if (removed && wasActive) {
                // El participante borrado era el activo: salir a la ruta legacy
                // y reiniciar el onboarding (borra estado legacy + per-user del id).
                setActiveUser(undefined);
                setActiveParticipantId(undefined);
                if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
                    window.localStorage.removeItem(STORAGE_KEYS.ONBOARDING_STEP);
                    if (onboarding.config.nameKey)
                        window.localStorage.removeItem(onboarding.config.nameKey);
                }
                onboarding.reset();
            } else if (removed) {
                // Se borró otro participante distinto del activo: nada que limpiar
                // del estado activo; el listado ya se refrescó en participants.remove.
            }
        },
        [activeParticipantId, browserProfiles, participants, onboarding, setActiveUser, setActiveParticipantId],
    );

    const handleRemoveActiveUser = useCallback(async () => {
        if (!activeParticipantId || activeParticipantId === DEFAULT_ONBOARDING_USER) return;
        const id = activeParticipantId;
        await handleRemoveMultiuserParticipant(id);
    }, [activeParticipantId, handleRemoveMultiuserParticipant]);

    const handleCreateNewProfile = useCallback(() => {
        // Crea un perfil nuevo: vuelve a la ruta legacy (aún sin registro Dexie)
        // para capturar el nombre; al completar se registra el participante.
        // Se limpia el estado legacy para que el onboarding de la persona nueva
        // arranque de cero y no herede la sesión anterior.
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
            window.localStorage.removeItem(STORAGE_KEYS.ONBOARDING_STEP);
            if (onboarding.config.nameKey) window.localStorage.removeItem(onboarding.config.nameKey);
        }
        const wasLegacy =
            !activeParticipantId || activeParticipantId === DEFAULT_ONBOARDING_USER;
        setActiveUser(undefined);
        setActiveParticipantId(undefined);
        if (wasLegacy) {
            // Ruta legacy (sin perfil Dexie): re-inicializa el onboarding para
            // que las preguntas vuelvan a aparecer (no hereda "completado").
            onboarding.reset();
        }
    }, [activeParticipantId, onboarding]);

    // "Siempre que se entre a la aplicación se pide el onboarding" (también
    // hablado): al montar, una vez que los participantes cargaron y el estado
    // del onboarding está resuelto (ready), si el onboarding ya estaba
    // completado (onboarding.visible es false porque el perfil ya se configuró
    // en una sesión anterior), se reinicia el onboarding para volver a pedirlo
    // en esta entrada. onboarding.reset() borra el estado per-user en Dexie y
    // vuelve a hablar la bienvenida (el hook solo habla al montar si NO estaba
    // completado, por lo que aquí no hay doble habla). En el PRIMER arranque
    // (onboarding pendiente → visible true) no se fuerza nada: corre el
    // onboarding completo de configuración. Solo se dispara una vez por montaje
    // (onboardingMountSettledRef).
    useEffect(() => {
        if (participants.loading) return;
        if (!onboarding.ready) return;
        if (onboardingMountSettledRef.current) return;
        onboardingMountSettledRef.current = true;
        if (!onboarding.visible) {
            // Ya hay un perfil configurado de una sesión previa: se vuelve a
            // pedir el onboarding en esta entrada.
            onboarding.reset();
        }
    }, [participants.loading, onboarding.ready, onboarding.visible]);

    // Activa a un participante tras resolver el completado del onboarding:
    // lo escribe como ACTIVE_USER + usuario activo del header y enciende la
    // escucha principal (si el TTS de cierre ya terminó, el micrófono del
    // onboarding se suspendió; la escucha principal queda activa para que la
    // frase "Háblame cuando quieras" no sea una invitación sin micrófono).
    // Política de autoplay: si el navegador rechaza abrir el micrófono sin
    // gesto del usuario, se reintenta con el PRIMER gesto durante 10 s.
    const activateParticipant = useCallback(
        (id: string) => {
            setActiveUser(undefined, id);
            setActiveParticipantId(id);
            const tryStartListening = async () => {
                // Saludo de cierre "¡Listo… Háblame cuando quieras": se anuncia UNA
                // vez por participante al completar el onboarding (texto del paso
                // 'complete' de la config, sin hardcode).
                const currentLang = (languageRef.current as 'es' | 'en') || 'es';
                if (onboardingAckSpokenForRef.current !== id) {
                    onboardingAckSpokenForRef.current = id;
                    const steps = FLU_CONFIG?.onboarding?.steps || [];
                    const completeStep = steps.find((s) => s.id === 'complete');
                    const name = participants.participants.find((p) => p.id === id)?.name as string;
                    const ackText = completeStep
                        ? String(completeStep[currentLang === 'en' ? 'en' : 'es'] || '')
                              .replace('{name}', name || '')
                        : currentLang === 'en'
                          ? 'Done! Talk to me whenever you want.'
                          : '¡Listo! Háblame cuando quieras.';
                    if (ackText) {
                        // Esperar a que el saludo TERMINE de hablarse antes de abrir
                        // el micrófono: si se abre durante el TTS, FLU se escucha a sí
                        // misma (eco → fila fantasma "Hablante 1: háblame cuando
                        // quieras") y el anti-eco aborta la escucha (se cierra sola).
                        try {
                            await speakFluRef.current(ackText, currentLang);
                        } catch {
                            // Sin TTS disponible: continuar igual.
                        }
                    }
                }
                try {
                    // El TTS de cierre ("Háblame cuando quieras") puede seguir
                    // sonando cuando este arranque se dispara: si la reconocedora
                    // se abre durante el habla, el anti-eco la aborta y nadie la
                    // restaura (Bug #2: "detenido"). Se espera el fin REAL del
                    // habla del asistente antes de intentar abrir el micrófono.
                    await waitForSpeechIdle();
                } catch {
                    // Sin habla activa / timeout: continuar igual.
                }
                os2StartListening({ resume: true }).catch((err: unknown) => {
                    const errorName = err instanceof Error ? err.name : '';
                    const blocked =
                        errorName === 'not-allowed' ||
                        errorName === 'aborted' ||
                        errorName === 'not-allowed-error';
                    if (blocked) {
                        const cleanup = () => {
                            window.removeEventListener('pointerdown', startOnGesture);
                            window.removeEventListener('keydown', startOnGesture);
                            window.removeEventListener('touchstart', startOnGesture);
                        };
                        const startOnGesture = () => {
                            cleanup();
                            os2StartListening({ resume: true }).catch((err2: unknown) =>
                                console.warn('[App] escucha tras gesto del usuario falló:', err2),
                            );
                        };
                        window.addEventListener('pointerdown', startOnGesture);
                        window.addEventListener('keydown', startOnGesture);
                        window.addEventListener('touchstart', startOnGesture);
                        window.setTimeout(cleanup, TIMEOUT_POLICY_MS.onboardingGestureCleanup);
                    } else {
                        console.warn('[App] fallo al iniciar escucha tras onboarding:', err);
                    }
                });
            };
            window.setTimeout(tryStartListening, 700);
        },
        [os2StartListening],
    );

    // Al COMPLETAR el onboarding (primer arranque, perfil nuevo o re-entrega en
    // cada entrada) se resuelve el nombre capturado a un participante: si ya
    // existe uno con ese nombre se selecciona (sin duplicar); si coincide con
    // el anónimo por defecto se selecciona el Anónimo; si no, se registra un
    // participante nuevo. Se siembra su onboarding (completado) en Dexie y
    // queda como usuario activo. Corre desde onCompleted (el MISMO flujo que
    // completa), NO desde un efecto: antes, el refresco de la lista disparado
    // por el propio registro cancelaba la cadena (cleanup del efecto) y el
    // participante se persistía sin activarse ni aparecer en el selector
    // (Bug #1). Las búsquedas por nombre leen el registro REAL (IndexedDB)
    // para no depender de una lista en memoria desactualizada.
    const handleOnboardingCompleted = useCallback(
        async (completed: OnboardingState) => {
            const captureKey = nameCaptureKey(onboarding.config.steps);
            const name = captureKey ? completed.captured[captureKey] : undefined;
            if (!name) {
                return;
            }
            try {
                // El rol se deriva de la respuesta "¿Niño o adulto?"
                // (config-driven vía multiuser.kindToRole).
                const kind = completed.captured['kind'];
                const kindToRole = FLU_CONFIG.multiuser?.kindToRole || {};
                const role = resolveKindRole(kind, kindToRole);
                const skipDefaults = (FLU_CONFIG.multiuser?.skipDefaults) || {};
                const anonymousName = String(skipDefaults.anonymousName || 'Anónimo');
                const normalized = name.trim().toLowerCase();
                // Nombre = perfil anónimo por defecto: NO se registra un
                // participante nuevo; se activa el Anónimo ya sembrado.
                if (normalized === anonymousName.toLowerCase()) {
                    const anon = await participants.findAnonymous();
                    if (anon) {
                        await onboarding.persistForParticipant(anon.id, completed);
                        activateParticipant(anon.id);
                    }
                    return;
                }
                // Perfil existente con el mismo nombre: se activa sin duplicar.
                const rows = await participants.service.list();
                const existing = rows.find((p) => p.name.trim().toLowerCase() === normalized);
                if (existing) {
                    await onboarding.persistForParticipant(existing.id, completed);
                    activateParticipant(existing.id);
                    return;
                }
                const result = await participants.register({ name, role });
                if (result.ok && result.record) {
                    await onboarding.persistForParticipant(result.record.id, completed);
                    activateParticipant(result.record.id);
                    return;
                }
                // Carrera de duplicado: el perfil ya está en la BD pero la
                // lectura previa no lo vio. Se relee y se activa el existente.
                const after = await participants.service.list();
                const byName = after.find((p) => p.name.trim().toLowerCase() === normalized);
                if (byName) {
                    await onboarding.persistForParticipant(byName.id, completed);
                    activateParticipant(byName.id);
                    return;
                }
            } catch (err) {
                console.error('[App] error al resolver el completado del onboarding:', err);
            }
        },
        [onboarding, participants, activateParticipant],
    );
    handleOnboardingCompletedRef.current = handleOnboardingCompleted;

    // Fase 2 — Exponer manejador de recordatorios por texto en window (E2E + integración).
    // Se asigna en CREACIÓN (expresión de asignación), disponible desde el montaje,
    // siguiendo el precedente de __fluOnContractResolved (línea 1105).
    window.__fluHandleReminderText = useCallback(
        async (input: ReminderIntent | string, opts?: { personId?: string; personName?: string }) => {
            const lang = (languageRef.current as 'es' | 'en') || 'es';
            // Punto único de parseo: si el despacho ya pasó el intent estructurado
            // (del árbitro), se ejecuta DIRECTAMENTE sin re-parcear la cadena. Si se
            // llama con texto crudo (uso autónomo E2E/integración), se parcea aquí.
            const remindersConfig = FLU_CONFIG.reminders || {};
            const offsetMinutes = Number(remindersConfig.defaultReminderOffsetMinutes);
            const defaultOffsetMs = (Number.isFinite(offsetMinutes) ? offsetMinutes : 10) * 60 * 1000;
            const intent = (
                input &&
                typeof input === 'object' &&
                typeof input.action === 'string' &&
                input.handled !== false
            )
                ? input
                : parseReminderIntent(String(input || ''), { defaultOffsetMs });
            if (!intent || !intent.handled) return '';
            const data: ReminderIntentData = intent.data || {};

            switch (intent.action) {
                case 'reminder.add': {
                    const result = await reminders.add({
                        text: data.text || '',
                        dueAt: data.dueAt || Date.now() + defaultOffsetMs,
                        personName: data.personName || opts?.personName,
                        personId: opts?.personId,
                    });
                    lastActionFailed = !result.ok;
                    if (!result.ok) {
                        return lang === 'en'
                            ? `I couldn't create the reminder${result.reason ? ` (${result.reason})` : ''}.`
                            : `No pude crear el recordatorio${result.reason ? ` (${result.reason})` : ''}.`;
                    }
                    return lang === 'en'
                        ? `Reminder created: ${data.text || ''}`
                        : `Recordatorio creado: ${data.text || ''}`;
                }
                case 'reminder.list': {
                    const pending = reminders.reminders.filter((r) => r.status === 'pending');
                    if (pending.length === 0) {
                        return lang === 'en'
                            ? 'You have no pending reminders.'
                            : 'No tienes recordatorios pendientes.';
                    }
                    const lines = pending
                        .slice()
                        .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
                        .slice(0, 10)
                        .map((r) => `${new Date(r.dueAt ?? 0).toLocaleString(lang)} — ${r.text}`);
                    return lang === 'en'
                        ? `Pending reminders: ${lines.join(' | ')}`
                        : `Recordatorios pendientes: ${lines.join(' | ')}`;
                }
                case 'reminder.remove': {
                    const target = String(data.text || '').trim().toLowerCase();
                    const candidates = reminders.reminders.filter(
                        (r) => r.status === 'pending' && r.text.toLowerCase().includes(target),
                    );
                    if (candidates.length === 0) {
                        return lang === 'en'
                            ? `I couldn't find a pending reminder matching "${data.text}".`
                            : `No encontré un recordatorio pendiente que coincida con "${data.text}".`;
                    }
                    for (const r of candidates) {
                        await reminders.remove(r.id);
                    }
                    const removedText = candidates.map((r) => r.text).join(' | ');
                    return lang === 'en'
                        ? `Removed reminder${candidates.length > 1 ? 's' : ''}: ${removedText}`
                        : `Quité el recordatorio: ${removedText}`;
                }
                case 'shopping.add': {
                    const labels = String(data.label || '')
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    if (labels.length === 0) return '';
                    await shopping.addMany(labels);
                    return lang === 'en'
                        ? `Added to the shopping list: ${labels.join(', ')}`
                        : `Agregué a la lista de compras: ${labels.join(', ')}`;
                }
                case 'shopping.toggle': {
                    const label = String(data.label || '').trim();
                    const item = shopping.items.find(
                        (i) => i.label.toLowerCase() === label.toLowerCase(),
                    );
                    if (!item) {
                        return lang === 'en'
                            ? `"${label}" is not on the shopping list.`
                            : `"${label}" no está en la lista de compras.`;
                    }
                    await shopping.toggle(item.id);
                    return lang === 'en'
                        ? `Updated "${item.label}".`
                        : `Actualicé "${item.label}".`;
                }
                case 'shopping.remove': {
                    const label = String(data.label || '').trim();
                    const item = shopping.items.find(
                        (i) => i.label.toLowerCase() === label.toLowerCase(),
                    );
                    if (!item) {
                        return lang === 'en'
                            ? `"${label}" is not on the shopping list.`
                            : `"${label}" no está en la lista de compras.`;
                    }
                    await shopping.remove(item.id);
                    return lang === 'en'
                        ? `Removed "${item.label}" from the shopping list.`
                        : `Quité "${item.label}" de la lista de compras.`;
                }
                case 'shopping.list': {
                    const pending = shopping.items.filter((i) => !i.checked);
                    if (pending.length === 0) {
                        return lang === 'en'
                            ? 'Your shopping list is empty.'
                            : 'Tu lista de compras está vacía.';
                    }
                    const lines = pending.map((i) => i.label).join(' | ');
                    return lang === 'en'
                        ? `Shopping list: ${lines}`
                        : `Lista de compras: ${lines}`;
                }
                default:
                    return '';
            }
        },
        [reminders, shopping, languageRef],
    );

    // Motor temporal genérico — manejador de alarmas y temporizadores por texto (E2E + integración).
    // Un único motor (trigger + recurrencia + entrega) cubre recordatorios, despertador y temporizador.
    window.__fluHandleTemporalText = useCallback(
        async (input: TemporalIntent | string) => {
            const lang = (languageRef.current as 'es' | 'en') || 'es';
            // Punto único de parseo: si el despacho ya pasó el intent estructurado
            // (del árbitro), se ejecuta DIRECTAMENTE sin re-parcear la cadena. Si se
            // llama con texto crudo (uso autónomo E2E/integración), se parcea aquí.
            const temporalConfig = FLU_CONFIG.temporal || {};
            const intent = (
                input &&
                typeof input === 'object' &&
                typeof input.action === 'string' &&
                input.handled !== false
            )
                ? input
                : parseTemporalIntent(String(input || ''), {
                      now: Date.now(),
                      defaultAlarmTimeOfDay: temporalConfig.defaultAlarmTimeOfDay,
                      defaultTimerMinutes: Number(temporalConfig.defaultTimerMinutes) || 5,
                  });
            if (!intent || !intent.handled) return '';
            const data: TemporalIntentData = intent.data || {};

            switch (intent.action) {
                case 'alarm.add':
                case 'timer.start': {
                    const fallbackLabel =
                        data.kind === 'alarm'
                            ? (data.trigger)?.timeOfDay || ''
                            : formatDurationMs((data.trigger)?.durationMs || 0, lang);
                    // Idempotencia (anti pile-up): no crear una alarma IDÉNTICA
                    // (misma hora + recurrencia + etiqueta) si ya hay una pendiente.
                    // Evita que repetir el comando cree varias alarmas que suenan juntas.
                    if ((data.kind || 'alarm') === 'alarm') {
                        const hhmmOf = (ts?: number): string => {
                            if (!ts) return '';
                            const d = new Date(ts);
                            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                        };
                        const trig = data.trigger;
                        const wantedTime =
                            trig?.timeOfDay || (trig?.kind === 'absolute' && trig.at ? hhmmOf(trig.at) : '');
                        const wantedRec = String((data.recurrence)?.kind || 'once');
                        const wantedLabel = String(data.label || fallbackLabel);
                        const duplicate = temporals.alarms.find((a) => {
                            if (a.status !== 'pending') return false;
                            const at = a.trigger;
                            const aTime =
                                at?.timeOfDay || (at?.kind === 'absolute' && at.at ? hhmmOf(at.at) : '');
                            const aRec = String(
                                (a.recurrence)?.kind ||
                                    (at?.kind === 'daily' ? 'daily' : 'once'),
                            );
                            return aTime === wantedTime && aRec === wantedRec && String(a.label) === wantedLabel;
                        });
                        if (duplicate) {
                            return lang === 'en' ? 'That alarm already exists.' : 'Esa alarma ya existe.';
                        }
                    }
                    const result = await temporals.add({
                        kind: data.kind || 'alarm',
                        label: data.label || fallbackLabel,
                        trigger: data.trigger ?? { kind: 'absolute' },
                        recurrence: data.recurrence,
                    });
                    if (!result.ok) {
                        if (result.reason === 'max-active') {
                            return lang === 'en'
                                ? "I can't keep more active temporal items."
                                : 'No puedo guardar más ítems temporales activos.';
                        }
                        return lang === 'en'
                            ? "I couldn't save the temporal item."
                            : 'No pude guardar el ítem temporal.';
                    }
                    return intent.reply;
                }
                case 'alarm.list': {
                    const pending = temporals.alarms.filter((a) => a.status === 'pending');
                    if (pending.length === 0) {
                        return lang === 'en'
                            ? 'You have no alarms.'
                            : 'No tienes alarmas.';
                    }
                    const lines = pending
                        .slice()
                        .sort((a, b) => a.nextAt - b.nextAt)
                        .slice(0, 10)
                        .map((a) => `${new Date(a.nextAt).toLocaleString(lang)} — ${a.label}`);
                    return lang === 'en'
                        ? `Alarms: ${lines.join(' | ')}`
                        : `Tus alarmas: ${lines.join(' | ')}`;
                }
                case 'timer.list': {
                    const pending = temporals.timers.filter((t) => t.status === 'pending');
                    if (pending.length === 0) {
                        return lang === 'en'
                            ? 'You have no timers.'
                            : 'No tienes temporizadores.';
                    }
                    const lines = pending
                        .slice()
                        .sort((a, b) => a.nextAt - b.nextAt)
                        .slice(0, 10)
                        .map((t) => `${formatDurationMs(t.trigger.durationMs ?? 0, lang)} — ${t.label}`);
                    return lang === 'en'
                        ? `Timers: ${lines.join(' | ')}`
                        : `Tus temporizadores: ${lines.join(' | ')}`;
                }
                case 'alarm.stop':
                case 'timer.stop': {
                    // Silencia el tono en curso (no cancela el ítem pendiente).
                    temporals.stopRinging();
                    return intent.reply;
                }
                case 'alarm.cancel': {
                    const target = data.cancelTarget as string | undefined;
                    // Hora local HH:MM de la próxima ocurrencia: permite cancelar
                    // por hora también las alarmas de UNA sola vez (trigger
                    // 'absolute', que no trae timeOfDay).
                    const hhmmOf = (ts?: number): string => {
                        if (!ts) return '';
                        const d = new Date(ts);
                        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    };
                    const matches = temporals.alarms.filter(
                        (a) =>
                            a.status === 'pending' &&
                            (data.all ||
                                (target &&
                                    (a.trigger?.timeOfDay === target || hhmmOf(a.nextAt) === target))),
                    );
                    for (const a of matches) await temporals.cancel(a.id);
                    return intent.reply;
                }
                case 'timer.cancel': {
                    const target = data.cancelTarget as string | undefined;
                    let matches = temporals.timers.filter(
                        (t) =>
                            t.status === 'pending' &&
                            (data.all ||
                                (target &&
                                    formatDurationMs(t.trigger.durationMs ?? 0, lang) === target)),
                    );
                    if (!data.all && matches.length === 0) {
                        const first = temporals.timers.find((t) => t.status === 'pending');
                        if (first) matches = [first];
                    }
                    for (const t of matches) await temporals.cancel(t.id);
                    return intent.reply;
                }
                default:
                    return intent.reply;
            }
        },
        [temporals, languageRef],
    );

    // P1-C (§1.3.4) — autoconocimiento por texto (E2E + integración).
    // Fast-path local sin Gemini: detecta CONOCER_FLU, construye el manifiesto
    // compilado desde la configuración y lo devuelve como respuesta hablada.
    window.__fluHandleConocerFluText = useCallback(
        async (text: string) => {
            const lang = (languageRef.current as 'es' | 'en') || 'es';
            const clean = String(text || '').trim();
            if (!clean || !isSelfKnowledgeRequest(clean, lang)) return '';
            const manifesto = buildSelfManifesto(lang);
            auditLog.logEvent(
                'command:conocer_flu',
                'navigation',
                uuidv4(),
                {
                    transcript: clean,
                    response: manifesto,
                    comando: 'CONOCER_FLU',
                    phase: 'local-fast-path',
                },
                'CONOCER_FLU command executed (local)',
            ).catch(console.error);
            return manifesto;
        },
        [languageRef, auditLog],
    );

    // Fase 7 — Acciones de dispositivo — manejador por texto (E2E + integración).
    // Resuelve el contacto en la agenda y abre el esquema de URL estándar
    // (tel:, wa.me, sms:, mailto:) vía el servicio inyectado en el hook.
    window.__fluHandleDeviceActionText = useCallback(
        async (text: string) => {
            const lang = (languageRef.current as 'es' | 'en') || 'es';
            const intent = parseDeviceActionIntent(String(text || ''));
            if (!intent.handled) return '';
            if (!intent.action) return intent.reply;
            const data: DeviceActionIntentData = intent.data || {
                contactName: '',
                message: undefined,
            };
            const name = data.contactName || '';
            const result = await deviceActions.service.execute({
                kind: intent.action.replace(/\.(start|send)$/, '') as
                    | 'call'
                    | 'whatsapp'
                    | 'sms'
                    | 'email',
                contactName: name,
                message: data.message,
            });
            if (result.ok) return intent.reply;
            const voice = FLU_CONFIG.deviceActions?.voice?.[lang] || {};
            const fill = (tpl?: string) => String(tpl || '').replace('{name}', name);
            if (result.reason === 'missing-phone') {
                return (
                    fill(voice.missingPhone) ||
                    (lang === 'en'
                        ? `I don't have a phone number for ${name}.`
                        : `No tengo teléfono de ${name}.`)
                );
            }
            if (result.reason === 'missing-email') {
                return (
                    fill(voice.missingEmail) ||
                    (lang === 'en'
                        ? `I don't have an email for ${name}.`
                        : `No tengo correo de ${name}.`)
                );
            }
            return (
                fill(voice.contactNotFound) ||
                (lang === 'en'
                    ? `I don't have ${name} in your contacts.`
                    : `No tengo a ${name} en tus contactos.`)
            );
        },
        [deviceActions, languageRef],
    );

    // Fase 6 — Notas por voz (E2E + integración + dictado por voz).
    // Detecta intenciones de nota ("nota para el super", "nota para recordar un
    // negocio", "apunta/anota {texto}", "nota: {texto}") y crea la nota vía
    // notes.add. Devuelve la confirmación hablada (o '' si no aplica).
    window.__fluHandleNoteText = useCallback(
        async (input: NoteVoiceIntent | string, opts?: { personId?: string; personName?: string }) => {
            const lang = (languageRef.current as 'es' | 'en') || 'es';
            const notesVoice = FLU_CONFIG.notes?.voice || {};
            const addedMsg =
                notesVoice.added ||
                (lang === 'en' ? 'Done, I added it to your notes.' : 'Listo, lo agregué a las notas.');

            // Punto único de parseo: si el despacho ya pasó el intent estructurado
            // (del árbitro, que ya extrajo data.label), se ejecuta DIRECTAMENTE sin
            // re-parcear la cadena. Si se llama con texto crudo (uso autónomo
            // E2E/integración), se parcea aquí con la lógica de reconocimiento.
            const isIntent =
                input &&
                typeof input === 'object' &&
                typeof input.action === 'string' &&
                input.handled !== false;

            let label: string | null = null;
            if (isIntent) {
                const data = (input).data || {};
                label = data.label ? String(data.label).trim() : null;
            } else {
                // Ruta cruda (E2E/integración/uso autónomo): parser ÚNICO de notas
                // (src/voice/lib/noteIntentParser.js) — misma lógica que el árbitro
                // (sin duplicación de regex en App).
                const parsed = parseNoteIntentText(String(input || '').trim());
                label = parsed && parsed.label ? parsed.label : null;
            }

            if (!label) return '';
            // Append semántico a una nota "Super:" existente (bug: "agrega papel
            // de baño a la lista del super" creaba una FILA nueva por ítem). Si la
            // nota objetivo ya existe pendiente, se renombra concatenando el ítem;
            // si no existe, se crea.
            const target = /^Super:\s*/i.test(label)
                ? label
                : null;
            if (target) {
                const item = label.replace(/^Super:\s*/i, '').trim();
                const existing = [...(notes?.notes ?? [])]
                    .filter((n) => !n.done && /^Super:/i.test(n.label || ''))
                    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
                const head = existing[0];
                if (head && item && head.id !== undefined) {
                    const merged = `${String(head.label).trim().replace(/[,;]\s*$/, '')}, ${item}`;
                    const renamed = await notes.rename(head.id, merged);
                    lastActionFailed = !renamed;
                    if (!renamed) {
                        return lang === 'en'
                            ? "I couldn't update the note."
                            : 'No pude actualizar la nota.';
                    }
                    return addedMsg;
                }
            }
            const result = await notes.add({
                label,
                personId: opts?.personId,
                personName: opts?.personName,
            });
            lastActionFailed = !result.ok;
            if (!result.ok) {
                return lang === 'en'
                    ? "I couldn't create the note."
                    : 'No pude crear la nota.';
            }
            return addedMsg;
        },
        [notes, languageRef],
    );

    // Fase 6 — Diario por voz (E2E + integración + dictado por voz).
    // Detecta intenciones de diario ("escribe en el diario {contenido}",
    // "guarda en el diario {contenido}", "diario: {contenido}") y crea la
    // entrada de hoy vía diary.addEntry. Devuelve la confirmación hablada.
    window.__fluHandleDiaryText = useCallback(
        async (input: DiaryVoiceIntent | string, opts?: { personId?: string; personName?: string }) => {
            // DIARIO PAUSADO: no se crean entradas hasta su reimplementación.
            if (!FLU_CONFIG.diary?.enabled) return '';
            const lang = (languageRef.current as 'es' | 'en') || 'es';
            const diaryVoice = FLU_CONFIG.diary?.voice || {};
            const addedMsg =
                diaryVoice.entryAdded ||
                (lang === 'en'
                    ? 'Done, I saved your diary entry.'
                    : 'Listo, he guardado tu entrada del diario.');

            // Punto único de parseo: si el despacho ya pasó el intent estructurado
            // (del árbitro, que ya extrajo data.content), se ejecuta DIRECTAMENTE
            // sin re-parcear la cadena. Si se llama con texto crudo (uso autónomo
            // E2E/integración), se parcea aquí.
            const isIntent =
                input &&
                typeof input === 'object' &&
                typeof input.action === 'string' &&
                input.handled !== false;

            let content: string | null = null;
            if (isIntent) {
                const data = input.data || {};
                content = data.content ? String(data.content).trim() : null;
            } else {
                const clean = String(input || '').trim();
                if (!clean) return '';
                // "escribe/guarda/anota en el diario {contenido}"
                const enDiario = /^(?:escribe|guarda|anota|apunta|registra)\s+(?:en\s+)?(?:el\s+|mi\s+)?diario\s*[:,\-]?\s+(.+)$/i.exec(clean);
                // "diario: {contenido}" / "diario {contenido}"
                const diarioPrefijo = /^diario\s*[:,\-]?\s+(.+)$/i.exec(clean);
                const match = enDiario || diarioPrefijo;
                if (!match) return '';
                content = match[1].trim();
            }

            if (!content) return '';
            const today = new Date();
            const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const result = await diary.addEntry({
                date: dateKey,
                content,
                title: opts?.personName || undefined,
            });
            if (!result.ok) {
                return lang === 'en'
                    ? "I couldn't save the diary entry."
                    : 'No pude guardar la entrada del diario.';
            }
            return addedMsg;
        },
        [diary, languageRef],
    );

    // Horario por dictado de voz (agregar / consultar / quitar). Motor
    // determinista: parseHorarioIntent interpreta el transcript y aquí se
    // ejecuta la acción sobre el hook useHorario (fuente de verdad Dexie).
    window.__fluHandleHorarioText = useCallback(
        async (input: HorarioIntent | string) => {
            const lang = (languageRef.current as 'es' | 'en') || 'es';
            // Punto único de parseo: si el despacho ya pasó el intent estructurado
            // (del árbitro, que ya ejecutó parseHorarioIntent), se ejecuta
            // DIRECTAMENTE sin re-parcear la cadena. Si se llama con texto crudo
            // (uso autónomo E2E/integración), se parcea aquí.
            const intent = (
                input &&
                typeof input === 'object' &&
                typeof input.action === 'string' &&
                input.handled !== false
            )
                ? input
                : parseHorarioIntent(String(input || '').trim());
            if (!intent || !intent.handled) return '';
            const data: HorarioIntentData = intent.data || {};
            const voice = FLU_CONFIG.horario?.voice || {};
            const dayLabels = (FLU_CONFIG.horario?.dayLabels as string[]) || [];
            const dayLabel = (dia?: number) =>
                dia && dia >= 1 && dia <= 7 ? dayLabels[dia] || String(dia) : '';

            const pick = (obj: Record<string, unknown>, key: string, fallback: string): string => {
                const v = obj?.[key];
                if (v && typeof v === 'object') {
                    const localized = Reflect.get(v, lang) ?? Reflect.get(v, 'es');
                    return typeof localized === 'string' ? localized : fallback;
                }
                return typeof v === 'string' ? v : fallback;
            };

            switch (intent.action) {
                case 'horario.add': {
                    const materia = String(data.materia || '').trim();
                    const dia = data.dia;
                    const inicio = data.inicio;
                    if (!materia || !dia || !inicio) return '';
                    // Si no se dictó hora de fin, derivar una duración por defecto
                    // (config data-driven, Regla #1: sin hardcode).
                    let fin = data.fin;
                    if (!fin) {
                        const durMin = Number(
                            (FLU_CONFIG.horario?.defaultDurationMinutes) ?? 60,
                        );
                        const startMin = toMin(inicio);
                        fin = toHHMM(startMin >= 0 ? startMin + (Number.isFinite(durMin) ? durMin : 60) : 0);
                    }
                    const result = await horario.add({
                        materia,
                        dia,
                        inicio,
                        fin,
                        aula: data.aula,
                    });
                    if (!result.ok) {
                        return pick(voice, 'addError', `No pude registrar "${materia}".`)
                            .replace('{titulo}', materia);
                    }
                    const hora = fin ? `${inicio} a ${fin}` : `a las ${inicio}`;
                    return pick(voice, 'addOk', `Listo, agregué "${materia}" al horario.`)
                        .replace('{titulo}', materia)
                        .replace('{dia}', dayLabel(dia))
                        .replace('{hora}', hora);
                }
                case 'horario.query': {
                    const all = horario.horario || [];
                    if (all.length === 0) {
                        return pick(voice, 'queryEmptyAll', 'Aún no hay entradas en el horario.');
                    }
                    let entries = all;
                    if (data.dia) {
                        entries = all.filter((r) => r.dia === data.dia);
                    } else if (data.when === 'hoy') {
                        entries = all.filter((r) => r.dia === diaDeFecha(Date.now()));
                    } else if (data.when === 'manana') {
                        const d = new Date(Date.now());
                        d.setDate(d.getDate() + 1);
                        entries = all.filter((r) => r.dia === diaDeFecha(d.getTime()));
                    }
                    if (entries.length === 0) {
                        return pick(voice, 'queryEmpty', 'No tienes entradas registradas para ese día.');
                    }
                    const lines = entries
                        .slice()
                        .sort((a, b) => toMin(a.inicio) - toMin(b.inicio))
                        .slice(0, 10)
                        .map((r) => {
                            const when = data.dia ? `${dayLabel(r.dia)} ` : '';
                            const time = r.fin ? `${r.inicio} a ${r.fin}` : r.inicio;
                            return `${when}${time} — ${r.materia}`;
                        });
                    return lang === 'en'
                        ? `Schedule: ${lines.join(' | ')}`
                        : `Horario: ${lines.join(' | ')}`;
                }
                case 'horario.remove': {
                    const materia = String(data.materia || '').trim();
                    if (!materia) return '';
                    const norm = (s: string) =>
                        String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    let matches = (horario.horario || []).filter(
                        (r) => norm(r.materia) === norm(materia),
                    );
                    if (data.dia) matches = matches.filter((r) => r.dia === data.dia);
                    if (matches.length === 0) {
                        return pick(voice, 'removeNotFound', `No encontré "${materia}" en el horario.`)
                            .replace('{titulo}', materia);
                    }
                    for (const m of matches) {
                        await horario.remove(m.id);
                    }
                    return pick(voice, 'removeOk', `Listo, quité "${materia}" del horario.`)
                        .replace('{titulo}', materia);
                }
                default:
                    return '';
            }
        },
        [horario, languageRef],
    );

    const onboardingOverlayLabels = FLU_CONFIG.onboarding?.overlay || {};
    const onboardingPrompt = onboarding.currentStep
        ? promptForStep(
              onboarding.currentStep,
              language === 'en' ? 'en' : 'es',
              onboarding.state.captured,
          )
        : '';

    // Selector de usuario del encabezado (dropdown persistente): perfil activo
    // + participantes registrados. No es la minipantalla "¿Quién eres?" (que se
    // eliminó); es el control de sesión del header.
    const userPickerConfig = (FLU_CONFIG.onboarding?.userPicker) || {};
    const activeParticipantName = useMemo(() => {
        if (!activeParticipantId || activeParticipantId === DEFAULT_ONBOARDING_USER) return undefined;
        return participants.participants.find((p) => p.id === activeParticipantId)?.name;
    }, [activeParticipantId, participants.participants]);
    const activeParticipant = useMemo(
        () => participants.participants.find((p) => p.id === activeParticipantId),
        [activeParticipantId, participants.participants]
    );
    // Sugerencias de la minipantalla de captura del nombre: SOLO perfiles reales.
    // La lista se lee del registro de participantes (IndexedDB). Ese registro puede
    // contener basura/duplicados de corridas anteriores (p. ej. participantes cuyo
    // nombre quedó como la etiqueta de "¿Niño o adulto?" → "Niño / Niña", "Adulto /
    // Adulta"). Para que la lista muestre NOMBRES y no opciones de rol ni repetidos:
    //  - se excluye el anónimo por defecto (no es una persona a elegir),
    //  - se excluye cualquier nombre que sea una etiqueta de rol (niño/niña/adulto/
    //    adulta y variantes),
    //  - se deduplican nombres repetidos (case-insensitive).
    const onboardingUserSuggestions = useMemo(() => {
        const skipDefaults = (FLU_CONFIG.multiuser?.skipDefaults) || {};
        const anonymousName = String(skipDefaults.anonymousName || 'Anónimo').toLowerCase();
        const kindStep = (FLU_CONFIG.onboarding?.steps || []).find(
            (s) => s.key === 'kind',
        );
        const kindTokens = new Set<string>();
        (kindStep?.options || []).forEach((opt) => {
            [opt.value, opt.es, opt.en]
                .filter(Boolean)
                .forEach((t: string) => kindTokens.add(String(t).toLowerCase()));
        });
        const seen = new Set<string>();
        return participants.participants
            .map((p) => p.name)
            .filter((name) => {
                const n = name.trim().toLowerCase();
                if (!n) return false;
                if (n === anonymousName) return false;
                if (kindTokens.has(n)) return false;
                if (seen.has(n)) return false;
                seen.add(n);
                return true;
            });
    }, [participants.participants]);

    // Allowlist efectiva del Navegador Curado para el participante activo:
    // perfil guardado > defaults por rol > perfil por defecto > fallback mínimo.
    // Todo config-driven (FLU_CONFIG.browser), sin hardcode (Regla #1).
    const resolvedBrowserAllowlist = useMemo<string[]>(() => {
        const manual = browserProfiles.profiles.find((p) => p.id === activeParticipantId)?.allowlist;
        if (Array.isArray(manual) && manual.length) return manual;
        const defaultsByRole: Record<string, { allowlist?: string[] }> =
            FLU_CONFIG.browser?.defaultsByRole ?? {};
        const roleAllowlist = activeParticipant?.role
            ? defaultsByRole[activeParticipant.role]?.allowlist
            : undefined;
        if (Array.isArray(roleAllowlist) && roleAllowlist.length) return roleAllowlist;
        const defaultAllowlist = FLU_CONFIG.browser?.defaultProfile?.allowlist;
        if (Array.isArray(defaultAllowlist) && defaultAllowlist.length) return defaultAllowlist;
        return ['wikipedia.org', 'educ.ar'];
    }, [browserProfiles.profiles, activeParticipantId, activeParticipant]);
    // ---- Branding Inteligente por Temporalidad + Ecológico ----
    const branding = useEnhancedBranding();

    // ---- Ajustes · catálogos dinámicos (ambientes + paletas) extraído a hook ----
    const {
        ambientes,
        dynamicAmbienteIds,
        paletas,
        dynamicPaletaIds,
        handleActivateAmbiente,
        handleRegisterAmbiente,
        handleUpdateAmbiente,
        handleRemoveAmbiente,
        handleActivatePaleta,
        handleRegisterPaleta,
        handleUpdatePaleta,
        handleRemovePaleta,
    } = useCatalogsSettings({
        activeAmbienteId,
        languageRef,
        speakFluRef,
        branding,
    });

    // ---- Handlers para digitalización OCR (tutor experience) ----
    // These must be declared AFTER speakFlu is available.
    const processImageFile = useCallback(async (file: File) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            const mimeType = file.type;
            setUploadedImage({ dataUrl, mimeType, fileName: file.name });
            setIsAnalyzing(true);
            setUploadError(null);
            try {
                const profile = integrationStore.profile || 'tutor';
                const result = await geminiService.generateVisionAnalysis(
                    dataUrl.split(',')[1], // base64 without header
                    mimeType,
                    language,
                    profile
                );
                setHomeworkContext(result);

                // ── Fallback OCR local: si la visión no extrajo texto ──
                // Gemini devuelve texto_extraido vacío en fallo (no lanza), por lo
                // que el respaldo local (Tesseract, spa+eng) se dispara aquí y no
                // mediante try/catch. Sin hardcode: resuelve su config desde appConfig.
                if (!result.texto_extraido) {
                    try {
                        const ocr = await extractTextFromImage(dataUrl);
                        if (ocr.text) {
                            result.texto_extraido = ocr.text;
                        }
                    } catch (ocrErr) {
                        console.warn('[App] OCR fallback failed:', ocrErr);
                    }
                }

                // ── Adaptador de dominio (horario): SOLO propone si el texto
                //    parece un horario real (≥ minEntries). Documentos genéricos
                //    NO disparan importación (evita falsos positivos). La
                //    escritura requiere confirmación del usuario.
                if (result.texto_extraido) {
                    const proposal = scheduleAdapter.propose(result.texto_extraido);
                    if (proposal) {
                        setPendingHorarioImport(proposal.items);
                        // Muestra el horario en modo "Hoy" para que el usuario vea
                        // la confirmación del parseo junto a sus entradas del día.
                        setHorarioModo('dia');
                    }
                }

                // ── Tutor experience: FLU speaks proactively after analysis ──
                if (result.texto_extraido) {
                    // 1. El contexto entra al historial (única fuente de verdad); Gemini
                    //    lo ve por derivación del store, sin canal lateral.
                    const contextLabel = language === 'en'
                        ? `[Document context uploaded by user: ${result.texto_extraido}]`
                        : `[Contexto de documento subido por el usuario: ${result.texto_extraido}]`;
                    const entry = {
                        id: uuidv4(),
                        role: 'system' as const,
                        text: contextLabel,
                        timestamp: Date.now(),
                        speakerName: 'system',
                    };
                    integrationStore.addConversationEntry(entry);

                    // 2. Store analysis in workspaceArtifact for persistence across
                    //    conversation turns (so the Pizarrón tab shows the analysis
                    //    and Gemini can reference it via the workspace contract).
                    integrationStore.setWorkspaceArtifact({
                        id: uuidv4(),
                        respuesta: '',
                        titulo: result.materia || result.texto_extraido.slice(0, 60),
                        tipo: 'text',
                        contenido: result.texto_extraido,
                        puntos_clave: result.problemas.length > 0 ? result.problemas : (result.instrucciones ? [result.instrucciones] : []),
                        origen: 'ia',
                        timestamp: Date.now(),
                    });

                    // 3. FLU speaks proactively — message resolved from FLU_CONFIG.vision.visionGreeting.
                    //    Data-driven: template per profile (profesor, administrativo, estudiante) and language.
                    //    Placeholders: {materia}, {nivel}, {items} are replaced with actual analysis data.
                    const greetingCfg = FLU_CONFIG.vision?.visionGreeting;
                    const profileTemplates = greetingCfg?.[profile] || greetingCfg?.default || {};
                    const template = profileTemplates[language === 'en' ? 'en' : 'es'] || profileTemplates.es || '';
                    const itemsLabel = result.problemas.length > 0
                        ? (language === 'en' ? `I found ${result.problemas.length} items.` : `Encontré ${result.problemas.length} elementos.`)
                        : '';
                    const materiaLabel = result.materia
                        ? (language === 'en' ? `about ${result.materia}` : `sobre ${result.materia}`)
                        : '';
                    const nivelLabel = result.nivel
                        ? (language === 'en' ? `at ${result.nivel} level` : `de nivel ${result.nivel}`)
                        : '';
                    const greeting = template
                        .replace(/\{materia\}/g, materiaLabel)
                        .replace(/\{nivel\}/g, nivelLabel)
                        .replace(/\{items\}/g, itemsLabel)
                        .replace(/\s+/g, ' ')
                        .trim();
                    speakFlu(greeting, language);
                }
            } catch (err) {
                console.warn('[App] Vision analysis failed:', err);
                setUploadError(
                    pickLabel(
                        FLU_CONFIG.ui?.workspace?.uploadErrorImage,
                        language,
                        '⚠️ No se pudo leer la imagen. Verifica que sea un archivo JPG o PNG e inténtalo de nuevo.'
                    )
                );
            } finally {
                setIsAnalyzing(false);
            }
        };
        reader.readAsDataURL(file);
    }, [language, integrationStore, speakFlu]);

    const handleClearImage = useCallback(() => {
        setUploadedImage(null);
        setHomeworkContext(null);
        setIsAnalyzing(false);
        setUploadError(null);
    }, []);

    // ---- Gemini error state (OS2 parity: geminiError) ----
    // OS2 VoiceAssistantBar expects: { show: boolean, message: string, hint: string, detail: string }
    const [geminiError, setGeminiError] = useState<{ show: boolean; message: string; hint: string; detail: string }>({
        show: false,
        message: '',
        hint: '',
        detail: '',
    });

    // OS2 parity: auto-update geminiError from flu.error (FluShell.jsx lines 826-831)
    // resolveGeminiErrorPresentation checks hasGeminiFailureSignal and formats the error
    useEffect(() => {
        const errorStr = voiceError ? String(voiceError) : '';
        const result = resolveGeminiErrorPresentation({
            error: errorStr,
            diagnostics: null,
            lastErrorEvent: null,
            language,
        });
        setGeminiError(result);
    }, [voiceError, language]);

    // ---- Workspace image (extraído a hook) ----
    const workspaceImage = useWorkspaceImage(language);

    // Historial: registrar la IMAGEN generada como PUNTERO (su URL o data URL).
    // Se dispara cuando aparece una URL nueva; la misma URL no se re-registra.
    const lastHistoryImageRef = useRef<string>('');
    useEffect(() => {
        const url = workspaceImage.imageUrl;
        if (!url || lastHistoryImageRef.current === url) return;
        lastHistoryImageRef.current = url;
        const prompt = String(integrationStore.workspaceArtifact?.prompt_visual || '').trim();
        void documentHistory.add({
            kind: 'generated',
            formato: 'image',
            titulo: prompt.slice(0, 80) || 'Imagen',
            nombre: prompt.slice(0, 60) || 'imagen',
            ref: url,
        });
    }, [workspaceImage.imageUrl, integrationStore.workspaceArtifact, documentHistory]);

    // ---- Análisis de documentos (F1) / análisis de app (F2) / generación (F3/F4) ----
    const documentAnalysis = useDocumentAnalysis(language);
    const appAnalysis = useAppAnalysis(language);
    const documentGeneration = useDocumentGeneration(language);

    // RUTA ÚNICA de generación de medios (video/documento), idempotente por
    // comando. Es la única puerta: el contrato (workspace) y el comando de
    // navegación llaman acá; ya NO hay despacho de eventos GENERATE_*.
    requestMediaRef.current = (tipo, commandText, prepare) => {
        if (!mediaGateRef.current.shouldRun(tipo, commandText)) {
            relayLog(
                'WARN',
                'App',
                `requestMedia: ${tipo} repetido (mismo comando en ventana) → se omite generación (evita re-cobrar)`,
            );
            return false;
        }
        prepare?.();
        const state = useIntegrationStore.getState() as unknown as GenerationConversationSlice;
        const { tema, contenido } = buildGenerationTopic(state);
        const formato = tipo === 'doc' ? 'pdf' : 'video';
        // `doc` se genera como PDF (mismo comportamiento previo del bridge).
        // El historial se escribe al RESOLVER la generación para guardar el
        // CONTENIDO REAL (la carta/documento), no solo el tema de entrada.
        // Antes se guardaba `contenido` = insumo (≤1200 chars) y el texto de la
        // carta se perdía al limpiar/reiniciar: la carta no tenía hogar durable.
        void documentGeneration
            .generate(formato, {
                parametros: tema ? { tema } : {},
                contenido: contenido || undefined,
            })
            .then((generated) => {
                // Puntero al artefacto (lo que va al Historial): para video es la
                // URL real del mp4 (fal.ai/ffmpeg) expuesta en generationJob;
                // para documento/PDF es el data URL (va en `contenido`).
                const pointerUrl =
                    useIntegrationStore.getState().generationJob?.url_resultado || '';
                void documentHistory.add({
                    kind: 'generated',
                    formato,
                    titulo: tema || (formato === 'video' ? 'Video' : 'Documento'),
                    nombre: tema || formato,
                    contenido: generated?.content || contenido || '',
                    ref: pointerUrl || generated?.url || undefined,
                });
            });
        return true;
    };

    // Documento soportado → análisis F1 → INSUMO para la conversación.
    // Simétrico al flujo de imagen: el contexto del documento entra al historial
    // (única fuente de verdad) para que las respuestas siguientes lo usen.
    const processDocumentFile = useCallback(async (file: File) => {
        if (!file) return;
        const contract = await documentAnalysis.analyzeFile(file, language);
        // Historial: registrar el archivo CARGADO por el usuario.
        void documentHistory.add({
            kind: 'uploaded',
            formato: (file.name.split('.').pop() || 'file').toLowerCase(),
            titulo: file.name,
            nombre: file.name,
            mime: file.type,
            tamaño: file.size,
        });
        const insumo = buildDocumentInsumo(contract, language);
        if (!insumo) return;
        integrationStore.addConversationEntry({
            id: uuidv4(),
            role: 'system' as const,
            text: insumo,
            timestamp: Date.now(),
            speakerName: 'system',
        });
    }, [documentAnalysis, language, integrationStore, documentHistory]);

    // Ruta genérica de archivo: imagen → OCR (processImageFile); documento → análisis F1.
    const processAnyFile = useCallback(async (file: File) => {
        if (!file) return;
        if (file.type.startsWith('image/')) {
            await processImageFile(file);
            return;
        }
        if (isSupportedDocument(file)) {
            await processDocumentFile(file);
        } else {
            console.warn('[App] Tipo de archivo no soportado:', file.name, file.type);
        }
    }, [processImageFile, processDocumentFile]);

    const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) processAnyFile(file);
        // Reset input so same file can be re-selected
        e.target.value = '';
    }, [processAnyFile]);

    const handleFileDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) processAnyFile(file);
    }, [processAnyFile]);

    const handleDocumentFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) processDocumentFile(file);
        e.target.value = '';
    }, [processDocumentFile]);

    const handleProjectFolderSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        const first = files[0];
        const proyecto = first.webkitRelativePath?.split('/')[0] || first.name;
        const MAX_READ = 200;
        const MAX_FILE_BYTES = 200 * 1024;
        const paths: string[] = [];
        const contents: Record<string, string> = {};
        const readText = (f: File): Promise<string> =>
            new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => resolve('');
                reader.readAsText(f);
            });
        let reads = 0;
        for (const f of files) {
            if (reads >= MAX_READ) break;
            paths.push(f.webkitRelativePath || f.name);
            if (f.size <= MAX_FILE_BYTES) {
                contents[f.webkitRelativePath || f.name] = await readText(f);
                reads += 1;
            }
        }
        await appAnalysis.analyzeProject(proyecto, paths, contents, language);
        e.target.value = '';
    }, [appAnalysis, language]);

    // ---- Workspace · generación: puente de eventos doc/app/video (extraído a hook) ----
    const { docInputRef, projectInputRef } = useDocumentGenerationBridge({
        generation: documentGeneration,
    });

    // ---- Auto-save session state on changes ----
    useSessionPersistence({
        activeTab,
        language,
        sessionRole,
        expandedFrameId,
        selectedMinuteId,
        participantPhase: fluParticipantPresentation.phase,
        participantTurnCount: 0,
        workspaceImageExpanded: workspaceImage.isExpanded,
    });

    // ---- Sync minutes from DB to store on mount ----
    useEffect(() => {
        if (minuteKnowledge.minutes.length > 0) {
            // Sync from DB to store if store is empty
            if (integrationStore.minuteHistory.length === 0) {
                minuteKnowledge.minutes.forEach((m) => {
                    // m is MinuteUIEntry with summarySnapshot nested
                    integrationStore.addMinute(m);
                });
            }
        }
    }, [minuteKnowledge.minutes.length]);

    // ---- Handlers ----


    const handleParticipantConfigChange = useCallback((overrides: Record<string, unknown>) => {
        const prev = participantConfig;
        const newConfig = setFluParticipantOverrides(overrides);
        setParticipantConfig(newConfig);
        // Audit log
        auditLog.logChange('config', 'flu-participant', prev, newConfig, 'Participant config updated').catch(console.error);
    }, [participantConfig, auditLog]);

    const handleSearchConfigChange = useCallback((next: SearchConfigOverrides | ((prev: SearchConfigOverrides) => SearchConfigOverrides)) => {
        const prev = searchOverridesRef.current;
        const resolved = typeof next === 'function' ? next(prev) : next;
        searchOverridesRef.current = resolved;
        setSearchOverrides(resolved);
        saveSearchConfigOverrides(resolved);
        // Audit log
        auditLog.logChange('config', 'search', prev, resolved, 'Search config updated').catch(console.error);
    }, [auditLog]);

    const handleSearchConfigReset = useCallback(() => {
        const prev = searchOverridesRef.current;
        searchOverridesRef.current = {};
        clearSearchConfigOverrides();
        setSearchOverrides({});
        // Audit log
        auditLog.logChange('config', 'search', prev, {}, 'Search config reset to defaults').catch(console.error);
    }, [auditLog]);

    const _handleParticipantReset = useCallback(() => {
        const prev = participantConfig;
        const defaults = resetFluParticipantOverrides();
        setParticipantConfig(defaults);
        // Audit log
        auditLog.logChange('config', 'flu-participant', prev, defaults, 'Participant config reset to defaults').catch(console.error);
    }, [participantConfig, auditLog]);

    const _handleToggleAutoCycle = useCallback(() => {
        integrationStore.setConfig({ autoCycle: !integrationStore.config.autoCycle });
    }, [integrationStore]);

    const _handleTogglePushToTalk = useCallback(() => {
        integrationStore.setConfig({ pushToTalk: !integrationStore.config.pushToTalk });
    }, [integrationStore]);

    const _handleReset = useCallback(() => {
        integrationStore.reset();
        setMinuteDraft(null);
        setSelectedMinuteId(null);
        fluParticipant.resetParticipant();
        // OS2 parity: clear workspace image URL
        workspaceImage.clear();
        setGeminiError({ show: false, message: '', hint: '', detail: '' });
        // OS2 parity: reset conversation session (FluShell.jsx line 1154-1176)
        os2ResetConversationSession?.();
    }, [integrationStore, os2ResetConversationSession, fluParticipant, workspaceImage]);
// ---- Minute handlers (extraído a hook) ----
const minuteHandlers = useMinuteHandlers({
    integrationStore,
    minuteKnowledge,
    auditLog,
    language,
    apiKey,
    sessionRole,
    voiceStatus,
    minuteDraft,
    setMinuteDraft,
    setSelectedMinuteId,
    os2StartListening,
    os2StopListening,
    getCommandSpeech,
});
const {
    isSummarizing,
    handleGenerateSummary,
    handleSaveMinute,
    handleSaveConversationSummary,
    handleSelectMinuteHistory,
} = minuteHandlers;

    // ============================================================
    // §2 Corte por día: si al iniciar quedó conversación de un día anterior sin
    // cerrar, se genera su minuta (queda archivada) y se marca el día nuevo para
    // que arranque limpio y no se mezcle con el anterior.
    // ============================================================
    const dayRolloverDoneRef = useRef(false);
    useEffect(() => {
        if (dayRolloverDoneRef.current) return;
        const history = integrationStore.conversationHistory;
        if (!history.length) return; // aún no cargó: se reevalúa al hidratar
        const lastAt = Number(history[history.length - 1]?.timestamp) || 0;
        let lastSessionDay = '';
        try {
            lastSessionDay = window.localStorage.getItem(STORAGE_KEYS.LAST_SESSION_DAY) || '';
        } catch {
            lastSessionDay = '';
        }
        dayRolloverDoneRef.current = true;
        if (shouldRolloverDay(lastAt, Date.now(), lastSessionDay)) {
            relayLog(
                'WARN',
                'App',
                `rollover de día: minuta del día anterior + inicio limpio (last=${dayKey(lastAt)})`,
            );
            void handleGenerateSummary({ announce: false });
        }
        try {
            window.localStorage.setItem(STORAGE_KEYS.LAST_SESSION_DAY, dayKey(Date.now()));
        } catch {
            /* ignorar */
        }
    }, [integrationStore.conversationHistory, handleGenerateSummary]);

    // ============================================================
    // Paso 6: guardar el resumen de conversación UNA vez al cerrar
    // la app (pagehide) como conocimiento de tipo 'conversacion'.
    // ============================================================
    const conversationSummarySavedRef = useRef(false);
    useEffect(() => {
        const onPageHide = () => {
            if (conversationSummarySavedRef.current) return;
            conversationSummarySavedRef.current = true;
            // No bloquear el cierre: disparar en background y capturar errores.
            handleSaveConversationSummary({ announce: false }).catch((err) => {
                console.warn('[App] Conversation summary save on close failed:', err);
            });
        };
        window.addEventListener('pagehide', onPageHide);
        return () => window.removeEventListener('pagehide', onPageHide);
    }, [handleSaveConversationSummary]);

    // ============================================================
    // OS2 parity: handleToggleListening (Gap D)
    // FluShell.jsx lines 1017-1031: handleToggleListening
    // ============================================================
    const handleToggleListening = useCallback(async () => {
        if (voiceStatus === 'processing') return;

        if (voiceStatus === 'listening') {
            // OS2 parity: conversationActiveRef.current = false on close (FluShell.jsx line 1021)
            conversationActiveRef.current = false;
            
            // Solo cancelar si realmente hay speech activo y es necesario
            const synth = window.speechSynthesis;
            if (synth && (synth.speaking || synth.pending)) {
                // En lugar de cancelar inmediatamente, esperar un momento breve
                // para permitir que la animación de boca termine naturalmente
                synth.cancel();
                // Pequeña pausa para permitir transición de estado
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            const commandSpeech = getCommandSpeech('CERRAR_ESCUCHA', language);
            if (commandSpeech) {
                try {
                    await speakResponse(commandSpeech, language);
                } catch (speechErr) {
                    console.warn('[App] CERRAR_ESCUCHA speech failed:', speechErr);
                }
            }
            await os2StopListening({ closing: true });
            return;
        }

        // OS2 parity: conversationActiveRef.current = true on open (FluShell.jsx line 1030 via openListeningSession)
        conversationActiveRef.current = true;
        
        // Solo cancelar si realmente hay speech activo
        const synth = window.speechSynthesis;
        if (synth && (synth.speaking || synth.pending)) {
            synth.cancel();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        const commandSpeech = getCommandSpeech('ABRIR_ESCUCHA', language);
        if (commandSpeech) {
            try {
                await speakResponse(commandSpeech, language);
            } catch (speechErr) {
                console.warn('[App] ABRIR_ESCUCHA speech failed:', speechErr);
            }
        }
        await os2StartListening({ resume: true });
    }, [voiceStatus, language, os2StartListening, os2StopListening]);

    // ============================================================
    // OS2 parity: handleStartConversation (Gap E)
    // FluShell.jsx lines 989-1015: beginConversationSession
    // ============================================================
    const handleStartConversation = useCallback(async ({ announce = false }: { announce?: boolean } = {}) => {
        if (announce) {
            // Solo cancelar si realmente hay speech activo
            const synth = window.speechSynthesis;
            if (synth && (synth.speaking || synth.pending)) {
                synth.cancel();
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            const commandSpeech = getCommandSpeech('INICIAR_CONVERSACION', language);
            if (commandSpeech) {
                try {
                    await speakResponse(commandSpeech, language);
                } catch (speechErr) {
                    console.warn('[App] INICIAR_CONVERSACION speech failed:', speechErr);
                }
            }
        }

        const wasListening = voiceStatus === 'listening';
        integrationStore.resetConversationHistory();
        auditLog.clearAll().catch(console.error);

        // OS2 parity: conversationActiveRef.current = true (FluShell.jsx line 999)
        conversationActiveRef.current = true;

        if (wasListening) {
            await os2StopListening({ closing: false }).catch((err) => console.warn('[App] fallo al detener la escucha:', err));
            await os2StartListening({ resume: true }).catch((err) => console.warn('[App] fallo al reiniciar la escucha:', err));
            return;
        }

        await os2StartListening({ resume: true }).catch((err) => console.warn('[App] fallo al reiniciar la escucha:', err));
    }, [language, voiceStatus, integrationStore, auditLog, os2StartListening, os2StopListening]);

    // ============================================================
    // OS2 parity: handleRemoveParticipant (Gap G)
    // FluShell.jsx lines 1216-1232: handleRemoveParticipant
    // ============================================================
    const handleRemoveParticipant = useCallback(async (row: VoiceProfileRow) => {
        const label = String(row?.label || '').trim();
        if (!label) return;

        // 1) Perfil de voz (flu-os3 DB) — borrado físico, no solo lógico.
        //    removeProfile() hace borrado lógico (sync.deleted=true); aquí lo
        //    eliminamos de verdad para que no reaparezca tras un refresh.
        if (row.profileId) {
            await voiceProfiles.removeProfile(row.profileId);
            await fluDb.voiceProfiles.delete(row.profileId).catch(console.error);
        } else {
            // Sin profileId (p.ej. "conejo" que nunca tuvo perfil): borrar por label.
            const orphan = await fluDb.voiceProfiles
                .where('label')
                .equals(label)
                .first()
                .catch(() => undefined);
            if (orphan) {
                await fluDb.voiceProfiles.delete(orphan.id).catch(console.error);
            }
        }

        // 2) Historial de conversación en memoria (Zustand) — quitar entradas del hablante.
        integrationStore.removeConversationEntriesBySpeaker(label);

        // 3) Filas de conversación persistidas en fluDb.conversations (flu-os3 DB).
        //    Esta es la causa raíz de que "conejo" reaparezca al recargar:
        //    useConversationPersistence las restaura vía batchLoadHistory.
        //    entryToRow mapea speakerId = speakerName para entradas de usuario,
        //    así que el índice 'speakerId' cubre las filas del hablante.
        await fluDb.conversations
            .where('speakerId')
            .equals(label)
            .delete()
            .catch(console.error);
        // Barrido defensivo para filas legacy cuyo speakerId quedó en 'usuario'
        // pero speakerName coincide con el label (speakerName no es índice).
        const legacyRows = await fluDb.conversations
            .filter((r) => String(r?.speakerName || '').trim() === label)
            .primaryKeys()
            .catch(() => [] as string[]);
        if (legacyRows.length > 0) {
            await fluDb.conversations.bulkDelete(legacyRows).catch(console.error);
        }

        // 4) Perfil de voz en la DB de voz local (flu-voz-local) — borrado físico.
        const localProfile = await findVoiceProfileByLabel(label).catch(() => null);
        if (localProfile?.id) {
            await deleteVoiceProfile(localProfile.id).catch(console.error);
        }

        // 5) Speaker de sesión en memoria (diarización) + auditoría.
        os2RemoveSessionSpeaker(label);
        // OS2 parity: delete audit logs for the removed speaker (FluShell.jsx lines 1226-1228)
        deleteAuditLogsBySpeaker(label).catch(console.error);
        auditLog.logEvent('participant:removed', 'config', uuidv4(), {
            label,
        }, 'Participant removed').catch(console.error);

        // 6) Registro multiusuario homónimo (Dexie participants + onboarding).
        //    Causa raíz de "borré ratón/conejo y sigue apareciendo en el
        //    onboarding": este panel borra el PERFIL DE VOZ pero NO la fila del
        //    registro multiusuario (la que alimenta las sugerencias del nombre y
        //    la activación). Si existe un participante con el mismo nombre se
        //    elimina también de verdad y, si era el usuario activo, se sale a la
        //    ruta legacy limpiando ACTIVE_USER/estado legacy.
        const participantMatch = participants.participants.find(
            (p) => p.name.trim().toLowerCase() === label.trim().toLowerCase(),
        );
        if (participantMatch) {
            await participants.remove(participantMatch.id);
            if (activeParticipantId === participantMatch.id) {
                setActiveUser(undefined);
                setActiveParticipantId(undefined);
                if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
                    window.localStorage.removeItem(STORAGE_KEYS.ONBOARDING_STEP);
                    if (onboarding.config.nameKey)
                        window.localStorage.removeItem(onboarding.config.nameKey);
                }
                onboarding.reset();
            }
        }
    }, [
        voiceProfiles,
        integrationStore,
        os2RemoveSessionSpeaker,
        auditLog,
        participants,
        activeParticipantId,
        onboarding,
        setActiveUser,
        setActiveParticipantId,
    ]);

    // ============================================================
    // OS2 parity: handleRenameProfile (Gap H)
    // FluShell.jsx lines 1196-1214: handleRenameVoiceProfile
    // ============================================================
    const handleRenameProfile = useCallback(async (profileId: string, label: string) => {
        const saved: unknown = await voiceProfiles.renameProfile(profileId, label);
        if (!saved || typeof saved !== 'object' || !('label' in saved) || !saved.label) return;
        const savedLabel = String(saved.label);

        os2RenameSessionSpeaker(
            String(voiceProfiles.profiles.find((p) => p.id === profileId)?.label || '').trim(),
            savedLabel,
        );
        auditLog.logEvent('profile:renamed', 'config', uuidv4(), {
            profileId,
            newLabel: savedLabel,
        }, 'Voice profile renamed').catch(console.error);
    }, [voiceProfiles, os2RenameSessionSpeaker, auditLog]);

    // ============================================================
    // OS2 parity: listenParity (Gap A)
    // ============================================================
    const listenParity = useMemo(() => {
        const history = integrationStore.conversationHistory;
        const lastLog = history.length > 0 ? history[history.length - 1]?.text || '' : '';
        // §9.3: la normalización/derivación de paridad vive en la lib única
        // (evaluateListenParity). App no re-normaliza inline.
        const parity = evaluateListenParity({ live: liveTranscript || '', lastLog });
        if (parity.level !== 'warn') return null;
        return { level: 'info', message: parity.message };
    }, [liveTranscript, integrationStore.conversationHistory]);

    // ============================================================
    // §9.3: ÚNICA derivación de la frase visible. Avatar, bitácora y barra
    // consumen esta MISMA cadena; ningún consumidor la re-deriva.
    // ============================================================
    const visiblePhrase = useMemo(() => selectVisiblePhrase({
        live: liveTranscript,
        lastTranscript,
        lastUserText: avatarLastUserText,
        currentTranscript: integrationStore.currentTranscript,
    }), [liveTranscript, lastTranscript, avatarLastUserText, integrationStore.currentTranscript]);

    // ============================================================
    // OS2 parity: latestResponse (Gap C)
    // Filtra el mensaje de bienvenida por defecto de FLU
    //       para que nunca aparezca en el campo de respuesta.
    // Usa WELCOME_MESSAGE desde appConfig (Rule #1: NO HARDCODE)
    // Selecciona el idioma según la configuración actual del usuario
    // ============================================================
    const welcomeText = language === 'en' ? WELCOME_MESSAGE.en : WELCOME_MESSAGE.es;
    // Frases de acuse transitorias (p. ej. "Preparando el video.") que FLU
    // dice al reconocer un comando, pero que NO son una respuesta sustantiva.
    // Se excluyen del campo de Respuesta para que, tras recargar la página,
    // no quede un acuse de procesamiento como si fuera la última respuesta.
    // Provienen de FLU_CONFIG.ui.commandSpeech (Rule #1: NO HARDCODE).
    const transientAckPhrases = useMemo(() => {
        const set = new Set<string>();
        const speech = FLU_CONFIG.ui?.commandSpeech;
        if (speech && typeof speech === 'object') {
            Object.values(speech).forEach((phrase) => {
                if (phrase && typeof phrase === 'object') {
                    if (phrase.es) set.add(phrase.es);
                    if (phrase.en) set.add(phrase.en);
                } else if (typeof phrase === 'string' && phrase) {
                    set.add(phrase);
                }
            });
        }
        return set;
    }, []);
    const latestResponse = useMemo(() => {
        const isTransient = (text: string) => !text || text === welcomeText || transientAckPhrases.has(text);
        const lastResp = integrationStore.lastResponse;
        if (lastResp && !isTransient(lastResp)) {
            // Respuesta sustantiva en vivo: marcamos que FLU ya respondió en esta
            // carga de página (habilita el puente transitorio del historial).
            hasLiveResponseRef.current = true;
            return lastResp;
        }
        // Si FLU aún no ha respondido en ESTA carga de página (p. ej. tras un
        // reload, donde lastResponse no se persiste), NO resucitar una respuesta
        // vieja del historial persistido en IndexedDB. La pestaña «respuesta»
        // debe quedar vacía hasta que FLU vuelva a hablar.
        if (!hasLiveResponseRef.current) return '';
        // Puente transitorio: dentro de una sesión activa, si la última respuesta
        // fue un acuse transitorio (p. ej. "Preparando el video."), seguimos
        // mostrando la última respuesta sustantiva del historial.
        const history = integrationStore.conversationHistory;
        for (let i = history.length - 1; i >= 0; i--) {
            const entry = history[i];
            if (entry.role === 'flu' || entry.speakerName === 'FLU') {
                const text = entry.text || '';
                if (!isTransient(text)) return text;
            }
        }
        return '';
    }, [integrationStore.lastResponse, integrationStore.conversationHistory, welcomeText, transientAckPhrases]);

    // ============================================================
    // OS2 parity: knowledgeBaseLabel
    // ============================================================
    const knowledgeBaseLabel = useMemo(() => {
        return activeKnowledgeBase === 'minutes'
            ? FLU_CONFIG.knowledgeBase?.minutes || 'Minutas'
            : FLU_CONFIG.knowledgeBase?.general || 'General';
    }, [activeKnowledgeBase]);

    // ============================================================
    // STT Source Label — computed for FluAvatarVoiceBridge chip
    // ============================================================
    const sttSourceLabel = useMemo(() => {
        // OS2 parity: show STT source chip only when actually listening.
        // When not listening, formatStreamSttUiStatus returns "STT off" which is filtered out
        // by the conditional rendering below (sttUi.label ? ...).
        const sttUi = formatStreamSttUiStatus('', {
            listening: voiceStatus === 'listening',
        });
        return sttUi.label || null;
    }, [voiceStatus]);

    // ============================================================
    // OS2 parity: handleGenerateSummary wrapper for events
    // ============================================================
    useEffect(() => {
        const handler = () => { handleGenerateSummary({ announce: true }); };
        return onFluEvent(FLU_EVENTS.GENERATE_SUMMARY, handler);
    }, [handleGenerateSummary]);

    // ============================================================
    // OS2 parity: handleSaveMinute wrapper for events
    // ============================================================
    useEffect(() => {
        const handler = () => { handleSaveMinute(); };
        return onFluEvent(FLU_EVENTS.SAVE_MINUTE, handler);
    }, [handleSaveMinute]);

    // ============================================================
    // Memoized participants list for VoiceProfilesPanel
    // Avoids recomputing on every render (forEach + map + find over
    // conversationHistory and voiceProfiles).
    // ============================================================
    const voiceParticipants = useMemo(() => {
        const historyLabels = new Set<string>();
        const history = integrationStore.conversationHistory;
        for (let i = 0; i < history.length; i++) {
            const e = history[i];
            const label = e.speakerName || e.role || '';
            if (label) historyLabels.add(label);
        }
        const profiles = voiceProfiles.profiles;
        const profileLabels = new Set<string>();
        for (let i = 0; i < profiles.length; i++) {
            const p = profiles[i];
            if (p.label) profileLabels.add(p.label);
        }
        const allLabels = new Set([...historyLabels, ...profileLabels]);
        const result: { label: string; profileId: string | undefined }[] = [];
        for (const label of allLabels) {
            let profileId: string | undefined;
            for (let i = 0; i < profiles.length; i++) {
                const p = profiles[i];
                if (p.label === label) {
                    profileId = p.id || undefined;
                    break;
                }
            }
            result.push({ label, profileId });
        }
        return result;
    }, [integrationStore.conversationHistory, voiceProfiles.profiles]);

    // ============================================================
    // Render
    // ============================================================

    return (
        <ErrorBoundary>
            <main className="flu-shell">
                {/* ── Header / Branding + Status Chips ── */}
                <header className="app-header">
                    <div className="app-header-left">
                        <span className="app-title-icon">{APP_BRANDING.ICON}</span>
                        <span className="app-title">{APP_BRANDING.NAME}</span>
                        <span className="app-title-badge">{APP_BRANDING.VERSION}</span>
                    </div>
                    <div className="app-header-right">
                        <div className="app-header-chips">
                            <div className={[
                                'voice-state-chip',
                                voiceStatus === 'listening' ? 'is-listening' : '',
                                voiceStatus === 'processing' ? 'is-processing' : '',
                                (!voiceStatus || voiceStatus === 'idle') ? 'is-stopped' : '',
                            ].filter(Boolean).join(' ')}>
                                <span className="voice-state-chip__dot" />
                                <span>{voiceStatus === 'listening' ? 'Escuchando' : voiceStatus === 'processing' ? 'Procesando' : 'Detenido'}</span>
                            </div>
                            {knowledgeBaseLabel ? (
                                <div className="voice-state-chip knowledge-base-chip">
                                    <span className="voice-state-chip__dot" />
                                    <span>{knowledgeBaseLabel}</span>
                                </div>
                            ) : null}
                            {sttSourceLabel ? (
                                <div className="voice-state-chip voice-state-chip--stream voice-state-chip--stream-ok">
                                    <span className="voice-state-chip__dot" />
                                    <span>{sttSourceLabel}</span>
                                </div>
                            ) : null}
                            <div
                                className="voice-state-chip"
                                style={{ background: '#7c3aed22', color: '#7c3aed', borderColor: '#7c3aed55' }}
                                title="Expresión semántica activa en el avatar"
                            >
                                <span className="voice-state-chip__dot" style={{ background: '#7c3aed' }} />
                                <span>🔲 {avatarCurrentExpression || '---'}</span>
                            </div>
                            <div
                                className="voice-state-chip"
                                style={{ background: '#0ea5e922', color: '#0369a1', borderColor: '#0ea5e955' }}
                                title="Animación física activa en el avatar"
                            >
                                <span className="voice-state-chip__dot" style={{ background: '#0ea5e9' }} />
                                <span>🔺 {avatarCurrentAnimation || (avatarBlendQueue.length > 0 ? avatarBlendQueue.join(' + ') : '---')}</span>
                            </div>
                        </div>
                        <div className="app-header-session-info">
                            <div className="session-chip">
                                <span className="session-chip__icon">🌐</span>
                                <span className="session-chip__label">Idioma</span>
                                <select aria-label="Idioma" value={language} onChange={(e) => setLanguage(e.target.value as 'es' | 'en' | 'both')}>
                                    <option value="both">Ambos</option>
                                    <option value="es">Español</option>
                                    <option value="en">Inglés</option>
                                </select>
                            </div>
                            <div className="session-chip">
                                <span className="session-chip__icon">👤</span>
                                <span className="session-chip__label">Perfil</span>
                                <select
                                    aria-label="Perfil"
                                    value={integrationStore.profile}
                                    onChange={(e) => {
                                        integrationStore.applyProfile(e.target.value as FluProfile);
                                        // No recargar la página — el store de Zustand persiste y
                                        // los componentes reaccionan al cambio de perfil vía suscripción.
                                        // El perfil se persiste automáticamente por el middleware persist.
                                    }}
                                >
                                    {FLU_PROFILES.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.id === 'profesor' ? 'Asistente del Maestro' : p.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="session-chip">
                                <span className="session-chip__icon">🧑</span>
                                <span className="session-chip__label">Usuario</span>
                                <select
                                    aria-label={userPickerConfig.title || 'Elegir usuario'}
                                    value={
                                        participants.participants.some((p) => p.id === activeParticipantId)
                                            ? activeParticipantId
                                            : ''
                                    }
                                    onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                            handleCreateNewProfile();
                                        } else if (e.target.value) {
                                            handleSelectActiveUser(e.target.value);
                                        }
                                    }}
                                    data-testid="user-picker-select"
                                >
                                    <option value="">
                                        {activeParticipantName || userPickerConfig.selectPlaceholder || 'Elegir usuario'}
                                    </option>
                                    {participants.participants.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                            {p.role ? ` · ${p.role}` : ''}
                                        </option>
                                    ))}
                                    <option value="__new__">
                                        {userPickerConfig.createShortLabel || '+ Nuevo'}
                                    </option>
                                </select>
                                {participants.participants.some((p) => p.id === activeParticipantId) && (
                                    <button
                                        type="button"
                                        className="session-chip__button session-chip__button--remove"
                                        onClick={handleRemoveActiveUser}
                                        data-testid="user-picker-remove"
                                        aria-label={userPickerConfig.removeLabel || 'Borrar usuario'}
                                        title={userPickerConfig.removeLabel || 'Borrar usuario'}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        </div>
                        <NotificationCenterBell
                            items={notificationCenter.history}
                            unread={notificationCenter.unread}
                            onMarkAllRead={notificationCenter.markAllRead}
                            onClear={notificationCenter.clear}
                            language={language}
                        />
                    </div>
                </header>

                {/* ── OS3 Hero Header: VoiceAssistantBar (full OS3 parity) ── */}
                <header className="flu-shell__hero flu-branding-scope">
                    <VoiceAssistantBarWrapper {...({
                        status: voiceStatus || 'idle',
                        geminiError: geminiError.show ? geminiError : null,
                        listeningAck,
                        listenParity,
                        onToggle: handleToggleListening,
                        onStartConversation: () => handleStartConversation({ announce: true }),
                        isSupported,
                        knowledgeBaseLabel,
                        participantEnabled: isFluParticipantEnabled(),
                        fluParticipantPresentation,
                        fluParticipantCanGrant: fluParticipantPresentation?.tone === 'raised',
                        onFluParticipa: async () => {
                            if (fluParticipantPresentation?.tone !== 'raised') {
                                await fluParticipant.evaluateOnDemand();
                            }
                            if (!fluParticipant.canAcceptFloorGrant()) return;
                            if (fluParticipant.shouldIgnoreDuplicateFloorGrant()) return;
                            const draft = fluParticipant.consumeRaisedDraft();
                            if (!draft) return;
                            fluParticipant.beginFloorDelivery();
                            try {
                                await speakResponse(draft, language);
                            } catch (err) {
                                console.warn('[App] speakResponse failed for participant draft:', err);
                            }
                            fluParticipant.endFloorDelivery();
                            fluParticipant.recordInterventionDelivered();
                        },
                    })} />
                </header>

                {/* ── OS3 Browser: Avatar Column + Tabs ── */}
                <div className="flu-shell__browser">
                    <div className="app-main">
                        {/* Avatar Column (left) */}
                        <div className="app-avatar-column flu-branding-scope">
                            <FluBridgeProvider value={{
                                voiceStatus,
                                voiceError,
                                liveTranscript,
                                lastTranscript,
                                onStartListening: os2StartListening,
                                onStopListening: os2StopListening,
                                onToggleListening: handleToggleListening,
                                onParticipantEmotionRef: participantEmotionRef,
                                onContextualEmotionRef: contextualEmotionRef,
                                onEmotionAnimsRef: emotionAnimsRef,
                                apiKey,
                                language,
                                welcomeMessage: '',
                                onStateChange: setCurrentState,
                                onGeminiError: (error: string | null) => {
                                    if (error) {
                                        // Errores de reconocimiento RECUPERABLES (network/
                                        // no-speech/aborted): se reintentan solos. NO ocupan
                                        // la barra (solo consola) para no robar espacio.
                                        const code = String(error).split(':').pop()?.trim() || '';
                                        if (
                                            /^Error de reconocimiento:/i.test(String(error)) &&
                                            isRecoverableRecognitionError(code, true)
                                        ) {
                                            console.warn(
                                                '[App] error de reconocimiento recuperable (no se muestra):',
                                                error,
                                            );
                                            setGeminiError({ show: false, message: '', hint: '', detail: '' });
                                            return;
                                        }
                                        setGeminiError({ show: true, message: error, hint: '', detail: '' });
                                    } else {
                                        setGeminiError({ show: false, message: '', hint: '', detail: '' });
                                    }
                                },
                            }}>
                                 <FluAvatarVoiceBridge
                                     height="100%"
                                     width="100%"
                                     visiblePhrase={visiblePhrase}
                                     // ---- Branding Inteligente por Temporalidad ----
                                    brandingMode={branding.config.mode}
                                    brandingSeason={branding.config.activeSeason}
                                    brandingIsBirthday={branding.isBirthday}
                                    brandingCelebrandoA={branding.celebrandoA}
                                />
                            </FluBridgeProvider>
                            {/* ── Efectos de temporada (solo sobre el avatar; NO toca el pizarrón) ── */}
                            <SeasonalEffects
                                season={branding.isEcologicalBranding ? 'ecologico' : branding.config.activeSeason}
                                enabled={branding.config.mode !== 'disabled'}
                            />
                        </div>

                        {/* Panels Column (right) */}
                        <div className="app-panels-column">
                            <FluShellTabs activeTab={activeTab} onTabChange={changeTab} visibleIds={visibleTabIds} />

                            <div className="flu-shell__tab-content">
                                <Suspense fallback={null}>
                                {/* Pizarron Tab (renamed from Workspace) */}
                                <FluWorkspaceTabView
                                    activeTab={activeTab}
                                    expandedFrameId={expandedFrameId}
                                    onToggleExpand={handleToggleExpand}
                                    hub={{
                                        searchAllowlist: resolvedBrowserAllowlist,
                                        searchOverrides,
                                        workspaceArtifact: integrationStore.workspaceArtifact,
                                        latestResponse,
                                        livePhrase: visiblePhrase,
                                        isListening: voiceStatus === 'listening',
                                        homeworkContext,
                                        image: workspaceImage,
                                        document: {
                                            isAnalyzing: documentAnalysis.isAnalyzing,
                                            error: documentAnalysis.error,
                                            warnings: documentAnalysis.warnings,
                                            artifact: integrationStore.documentArtifact,
                                            clear: documentAnalysis.clear,
                                        },
                                        app: {
                                            isAnalyzing: appAnalysis.isAnalyzing,
                                            error: appAnalysis.error,
                                            artifact: integrationStore.appAnalysisArtifact,
                                            clear: appAnalysis.clear,
                                        },
                                        generation: {
                                            isGenerating: documentGeneration.isGenerating,
                                            error: documentGeneration.error,
                                            job: integrationStore.generationJob,
                                            result: documentGeneration.result,
                                            videoResult: documentGeneration.videoResult,
                                            clear: documentGeneration.clear,
                                        },
                                        // Historial por usuario (punteros a artefactos
                                        // generados/cargados) → pestaña "Historial" del Pizarrón.
                                        documents: {
                                            documents: documentHistory.documents,
                                            loading: documentHistory.loading,
                                            onRemove: (id) => {
                                                void documentHistory.remove(id);
                                            },
                                            language,
                                        },
                                        turnFocus,
                                        horarioImport: {
                                            pending: pendingHorarioImport,
                                            busy: horarioImportBusy,
                                            onConfirm: confirmHorarioImport,
                                            onCancel: cancelHorarioImport,
                                        },
                                        upload: {
                                            uploadedImage,
                                            isAnalyzing,
                                            error: uploadError,
                                            fileInputRef,
                                            docInputRef,
                                            projectInputRef,
                                            onFileDrop: handleFileDrop,
                                            onFileSelected: handleFileSelected,
                                            onDocumentFileSelected: handleDocumentFileSelected,
                                            onProjectFolderSelected: handleProjectFolderSelected,
                                            onClearImage: handleClearImage,
                                        },
                                        hoy: {
                                            horario: {
                                                items: horario.horario,
                                                loading: horario.loading,
                                                modo: horarioModo,
                                                onModoChange: setHorarioModo,
                                                onAdd: async (input) => horario.add(input),
                                                onRemove: async (id) => {
                                                    await horario.remove(id);
                                                },
                                                onEdit: async (id, materia) => {
                                                    await horario.update(id, { materia });
                                                },
                                            },
                                            diary: {
                                                entries: diary.entries,
                                                loading: diary.loading,
                                            },
                                            notes: {
                                                notes: notes.notes,
                                                loading: notes.loading,
                                                onToggle: async (id) => notes.toggle(id),
                                                onRemove: async (id) => notes.remove(id),
                                                onRename: async (id, label) => notes.rename(id, label),
                                            },
                                            reminders: {
                                                items: reminders.reminders,
                                                loading: reminders.loading,
                                                onRemove: async (id) => {
                                                    await reminders.remove(id);
                                                },
                                                onEdit: async (id, text) => {
                                                    await reminders.update(id, { text });
                                                },
                                            },
                                            temporals: {
                                                alarms: temporals.alarms,
                                                timers: temporals.timers,
                                                loading: temporals.loading,
                                                onCancel: async (id) => {
                                                    await temporals.cancel(id);
                                                },
                                                onEdit: async (id, patch) => {
                                                    await temporals.update(id, patch);
                                                },
                                                ringing: temporals.ringing,
                                                onStopRinging: () => temporals.stopRinging(),
                                            },
                                            language,
                                        },
                                        language,
                                    }}
                                />

                            {/* Conversation Tab */}
                            <FluConversationTabView
                                activeTab={activeTab}
                                expandedFrameId={expandedFrameId}
                                onToggleExpand={handleToggleExpand}
                                visiblePhrase={visiblePhrase}
                                conversationHistory={integrationStore.conversationHistory}
                                voiceParticipants={voiceParticipants}
                                onRenameProfile={handleRenameProfile}
                                onRemoveParticipant={handleRemoveParticipant}
                            />

                            {/* Minutes Tab */}
                            <FluMinutesTabView
                                activeTab={activeTab}
                                expandedFrameId={expandedFrameId}
                                onToggleExpand={handleToggleExpand}
                                isSupported={isSupported}
                                isSummarizing={isSummarizing}
                                onGenerateSummary={handleGenerateSummary}
                                draft={minuteDraft}
                                onDraftChange={setMinuteDraft}
                                onSaveMinute={handleSaveMinute}
                                minutePanelRef={minutePanelRef}
                                history={minuteKnowledge.minutes}
                                selectedId={selectedMinuteId}
                                onSelect={handleSelectMinuteHistory}
                            />

                            {/* Settings Tab — OS2 parity structure */}
                            <FluSettingsTabView
                                activeTab={activeTab}
                                expandedFrameId={expandedFrameId}
                                onToggleExpand={handleToggleExpand}
                                group={settingsGroup}
                                onGroupChange={setSettingsGroup}
                                flu={{
                                    language,
                                    apiKey,
                                    textModel,
                                    textApiUrl,
                                    geminiApiKey,
                                    imageModel,
                                    imageApiKey,
                                    imageApiUrl,
                                    falApiKey,
                                    falVideoModel,
                                    ocrApiKey,
                                    ocrModel,
                                    ocrApiUrl,
                                    voices,
                                    handleTextModelCommit,
                                    handleTextApiKeyCommit,
                                    handleTextApiUrlCommit,
                                    handleGeminiApiKeyCommit,
                                    handleImageModelCommit,
                                    handleImageApiKeyCommit,
                                    handleImageApiUrlCommit,
                                    handleFalApiKeyCommit,
                                    handleFalVideoModelCommit,
                                    handleOcrApiKeyCommit,
                                    handleOcrModelCommit,
                                    handleOcrApiUrlCommit,
                                    onClearCache: handleClearCache,
                                    wakeWords,
                                    setWakeWords,
                                    debugLogsEnabled,
                                    setDebugLogsEnabled,
                                    handleParticipantConfigChange,
                                    searchOverrides,
                                    onSearchOverridesChange: handleSearchConfigChange,
                                    brandingMode: branding.config.mode,
                                    brandingSeason: branding.config.activeSeason,
                                    brandingBirthday: branding.config.birthday,
                                    brandingCelebrateAchievements: branding.config.celebrateAchievements,
                                    onBrandingModeChange: branding.seasonalActions.setMode,
                                    onBrandingSeasonChange: branding.seasonalActions.setActiveSeason,
                                    onBrandingBirthdayChange: branding.seasonalActions.setBirthday,
                                    onBrandingCelebrateAchievementsChange: branding.seasonalActions.setCelebrateAchievements,
                                    aiProvider,
                                    setAiProvider: handleSetAiProvider,
                                }}
                                ambientes={{
                                    ambientes,
                                    activeAmbienteId,
                                    onActivate: handleActivateAmbiente,
                                    dynamicIds: dynamicAmbienteIds,
                                    onRegister: handleRegisterAmbiente,
                                    onUpdate: handleUpdateAmbiente,
                                    onRemove: handleRemoveAmbiente,
                                }}
                                paletas={{
                                    paletas,
                                    activeSeason: branding.config.activeSeason,
                                    onActivate: handleActivatePaleta,
                                    dynamicIds: dynamicPaletaIds,
                                    onRegister: handleRegisterPaleta,
                                    onUpdate: handleUpdatePaleta,
                                    onRemove: handleRemovePaleta,
                                }}
                                assistant={{
                                    channel: notificationCenter.channel,
                                    onChannelChange: notificationCenter.setChannel,
                                    dnd,
                                    onSetDndEnabled: dndActions.setEnabled,
                                    onSetDndSchedule: dndActions.setSchedule,
                                    onSetDndAllowUrgent: dndActions.setAllowUrgent,
                                    onReplayOnboarding: onboarding.reset,
                                }}
                                participants={{
                                    items: participants.participants,
                                    loading: participants.loading,
                                    birthdayNear,
                                    profiles: communicationProfiles.profiles,
                                    onSetManual: communicationProfiles.setManual,
                                    onResetPerson: communicationProfiles.resetPerson,
                                    onRegister: async (input) => {
                                        return participants.register(input);
                                    },
                                    onRemove: async (id) => {
                                        await handleRemoveMultiuserParticipant(id);
                                    },
                                }}
                                browser={{
                                    items: participants.participants,
                                    loading: participants.loading,
                                    profiles: browserProfiles.profiles,
                                    onUpdate: browserProfiles.update,
                                    onReset: browserProfiles.reset,
                                }}
                                search={{
                                    overrides: searchOverrides,
                                    onChange: handleSearchConfigChange,
                                    onReset: handleSearchConfigReset,
                                    allowlist: resolvedBrowserAllowlist,
                                    sites: searchSites.sites,
                                    dynamicDomains: searchSites.dynamicDomains,
                                    loading: searchSites.loading,
                                    onRegister: searchSites.register,
                                    onUpdate: searchSites.update,
                                    onRemove: searchSites.remove,
                                }}
                                contacts={{
                                    participants: participants.participants,
                                    contacts: contacts.contacts,
                                    birthdayNear: contacts.birthdayNear,
                                    loading: contacts.loading,
                                    onAdd: async (input) => {
                                        await contacts.addContact(input);
                                    },
                                    onRemove: async (id) => {
                                        await contacts.removeContact(id);
                                    },
                                }}
                                reminders={{
                                    items: reminders.reminders,
                                    loading: reminders.loading,
                                    pendingCount: reminders.pendingCount,
                                    authorFilter: remindersAuthor,
                                    authorPending: pendingByAuthor,
                                    onAuthorFilterChange: setRemindersAuthor,
                                    onAdd: async (input) => {
                                        await reminders.add(input);
                                    },
                                    onComplete: async (id) => {
                                        await reminders.complete(id);
                                    },
                                    onDismiss: async (id) => {
                                        await reminders.dismiss(id);
                                    },
                                    onRemove: async (id) => {
                                        await reminders.remove(id);
                                    },
                                    onEdit: async (id, text) => {
                                        await reminders.update(id, { text });
                                    },
                                }}
                                temporals={{
                                    alarms: temporals.alarms,
                                    timers: temporals.timers,
                                    loading: temporals.loading,
                                    onAdd: async (input) => {
                                        await temporals.add(input);
                                    },
                                    onCancel: async (id) => {
                                        await temporals.cancel(id);
                                    },
                                    onRemove: async (id) => {
                                        await temporals.remove(id);
                                    },
                                    onEdit: async (id, patch) => {
                                        await temporals.update(id, patch);
                                    },
                                }}
                                shopping={{
                                    items: shopping.items,
                                    loading: shopping.loading,
                                    remainingCount: shopping.remainingCount,
                                    onAdd: async (label) => {
                                        await shopping.addMany(
                                            label
                                                .split(',')
                                                .map((s) => s.trim())
                                                .filter(Boolean),
                                        );
                                    },
                                    onToggle: async (id) => {
                                        await shopping.toggle(id);
                                    },
                                    onRemove: async (id) => {
                                        await shopping.remove(id);
                                    },
                                    onClearChecked: async () => {
                                        await shopping.clearChecked();
                                    },
                                }}
                                materiaGris={{
                                    participants: participants.participants,
                                    leaderboard: materiaGris.leaderboard,
                                    history: materiaGris.history,
                                    loading: materiaGris.loading,
                                    onAward: async (input) => {
                                        await materiaGris.awardPoints(input);
                                    },
                                }}
                            />

                            {/* System Tab — Autonomous Systems Monitoring */}
                            <FluSystemTabView
                                activeTab={activeTab}
                                expandedFrameId={expandedFrameId}
                                onToggleExpand={handleToggleExpand}
                                state={autonomyState}
                                actions={autonomyActions}
                            />
                                </Suspense>
                        </div>
                    </div>
                </div>
            </div>

            {/* Indicador visual de procesamiento de IA (FLU pensando) */}
            <ThinkingIndicator />

            {/* Onboarding de configuración (no bloqueante) */}
            <OnboardingOverlay
                visible={onboarding.visible}
                prompt={onboardingPrompt}
                stepType={onboarding.currentStep?.type}
                progress={onboarding.progress}
                skipLabel={onboardingOverlayLabels.skipLabel || 'Omitir'}
                progressLabel={onboardingOverlayLabels.progressLabel || 'Paso {current} de {total}'}
                listeningHint={onboardingOverlayLabels.listeningHint || 'Escucho…'}
                typingHint={onboardingOverlayLabels.typingHint || 'Escribe tu respuesta…'}
                listening={onboardingVoice.listening}
                interim={onboardingVoice.interim}
                canVoice={onboardingVoiceEnabled && onboardingVoice.supported}
                micLabel={onboardingOverlayLabels.micLabel || 'Hablar'}
                stopLabel={onboardingOverlayLabels.stopLabel || 'Detener'}
                onVoiceStart={onboardingVoice.start}
                onVoiceStop={onboardingVoice.stop}
                submitLabel={onboardingOverlayLabels.submitLabel || 'Enviar'}
                continueLabel={onboardingOverlayLabels.continueLabel || 'Continuar'}
                acceptLabel={onboardingOverlayLabels.acceptLabel || 'Sí'}
                rejectLabel={onboardingOverlayLabels.rejectLabel || 'No'}
                accept={onboarding.currentStep?.accept}
                reject={onboarding.currentStep?.reject}
                stepOptions={onboarding.currentStep?.options?.map((o) => ({
                    value: o.value,
                    label: language === 'en' ? o.en : o.es,
                }))}
                userSuggestions={onboardingUserSuggestions}
                onAnswer={handleOnboardingAnswer}
                onSkip={onboarding.skip}
            />

            {/* Stack de notificaciones (toasts) */}
            {notificationCenter.toasts.length > 0 && (
                <div className="flu-notifications" data-testid="notification-toasts">
                    {notificationCenter.toasts.map((toast) => (
                        <button
                            key={toast.id}
                            type="button"
                            className={
                                'flu-notification' +
                                (toast.urgent ? ' flu-notification--urgent' : '')
                            }
                            onClick={() => notificationCenter.dismiss(toast.id)}
                            data-testid={`notification-toast-${toast.id}`}
                        >
                            <strong>{toast.title}</strong>
                            <span>{toast.body}</span>
                        </button>
                    ))}
                </div>
            )}
                </main>

            {/* Workspace Image Overlay removed - now displayed in workspace panel */}
        </ErrorBoundary>
    );
}

export default App;
