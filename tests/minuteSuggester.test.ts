// ============================================================
// Unit Tests — minuteSuggester.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    evaluateMinuteSuggestion,
    buildMinuteSuggestionPrompt,
    DEFAULT_MINUTE_SUGGESTER_CONFIG,
    type MinuteSuggestionContext,
} from '../src/lib/minuteSuggester';

function makeContext(overrides: Partial<MinuteSuggestionContext> = {}): MinuteSuggestionContext {
    return {
        recentKeyPoints: ['We need more budget', 'Timeline is Q3', 'Alice will lead'],
        decisionDetected: true,
        keyPointCount: 3,
        minuteSavedRecently: false,
        timeSinceLastMinuteMs: 300_000,
        conversationActive: true,
        ...overrides,
    };
}

describe('minuteSuggester — evaluateMinuteSuggestion', () => {
    it('suggests when key points and decision detected', () => {
        const result = evaluateMinuteSuggestion(makeContext());
        expect(result.shouldSuggest).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
        expect(result.reason).toBe('decision_detected');
    });

    it('returns disabled when conversation is inactive', () => {
        const result = evaluateMinuteSuggestion(makeContext({ conversationActive: false }));
        expect(result.shouldSuggest).toBe(false);
        expect(result.reason).toBe('disabled_or_inactive');
    });

    it('returns too_soon when minute was saved recently', () => {
        const result = evaluateMinuteSuggestion(makeContext({
            minuteSavedRecently: true,
            timeSinceLastMinuteMs: 10_000,
        }));
        expect(result.shouldSuggest).toBe(false);
        expect(result.reason).toBe('too_soon');
    });

    it('returns not_enough_key_points when below threshold', () => {
        const result = evaluateMinuteSuggestion(makeContext({ keyPointCount: 1 }));
        expect(result.shouldSuggest).toBe(false);
        expect(result.reason).toBe('not_enough_key_points');
    });

    it('returns low_confidence when confidence below threshold', () => {
        // With 2 key points (meets minKeyPoints=2) but no decision:
        // confidence = min(1, 2/5) * 0.7 = 0.28, which is below minConfidence=0.3
        const result = evaluateMinuteSuggestion(makeContext({
            keyPointCount: 2,
            recentKeyPoints: ['Point A', 'Point B'],
            decisionDetected: false,
        }));
        expect(result.shouldSuggest).toBe(false);
        expect(result.reason).toBe('low_confidence');
    });

    it('suggests with key_points_available reason when no decision', () => {
        const result = evaluateMinuteSuggestion(makeContext({
            decisionDetected: false,
            keyPointCount: 5,
            recentKeyPoints: ['A', 'B', 'C', 'D', 'E'],
        }));
        expect(result.shouldSuggest).toBe(true);
        expect(result.reason).toBe('key_points_available');
    });

    it('uses first key point as title', () => {
        const result = evaluateMinuteSuggestion(makeContext({
            recentKeyPoints: ['Important decision made'],
        }));
        expect(result.title).toBe('Important decision made');
    });
});

describe('minuteSuggester — buildMinuteSuggestionPrompt', () => {
    it('returns empty string when shouldSuggest is false', () => {
        const suggestion = {
            shouldSuggest: false,
            title: '',
            keyPoints: [],
            confidence: 0,
            reason: 'disabled',
        };
        expect(buildMinuteSuggestionPrompt(suggestion)).toBe('');
    });

    it('builds Spanish prompt by default', () => {
        const suggestion = {
            shouldSuggest: true,
            title: 'Budget discussion',
            keyPoints: ['Need more funds', 'Q3 timeline'],
            confidence: 0.8,
            reason: 'decision_detected',
        };
        const prompt = buildMinuteSuggestionPrompt(suggestion);
        expect(prompt).toContain('SUGERENCIA DE MINUTA');
        expect(prompt).toContain('Budget discussion');
        expect(prompt).toContain('Need more funds');
    });

    it('builds English prompt when language=en', () => {
        const suggestion = {
            shouldSuggest: true,
            title: 'Budget discussion',
            keyPoints: ['Need more funds'],
            confidence: 0.8,
            reason: 'decision_detected',
        };
        const prompt = buildMinuteSuggestionPrompt(suggestion, 'en');
        expect(prompt).toContain('MINUTE SUGGESTION');
        expect(prompt).toContain('Budget discussion');
    });
});
