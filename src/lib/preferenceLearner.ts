// ============================================================
// Preference Learner
// ============================================================
// Learns user preferences from conversation patterns and
// explicit statements. Stores preferences in long-term memory
// and provides retrieval for personalization.
//
// Cumple:
//   - Rule #1: NO HARDCODE
//   - Pure functions — no React dependencies
// ============================================================

import { createMemory, queryMemories, saveMemory, touchMemory, type MemoryItem } from './longTermMemory';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export type PreferenceCategory =
    | 'communication_style'
    | 'topic_interest'
    | 'format_preference'
    | 'interaction_preference'
    | 'explicit_preference';

export interface Preference {
    category: PreferenceCategory;
    key: string;
    value: string | number | boolean;
    confidence: number; // 0-1
    source: 'explicit' | 'inferred' | 'repeated';
    firstObserved: number;
    lastObserved: number;
    observationCount: number;
}

export interface PreferenceObservation {
    text: string;
    speakerName?: string;
    timestamp: number;
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const PREFERENCE_CATEGORY = 'preference';

const PREFERENCE_PATTERNS: Record<PreferenceCategory, RegExp[]> = {
    communication_style: [
        /(?:prefiero|me gusta|i prefer|i like)\s+(?:un|un\s+tono|que\s+sea|a\s+que\s+sea)\s+(\w+)/i,
        /(?:sé|se\s+mas|be\s+more)\s+(\w+)/i,
        /(?:habla|speak)\s+(?:mas\s+)?(\w+)/i,
    ],
    topic_interest: [
        /(?:me\s+)?(?:interesa|gusta|encanta|fascina)\s+(?:el|la|los|las|hablar\s+de)\s+(\w+)/i,
        /(?:i'?m\s+)?(?:interested\s+in|into|love)\s+(\w+)/i,
        /(?:no\s+)?(?:me\s+)?(?:interesa|gusta)\s+(?:mucho\s+)?(?:el|la|hablar\s+de)\s+(\w+)/i,
    ],
    format_preference: [
        /(?:prefiero|quiero|necesito|i want|i need)\s+(?:un|una|que\s+sea|it\s+to\s+be)\s+(\w+)/i,
        /(?:hazlo|make\s+it|ponlo)\s+(\w+)/i,
    ],
    interaction_preference: [
        /(?:no\s+)?(?:me\s+)?(?:interrumpas|interrumpa|interrupt)\s+(\w+)/i,
        /(?:dejame|let\s+me|permíteme)\s+(\w+)/i,
        /(?:espera|wait|hold\s+on)\s+(\w+)/i,
    ],
    explicit_preference: [
        /(?:recuerda|remember|ten\s+en\s+cuenta|keep\s+in\s+mind)\s+(?:que\s+)?(.+)/i,
        /(?:esto\s+es\s+importante|this\s+is\s+important)\s*(?::|,)?\s*(.+)/i,
    ],
};

// -----------------------------------------------------------
// Preference Detection
// -----------------------------------------------------------

/**
 * Detect preference category from text.
 */
export function detectPreferenceCategory(text: string): PreferenceCategory | null {
    for (const [category, patterns] of Object.entries(PREFERENCE_PATTERNS)) {
        for (const pattern of patterns) {
            if (pattern.test(text)) {
                return category as PreferenceCategory;
            }
        }
    }
    return null;
}

/**
 * Extract preference key from text based on category patterns.
 */
export function extractPreferenceKey(text: string, category: PreferenceCategory): string | null {
    const patterns = PREFERENCE_PATTERNS[category];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].toLowerCase().trim();
        }
    }
    return null;
}

/**
 * Determine confidence based on observation count and source.
 */
export function computeConfidence(
    observationCount: number,
    source: Preference['source'],
): number {
    let base: number;
    switch (source) {
        case 'explicit':
            base = 0.7;
            break;
        case 'repeated':
            base = 0.5;
            break;
        case 'inferred':
            base = 0.3;
            break;
    }

    // Boost confidence with repeated observations
    const repetitionBoost = Math.min(0.25, observationCount * 0.05);
    return Math.min(1, base + repetitionBoost);
}

// -----------------------------------------------------------
// Preference Storage
// -----------------------------------------------------------

/**
 * Build a preference memory key.
 */
export function buildPreferenceKey(category: PreferenceCategory, key: string): string {
    return `pref:${category}:${key}`;
}

/**
 * Save an observed preference to long-term memory.
 */
export async function savePreference(
    observation: PreferenceObservation,
): Promise<Preference | null> {
    const category = detectPreferenceCategory(observation.text);
    if (!category) return null;

    const key = extractPreferenceKey(observation.text, category);
    if (!key) return null;

    const prefKey = buildPreferenceKey(category, key);

    // Check if preference already exists
    const existing = await queryMemories({
        tags: [prefKey],
        limit: 1,
    });

    if (existing.length > 0) {
        // Update existing preference
        const existingMem = existing[0];
        const data = JSON.parse(existingMem.content) as Preference;
        data.observationCount += 1;
        data.lastObserved = observation.timestamp;
        data.confidence = computeConfidence(data.observationCount, data.source);
        data.source = data.observationCount >= 3 ? 'repeated' : data.source;

        existingMem.content = JSON.stringify(data);
        await saveMemory(existingMem);
        await touchMemory(existingMem.id);

        return data;
    }

    // Create new preference
    const source: Preference['source'] = 'explicit';
    const preference: Preference = {
        category,
        key,
        value: key,
        confidence: computeConfidence(1, source),
        source,
        firstObserved: observation.timestamp,
        lastObserved: observation.timestamp,
        observationCount: 1,
    };

    const memory = createMemory(
        PREFERENCE_CATEGORY,
        JSON.stringify(preference),
        preference.confidence,
        [prefKey, category, `speaker:${observation.speakerName || 'unknown'}`],
    );

    await saveMemory(memory);
    return preference;
}

// -----------------------------------------------------------
// Preference Retrieval
// -----------------------------------------------------------

/**
 * Get all learned preferences.
 */
export async function getPreferences(): Promise<Preference[]> {
    const memories = await queryMemories({
        categories: [PREFERENCE_CATEGORY],
        minImportance: 0.2,
        limit: 100,
    });

    return memories
        .map((mem) => {
            try {
                return JSON.parse(mem.content) as Preference;
            } catch {
                return null;
            }
        })
        .filter((p): p is Preference => p !== null);
}

/**
 * Get preferences by category.
 */
export async function getPreferencesByCategory(category: PreferenceCategory): Promise<Preference[]> {
    const all = await getPreferences();
    return all.filter((p) => p.category === category);
}

/**
 * Format preferences for Gemini system prompt injection.
 */
export async function formatPreferencesForPrompt(): Promise<string> {
    const preferences = await getPreferences();
    if (preferences.length === 0) return '';

    const lines: string[] = ['User preferences:'];
    for (const pref of preferences) {
        const confidenceLabel = pref.confidence > 0.7 ? 'high' : pref.confidence > 0.4 ? 'medium' : 'low';
        lines.push(`- [${pref.category}] ${pref.key} (${confidenceLabel} confidence, observed ${pref.observationCount}x)`);
    }

    return lines.join('\n');
}
