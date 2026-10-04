/**
 * Programacion en tiempo ocioso: UN solo dueno del primitivo.
 *
 * POR QUE EXISTE (censo de duenos de decision 2026-10-04): el mismo algoritmo
 * (`requestIdleCallback` con timeout, o `setTimeout 0` de respaldo) estaba
 * definido en DOS modulos de voz —`voiceIdentityQueue` con retorno vacio y
 * `voiceIdWorkerClient` envolviendolo en Promise— asi que un cambio en uno no
 * llegaba al otro. Aqui vive el primitivo; el que necesita esperar el resultado
 * lo envuelve (no lo re-implementa).
 */
export function scheduleIdle(fn, timeoutMs = 2500) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: timeoutMs })
    return
  }
  setTimeout(fn, 0)
}
