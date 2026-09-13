// ============================================================
// IntegrationStore — Estado Global del Orquestador OS3
// ============================================================
// Store Zustand que mantiene el estado orquestado entre
// el avatar 3D (OS1) y los servicios de voz (OS2).
// Incluye historial de conversación, estado emocional,
// estadísticas de sesión y ciclo de conversación automático.
//
// Cumple:
//   - Rule #1: NO HARDCODE — configuración desde appConfig
//   - Obligación #6: UUIDv4 en toda inserción
//   - Obligación #7: Sync tuple [revision, updated_at, deleted]
// ============================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { resolveSafeStorage } from './storage';
import { v4 as uuidv4 } from 'uuid';
import { relayLog } from '../lib/clientLogRelay';
import { newSyncTuple, type SyncTuple } from '../core/db/fluDatabase';
import {
    DEFAULT_PERSONALITY,
    UI_DEFAULTS,
    SENTIMENT_KEYWORDS,
    TOPIC_KEYWORDS,
    FLU_PROFILES,
    getDefaultProfile,
    DEFAULT_IMAGE_CONFIG,
    DEFAULT_VOICE_CONFIG,
    DEFAULT_ADVANCED_CONFIG,
} from '../core/config/appConfig';
import { resolveContextualExpression } from '../core/anim/emotionEngine';
import type { MinuteUIEntry } from '../hooks/useMinuteKnowledge';
import type {
    ConversationState,
    VoiceBridgeEvent,
    BridgeConfig,
    ConversationEntry,
    EmotionalState,
    SessionStats,
    WorkspaceEntry,
    FluProfile,
    ImageConfig,
    VoiceConfig,
    AdvancedConfig,
    PersonalityConfig,
    FluProfileDefinition,
} from '../types/bridge';
import type {
    DocumentContract,
    AppAnalysisContract,
    GenerationJob,
} from '../types/documentContracts';

// -----------------------------------------------------------
// Tipos del Store
// -----------------------------------------------------------

/**
 * Origen de la emoción pendiente para el avatar.
 * - 'ai': retorno de Gemini (App.tsx).
 * - 'participant': mano alzada ignorada/rechazada (participant floor).
 * - 'game': emoción producida por un motor de juego (fast-path determinista).
 * - null: sin origen (reset manual).
 */
export type EmotionSource = 'ai' | 'participant' | 'game' | null;

export interface UIState {
    /** Indicador de si el micrófono está activo */
    isMicActive: boolean;
    /** Indicador de si FLU está hablando actualmente */
    isFluSpeaking: boolean;
    /**
     * Animaciones de emoción pendientes (ya resueltas desde EXPRESSION_MAP).
     * App.tsx escribe aquí ANTES de setConversationState('SPEAKING').
     * useAvatarVoiceSync lee y consume en el efecto de SPEAKING.
     */
    pendingEmotionAnims: string[];
    /**
     * Origen de la emoción pendiente: 'ai' (retorno de Gemini, App.tsx) o
     * 'participant' (mano alzada ignorada/rechazada). El reset de 7s SOLO
     * aplica a source='ai'. Las emociones del participante persisten.
     */
    pendingEmotionSource: EmotionSource;
    /**
     * Modo de sostenimiento de la emoción pendiente (Regla 3):
     * - 'fixed': duración fija (8s acciones / 7s emociones de IA) — comportamiento normal.
     * - 'song': se sostiene MIENTRAS suene la canción ("canta la canción X").
     * - null: sin modo especial.
     */
    pendingEmotionSustainMode: 'fixed' | 'song' | null;
    /**
     * Señal de comando de voz desde VoiceAssistantBar hacia FluAvatarVoiceBridge.
     * FluAvatarVoiceBridge observa esta señal en un useEffect y ejecuta la acción.
     * Se resetea a null después de ser consumida.
     */
    voiceCommand: 'start-listening' | 'stop-listening' | 'toggle-listening' | 'start-conversation' | null;
    /**
     * Indicador de que FLU está procesando una solicitud de IA (pensando).
     * Alimenta el indicador visual de procesamiento (ThinkingIndicator).
     * Es efímero: se activa al iniciar la llamada a la IA y se desactiva al
     * resolver (éxito o error). No se persiste (ver partialize).
     */
    isThinking: boolean;
}

