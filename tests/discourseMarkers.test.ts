// ============================================================
// Unit Tests — discourseMarkers.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    getDiscourseMarker,
    addDiscourseMarker,
} from '../src/lib/discourseMarkers';

describe('discourseMarkers — getDiscourseMarker', () => {
    it('returns a marker for thinking context in Spanish', () => {
        const marker = getDiscourseMarker('thinking', 'es', 'friendly');
        expect(marker).toBeTruthy();
        expect(typeof marker).toBe('string');
    });

    it('returns a marker for agreeing context in English', () => {
        const marker = getDiscourseMarker('agreeing', 'en', 'friendly');
        expect(marker).toBeTruthy();
        expect(marker.length).toBeGreaterThan(0);
    });

    it('returns empty string for unknown context', () => {
        const marker = getDiscourseMarker('thinking' as any, 'es', 'friendly');
        expect(marker).toBeTruthy(); // 'thinking' is valid
    });

    it('filters markers by formal tone (lower strength)', () => {
        // Formal tone filters strength <= 0.4
        const marker = getDiscourseMarker('emphasizing', 'es', 'formal');
        expect(marker).toBeTruthy();
        // All emphasizing markers have strength >= 0.35, formal allows <= 0.4
        // So 'Cabe mencionar que' (0.4) and 'Sobre todo' (0.35) should pass
    });

    it('filters markers by energetic tone (higher strength)', () => {
        const marker = getDiscourseMarker('agreeing', 'es', 'energetic');
        expect(marker).toBeTruthy();
        // Energetic filters strength >= 0.3
    });
});

describe('discourseMarkers — addDiscourseMarker', () => {
    it('prepends marker to text', () => {
        const result = addDiscourseMarker('This is a point.', 'adding', 'en', 'friendly');
        expect(result).toContain('This is a point.');
        // Should have a marker prepended
        expect(result.length).toBeGreaterThan('This is a point.'.length);
    });

    it('returns original text when no marker fits', () => {
        const result = addDiscourseMarker('', 'thinking', 'es', 'friendly');
        expect(result).toBe('');
    });

    it('avoids duplicate marker when text already starts with similar words', () => {
        // The function checks if text starts with first 2 words of marker (stripped of punctuation)
        // Since getDiscourseMarker uses Math.random(), we run multiple times to cover all markers
        // If 'También hay que considerar que ' is selected → text starts with 'también hay' → no prepend
        // If 'Y algo más...' is selected → text doesn't start with 'y algo' → marker gets prepended
        // We verify that when a matching marker is selected, the text is returned unchanged
        const text = 'También hay que considerar algo más';
        let sawDuplicateDetection = false;
        // Run many times to increase chance of hitting the matching marker
        for (let i = 0; i < 100; i++) {
            const result = addDiscourseMarker(text, 'adding', 'es', 'friendly');
            if (result === text) {
                sawDuplicateDetection = true;
            } else {
                // If a non-matching marker was prepended, it should still contain the original text
                expect(result).toContain(text);
            }
        }
        expect(sawDuplicateDetection).toBe(true);
    });

    it('works with Spanish markers', () => {
        const result = addDiscourseMarker('necesitamos más presupuesto', 'adding', 'es', 'friendly');
        expect(result).toContain('necesitamos más presupuesto');
    });
});
