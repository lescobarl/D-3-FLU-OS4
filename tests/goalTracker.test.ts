// ============================================================
// Unit Tests — goalTracker.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    createSessionProgress,
    addGoal,
    recordDecision,
    trackTopic,
    completeTopic,
    addPendingAction,
    computeOverallProgress,
    formatSessionProgressForPrompt,
} from '../src/lib/goalTracker';

describe('goalTracker — createSessionProgress', () => {
    it('creates empty progress state', () => {
        const progress = createSessionProgress(1000);
        expect(progress.goals).toEqual([]);
        expect(progress.decisions).toEqual([]);
        expect(progress.topics).toEqual([]);
        expect(progress.pendingActions).toEqual([]);
        expect(progress.sessionStart).toBe(1000);
        expect(progress.overallProgress).toBe(0);
    });
});

describe('goalTracker — addGoal', () => {
    it('adds a goal to the session', () => {
        const progress = createSessionProgress();
        const updated = addGoal(progress, 'Decide timeline', 'decision', 0.8);
        expect(updated.goals.length).toBe(1);
        expect(updated.goals[0].description).toBe('Decide timeline');
        expect(updated.goals[0].category).toBe('decision');
        expect(updated.goals[0].priority).toBe(0.8);
        expect(updated.goals[0].status).toBe('active');
    });
});

describe('goalTracker — recordDecision', () => {
    it('records a decision', () => {
        const progress = createSessionProgress();
        const updated = recordDecision(progress, 'We will launch in Q3', 'Alice', 0.9);
        expect(updated.decisions.length).toBe(1);
        expect(updated.decisions[0].description).toBe('We will launch in Q3');
        expect(updated.decisions[0].decidedBy).toBe('Alice');
        expect(updated.decisions[0].confidence).toBe(0.9);
    });
});

describe('goalTracker — trackTopic', () => {
    it('tracks a new topic', () => {
        const progress = createSessionProgress();
        const updated = trackTopic(progress, 'Budget', 'We need $50k');
        expect(updated.topics.length).toBe(1);
        expect(updated.topics[0].name).toBe('Budget');
        expect(updated.topics[0].keyPoints).toContain('We need $50k');
    });

    it('updates existing topic with new key point', () => {
        let progress = createSessionProgress();
        progress = trackTopic(progress, 'Budget', 'We need $50k');
        progress = trackTopic(progress, 'Budget', 'Approved by board');
        expect(progress.topics.length).toBe(1);
        expect(progress.topics[0].keyPoints.length).toBe(2);
    });
});

describe('goalTracker — completeTopic', () => {
    it('marks topic as completed', () => {
        let progress = createSessionProgress();
        progress = trackTopic(progress, 'Budget');
        progress = completeTopic(progress, 'Budget');
        expect(progress.topics[0].status).toBe('completed');
    });
});

describe('goalTracker — addPendingAction', () => {
    it('adds a pending action', () => {
        const progress = createSessionProgress();
        const updated = addPendingAction(progress, 'Send report', 'Bob');
        expect(updated.pendingActions.length).toBe(1);
        expect(updated.pendingActions[0].description).toBe('Send report');
        expect(updated.pendingActions[0].assignee).toBe('Bob');
        expect(updated.pendingActions[0].status).toBe('pending');
    });
});

describe('goalTracker — computeOverallProgress', () => {
    it('returns 0 when no goals or topics', () => {
        const progress = createSessionProgress();
        expect(computeOverallProgress(progress)).toBe(0);
    });

    it('increases as goals are completed', () => {
        let progress = createSessionProgress();
        progress = addGoal(progress, 'Goal 1', 'decision', 0.8);
        progress = addGoal(progress, 'Goal 2', 'decision', 0.8);
        // Complete one goal
        progress.goals[0].status = 'completed';
        const pct = computeOverallProgress(progress);
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThan(1);
    });
});

describe('goalTracker — formatSessionProgressForPrompt', () => {
    it('formats progress in Spanish by default', () => {
        const progress = createSessionProgress();
        const prompt = formatSessionProgressForPrompt(progress);
        expect(prompt).toContain('Progreso de la Sesión');
    });

    it('formats progress in English', () => {
        const progress = createSessionProgress();
        const prompt = formatSessionProgressForPrompt(progress, 'en');
        expect(prompt).toContain('Session Progress');
    });

    it('includes active goals', () => {
        let progress = createSessionProgress();
        progress = addGoal(progress, 'Test goal', 'planning', 0.7);
        const prompt = formatSessionProgressForPrompt(progress);
        expect(prompt).toContain('Test goal');
        expect(prompt).toContain('prioridad: 0.7');
    });
});
