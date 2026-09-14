// ============================================================
// geminiContractClient — ÚNICO sitio del fetch a /api/gemini/contract
// ============================================================
// Fuente única del boilerplate POST para el proxy de Gemini (V10).
// Los consumidores (services/gemini.ts, hooks/useWorkspaceSearch.ts,
// voice/lib/gemini.js) aportan solo el payload; endpoint, method, headers y
// body viven aquí.
// Cumple Rule #1 (no hardcode) y Obligación #2 (JSDoc).
// ============================================================

import { fetchTextEngineResilient } from '../core/ai/httpClient';

/** Endpoint canónico del proxy de contrato (definido UNA sola vez). */
const GEMINI_CONTRACT_ENDPOINT = '/api/gemini/contract';

/**
 * Arma el `RequestInit` POST JSON del contrato. Compartido por la variante
 * directa y la resiliente para no duplicar el cuerpo del request.
 * @param payload Cuerpo serializable.
 */
function buildContractInit(payload: Record<string, unknown>): RequestInit {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

/**
 * Envía un payload al proxy canónico de Gemini con `fetch` directo.
 *
 * Contrato: POST JSON contra el endpoint canónico. No interpreta la
 * respuesta ni normaliza errores: devuelve el `Response` crudo para que
 * cada consumidor conserve su manejo (parseo y política de error) intacto.
 *
 * @param payload Cuerpo serializable (mismo objeto que antes pasaba a JSON.stringify).
 * @returns La respuesta cruda del proxy.
 */
export async function postGeminiContract(payload: Record<string, unknown>): Promise<Response> {
    return fetch(GEMINI_CONTRACT_ENDPOINT, buildContractInit(payload));
}

/**
 * Variante resiliente (timeout + reintento de transporte) del MISMO endpoint.
 * La usa el motor de voz, que ya no duplica el fetch (V10).
 *
 * @param payload Cuerpo serializable.
 * @param options Política de timeout/reintentos de `fetchTextEngineResilient`.
 * @returns La respuesta cruda del proxy.
 */
export async function postGeminiContractResilient(
    payload: Record<string, unknown>,
    options: { timeoutMs?: number; retries?: number; retryDelayMs?: number } = {},
): Promise<Response> {
    return fetchTextEngineResilient(GEMINI_CONTRACT_ENDPOINT, buildContractInit(payload), options);
}
