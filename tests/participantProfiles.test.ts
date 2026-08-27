// ============================================================
// Unit Tests — participantProfiles.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    PARTICIPATION_PROFILES,
    traitsToStyle,
    getConfigForTraits,
    getProfile,
    type ParticipationStyle,
} from '../src/lib/participantProfiles';

describe('participantProfiles — PARTICIPATION_PROFILES', () => {
    it('has all 5 profiles defined', () => {
        const styles: ParticipationStyle[] = ['energetic', 'calm', 'analytical', 'supportive', 'balanced'];
        for (const style of styles) {
            expect(PARTICIPATION_PROFILES[style]).toBeDefined();
            expect(PARTICIPATION_PROFILES[style].name).toBeTruthy();
            expect(PARTICIPATION_PROFILES[style].configOverrides).toBeDefined();
        }
    });

    it('energetic profile has low minConfidence and short cooldown', () => {
        const profile = PARTICIPATION_PROFILES.energetic;
        expect(profile.configOverrides.minConfidence).toBe(0.4);
        expect(profile.configOverrides.cooldownAfterInterventionMs).toBe(8000);
        expect(profile.configOverrides.evaluateEveryNTurns).toBe(2);
    });

    it('analytical profile has high minConfidence and maxDraftChars', () => {
        const profile = PARTICIPATION_PROFILES.analytical;
        expect(profile.configOverrides.minConfidence).toBe(0.7);
        expect(profile.configOverrides.maxDraftChars).toBe(600);
    });

    it('calm profile has high evaluateEveryNTurns and long cooldown', () => {
        const profile = PARTICIPATION_PROFILES.calm;
        expect(profile.configOverrides.evaluateEveryNTurns).toBe(4);
        expect(profile.configOverrides.cooldownAfterInterventionMs).toBe(15000);
    });

    it('supportive profile has lowest minConfidence and shortest cooldown', () => {
        const profile = PARTICIPATION_PROFILES.supportive;
        expect(profile.configOverrides.minConfidence).toBe(0.3);
        expect(profile.configOverrides.cooldownAfterInterventionMs).toBe(6000);
    });
});

describe('participantProfiles — traitsToStyle', () => {
    it('maps energetic traits to energetic style', () => {
        expect(traitsToStyle(['energetic', 'enthusiastic'])).toBe('energetic');
    });

    it('maps calm traits to calm style', () => {
        expect(traitsToStyle(['calm', 'tranquilo', 'patient'])).toBe('calm');
    });

    it('maps analytical traits to analytical style', () => {
        expect(traitsToStyle(['analytical', 'precise', 'logical'])).toBe('analytical');
    });

    it('maps supportive traits to supportive style', () => {
        expect(traitsToStyle(['supportive', 'kind', 'friendly'])).toBe('supportive');
    });

    it('returns balanced for unknown traits', () => {
        expect(traitsToStyle(['unknown', 'random'])).toBe('balanced');
    });

    it('prefers the style with most matching traits', () => {
        // More energetic words than calm
        expect(traitsToStyle(['energetic', 'enthusiastic', 'calm'])).toBe('energetic');
    });
});

describe('participantProfiles — getConfigForTraits', () => {
    it('returns config overrides for given traits', () => {
        const config = getConfigForTraits(['analytical', 'precise']);
        expect(config.minConfidence).toBe(0.7);
        expect(config.maxDraftChars).toBe(600);
    });

    it('returns balanced config for unknown traits', () => {
        const config = getConfigForTraits(['unknown']);
        expect(config.minConfidence).toBe(0.5);
    });
});

describe('participantProfiles — getProfile', () => {
    it('returns the correct profile', () => {
        const profile = getProfile('energetic');
        expect(profile.style).toBe('energetic');
    });

    it('returns balanced for unknown style', () => {
        const profile = getProfile('unknown' as ParticipationStyle);
        expect(profile.style).toBe('balanced');
    });
});
