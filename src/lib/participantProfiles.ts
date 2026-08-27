// ============================================================
// Participant Profiles — Personality-Driven Timing & Behavior
// ============================================================
// Maps FLU's personality traits to concrete timing/config
// overrides for the participant state machine. This makes
// FLU's participation style match its personality.
//
// Cumple:
//   - Rule #1: NO HARDCODE — all profiles configurable
//   - Pure functions — no React dependencies
// ============================================================

import type { ParticipantConfig } from './fluParticipant';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export type ParticipationStyle = 'energetic' | 'calm' | 'analytical' | 'supportive' | 'balanced';

export interface ParticipationProfile {
    /** Human-readable name */
    name: string;
    /** Style identifier */
    style: ParticipationStyle;
    /** Config overrides to apply */
    configOverrides: Partial<ParticipantConfig>;
    /** Description */
    description: string;
}

// -----------------------------------------------------------
// Profiles
// -----------------------------------------------------------

export const PARTICIPATION_PROFILES: Record<ParticipationStyle, ParticipationProfile> = {
    energetic: {
        name: 'Energetic',
        style: 'energetic',
        description: 'Frequent, enthusiastic participation. Quick to jump in with ideas.',
        configOverrides: {
            evaluateEveryNTurns: 2,
            evaluationWindowTurns: 6,
            minConfidence: 0.4,
            minDraftChars: 15,
            maxDraftChars: 350,
            handRaisedTimeoutMs: 12000,
            cooldownAfterInterventionMs: 8000,
            maxInterventionsPerSession: 15,
            maxInterventionsPerHour: 30,
        },
    },
    calm: {
        name: 'Calm',
        style: 'calm',
        description: 'Measured, thoughtful participation. Speaks less but with more substance.',
        configOverrides: {
            evaluateEveryNTurns: 4,
            evaluationWindowTurns: 10,
            minConfidence: 0.6,
            minDraftChars: 30,
            maxDraftChars: 500,
            handRaisedTimeoutMs: 20000,
            cooldownAfterInterventionMs: 15000,
            maxInterventionsPerSession: 6,
            maxInterventionsPerHour: 12,
        },
    },
    analytical: {
        name: 'Analytical',
        style: 'analytical',
        description: 'Data-driven, precise contributions. High confidence threshold.',
        configOverrides: {
            evaluateEveryNTurns: 3,
            evaluationWindowTurns: 8,
            minConfidence: 0.7,
            minDraftChars: 40,
            maxDraftChars: 600,
            handRaisedTimeoutMs: 18000,
            cooldownAfterInterventionMs: 12000,
            maxInterventionsPerSession: 8,
            maxInterventionsPerHour: 15,
        },
    },
    supportive: {
        name: 'Supportive',
        style: 'supportive',
        description: 'Encouraging, affirming participation. Quick to agree and build on ideas.',
        configOverrides: {
            evaluateEveryNTurns: 2,
            evaluationWindowTurns: 5,
            minConfidence: 0.3,
            minDraftChars: 10,
            maxDraftChars: 250,
            handRaisedTimeoutMs: 10000,
            cooldownAfterInterventionMs: 6000,
            maxInterventionsPerSession: 20,
            maxInterventionsPerHour: 40,
        },
    },
    balanced: {
        name: 'Balanced',
        style: 'balanced',
        description: 'Default — balanced participation style.',
        configOverrides: {
            evaluateEveryNTurns: 3,
            evaluationWindowTurns: 8,
            minConfidence: 0.5,
            minDraftChars: 20,
            maxDraftChars: 420,
            handRaisedTimeoutMs: 15000,
            cooldownAfterInterventionMs: 10000,
            maxInterventionsPerSession: 10,
            maxInterventionsPerHour: 20,
        },
    },
};

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/**
 * Map personality traits to a participation style.
 * Uses keyword matching against trait names.
 */
export function traitsToStyle(traits: string[]): ParticipationStyle {
    const lower = traits.map((t) => t.toLowerCase());

    const energeticWords = ['energetic', 'energético', 'enthusiastic', 'entusiasta', 'lively', 'vivaz', 'active', 'activo'];
    const calmWords = ['calm', 'calmado', 'tranquilo', 'serene', 'sereno', 'quiet', 'quieto', 'patient', 'paciente'];
    const analyticalWords = ['analytical', 'analítico', 'logical', 'lógico', 'precise', 'preciso', 'rational', 'racional', 'detail', 'detalle'];
    const supportiveWords = ['supportive', 'solidario', 'kind', 'amable', 'friendly', 'amigable', 'caring', 'cariñoso', 'helpful', 'servicial'];

    const scores: Record<ParticipationStyle, number> = {
        energetic: 0,
        calm: 0,
        analytical: 0,
        supportive: 0,
        balanced: 0,
    };

    for (const trait of lower) {
        if (energeticWords.some((w) => trait.includes(w))) scores.energetic++;
        if (calmWords.some((w) => trait.includes(w))) scores.calm++;
        if (analyticalWords.some((w) => trait.includes(w))) scores.analytical++;
        if (supportiveWords.some((w) => trait.includes(w))) scores.supportive++;
    }

    // Find the style with the highest score
    let best: ParticipationStyle = 'balanced';
    let bestScore = 0;
    for (const [style, score] of Object.entries(scores)) {
        if (score > bestScore) {
            bestScore = score;
            best = style as ParticipationStyle;
        }
    }

    return best;
}

/**
 * Get config overrides for a given set of personality traits.
 */
export function getConfigForTraits(traits: string[]): Partial<ParticipantConfig> {
    const style = traitsToStyle(traits);
    return PARTICIPATION_PROFILES[style].configOverrides;
}

/**
 * Get a profile by style name.
 */
export function getProfile(style: ParticipationStyle): ParticipationProfile {
    return PARTICIPATION_PROFILES[style] || PARTICIPATION_PROFILES.balanced;
}
