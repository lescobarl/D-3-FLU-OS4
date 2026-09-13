// ============================================================
// responseGate — Idempotencia por turno de la RESPUESTA de FLU
// ------------------------------------------------------------
// El ASR puede re-capturar el mismo turno (eco/repetición) y el contrato se
// vuelve a entregar → FLU repetiría su respuesta. Este gate decide si una
// respuesta debe SUPRIMIRSE por ser duplicada del mismo turno dentro de una
// ventana. Fuente única del criterio (los consumidores no lo reimplementan).
// ============================================================

export interface ResponseGateState {
  key: string;
  at: number;
}

/** Clave canónica de un turno: texto del usuario + respuesta, normalizados. */
export function buildResponseKey(userText: string, responseText: string): string {
  const norm = (value: string): string =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const key = `${norm(userText)}|${norm(responseText)}`;
  return key === '|' ? '' : key;
}

/**
 * true si `key` ya fue entregada dentro de la ventana (⇒ duplicado: se omite).
 * Una ventana `<= 0` desactiva la deduplicación.
 */
export function isDuplicateResponse(
  state: ResponseGateState,
  key: string,
  now: number,
  windowMs: number,
): boolean {
  if (!key || windowMs <= 0) return false;
  return state.key === key && now - state.at < windowMs;
}
