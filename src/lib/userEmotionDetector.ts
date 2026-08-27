// ============================================================
// User Emotion Detector — Sentiment & Emotion Analysis
// ============================================================
// Detects the emotional state of the USER (not FLU) from their
// text input. Uses keyword-based pattern matching.
//
// Cumple:
//   - Rule #1: NO HARDCODE — all patterns & thresholds from appConfig
//   - Pure functions — no React dependencies
//   - Runtime configurable via AdvancedConfig from integrationStore
// ============================================================

import {
    USER_EMOTION_CONFIG,
    USER_EMOTION_KEYWORDS,
    USER_EMOTION_QUESTION_KEYWORDS,
    USER_PRAISE_KEYWORDS,
    USER_CRITICISM_KEYWORDS,
    TOPIC_CHANGE_KEYWORDS,
    INTERRUPTION_KEYWORDS,
    DEFAULT_ADVANCED_CONFIG,
} from '../core/config/appConfig';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export type UserEmotionLabel =
    | 'feliz'
    | 'triste'
    | 'enojado'
    | 'agradecido'
    | 'confundido'
    | 'sorprendido'
    | 'frustrado'
    | 'neutral';

export type UserMoodLabel = 'positive' | 'negative' | 'neutral' | 'question';

export interface UserEmotionResult {
    /** Detected emotion label */
    emotion: UserEmotionLabel;
    /** Computed mood */
    mood: UserMoodLabel;
    /** Confidence 0-1 */
    confidence: number;
    /** Which keyword(s) triggered the detection */
    matchedPatterns: string[];
}

export interface UserEmotionDetectorConfig {
    /** Minimum confidence threshold to report a detection */
    minConfidence: number;
    /** Whether to enable English pattern matching */
    enableEnglish: boolean;
}

export const DEFAULT_USER_EMOTION_CONFIG: UserEmotionDetectorConfig = {
    minConfidence: DEFAULT_ADVANCED_CONFIG.emotionMinConfidence,
    enableEnglish: USER_EMOTION_CONFIG.enableEnglish,
};

// -----------------------------------------------------------
// Build regex patterns from keyword data (data-driven)
// -----------------------------------------------------------

interface EmotionPatterns {
    keywords: RegExp[];
    mood: UserMoodLabel;
    baseConfidence: number;
}

function buildEmotionPatterns(): Record<UserEmotionLabel, EmotionPatterns> {
    const result = {} as Record<UserEmotionLabel, EmotionPatterns>;
    for (const [emotion, data] of Object.entries(USER_EMOTION_KEYWORDS)) {
        const keywords = data.keywords.map((kw) => {
            // Escape regex special chars in keywords
            const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return escaped;
        });
        // Build a single alternation pattern per emotion
        const pattern = new RegExp(`(?:${keywords.join('|')})`, 'i');
        result[emotion as UserEmotionLabel] = {
            keywords: [pattern],
            mood: data.mood as UserMoodLabel,
            baseConfidence: data.baseConfidence,
        };
    }
    return result;
}

const EMOTION_PATTERNS = buildEmotionPatterns();

function buildQuestionPatterns(): RegExp[] {
    const patterns: RegExp[] = [/\?$/];
    // Group question keywords into patterns
    const starters = USER_EMOTION_QUESTION_KEYWORDS.filter((k) => !k.startsWith('me ') && !k.startsWith('podr') && !k.startsWith('pued'));
    const helpers = USER_EMOTION_QUESTION_KEYWORDS.filter((k) => k.startsWith('me ') || k.startsWith('podr') || k.startsWith('pued'));
    if (starters.length > 0) {
        const escaped = starters.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        patterns.push(new RegExp(`^(?:${escaped.join('|')})`, 'i'));
    }
    if (helpers.length > 0) {
        const escaped = helpers.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        patterns.push(new RegExp(`^(?:${escaped.join('|')})`, 'i'));
    }
    return patterns;
}

const QUESTION_PATTERNS = buildQuestionPatterns();

function buildKeywordPatterns(keywords: string[]): RegExp[] {
    return keywords.map((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, 'i');
    });
}

const PRAISE_PATTERNS = buildKeywordPatterns(USER_PRAISE_KEYWORDS);
const CRITICISM_PATTERNS = buildKeywordPatterns(USER_CRITICISM_KEYWORDS);
const TOPIC_CHANGE_INDICATORS = buildKeywordPatterns(TOPIC_CHANGE_KEYWORDS);
const INTERRUPTION_INDICATORS = buildKeywordPatterns(INTERRUPTION_KEYWORDS);

// -----------------------------------------------------------
// Detection Functions
// -----------------------------------------------------------

/**
 * Detect user emotion from text.
 * Returns the best-matching emotion label with confidence.
 */
