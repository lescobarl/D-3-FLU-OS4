/**
 * Indicador "FLU está trabajando" (overlay Pensando).
 *
 * CONTRATO (sentido común): el overlay significa "aún espero respuesta". Por eso
 * dura desde que el turno empieza a trabajar hasta que FLU EMPIEZA A HABLAR, no
 * hasta que termina de hablar. Antes se apagaba en el `finally` del turno, que
 * corre después de `await speak`, así que el mensaje seguía encendido mientras FLU
 * hablaba: el usuario ya tenía la respuesta delante y el indicador decía "pensando".
 *
 * Dos cierres, el que ocurra primero:
 *   - `markSpeaking()`: FLU empezó a hablar -> la espera terminó.
 *   - `end()`: el turno terminó sin hablar (turno mudo) -> nada que esperar.
 * El contador sigue existiendo porque dos turnos solapados no deben apagarse entre
 * sí, y para el diagnóstico (`activos`).
 *
 * Se pinta SOLO cuando el estado visible cambia: así el log tiene una línea por
 * transición REAL con su culpable (`reason`), en vez de repetirse en cada fase.
 */
export function createTurnWorkIndicator(getStore, log) {
  let active = 0;
  let visible = false;
  let speaking = false;

  const paint = (isThinking, reason) => {
    const store = getStore?.();
    if (store && typeof store.setThinking === 'function') store.setThinking(isThinking);
    log?.(
      `turnIndicator: ${isThinking ? 'ON' : 'OFF'} (reason=${reason || 'n/d'}, activos=${active}${speaking ? ', flu=hablando' : ''})`,
    );
  };

  /**
   * Evalúa el estado visible. `force` lo usa `begin()`: encender es una transición
   * autoritativa (si algo externo apagó el overlay, el turno nuevo debe reencenderlo
   * sin quedar desincronizado). El resto escribe solo si el estado cambió de verdad.
   */
  const render = (reason, force = false) => {
    const next = active > 0 && !speaking;
    if (next !== visible || (force && next)) {
      visible = next;
      paint(next, reason);
      return;
    }
    log?.(`turnIndicator: sigue ${next ? 'ON' : 'OFF'} (reason=${reason || 'n/d'}, activos=${active})`);
  };

  return {
    /** El turno empieza a trabajar (desde aquí el overlay debe estar visible). */
    begin(reason) {
      active += 1;
      speaking = false;
      render(reason, true);
      return active;
    },
    /** FLU empezó a hablar: la espera terminó, el overlay se apaga. */
    markSpeaking(reason) {
      speaking = true;
      render(reason);
      return active;
    },
    /** El turno termina su trabajo (con o sin habla). */
    end(reason) {
      active = Math.max(0, active - 1);
      if (active === 0) speaking = false;
      render(reason);
      return active;
    },
    /** ¿Hay trabajo vivo? (diagnóstico/guardas) */
    isActive() {
      return active > 0;
    },
    /** ¿Está el overlay visible ahora mismo? (diagnóstico/guardas) */
    isVisible() {
      return visible;
    },
    /** Cierra TODO el trabajo vivo (cierre de sesión/estado terminal). */
    reset(reason) {
      active = 0;
      speaking = false;
      render(reason);
    },
  };
}
