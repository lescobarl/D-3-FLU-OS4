// ============================================================
// fetchWithDeadline — PRIMITIVO único de "fetch con deadline" en el cliente
// ============================================================
// P8.46 (7.7.b) — la MISMA orquestación (AbortController + setTimeout +
// clearTimeout + fetch) estaba escrita en dos módulos del cliente:
// `src/core/ai/httpClient.ts` (transporte de los motores de texto) y
// `src/voice/lib/imageGeneration.js` (proxy visual). Cada copia podía divergir
// en el tope de tiempo o en el momento de limpiar el timer.
//
// El primitivo devuelve la Response tal cual y, si el corte lo produjo SU
// deadline, marca el error con `deadlineExceeded`. Así cada consumidor conserva
// SU contrato de error (el motor de texto normaliza a {code:'gemini_timeout'};
// el proxy visual necesita el `AbortError` crudo para etiquetar sus trazas
// `*_timeout`), pero la orquestación vive UNA vez.
// ============================================================

/** Marca que un error de fetch lo produjo nuestro propio deadline. */
export interface DeadlineExceeded {
    deadlineExceeded?: boolean;
}

export async function fetchWithDeadline(
    url: string,
    init: RequestInit = {},
    timeoutMs: number,
): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
        // Solo lo producido por NUESTRO deadline; un abort del llamante se propaga tal cual.
        if (timedOut && err && typeof err === 'object') {
            (err as DeadlineExceeded).deadlineExceeded = true;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}