export interface IntegrationState {
    /** Estado actual del ciclo de conversación */
    conversationState: ConversationState;
    /** Último evento del puente de voz */
    lastBridgeEvent: VoiceBridgeEvent | null;
    /** Transcripción actual (lo que el usuario está diciendo) */
    currentTranscript: string;
    /** §9 Última frase canónica commiteada (fuente única de la frase visible) */
    lastCommittedTranscript: string;
    /** Texto de la última respuesta de FLU */
    lastResponse: string;
    /** Historial completo de la conversación */
    conversationHistory: ConversationEntry[];
    /** Estado emocional actual del avatar */
    emotionalState: EmotionalState;
    /** Historial de eventos (para depuración) */
    eventLog: VoiceBridgeEvent[];
    /** Configuración del puente */
    config: BridgeConfig;
    /** Estado UI agrupado (isMicActive, isFluSpeaking, pendingEmotionAnims, voiceCommand) */
    uiState: UIState;
    /** Contador de interacciones de la sesión */
    interactionCount: number;
    /** Estadísticas de la sesión */
    sessionStats: SessionStats;
    /** Historial de minutas generadas */
    minuteHistory: MinuteUIEntry[];
    /** Artifacto activo del workspace (salida única de IA, como OS2 workspaceArtifact) */
    workspaceArtifact: WorkspaceEntry | null;
    /** Artifacto del análisis de documentos (F1 — documento analizado por IA) */
    documentArtifact: DocumentContract | null;
    /** Artifacto del análisis de funcionalidad de la app (F2) */
    appAnalysisArtifact: AppAnalysisContract | null;
    /** Job activo de generación de documento/video (F3/F4) */
    generationJob: GenerationJob | null;
    /** Timestamps para calcular tiempo de respuesta */
    _thinkingStart: number;
    /** Última emoción/animación devuelta por Gemini (para monitoreo) */
    lastGeminiEmotion: string;
    /** Sync tuple del store */
    sync: SyncTuple;

    // ============================================================
    // FLU Configurator — Estado de Personalidad, Imagen, Voz y Avanzado
    // ============================================================
    /** Perfil activo de FLU (administrativo | profesor | estudiante) */
    profile: FluProfile;
    /** Configuración de imagen activa (gorra/pelo) */
    imageConfig: ImageConfig;
    /** Configuración de voz activa */
    voiceConfig: VoiceConfig;
    /** Configuración avanzada activa */
    advancedConfig: AdvancedConfig;
    /** Lista completa de perfiles disponibles (variable, futuro CRUD) */
    availableProfiles: FluProfileDefinition[];
}

export interface IntegrationActions {
    /** Cambiar el estado de la conversación */
    setConversationState: (state: ConversationState) => void;
    /** Registrar un evento del puente de voz */
    pushBridgeEvent: (event: VoiceBridgeEvent) => void;
    /** Actualizar la transcripción actual */
    setCurrentTranscript: (transcript: string) => void;
    /** §9 Escribir la última frase canónica commiteada (fuente única visible) */
    setLastCommittedTranscript: (transcript: string) => void;
    /** Registrar la última respuesta de FLU */
    setLastResponse: (response: string) => void;

