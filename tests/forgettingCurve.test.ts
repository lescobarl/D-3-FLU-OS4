// ============================================================
// Unit Tests — forgettingCurve.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    calculateEffectiveHalfLife,
    calculateRetrievalProbability,
    scoreMemoriesByRetrieval,
    needsReinforcement,
    formatRetrievableMemoriesForPrompt,
    DEFAULT_FORGETTING_CURVE_CONFIG,
    type RetrievalScore,
} from '../src/lib/forgettingCurve';
import type { MemoryItem } from '../src/lib/longTermMemory';

function makeMemory(overrides: Partial<MemoryItem> = {}): MemoryItem {
    return {
        id: 'mem-1',
        category: 'conversation_fact',
        content: 'Important decision was made',
        importance: 0.8,
        tags: ['decision'],
        sessionId: 'session-1',
        createdAt: Date.now() - 3600_000, // 1 hour ago
        lastAccessedAt: Date.now() - 1800_000, // 30 min ago
        accessCount: 2,
        ttl: 30 * 24 * 3600_000,
        ...overrides,
    };
}

describe('forgettingCurve — calculateEffectiveHalfLife', () => {
    it('calculates half-life based on importance and access count', () => {
        const memory = makeMemory({ importance: 0.5, accessCount: 0 });
        const halfLife = calculateEffectiveHalfLife(memory);
        // baseHalfLife=3600000 * (1 + 0.5*2) * (1.3^0) = 3600000 * 2 = 7200000
        expect(halfLife).toBe(3600_000 * (1 + 0.5 * 2));
    });

    it('extends half-life with more accesses', () => {
        const memory = makeMemory({ importance: 0.5, accessCount: 3 });
        const halfLife = calculateEffectiveHalfLife(memory);
        // 3600000 * 2 * (1.3^3) = 7200000 * 2.197 = ~15818400
        expect(halfLife).toBeGreaterThan(7200_000);
    });

    it('uses higher importance for longer half-life', () => {
        const low = makeMemory({ importance: 0.3, accessCount: 0 });
        const high = makeMemory({ importance: 0.9, accessCount: 0 });
        expect(calculateEffectiveHalfLife(high)).toBeGreaterThan(calculateEffectiveHalfLife(low));
    });
});

describe('forgettingCurve — calculateRetrievalProbability', () => {
    it('returns 1.0 for just-accessed memory', () => {
        const memory = makeMemory({ lastAccessedAt: Date.now() });
        const prob = calculateRetrievalProbability(memory);
        expect(prob).toBeCloseTo(1.0, 1);
    });

    it('returns baseRetentionRate at exactly half-life', () => {
        const halfLife = 3600_000; // 1 hour
        const memory = makeMemory({
            importance: 0,
            accessCount: 0,
            lastAccessedAt: Date.now() - halfLife,
        });
        const prob = calculateRetrievalProbability(memory);
        // At t=halfLife, probability should be baseRetentionRate (0.5)
        // effectiveHalfLife = 3600000 * (1 + 0*2) * (1.3^0) = 3600000
        // probability = 0.5^(3600000/3600000) = 0.5
        expect(prob).toBeCloseTo(0.5, 1);
    });

    it('returns lower probability for older memories', () => {
        const recent = makeMemory({ lastAccessedAt: Date.now() - 60_000 });
        const old = makeMemory({ lastAccessedAt: Date.now() - 86400_000 });
        expect(calculateRetrievalProbability(old)).toBeLessThan(calculateRetrievalProbability(recent));
    });
});

describe('forgettingCurve — scoreMemoriesByRetrieval', () => {
    it('sorts memories by probability descending', () => {
        const recent = makeMemory({ id: 'recent', lastAccessedAt: Date.now() - 60_000 });
        const old = makeMemory({ id: 'old', lastAccessedAt: Date.now() - 86400_000 * 7 });
        const scored = scoreMemoriesByRetrieval([old, recent]);
        expect(scored[0].memory.id).toBe('recent');
        expect(scored[1].memory.id).toBe('old');
    });

    it('returns RetrievalScore objects with all fields', () => {
        const memory = makeMemory();
        const scored = scoreMemoriesByRetrieval([memory]);
        expect(scored[0].probability).toBeGreaterThanOrEqual(0);
        expect(scored[0].effectiveHalfLife).toBeGreaterThan(0);
        expect(scored[0].timeSinceAccess).toBeGreaterThanOrEqual(0);
    });
});

describe('forgettingCurve — needsReinforcement', () => {
    it('returns false for recently accessed memory', () => {
        const memory = makeMemory({ lastAccessedAt: Date.now() });
        expect(needsReinforcement(memory)).toBe(false);
    });

    it('returns true for old memory with low probability', () => {
        const memory = makeMemory({
            importance: 0.3,
            accessCount: 0,
            lastAccessedAt: Date.now() - 86400_000 * 30, // 30 days ago
        });
        expect(needsReinforcement(memory)).toBe(true);
    });
});

describe('forgettingCurve — formatRetrievableMemoriesForPrompt', () => {
    it('returns empty string for empty scored list', () => {
        expect(formatRetrievableMemoriesForPrompt([])).toBe('');
    });

    it('formats scored memories for prompt', () => {
        const memory = makeMemory();
        const scored: RetrievalScore[] = [{
            memory,
            probability: 0.85,
            effectiveHalfLife: 7200_000,
            timeSinceAccess: 1800_000,
        }];
        const prompt = formatRetrievableMemoriesForPrompt(scored);
        expect(prompt).toContain('Relevant past memories');
        expect(prompt).toContain('conversation_fact');
        expect(prompt).toContain('85%');
    });

    it('respects maxItems limit', () => {
        const m1 = makeMemory({ id: '1' });
        const m2 = makeMemory({ id: '2' });
        const m3 = makeMemory({ id: '3' });
        const scored: RetrievalScore[] = [
            { memory: m1, probability: 0.9, effectiveHalfLife: 1000, timeSinceAccess: 100 },
            { memory: m2, probability: 0.8, effectiveHalfLife: 1000, timeSinceAccess: 200 },
            { memory: m3, probability: 0.7, effectiveHalfLife: 1000, timeSinceAccess: 300 },
        ];
        const prompt = formatRetrievableMemoriesForPrompt(scored, 2);
        expect(prompt).toContain('1.');
        expect(prompt).toContain('2.');
        expect(prompt).not.toContain('3.');
    });
});
