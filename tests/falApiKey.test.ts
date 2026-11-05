// @vitest-environment jsdom
// ============================================================
// falApiKey.test.ts — Guard de la key de video (fal.ai) — punto 12
// ------------------------------------------------------------
// Prioridad: override de localStorage (Ajustes) > env. Sin nada → vacío.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveFalApiKey, resolveFalVideoModel, STORAGE_KEYS } from '../src/core/config/appConfig';

describe('resolveFalApiKey', () => {
    beforeEach(() => localStorage.clear());

    it('usa el override de localStorage (configurado en Ajustes)', () => {
        localStorage.setItem(STORAGE_KEYS.FALAI_API_KEY, 'key-id:key-secret');
        expect(resolveFalApiKey()).toBe('key-id:key-secret');
    });

    it('sin override ni env → cadena vacía (no video real)', () => {
        expect(resolveFalApiKey()).toBe('');
    });
});

describe('resolveFalVideoModel', () => {
    beforeEach(() => localStorage.clear());

    it('default barato (Wan 2.5) cuando no hay override', () => {
        expect(resolveFalVideoModel()).toBe('fal-ai/wan-25-preview/text-to-video');
    });

    it('respeta el override de localStorage (modelo editable)', () => {
        localStorage.setItem(STORAGE_KEYS.FALAI_VIDEO_MODEL, 'fal-ai/kling-video/v1.6');
        expect(resolveFalVideoModel()).toBe('fal-ai/kling-video/v1.6');
    });
});
