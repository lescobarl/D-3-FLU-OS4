// ============================================================
// Unit Tests — conversationFlow.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    analyzeConversationFlow,
    buildFlowContext,
    DEFAULT_FLOW_CONFIG,
    type ConversationFlowContext,
} from '../src/lib/conversationFlow';

function makeContext(overrides: Partial<ConversationFlowContext> = {}): ConversationFlowContext {
    return {
        recentSpeakers: ['Alice', 'Bob'],
        turnTimestamps: [1000, 3000, 5000],
        currentSpeaker: 'Bob',
        silenceSinceLastSpeechMs: 2000,
        lastWasQuestion: false,
        fluWasAddressed: false,
        rapidExchangeCount: 0,
        averageTurnGapMs: 2000,
        ...overrides,
    };
}

describe('conversationFlow — analyzeConversationFlow', () => {
    it('responds immediately when FLU is addressed', () => {
        const result = analyzeConversationFlow(makeContext({ fluWasAddressed: true }));
        expect(result.shouldRespond).toBe(true);
        expect(result.urgency).toBe(1.0);
        expect(result.recommendedWaitMs).toBe(500);
    });

    it('waits when rapid exchanges exceed limit', () => {
        const result = analyzeConversationFlow(makeContext({ rapidExchangeCount: 5 }));
        expect(result.shouldWait).toBe(true);
        expect(result.waitReason).toBe('rapid_exchange');
        expect(result.recommendedWaitMs).toBe(3000);
    });

    it('responds to question with sufficient pause', () => {
        const result = analyzeConversationFlow(makeContext({
            lastWasQuestion: true,
            silenceSinceLastSpeechMs: 2000,
        }));
        expect(result.shouldRespond).toBe(true);
        expect(result.urgency).toBe(0.8);
    });

    it('waits when conversation velocity is high', () => {
        const result = analyzeConversationFlow(makeContext({
            averageTurnGapMs: 500,
            turnTimestamps: [1000, 1200, 1400, 1600],
        }));
        expect(result.shouldWait).toBe(true);
        expect(result.waitReason).toBe('high_velocity');
    });

    it('returns moderate urgency by default', () => {
        const result = analyzeConversationFlow(makeContext());
        expect(result.shouldWait).toBe(false);
        expect(result.shouldRespond).toBe(false);
        expect(result.urgency).toBe(0.5);
        expect(result.recommendedWaitMs).toBe(1000);
    });
});

describe('conversationFlow — buildFlowContext', () => {
    it('builds context from raw data', () => {
        const ctx = buildFlowContext(
            ['Alice', 'Bob'],
            [1000, 3000, 5000],
            'What do you think?',
            'Bob',
            'flu',
            6000,
        );
        expect(ctx.currentSpeaker).toBe('Bob');
        expect(ctx.lastWasQuestion).toBe(true);
        expect(ctx.silenceSinceLastSpeechMs).toBe(1000);
    });

    it('detects FLU address in text', () => {
        const ctx = buildFlowContext(
            ['Alice'],
            [1000],
            'Hey flu, what do you think?',
            'Alice',
            'flu',
            2000,
        );
        expect(ctx.fluWasAddressed).toBe(true);
    });

    it('counts rapid exchanges', () => {
        const ctx = buildFlowContext(
            ['Alice', 'Bob', 'Alice'],
            [1000, 1500, 1800],
            'Hello',
            'Alice',
            'flu',
            2000,
        );
        expect(ctx.rapidExchangeCount).toBeGreaterThanOrEqual(2);
    });
});
