// ============================================================
// searchConfigOverrides.test.ts — Centro de Control del Buscador (F5)
// ------------------------------------------------------------
// Cubre:
//   - mergeSearchConfig: overrides sobre la config base sin mutarla,
//     flags enabled conservados, seguridad efectiva y normalización.
//   - evalDailyUsage: límite diario puro (bloqueo, reinicio de día).
//   - persistencia en localStorage (patrón useConfigPersistence).
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STORAGE_KEYS } from '../src/core/config/appConfig';
import type { SearchProviderConfig } from '../src/core/search/searchSession';
import {
    clearSearchConfigOverrides,
    evalDailyUsage,
    loadDailyUsage,
    loadSearchConfigOverrides,
    mergeSearchConfig,
    saveDailyUsage,
    saveSearchConfigOverrides,
    type SearchRuntimeConfig,
} from '../src/core/search/searchConfigOverrides';

const WIKI: SearchProviderConfig = {
    id: 'wikipedia',
    label: 'Wikipedia',
    enabled: true,
    endpoint: 'https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&format=json',
    maxResults: 5,
    timeoutMs: 8000,
};

const DDG: SearchProviderConfig = {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    enabled: true,
    endpoint: 'https://api.duckduckgo.com/?q={q}&format=json&kl={lang}',
    maxResults: 5,
    timeoutMs: 8000,
};

const COMMONS: SearchProviderConfig = {
    id: 'commons',
    label: 'Wikimedia Commons',
    enabled: true,
    endpoint: 'https://commons.wikimedia.org/w/api.php?generator=search&format=json',
    maxResults: 12,
};

const YOUTUBE: SearchProviderConfig = {
    id: 'youtube',
    label: 'YouTube',
    enabled: false,
    key: '',
    endpoint: 'https://www.googleapis.com/youtube/v3/search?part=snippet&q={q}&key={key}',
    maxResults: 6,
    timeoutMs: 8000,
};

function baseRuntime(): SearchRuntimeConfig {
    return {
        endpoints: { web: '', images: '', video: '' },
        timeoutMs: 8000,
        maxResultsByType: { web: 8, images: 24, video: 8 },
        aiEnabled: true,
        maxChars: 700,
        overviewMaxResults: 8,
        providers: {
            web: [WIKI, DDG],
            images: [COMMONS],
            video: [YOUTUBE],
        },
        errorState: '',
        aiOverviewTitle: 'Puntos clave',
        dailyLimitMessage: 'Alcanzaste el límite diario de búsquedas.',
    };
}

describe('mergeSearchConfig', () => {
    it('sin overrides devuelve la config base y seguridad por defecto', () => {
        const merged = mergeSearchConfig(baseRuntime());
        expect(merged.timeoutMs).toBe(8000);
        expect(merged.maxResultsByType).toEqual({ web: 8, images: 24, video: 8 });
        expect(merged.aiEnabled).toBe(true);
        expect(merged.safeSearch).toBe(false);
        expect(merged.supervised).toBe(false);
        expect(merged.effectiveSafe).toBe(false);
        expect(merged.dailyLimit).toBe(0);
        // Conserva enabled:false (youtube) para que el consumidor filtre después.
        expect(merged.providers.video[0].enabled).toBe(false);
    });

    it('no muta la config base ni el objeto de overrides', () => {
        const base = baseRuntime();
        const ov = { providers: { web: { wikipedia: { enabled: false } } }, safeSearch: true };
        const baseBefore = JSON.stringify(base);
        const ovBefore = JSON.stringify(ov);
        mergeSearchConfig(base, ov);
        expect(JSON.stringify(base)).toBe(baseBefore);
        expect(JSON.stringify(ov)).toBe(ovBefore);
        expect(base.providers.web[0].enabled).toBe(true);
    });

    it('apaga y enciende proveedores por id', () => {
        const merged = mergeSearchConfig(baseRuntime(), {
            providers: {
                web: { wikipedia: { enabled: false } },
                video: { youtube: { enabled: true } },
            },
        });
        expect(merged.providers.web.find((p) => p.id === 'wikipedia')?.enabled).toBe(false);
        expect(merged.providers.web.find((p) => p.id === 'duckduckgo')?.enabled).toBe(true);
        expect(merged.providers.video.find((p) => p.id === 'youtube')?.enabled).toBe(true);
    });

    it('aplica la key por proveedor', () => {
        const merged = mergeSearchConfig(baseRuntime(), {
            providers: { web: { duckduckgo: { key: 'mi-key' } } },
        });
        expect(merged.providers.web.find((p) => p.id === 'duckduckgo')?.key).toBe('mi-key');
        // Proveedor sin override conserva su key base (youtube con '').
        expect(merged.providers.video.find((p) => p.id === 'youtube')?.key).toBe('');
    });

    it('aplica maxResults y timeoutMs por proveedor', () => {
        const merged = mergeSearchConfig(baseRuntime(), {
            providers: { web: { wikipedia: { maxResults: 10, timeoutMs: 5000 } } },
        });
        const wiki = merged.providers.web.find((p) => p.id === 'wikipedia');
        expect(wiki?.maxResults).toBe(10);
        expect(wiki?.timeoutMs).toBe(5000);
        // Proveedor sin override conserva sus valores base.
        const ddg = merged.providers.web.find((p) => p.id === 'duckduckgo');
        expect(ddg?.maxResults).toBe(5);
        expect(ddg?.timeoutMs).toBe(8000);
    });

    it('aplica overrides globales: maxResultsByType, timeoutMs y aiEnabled', () => {
        const merged = mergeSearchConfig(baseRuntime(), {
            maxResultsByType: { web: 12 },
            timeoutMs: 6000,
            aiEnabled: false,
        });
        expect(merged.maxResultsByType.web).toBe(12);
        expect(merged.maxResultsByType.images).toBe(24);
        expect(merged.timeoutMs).toBe(6000);
        expect(merged.aiEnabled).toBe(false);
    });

    it('seguridad: effectiveSafe = safeSearch || supervised', () => {
        expect(mergeSearchConfig(baseRuntime(), { safeSearch: true }).effectiveSafe).toBe(true);
        expect(mergeSearchConfig(baseRuntime(), { supervised: true }).effectiveSafe).toBe(true);
        const both = mergeSearchConfig(baseRuntime(), { safeSearch: true, supervised: true });
        expect(both.safeSearch).toBe(true);
        expect(both.supervised).toBe(true);
        expect(both.effectiveSafe).toBe(true);
    });

    it('dailyLimit: se normaliza a entero no negativo; ausente/negativo → 0', () => {
        expect(mergeSearchConfig(baseRuntime(), { dailyLimit: 20 }).dailyLimit).toBe(20);
        expect(mergeSearchConfig(baseRuntime(), { dailyLimit: -3 }).dailyLimit).toBe(0);
        expect(mergeSearchConfig(baseRuntime(), {}).dailyLimit).toBe(0);
    });
});

