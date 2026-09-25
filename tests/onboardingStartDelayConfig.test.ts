// ============================================================
// Guard — la espera del arranque post-onboarding es CONFIG, no hardcode
// ------------------------------------------------------------
// `App.tsx` tenía `setTimeout(tryStartListening, 700)`. Este guard exige que
// el valor viva en `FLU_CONFIG.timing` y que el componente no use el literal.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

describe('onboarding — espera de arranque config-driven (sin hardcode)', () => {
    it('fluConfig expone un número positivo', () => {
        const value = FLU_CONFIG.timing.onboardingStartListeningDelayMs;
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
    });

    it('App.tsx no usa el literal 700 en el arranque post-onboarding', () => {
        const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
        expect(source).not.toMatch(/tryStartListening,\s*700/);
        expect(source).toMatch(/onboardingStartListeningDelayMs/);
    });
});
