// ============================================================
// configEnv.test.ts — Overrides de entorno (Rule #1: NO HARDCODE)
// ============================================================
// Verifica que src/core/config/appConfig.ts lee las variables VITE_*
// del entorno y aplica defaults idénticos cuando no están definidas.
// Usa vi.resetModules() + vi.stubEnv() + import dinámico para probar
// ambos caminos sin contaminar el resto del suite de tests.
// ============================================================

import { describe, it, expect, afterEach, vi } from 'vitest';

async function loadConfig(env: Record<string, string>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) {
        vi.stubEnv(key, value);
    }
    return await import('../src/core/config/appConfig');
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('appConfig — env overrides (Rule #1)', () => {
    it('VITE_GEMINI_API_URL sobreescribe GEMINI_CONFIG.API_URL', async () => {
        const mod = await loadConfig({ VITE_GEMINI_API_URL: 'https://custom.gemini.test/v1' });
        expect(mod.GEMINI_CONFIG.API_URL).toBe('https://custom.gemini.test/v1');
    });

    it('VITE_GEMINI_PREDICT_URL sobreescribe GEMINI_CONFIG.PREDICT_API_URL', async () => {
        const mod = await loadConfig({ VITE_GEMINI_PREDICT_URL: 'https://custom.gemini.test/predict' });
        expect(mod.GEMINI_CONFIG.PREDICT_API_URL).toBe('https://custom.gemini.test/predict');
    });

    it('VITE_DEEPSEEK_URL sobreescribe DEEPSEEK_CONFIG.API_URL', async () => {
        const mod = await loadConfig({ VITE_DEEPSEEK_URL: 'https://custom.deepseek.test/v1' });
        expect(mod.DEEPSEEK_CONFIG.API_URL).toBe('https://custom.deepseek.test/v1');
    });

    it('VITE_OPENROUTER_URL sobreescribe OPENROUTER_CONFIG.API_URL', async () => {
        const mod = await loadConfig({ VITE_OPENROUTER_URL: 'https://custom.openrouter.test/v1' });
        expect(mod.OPENROUTER_CONFIG.API_URL).toBe('https://custom.openrouter.test/v1');
    });

    it('VITE_GEMINI_MODEL sobreescribe GEMINI_CONFIG.MODEL', async () => {
        const mod = await loadConfig({ VITE_GEMINI_MODEL: 'gemini-2.5-pro' });
        expect(mod.GEMINI_CONFIG.MODEL).toBe('gemini-2.5-pro');
    });

    it('VITE_WHATSAPP_WEB_BASE sobreescribe DEVICE_ACTIONS_CONFIG.WHATSAPP_WEB_BASE', async () => {
        const mod = await loadConfig({ VITE_WHATSAPP_WEB_BASE: 'https://wa.test' });
        expect(mod.DEVICE_ACTIONS_CONFIG.WHATSAPP_WEB_BASE).toBe('https://wa.test');
    });

    it('VITE_POLLINATIONS_URL sobreescribe POLLINATIONS_CONFIG.BASE_URL', async () => {
        const mod = await loadConfig({ VITE_POLLINATIONS_URL: 'https://img.example.test/prompt' });
        expect(mod.POLLINATIONS_CONFIG.BASE_URL).toBe('https://img.example.test/prompt');
    });

    it('VITE_NETWORK_PROBE_URLS sobreescribe NETWORK_PROBE_URLS (split por coma)', async () => {
        const mod = await loadConfig({ VITE_NETWORK_PROBE_URLS: 'https://a.test, https://b.test ,' });
        expect(mod.NETWORK_PROBE_URLS).toEqual(['https://a.test', 'https://b.test']);
    });

    it('VITE_APP_NAME / VITE_APP_VERSION sobreescriben branding', async () => {
        const mod = await loadConfig({ VITE_APP_NAME: 'FLU Test', VITE_APP_VERSION: 'v9.9' });
        expect(mod.APP_BRANDING.NAME).toBe('FLU Test');
        expect(mod.APP_BRANDING.VERSION).toBe('v9.9');
    });

    it('aplica defaults idénticos cuando no hay variables de entorno', async () => {
        const mod = await loadConfig({});
        expect(mod.GEMINI_CONFIG.API_URL).toBe('https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent');
        expect(mod.GEMINI_CONFIG.PREDICT_API_URL).toBe('https://generativelanguage.googleapis.com/v1beta/models/{model}:predict');
        expect(mod.GEMINI_CONFIG.MODEL).toBe('gemini-2.5-flash-lite');
        expect(mod.DEEPSEEK_CONFIG.API_URL).toBe('https://api.deepseek.com/v1');
        expect(mod.OPENROUTER_CONFIG.API_URL).toBe('https://openrouter.ai/api/v1');
        expect(mod.POLLINATIONS_CONFIG.BASE_URL).toBe('https://image.pollinations.ai/prompt');
        expect(mod.NETWORK_PROBE_URLS).toEqual(['https://example.com', 'https://one.one.one.one']);
        expect(mod.DEVICE_ACTIONS_CONFIG.WHATSAPP_WEB_BASE).toBe('https://wa.me');
        expect(mod.APP_BRANDING.NAME).toBe('FLU OS4');
        expect(mod.APP_BRANDING.VERSION).toBe('v4.0');
    });
});
