// ============================================================
// geminiContractClient — ÚNICO sitio del fetch a /api/gemini/contract
// ============================================================
// Fuente única del boilerplate POST para el proxy de Gemini (V10).
// Los consumidores (services/gemini.ts, hooks/useWorkspaceSearch.ts)
// aportan solo el payload; el method/headers/body viven aquí.
// Cumple Rule #1 (no hardcode) y Obligación #2 (JSDoc).
// ============================================================

/**
 * Envía un payload al proxy canónico de Gemini.
 *
 * Contrato: POST JSON contra `/api/gemini/contract`. No interpreta la
 * respuesta ni normaliza errores: devuelve el `Response` crudo para que
 * cada consumidor conserve su manejo (parseo y política de error) intacto.
 *
 * @param payload Cuerpo serializable (mismo objeto que antes pasaba a JSON.stringify).
 * @returns La respuesta cruda del proxy.
 */
export async function postGeminiContract(payload: Record<string, unknown>): Promise<Response> {
    return fetch('/api/gemini/contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}
