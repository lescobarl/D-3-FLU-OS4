// ============================================================
// Theory of Mind — Participant Knowledge Modeling
// ============================================================
// Models what each participant knows, has discussed, and their
// demonstrated preferences. This gives FLU a basic "theory of
// mind" — the ability to reason about what others know.
//
// Cumple:
//   - Rule #1: NO HARDCODE — all thresholds from appConfig
//   - Pure functions — no React dependencies
//   - Runtime configurable via AdvancedConfig from integrationStore
// ============================================================

import {
    THEORY_OF_MIND_STOP_WORDS,
    DEFAULT_ADVANCED_CONFIG,
} from '../core/config/appConfig';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface ParticipantModel {
    /** Participant identifier (name or ID) */
    name: string;
    /** Topics this participant has discussed */
    knownTopics: string[];
    /** Preferences demonstrated by this participant */
    demonstratedPreferences: string[];
    /** Emotional states observed in this participant */
    observedEmotions: Array<{
        emotion: string;
        timestamp: number;
        context?: string;
    }>;
    /** Last interaction timestamp */
    lastInteraction: number;
    /** Total number of interventions by this participant */
    interventionCount: number;
    /** Topics where this participant showed expertise */
    expertiseTopics: string[];
    /** Topics where this participant asked questions (seeking info) */
    questionsAsked: string[];
}

export interface TheoryOfMindState {
    /** Models for each known participant */
    participants: Record<string, ParticipantModel>;
    /** When the state was last updated */
    lastUpdated: number;
    /** Total participants tracked */
    totalParticipants: number;
}

export interface TheoryOfMindConfig {
    /** Max participants to track simultaneously */
    maxParticipants: number;
    /** Max topics to remember per participant */
    maxTopicsPerParticipant: number;
    /** Max emotions to remember per participant */
    maxEmotionsPerParticipant: number;
    /** How long without interaction before considering a participant "inactive" (ms) */
    participantInactivityMs: number;
}

export const DEFAULT_THEORY_OF_MIND_CONFIG: TheoryOfMindConfig = {
    maxParticipants: DEFAULT_ADVANCED_CONFIG.tomMaxParticipants,
    maxTopicsPerParticipant: DEFAULT_ADVANCED_CONFIG.tomMaxTopicsPerParticipant,
    maxEmotionsPerParticipant: DEFAULT_ADVANCED_CONFIG.tomMaxEmotionsPerParticipant,
    participantInactivityMs: DEFAULT_ADVANCED_CONFIG.tomParticipantInactivityMs,
};

// -----------------------------------------------------------
// State Management
// -----------------------------------------------------------

/**
 * Create an initial (empty) theory of mind state.
 */
export function createTheoryOfMindState(): TheoryOfMindState {
    return {
        participants: {},
        lastUpdated: Date.now(),
        totalParticipants: 0,
    };
}

/**
 * Get or create a participant model.
 */
export function getOrCreateParticipant(
    state: TheoryOfMindState,
    name: string,
    config: Partial<TheoryOfMindConfig> = {},
): { state: TheoryOfMindState; model: ParticipantModel } {
    const cfg: TheoryOfMindConfig = { ...DEFAULT_THEORY_OF_MIND_CONFIG, ...config };

    if (state.participants[name]) {
        return { state, model: state.participants[name] };
    }

    // Check if we've reached the max participants
    const participantCount = Object.keys(state.participants).length;
    if (participantCount >= cfg.maxParticipants) {
        // Evict the oldest inactive participant
        const oldest = Object.entries(state.participants)
            .filter(([key]) => key !== name)
            .sort(([, a], [, b]) => a.lastInteraction - b.lastInteraction)[0];

        if (oldest) {
            const { [oldest[0]]: _removed, ...rest } = state.participants;
            state = { ...state, participants: rest };
        }
    }

    const model: ParticipantModel = {
        name,
        knownTopics: [],
        demonstratedPreferences: [],
        observedEmotions: [],
        lastInteraction: Date.now(),
        interventionCount: 0,
        expertiseTopics: [],
        questionsAsked: [],
    };

    return {
        state: {
            ...state,
            participants: { ...state.participants, [name]: model },
            totalParticipants: Object.keys(state.participants).length + 1,
            lastUpdated: Date.now(),
        },
        model,
    };
}

