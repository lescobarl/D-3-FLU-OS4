/**
 * Cronómetro del turno de voz: una sola línea con el REPARTO real del tiempo.
 *
 * Motivo (medido): el turno tarda 6-27 s mientras la IA tarda ~1 s, así que el
 * coste está fuera de la IA, pero el cronómetro anterior solo cubría la firma de
 * audio y la escritura de sesión: el tramo de despacho de la acción + locución
 * quedaba sin medir y se atribuía por suposición. Aquí cada fase se marca y se
 * emite un único resumen, de modo que la siguiente decisión se toma con números.
 *
 * Sin hardcode y sin estado global: el llamante crea uno por turno.
 */
export function createTurnStopwatch(now = () => Date.now()) {
  let startMs = now();
  let lastMs = startMs;
  const laps = [];

  const lap = (label) => {
    const t = now();
    laps.push(`${label}=${t - lastMs}ms`);
    lastMs = t;
    return t - startMs;
  };

  return {
    /** Reinicia para el turno actual (un cronómetro puede durar toda la sesión). */
    restart() {
      startMs = now();
      lastMs = startMs;
      laps.length = 0;
      return startMs;
    },
    /** Marca el fin de una fase; la etiqueta la nombra el llamante. */
    lap,
    /** Tiempo desde el inicio del turno. */
    elapsedMs: () => now() - startMs,
    /** Resumen de una línea: la marca `total` la añade el llamante si la quiere. */
    report: () => (laps.length ? `turnTiming: ${laps.join(' ')}` : 'turnTiming:'),
  };
}