    /** Añadir una entrada al historial de conversación */
    addConversationEntry: (entry: ConversationEntry) => void;
    /** Detectar sentimiento de un texto y añadirlo al historial */
    addUserMessage: (text: string, speakerName?: string) => void;
    addFluMessage: (text: string) => void;
    /** Añadir un mensaje de sistema al historial de conversación */
    addSystemMessage: (text: string) => void;
    /** Cargar historial completo desde DB (sin side effects) */
    batchLoadHistory: (entries: ConversationEntry[]) => void;
    /** Eliminar del historial todas las entradas de un hablante (por speakerName) */
    removeConversationEntriesBySpeaker: (label: string) => void;
    /** Cambiar estado emocional */
    setEmotionalState: (state: EmotionalState) => void;
    /** Detectar emoción automática según el texto */
    detectAndSetEmotion: (text: string) => EmotionalState;
    /** Actualizar estado del micrófono */
    setMicActive: (active: boolean) => void;
    /** Actualizar estado de habla de FLU */
    setFluSpeaking: (speaking: boolean) => void;
    /** Indicar que FLU está procesando una solicitud de IA (pensando) */
    setThinking: (isThinking: boolean) => void;
    /** Incrementar contador de interacciones */
    incrementInteractionCount: () => void;
    /** Actualizar configuración */
    setConfig: (config: Partial<BridgeConfig>) => void;
    /** Limpiar el log de eventos */
    clearEventLog: () => void;
    /** Limpiar el historial de conversación */
    clearHistory: () => void;
    /** Resetear historial de conversación + stats (OS2 resetConversationUi) */
    resetConversationHistory: () => void;
    /** Resetear todo el estado */
    reset: () => void;
    /** Agregar una minuta al historial */
    addMinute: (minute: MinuteUIEntry) => void;
    /** Eliminar una minuta del historial */
    deleteMinute: (id: string) => void;
    /** Guardar la última emoción/animación devuelta por Gemini */
    setLastGeminiEmotion: (emotion: string) => void;
    /** Establecer las animaciones de emoción pendientes para el próximo SPEAKING */
    setPendingEmotionAnims: (anims: string[], source?: EmotionSource, sustainMode?: 'fixed' | 'song' | null) => void;
    /** Establecer el artifacto activo del workspace (OS2 parity: workspaceArtifact) */
    setWorkspaceArtifact: (entry: WorkspaceEntry | null) => void;
    /** Limpiar el artifacto del workspace */
    clearWorkspace: () => void;
    /** Establecer el artifacto del análisis de documentos (F1) */
    setDocumentArtifact: (entry: DocumentContract | null) => void;
    /** Establecer el artifacto del análisis de la app (F2) */
    setAppAnalysisArtifact: (entry: AppAnalysisContract | null) => void;
    /** Establecer el job de generación de documento/video (F3/F4) */
    setGenerationJob: (job: GenerationJob | null) => void;
    /** Extraer puntos clave del historial de conversación */
    extractKeyPoints: () => string[];
    /** Enviar un comando de voz que FluAvatarVoiceBridge consumirá */
    sendVoiceCommand: (command: 'start-listening' | 'stop-listening' | 'toggle-listening' | 'start-conversation') => void;
    /** Consumir el comando de voz actual (lo resetea a null) */
    consumeVoiceCommand: () => void;

    // ============================================================
    // FLU Configurator — Acciones
    // ============================================================
    /** Establecer el perfil activo y aplicar su configuración */
    setProfile: (profile: FluProfile) => void;
    /** Establecer configuración de imagen (gorra/pelo) */
    setImageConfig: (config: Partial<ImageConfig>) => void;
    /** Establecer configuración de voz */
    setVoiceConfig: (config: Partial<VoiceConfig>) => void;
    /** Establecer configuración avanzada */
    setAdvancedConfig: (config: Partial<AdvancedConfig>) => void;
    /** Establecer configuración de personalidad (rasgos, tono, proactividad, emoción, instrucciones) */
    setPersonality: (config: Partial<PersonalityConfig>) => void;
    /** Aplicar un perfil completo (imagen + personalidad + voz + avanzado) */
    applyProfile: (profileId: FluProfile) => void;
}

export type IntegrationStore = IntegrationState & IntegrationActions;

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/** Generar UUIDv4 — Obligación #6 */
function nextId(): string {
    return uuidv4();
}

/**
 * Recorta el historial de conversación al tope configurado (§ UI_DEFAULTS).
 * Sin esto el historial crecía sin límite y cada backup lo duplicaba.
 */
function capConversationHistory(entries: ConversationEntry[]): ConversationEntry[] {
    const limit = UI_DEFAULTS.CONVERSATION_HISTORY_LIMIT;
    return entries.length > limit ? entries.slice(-limit) : entries;
}

/**
 * Detección simple de sentimiento basada en palabras clave.
 */
export function detectSentiment(text: string): ConversationEntry['sentiment'] {
    const lower = text.toLowerCase();
    const { positives, negatives, questions } = SENTIMENT_KEYWORDS;

    const hasPositive = positives.some((w) => lower.includes(w));
    const hasNegative = negatives.some((w) => lower.includes(w));
    const isQuestion = questions.some((w) => lower.startsWith(w) || lower.includes(w));

    // Check question FIRST so that questions containing negative words
    // (e.g. "¿Cómo puedo resolver este problema?") are classified as questions,
    // not as negative. This matches OS2 behavior.
    if (isQuestion) return 'question';
    if (hasNegative) return 'negative';
    if (hasPositive) return 'positive';
    return 'neutral';
}

