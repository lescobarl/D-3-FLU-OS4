// ============================================================
// Proactive Engine — FLU Initiates Conversations Autonomously
// ============================================================
// Determines WHEN and WHY FLU should speak without being
// explicitly addressed. This is the core of FLU's autonomy.
//
// Triggers:
//   - Long silence (> 30s) → suggest next topic or check-in
//   - After a decision is made → offer to save as minute
//   - Unresolved topic → ask for clarification
//   - New participant joins → welcome and context summary
//   - Time-based (e.g. session running long → suggest wrap-up)
//   - Pending agenda items from previous sessions → remind user
//
// Cumple:
//   - Rule #1: NO HARDCODE — all thresholds configurable
//   - Pure functions — no React dependencies
// ============================================================

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export type ProactiveTrigger =
    | 'long_silence'
    | 'decision_made'
    | 'unresolved_topic'
    | 'new_participant'
    | 'session_time'
    | 'topic_completion'
    | 'follow_up_needed'
    | 'pending_agenda';

export interface ProactiveContext {
    /** Milliseconds since last human speech */
    silenceDurationMs: number;
    /** Whether a decision was detected in the last turn */
    decisionDetected: boolean;
    /** Whether there are unresolved topics */
    hasUnresolvedTopics: boolean;
    /** Number of active participants */
    participantCount: number;
    /** Session duration in ms */
    sessionDurationMs: number;
    /** Number of turns since FLU last spoke */
    turnsSinceLastFluSpeech: number;
    /** Whether a topic was just completed */
    topicJustCompleted: boolean;
    /** Whether there's a pending follow-up from earlier */
    hasPendingFollowUp: boolean;
    /** Whether there are pending agenda items from previous sessions */
    hasPendingAgenda: boolean;
    /** Current conversation phase */
    phase: string;
}

export interface ProactiveSuggestion {
    /** Why FLU should speak */
    trigger: ProactiveTrigger;
    /** Priority 0-1 (higher = more urgent) */
    priority: number;
    /** Suggested prompt text for Gemini */
    suggestionText: string;
    /** Suggested emotion for this intervention */
    suggestedEmotion: string;
}

// -----------------------------------------------------------
// Config
// -----------------------------------------------------------

export interface ProactiveConfig {
    /** Silence threshold before FLU checks in (ms) — default 30s */
    longSilenceThresholdMs: number;
    /** Minimum time between proactive interventions (ms) — default 60s */
    minIntervalMs: number;
    /** Whether proactive mode is enabled */
    enabled: boolean;
    /** Minimum turns since FLU last spoke before being proactive */
    minTurnsSinceLastFluSpeech: number;
    /** Session duration before suggesting wrap-up (ms) — default 45 min */
    wrapUpThresholdMs: number;
}

export const DEFAULT_PROACTIVE_CONFIG: ProactiveConfig = {
    longSilenceThresholdMs: 30_000,
    minIntervalMs: 60_000,
    enabled: true,
    minTurnsSinceLastFluSpeech: 3,
    wrapUpThresholdMs: 45 * 60 * 1000,
};

// -----------------------------------------------------------
// Trigger Evaluators
// -----------------------------------------------------------

/**
 * Evaluate if FLU should speak proactively based on context.
 * Returns the highest-priority suggestion, or null if no trigger fires.
 */
export function evaluateProactiveTriggers(
    context: ProactiveContext,
    config: Partial<ProactiveConfig> = {},
): ProactiveSuggestion | null {
    const cfg: ProactiveConfig = { ...DEFAULT_PROACTIVE_CONFIG, ...config };

    if (!cfg.enabled) return null;
    if (context.turnsSinceLastFluSpeech < cfg.minTurnsSinceLastFluSpeech) return null;

    const candidates: ProactiveSuggestion[] = [];

    // 1. Long silence check-in
    if (context.silenceDurationMs >= cfg.longSilenceThresholdMs) {
        candidates.push({
            trigger: 'long_silence',
            priority: 0.9,
            suggestionText: 'The conversation has been quiet for a while. Suggest a new topic, ask if anyone has questions, or offer to summarize the discussion so far.',
            suggestedEmotion: 'interesado',
        });
    }

    // 2. Decision detected → offer to save as minute
    if (context.decisionDetected) {
        candidates.push({
            trigger: 'decision_made',
            priority: 0.8,
            suggestionText: 'A decision was just made. Offer to save it as a minute/agreement so it is not forgotten.',
            suggestedEmotion: 'feliz',
        });
    }

    // 3. Unresolved topic → ask for clarification
    if (context.hasUnresolvedTopics) {
        candidates.push({
            trigger: 'unresolved_topic',
            priority: 0.7,
            suggestionText: 'There is an unresolved topic or open question. Ask if anyone wants to address it before moving on.',
            suggestedEmotion: 'confundido',
        });
    }

    // 4. New participant
    if (context.participantCount >= 2 && context.turnsSinceLastFluSpeech <= 5) {
        // Only welcome if we haven't spoken much yet (new session feel)
        candidates.push({
            trigger: 'new_participant',
            priority: 0.5,
            suggestionText: 'Welcome any new participants and briefly summarize what has been discussed so far.',
            suggestedEmotion: 'feliz',
        });
    }

    // 5. Session running long → suggest wrap-up
    if (context.sessionDurationMs >= cfg.wrapUpThresholdMs) {
        candidates.push({
            trigger: 'session_time',
            priority: 0.6,
            suggestionText: 'The session has been running for a while. Suggest wrapping up, saving key points, or scheduling a follow-up.',
            suggestedEmotion: 'neutral',
        });
    }

    // 6. Topic just completed → transition
    if (context.topicJustCompleted) {
        candidates.push({
            trigger: 'topic_completion',
            priority: 0.75,
            suggestionText: 'A topic was just completed. Ask if the group wants to move to the next topic or if there are any final thoughts.',
            suggestedEmotion: 'feliz',
        });
    }

    // 7. Pending follow-up
    if (context.hasPendingFollowUp) {
        candidates.push({
            trigger: 'follow_up_needed',
            priority: 0.85,
            suggestionText: 'There is a pending follow-up from earlier in the conversation. Remind the group about it.',
            suggestedEmotion: 'interesado',
        });
    }

    // 8. Pending agenda items from previous sessions
    if (context.hasPendingAgenda) {
        candidates.push({
            trigger: 'pending_agenda',
            priority: 0.65,
            suggestionText: 'There are pending items from previous sessions. Offer to review them or ask if the user wants to continue with any of the pending tasks.',
            suggestedEmotion: 'interesado',
        });
    }

    if (candidates.length === 0) return null;

    // Return highest priority
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates[0];
}

/**
 * Build a proactive prompt for Gemini based on the trigger.
 * This gets injected into the system prompt or used as a user prompt.
 */
export function buildProactivePrompt(
    suggestion: ProactiveSuggestion,
    language: 'es' | 'en' = 'es',
): string {
    const isEn = language === 'en';

    if (isEn) {
        return `[PROACTIVE INTERVENTION] ${suggestion.suggestionText}\nRespond naturally as yourself. This is a proactive contribution — do not mention that you are initiating. Just speak naturally.`;
    }

    return `[INTERVENCIÓN PROACTIVA] ${suggestion.suggestionText}\nResponde de forma natural como tú mismo. Esta es una contribución proactiva — no menciones que estás iniciando. Solo habla naturalmente.`;
}
