// @vitest-environment jsdom
// ============================================================
// searchOverridesStorage.test.ts — Guard de persistencia del buscador
// ------------------------------------------------------------
// Invariantes:
//  1. Con localStorage sano, save→load devuelve lo mismo.
//  2. Si localStorage rechaza la escritura (cuota/bloqueo), el valor se
//     persiste en sessionStorage y load() lo devuelve (fallback).
//  3. Un valor VIEJO en localStorage no debe "opacar" al nuevo: al fallar la
//     escritura se elimina y load() lee el respaldo (no el viejo).
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    loadSearchConfigOverrides,
    saveSearchConfigOverrides,
    type SearchConfigOverrides,
} from '../src/core/search/searchConfigOverrides';

const KEY = 'flu-search-config-overrides';

const withKey = (key: string): SearchConfigOverrides => ({
    providers: { web: { openrouter: { key } } },
});

function readKey(store: Storage): string {
    return String(JSON.parse(store.getItem(KEY) || '{}')?.providers?.web?.openrouter?.key || '');
}

/** localStorage falso que rechaza la escritura de KEY (simula cuota llena). */
function makeQuotaFullLocalStorage(seedValue?: string): { store: Storage; backing: Map<string, string> } {
    const backing = new Map<string, string>();
    if (seedValue !== undefined) backing.set(KEY, seedValue);
    const store = {
        get length() {
            return backing.size;
        },
        key: (index: number) => Array.from(backing.keys())[index] ?? null,
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => {
            if (key === KEY) throw new DOMException('quota', 'QuotaExceededError');
            backing.set(key, value);
        },
        removeItem: (key: string) => {
            backing.delete(key);
        },
        clear: () => backing.clear(),
    } as unknown as Storage;
    return { store, backing };
}

describe('searchConfigOverrides — persistencia con respaldo', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('con localStorage sano, save→load conserva el valor', () => {
        expect(saveSearchConfigOverrides(withKey('sk-or-v1-AAA'))).toBe(true);
        expect(readKey(window.localStorage)).toBe('sk-or-v1-AAA');
        expect(loadSearchConfigOverrides().providers?.web?.openrouter?.key).toBe('sk-or-v1-AAA');
    });

    it('si localStorage falla, persiste en sessionStorage y load lo devuelve', () => {
        const { store } = makeQuotaFullLocalStorage();
        vi.stubGlobal('localStorage', store);

        expect(saveSearchConfigOverrides(withKey('sk-or-v1-BBB'))).toBe(true);
        expect(readKey(window.sessionStorage)).toBe('sk-or-v1-BBB');
        expect(loadSearchConfigOverrides().providers?.web?.openrouter?.key).toBe('sk-or-v1-BBB');
    });

    it('un valor viejo en localStorage no opaca al nuevo guardado', () => {
        const { store, backing } = makeQuotaFullLocalStorage(JSON.stringify(withKey('sk-or-v1')));
        vi.stubGlobal('localStorage', store);
        expect(readKey(window.localStorage)).toBe('sk-or-v1');

        saveSearchConfigOverrides(withKey('sk-or-v1-NEW-LONG-KEY'));
        // El viejo se eliminó; la lectura cae al respaldo nuevo.
        expect(backing.get(KEY)).toBeUndefined();
        expect(loadSearchConfigOverrides().providers?.web?.openrouter?.key).toBe('sk-or-v1-NEW-LONG-KEY');
    });
});
