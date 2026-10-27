// ============================================================
// caughtError — registro ÚNICO de excepciones capturadas
// ============================================================
// Vía por la que un `catch` deja de ser silencioso (AGENTS.md 2.6):
// toda captura registra aquí la excepción con su contexto.
//
// HOJA POR DISEÑO (corte 2026-10-26): sin imports de ningún tipo. Antes el relay
// se cargaba con `import('./clientLogRelay.ts')` diferido y rolldown seguía esa
// arista hasta cerrar ciclos ENTRE WORKERS (whisperAsr.worker -> voiceId.worker
// -> whisperAsr.worker, con las variantes de fbxLoader.worker). Como
// `clientLogRelay` importa `fluConfig` y varios módulos de configuración capturan
// errores, un import estático cerraría el ciclo
//  fluConfig -> sharedConfig -> caughtError -> clientLogRelay -> fluConfig
// y dejaría la configuración indefinida en el arranque. La inversión: este módulo
// NO conoce al relay; el relay (del hilo principal) SE REGISTRA como receptor al
// cargar. En un worker/Node no hay receptor y la captura queda en la consola,
// igual que antes (el relay nunca entregaba sin `document.baseURI`).
// ============================================================

/** Receptor registrado por el relay del hilo principal (`clientLogRelay`). */
export type ReceptorCaughtError = (nivel: 'ERROR', tag: 'catch', message: string, data: { detail: string }) => void;

let receptor: ReceptorCaughtError | null = null;

/**
 * Registra al consumidor del log (el relay central del hilo principal). Lo llama
 * `clientLogRelay` UNA vez al cargar; en workers/Node nunca hay receptor y la
 * captura se queda en la consola (conducta previa intacta).
 * @param fn Receptor de las capturas registradas por {@link logCaughtError}.
 */
export function registrarReceptorCaughtError(fn: ReceptorCaughtError): void {
    receptor = fn;
}

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
    try {
        receptor?.('ERROR', 'catch', message, { detail });
    } catch (e: unknown) {
        // Un fallo del receptor NO se re-reporta por el registro central: ese
        // registro ES este mismo camino, asi que re-reportarlo era un bucle
        // SIN FIN (medido: un worker de vitest llego a 5,8 GB y el proceso
        // moria). El fallo se queda en la consola, que es donde se lee.
        try {
            console.error(`[catch] relay ${message}`, describe(e));
        } catch {
            /* ignorado: la consola no esta disponible en este contexto */
        }
    }
}
