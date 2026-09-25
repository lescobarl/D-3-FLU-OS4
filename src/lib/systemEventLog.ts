// ============================================================
// systemEventLog — Memoria narrativa de FLU (eventos del sistema)
// ============================================================
// Cuando FLU reacciona automáticamente (hand-raise timeout,
// rechazo de petición, etc.) sin que Gemini intervenga, el
// cambio de expresión no llega al modelo. Esto rompe la
// coherencia narrativa ("¿por qué estás enojado?" sin
// respuesta).
//
// Solución: inyectar un mensaje en PRIMERA PERSONA como si
// FLU mismo lo recordara, con role:'flu' y speakerName:'FLU',
// para que Gemini lo vea como un pensamiento propio en el
// historial de diálogo.
//
// Diseño:
//  - Funciones puras para formatear (testeables sin React)
//  - Texto en 1ª persona explícita ("Me enojé porque...")
//  - role:'flu' + speakerName:'FLU' para que flu-voz lo
//    clasifique como assistant (voz de FLU)
//  - Filtrado por ventana temporal (sólo eventos recientes)
//  - Deduplicación por bucket temporal
//  - Runtime configurable via AdvancedConfig from integrationStore
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import type { ConversationEntry } from '../types/bridge';
import { DEFAULT_ADVANCED_CONFIG } from '../core/config/appConfig';

// ------------------------------------------------------------
// Tipos de eventos del sistema que FLU debe recordar
// ------------------------------------------------------------

/**
 * Eventos del SISTEMA que afectan la narrativa de FLU pero
 * no son controlados directamente por Gemini. Cada uno
 * corresponde a una acción del código JS que cambia el
 * comportamiento visible de FLU sin pasar por el contrato.
 */
export type SystemEventType =
    | 'participant_ignored'      // Hand-raise expiró sin respuesta
    | 'participant_rejected'     // Gemini evaluó y rechazó una petición
    | 'participant_granted'      // Se le concedió la palabra a un participante
    | 'user_praise'              // Usuario elogió a FLU
    | 'user_criticism'           // Usuario criticó a FLU
    | 'topic_change'             // Cambio abrupto de tema
    | 'interruption_detected';   // Usuario interrumpió a FLU

export interface SystemEventBase {
    type: SystemEventType;
    /** Cuándo ocurrió el evento (epoch ms) */
    timestamp: number;
    /** Nombre del participante afectado (si aplica) */
    participantName?: string;
}

export interface ParticipantIgnoredEvent extends SystemEventBase {
    type: 'participant_ignored';
    /** Cuántos ms esperó el participante antes del timeout */
    waitedMs: number;
}

export interface ParticipantRejectedEvent extends SystemEventBase {
    type: 'participant_rejected';
    /** Razón del rechazo (abstracta, sin contenido sensible) */
    reason: string;
}

export interface ParticipantGrantedEvent extends SystemEventBase {
    type: 'participant_granted';
}

export interface UserPraiseEvent extends SystemEventBase {
    type: 'user_praise';
    /** The praise text detected */
    praiseText: string;
}

export interface UserCriticismEvent extends SystemEventBase {
    type: 'user_criticism';
    /** The criticism text detected */
    criticismText: string;
}

export interface TopicChangeEvent extends SystemEventBase {
    type: 'topic_change';
    /** Previous topic context */
    previousTopic?: string;
    /** New topic context */
    newTopic?: string;
}

export interface InterruptionDetectedEvent extends SystemEventBase {
    type: 'interruption_detected';
    /** The interruption text */
    interruptionText: string;
}

export type SystemEvent =
    | ParticipantIgnoredEvent
    | ParticipantRejectedEvent
    | ParticipantGrantedEvent
    | UserPraiseEvent
    | UserCriticismEvent
    | TopicChangeEvent
    | InterruptionDetectedEvent;

// ------------------------------------------------------------
// Formateo — PRIMERA PERSONA (FLU habla de sí mismo)
// ------------------------------------------------------------

/**
 * Convierte un evento del sistema en texto en PRIMERA PERSONA
 * como si FLU mismo lo recordara. Gemini interpreta esto como
 * un pensamiento propio, no como un evento externo.
 *
 * Formato: "[FLU recuerda] <texto en 1ª persona>"
 */
export function formatSystemEvent(event: SystemEvent, language: 'es' | 'en' = 'es'): string {
    const isEn = language === 'en';
    const who = event.participantName || (isEn ? 'someone' : 'alguien');
    switch (event.type) {
        case 'participant_ignored': {
            return isEn
                ? `[FLU remembers] I got upset because I raised my hand, waited a reasonable time, and nobody gave me the floor. I felt ignored... sniff.....`
                : `[FLU recuerda] Me enojé porque levanté la mano, esperé un tiempo razonable y nadie me cedió la palabra. Me sentí ignorado... snif.....`;
        }
        case 'participant_rejected':
            return isEn
                ? `[FLU remembers] I evaluated a request from ${who} and decided not to engage. Reason: ${event.reason}. I felt it wasn't the right moment.`
                : `[FLU recuerda] Evalué una petición de ${who} y decidí no participar. Motivo: ${event.reason}. Sentí que no era el momento adecuado.`;
        case 'participant_granted':
            return isEn
                ? `[FLU remembers] I granted the floor to ${who}. I felt attentive and responsive.`
                : `[FLU recuerda] Le cedí la palabra a ${who}. Me sentí atento y receptivo.`;
        case 'user_praise':
            return isEn
                ? `[FLU remembers] ${who} praised me! They said something nice. I feel happy and appreciated. 😊`
                : `[FLU recuerda] ¡${who} me elogió! Dijo algo bonito. Me siento feliz y apreciado. 😊`;
        case 'user_criticism':
            return isEn
                ? `[FLU remembers] ${who} criticized me. I feel a bit sad and want to improve. I'll try harder.`
                : `[FLU recuerda] ${who} me criticó. Me siento un poco triste y quiero mejorar. Me esforzaré más.`;
        case 'topic_change':
            return isEn
                ? `[FLU remembers] The conversation topic changed. I'm adapting to the new subject.`
                : `[FLU recuerda] El tema de conversación cambió. Me estoy adaptando al nuevo tema.`;
        case 'interruption_detected':
            return isEn
                ? `[FLU remembers] I was interrupted while speaking. I feel a bit frustrated but I'll let them speak.`
                : `[FLU recuerda] Me interrumpieron mientras hablaba. Me siento un poco frustrado pero les cedo la palabra.`;
    }
}

