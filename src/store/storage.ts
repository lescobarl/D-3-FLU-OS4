// ============================================================
// storage.ts — Resolución segura del almacenamiento Zustand
// ============================================================
// localStorage en el navegador; fallback en memoria en entornos
// sin almacenamiento (Node.js/vitest). Elimina el fallback
// duplicado que existía en integrationStore y environmentStore
// (fuente única por intención, AGENTS.md).
// ============================================================

export interface SafeStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
}

/**
 * Devuelve localStorage si está disponible; si no, un almacén en
 * memoria (funciona pero no persiste entre recargas). Pensada como
 * factory para `createJSONStorage(resolveSafeStorage)` de Zustand.
 */
export function resolveSafeStorage(): SafeStorage {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
    } catch {
        console.warn('[catch] src/store/storage.ts');
        // localStorage no disponible (Node.js, SSR, etc.)
    }
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
    };
}
