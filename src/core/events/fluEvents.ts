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
    // Navegación/búsqueda web → pestaña "Buscar" del Pizarrón.
    // Los resultados web viven SOLO en la pestaña Buscar (requisito del
    // usuario), nunca en la pestaña "Respuesta de Flu".
    RUN_SEARCH: 'flu:run-search',
    // Limpieza del estado de búsqueda del Pizarrón cuando comienza un turno
    // NO relacionado con búsqueda (conversación, generación de imagen, etc.).
    // Evita que los resultados web/consulta de un turno anterior queden
    // "pegados" en el feed y en la barra cuando la IA responde otra cosa.
    RESET_SEARCH: 'flu:reset-search',
} as const;

/** Unión de nombres de eventos de comando FLU. */
export type FluEventName = (typeof FLU_EVENTS)[keyof typeof FLU_EVENTS];

/**
 * Payload del evento `RUN_SEARCH`: una consulta web que debe ejecutarse en
 * la pestaña "Buscar" del Pizarrón (WorkspaceSearch).
 */
export interface FluSearchPayload {
    /** Consulta de búsqueda (o sitio a navegar) ya depurada de marcadores. */
    query: string;
    /** Idioma efectivo de la consulta ('es' | 'en'). */
    lang?: 'es' | 'en';
}

/**
 * Dispara el evento `RUN_SEARCH` con payload en `window`.
 * Es un no-op en entornos sin `window` (SSR/tests).
 * @param payload — Consulta e idioma a ejecutar en la pestaña Buscar.
 */
export function dispatchFluSearch(payload: FluSearchPayload): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<FluSearchPayload>(FLU_EVENTS.RUN_SEARCH, { detail: payload }));
}

/**
 * Registra un listener tipado para el evento `RUN_SEARCH`.
 * Devuelve la función de limpieza para removerlo (útil en `useEffect`).
 * @param handler — Callback que recibe el payload de búsqueda.
 * @returns Función que remueve el listener.
 */
export function onFluSearch(handler: (payload: FluSearchPayload) => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const listener = (event: Event) => {
        const detail = (event as CustomEvent<FluSearchPayload>).detail;
        if (detail && typeof detail.query === 'string' && detail.query.trim()) {
            handler(detail);
        }
    };
    window.addEventListener(FLU_EVENTS.RUN_SEARCH, listener);
    return () => window.removeEventListener(FLU_EVENTS.RUN_SEARCH, listener);
}

/**
 * Dispara el evento `RESET_SEARCH` en `window`, indicando al Pizarrón que
 * debe limpiar el estado de búsqueda (resultados web/imágenes/vídeo y la
 * consulta de la barra) porque comienza un turno NO relacionado con búsqueda.
 * Es un no-op en entornos sin `window` (SSR/tests).
 */
export function dispatchFluResetSearch(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(FLU_EVENTS.RESET_SEARCH));
}

/**
 * Registra un listener tipado para el evento `RESET_SEARCH`.
 * Devuelve la función de limpieza para removerlo (útil en `useEffect`).
 * @param handler — Callback invocado al recibir el evento de limpieza.
 * @returns Función que remueve el listener.
 */
export function onFluResetSearch(handler: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener(FLU_EVENTS.RESET_SEARCH, handler);
    return () => window.removeEventListener(FLU_EVENTS.RESET_SEARCH, handler);
}

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
