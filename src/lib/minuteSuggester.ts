// ============================================================
// Minute Suggester — Proactive Minute Creation
// ============================================================
// Detects when a decision or key point has been made in the
// conversation and proactively suggests saving it as a minute.
//
// Cumple:
//   - Rule #1: NO HARDCODE — all thresholds configurable
//   - Pure functions — no React dependencies
// ============================================================

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface MinuteSuggestion {
    /** Whether to suggest saving a minute */
    shouldSuggest: boolean;
    /** Suggested title for the minute */
    title: string;
    /** Suggested key points */
    keyPoints: string[];
    /** Confidence 0-1 */
    confidence: number;
    /** Reason for the suggestion */
    reason: string;
}

export interface MinuteSuggestionContext {
    /** Key points detected in the last contract */
    recentKeyPoints: string[];
    /** Whether a decision was detected */
    decisionDetected: boolean;
    /** Number of key points in the last turn */
    keyPointCount: number;
    /** Whether a minute was already saved recently */
    minuteSavedRecently: boolean;
    /** Time since last minute was saved (ms) */
    timeSinceLastMinuteMs: number;
    /** Whether the conversation is active */
    conversationActive: boolean;
}

// -----------------------------------------------------------
// Config
// -----------------------------------------------------------

export interface MinuteSuggesterConfig {
    /** Minimum key points to trigger suggestion */
    minKeyPoints: number;
    /** Minimum time between minute suggestions (ms) — default 2 min */
    minIntervalMs: number;
    /** Whether proactive suggestions are enabled */
    enabled: boolean;
    /** Minimum confidence threshold */
    minConfidence: number;
}

export const DEFAULT_MINUTE_SUGGESTER_CONFIG: MinuteSuggesterConfig = {
    minKeyPoints: 2,
    minIntervalMs: 2 * 60 * 1000,
    enabled: true,
    minConfidence: 0.5,
};

// -----------------------------------------------------------
// Evaluator
// -----------------------------------------------------------

/**
 * Evaluate whether to suggest saving a minute based on context.
 */
export function evaluateMinuteSuggestion(
    context: MinuteSuggestionContext,
    config: Partial<MinuteSuggesterConfig> = {},
): MinuteSuggestion {
    const cfg: MinuteSuggesterConfig = { ...DEFAULT_MINUTE_SUGGESTER_CONFIG, ...config };

    if (!cfg.enabled || !context.conversationActive) {
        return { shouldSuggest: false, title: '', keyPoints: [], confidence: 0, reason: 'disabled_or_inactive' };
    }

    if (context.minuteSavedRecently && context.timeSinceLastMinuteMs < cfg.minIntervalMs) {
        return { shouldSuggest: false, title: '', keyPoints: [], confidence: 0, reason: 'too_soon' };
    }

    if (context.keyPointCount < cfg.minKeyPoints) {
        return { shouldSuggest: false, title: '', keyPoints: [], confidence: 0, reason: 'not_enough_key_points' };
    }

    // Calculate confidence based on key point quality and decision detection
    let confidence = Math.min(1, context.keyPointCount / 5) * 0.7;
    if (context.decisionDetected) {
        confidence += 0.3;
    }

    if (confidence < cfg.minConfidence) {
        return { shouldSuggest: false, title: '', keyPoints: [], confidence, reason: 'low_confidence' };
    }

    // Build title from first key point or generic
    const title = context.recentKeyPoints[0]
        ? context.recentKeyPoints[0].slice(0, 80)
        : 'Discussion Summary';

    return {
        shouldSuggest: true,
        title,
        keyPoints: context.recentKeyPoints,
        confidence,
        reason: context.decisionDetected ? 'decision_detected' : 'key_points_available',
    };
}

/**
 * Build a prompt for Gemini to suggest a minute based on recent conversation.
 */
export function buildMinuteSuggestionPrompt(
    suggestion: MinuteSuggestion,
    language: 'es' | 'en' = 'es',
): string {
    if (!suggestion.shouldSuggest) return '';

    const isEn = language === 'en';

    if (isEn) {
        return `[MINUTE SUGGESTION] I noticed we have some key points worth saving. Would you like me to save these as a minute?\n\nTitle: ${suggestion.title}\nKey points:\n${suggestion.keyPoints.map((kp, i) => `${i + 1}. ${kp}`).join('\n')}\n\nRespond naturally asking if they want to save this as a minute.`;
    }

    return `[SUGERENCIA DE MINUTA] Noté que tenemos algunos puntos clave que vale la pena guardar. ¿Quieres que guarde esto como una minuta?\n\nTítulo: ${suggestion.title}\nPuntos clave:\n${suggestion.keyPoints.map((kp, i) => `${i + 1}. ${kp}`).join('\n')}\n\nResponde de forma natural preguntando si quieren guardar esto como minuta.`;
}
