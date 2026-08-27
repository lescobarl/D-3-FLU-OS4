// ============================================================
// Unit Tests — transcriptQuality.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    validateTranscript,
    normalizeTranscript,
    areTranscriptsEquivalent,
    DEFAULT_TRANSCRIPT_QUALITY_CONFIG,
} from '../src/lib/transcriptQuality';

describe('transcriptQuality — validateTranscript', () => {
    it('rejects empty transcript', () => {
        const result = validateTranscript('');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('empty');
    });

    it('rejects whitespace-only transcript', () => {
        const result = validateTranscript('   ');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('empty');
    });

    it('rejects too-short transcript', () => {
        const result = validateTranscript('ab');
        expect(result.valid).toBe(false);
        // reason format: 'too_short:{length}<{minChars}'
        expect(result.reason).toContain('too_short');
    });

    it('rejects too-long transcript', () => {
        const longText = 'a'.repeat(DEFAULT_TRANSCRIPT_QUALITY_CONFIG.maxChars + 1);
        const result = validateTranscript(longText);
        expect(result.valid).toBe(false);
        // reason format: 'too_long:{length}>{maxChars}'
        expect(result.reason).toContain('too_long');
    });

    it('rejects mostly noise transcript', () => {
        const result = validateTranscript('!!! ??? *** &&& $$$');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('mostly_noise');
    });

    it('rejects repetitive transcript (high repeat ratio)', () => {
        const result = validateTranscript('hola hola hola hola hola hola hola hola');
        expect(result.valid).toBe(false);
        // reason format: 'echo:repeat_ratio_{ratio}'
        expect(result.reason).toContain('echo:');
    });

    it('rejects transcript with low unique word ratio', () => {
        // Use varied words but low unique ratio to avoid echo check firing first
        const result = validateTranscript('hola mundo hola mundo hola mundo hola mundo hola mundo');
        expect(result.valid).toBe(false);
        // reason format: 'repetitive:unique_ratio_{ratio}'
        expect(result.reason).toContain('repetitive');
    });

    it('accepts valid transcript', () => {
        const result = validateTranscript('Hola, ¿cómo están todos hoy?');
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it('accepts longer valid transcript', () => {
        const result = validateTranscript(
            'Creo que deberíamos enfocarnos en la estrategia de marketing para el próximo trimestre.'
        );
        expect(result.valid).toBe(true);
    });

    it('rejects exact duplicate within lookback window', () => {
        const recent = [
            '¿Qué opinan sobre la propuesta?',
            '¿Qué opinan sobre la propuesta?',
        ];
        const result = validateTranscript('¿Qué opinan sobre la propuesta?', recent);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('exact_duplicate');
    });

    it('detects ASR revision (substring of previous) — returns valid with isRevision flag', () => {
        // isAsrRevision checks if new text STARTS WITH previous text (and is longer)
        const recent = ['¿Qué opinan sobre la propuesta de'];
        const result = validateTranscript('¿Qué opinan sobre la propuesta de marketing?', recent);
        // ASR revisions return valid:true with isRevision:true (caller should replace previous)
        expect(result.valid).toBe(true);
        expect(result.isRevision).toBe(true);
    });
});

describe('transcriptQuality — normalizeTranscript', () => {
    it('lowercases and strips punctuation', () => {
        expect(normalizeTranscript('¡Hola, Mundo!')).toBe('hola mundo');
    });

    it('collapses whitespace', () => {
        expect(normalizeTranscript('Hola    Mundo')).toBe('hola mundo');
    });

    it('handles empty string', () => {
        expect(normalizeTranscript('')).toBe('');
    });
});

describe('transcriptQuality — areTranscriptsEquivalent', () => {
    it('returns true for semantically equivalent texts', () => {
        expect(areTranscriptsEquivalent('Hola, Mundo!', '¡Hola Mundo!')).toBe(true);
    });

    it('returns false for different texts', () => {
        expect(areTranscriptsEquivalent('Hola', 'Adiós')).toBe(false);
    });
});