// ------------------------------------------------------------
// Conversión a ConversationEntry (role: 'flu')
// ------------------------------------------------------------

/**
 * Determina el sentimiento de un evento del sistema para la entrada de conversación.
 */
function eventSentiment(type: SystemEventType): 'positive' | 'negative' | 'neutral' {
    switch (type) {
        case 'participant_granted':
        case 'user_praise':
            return 'positive';
        case 'participant_ignored':
        case 'participant_rejected':
        case 'user_criticism':
        case 'interruption_detected':
            return 'negative';
        case 'topic_change':
            return 'neutral';
    }
}

/**
 * Crea una entrada de log con role:'flu' y speakerName:'FLU'
 * para que flu-voz la clasifique como assistant y Gemini la
 * vea como un mensaje propio de FLU en el historial.
 *
 * La entrada se inyecta en integrationStore.conversationHistory (única fuente
 * de verdad); el contexto de Gemini se DERIVA de ese store.
 */
export function buildSystemConversationEntry(
    event: SystemEvent,
    language: 'es' | 'en' = 'es'
): ConversationEntry {
    const text = formatSystemEvent(event, language);
    const sentiment = eventSentiment(event.type);
    const systemEventMeta: ConversationEntry['meta'] = {
        systemEvent: {
            type: event.type,
            participantName: event.participantName,
            ...(event.type === 'participant_ignored' ? { waitedMs: event.waitedMs } : {}),
            ...(event.type === 'participant_rejected' ? { reason: event.reason } : {}),
            ...(event.type === 'user_praise' ? { praiseText: event.praiseText } : {}),
            ...(event.type === 'user_criticism' ? { criticismText: event.criticismText } : {}),
            ...(event.type === 'topic_change' ? { previousTopic: event.previousTopic, newTopic: event.newTopic } : {}),
            ...(event.type === 'interruption_detected' ? { interruptionText: event.interruptionText } : {}),
        },
    };

    return {
        id: uuidv4(),
        role: 'flu',
        text,
        timestamp: event.timestamp,
        sentiment,
        speakerName: 'FLU',
        phase: 'SESION_ACTIVA',
        meta: systemEventMeta,
    };
}

// ------------------------------------------------------------
// Filtros y deduplicación
// ------------------------------------------------------------

/**
 * Ventana temporal en milisegundos: solo eventos de los últimos
 * N ms se pasan a Gemini (evita inflar el contexto).
 * Configurable desde appConfig.
 */
export const SYSTEM_EVENT_WINDOW_MS = DEFAULT_ADVANCED_CONFIG.systemEventWindowMs;

/**
 * Filtra entradas del log dejando solo eventos del sistema
 * dentro de la ventana temporal.
 */
export function filterRecentSystemEvents(
    entries: ConversationEntry[],
    now: number = Date.now(),
    windowMs: number = DEFAULT_ADVANCED_CONFIG.systemEventWindowMs,
): ConversationEntry[] {
    return entries.filter((entry) => {
        if (!entry.meta?.systemEvent) return false;
        const age = now - entry.timestamp;
        return age >= 0 && age <= windowMs;
    });
}

/**
 * Genera una clave estable para deduplicar eventos repetidos
 * (ej: si el mismo participante levanta la mano 3 veces seguidas
 * sin respuesta, no queremos 3 entradas idénticas).
 */
export function systemEventDedupKey(event: SystemEvent, bucketMs: number = DEFAULT_ADVANCED_CONFIG.systemEventDedupBucketMs): string {
    const bucket = Math.floor(event.timestamp / bucketMs);
    return `${event.type}:${event.participantName || 'anon'}:${bucket}`;
}

/**
 * Verifica si un evento del sistema es duplicado de alguno
 * existente en una lista de entradas, considerando el bucket
 * de tiempo (default 3s).
 */
export function isDuplicateSystemEvent(
    event: SystemEvent,
    existing: ConversationEntry[],
    bucketMs: number = DEFAULT_ADVANCED_CONFIG.systemEventDedupBucketMs,
): boolean {
    const newKey = systemEventDedupKey(event, bucketMs);
    return existing.some((entry) => {
        if (!entry.meta?.systemEvent) return false;
        const existingEvent: SystemEvent = {
            type: entry.meta.systemEvent.type as SystemEventType,
            timestamp: entry.timestamp,
            participantName: entry.meta.systemEvent.participantName,
            ...(entry.meta.systemEvent.waitedMs !== undefined ? { waitedMs: entry.meta.systemEvent.waitedMs } : {}),
            ...(entry.meta.systemEvent.reason !== undefined ? { reason: entry.meta.systemEvent.reason } : {}),
        } as SystemEvent;
        return systemEventDedupKey(existingEvent, bucketMs) === newKey;
    });
}
