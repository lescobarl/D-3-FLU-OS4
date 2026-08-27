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

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useConfigPersistence } from './hooks/useConfigPersistence';
import { useBunnyStore, ensureAvatarPantsVisible, EXPRESSION_MAP } from './avatar';
import { relayLog } from './lib/clientLogRelay';
import { cleanForSpeech } from './lib/textUtils';
import type { BunnyComponent } from './avatar/types/bunny';
import { v4 as uuidv4 } from 'uuid';
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
import { useMinuteHandlers } from './hooks/useMinuteHandlers';
import { useNavigationCommands } from './hooks/useNavigationCommands';
import { FLU_EVENTS, onFluEvent } from './core/events/fluEvents';
import { STORAGE_KEYS, WELCOME_MESSAGE, UI_DEFAULTS, APP_BRANDING } from './core/config/appConfig';
import type { ConversationState, WorkspaceEntry, FluProfile, VoiceConfig, PersonalityConfig, AdvancedConfig, ImageConfig } from './types/bridge';
import { FLU_PROFILES } from './core/config/appConfig';
import { geminiService } from './services/gemini';
import { playSong, pauseMusic, stopMusic } from './services/musicPlayer';
import { getPreferredAIProvider, setPreferredAIProvider } from './services/aiServiceFactory';
import { extractTextFromImage, extractTextFromPdf } from './services/ocrService';
import { useDocumentAnalysis } from './hooks/useDocumentAnalysis';
import { useAppAnalysis } from './hooks/useAppAnalysis';
import { useDocumentGeneration } from './hooks/useDocumentGeneration';
import DocumentResultPanel from './components/DocumentResultPanel';
import AppAnalysisPanel from './components/AppAnalysisPanel';
import GenerationProgressPanel from './components/GenerationProgressPanel';
import { isSupportedDocument } from './lib/documentParser';
import type { GenerationFormato } from './types/documentContracts';
import { useAutonomyIntegration, AutonomyStatusPanel } from './core/autonomy';
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
import './App.css';
// OS1 visual parity: import BunnyViewer styles for 3D avatar rendering
import './avatar/App.css';

// ============================================================
// OS2 Component Imports — local paths (formerly flu-voz alias)
// ============================================================
import FluParticipantSettingsPanel from './voice/components/FluParticipantSettingsPanel';
import { MinuteHistoryPanel } from './voice/components/MinuteHistoryPanel';
import { MinuteDraftPanel } from './voice/components/MinuteDraftPanel';
import { VoiceProfilesPanel } from './voice/components/VoiceProfilesPanel';
import { ConversationLog } from './voice/components/ConversationLog';
import { FluShellTabs, FluTabPanel } from './voice/components/FluShellTabs';
import { PanelFrame } from './voice/components/PanelFrame';

// ---- OS2 components are JS (no TS declarations) — cast for TypeScript compatibility ----
const ConversationLogAny = ConversationLog as React.ComponentType<any>;
const MinuteDraftPanelAny = MinuteDraftPanel as React.ForwardRefExoticComponent<any>;
import { VoiceAssistantBarWrapper } from './components/VoiceAssistantBarWrapper';
import { FluSettingsPanel } from './components/FluSettingsPanel';

// ============================================================
// OS2 Library Imports — local paths (formerly flu-voz alias)
// ============================================================
import { useFluVoiceAssistant } from './voice/hooks/useFluVoiceAssistant';
import { speakResponse, isSpeechBusy, waitForSpeechIdle } from './voice/lib/fluSpeech';
import { FLU_CONFIG } from './voice/lib/fluConfig';
import { normalizeJuego } from './voice/lib/configCommands';
import { getGameEngine } from './core/games/gameCatalog';
import {
    getActiveGameSession,
    setActiveGameSession,
    clearActiveGameSession,
} from './core/games/gameSessionStore';
import type { GameId } from './core/games/types';
import { getCommandSpeech } from './voice/lib/voiceCommands';
import { formatStreamSttUiStatus, getTranscriptSource } from './voice/lib/transcriptConfig';
import {
    getFluParticipantConfig,
    setFluParticipantOverrides,
    resetFluParticipantOverrides,
    isFluParticipantEnabled,
} from './voice/lib/fluParticipantConfig';
import {
    createMinuteDraftFromSummary,
} from './voice/lib/minuteKnowledge';
import {
    buildMinuteKnowledgeBase2,
    resolveMinuteQuery,
    selectMinuteForLookup,
} from './lib/minuteKnowledgeHelpers';
import {
    buildDailyAgenda,
    formatAgendaForPrompt,
    countPendingItems,
} from './lib/dailyAgenda';
import {
    buildSystemConversationEntry,
    isDuplicateSystemEvent,
    type SystemEvent,
} from './lib/systemEventLog';
import { buildFluSpeechAuditRows } from './voice/lib/conversationDialogue';
import { shouldGenerateWorkspaceImage, normalizeWorkspaceContract } from './voice/lib/workspaceContract';
import { resolveGeminiErrorPresentation } from './voice/lib/geminiDiagnostics';
import { deleteAuditLogsBySpeaker } from './voice/lib/fluStorage';

