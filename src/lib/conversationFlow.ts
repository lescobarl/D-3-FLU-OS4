// ============================================================
// Conversation Flow Detection — Reading the Room
// ============================================================
// Analyzes conversation dynamics to help FLU make natural
// decisions about when to speak, when to wait, and how to
// participate without being disruptive.
//
// Detects:
//   - Turn boundaries (speaker changes)
//   - Pauses (silence after a question)
//   - Overlap risk (rapid back-and-forth)
//   - Questions directed at FLU
//   - Conversation velocity (fast/slow)
//
// Cumple:
//   - Rule #1: NO HARDCODE — all thresholds configurable
//   - Pure functions — no React dependencies
// ============================================================

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface ConversationFlowContext {
    /** Recent speaker changes (last N speakers in order) */
    recentSpeakers: string[];
    /** Timestamps of last N turns (ms) */
    turnTimestamps: number[];
    /** Current speaker (who last spoke) */
    currentSpeaker: string;
    /** Time since last human speech (ms) */
    silenceSinceLastSpeechMs: number;
    /** Whether the last utterance was a question (contains ? or question words) */
    lastWasQuestion: boolean;
    /** Whether FLU was explicitly addressed */
    fluWasAddressed: boolean;
    /** Number of rapid exchanges (back-and-forth < 2s apart) */
    rapidExchangeCount: number;
    /** Average time between recent turns (ms) */
    averageTurnGapMs: number;
}

export interface FlowRecommendation {
    /** Whether FLU should wait before speaking */
    shouldWait: boolean;
    /** Reason for waiting */
    waitReason?: string;
    /** Recommended wait time before speaking (ms) */
    recommendedWaitMs: number;
    /** Whether FLU was directly addressed and should respond */
    shouldRespond: boolean;
    /** Urgency 0-1 */
    urgency: number;
}

// -----------------------------------------------------------
// Config
// -----------------------------------------------------------

export interface ConversationFlowConfig {
    /** If gap between turns < this, it's a rapid exchange (ms) */
    rapidExchangeThresholdMs: number;
    /** Number of rapid exchanges before FLU should wait */
    rapidExchangeLimit: number;
    /** If silence > this after a question, FLU can respond (ms) */
    questionPauseThresholdMs: number;
    /** Window for analyzing recent turns (number of turns) */
    analysisWindowTurns: number;
    /** Keywords that indicate a question directed at FLU */
    fluAddressKeywords: string[];
}

export const DEFAULT_FLOW_CONFIG: ConversationFlowConfig = {
    rapidExchangeThresholdMs: 2000,
    rapidExchangeLimit: 3,
    questionPauseThresholdMs: 1500,
    analysisWindowTurns: 6,
    fluAddressKeywords: ['flu', 'asistente', 'assistant', 'f.l.u'],
};

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/**
 * Check if text contains a question.
 */
function isQuestion(text: string): boolean {
    const trimmed = (text || '').trim();
    if (!trimmed) return false;
    // Check for question mark
    if (trimmed.includes('?')) return true;
    // Check for question words (Spanish + English)
    const questionWords = /\b(qué|cómo|cuándo|dónde|quién|por qué|para qué|cuál|cuáles|what|why|when|where|who|how|which)\b/i;
    return questionWords.test(trimmed);
}

/**
 * Check if FLU was explicitly addressed in the text.
 */
function isFluAddressed(text: string, keywords: string[]): boolean {
    const lower = (text || '').toLowerCase();
    return keywords.some((kw) => {
        const pattern = new RegExp(`\\b${kw}\\b`, 'i');
        return pattern.test(lower);
    });
}

/**
 * Analyze conversation flow and return a recommendation.
 */
export function analyzeConversationFlow(
    context: ConversationFlowContext,
    config: Partial<ConversationFlowConfig> = {},
): FlowRecommendation {
    const cfg: ConversationFlowConfig = { ...DEFAULT_FLOW_CONFIG, ...config };

    const result: FlowRecommendation = {
        shouldWait: false,
        shouldRespond: false,
        recommendedWaitMs: 0,
        urgency: 0,
    };

    // 1. Check if FLU was directly addressed
    if (context.fluWasAddressed) {
        result.shouldRespond = true;
        result.urgency = 1.0;
        result.recommendedWaitMs = 500; // brief pause then respond
        return result;
    }

    // 2. Check for rapid exchanges (overlap risk)
    if (context.rapidExchangeCount >= cfg.rapidExchangeLimit) {
        result.shouldWait = true;
        result.waitReason = 'rapid_exchange';
        result.recommendedWaitMs = 3000; // wait for a natural pause
        result.urgency = 0.2;
        return result;
    }

    // 3. Check if last utterance was a question with sufficient pause
    if (context.lastWasQuestion && context.silenceSinceLastSpeechMs >= cfg.questionPauseThresholdMs) {
        result.shouldRespond = true;
        result.urgency = 0.8;
        result.recommendedWaitMs = 500;
        return result;
    }

    // 4. Check average turn gap — if very fast, wait
    if (context.averageTurnGapMs < cfg.rapidExchangeThresholdMs && context.turnTimestamps.length >= 3) {
        result.shouldWait = true;
        result.waitReason = 'high_velocity';
        result.recommendedWaitMs = 2000;
        result.urgency = 0.3;
        return result;
    }

    // 5. Default: moderate urgency, brief wait
    result.urgency = 0.5;
    result.recommendedWaitMs = 1000;
    return result;
}

/**
 * Build a conversation flow context from raw data.
 */
export function buildFlowContext(
    recentSpeakers: string[],
    turnTimestamps: number[],
    lastUtterance: string,
    currentSpeaker: string,
    fluName: string = 'flu',
    now: number = Date.now(),
): ConversationFlowContext {
    const lastTimestamp = turnTimestamps.length > 0 ? turnTimestamps[turnTimestamps.length - 1] : now;
    const silenceSinceLastSpeechMs = now - lastTimestamp;

    // Count rapid exchanges
    let rapidCount = 0;
    for (let i = turnTimestamps.length - 1; i >= 1; i--) {
        const gap = turnTimestamps[i] - turnTimestamps[i - 1];
        if (gap < 2000) {
            rapidCount++;
        } else {
            break;
        }
    }

    // Average turn gap (last 4 turns)
    let avgGap = 0;
    const gaps: number[] = [];
    for (let i = turnTimestamps.length - 1; i >= 1 && gaps.length < 4; i--) {
        gaps.push(turnTimestamps[i] - turnTimestamps[i - 1]);
    }
    if (gaps.length > 0) {
        avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }

    return {
        recentSpeakers,
        turnTimestamps,
        currentSpeaker,
        silenceSinceLastSpeechMs,
        lastWasQuestion: isQuestion(lastUtterance),
        fluWasAddressed: isFluAddressed(lastUtterance, [fluName, ...DEFAULT_FLOW_CONFIG.fluAddressKeywords]),
        rapidExchangeCount: rapidCount,
        averageTurnGapMs: avgGap,
    };
}
