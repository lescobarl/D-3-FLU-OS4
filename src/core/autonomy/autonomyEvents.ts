// ============================================================
// Autonomy Events — Bus central de eventos de autonomía
// ============================================================
// Interfaz común de notificación para los sistemas autónomos
// (health monitor, auto-recovery, decision engine, auto-
// optimization, backup system). Reemplaza los CustomEvent
// 'flu-*' dispersos (que no tenían ningún listener) por un bus
// tipado con suscriptores reales. Cumple AGENTS.md
// (eventos centralizados) y la Regla de capas: el bus es puro,
// sin dependencias de window/DOM.
// ============================================================

export type AutonomyEventType =
    | 'ai-provider-changed'
    | 'system-notification'
    | 'soft-restart'
    | 'degraded-mode-changed'
    | 'parameter-rollback'
    | 'parameter-changed'
    | 'autonomy-notification';

export interface AutonomyEvent {
    type: AutonomyEventType;
    message: string;
    level?: 'info' | 'warning' | 'error' | 'success';
    detail?: Record<string, unknown>;
}

type AutonomyEventListener = (event: AutonomyEvent) => void;

const listeners = new Set<AutonomyEventListener>();

/**
 * Suscribe un listener a los eventos de autonomía.
 * Devuelve una función que cancela la suscripción.
 */
export function onAutonomyEvent(listener: AutonomyEventListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Emite un evento a todos los suscriptores. El error de un listener
 * no debe propagarse al sistema emisor (se registra y continúa).
 */
export function emitAutonomyEvent(event: AutonomyEvent): void {
    listeners.forEach((listener) => {
        try {
            listener(event);
        } catch (err) {
            console.error('[autonomyEvents] error en listener de evento de autonomía:', err);
        }
    });
}
