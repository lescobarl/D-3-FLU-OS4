// ============================================================
// panelUtils — Helpers compartidos por los paneles de módulos
// ============================================================
// Evita duplicar la misma mecánica en cada panel (V18):
//   - runBusyAction: ejecuta una acción asíncrona protegiendo el
//     estado `busy` (early-return + finally), idéntico en los cuatro
//     paneles que borran filas.
//   - todayLocalDate: fecha local de hoy en 'YYYY-MM-DD' (mismo
//     formato que los servicios de dominio).
// ============================================================

/**
 * Ejecuta `action` una sola vez mientras `busy` sea false, marcando
 * `setBusy(true)` durante la espera y restaurándolo en `finally`.
 * @param busy Estado de ocupado actual del panel.
 * @param setBusy Setter del estado de ocupado.
 * @param action Acción asíncrona a ejecutar.
 * @returns Promesa que resuelve cuando la acción termina.
 */
import { dayKey } from '../lib/dateKey'

export async function runBusyAction(
    busy: boolean,
    setBusy: (value: boolean) => void,
    action: () => Promise<void>,
): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
        await action();
    } finally {
        setBusy(false);
    }
}

/**
 * Fecha local de hoy en formato 'YYYY-MM-DD'.
 * @returns La fecha del sistema en hora local, sin desfase de zona.
 */
export function todayLocalDate(): string {
    return dayKey();
}
