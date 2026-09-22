// ============================================================
// caughtError — registro ÚNICO de excepciones capturadas
// ============================================================
// Vía por la que un `catch` deja de ser silencioso (AGENTS.md 2.6):
// toda captura registra aquí la excepción con su contexto.
//
// SIN imports estáticos a propósito. `clientLogRelay` importa `fluConfig`, y
// varios módulos de configuración capturan errores; un import estático cerraría
// el ciclo  fluConfig -> sharedConfig -> caughtError -> clientLogRelay -> fluConfig
// y dejaría la configuración indefinida en el arranque. Por eso el relay se
// carga de forma diferida (módulo cacheado tras el primer uso).
// ============================================================

function describe(value: unknown): string {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    try {
        return JSON.stringify(value);
    } catch {
        /* ignorado: valor no serializable; se registra su forma textual */
        return String(value);
    }
}

/**
 * Registra una excepción capturada con su contexto.
 * @param context - Origen legible del fallo (módulo o acción).
 * @param details - Excepción capturada y/o datos de diagnóstico.
 * @returns Nada. Efecto lateral: entrada en el relay de logs del proyecto.
 */
export function logCaughtError(context: string, ...details: unknown[]): void {
    const detail = details.map(describe).filter((s) => s !== '').join(' | ');
    const message = String(context || 'desconocido');
    // Doble destino deliberado: el relay central (auditoría) y la consola
    // (visibilidad inmediata en desarrollo; el relay puede estar desactivado).
    try {
        console.error(`[catch] ${message}`, detail || undefined);
    } catch {
        /* ignorado: la consola no está disponible en este contexto */
    }
    void import('./clientLogRelay')
        .then((mod) => mod.relayLog('ERROR', 'catch', message, { detail }))
        .catch(() => {
            /* ignorado: el relay de logs no está disponible en este contexto */
        });
}