describe('evalDailyUsage', () => {
    const TODAY = '2026-08-31';

    it('sin registro arranca en 1 y nunca bloquea', () => {
        const { locked, next } = evalDailyUsage(null, 5, TODAY);
        expect(locked).toBe(false);
        expect(next).toEqual({ day: TODAY, count: 1 });
    });

    it('incrementa mientras no alcanza el límite', () => {
        const { locked, next } = evalDailyUsage({ day: TODAY, count: 3 }, 5, TODAY);
        expect(locked).toBe(false);
        expect(next).toEqual({ day: TODAY, count: 4 });
    });

    it('bloquea al alcanzar el límite y no incrementa', () => {
        const { locked, next } = evalDailyUsage({ day: TODAY, count: 5 }, 5, TODAY);
        expect(locked).toBe(true);
        expect(next).toEqual({ day: TODAY, count: 5 });
    });

    it('reinicia el contador al cambiar de día', () => {
        const { locked, next } = evalDailyUsage({ day: '2026-08-30', count: 5 }, 5, TODAY);
        expect(locked).toBe(false);
        expect(next).toEqual({ day: TODAY, count: 1 });
    });

    it('sin límite (0) nunca bloquea aunque haya uso previo', () => {
        const { locked, next } = evalDailyUsage({ day: TODAY, count: 99 }, 0, TODAY);
        expect(locked).toBe(false);
        expect(next).toEqual({ day: TODAY, count: 100 });
    });
});

function createLocalStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() {
            return store.size;
        },
        clear: () => {
            store.clear();
        },
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        removeItem: (key: string) => {
            store.delete(key);
        },
        setItem: (key: string, value: string) => {
            store.set(key, String(value));
        },
    } as Storage;
}

describe('persistencia en localStorage', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { localStorage: createLocalStorage() });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('save + load round-trip de overrides', () => {
        const overrides = {
            providers: { web: { wikipedia: { enabled: false } } },
            safeSearch: true,
        };
        saveSearchConfigOverrides(overrides);
        expect(loadSearchConfigOverrides()).toEqual(overrides);
    });

    it('load sin datos devuelve {}', () => {
        expect(loadSearchConfigOverrides()).toEqual({});
    });

    it('load con JSON corrupto devuelve {}', () => {
        window.localStorage.setItem(STORAGE_KEYS.SEARCH_CONFIG_OVERRIDES, '{no-json');
        expect(loadSearchConfigOverrides()).toEqual({});
    });

    it('clear elimina los overrides persistidos', () => {
        saveSearchConfigOverrides({ safeSearch: true });
        clearSearchConfigOverrides();
        expect(loadSearchConfigOverrides()).toEqual({});
        expect(window.localStorage.getItem(STORAGE_KEYS.SEARCH_CONFIG_OVERRIDES)).toBeNull();
    });

    it('save + load round-trip de uso diario', () => {
        saveDailyUsage({ day: '2026-08-31', count: 4 });
        expect(loadDailyUsage()).toEqual({ day: '2026-08-31', count: 4 });
    });

    it('loadDailyUsage con registro inválido devuelve null', () => {
        window.localStorage.setItem(STORAGE_KEYS.SEARCH_DAILY_USAGE, JSON.stringify({ day: 5 }));
        expect(loadDailyUsage()).toBeNull();
    });
});

describe('sin localStorage (SSR/nodo)', () => {
    it('load devuelve valores por defecto y save/clear no lanzan', () => {
        expect(loadSearchConfigOverrides()).toEqual({});
        expect(loadDailyUsage()).toBeNull();
        expect(() => saveSearchConfigOverrides({ safeSearch: true })).not.toThrow();
        expect(() => clearSearchConfigOverrides()).not.toThrow();
    });
});
