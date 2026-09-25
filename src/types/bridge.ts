// ============================================================
// FLU OS3 — Tipos del Puente de Integración
// ============================================================
// Define los tipos específicos del orquestador que conecta
// el avatar 3D (OS1) con los servicios de voz (OS2).
// ============================================================

import type { AvatarState, AvatarExpression } from '../avatar';

/**
 * Estados del ciclo de conversación integrado.
 * Combina la máquina de estados del avatar con el estado de la voz.
 */
export type ConversationState =
    | 'IDLE'           // Reposo — avatar idle, sin actividad de voz
    | 'LISTENING'      // Usuario hablando — avatar escuchando
    | 'THINKING'       // Procesando respuesta — avatar pensando
    | 'SPEAKING'       // FLU respondiendo — avatar hablando + animación boca
    | 'SLEEPING'       // Modo reposo profundo — avatar durmiendo
    | 'ERROR'          // Error en STT/TTS/IA
    | 'CELEBRATING';   // Logro/insignia

/**
 * Mapeo de ConversationState a AvatarState + AvatarExpression.
 */
export interface StateMapping {
    avatarState: AvatarState;
    expression: AvatarExpression | null;
    animations: string[];
}

/**
 * Eventos que el puente de voz puede emitir.
 */
export interface VoiceBridgeEvent {
    type: 'listening:start' | 'listening:end' | 'speaking:start' | 'speaking:end'
    | 'thinking:start' | 'thinking:end' | 'sleeping:start' | 'error' | 'conversation:turn';
    timestamp: number;
    payload?: unknown;
}

/**
 * Una entrada en el historial de conversación.
 * Compatible con OS2: speakerName, response, meta, signature, phase, navigation.
 */
export interface ConversationEntry {
    /** Rol: 'user' | 'flu' | 'system' */
    role: 'user' | 'flu' | 'system';
    /** Texto del mensaje (transcript) */
    text: string;
    /** Timestamp (epoch ms) */
    timestamp: number;
    /** Estado emocional detectado (opcional) */
    sentiment?: 'positive' | 'negative' | 'neutral' | 'question';
    /** ID único */
    id: string;
    /** Nombre del hablante (OS2: speakerName / speaker) */
    speakerName?: string;
    /**
     * Participante dueño de la entrada (aislamiento multiusuario del pizarrón).
     * Se sella al crear la fila con el participante activo; sin participante
     * queda sin definir (ruta legacy/global).
     */
    personId?: string;
    /** Respuesta de FLU a este mensaje (OS2: response) */
    response?: string;
    /** Metadatos adicionales (OS2: meta.response) */
    meta?: {
        response?: string;
        /** Marcador de evento del sistema (no controlado por Gemini) */
        systemEvent?: {
            type: 'participant_ignored' | 'participant_rejected' | 'participant_granted'
            | 'user_praise' | 'user_criticism' | 'topic_change' | 'interruption_detected';
            participantName?: string;
            waitedMs?: number;
            reason?: string;
            praiseText?: string;
            criticismText?: string;
            previousTopic?: string;
            newTopic?: string;
            interruptionText?: string;
        };
    };
    /** Firma de embedding (OS2: signature) */
    signature?: number[] | null;
    /** Fase de la conversación (OS2: phase) */
    phase?: string;
    /** Navegación / comando (OS2: navigation) */
    navigation?: Record<string, unknown> | null;
}

/**
 * Estados emocionales del avatar.
 */
export type EmotionalState =
    | 'neutral'
    | 'happy'
    | 'curious'
    | 'thoughtful'
    | 'surprised'
    | 'sad'
    | 'excited';

/**
 * Perfiles contextuales de FLU.
 * Variable y configurable — en futuro vendrá de un CRUD/mantenimiento.
 */
export type FluProfile =
    | 'administrativo'
    | 'profesor'
    | 'estudiante'
    | 'animador';

/**
 * Configuración de imagen del avatar (componentes visuales).
 * Los elementos los define OS1 (BunnyComponent).
 */
export interface ImageConfig {
    /** Gorra visible (Bunny_cap) */
    capVisible: boolean;
    /** Pelo/fleco visible (Bunny_bangs) */
    hairVisible: boolean;
}

