// ============================================================
// environmentStore.ts — Estado del AMBIENTE activo
// ============================================================
// Store Zustand (persistido) que recuerda qué Ambiente tiene
// activo FLU. El catálogo de ambientes vive en
// `src/core/environments/environmentRegistry.ts` (solo datos).
//
// Este store es VOLUNTAD purificada: solo guarda el id del
// ambiente activo. La lógica de aplicación (tema visual, voz,
// decoración, pestañas) la ejecuta `applyEnvironment` leyendo
// el catálogo — aquí NO se duplica ninguna regla (sin hardcode).
//
// Patrón de persistencia idéntico a integrationStore:
//   - createJSONStorage con fallback en memoria (Node.js/vitest)
//   - partialize: solo lo que debe sobrevivir al reload
//   - merge: estado persistido gana sobre el estado inicial
// ============================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { resolveSafeStorage } from './storage';
import { DEFAULT_AMBIENTE_ID, isAmbienteId } from '../core/environments/environmentRegistry';

// -----------------------------------------------------------
// Clave de persistencia (única fuente de verdad del formato)
// -----------------------------------------------------------
// Se exporta para que el arranque de la app (App.tsx) pueda leer
// el valor RAW persistido y recuperar un ambiente dinámico que el
// merge de rehidratación habría corregido (blindaje a `asistente`).
export const ENVIRONMENT_STORE_KEY = 'flu-environment-store';

// -----------------------------------------------------------
// Tipos del Store
// -----------------------------------------------------------

export interface EnvironmentStoreState {
    /** Id del Ambiente activo (siempre un id válido del catálogo). */
    activeAmbienteId: string;
}

export interface EnvironmentStoreActions {
    /**
     * Activa un Ambiente por id.
     * Rechaza ids fuera del catálogo (fallback seguro a `asistente`)
     * para que el estado nunca quede apuntando a un Ambiente inexistente.
     */
    setActiveAmbienteId: (ambienteId: string) => void;
    /** Regresa al Ambiente por defecto (`asistente`). */
    resetAmbiente: () => void;
}

export type EnvironmentStore = EnvironmentStoreState & EnvironmentStoreActions;

// -----------------------------------------------------------
// Store
// -----------------------------------------------------------

export const useEnvironmentStore = create<EnvironmentStore>()(
    persist(
        (set) => ({
            activeAmbienteId: DEFAULT_AMBIENTE_ID,
            setActiveAmbienteId: (ambienteId: string) => {
                const next = isAmbienteId(ambienteId) ? ambienteId : DEFAULT_AMBIENTE_ID;
                set({ activeAmbienteId: next });
            },
            resetAmbiente: () => {
                set({ activeAmbienteId: DEFAULT_AMBIENTE_ID });
            },
        }),
        {
            name: ENVIRONMENT_STORE_KEY,
            version: 1,
            // Mismo patrón de almacenamiento que integrationStore
            // (fuente única en ./storage).
            storage: createJSONStorage(resolveSafeStorage),
            partialize: (state) => ({
                activeAmbienteId: state.activeAmbienteId,
            }),
            merge: (persisted, current) => {
                const merged = {
                    ...current,
                    ...(persisted as Partial<EnvironmentStore>),
                };
                // Blindaje: un id persistido inválido se corrige a `asistente`.
                if (!isAmbienteId(merged.activeAmbienteId)) {
                    merged.activeAmbienteId = DEFAULT_AMBIENTE_ID;
                }
                return merged;
            },
        }
    )
);

// -----------------------------------------------------------
// Recuperación del ambiente activo persistido (formato RAW)
// -----------------------------------------------------------
// Zustand persiste el estado como JSON: `{ state: { activeAmbienteId }, version }`.
// Esta lectura NO aplica el blindaje del merge: devuelve el id tal como estaba
// guardado (posiblemente un ambiente dinámico aún no hidratado en la caché).
// App la usa tras `hydrateAmbientes()` para recuperar el ambiente correcto.
export function readPersistedActiveAmbienteId(): string | null {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        const raw = window.localStorage.getItem(ENVIRONMENT_STORE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { state?: { activeAmbienteId?: unknown } };
        const id = parsed?.state?.activeAmbienteId;
        return typeof id === 'string' && id ? id : null;
    } catch {
        console.warn('[catch] src/store/environmentStore.ts');
        return null;
    }
}

// -----------------------------------------------------------
// Exposición global para tests E2E (Playwright)
// -----------------------------------------------------------
if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__fluEnvironmentStore = useEnvironmentStore;
}