/**
 * Record a participant's intervention (they said something).
 */
export function recordParticipantIntervention(
    state: TheoryOfMindState,
    name: string,
    text: string,
    timestamp: number = Date.now(),
    config: Partial<TheoryOfMindConfig> = {},
    advancedConfig?: Partial<typeof DEFAULT_ADVANCED_CONFIG>,
): TheoryOfMindState {
    const cfg: TheoryOfMindConfig = { ...DEFAULT_THEORY_OF_MIND_CONFIG, ...config };
    const adv: typeof DEFAULT_ADVANCED_CONFIG = { ...DEFAULT_ADVANCED_CONFIG, ...advancedConfig };
    const { state: updatedState, model } = getOrCreateParticipant(state, name, cfg);

    // Extract potential topics (words > minTopicWordLength chars, not stop words)
    const stopWords = new Set(THEORY_OF_MIND_STOP_WORDS);
    const words = text.toLowerCase().split(/\s+/);
    const minWordLen = adv.tomMinTopicWordLength;
    const newTopics = words.filter(
        (w) => w.length > minWordLen && !stopWords.has(w) && !model.knownTopics.includes(w),
    );

    // Check if the text is a question (participant is seeking info)
    const isQuestion = /\?$/.test(text.trim()) ||
        /^(?:qué|quién|cómo|cuándo|dónde|por\s+qué|what|who|when|where|why|how)/i.test(text.trim());

    const maxQuestions = adv.tomMaxQuestionsPerParticipant;

    const updatedModel: ParticipantModel = {
        ...model,
        knownTopics: [...new Set([...newTopics, ...model.knownTopics])].slice(0, cfg.maxTopicsPerParticipant),
        lastInteraction: timestamp,
        interventionCount: model.interventionCount + 1,
        ...(isQuestion && newTopics.length > 0
            ? { questionsAsked: [...new Set([...newTopics.slice(0, 1), ...model.questionsAsked])].slice(0, maxQuestions) }
            : {}),
        ...(!isQuestion && newTopics.length > 0
            ? { expertiseTopics: [...new Set([...newTopics.slice(0, 1), ...model.expertiseTopics])].slice(0, maxQuestions) }
            : {}),
    };

    return {
        ...updatedState,
        participants: { ...updatedState.participants, [name]: updatedModel },
        lastUpdated: timestamp,
    };
}

/**
 * Record an observed emotion for a participant.
 */
export function recordParticipantEmotion(
    state: TheoryOfMindState,
    name: string,
    emotion: string,
    timestamp: number = Date.now(),
    context?: string,
    config: Partial<TheoryOfMindConfig> = {},
): TheoryOfMindState {
    const cfg: TheoryOfMindConfig = { ...DEFAULT_THEORY_OF_MIND_CONFIG, ...config };
    const { state: updatedState, model } = getOrCreateParticipant(state, name, cfg);

    const updatedModel: ParticipantModel = {
        ...model,
        observedEmotions: [
            { emotion, timestamp, context },
            ...model.observedEmotions,
        ].slice(0, cfg.maxEmotionsPerParticipant),
        lastInteraction: timestamp,
    };

    return {
        ...updatedState,
        participants: { ...updatedState.participants, [name]: updatedModel },
        lastUpdated: timestamp,
    };
}

/**
 * Record a demonstrated preference for a participant.
 */