/**
 * Configuración de voz para TTS.
 */
export interface VoiceConfig {
    apiKey?: string;
    model?: string;
    /** URI de la voz seleccionada (voiceURI de SpeechSynthesisVoice) */
    voiceURI: string;
    /** Nombre de la voz seleccionada */
    voiceName: string;
    /** Velocidad de habla (0.5 - 2.0) */
    rate: number;
    /** Tono de voz (0.5 - 2.0, default 1.0) */
    pitch: number;
    /** Volumen de voz (0.0 - 1.0, default 1.0) */
    volume: number;
}

/**
 * Configuración avanzada de comportamiento.
 */
export interface AdvancedConfig {
    /** Velocidad de animación del avatar (0.5 - 2.0) */
    animationSpeed: number;
    /** Reactividad emocional: qué tan exageradas son las expresiones (0-1) */
    emotionalReactivity: number;
    /** Creatividad IA: temperature para Gemini (0-1) */
    creativity: number;
    /**
     * Orientación del modelo 3D (rotación en radianes sobre el eje Y).
     * Controla hacia dónde mira el avatar en el espacio 3D.
     * Valor por defecto: 0.525 (~30°) para mirar al pizarrón.
     */
    orientation: number;

    // ============================================================
    // User Emotion Detector — thresholds (0-1)
    // ============================================================
    /** Minimum confidence threshold to report an emotion detection */
    emotionMinConfidence: number;
    /** Max confidence boost for multiple pattern matches */
    emotionMaxBoost: number;
    /** Boost per additional match */
    emotionBoostPerMatch: number;
    /** Base confidence for praise/criticism/interruption detection */
    emotionBaseDetectionConfidence: number;
    /** Low confidence for short utterance interruption */
    emotionLowInterruptionConfidence: number;
    /** Word count threshold for short utterance interruption */
    emotionShortUtteranceWordCount: number;
    /** Topic change: word overlap ratio threshold (below = topic change) */
    emotionTopicChangeOverlapRatio: number;
    /** Topic change: minimum words required in current text */
    emotionTopicChangeMinWords: number;
    /** Topic change: confidence for explicit indicator match */
    emotionTopicChangeExplicitConfidence: number;
    /** Topic change: confidence for low-overlap detection */
    emotionTopicChangeOverlapConfidence: number;

    // ============================================================
    // Theory of Mind — limits
    // ============================================================
    /** Max participants to track simultaneously */
    tomMaxParticipants: number;
    /** Max topics to remember per participant */
    tomMaxTopicsPerParticipant: number;
    /** Max emotions to remember per participant */
    tomMaxEmotionsPerParticipant: number;
    /** How long without interaction before considering a participant "inactive" (ms) */
    tomParticipantInactivityMs: number;
    /** Minimum word length to consider as a potential topic */
    tomMinTopicWordLength: number;
    /** Max items to show in summary per category */
    tomSummaryDisplayLimit: number;
    /** Max questions/expertise topics to track per participant */
    tomMaxQuestionsPerParticipant: number;

    // ============================================================
    // System Event Log — window & dedup
    // ============================================================
    /** Window in ms: only events within this window are passed to Gemini */
    systemEventWindowMs: number;
    /** Default dedup bucket in ms */
    systemEventDedupBucketMs: number;
}

/**
 * Definición completa de un perfil de FLU.
 * Cada perfil agrupa: imagen + personalidad + voz + avanzado.
 */
export interface FluProfileDefinition {
    /** ID único del perfil */
    id: FluProfile;
    /** Nombre visible */
    label: string;
    /** Descripción del perfil */
    description: string;
    /** Configuración de imagen (gorra/pelo) */
    image: ImageConfig;
    /** Personalidad asociada al perfil */
    personality: Omit<PersonalityConfig, 'profile' | 'image' | 'voice' | 'advanced'>;
    /** Voz asociada al perfil */
    voice: VoiceConfig;
    /** Avanzado asociado al perfil */
    advanced: AdvancedConfig;
    /**
     * Orientación del modelo 3D (rotación en radianes sobre el eje Y).
     * Controla hacia dónde mira el avatar en el espacio 3D.
     * Valor por defecto: 0.35 (~20°). Ajustado a 0.525 (~30°) para mirar al pizarrón.
     */
    orientation?: number;
    /**
     * Prompt de arranque FLU: definición de personalidad que se inyecta
     * en el system prompt de Gemini al inicio de cada sesión.
     * Permite que la IA se comporte según la personalidad definida en el perfil.
     */
    startupPrompt?: string;
}

