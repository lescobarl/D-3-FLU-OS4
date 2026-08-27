// ============================================================
// Memory Consolidation
// ============================================================
// Consolidates short-term conversation entries into long-term
// memory items. Uses importance scoring to determine what to
// keep, and aggregates related facts into summaries.
//
// Cumple:
//   - Rule #1: NO HARDCODE
//   - Pure functions — no React dependencies
// ============================================================

import type { ConversationEntry } from '../types/bridge';
import { createMemory, saveMemories, type MemoryItem } from './longTermMemory';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface ConsolidationConfig {
    /** Minimum importance score to keep a fact (0-1) */
    minFactImportance: number;
    /** Number of entries to batch before consolidating */
    batchSize: number;
    /** Importance boost for entries with decisions */
    decisionBoost: number;
    /** Importance boost for entries with agreements */
    agreementBoost: number;
    /** Importance boost for user preferences */
    preferenceBoost: number;
    /** Maximum facts per consolidation cycle */
    maxFactsPerCycle: number;
    /** Session ID for tagging memories */
    sessionId: string;
}

export interface ConsolidationResult {
    consolidated: number;
    skipped: number;
    memories: MemoryItem[];
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
    minFactImportance: 0.4,
    batchSize: 10,
    decisionBoost: 0.3,
    agreementBoost: 0.2,
    preferenceBoost: 0.25,
    maxFactsPerCycle: 5,
    sessionId: '',
};

// -----------------------------------------------------------
// Importance Scoring
// -----------------------------------------------------------

/**
 * Score the importance of a conversation entry for long-term retention.
 * Returns a value between 0 and 1.
 */
export function scoreEntryImportance(
    entry: ConversationEntry,
    config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
): number {
    let score = 0.3; // baseline

    const text = (entry.text || '').toLowerCase();

    // Longer entries tend to have more substance
    if (text.length > 100) score += 0.1;
    if (text.length > 300) score += 0.1;

    // FLU responses often contain synthesized information
    if (entry.role === 'flu') score += 0.1;

    // Detect decisions (palabras clave)
    const decisionWords = ['acordamos', 'decidimos', 'vamos a', 'hay que', 'tenemos que', 'decided', 'agreed', 'let\'s'];
    if (decisionWords.some((w) => text.includes(w))) {
        score += config.decisionBoost;
    }

    // Detect agreements
    const agreementWords = ['de acuerdo', 'estoy de acuerdo', 'me parece bien', 'agree', 'sounds good', 'correcto'];
    if (agreementWords.some((w) => text.includes(w))) {
        score += config.agreementBoost;
    }

    // Detect preferences
    const preferenceWords = ['me gusta', 'prefiero', 'quiero', 'necesito', 'i like', 'i prefer', 'i want', 'i need'];
    if (preferenceWords.some((w) => text.includes(w))) {
        score += config.preferenceBoost;
    }

    // Entries with responses are more valuable (they have context)
    if (entry.response) score += 0.05;

    // Cap at 1.0
    return Math.min(1, score);
}

/**
 * Extract key facts from a conversation entry.
 */
export function extractFactsFromEntry(
    entry: ConversationEntry,
    config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
): string[] {
    const facts: string[] = [];
    const text = (entry.text || '').trim();
    if (!text) return facts;

    const importance = scoreEntryImportance(entry, config);
    if (importance < config.minFactImportance) return facts;

    // The entire entry text is a fact if important enough
    facts.push(text);

    return facts;
}

// -----------------------------------------------------------
// Consolidation
// -----------------------------------------------------------

/**
 * Consolidate a batch of conversation entries into long-term memories.
 * Returns the memories that were created.
 */
export async function consolidateEntries(
    entries: ConversationEntry[],
    config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
): Promise<ConsolidationResult> {
    const memories: MemoryItem[] = [];
    let skipped = 0;

    for (const entry of entries) {
        const facts = extractFactsFromEntry(entry, config);
        if (facts.length === 0) {
            skipped++;
            continue;
        }

        const importance = scoreEntryImportance(entry, config);

        for (const fact of facts.slice(0, config.maxFactsPerCycle)) {
            const tags: string[] = [entry.role];
            if (entry.speakerName) tags.push(entry.speakerName);
            if (entry.sentiment) tags.push(`sentiment:${entry.sentiment}`);

            const memory = createMemory(
                'conversation_fact',
                fact,
                importance,
                tags,
                config.sessionId,
            );
            memories.push(memory);
        }
    }

    // Save all memories in a single transaction
    if (memories.length > 0) {
        await saveMemories(memories);
    }

    return {
        consolidated: memories.length,
        skipped,
        memories,
    };
}

/**
 * Build a consolidation summary string for prompt injection.
 */
export function buildConsolidationSummary(memories: MemoryItem[]): string {
    if (memories.length === 0) return '';

    const byCategory: Record<string, MemoryItem[]> = {};
    for (const mem of memories) {
        if (!byCategory[mem.category]) byCategory[mem.category] = [];
        byCategory[mem.category].push(mem);
    }

    const parts: string[] = [];
    for (const [category, items] of Object.entries(byCategory)) {
        const topItems = items
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 3)
            .map((item) => item.content);
        parts.push(`[${category}]: ${topItems.join(' | ')}`);
    }

    return parts.join('\n');
}

/**
 * Determine if consolidation should run based on entry count.
 */
export function shouldRunConsolidation(
    currentBatch: number,
    config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
): boolean {
    return currentBatch >= config.batchSize;
}
