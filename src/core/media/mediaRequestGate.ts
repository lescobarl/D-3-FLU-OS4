// ============================================================
// mediaRequestGate — Idempotencia de pedidos de generación de medios
// ------------------------------------------------------------
// El ASR puede RE-CAPTURAR el mismo comando (eco/repetición); sin este gate,
// cada captura dispara una generación PAGA nueva (fuga de crédito). Política:
// se ejecuta a lo sumo UNA vez por comando dentro de una ventana; un comando
// distinto siempre pasa. Fuente única del criterio (los consumidores no
// reimplementan deduplicación ni hardcodean umbrales).
// ============================================================

export interface MediaRequestGate {
  /** true si el pedido debe ejecutarse (no duplicado dentro de la ventana). */
  shouldRun(tipo: string, commandText: string, now?: number): boolean;
  /** Limpia el estado (p. ej. al reiniciar sesión). */
  reset(): void;
}

function normalizeKey(tipo: string, commandText: string): string {
  const t = String(tipo || '').trim().toLowerCase();
  const c = String(commandText || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `${t}|${c}`;
}

export function createMediaRequestGate(windowMs: number): MediaRequestGate {
  const safeWindow = Math.max(0, Number(windowMs) || 0);
  let lastKey = '';
  let lastAt = 0;

  return {
    shouldRun(tipo: string, commandText: string, now: number = Date.now()): boolean {
      const key = normalizeKey(tipo, commandText);
      if (key === lastKey && now - lastAt < safeWindow) {
        return false;
      }
      lastKey = key;
      lastAt = now;
      return true;
    },
    reset(): void {
      lastKey = '';
      lastAt = 0;
    },
  };
}