/**
 * Mapeo de sentimiento a estado emocional del avatar.
 * DATA-DRIVEN: delega al EmotionEngine resolveContextualExpression
 * que retorna emotionalState directamente — eliminando switch duplicado.
 */
function sentimentToEmotion(sentiment: ConversationEntry['sentiment']): EmotionalState {
    const resolved = resolveContextualExpression(sentiment);
    // El EmotionEngine ya mapeó sentiment → emotionalState internamente
    return resolved.emotionalState ?? 'neutral';
}

// -----------------------------------------------------------
// Configuración por defecto (desde appConfig centralizado)
// -----------------------------------------------------------

const defaultProfile = getDefaultProfile();

const defaultConfig: BridgeConfig = {
    language: UI_DEFAULTS.LANGUAGE,
    showStateIndicator: true,
    debug: false,
    idleTimeoutMs: UI_DEFAULTS.IDLE_TIMEOUT_MS,
    autoCycle: false,
    pushToTalk: false,
    personality: {
        ...DEFAULT_PERSONALITY,
        profile: defaultProfile.id,
        image: { ...defaultProfile.image },
        voice: { ...defaultProfile.voice },
        advanced: { ...defaultProfile.advanced },
    },
};

const initialState: IntegrationState = {
    conversationState: 'IDLE',
    lastBridgeEvent: null,
    currentTranscript: '',
    lastCommittedTranscript: '',
    lastResponse: '',
    conversationHistory: [],
    emotionalState: 'neutral',
    eventLog: [],
    config: defaultConfig,
    uiState: {
        isMicActive: false,
        isFluSpeaking: false,
        pendingEmotionAnims: [],
        pendingEmotionSource: null,
        pendingEmotionSustainMode: null,
        voiceCommand: null,
        isThinking: false,
    },
    interactionCount: 0,
    sessionStats: {
        totalInteractions: 0,
        totalUserMessages: 0,
        totalFluMessages: 0,
        sessionStartTime: Date.now(),
        averageResponseTime: 0,
        emotionalDistribution: {},
    },
    minuteHistory: [],
    workspaceArtifact: null,
    documentArtifact: null,
    appAnalysisArtifact: null,
    generationJob: null,
    lastGeminiEmotion: '',
    _thinkingStart: 0,
    sync: newSyncTuple(),
    // FLU Configurator — estado inicial
    profile: defaultProfile.id,
    imageConfig: { ...defaultProfile.image },
    voiceConfig: { ...defaultProfile.voice },
    advancedConfig: { ...defaultProfile.advanced },
    availableProfiles: [...FLU_PROFILES],
};

