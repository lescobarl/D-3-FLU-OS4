// ============================================================
// Emotional State — Persistent Emotional Continuity for FLU
// ============================================================
// Replaces the one-shot recentMemoryRef with a persistent
// emotional state that decays naturally over time.
//
// FLU experiences emotions as a result of system events
// (being ignored, being granted the floor, etc.) and these
// emotions fade gradually rather than being cleared after
// a single contract request.
//
// Cumple:
//   - Rule #1: NO HARDCODE — all thresholds configurable
//   - Pure functions — no React dependencies
// ============================================================

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export type EmotionLabel =
    | 'feliz'
    | 'triste'
    | 'enojado'
    | 'sorprendido'
    | 'neutral'
    | 'agradecido'
    | 'confundido'
    | 'emocionado'
    | 'cansado'
    | 'interesado';

export type MoodLabel = 'positive' | 'negative' | 'neutral';

export interface EmotionalEvent {
    /** The emotion experienced */
    emotion: EmotionLabel;
    /** When it occurred (epoch ms) */
    timestamp: number;
    /** What triggered it (e.g. 'participant_ignored', 'participant_granted', 'user_praise') */
    trigger: string;
    /** Intensity 0-1 */
    intensity: number;
    /** Optional context text */
    context?: string;
}

export interface EmotionalState {
    /** Current active emotion (strongest at this moment) */
    currentEmotion: EmotionLabel;
    /** Computed mood from recent emotions */
    mood: MoodLabel;
    /** Recent emotional events (last N, for context) */
    recentEvents: EmotionalEvent[];
    /** When the state was last updated */
    lastUpdated: number;
    /** Current intensity of the active emotion (0-1, decays over time) */
    intensity: number;
}

// -----------------------------------------------------------
// Config
// -----------------------------------------------------------

export interface EmotionalStateConfig {
    /** How long an emotion lasts before decaying to neutral (ms) — default 5 min */
    emotionDecayMs: number;
    /** How many recent events to keep in history */
    maxRecentEvents: number;
    /** Intensity decay per second (linear) */
    decayPerSecond: number;
    /** Minimum intensity before snapping to 0 */
    minIntensity: number;
}

export const DEFAULT_EMOTIONAL_CONFIG: EmotionalStateConfig = {
    emotionDecayMs: 5 * 60 * 1000, // 5 minutes
    maxRecentEvents: 10,
    decayPerSecond: 0.003, // loses 0.3% intensity per second → ~5.5 min to go from 1.0 to 0
    minIntensity: 0.05,
};

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/**
 * Map an emotion label to a mood.
 */
export function emotionToMood(emotion: EmotionLabel): MoodLabel {
    switch (emotion) {
        case 'feliz':
        case 'agradecido':
        case 'emocionado':
        case 'interesado':
            return 'positive';
        case 'triste':
        case 'enojado':
        case 'cansado':
            return 'negative';
        case 'sorprendido':
        case 'confundido':
        case 'neutral':
        default:
            return 'neutral';
    }
}

/**
 * Compute the overall mood from a list of recent emotional events.
 * Weighted by recency and intensity.
 */
export function computeMood(events: EmotionalEvent[], now: number = Date.now()): MoodLabel {
    if (events.length === 0) return 'neutral';

    let positiveWeight = 0;
    let negativeWeight = 0;
    let totalWeight = 0;

    for (const event of events) {
        const age = now - event.timestamp;
        const recencyWeight = Math.max(0, 1 - age / (5 * 60 * 1000)); // decays over 5 min
        const weight = recencyWeight * event.intensity;
        const mood = emotionToMood(event.emotion);

        if (mood === 'positive') positiveWeight += weight;
        else if (mood === 'negative') negativeWeight += weight;
        // neutral doesn't contribute

        totalWeight += weight;
    }

    if (totalWeight === 0) return 'neutral';

    const positiveRatio = positiveWeight / totalWeight;
    const negativeRatio = negativeWeight / totalWeight;

    if (positiveRatio > 0.6) return 'positive';
    if (negativeRatio > 0.6) return 'negative';
    return 'neutral';
}

/**
 * Create an initial (neutral) emotional state.
 */
export function createInitialEmotionalState(): EmotionalState {
    return {
        currentEmotion: 'neutral',
        mood: 'neutral',
        recentEvents: [],
        lastUpdated: Date.now(),
        intensity: 0,
    };
}

/**
 * Apply decay to an emotional state based on elapsed time.
 */