/**
 * Personalidad del avatar — extendida con perfil, imagen, voz y avanzado.
 */
export interface PersonalityConfig {
    /** Nombre del avatar */
    name: string;
    /** Adjetivos de personalidad */
    traits: string[];
    /** Tono de voz por defecto */
    tone: 'friendly' | 'formal' | 'playful' | 'calm';
    /** Nivel de proactividad (0-1) */
    proactivity: number;
    /** Emoción por defecto */
    defaultEmotion: EmotionalState;
    /** Perfil activo */
    profile: FluProfile;
    /** Configuración de imagen */
    image: ImageConfig;
    /** Configuración de voz */
    voice: VoiceConfig;
    /** Configuración avanzada */
    advanced: AdvancedConfig;
    /**
     * Instrucciones personalizadas para Gemini (texto libre).
     * Se inyectan al final del system prompt para que FLU
     * adopte comportamientos, gestos o estilos específicos.
     * Ej: "Sé más expresivo, usa gestos con las manos,
     *      sé amable y cercano, muévete al hablar"
     */
    customInstructions?: string;
}

/**
 * Configuración del puente de integración.
 */
export interface BridgeConfig {
    /** Idioma para TTS (por defecto 'es') */
    language: string;
    /** Mostrar indicadores visuales de estado */
    showStateIndicator: boolean;
    /** Habilitar logs de depuración */
    debug: boolean;
    /** Tiempo de espera para volver a IDLE después de hablar (ms) */
    idleTimeoutMs: number;
    /** Habilitar ciclo automático (listen → think → speak → listen) */
    autoCycle: boolean;
    /** Push-to-talk: mantener tecla para hablar */
    pushToTalk: boolean;
    /** Personalidad del avatar */
    personality: PersonalityConfig;
}

/**
 * Una entrada en el historial de minutas generadas.
 * OS2 parity: matches normalizeMinuteKnowledgeRecord structure.
 * NO contenido/puntos_clave — those do NOT exist in OS2.
 */
