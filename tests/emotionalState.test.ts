// ============================================================
// Unit Tests — emotionalState.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    createInitialEmotionalState,
    decayEmotionalState,
    recordEmotionalEvent,
    computeMood,
    emotionToMood,
    formatEmotionalStateForPrompt,
    DEFAULT_EMOTIONAL_CONFIG,
} from '../src/lib/emotionalState';

describe('emotionalState — createInitialEmotionalState', () => {
    it('creates neutral state', () => {
        const state = createInitialEmotionalState();
        expect(state.currentEmotion).toBe('neutral');
        expect(state.mood).toBe('neutral');
        expect(state.recentEvents).toEqual([]);
        expect(state.intensity).toBe(0);
    });
});

describe('emotionalState — emotionToMood', () => {
    it('maps positive emotions', () => {
        expect(emotionToMood('feliz')).toBe('positive');
        expect(emotionToMood('agradecido')).toBe('positive');
        expect(emotionToMood('emocionado')).toBe('positive');
    });

    it('maps negative emotions', () => {
        expect(emotionToMood('triste')).toBe('negative');
        expect(emotionToMood('enojado')).toBe('negative');
    });

    it('maps neutral emotions', () => {
        expect(emotionToMood('neutral')).toBe('neutral');
        expect(emotionToMood('confundido')).toBe('neutral');
        // 'interesado' is mapped to 'positive' in the source
        expect(emotionToMood('interesado')).toBe('positive');
    });
});

describe('emotionalState — decayEmotionalState', () => {
    it('decays intensity over time', () => {
        const state = createInitialEmotionalState();
        const now = Date.now();
        const intense = { ...state, currentEmotion: 'feliz' as const, intensity: 0.8, lastUpdated: now };

        // After 1 second (pass config as 2nd arg, now+1000 as 3rd)
        const decayed = decayEmotionalState(intense, {}, now + 1000);
        expect(decayed.intensity).toBeLessThan(0.8);
        expect(decayed.intensity).toBeGreaterThan(0.7);
    });

    it('returns neutral when intensity drops below minimum', () => {
        const state = createInitialEmotionalState();
        const now = Date.now();
        const lowIntensity = { ...state, currentEmotion: 'feliz' as const, intensity: 0.04, lastUpdated: now };

        // Pass empty config as 2nd arg, same now as 3rd (no time elapsed)
        const decayed = decayEmotionalState(lowIntensity, {}, now);
        expect(decayed.currentEmotion).toBe('neutral');
        expect(decayed.intensity).toBe(0);
    });
});

describe('emotionalState — recordEmotionalEvent', () => {
    it('records a new emotional event', () => {
        const state = createInitialEmotionalState();
        const result = recordEmotionalEvent(state, 'feliz', 'Usuario hizo una broma');

        expect(result.currentEmotion).toBe('feliz');
        expect(result.recentEvents.length).toBe(1);
        expect(result.recentEvents[0].emotion).toBe('feliz');
        expect(result.recentEvents[0].trigger).toBe('Usuario hizo una broma');
    });

    it('caps recent events at maxRecentEvents', () => {
        let state = createInitialEmotionalState();
        for (let i = 0; i < DEFAULT_EMOTIONAL_CONFIG.maxRecentEvents + 2; i++) {
            state = recordEmotionalEvent(state, 'neutral', `Event ${i}`);
        }
        expect(state.recentEvents.length).toBe(DEFAULT_EMOTIONAL_CONFIG.maxRecentEvents);
    });

    it('decays previous emotion before recording new one', () => {
        const state = createInitialEmotionalState();
        // First record an event so state has a previous event
        const withEvent = recordEmotionalEvent(state, 'feliz', 'Buena noticia');
        // Now record a new emotion after some time
        const result = recordEmotionalEvent(withEvent, 'triste', 'Algo malo pasó', 5000);
        expect(result.currentEmotion).toBe('triste');
        // Should have 2 events: the new one + the previous one
        expect(result.recentEvents.length).toBe(2);
    });
});

describe('emotionalState — computeMood', () => {
    it('returns neutral for empty events', () => {
        const state = createInitialEmotionalState();
        // computeMood takes EmotionalEvent[], not EmotionalState
        expect(computeMood(state.recentEvents)).toBe('neutral');
    });

    it('returns positive when recent events are positive', () => {
        const state = createInitialEmotionalState();
        const result = recordEmotionalEvent(state, 'feliz', 'Buena noticia');
        // computeMood takes EmotionalEvent[], not EmotionalState
        expect(computeMood(result.recentEvents)).toBe('positive');
    });
});

describe('emotionalState — formatEmotionalStateForPrompt', () => {
    it('includes CRITICAL instruction', () => {
        // formatEmotionalStateForPrompt returns '' when intensity <= 0 and emotion is neutral
        // Create a state with non-zero intensity to get a non-empty prompt
        // Default language is 'es', so the Spanish word 'CRÍTICO' is used
        const state = { ...createInitialEmotionalState(), currentEmotion: 'feliz' as const, intensity: 0.8, mood: 'positive' as const };
        const prompt = formatEmotionalStateForPrompt(state);
        expect(prompt).toContain('CRÍTICO');
        expect(prompt).toContain('feliz');
    });

    it('includes recent events when present', () => {
        const state = createInitialEmotionalState();
        const withEvent = recordEmotionalEvent(state, 'feliz', 'Buena noticia');
        const prompt = formatEmotionalStateForPrompt(withEvent);
        expect(prompt).toContain('Buena noticia');
    });
});