export function decayEmotionalState(
    state: EmotionalState,
    config: Partial<EmotionalStateConfig> = {},
    now: number = Date.now(),
): EmotionalState {
    const cfg: EmotionalStateConfig = { ...DEFAULT_EMOTIONAL_CONFIG, ...config };
    const elapsed = now - state.lastUpdated;
    const decayAmount = (elapsed / 1000) * cfg.decayPerSecond;

    let newIntensity = Math.max(0, state.intensity - decayAmount);
    if (newIntensity < cfg.minIntensity) {
        newIntensity = 0;
    }

    // If intensity dropped to 0, snap to neutral
    const newEmotion = newIntensity <= 0 ? 'neutral' : state.currentEmotion;
    const newMood = newIntensity <= 0 ? 'neutral' : computeMood(state.recentEvents, now);

    return {
        ...state,
        currentEmotion: newEmotion,
        mood: newMood,
        intensity: newIntensity,
        lastUpdated: now,
    };
}

/**
 * Record a new emotional event and update the state.
 */
export function recordEmotionalEvent(
    state: EmotionalState,
    emotion: EmotionLabel,
    trigger: string,
    intensity: number = 0.8,
    context?: string,
    config: Partial<EmotionalStateConfig> = {},
    now: number = Date.now(),
): EmotionalState {
    const cfg: EmotionalStateConfig = { ...DEFAULT_EMOTIONAL_CONFIG, ...config };

    // First decay the existing state
    const decayed = decayEmotionalState(state, cfg, now);

    // Create the new event
    const event: EmotionalEvent = {
        emotion,
        timestamp: now,
        trigger,
        intensity: Math.min(1, Math.max(0, intensity)),
        context,
    };

    // Add to recent events, trim to max
    const recentEvents = [event, ...decayed.recentEvents].slice(0, cfg.maxRecentEvents);

    // If the new emotion is stronger than the current (decayed) one, it takes over
    const newIntensity = Math.max(event.intensity, decayed.intensity);
    const newEmotion = event.intensity >= decayed.intensity ? emotion : decayed.currentEmotion;
    const newMood = computeMood(recentEvents, now);

    return {
        currentEmotion: newEmotion,
        mood: newMood,
        recentEvents,
        lastUpdated: now,
        intensity: newIntensity,
    };
}

/**
 * Format the emotional state for injection into Gemini's system prompt.
 * Returns a string like:
 * "FLU's current emotional state: enojado (intensity: 0.7, mood: negative).
 *  Recent events: [2m ago] participant_ignored → enojado, [5m ago] participant_granted → feliz"
 */
export function formatEmotionalStateForPrompt(state: EmotionalState, language: 'es' | 'en' = 'es'): string {
    if (state.intensity <= 0 && state.currentEmotion === 'neutral') {
        return '';
    }

    const isEn = language === 'en';
    const lines: string[] = [];

    if (isEn) {
        lines.push(`CRITICAL — You are currently experiencing this emotion right now. This is NOT a past event — it is how you feel at this very moment. You MUST express this feeling in your respuesta_voz before anything else. Do NOT deny it, do NOT override it with your personality. This emotion is part of you right now.`);
        lines.push(`Your current emotional state: ${state.currentEmotion} (intensity: ${state.intensity.toFixed(2)}, mood: ${state.mood}).`);
    } else {
        lines.push(`CRÍTICO — En este momento estás experimentando esta emoción. NO es un evento pasado — es cómo te sientes ahora mismo. Debes EXPRESAR este sentimiento en tu respuesta_voz antes que cualquier otra cosa. No lo niegues, no lo sobrescribas con tu personalidad. Esta emoción es parte de ti ahora mismo.`);
        lines.push(`Tu estado emocional actual: ${state.currentEmotion} (intensidad: ${state.intensity.toFixed(2)}, estado de ánimo: ${state.mood}).`);
    }

    if (state.recentEvents.length > 0) {
        if (isEn) {
            lines.push('Recent emotional events:');
        } else {
            lines.push('Eventos emocionales recientes:');
        }
        for (const event of state.recentEvents.slice(0, 3)) {
            const ago = Math.round((Date.now() - event.timestamp) / 1000);
            const agoStr = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
            if (isEn) {
                lines.push(`  - [${agoStr}] ${event.trigger} → ${event.emotion} (intensity: ${event.intensity.toFixed(2)})`);
            } else {
                lines.push(`  - [hace ${agoStr}] ${event.trigger} → ${event.emotion} (intensidad: ${event.intensity.toFixed(2)})`);
            }
        }
    }

    return lines.join('\n');
}
