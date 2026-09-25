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

/**
 * true si `key` ya fue entregada por CUALQUIER respuesta de la ventana (⇒
 * duplicado: se omite). A diferencia de `isDuplicateResponse` (solo la última),
 * esto cubre la re-emisión de una respuesta ANTERIOR dentro de la ventana.
 */
export function isDuplicateResponseIn(
  states: readonly ResponseGateState[],
  key: string,
  now: number,
  windowMs: number,
): boolean {
  if (!key || windowMs <= 0) return false;
  return states.some((state) => state.key === key && now - state.at < windowMs);
}

/** Registra `key` en la ventana y descarta las entradas vencidas. */
export function pushResponseState(
  states: readonly ResponseGateState[],
  key: string,
  at: number,
  windowMs: number,
): ResponseGateState[] {
  if (!key || windowMs <= 0) return [...states];
  return [...states.filter((state) => at - state.at < windowMs), { key, at }];
}