export function recordParticipantPreference(
    state: TheoryOfMindState,
    name: string,
    preference: string,
    timestamp: number = Date.now(),
): TheoryOfMindState {
    const { state: updatedState, model } = getOrCreateParticipant(state, name);

    const updatedModel: ParticipantModel = {
        ...model,
        demonstratedPreferences: [...new Set([preference, ...model.demonstratedPreferences])],
        lastInteraction: timestamp,
    };

    return {
        ...updatedState,
        participants: { ...updatedState.participants, [name]: updatedModel },
        lastUpdated: timestamp,
    };
}

/**
 * Get a participant's model by name.
 */
export function getParticipantModel(
    state: TheoryOfMindState,
    name: string,
): ParticipantModel | null {
    return state.participants[name] || null;
}

/**
 * Get all active participants (those who interacted recently).
 */
export function getActiveParticipants(
    state: TheoryOfMindState,
    now: number = Date.now(),
    inactivityMs: number = DEFAULT_THEORY_OF_MIND_CONFIG.participantInactivityMs,
): ParticipantModel[] {
    return Object.values(state.participants).filter((p) => {
        return (now - p.lastInteraction) < inactivityMs;
    });
}

/**
 * Get topics that a participant likely knows about.
 */
export function getParticipantKnowledge(
    state: TheoryOfMindState,
    name: string,
): string[] {
    const model = state.participants[name];
    if (!model) return [];
    return [...new Set([...model.expertiseTopics, ...model.knownTopics])];
}

/**
 * Check if a participant likely knows about a specific topic.
 */
export function participantKnowsTopic(
    state: TheoryOfMindState,
    name: string,
    topic: string,
): boolean {
    const model = state.participants[name];
    if (!model) return false;
    const topicLower = topic.toLowerCase();
    return model.knownTopics.some((t) => t.includes(topicLower) || topicLower.includes(t)) ||
        model.expertiseTopics.some((t) => t.includes(topicLower) || topicLower.includes(t));
}

/**
 * Get the last N interactions summary for a participant.
 */
export function getParticipantSummary(
    state: TheoryOfMindState,
    name: string,
    advancedConfig?: Partial<typeof DEFAULT_ADVANCED_CONFIG>,
): string {
    const model = state.participants[name];
    if (!model) return '';

    const adv: typeof DEFAULT_ADVANCED_CONFIG = { ...DEFAULT_ADVANCED_CONFIG, ...advancedConfig };
    const displayLimit = adv.tomSummaryDisplayLimit;
    const parts: string[] = [];
    parts.push(`${name} has intervened ${model.interventionCount} times.`);

    if (model.expertiseTopics.length > 0) {
        parts.push(`Shows expertise in: ${model.expertiseTopics.slice(0, displayLimit).join(', ')}.`);
    }

    if (model.questionsAsked.length > 0) {
        parts.push(`Has asked about: ${model.questionsAsked.slice(0, displayLimit).join(', ')}.`);
    }

    if (model.observedEmotions.length > 0) {
        const recentEmotion = model.observedEmotions[0];
        parts.push(`Last observed emotion: ${recentEmotion.emotion}.`);
    }

    if (model.demonstratedPreferences.length > 0) {
        parts.push(`Preferences: ${model.demonstratedPreferences.slice(0, displayLimit).join(', ')}.`);
    }

    return parts.join(' ');
}

/**
 * Format the theory of mind state for injection into Gemini's system prompt.
 */
export function formatTheoryOfMindForPrompt(
    state: TheoryOfMindState,
    language: 'es' | 'en' = 'es',
    now: number = Date.now(),
    advancedConfig?: Partial<typeof DEFAULT_ADVANCED_CONFIG>,
): string {
    const activeParticipants = getActiveParticipants(state, now);

    if (activeParticipants.length === 0) return '';

    const isEn = language === 'en';
    const lines: string[] = [];

    if (isEn) {
        lines.push('What I know about the other participants:');
    } else {
        lines.push('Lo que sé sobre los otros participantes:');
    }

    for (const participant of activeParticipants) {
        const summary = getParticipantSummary(state, participant.name, advancedConfig);
        if (summary) {
            lines.push(`  - ${summary}`);
        }
    }

    return lines.join('\n');
}