// ============================================================
// Tipo para las pestañas del panel derecho
// ============================================================
type RightTab = 'workspace' | 'conversation' | 'minutes' | 'settings';

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
                const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
                console.log('[applyConfigAction] Voice speed set:', clamped);
            }
            break;
        }
        case 'voiceNumber': {
            const ok = applyNumberConfig(entry, valor, (n) => {
                ctx.setVoiceConfig?.({ [entry.clave]: n } as Partial<VoiceConfig>);
            });
            if (ok) console.log(`[applyConfigAction] ${entry.clave} set:`, valor);
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
                console.log('[applyConfigAction] Voice set:', selected.name);
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
            const ok = applyNumberConfig(entry, valor, (n) => {
                ctx.setPersonality?.({ [entry.clave]: n } as Partial<PersonalityConfig>);
            });
            if (ok) console.log(`[applyConfigAction] ${entry.clave} set:`, valor);
            break;
        }

        // --------------------------------------------------------
        // AVANZADO (set_config → setAdvancedConfig)
        // Claves del catálogo == campos de AdvancedConfig.
        // --------------------------------------------------------
        case 'advancedNumber': {
            const ok = applyNumberConfig(entry, valor, (n) => {
                ctx.setAdvancedConfig?.({ [entry.clave]: n } as Partial<AdvancedConfig>);
            });
            if (ok) console.log(`[applyConfigAction] ${entry.clave} set:`, valor);
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
            if (component && color) {
                ctx.setComponentColor?.(component as any, color);
            } else {
                console.warn('[applyConfigAction] avatarColor requiere "componente:color":', valor);
            }
            break;
        }
        case 'avatarComponentColor': {
            const map: Record<string, string> = {
                pantsColor: 'Bunny_pants',
                bodyColor: 'Bunny_body',
                faceColor: 'Bunny_face',
            };
            const component = map[entry.clave];
            if (component) {
                ctx.setComponentColor?.(component as any, valor);
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
    speakFluRef: React.MutableRefObject<(text: string, lang: string) => Promise<void>>;
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
async function speakGameText(text: string, ctx: ApplyGameContext): Promise<void> {
    if (!text) return;

    const currentSpeakFlu = ctx.speakFluRef.current;
    const speakPromise = currentSpeakFlu(text, ctx.languageRef.current).catch((speechErr: unknown) => {
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
    return base;
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
        await speakGameText('La narración de historias llegará en una próxima fase. ¿Jugamos otra cosa?', ctx);
        return;
    }

    const engine = getGameEngine(juegoAction.gameId as GameId);
    if (!engine) {
        await speakGameText('Ese juego todavía no está disponible. Prueba con Simón dice o adivinanzas.', ctx);
        return;
    }

    if (juegoAction.action === 'end') {
        clearActiveGameSession();
        await speakGameText('¡Hasta la próxima partida! ¿Qué más hacemos?', ctx);
        return;
    }

    if (juegoAction.action === 'start') {
        const session = engine.createSession(buildGameConfig(juegoAction.gameId));
        const result = engine.start(session, buildGameConfig(juegoAction.gameId));
        setActiveGameSession(session);
        applyGameEmotion(result);
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
    }
    applyGameEmotion(result);
    await speakGameText(result.prompt, ctx);
}

// ============================================================
// App
// ============================================================

function App() {
    const [currentState, setCurrentState] = useState<ConversationState>('IDLE');
    const integrationStore = useIntegrationStore();
    const auditLog = useAuditLog();
    const minuteKnowledge = useMinuteKnowledge();
    const voiceProfiles = useVoiceProfiles();
    useConversationPersistence();

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
    const lastRawLogRef = useRef<string>('');

    // Ref for speakFlu to fix closure issue: useCallback with [] deps captures
    // speakFlu from the FIRST render's closure. Keeping a ref ensures the callback
    // always reads the latest speakFlu even across re-renders.
    const speakFluRef = useRef<(text: string, lang: string) => Promise<void>>(async () => {});

    // Cache for rawOnly speaker lookup: Map<speakerName, { index, entry }>
    // Avoids O(n) backward scan of conversation history on every raw transcript.
    const speakerIndexRef = useRef<Map<string, { index: number; entry: any }>>(new Map());

    // ---- Pestaña activa del panel derecho ----
    // Always start on Pizarron (workspace) tab as default
    const [activeTab, setActiveTab] = useState<RightTab>('workspace');

    // ---- Estado para imagen subida (digitalización OCR) ----
    const [uploadedImage, setUploadedImage] = useState<{ dataUrl: string; mimeType: string; fileName: string } | null>(null);
    const [homeworkContext, setHomeworkContext] = useState<{ materia: string; problemas: string[]; instrucciones: string; nivel: string; texto_extraido: string } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const docInputRef = useRef<HTMLInputElement>(null);
    const projectInputRef = useRef<HTMLInputElement>(null);

    // ---- Estado para maximizar/restaurar paneles (PanelFrame expandable) ----
    const [expandedFrameId, setExpandedFrameId] = useState<string>(savedSession.current.expandedFrameId);

    const handleToggleExpand = useCallback((frameId: string) => {
        setExpandedFrameId((prev) => (prev === frameId ? '' : frameId));
    }, []);

    // ---- Estado para la minuta actual en edición ----
    const [minuteDraft, setMinuteDraft] = useState<any>(null);

    // ---- Estado para la minuta seleccionada en el historial ----
    const [selectedMinuteId, setSelectedMinuteId] = useState<string | null>(savedSession.current.selectedMinuteId);

    // ---- Ref para MinuteDraftPanel (accede a .save()) ----
    const minutePanelRef = useRef<{ save: () => void }>(null);

    // Suscribirse a la expresión/animación actual del avatar (para mostrar en header)
    const avatarCurrentExpression = useBunnyStore((s) => (s as any).currentExpression ?? null);
    const avatarCurrentAnimation = useBunnyStore((s) => (s as any).currentAnimation ?? null);
    const avatarBlendQueue = useBunnyStore((s) => (s as any).blendQueue ?? []);

    // ---- Acciones del avatar (colores por voz — usadas en onContractResolved) ----
    const setComponentColor = useBunnyStore((s) => s.setComponentColor);
    const resetComponentColors = useBunnyStore((s) => s.resetComponentColors);

    // ---- Config Persistence (extraído a hook dedicado) ----
    const {
        apiKey,
        textModel,
        textApiUrl,
        imageApiKey,
        imageModel,
        imageApiUrl,
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
        handleImageApiKeyCommit,
        handleImageModelCommit,
        handleImageApiUrlCommit,
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

    // ---- AI Provider Selection ----
    const [aiProvider, setAiProviderState] = useState<string>(() => getPreferredAIProvider());
    const handleSetAiProvider = useCallback((provider: string) => {
        setPreferredAIProvider(provider as any);
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
                    // Update UI log
                    integrationStore.addConversationEntry(entry);
                    // Inject into dialogueHistoryRef so Gemini sees it as part of the
                    // conversation context (FLU's own memory).
                    injectDialogueEntry(entry);
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
        toggleListening: os2ToggleListening,
        showListeningAck,
        removeSessionSpeaker: os2RemoveSessionSpeaker,
        renameSessionSpeaker: os2RenameSessionSpeaker,
        // OS2 parity: additional actions from useFluVoiceAssistant (FluShell.jsx lines 3444-3457)
        resetConversationSession: os2ResetConversationSession,
        resetVoiceDisplay: os2ResetVoiceDisplay,
        endParticipantFloorDelivery: os2EndParticipantFloorDelivery,
        suspendRecognitionForAssistantSpeech: os2SuspendRecognition,
        /** Inject system events into dialogueHistoryRef so Gemini sees them as FLU's own memory. */
        injectDialogueEntry,
        /** Set recent memory text that gets injected into the system prompt on next contract request. */
        setRecentMemory,
    } = useFluVoiceAssistant({
        apiKey,
        language,
        // OS2 parity: pass conversationActiveRef for resume logic (FluShell.jsx line 154)
        conversationActiveRef,
        // OS2 parity: pasar knowledgeBase para resolución de minutas
        knowledgeBase: '',
        getMinuteKnowledgeBase: () => {
            // OS2 parity: useMinuteKnowledge ↔ minuteKnowledgeRef.getKnowledgeBaseForMode('minutes')
            // Devolvemos el texto formateado de TODAS las minutas persistidas en IndexedDB
            // para inyectarlo en el prompt de Gemini como knowledgeBase2.
            // Si no hay minutas, devolvemos '' (Gemini dirá "KB minutas vacía" como en OS2).
            return buildMinuteKnowledgeBase2(minuteKnowledge.minutes);
        },
        getDailyAgenda: () => {
            // Compila pendientes de todas las minutas en una "orden del día"
            // y la formatea para inyectar en el prompt de Gemini.
            // Si no hay pendientes, devuelve '' (Gemini ignora el campo).
            const agendaConfig = FLU_CONFIG.agenda || {};
            if (!agendaConfig.enabled) return '';
            const items = buildDailyAgenda(minuteKnowledge.minutes, {
                maxItems: agendaConfig.maxItems,
                minImportance: agendaConfig.minImportance,
            });
            if (items.length === 0) return '';
            return formatAgendaForPrompt(items, languageRef.current as 'es' | 'en');
        },
        resolveMinuteLookup: ((query: string, lang?: string) => {
            // OS2 parity: useMinuteKnowledge ↔ minuteKnowledgeRef.resolveMinuteQuery
            // Intenta resolver localmente (parseMinuteSequenceFromQuery +
            // findMinuteRecordBySequence + buildMinuteLookupContract).
            // Si no hay número de secuencia, retorna { mode: 'gemini' } para fallback.
            return resolveMinuteQuery(query, minuteKnowledge.minutes, { language: lang || languageRef.current });
        }) as any,
        // Test hook e2e: exponer el callback REAL onContractResolved en window
        // (window.__fluOnContractResolved) para que las pruebas de verificación
        // puedan disparar un contrato play_music de forma determinista. Se asigna
        // en CREACIÓN (expresión de asignación), disponible desde el montaje.
        onContractResolved: ((window as any).__fluOnContractResolved = useCallback(async (resolved: any) => {
            const contract: any = resolved?.contract || {};
            const transcript: string = resolved?.transcript || '';
            const rawOnly: boolean = resolved?.rawOnly === true;
            const speakerName: string = resolved?.speakerName || '';
            const phase: string = resolved?.phase || '';

            // ============================================================
            // OS2 parity: raw transcript logging with dedup
            // (FluShell.jsx lines 332-448: rawOnly path)
            // Usamos cleanForSpeech inline (OS2 audioMath.js) para evitar
            // dependencia de tipos en el barrel JS de flu-voz.
            // ============================================================
            if (rawOnly && transcript) {
                const normalizedTranscript = cleanForSpeech(transcript);
                if (!normalizedTranscript) return;

                // OS2 dedup: isExactDuplicateLogEntry + rowDuplicatesPrior + phrasesEquivalent
                // OS2 parity: scan backward for the same speaker (FluShell.jsx lines 332-448)
                // No solo la última entrada — buscar la última entrada del mismo speaker
                // Optimized: use speakerIndexRef Map for O(1) lookup instead of O(n) backward scan
                const history = integrationStore.conversationHistory;
                const speakerKey = speakerName || '__default__';
                let lastEntryForSpeaker: any = null;
                let lastEntryIndex = -1;
                const cached = speakerIndexRef.current.get(speakerKey);
                if (cached && cached.index >= 0 && cached.index < history.length && history[cached.index] === cached.entry) {
                    lastEntryForSpeaker = cached.entry;
                    lastEntryIndex = cached.index;
                } else {
                    // Cache miss or stale — fall back to backward scan and update cache
                    for (let i = history.length - 1; i >= 0; i--) {
                        const entry = history[i];
                        if (entry.speakerName === speakerName || (!speakerName && !entry.speakerName)) {
                            lastEntryForSpeaker = entry;
                            lastEntryIndex = i;
                            break;
                        }
                    }
                    if (lastEntryForSpeaker) {
                        speakerIndexRef.current.set(speakerKey, { index: lastEntryIndex, entry: lastEntryForSpeaker });
                    }
                }

                if (lastEntryForSpeaker) {
                    const lastText = cleanForSpeech(lastEntryForSpeaker.text || '');
                    // isExactDuplicateLogEntry: mismo speaker + mismo texto normalizado
                    if (lastText === normalizedTranscript) {
                        return;
                    }
                    // rowDuplicatesPrior: el nuevo texto empieza con el anterior (ASR revision)
                    if (lastText && normalizedTranscript.startsWith(lastText)) {
                        // Reemplazar la última entrada del mismo speaker (OS2: replaceLastRawLog)
                        const updated = [...history];
                        updated[lastEntryIndex] = {
                            ...lastEntryForSpeaker,
                            text: transcript,
                            speakerName: speakerName || lastEntryForSpeaker.speakerName || 'Hablante 1',
                            timestamp: Date.now(),
                        };
                        integrationStore.batchLoadHistory(updated);
                        // Update cache: the replaced entry is now at the same index with new content
                        speakerIndexRef.current.set(speakerKey, { index: lastEntryIndex, entry: updated[lastEntryIndex] });
                        return;
                    }
                    // phrasesEquivalent: foldSpeechKey (cleanForSpeech + lowercase)
                    if (lastText && lastText.toLowerCase() === normalizedTranscript.toLowerCase()) {
                        return;
                    }
                }

                // Agregar entrada raw al historial (OS2: optimisticRow)
                // Obligación #6: UUIDv4
                integrationStore.addConversationEntry({
                    id: uuidv4(),
                    role: 'user',
                    text: transcript,
                    speakerName: speakerName || undefined,
                    timestamp: Date.now(),
                    sentiment: 'neutral',
                });

                // Update cache: new entry appended at the end
                const newHistory = integrationStore.conversationHistory;
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

            const respuestaVoz = contract?.respuesta_voz || '';
            const navegacion = contract?.navegacion || {};
            const workspace = contract?.workspace || null;
            const musica = contract?.musica || null;
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

            // Gate único: se admiten contratos con respuesta_voz, navegación o
            // configuración. Antes, un contrato SOLO-configuración (fast-path) era
            // descartado aquí en silencio; ahora pasa para aplicar applyConfigAction.
            if (!respuestaVoz && !navegacion.comando && !configAction?.accion && !juegoAction?.action) return;

            // ============================================================
            // OS2 parity: cuando viene de una consulta de minuta local exitosa
            // (resolveMinuteQuery → diagnostics.route === 'minute-lookup-hit'),
            // poblar el panel "Minuta de acuerdos" con la minuta consultada,
            // resaltarla en el historial y (si NO estamos en conversación
            // activa) cambiar a la pestaña de minutas para que el usuario
            // la vea visualmente. FluShell.jsx:464-583 hace el equivalente.
            // ============================================================
            let minuteSelection: any = null;
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
                        setActiveTab('minutes');
                    }
                } catch (err) {
                    console.warn('[App] minuteSelection handler threw (non-critical):', err);
                    relayLog('WARN', 'App', `minuteSelection handler threw: ${err}`);
                }
            }

            // ============================================================
            // LIMPIAR IMAGEN ANTERIOR AL INICIO DE CADA CONTRATO
            // Regla: las imágenes solo se muestran si la IA lo indica
            // explícitamente en este turno (workspace.tipo visual). Si la IA
            // no pide imagen (texto, sin workspace, o respuesta corta), la
            // zona de imagen debe quedar limpia — NUNCA persistir la imagen
            // del turno anterior.
            // ============================================================
            // Invalidar cualquier request de imagen pendiente (OS2 parity: requestId guard)
            try {
                workspaceImage.clear();
            } catch (err) {
                console.warn('[App] workspaceImage.clear() threw (non-critical):', err);
                relayLog('WARN', 'App', `workspaceImage.clear() threw: ${err}`);
            }

            // Si hay respuesta de voz, actualizar el store.
            // En juegos por voz la voz es SIEMPRE del motor local (determinista):
            // se suprime la respuesta_voz de cortesía de Gemini para evitar doble
            // habla (juegoAction) y la del contrato fast-path (fastPathGame).
            if (respuestaVoz && !juegoAction?.action && !(resolved as any)?.fastPathGame) {
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
                            console.log(`[App] Post-processing: "${speechSource}" → forzando animacion="${detectedAnim}", emocion=undefined`);
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
                                console.log(`[App] Post-processing: "${speechSource}" → forzando emocion="${detectedEmotion}"${musica?.accion !== 'play_music' ? ', animacion=undefined (la emoción definida gana)' : ' (modo canción: se conserva Dance)'}`);
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
                const hasEmotion = Boolean(geminiEmocion || geminiAnimacion);
                const isSpeakingExpression = isNeutralSpeakingEmotion;
                console.log(`[DIAG App] contract.emocion="${geminiEmocionRaw}", contract.animacion="${geminiAnimacionRaw}", emotionLabel="${emotionLabel}", hasEmotion=${hasEmotion}, isSpeakingExpression=${isSpeakingExpression}`);
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

            // OS2 parity: procesar workspace artifact
            // Si el nuevo contrato NO tiene workspace, limpiar el artifact anterior
            // para que no persista contenido visual/textual del turno previo.
            if (!workspace) {
                integrationStore.setWorkspaceArtifact(null);
            }
            if (workspace) {
                const tipo = String(workspace.tipo || 'text').trim().toLowerCase();
                const titulo = workspace.titulo || '';
                const contenido = workspace.contenido || '';
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
                            timestamp: Date.now(),
                        });

                        // SOLO usar workspace.prompt_visual (lo que Gemini diseña específicamente como prompt de imagen).
                        // NO caer en contenido/titulo — eso es texto para mostrar, NO para generar imagen.
                        // Si prompt_visual está vacío, NO generar imagen (fail-fast con mensaje claro).
                        if (promptVisual && promptVisual.length >= 5) {
                            workspaceImage.generateFromContract(promptVisual, workspace.tipo as string | null);
                        }
                    }
                } else if (titulo || contenido || puntos_clave.length > 0 || promptVisual) {
                    // Obligación #6: UUIDv4
                    integrationStore.setWorkspaceArtifact({
                        id: uuidv4(),
                        respuesta: contenido || titulo || respuestaVoz,
                        titulo: titulo || 'Contenido',
                        tipo: 'text',
                        contenido: contenido || '',
                        prompt_visual: promptVisual || '',
                        puntos_clave,
                        timestamp: Date.now(),
                    });
                }
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
                });
            }

            // ============================================================
            // OS2 parity: audit rows for normal contract (Gap 24)
            // FluShell.jsx lines 637-698: buildFluSpeechAuditRows + addAuditLog
            // ============================================================
            if (respuestaVoz && transcript) {
                // OS2 parity: buildFluSpeechAuditRows creates separate rows for human and FLU
                // FluShell.jsx lines 638-647
                const auditRows = (buildFluSpeechAuditRows as any)({
                    timestamp: new Date().toISOString(),
                    humanSpeaker: speakerName || 'Hablante 1',
                    humanTranscript: transcript,
                    fluText: respuestaVoz,
                    phase,
                    navigation: navegacion,
                    navigationComando: navegacion.comando || null,
                });

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
        }, [])),
        // OS2 parity: inject the local useFluParticipant instance so OS2's voice commands
        // (FLU_ADELANTE) use the same participant state as the UI button.
        // Fixes: voice "ok flu adelante" responding "No tengo nada pendiente por ahora"
        participantRef: fluParticipantRef,
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
        clearResumeListeningTimer,
        scheduleResumeListening,
        handleNavigationCommand,
    } = navigationCommands;

    // Keep speakFluRef in sync so onContractResolved always reads the latest speakFlu
    speakFluRef.current = speakFlu;

    // ---- Branding Inteligente por Temporalidad + Ecológico ----
    const branding = useEnhancedBranding();

    // ---- Handlers para digitalización OCR (tutor experience) ----
    // These must be declared AFTER speakFlu and injectDialogueEntry are available.
    const processImageFile = useCallback(async (file: File) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            const mimeType = file.type;
            setUploadedImage({ dataUrl, mimeType, fileName: file.name });
            setIsAnalyzing(true);
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
                            console.log('[App] OCR local extrajo texto (visión vacía):', ocr.engine);
                        }
                    } catch (ocrErr) {
                        console.warn('[App] OCR fallback failed:', ocrErr);
                    }
                }

                // ── Tutor experience: FLU speaks proactively after analysis ──
                if (result.texto_extraido) {
                    // 1. Inject context into dialogueHistoryRef so Gemini sees it as
                    //    FLU's own memory (preferred over addConversationEntry because
                    //    injectDialogueEntry adds it as a regular conversation entry
                    //    that Gemini sees in-context but does NOT persist beyond the
                    //    context window).
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
                    injectDialogueEntry(entry);

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
            } finally {
                setIsAnalyzing(false);
            }
        };
        reader.readAsDataURL(file);
    }, [language, integrationStore, speakFlu, injectDialogueEntry]);

    const handleClearImage = useCallback(() => {
        setUploadedImage(null);
        setHomeworkContext(null);
        setIsAnalyzing(false);
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

    // ---- Análisis de documentos (F1) / análisis de app (F2) / generación (F3/F4) ----
    const documentAnalysis = useDocumentAnalysis(language);
    const appAnalysis = useAppAnalysis(language);
    const documentGeneration = useDocumentGeneration(language);

    // Ruta genérica de archivo: imagen → OCR (processImageFile); documento → análisis F1.
    const processAnyFile = useCallback(async (file: File) => {
        if (!file) return;
        if (file.type.startsWith('image/')) {
            await processImageFile(file);
            return;
        }
        if (isSupportedDocument(file)) {
            await documentAnalysis.analyzeFile(file, language);
        } else {
            console.warn('[App] Tipo de archivo no soportado:', file.name, file.type);
        }
    }, [processImageFile, documentAnalysis, language]);

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
        if (file) documentAnalysis.analyzeFile(file, language);
        e.target.value = '';
    }, [documentAnalysis, language]);

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

    // Comandos de voz → eventos de ventana (dispatch en useNavigationCommands).
    // Nombres centralizados en FLU_EVENTS (single source of truth, sin drift).
    useEffect(() => {
        const onAnalyzeDocument = () => { docInputRef.current?.click(); };
        const onAnalyzeApp = () => { projectInputRef.current?.click(); };
        const onGenerateDocument = () => { documentGeneration.generate('pdf'); };
        const onGenerateVideo = () => { documentGeneration.generate('video'); };
        const offs = [
            onFluEvent(FLU_EVENTS.ANALYZE_DOCUMENT, onAnalyzeDocument),
            onFluEvent(FLU_EVENTS.ANALYZE_APP, onAnalyzeApp),
            onFluEvent(FLU_EVENTS.GENERATE_DOCUMENT, onGenerateDocument),
            onFluEvent(FLU_EVENTS.GENERATE_VIDEO, onGenerateVideo),
        ];
        return () => offs.forEach((off) => off());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentGeneration.generate]);

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

    const stats = integrationStore.sessionStats;
    const config = integrationStore.config;


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
    }, [minuteKnowledge.minutes.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- Handlers ----


    const handleParticipantConfigChange = useCallback((overrides: Record<string, any>) => {
        const prev = participantConfig;
        const newConfig = setFluParticipantOverrides(overrides);
        setParticipantConfig(newConfig);
        // Audit log
        auditLog.logChange('config', 'flu-participant', prev, newConfig, 'Participant config updated').catch(console.error);
    }, [participantConfig, auditLog]);

    const handleParticipantReset = useCallback(() => {
        const prev = participantConfig;
        const defaults = resetFluParticipantOverrides();
        setParticipantConfig(defaults);
        // Audit log
        auditLog.logChange('config', 'flu-participant', prev, defaults, 'Participant config reset to defaults').catch(console.error);
    }, [participantConfig, auditLog]);

    const handleToggleAutoCycle = useCallback(() => {
        integrationStore.setConfig({ autoCycle: !integrationStore.config.autoCycle });
    }, [integrationStore]);

    const handleTogglePushToTalk = useCallback(() => {
        integrationStore.setConfig({ pushToTalk: !integrationStore.config.pushToTalk });
    }, [integrationStore]);

    const handleReset = useCallback(() => {
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
    isGeneratingMinute,
    isSummarizing,
    handleGenerateMinute,
    handleGenerateSummary,
    handleSaveMinute,
    handleSelectMinuteHistory,
} = minuteHandlers;


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
            await os2StopListening({ closing: false }).catch(() => { });
            await os2StartListening({ resume: true }).catch(() => { });
            return;
        }

        await os2StartListening({ resume: true }).catch(() => { });
    }, [language, voiceStatus, integrationStore, auditLog, os2StartListening, os2StopListening]);

    // ============================================================
    // OS2 parity: handleRemoveParticipant (Gap G)
    // FluShell.jsx lines 1216-1232: handleRemoveParticipant
    // ============================================================
    const handleRemoveParticipant = useCallback(async (row: any) => {
        const label = String(row?.label || '').trim();
        if (!label) return;

        if (row.profileId) {
            await voiceProfiles.removeProfile(row.profileId);
        }

        os2RemoveSessionSpeaker(label);
        // OS2 parity: delete audit logs for the removed speaker (FluShell.jsx lines 1226-1228)
        deleteAuditLogsBySpeaker(label).catch(console.error);
        auditLog.logEvent('participant:removed', 'config', uuidv4(), {
            label,
        }, 'Participant removed').catch(console.error);
    }, [voiceProfiles, os2RemoveSessionSpeaker, auditLog]);

    // ============================================================
    // OS2 parity: handleRenameProfile (Gap H)
    // FluShell.jsx lines 1196-1214: handleRenameVoiceProfile
    // ============================================================
    const handleRenameProfile = useCallback(async (profileId: string, label: string) => {
        const saved: any = await voiceProfiles.renameProfile(profileId, label);
        if (!saved?.label) return;

        os2RenameSessionSpeaker(
            String(voiceProfiles.profiles.find((p: any) => p.id === profileId)?.label || '').trim(),
            saved.label,
        );
        auditLog.logEvent('profile:renamed', 'config', uuidv4(), {
            profileId,
            newLabel: saved.label,
        }, 'Voice profile renamed').catch(console.error);
    }, [voiceProfiles, os2RenameSessionSpeaker, auditLog]);

    // ============================================================
    // OS2 parity: listenParity (Gap A)
    // ============================================================
    const listenParity = useMemo(() => {
        const history = integrationStore.conversationHistory;
        const lastLog = history.length > 0 ? history[history.length - 1]?.text || '' : '';
        const live = liveTranscript || '';
        if (!live && !lastLog) return null;
        // OS2 parity: evaluateListenParity from listenParity.js
        // Compare live transcript with last log entry
        const liveNorm = live.replace(/\s+/g, ' ').trim().toLowerCase();
        const lastNorm = lastLog.replace(/\s+/g, ' ').trim().toLowerCase();
        if (liveNorm && lastNorm && liveNorm !== lastNorm) {
            return { level: 'info', message: 'Nuevo transcript en vivo' };
        }
        return null;
    }, [liveTranscript, integrationStore.conversationHistory]);

    // ============================================================
    // OS2 parity: phraseDisplay (Gap B)
    // ============================================================
    const phraseDisplay = useMemo(() => {
        const live = liveTranscript || '';
        if (live) return live;
        const history = integrationStore.conversationHistory;
        if (history.length > 0) {
            const last = history[history.length - 1];
            const text = last?.text || '';
            if (text) return text;
        }
        return '\u00a0';
    }, [liveTranscript, integrationStore.conversationHistory]);

    // ============================================================
    // OS2 parity: latestResponse (Gap C)
    // Filtra el mensaje de bienvenida por defecto de FLU
    //       para que nunca aparezca en el campo de respuesta.
    // Usa WELCOME_MESSAGE desde appConfig (Rule #1: NO HARDCODE)
    // Selecciona el idioma según la configuración actual del usuario
    // ============================================================
    const welcomeText = language === 'en' ? WELCOME_MESSAGE.en : WELCOME_MESSAGE.es;
    const latestResponse = useMemo(() => {
        const lastResp = integrationStore.lastResponse;
        if (lastResp && lastResp !== welcomeText) return lastResp;
        const history = integrationStore.conversationHistory;
        for (let i = history.length - 1; i >= 0; i--) {
            const entry = history[i];
            if (entry.role === 'flu' || entry.speakerName === 'FLU') {
                const text = entry.text || '';
                if (text && text !== welcomeText) return text;
            }
        }
        return '';
    }, [integrationStore.lastResponse, integrationStore.conversationHistory, welcomeText]);

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
            transcriptSource: getTranscriptSource(),
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
            const e = history[i] as any;
            const label = e.speakerName || e.role || '';
            if (label) historyLabels.add(label);
        }
        const profiles = voiceProfiles.profiles;
        const profileLabels = new Set<string>();
        for (let i = 0; i < profiles.length; i++) {
            const p = profiles[i] as any;
            if (p.label) profileLabels.add(p.label);
        }
        const allLabels = new Set([...historyLabels, ...profileLabels]);
        const result: { label: string; profileId: string | undefined }[] = [];
        for (const label of allLabels) {
            let profileId: string | undefined;
            for (let i = 0; i < profiles.length; i++) {
                const p = profiles[i] as any;
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
                                <select value={language} onChange={(e) => setLanguage(e.target.value as 'es' | 'en' | 'both')}>
                                    <option value="both">Ambos</option>
                                    <option value="es">Español</option>
                                    <option value="en">Inglés</option>
                                </select>
                            </div>
                            <div className="session-chip">
                                <span className="session-chip__icon">👤</span>
                                <span className="session-chip__label">Perfil</span>
                                <select
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
                        </div>
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
                    } as any)} />
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
                                        setGeminiError({ show: true, message: error, hint: '', detail: '' });
                                    } else {
                                        setGeminiError({ show: false, message: '', hint: '', detail: '' });
                                    }
                                },
                            }}>
                                <FluAvatarVoiceBridge
                                    height="100%"
                                    width="100%"
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
                            <FluShellTabs activeTab={activeTab} onTabChange={setActiveTab} />

                            <div className="flu-shell__tab-content">
                                {/* Pizarron Tab (renamed from Workspace) */}
                            <FluTabPanel tabId="workspace" activeTab={activeTab} className="flu-tab-panel--workspace">
                                <PanelFrame
                                    frameId={FLU_CONFIG.frames?.workspace || 'workspace'}
                                    title={FLU_CONFIG.ui?.workspace?.title || ''}
                                    className="panel-frame--workspace"
                                    expandable={true}
                                    {...{
                                        expandedFrameId,
                                        onToggleExpand: handleToggleExpand,
                                    } as any}
                                >
                                    <div className="frame-content frame-content--workspace">
                                        <div className={`conversation-live-phrase${liveTranscript || integrationStore.currentTranscript ? '' : ' is-empty'}`}>
                                            <div className="conversation-live-phrase__scroll">
                                                <span>{liveTranscript || integrationStore.currentTranscript || '\u00a0'}</span>
                                            </div>
                                        </div>
                                        <div className={`frame-content__response${latestResponse ? '' : ' is-empty'}`}>
                                            <div className="frame-content__response-scroll">
                                                <span>{latestResponse || '\u00a0'}</span>
                                            </div>
                                        </div>
                                        <p className="frame-content__contenido">{integrationStore.workspaceArtifact?.contenido || FLU_CONFIG.ui?.workspace?.emptyContent || 'Sin contenido'}</p>
                                        {/* ---- Generated Image Section (Pollinations) ---- */}
                                        {workspaceImage.imageUrl && (
                                            <div className="frame-content__generated-image">
                                                <div className="generated-image__header">
                                                    <h4 className="generated-image__title">Imagen Generada</h4>
                                                    <button
                                                        type="button"
                                                        className="flu-btn flu-btn--small"
                                                        onClick={() => workspaceImage.expand()}
                                                        title="Ampliar imagen"
                                                    >
                                                        🔍 Ampliar
                                                    </button>
                                                </div>
                                                <div className="generated-image__preview">
                                                    <img
                                                        className="generated-image__img"
                                                        src={workspaceImage.imageUrl}
                                                        alt={integrationStore.workspaceArtifact?.prompt_visual || 'Visual generado por Flu'}
                                                        onLoad={() => {
                                                            if (workspaceImage.loadTimeoutRef.current) {
                                                                clearTimeout(workspaceImage.loadTimeoutRef.current);
                                                                workspaceImage.loadTimeoutRef.current = 0;
                                                            }
                                                        }}
                                                        onError={() => {
                                                            console.warn('[App] Generated image failed to load:', workspaceImage.imageUrl);
                                                            if (workspaceImage.loadTimeoutRef.current) {
                                                                clearTimeout(workspaceImage.loadTimeoutRef.current);
                                                                workspaceImage.loadTimeoutRef.current = 0;
                                                            }
                                                            workspaceImage.markFailed();
                                                        }}
                                                    />
                                                    {workspaceImage.isLoading && (
                                                        <div className="generated-image__loading">🔄 Generando imagen...</div>
                                                    )}
                                                    {workspaceImage.isFailed && (
                                                        <div className="generated-image__error">
                                                            <p>No se pudo cargar la imagen</p>
                                                            <button
                                                                type="button"
                                                                className="flu-btn flu-btn--small"
                                                                onClick={() => workspaceImage.retry()}
                                                            >
                                                                Reintentar
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* ---- Workspace Image Overlay (Ampliar) ---- */}
                                        {workspaceImage.isExpanded && workspaceImage.imageUrl && (
                                            <div
                                                className="workspace-image-overlay"
                                                role="dialog"
                                                aria-modal="true"
                                                aria-label="Imagen ampliada"
                                                onClick={() => workspaceImage.close()}
                                            >
                                                <div
                                                    className="workspace-image-container"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <button
                                                        type="button"
                                                        className="workspace-image-close"
                                                        onClick={() => workspaceImage.close()}
                                                        aria-label="Cerrar imagen ampliada"
                                                        title="Cerrar"
                                                    >
                                                        ✕
                                                    </button>
                                                    <img
                                                        src={workspaceImage.imageUrl}
                                                        alt={integrationStore.workspaceArtifact?.prompt_visual || 'Visual generado por Flu'}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {Array.isArray(integrationStore.workspaceArtifact?.puntos_clave) && integrationStore.workspaceArtifact.puntos_clave.length > 0 ? (
                                            <ul className="frame-content__list">
                                                {integrationStore.workspaceArtifact.puntos_clave.map((item: string, index: number) => (
                                                    <li key={`${item}-${index}`}>{item}</li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="frame-content__empty">{FLU_CONFIG.ui?.workspace?.keyPointsEmpty || 'Sin puntos clave'}</p>
                                        )}
                                        {homeworkContext && (
                                            <div className="frame-content__homework-analysis">
                                                <h4 className="homework-analysis__title">📚 {homeworkContext.materia}</h4>
                                                <p className="homework-analysis__detail"><span className="homework-analysis__label">Nivel:</span> {homeworkContext.nivel}</p>
                                                <p className="homework-analysis__detail"><span className="homework-analysis__label">Instrucciones:</span> {homeworkContext.instrucciones}</p>
                                                {homeworkContext.problemas.length > 0 && (
                                                    <ul className="homework-analysis__list">
                                                        {homeworkContext.problemas.map((p, i) => (
                                                            <li key={i}>{p}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}

                                        {/* ---- F1: Análisis de documentos ---- */}
                                        <DocumentResultPanel
                                            document={integrationStore.documentArtifact}
                                            isAnalyzing={documentAnalysis.isAnalyzing}
                                            warnings={documentAnalysis.warnings}
                                            error={documentAnalysis.error}
                                            onClear={documentAnalysis.clear}
                                            language={language}
                                        />

                                        {/* ---- F2: Análisis de app ---- */}
                                        <AppAnalysisPanel
                                            analysis={integrationStore.appAnalysisArtifact}
                                            isAnalyzing={appAnalysis.isAnalyzing}
                                            error={appAnalysis.error}
                                            onClear={appAnalysis.clear}
                                            language={language}
                                        />

                                        {/* ---- F3/F4: Generación de documentos y video ---- */}
                                        <GenerationProgressPanel
                                            job={integrationStore.generationJob}
                                            result={documentGeneration.result}
                                            videoResult={documentGeneration.videoResult}
                                            isGenerating={documentGeneration.isGenerating}
                                            error={documentGeneration.error}
                                            language={language}
                                            onClear={documentGeneration.clear}
                                        />

                                        {/* ---- Upload zone for image digitalization (OCR) — AL FINAL ---- */}
                                        <div className="frame-content__upload-zone">
                                            {!uploadedImage ? (
                                                <div
                                                    className="flu-upload-zone__drop"
                                                    onDragOver={(e) => e.preventDefault()}
                                                    onDrop={handleFileDrop}
                                                >
                                                    <p className="flu-upload-zone__hint">Arrastra una imagen aquí</p>
                                                    <p className="flu-upload-zone__or">— o —</p>
                                                    <div className="flu-upload-zone__buttons">
                                                        <button
                                                            type="button"
                                                            className="flu-btn"
                                                            onClick={() => fileInputRef.current?.click()}
                                                        >
                                                            📁 Seleccionar archivo
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="flu-btn flu-btn--camera"
                                                            onClick={() => cameraInputRef.current?.click()}
                                                        >
                                                            📷 Tomar foto
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="flu-btn"
                                                            onClick={() => docInputRef.current?.click()}
                                                        >
                                                            📄 Analizar documento
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="flu-btn"
                                                            onClick={() => projectInputRef.current?.click()}
                                                        >
                                                            🧭 Analizar app
                                                        </button>
                                                    </div>
                                                    <input
                                                        ref={fileInputRef}
                                                        type="file"
                                                        accept="image/*"
                                                        hidden
                                                        onChange={handleFileSelected}
                                                    />
                                                    <input
                                                        ref={cameraInputRef}
                                                        type="file"
                                                        accept="image/*"
                                                        capture="environment"
                                                        hidden
                                                        onChange={handleFileSelected}
                                                    />
                                                    <input
                                                        ref={docInputRef}
                                                        type="file"
                                                        accept=".xlsx,.xlsm,.pdf,.docx,.pptx,.csv,.txt,.md,text/*,application/pdf"
                                                        hidden
                                                        onChange={handleDocumentFileSelected}
                                                    />
                                                    <input
                                                        ref={projectInputRef}
                                                        type="file"
                                                        multiple
                                                        hidden
                                                        onChange={handleProjectFolderSelected}
                                                        {...({ webkitdirectory: '', directory: '' } as any)}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flu-upload-zone__preview">
                                                    <img
                                                        className="flu-upload-zone__img"
                                                        src={uploadedImage.dataUrl}
                                                        alt="Tarea subida"
                                                    />
                                                    <div className="flu-upload-zone__actions">
                                                        {isAnalyzing && (
                                                            <span className="flu-upload-zone__analyzing">🔍 Analizando con IA...</span>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className="flu-btn flu-btn--danger"
                                                            onClick={handleClearImage}
                                                        >
                                                            ✕ Quitar
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </PanelFrame>
                            </FluTabPanel>

                            {/* Conversation Tab */}
                            <FluTabPanel tabId="conversation" activeTab={activeTab} className="flu-tab-panel--conversation">
                                <PanelFrame
                                    frameId={FLU_CONFIG.frames?.conversation || 'conversation'}
                                    title={FLU_CONFIG.ui?.workspace?.visibleLabels?.log || 'Bitácora'}
                                    subtitle={FLU_CONFIG.ui?.workspace?.conversationSubtitle || 'Transcripción en vivo de la conversación'}
                                    className="panel-frame--log"
                                    expandable={true}
                                    {...{
                                        expandedFrameId,
                                        onToggleExpand: handleToggleExpand,
                                    } as any}
                                >
                                    {/* OS3 parity: live phrase display above conversation log — sin label para ahorrar espacio */}
                                    <div className="conversation-live-phrase frame-content__response">
                                        <div className="conversation-live-phrase__scroll">
                                            <span>{liveTranscript || integrationStore.currentTranscript || '\u00a0'}</span>
                                        </div>
                                    </div>
                                    <ConversationLogAny
                                        entries={integrationStore.conversationHistory}
                                        emptyLabel={FLU_CONFIG.ui?.workspace?.conversationEmpty || 'Sin conversación'}
                                    />
                                </PanelFrame>

                                <PanelFrame
                                    frameId={FLU_CONFIG.frames?.voiceProfiles || 'voiceProfiles'}
                                    title={FLU_CONFIG.ui?.workspace?.participantsTitle || 'Participantes'}
                                    className="panel-frame--participants"
                                    expandable={true}
                                    {...{
                                        expandedFrameId,
                                        onToggleExpand: handleToggleExpand,
                                    } as any}
                                >
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    <VoiceProfilesPanel {...({
                                        // OS2 parity: sessionParticipants = history participants + voice profiles
                                        // Memoized via voiceParticipants useMemo to avoid recomputation on every render.
                                        participants: voiceParticipants,
                                        onRenameProfile: handleRenameProfile,
                                        onRenameSessionSpeaker: handleRenameProfile,
                                        onRemoveParticipant: handleRemoveParticipant,
                                    } as any)} />
                                </PanelFrame>
                            </FluTabPanel>

                            {/* Minutes Tab */}
                            <FluTabPanel tabId="minutes" activeTab={activeTab} className="flu-tab-panel--minutes">
                                <PanelFrame
                                    frameId={FLU_CONFIG.frames?.minute || 'minute'}
                                    title={FLU_CONFIG.ui?.workspace?.visibleLabels?.summary || 'Minuta'}
                                    className="panel-frame--minute"
                                    expandable={true}
                                    {...{
                                        expandedFrameId,
                                        onToggleExpand: handleToggleExpand,
                                    } as any}
                                >
                                    <div className="minute-actions-row" style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                                        <button
                                            type="button"
                                            className="flu-btn flu-btn--primary"
                                            onClick={() => handleGenerateSummary({ announce: true })}
                                            disabled={!isSupported || isSummarizing}
                                        >
                                            {isSummarizing
                                                ? `${FLU_CONFIG.ui?.buttons?.generateMinute || 'Generar Minuta'}...`
                                                : FLU_CONFIG.ui?.buttons?.generateMinute || 'Generar Minuta'}
                                        </button>
                                        <button
                                            type="button"
                                            className="flu-btn"
                                            onClick={() => minutePanelRef.current?.save()}
                                        >
                                            {FLU_CONFIG.ui?.buttons?.saveMinute || 'Guardar Minuta'}
                                        </button>
                                    </div>
                                    <MinuteDraftPanelAny
                                        ref={minutePanelRef}
                                        draft={minuteDraft}
                                        onChange={setMinuteDraft}
                                        onSave={handleSaveMinute}
                                        emptyLabel={FLU_CONFIG.ui?.workspace?.minuteDraftEmpty || 'Sin borrador de minuta'}
                                    />
                                </PanelFrame>

                                <PanelFrame
                                    frameId={FLU_CONFIG.frames?.history || 'history'}
                                    title={FLU_CONFIG.ui?.workspace?.visibleLabels?.history || 'Historial de minutas'}
                                    className="panel-frame--history"
                                    expandable={true}
                                    {...{
                                        expandedFrameId,
                                        onToggleExpand: handleToggleExpand,
                                    } as any}
                                >
                                    <MinuteHistoryPanel
                                        entries={minuteKnowledge.minutes as any}
                                        selectedId={selectedMinuteId || undefined}
                                        onSelect={handleSelectMinuteHistory}
                                        emptyLabel={FLU_CONFIG.ui?.workspace?.minuteHistoryEmpty || 'Sin minutas guardadas'}
                                    />
                                </PanelFrame>
                            </FluTabPanel>

                            {/* Settings Tab — OS2 parity structure */}
                            <FluTabPanel tabId="settings" activeTab={activeTab} className="flu-tab-panel--settings">
                                <PanelFrame
                                    frameId="settings"
                                    title="Configuración"
                                    className="panel-frame--settings"
                                    expandable={true}
                                    {...{
                                        expandedFrameId,
                                        onToggleExpand: handleToggleExpand,
                                    } as any}
                                >
                                    <FluSettingsPanel
                                        language={language}
                                        apiKey={apiKey}
                                        textModel={textModel}
                                        textApiUrl={textApiUrl}
                                        imageModel={imageModel}
                                        imageApiKey={imageApiKey}
                                        imageApiUrl={imageApiUrl}
                                        ocrApiKey={ocrApiKey}
                                        ocrModel={ocrModel}
                                        ocrApiUrl={ocrApiUrl}
                                        voices={voices}
                                        handleTextModelCommit={handleTextModelCommit}
                                        handleTextApiKeyCommit={handleTextApiKeyCommit}
                                        handleTextApiUrlCommit={handleTextApiUrlCommit}
                                        handleImageModelCommit={handleImageModelCommit}
                                        handleImageApiKeyCommit={handleImageApiKeyCommit}
                                        handleImageApiUrlCommit={handleImageApiUrlCommit}
                                        handleOcrApiKeyCommit={handleOcrApiKeyCommit}
                                        handleOcrModelCommit={handleOcrModelCommit}
                                        handleOcrApiUrlCommit={handleOcrApiUrlCommit}
                                        onClearCache={handleClearCache}
                                        wakeWords={wakeWords}
                                        setWakeWords={setWakeWords}
                                        debugLogsEnabled={debugLogsEnabled}
                                        setDebugLogsEnabled={setDebugLogsEnabled}
                                        handleParticipantConfigChange={handleParticipantConfigChange}
                                        // ---- Branding Inteligente por Temporalidad ----
                                        brandingMode={branding.config.mode}
                                        brandingSeason={branding.config.activeSeason}
                                        brandingBirthday={branding.config.birthday}
                                        brandingCelebrateAchievements={branding.config.celebrateAchievements}
                                        onBrandingModeChange={branding.seasonalActions.setMode}
                                        onBrandingSeasonChange={branding.seasonalActions.setActiveSeason}
                                        onBrandingBirthdayChange={branding.seasonalActions.setBirthday}
                                        onBrandingCelebrateAchievementsChange={branding.seasonalActions.setCelebrateAchievements}
                                        // ---- AI Provider Selection ----
                                        aiProvider={aiProvider}
                                        setAiProvider={handleSetAiProvider}
                                    />
                                </PanelFrame>
                            </FluTabPanel>

                            {/* System Tab — Autonomous Systems Monitoring */}
                            <FluTabPanel tabId="system" activeTab={activeTab} className="flu-tab-panel--system">
                                <PanelFrame
                                    frameId="autonomy"
                                    title="Sistemas Autónomos"
                                    className="panel-frame--autonomy"
                                    expandable={true}
                                    {...{
                                        expandedFrameId,
                                        onToggleExpand: handleToggleExpand,
                                    } as any}
                                >
                                    <AutonomyStatusPanel />
                                </PanelFrame>
                            </FluTabPanel>
                        </div>
                    </div>
                </div>
            </div>

            {/* Indicador visual de procesamiento de IA (FLU pensando) */}
            <ThinkingIndicator />
                </main>

            {/* Workspace Image Overlay removed - now displayed in workspace panel */}
        </ErrorBoundary>
    );
}

export default App;