export function detectUserEmotion(
    text: string,
    config: Partial<UserEmotionDetectorConfig> = {},
    advancedConfig?: Partial<typeof DEFAULT_ADVANCED_CONFIG>,
): UserEmotionResult {
    const cfg: UserEmotionDetectorConfig = { ...DEFAULT_USER_EMOTION_CONFIG, ...config };
    const adv: typeof DEFAULT_ADVANCED_CONFIG = { ...DEFAULT_ADVANCED_CONFIG, ...advancedConfig };
    const normalized = text.trim();

    if (!normalized) {
        return {
            emotion: 'neutral',
            mood: 'neutral',
            confidence: 1,
            matchedPatterns: ['empty_text'],
        };
    }

    let bestEmotion: UserEmotionLabel = 'neutral';
    let bestConfidence = 0;
    let bestPatterns: string[] = [];

    for (const [emotion, patterns] of Object.entries(EMOTION_PATTERNS)) {
        const matched: string[] = [];

        for (const regex of patterns.keywords) {
            if (regex.test(normalized)) {
                matched.push(regex.source);
            }
        }

        if (matched.length > 0) {
            // Boost confidence for multiple matches (configurable from appConfig)
            const boost = Math.min(adv.emotionMaxBoost, (matched.length - 1) * adv.emotionBoostPerMatch);
            const confidence = Math.min(1, patterns.baseConfidence + boost);

            if (confidence > bestConfidence) {
                bestEmotion = emotion as UserEmotionLabel;
                bestConfidence = confidence;
                bestPatterns = matched;
            }
        }
    }

    // Check for question — overrides mood if detected
    const isQuestion = QUESTION_PATTERNS.some((p) => p.test(normalized));

    // If confidence is too low, default to neutral
    if (bestConfidence < cfg.minConfidence) {
        return {
            emotion: 'neutral',
            mood: isQuestion ? 'question' : 'neutral',
            confidence: cfg.minConfidence,
            matchedPatterns: ['low_confidence'],
        };
    }

    const mood = isQuestion ? 'question' : EMOTION_PATTERNS[bestEmotion].mood;

    return {
        emotion: bestEmotion,
        mood,
        confidence: bestConfidence,
        matchedPatterns: bestPatterns,
    };
}

/**
 * Detect if user text contains praise or positive feedback toward FLU.
 */
export function detectUserPraise(
    text: string,
    advancedConfig?: Partial<typeof DEFAULT_ADVANCED_CONFIG>,
): { isPraise: boolean; confidence: number } {
    const adv: typeof DEFAULT_ADVANCED_CONFIG = { ...DEFAULT_ADVANCED_CONFIG, ...advancedConfig };
    for (const pattern of PRAISE_PATTERNS) {
        if (pattern.test(text)) {
            return { isPraise: true, confidence: adv.emotionBaseDetectionConfidence };
        }
    }

    return { isPraise: false, confidence: 0 };
}

/**
 * Detect if user text contains criticism or negative feedback toward FLU.
 */
export function detectUserCriticism(
    text: string,
    advancedConfig?: Partial<typeof DEFAULT_ADVANCED_CONFIG>,
): { isCriticism: boolean; confidence: number } {
    const adv: typeof DEFAULT_ADVANCED_CONFIG = { ...DEFAULT_ADVANCED_CONFIG, ...advancedConfig };
    for (const pattern of CRITICISM_PATTERNS) {
        if (pattern.test(text)) {
            return { isCriticism: true, confidence: adv.emotionBaseDetectionConfidence };
        }
    }

    return { isCriticism: false, confidence: 0 };
}

/**
 * Detect if the conversation topic has changed abruptly.
 * Compares current text with previous text for topic shift indicators.
 */
export function detectTopicChange(
    currentText: string,
    previousText: string | null,
    advancedConfig?: Partial<typeof DEFAULT_ADVANCED_CONFIG>,
): { isTopicChange: boolean; confidence: number } {
    const adv: typeof DEFAULT_ADVANCED_CONFIG = { ...DEFAULT_ADVANCED_CONFIG, ...advancedConfig };
    if (!previousText) return { isTopicChange: false, confidence: 0 };

    for (const pattern of TOPIC_CHANGE_INDICATORS) {
        if (pattern.test(currentText)) {
            return { isTopicChange: true, confidence: adv.emotionTopicChangeExplicitConfidence };
        }
    }

    // Check for very different topic (no shared keywords between current and previous)
    const currentWords = new Set(
        currentText.toLowerCase().split(/\s+/).filter((w) => w.length > adv.emotionTopicChangeMinWords),
    );
    const previousWords = new Set(
        previousText.toLowerCase().split(/\s+/).filter((w) => w.length > adv.emotionTopicChangeMinWords),
    );

    let sharedCount = 0;
    for (const word of currentWords) {
        if (previousWords.has(word)) sharedCount++;
    }

    const totalUnique = new Set([...currentWords, ...previousWords]).size;
    const overlapRatio = totalUnique > 0 ? sharedCount / totalUnique : 0;

    // If less than configured overlap ratio, likely a topic change
    if (overlapRatio < adv.emotionTopicChangeOverlapRatio
        && currentWords.size > adv.emotionTopicChangeMinWords
        && previousWords.size > adv.emotionTopicChangeMinWords) {
        return { isTopicChange: true, confidence: adv.emotionTopicChangeOverlapConfidence };
    }

    return { isTopicChange: false, confidence: 0 };
}

/**
 * Detect if the user is interrupting FLU while FLU is speaking.
 */
export function detectInterruption(
    text: string,
    isFluSpeaking: boolean,
    advancedConfig?: Partial<typeof DEFAULT_ADVANCED_CONFIG>,
): { isInterruption: boolean; confidence: number } {
    const adv: typeof DEFAULT_ADVANCED_CONFIG = { ...DEFAULT_ADVANCED_CONFIG, ...advancedConfig };
    if (!isFluSpeaking) return { isInterruption: false, confidence: 0 };

    for (const pattern of INTERRUPTION_INDICATORS) {
        if (pattern.test(text)) {
            return { isInterruption: true, confidence: adv.emotionBaseDetectionConfidence };
        }
    }

    // Short utterances while FLU is speaking are likely interruptions
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount <= adv.emotionShortUtteranceWordCount && text.trim().length > 0) {
        return { isInterruption: true, confidence: adv.emotionLowInterruptionConfidence };
    }

    return { isInterruption: false, confidence: 0 };
}