export const useIntegrationStore = create<IntegrationStore>()(
    persist(
        (set, get) => ({
            ...initialState,

            setConversationState: (state: ConversationState) => {
                const current = get();
                // No-op si el estado no cambia: evita escrituras redundantes,
                // re-renders en cascada y bucles (ej: setConversationState('ERROR') repetido).
                if (current.conversationState === state) return;
                const now = Date.now();
                const prevState = current.conversationState;
                relayLog('LOG', 'IntegrationStore', `setConversationState(${state}) — prev=${prevState}`);
                const patch: Record<string, any> = { conversationState: state };

                // Si estamos entrando a THINKING, registrar el timestamp
                if (state === 'THINKING') {
                    patch._thinkingStart = now;
                }

                // Safety net: al salir de THINKING, apagar el indicador de
                // procesamiento (evita que el overlay quede "pegado").
                if (state !== 'THINKING' && current.uiState.isThinking) {
                    patch.uiState = { ...current.uiState, isThinking: false };
                }

                // Si estamos saliendo de THINKING a SPEAKING, calcular tiempo de respuesta
                if (state === 'SPEAKING' && current._thinkingStart > 0) {
                    const responseTime = now - current._thinkingStart;
                    const stats = current.sessionStats;
                    const newAvg = stats.averageResponseTime === 0
                        ? responseTime
                        : (stats.averageResponseTime * stats.totalFluMessages + responseTime) / (stats.totalFluMessages + 1);
                    patch.sessionStats = {
                        ...stats,
                        averageResponseTime: newAvg,
                    };
                }

                // Single set() call — combine all updates to avoid multiple re-renders
                set(patch);
            },

            pushBridgeEvent: (event: VoiceBridgeEvent) => {
                set((current) => ({
                    lastBridgeEvent: event,
                    eventLog: current.config.debug
                        ? [...current.eventLog.slice(-99), event]
                        : current.eventLog,
                }));
            },

            setCurrentTranscript: (transcript: string) => {
                set({ currentTranscript: transcript });
            },

            setLastCommittedTranscript: (transcript: string) => {
                set({ lastCommittedTranscript: transcript });
            },

            setLastResponse: (response: string) => {
                set({ lastResponse: response });
            },

            addConversationEntry: (entry: ConversationEntry) => {
                set((current) => ({
                    conversationHistory: capConversationHistory([...current.conversationHistory, entry]),
                }));
            },

            batchLoadHistory: (entries: ConversationEntry[]) => {
                set({ conversationHistory: capConversationHistory(entries) });
            },

            removeConversationEntriesBySpeaker: (label: string) => {
                const normalized = String(label || '').trim();
                if (!normalized) return;
                set((current) => ({
                    conversationHistory: current.conversationHistory.filter(
                        (entry) => String(entry.speakerName || '').trim() !== normalized,
                    ),
                }));
            },

            addUserMessage: (text: string, speakerName?: string) => {
                const sentiment = detectSentiment(text);
                // OS2 parity: default speaker label is 'Hablante 1', not 'Usuario'
                // OS2's activeListen.js resolveConversationSpeaker falls back to
                // cleanForSpeech(lastSpeaker) || speakers.defaultLabel ('Hablante 1')
                const resolvedSpeaker = speakerName || 'Hablante 1';
                const emotion = sentimentToEmotion(sentiment);
                const entry: ConversationEntry = {
                    role: 'user',
                    text,
                    timestamp: Date.now(),
                    sentiment,
                    id: nextId(),
                    speakerName: resolvedSpeaker,
                    response: '', // will be filled by addFluMessage
                };
                // Single set() call — combine conversation update + emotional state
                // to avoid two separate Zustand state updates (and two re-renders).
                set((current) => {
                    const stats = current.sessionStats;
                    const emoDist = { ...stats.emotionalDistribution };
                    const emoKey = sentiment || 'neutral';
                    emoDist[emoKey] = (emoDist[emoKey] || 0) + 1;
                    return {
                        conversationHistory: capConversationHistory([...current.conversationHistory, entry]),
                        emotionalState: emotion,
                        sessionStats: {
                            ...stats,
                            totalUserMessages: stats.totalUserMessages + 1,
                            totalInteractions: stats.totalInteractions + 1,
                            emotionalDistribution: emoDist,
                        },
                    };
                });
            },

            addSystemMessage: (text: string) => {
                const entry: ConversationEntry = {
                    role: 'system',
                    text,
                    timestamp: Date.now(),
                    id: nextId(),
                    speakerName: '⚙️ Sistema',
                };
                set((current) => ({
                    conversationHistory: capConversationHistory([...current.conversationHistory, entry]),
                }));
            },

            addFluMessage: (text: string) => {
                const entry: ConversationEntry = {
                    role: 'flu',
                    text,
                    timestamp: Date.now(),
                    id: nextId(),
                    speakerName: 'FLU',
                };
                set((current) => {
                    const history = current.conversationHistory;
                    const lastUserIdx = history.length - 1;
                    // Build new history in a single pass — avoid double array copy
                    const newHistory = new Array(history.length + 1);
                    for (let i = 0; i < history.length; i++) {
                        if (i === lastUserIdx && history[i].role === 'user') {
                            // Link response to last user message (OS2-style)
                            newHistory[i] = {
                                ...history[i],
                                response: text,
                                meta: { ...history[i].meta, response: text },
                            };
                        } else {
                            newHistory[i] = history[i];
                        }
                    }
                    newHistory[history.length] = entry;
                    return {
                        conversationHistory: newHistory,
                        sessionStats: {
                            ...current.sessionStats,
                            totalFluMessages: current.sessionStats.totalFluMessages + 1,
                        },
                    };
                });
            },

            setEmotionalState: (state: EmotionalState) => {
                set({ emotionalState: state });
            },

            detectAndSetEmotion: (text: string): EmotionalState => {
                const sentiment = detectSentiment(text);
                const emotion = sentimentToEmotion(sentiment);
                set({ emotionalState: emotion });
                return emotion;
            },

            setMicActive: (active: boolean) => {
                set((current) => ({ uiState: { ...current.uiState, isMicActive: active } }));
            },

            setFluSpeaking: (speaking: boolean) => {
                set((current) => ({ uiState: { ...current.uiState, isFluSpeaking: speaking } }));
            },
            setThinking: (isThinking: boolean) => {
                set((current) => ({ uiState: { ...current.uiState, isThinking } }));
            },

            incrementInteractionCount: () => {
                set((current) => ({ interactionCount: current.interactionCount + 1 }));
            },

            setConfig: (config: Partial<BridgeConfig>) => {
                set((current) => ({
                    config: { ...current.config, ...config },
                }));
            },

            clearEventLog: () => {
                set({ eventLog: [] });
            },

            clearHistory: () => {
                set({ conversationHistory: [] });
            },

            resetConversationHistory: () => {
                set({
                    conversationHistory: [],
                    lastResponse: '',
                    currentTranscript: '',
                    lastCommittedTranscript: '',
                    sessionStats: {
                        ...initialState.sessionStats,
                        sessionStartTime: Date.now(),
                    },
                    interactionCount: 0,
                    workspaceArtifact: null,
                });
            },

            addMinute: (minute: MinuteUIEntry) => {
                set((current) => ({
                    minuteHistory: [minute, ...current.minuteHistory],
                }));
            },

            deleteMinute: (id: string) => {
                set((current) => ({
                    minuteHistory: current.minuteHistory.filter((m) => m.id !== id),
                }));
            },

            setWorkspaceArtifact: (entry: WorkspaceEntry | null) => {
                set({ workspaceArtifact: entry });
            },

            clearWorkspace: () => {
                set({ workspaceArtifact: null });
            },

            setDocumentArtifact: (entry: DocumentContract | null) => {
                set({ documentArtifact: entry });
            },

            setAppAnalysisArtifact: (entry: AppAnalysisContract | null) => {
                set({ appAnalysisArtifact: entry });
            },

            setGenerationJob: (job: GenerationJob | null) => {
                set({ generationJob: job });
            },

            extractKeyPoints: (): string[] => {
                const { conversationHistory, emotionalState, sessionStats } = get();
                const points: string[] = [];
                const allText = conversationHistory.map((e) => e.text.toLowerCase()).join(' ');

                // Detectar temas mencionados (desde appConfig centralizado)
                const foundTopics: string[] = [];
                for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
                    if (keywords.some((kw) => allText.includes(kw))) {
                        foundTopics.push(topic);
                    }
                }
                if (foundTopics.length > 0) {
                    points.push(`Temas tratados: ${foundTopics.join(', ')}`);
                }

                // Detectar preguntas realizadas
                const questionCount = conversationHistory.filter(
                    (e) => e.role === 'user' && e.sentiment === 'question'
                ).length;
                if (questionCount > 0) {
                    points.push(`Preguntas realizadas: ${questionCount}`);
                }

                // Estado emocional
                points.push(`Estado emocional de la sesión: ${emotionalState}`);

                // Duración estimada
                const elapsed = Date.now() - sessionStats.sessionStartTime;
                const minutes = Math.round(elapsed / 60000);
                if (minutes > 0) {
                    points.push(`Duración de la sesión: ~${minutes} min`);
                }

                // Total de intercambios
                points.push(`Total de intercambios: ${conversationHistory.length}`);

                return points;
            },

            reset: () => {
                set({
                    ...initialState,
                    sessionStats: { ...initialState.sessionStats, sessionStartTime: Date.now() },
                    sync: newSyncTuple(),
                });
            },

            // ============================================================
            // FLU Configurator — Acciones
            // ============================================================

            setProfile: (profile: FluProfile) => {
                // Single set() call — combine profile + config update to avoid double re-render
                set((current) => ({
                    profile,
                    config: {
                        ...current.config,
                        personality: {
                            ...current.config.personality,
                            profile,
                        },
                    },
                }));
            },

            setImageConfig: (config: Partial<ImageConfig>) => {
                set((current) => {
                    const newImage = { ...current.imageConfig, ...config };
                    return {
                        imageConfig: newImage,
                        config: {
                            ...current.config,
                            personality: {
                                ...current.config.personality,
                                image: newImage,
                            },
                        },
                    };
                });
            },

            setVoiceConfig: (config: Partial<VoiceConfig>) => {
                set((current) => {
                    const newVoice = { ...current.voiceConfig, ...config };
                    return {
                        voiceConfig: newVoice,
                        config: {
                            ...current.config,
                            personality: {
                                ...current.config.personality,
                                voice: newVoice,
                            },
                        },
                    };
                });
            },

            setAdvancedConfig: (config: Partial<AdvancedConfig>) => {
                set((current) => {
                    const newAdvanced = { ...current.advancedConfig, ...config };
                    return {
                        advancedConfig: newAdvanced,
                        config: {
                            ...current.config,
                            personality: {
                                ...current.config.personality,
                                advanced: newAdvanced,
                            },
                        },
                    };
                });
            },

            setPersonality: (config: Partial<PersonalityConfig>) => {
                set((current) => ({
                    config: {
                        ...current.config,
                        personality: {
                            ...current.config.personality,
                            ...config,
                        },
                    },
                }));
            },

            applyProfile: (profileId: FluProfile) => {
                const profile = FLU_PROFILES.find((p) => p.id === profileId);
                if (!profile) return;

                set((current) => ({
                    profile: profile.id,
                    imageConfig: { ...profile.image },
                    voiceConfig: { ...profile.voice },
                    advancedConfig: { ...profile.advanced },
                    config: {
                        ...current.config,
                        personality: {
                            name: profile.personality.name,
                            traits: [...profile.personality.traits],
                            tone: profile.personality.tone,
                            proactivity: profile.personality.proactivity,
                            defaultEmotion: profile.personality.defaultEmotion,
                            profile: profile.id,
                            image: { ...profile.image },
                            voice: { ...profile.voice },
                            advanced: { ...profile.advanced },
                        },
                    },
                }));

                // Log startupPrompt as system message in conversation history
                if (profile.startupPrompt) {
                    const label = profile.label || profile.id;
                    const entry: ConversationEntry = {
                        role: 'system',
                        text: `🧠 Perfil "${label}" activado — ${profile.startupPrompt}`,
                        timestamp: Date.now(),
                        id: nextId(),
                        speakerName: '⚙️ Sistema',
                    };
                    set((current) => ({
                        conversationHistory: capConversationHistory([...current.conversationHistory, entry]),
                    }));
                }
            },

            sendVoiceCommand: (command) => {
                set((current) => ({ uiState: { ...current.uiState, voiceCommand: command } }));
            },

            consumeVoiceCommand: () => {
                set((current) => ({ uiState: { ...current.uiState, voiceCommand: null } }));
            },

            setLastGeminiEmotion: (emotion: string) => {
                set({ lastGeminiEmotion: emotion });
            },

            setPendingEmotionAnims: (anims: string[], source: EmotionSource = 'ai', sustainMode: 'fixed' | 'song' | null = null) => {
                set((current) => ({ uiState: { ...current.uiState, pendingEmotionAnims: anims, pendingEmotionSource: source, pendingEmotionSustainMode: sustainMode } }));
            },
        }),
        {
            name: 'flu-integration-store',
            version: 1,
            // Almacenamiento con fallback en memoria para entornos sin
            // localStorage (Node.js test runner). Fuente única en ./storage.
            storage: createJSONStorage(resolveSafeStorage),
            partialize: (state) => ({
                profile: state.profile,
                imageConfig: state.imageConfig,
                voiceConfig: state.voiceConfig,
                advancedConfig: state.advancedConfig,
                config: {
                    ...state.config,
                    personality: state.config.personality,
                },
            }),
            merge: (persisted, current) => ({
                ...current,
                ...(persisted as Partial<IntegrationStore>),
            }),
        }
    )
);

// -----------------------------------------------------------
// Exposición global para tests E2E (Playwright)
// -----------------------------------------------------------
if (typeof window !== 'undefined' && import.meta.env.DEV) {
    (window as any).__fluStore = useIntegrationStore;
}
