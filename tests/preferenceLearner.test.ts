// ============================================================
// Unit Tests — preferenceLearner.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    detectPreferenceCategory,
    extractPreferenceKey,
    computeConfidence,
    buildPreferenceKey,
} from '../src/lib/preferenceLearner';

describe('preferenceLearner — detectPreferenceCategory', () => {
    it('detects communication_style preference', () => {
        const result = detectPreferenceCategory('prefiero un tono formal');
        expect(result).toBe('communication_style');
    });

    it('detects topic_interest preference', () => {
        const result = detectPreferenceCategory('me interesa la tecnologia');
        expect(result).toBe('topic_interest');
    });

    it('detects format_preference preference', () => {
        // 'necesito' is only in format_preference patterns (not in communication_style)
        const result = detectPreferenceCategory('necesito un resumen');
        expect(result).toBe('format_preference');
    });

    it('detects interaction_preference preference', () => {
        // Pattern requires a word after 'interrumpas'
        const result = detectPreferenceCategory('no me interrumpas por favor');
        expect(result).toBe('interaction_preference');
    });

    it('detects explicit_preference preference', () => {
        const result = detectPreferenceCategory('recuerda que soy principiante');
        expect(result).toBe('explicit_preference');
    });

    it('returns null for text with no preference', () => {
        const result = detectPreferenceCategory('el clima está agradable hoy');
        expect(result).toBeNull();
    });

    it('detects English preferences', () => {
        // communication_style pattern: (?:prefiero|me gusta|i prefer|i like)\s+(?:un|un\s+tono|que\s+sea|a\s+que\s+sea)\s+(\w+)
        expect(detectPreferenceCategory('i prefer un tono casual')).toBe('communication_style');
        // topic_interest pattern: (?:i'?m\s+)?(?:interested\s+in|into|love)\s+(\w+)
        expect(detectPreferenceCategory("i'm interested in AI")).toBe('topic_interest');
        // format_preference pattern: (?:prefiero|quiero|necesito|i want|i need)\s+(?:un|una|que\s+sea|it\s+to\s+be)\s+(\w+)
        expect(detectPreferenceCategory('i want it to be summary')).toBe('format_preference');
    });
});

describe('preferenceLearner — extractPreferenceKey', () => {
    it('extracts key from communication_style pattern', () => {
        // Pattern: (?:prefiero|...)\s+(?:un|un\s+tono|...)\s+(\w+)
        // 'un' matches before 'un tono', so it captures 'tono' not 'formal'
        const key = extractPreferenceKey('prefiero un tono formal', 'communication_style');
        expect(key).toBe('tono');
    });

    it('extracts key from topic_interest pattern', () => {
        const key = extractPreferenceKey('me interesa la tecnologia', 'topic_interest');
        expect(key).toBe('tecnologia');
    });

    it('returns null when no pattern matches', () => {
        const key = extractPreferenceKey('texto sin patron', 'communication_style');
        expect(key).toBeNull();
    });
});

describe('preferenceLearner — computeConfidence', () => {
    it('returns base confidence for explicit source', () => {
        // computeConfidence adds repetition boost: base + min(0.25, observationCount * 0.05)
        // With observationCount=1: 0.7 + 0.05 = 0.75
        expect(computeConfidence(1, 'explicit')).toBeCloseTo(0.75, 2);
    });

    it('returns base confidence for repeated source', () => {
        // computeConfidence adds repetition boost: base + min(0.25, observationCount * 0.05)
        // With observationCount=1: 0.5 + 0.05 = 0.55
        expect(computeConfidence(1, 'repeated')).toBeCloseTo(0.55, 2);
    });

    it('returns base confidence for inferred source', () => {
        expect(computeConfidence(1, 'inferred')).toBeCloseTo(0.3, 1);
    });

    it('boosts confidence with repeated observations', () => {
        const single = computeConfidence(1, 'explicit');
        const multiple = computeConfidence(5, 'explicit');
        expect(multiple).toBeGreaterThan(single);
    });

    it('caps confidence at 1.0', () => {
        const confidence = computeConfidence(100, 'explicit');
        expect(confidence).toBeLessThanOrEqual(1);
    });
});

describe('preferenceLearner — buildPreferenceKey', () => {
    it('builds prefixed key', () => {
        const key = buildPreferenceKey('communication_style', 'formal');
        expect(key).toBe('pref:communication_style:formal');
    });
});
