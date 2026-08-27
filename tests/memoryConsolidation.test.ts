// ============================================================
// Unit Tests — memoryConsolidation.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    scoreEntryImportance,
    extractFactsFromEntry,
    buildConsolidationSummary,
    shouldRunConsolidation,
    DEFAULT_CONSOLIDATION_CONFIG,
} from '../src/lib/memoryConsolidation';
import type { ConversationEntry } from '../src/types/bridge';

function makeEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
    return {
        id: 'entry-1',
        role: 'user',
        speakerName: 'Alice',
        text: 'I think we should increase the budget',
        timestamp: Date.now(),
        sentiment: 'neutral',
        ...overrides,
    } as ConversationEntry;
}

describe('memoryConsolidation — scoreEntryImportance', () => {
    it('returns baseline score for short entry', () => {
        const entry = makeEntry({ text: 'OK' });
        const score = scoreEntryImportance(entry);
        expect(score).toBe(0.3); // baseline
    });

    it('boosts score for long entries', () => {
        const short = makeEntry({ text: 'A'.repeat(50) });
        const long = makeEntry({ text: 'A'.repeat(200) });
        expect(scoreEntryImportance(long)).toBeGreaterThan(scoreEntryImportance(short));
    });

    it('boosts score for FLU responses', () => {
        const user = makeEntry({ role: 'user' });
        const flu = makeEntry({ role: 'flu', text: 'A'.repeat(50) });
        expect(scoreEntryImportance(flu)).toBeGreaterThan(scoreEntryImportance(user));
    });

    it('boosts score for decisions', () => {
        const entry = makeEntry({ text: 'Acordamos aumentar el presupuesto' });
        const score = scoreEntryImportance(entry);
        expect(score).toBeGreaterThan(0.3);
    });

    it('boosts score for agreements', () => {
        const entry = makeEntry({ text: 'Estoy de acuerdo con la propuesta' });
        const score = scoreEntryImportance(entry);
        expect(score).toBeGreaterThan(0.3);
    });

    it('boosts score for preferences', () => {
        const entry = makeEntry({ text: 'Me gusta este enfoque' });
        const score = scoreEntryImportance(entry);
        expect(score).toBeGreaterThan(0.3);
    });

    it('caps score at 1.0', () => {
        const entry = makeEntry({
            text: 'Acordamos que me gusta y decidimos aumentar el presupuesto para el proyecto que necesitamos lanzar cuanto antes porque es muy importante para todos '.repeat(5),
            role: 'flu',
        });
        const score = scoreEntryImportance(entry);
        expect(score).toBeLessThanOrEqual(1);
    });
});

describe('memoryConsolidation — extractFactsFromEntry', () => {
    it('returns facts for important entries', () => {
        const entry = makeEntry({ text: 'Decidimos lanzar en Q3' });
        const facts = extractFactsFromEntry(entry);
        expect(facts.length).toBeGreaterThan(0);
        expect(facts[0]).toBe('Decidimos lanzar en Q3');
    });

    it('returns empty for low-importance entries', () => {
        const entry = makeEntry({ text: 'OK' });
        const facts = extractFactsFromEntry(entry);
        expect(facts).toEqual([]);
    });

    it('returns empty for empty text', () => {
        const entry = makeEntry({ text: '' });
        const facts = extractFactsFromEntry(entry);
        expect(facts).toEqual([]);
    });
});

describe('memoryConsolidation — buildConsolidationSummary', () => {
    it('returns empty string for empty memories', () => {
        expect(buildConsolidationSummary([])).toBe('');
    });

    it('groups memories by category', () => {
        const memories = [
            { id: '1', category: 'conversation_fact', content: 'Fact 1', importance: 0.8, tags: [], sessionId: '', createdAt: 0, lastAccessedAt: 0, accessCount: 0, ttl: 0 },
            { id: '2', category: 'conversation_fact', content: 'Fact 2', importance: 0.6, tags: [], sessionId: '', createdAt: 0, lastAccessedAt: 0, accessCount: 0, ttl: 0 },
            { id: '3', category: 'preference', content: 'Pref 1', importance: 0.9, tags: [], sessionId: '', createdAt: 0, lastAccessedAt: 0, accessCount: 0, ttl: 0 },
        ];
        const summary = buildConsolidationSummary(memories as any);
        expect(summary).toContain('conversation_fact');
        expect(summary).toContain('preference');
        expect(summary).toContain('Fact 1');
        expect(summary).toContain('Pref 1');
    });
});

describe('memoryConsolidation — shouldRunConsolidation', () => {
    it('returns true when batch size is met', () => {
        expect(shouldRunConsolidation(10)).toBe(true);
    });

    it('returns false when batch size is not met', () => {
        expect(shouldRunConsolidation(5)).toBe(false);
    });

    it('uses custom config', () => {
        expect(shouldRunConsolidation(5, { ...DEFAULT_CONSOLIDATION_CONFIG, batchSize: 5 })).toBe(true);
    });
});
