/**
 * Escritor FUERA DEL CAMINO CRÍTICO, pero SERIALIZADO.
 *
 * Defecto medido: el turno resolvía la respuesta (la IA ya había contestado) y
 * acto seguido `await saveSessionState(...)` escribía la sesión ANTES de hablar.
 * El usuario esperaba un write de disco para OÍR una respuesta que ya estaba
 * lista. Ese tramo no era la IA ni el ASR: era persistencia en serie con la voz.
 *
 * Contrato:
 *   - `write(payload)` NO espera a la escritura: el camino crítico sigue.
 *   - El orden de escritura es el ORDEN DE LLAMADA (cadena): no se adelanta ni se
 *     invierte ninguna escritura respecto a la versión con `await`.
 *   - Un fallo se reporta por `onError` y NO rompe la cadena (las siguientes
 *     escrituras siguen su curso).
 *   - `flush()` devuelve la cadena: úsalo al cerrar sesión o en pruebas.
 *
 * El payload se evalúa al LLAMAR (los argumentos se evalúan antes del write), así
 * que el contenido es idéntico al de la versión bloqueante.
 */
export function createOffPathWriter(run, onError) {
  let chain = Promise.resolve()

  return {
    /** Encola la escritura y devuelve el turno de la cadena (sin bloquear al llamante). */
    write(payload) {
      chain = chain.then(() => run(payload)).catch((error) => {
        if (typeof onError === 'function') onError(error)
      })
      return chain
    },
    /** Cadena completa (cierre de sesión / pruebas). */
    flush() {
      return chain
    },
  }
}
