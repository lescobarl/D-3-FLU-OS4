// ============================================================
// Unit Tests — proactiveEngine.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    evaluateProactiveTriggers,
    buildProactivePrompt,
    DEFAULT_PROACTIVE_CONFIG,
    type ProactiveContext,
} from '../src/lib/proactiveEngine';

function makeContext(overrides: Partial<ProactiveContext> = {}): ProactiveContext {
    return {
        silenceDurationMs: 5000,
        decisionDetected: false,
        hasUnresolvedTopics: false,
        participantCount: 2,
        sessionDurationMs: 600_000,
        turnsSinceLastFluSpeech: 5,
        topicJustCompleted: false,
        hasPendingFollowUp: false,
        hasPendingAgenda: false,
        phase: 'discussion',
        ...overrides,
    };
}

describe('proactiveEngine — evaluateProactiveTriggers', () => {
    it('returns null when disabled', () => {
        const result = evaluateProactiveTriggers(makeContext(), { enabled: false });
        expect(result).toBeNull();
    });

    it('returns null when FLU spoke recently', () => {
        const result = evaluateProactiveTriggers(makeContext({ turnsSinceLastFluSpeech: 1 }));
        expect(result).toBeNull();
    });

    it('triggers long_silence when silence exceeds threshold', () => {
        const result = evaluateProactiveTriggers(makeContext({ silenceDurationMs: 60_000 }));
        expect(result).not.toBeNull();
        expect(result!.trigger).toBe('long_silence');
        expect(result!.priority).toBe(0.9);
    });

    it('triggers decision_made when decision detected', () => {
        const result = evaluateProactiveTriggers(makeContext({ decisionDetected: true }));
        expect(result).not.toBeNull();
        expect(result!.trigger).toBe('decision_made');
        expect(result!.priority).toBe(0.8);
    });

    it('triggers unresolved_topic when unresolved topics exist', () => {
        const result = evaluateProactiveTriggers(makeContext({ hasUnresolvedTopics: true }));
        expect(result).not.toBeNull();
        expect(result!.trigger).toBe('unresolved_topic');
    });

    it('triggers session_time when session exceeds wrap-up threshold', () => {
        const result = evaluateProactiveTriggers(makeContext({ sessionDurationMs: 60 * 60 * 1000 }));
        expect(result).not.toBeNull();
        expect(result!.trigger).toBe('session_time');
    });

    it('triggers topic_completion when topic just completed', () => {
        const result = evaluateProactiveTriggers(makeContext({ topicJustCompleted: true }));
        expect(result).not.toBeNull();
        expect(result!.trigger).toBe('topic_completion');
    });

    it('triggers follow_up_needed when pending follow-up exists', () => {
        const result = evaluateProactiveTriggers(makeContext({ hasPendingFollowUp: true }));
        expect(result).not.toBeNull();
        expect(result!.trigger).toBe('follow_up_needed');
    });

    it('returns highest priority trigger when multiple fire', () => {
        const result = evaluateProactiveTriggers(makeContext({
            silenceDurationMs: 60_000,
            decisionDetected: true,
            hasPendingFollowUp: true,
        }));
        expect(result).not.toBeNull();
        // long_silence (0.9) > follow_up_needed (0.85) > decision_made (0.8)
        expect(result!.trigger).toBe('long_silence');
    });

    it('returns null when no triggers fire', () => {
        const result = evaluateProactiveTriggers(makeContext({
            silenceDurationMs: 5000,
            turnsSinceLastFluSpeech: 10,
        }));
        expect(result).toBeNull();
    });
});

describe('proactiveEngine — buildProactivePrompt', () => {
    it('builds Spanish prompt by default', () => {
        const suggestion = {
            trigger: 'long_silence' as const,
            priority: 0.9,
            suggestionText: 'Test suggestion',
            suggestedEmotion: 'interesado',
        };
        const prompt = buildProactivePrompt(suggestion);
        expect(prompt).toContain('INTERVENCIÓN PROACTIVA');
        expect(prompt).toContain('Test suggestion');
    });

    it('builds English prompt when language=en', () => {
        const suggestion = {
            trigger: 'long_silence' as const,
            priority: 0.9,
            suggestionText: 'Test suggestion',
            suggestedEmotion: 'interesado',
        };
        const prompt = buildProactivePrompt(suggestion, 'en');
        expect(prompt).toContain('PROACTIVE INTERVENTION');
        expect(prompt).toContain('Test suggestion');
    });
});