export interface MinuteEntry {
    id: string;
    profileId: string;
    userId: string;
    minuteKey: string;
    historyCode: string;
    description: string;
    summarySnapshot: {
        titulo: string;
        participantes: string[];
        resumen: string;
        acuerdos: string[];
        pendientes: string[];
        siguientes_pasos: string[];
        tema_sesion: string;
    };
    sequence: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Una entrada en el workspace (salida activa de IA).
 */
export interface WorkspaceEntry {
    id: string;
    /**
     * Participante dueño del artefacto (aislamiento multiusuario del pizarrón).
     * Se sella al establecer el artefacto con el participante activo; sin
     * participante queda sin definir (ruta legacy/global).
     */
    personId?: string;
    /** Texto de la respuesta de FLU */
    respuesta: string;
    /** Título del contenido workspace (desde Gemini contract) */
    titulo?: string;
    /** Tipo de contenido workspace (desde Gemini contract) */
    tipo?: 'text' | 'image_prompt' | 'diagram' | '3d' | 'horario' | 'doc' | 'video' | null;
    /** Modo de visualización del horario de clases (solo cuando tipo === 'horario') */
    modo?: 'semana' | 'dia' | 'proxima' | 'recordatorios';
    /** Contenido textual del workspace (desde Gemini contract) */
    contenido?: string;
    /** Prompt visual para generación de imágenes (desde Gemini contract) */
    prompt_visual?: string;
    /** Puntos clave extraídos de la conversación */
    puntos_clave: string[];
    /** Origen del contenido: 'web' (navegación/búsqueda) o 'ia' (respuesta de Gemini) */
    origen?: 'web' | 'ia';
    /** Timestamp de generación */
    timestamp: number;
}

/**
 * Estadísticas de la sesión.
 */
export interface SessionStats {
    totalInteractions: number;
    totalUserMessages: number;
    totalFluMessages: number;
    sessionStartTime: number;
    averageResponseTime: number;
    emotionalDistribution: Record<string, number>;
}

/**
 * Diagnostics metadata for AI responses.
 * OS2 parity: provider, model, apiKeySource.
 */
export interface FluDiagnostics {
    provider: string;
    model: string;
    apiKeySource: string;
}

/**
 * Acción estructurada emitida por la IA (el "cerebro conversacional") cuando el
 * usuario pide, de forma natural, crear/consultar recordatorios, compras,
 * alarmas, temporizadores, notas, diario u horario.
 *
 * La IA decide la INTENCIÓN (dominio) y deja el TEXTO del mandato tal como lo
 * dijo el usuario; el despacho re-resuelve ese texto con los parsers
 * deterministas (fuente de verdad del parseo temporal/preciso) y ejecuta el
 * mismo manejador __fluHandle* que usa el modo offline. Así FLU es
 * conversacional (la IA entiende y responde) pero la ejecución es precisa.
 */
export interface FluAccion {
    /** Dominio al que pertenece la acción (calendario, compras, diario, nota). */
    dominio: 'agenda' | 'shopping' | 'diary' | 'note';
    /** Fragmento del mandato del usuario que dispara la acción (ej. "recuérdame comprar leche a las 7"). */
    texto: string;
}

/**
 * FLU Contract — structured response from AI (Gemini).
 * Contains spoken response, navigation commands, and optional workspace content.
 */
export interface FluContract {
    respuesta_voz: string;
    navegacion: {
        comando: string | null;
        destino: string | null;
        parametros: Record<string, unknown>;
    };
    workspace: {
        titulo: string;
        tipo: 'text' | 'image_prompt' | 'diagram' | '3d' | null;
        contenido: string;
        prompt_visual: string;
        puntos_clave: string[];
    } | null;
    /**
     * Acciones estructuradas que la IA emite cuando el usuario pide, de forma
     * conversacional, crear/consultar recordatorios, compras, alarmas,
     * temporizadores, notas, diario u horario. Cada acción lleva el dominio y
     * el texto del mandato; el despacho las ejecuta con los parsers
     * deterministas (misma fuente de verdad que el modo offline).
     */
    acciones?: FluAccion[];
    /** Animación sugerida por Gemini para el avatar (darle vida) */
    animacion?: string;
    /** Expresión sugerida por Gemini para el avatar (darle vida) */
    emocion?: string;
    /**
     * Música real — Gemini puede pedir reproducir/pausar/detener el playlist
     * cuando el usuario dice frases como "OK FLU pon música", "FLU para la música".
     * cancion puede ser un id o título del playlist (FLU_PLAYLIST, suena al
     * instante) o cualquier nombre de canción (FLU la busca en línea, dominio
     * público) en src/services/musicPlayer.ts (playSong).
     */
    musica?: {
        accion: 'play_music' | 'pause_music' | 'stop_music';
        cancion?: string;
    };
    /** Diagnostics metadata (OS2 parity) */
    diagnostics?: FluDiagnostics;
    /**
     * Configuración por voz — Gemini puede devolver acciones de configuración
     * cuando el usuario dice frases como "OK FLU configura...", "FLU cambia...",
     * "pon...", "activa...". NO se usa en conversaciones normales.
     *
     * Patrón genérico para CUALQUIER configuración:
     *   accion: "set_branding" | "set_config"
     *   componente: "branding" | "config" | "voice"
     *   clave: "activeSeason" | "language" | "voiceSpeed" | ...
     *   valor: "cumpleanos" | "es" | "1.2" | ...
     *   subvalor?: "infantil" | "navidad" | ...
     *   meta?: { celebrandoA?: string; fecha?: string; ... }
     */
    configuracion?: {
        accion: 'set_branding' | 'set_config';
        componente: string;
        clave: string;
        valor: string;
        subvalor?: string;
        meta?: Record<string, unknown>;
    };
}
