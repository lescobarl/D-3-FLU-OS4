// ============================================================
// fluEvents.ts — Centralized typed event bus for FLU voice commands
// ============================================================
// Single source of truth for window CustomEvent names dispatched by
// voice navigation commands and consumed by the App shell.
// Prevents name drift between dispatchers and listeners.
//
// Cumple:
//   - Rule #1: NO HARDCODE — event names centralizados, sin drift
//   - Obligación #2: JSDoc en todo componente/método
// ============================================================

/** Nombres canónicos de eventos de comando FLU (CustomEvent). */
export const FLU_EVENTS = {
    GENERATE_SUMMARY: 'flu:generate-summary',
    SAVE_MINUTE: 'flu:save-minute',
    ANALYZE_DOCUMENT: 'flu:analyze-document',
    ANALYZE_APP: 'flu:analyze-app',
    GENERATE_DOCUMENT: 'flu:generate-document',
    GENERATE_VIDEO: 'flu:generate-video',
} as const;

/** Unión de nombres de eventos de comando FLU. */
export type FluEventName = (typeof FLU_EVENTS)[keyof typeof FLU_EVENTS];

/**
 * Dispara un evento de comando FLU en `window`.
 * Es un no-op en entornos sin `window` (SSR/tests).
 * @param name — Nombre canónico del evento (ver `FLU_EVENTS`).
 */
export function dispatchFluEvent(name: FluEventName): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(name));
}

/**
 * Registra un listener tipado para un evento de comando FLU.
 * Devuelve la función de limpieza para removerlo (útil en `useEffect`).
 * @param name — Nombre canónico del evento (ver `FLU_EVENTS`).
 * @param handler — Callback invocado al recibir el evento.
 * @returns Función que remueve el listener.
 */
export function onFluEvent(name: FluEventName, handler: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
}
