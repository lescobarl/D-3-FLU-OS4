// ============================================================
// Forgetting Curve — Ebbinghaus-based Memory Retrieval
// ============================================================
// Implements the Ebbinghaus forgetting curve to determine
// memory retrieval probability based on time since last access,
// importance, and access count.
//
// Cumple:
//   - Rule #1: NO HARDCODE
//   - Pure functions — no React dependencies
// ============================================================

import { queryMemories, touchMemory, type MemoryItem } from './longTermMemory';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface ForgettingCurveConfig {
    /** Base retention rate after 1 hour (0-1) */
    baseRetentionRate: number;
    /** Half-life in ms for a memory of importance 0.5 */
    baseHalfLife: number;
    /** Importance multiplier for half-life (higher = longer retention) */
    importanceHalfLifeMultiplier: number;
    /** Reinforcement multiplier per access */
    reinforcementMultiplier: number;
    /** Minimum retrieval probability to include in results */
    minRetrievalProbability: number;
    /** Maximum items to return per query */
    maxItems: number;
}

export interface RetrievalScore {
    memory: MemoryItem;
    /** Probability of retrieval (0-1) based on forgetting curve */
    probability: number;
    /** Effective half-life considering importance and reinforcement */
    effectiveHalfLife: number;
    /** Time since last access in ms */
    timeSinceAccess: number;
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

export const DEFAULT_FORGETTING_CURVE_CONFIG: ForgettingCurveConfig = {
    baseRetentionRate: 0.5,       // 50% retention after 1 hour at base importance
    baseHalfLife: 60 * 60 * 1000, // 1 hour base half-life
    importanceHalfLifeMultiplier: 2, // double half-life per 0.5 importance above baseline
    reinforcementMultiplier: 1.3, // 30% half-life extension per access
    minRetrievalProbability: 0.1, // minimum 10% probability to include
    maxItems: 20,
};

// -----------------------------------------------------------
// Forgetting Curve Calculation
// -----------------------------------------------------------

/**
 * Calculate the effective half-life of a memory based on its
 * importance and access count (reinforcement).
 *
 * Uses the formula:
 *   effectiveHalfLife = baseHalfLife * (1 + importance * importanceMultiplier) * (reinforcement ^ accessCount)
 */
export function calculateEffectiveHalfLife(
    memory: MemoryItem,
    config: ForgettingCurveConfig = DEFAULT_FORGETTING_CURVE_CONFIG,
): number {
    const importanceFactor = 1 + (memory.importance * config.importanceHalfLifeMultiplier);
    const reinforcementFactor = Math.pow(config.reinforcementMultiplier, memory.accessCount);

    return config.baseHalfLife * importanceFactor * reinforcementFactor;
}

/**
 * Calculate retrieval probability using the Ebbinghaus forgetting curve.
 *
 * Uses the formula:
 *   probability = baseRetentionRate ^ (timeSinceAccess / effectiveHalfLife)
 *
 * This creates an exponential decay where:
 *   - At t=0: probability = 1.0
 *   - At t=effectiveHalfLife: probability = baseRetentionRate
 *   - As t → ∞: probability → 0
 */
export function calculateRetrievalProbability(
    memory: MemoryItem,
    config: ForgettingCurveConfig = DEFAULT_FORGETTING_CURVE_CONFIG,
): number {
    const now = Date.now();
    const timeSinceAccess = Math.max(0, now - memory.lastAccessedAt);
    const effectiveHalfLife = calculateEffectiveHalfLife(memory, config);

    if (effectiveHalfLife <= 0) return 0;

    // Ebbinghaus forgetting curve: R = R₀^(t/T)
    // where R₀ = baseRetentionRate, t = timeSinceAccess, T = effectiveHalfLife
    const probability = Math.pow(config.baseRetentionRate, timeSinceAccess / effectiveHalfLife);

    return Math.max(0, Math.min(1, probability));
}

/**
 * Score memories by retrieval probability and return sorted results.
 */
export function scoreMemoriesByRetrieval(
    memories: MemoryItem[],
    config: ForgettingCurveConfig = DEFAULT_FORGETTING_CURVE_CONFIG,
): RetrievalScore[] {
    const now = Date.now();

    const scored: RetrievalScore[] = memories.map((memory) => {
        const timeSinceAccess = Math.max(0, now - memory.lastAccessedAt);
        const effectiveHalfLife = calculateEffectiveHalfLife(memory, config);
        const probability = calculateRetrievalProbability(memory, config);

        return {
            memory,
            probability,
            effectiveHalfLife,
            timeSinceAccess,
        };
    });

    // Sort by probability (descending) — most retrievable first
    scored.sort((a, b) => b.probability - a.probability);

    return scored;
}

/**
 * Get retrievable memories from long-term storage, filtered by
 * minimum retrieval probability.
 */
export async function getRetrievableMemories(
    categories?: string[],
    config: ForgettingCurveConfig = DEFAULT_FORGETTING_CURVE_CONFIG,
): Promise<RetrievalScore[]> {
    const memories = await queryMemories({
        categories,
        limit: config.maxItems * 2, // fetch extra for filtering
    });

    const scored = scoreMemoriesByRetrieval(memories, config);

    return scored.filter((s) => s.probability >= config.minRetrievalProbability)
        .slice(0, config.maxItems);
}

/**
 * Touch a memory (update access time) after retrieval.
 * This reinforces the memory and extends its half-life.
 */
export async function reinforceMemory(memoryId: string): Promise<void> {
    await touchMemory(memoryId);
}

/**
 * Determine if a memory needs reinforcement (probability below threshold).
 */
export function needsReinforcement(
    memory: MemoryItem,
    threshold: number = 0.3,
    config: ForgettingCurveConfig = DEFAULT_FORGETTING_CURVE_CONFIG,
): boolean {
    const probability = calculateRetrievalProbability(memory, config);
    return probability < threshold;
}

/**
 * Format retrievable memories for Gemini prompt injection.
 */
export function formatRetrievableMemoriesForPrompt(
    scored: RetrievalScore[],
    maxItems: number = 5,
): string {
    if (scored.length === 0) return '';

    const items = scored.slice(0, maxItems);
    const lines = items.map((s, i) => {
        const hoursSinceAccess = (s.timeSinceAccess / (1000 * 60 * 60)).toFixed(1);
        return `${i + 1}. [${s.memory.category}] (${hoursSinceAccess}h ago, recall: ${(s.probability * 100).toFixed(0)}%) ${s.memory.content}`;
    });

    return `\nRelevant past memories:\n${lines.join('\n')}`;
}
