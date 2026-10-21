/**
 * DUENO UNICO de cancelar un temporizador guardado en una ref.
 *
 * El bloque `if (ref.current) { window.clearTimeout(ref.current); ref.current = null }`
 * estaba copiado en varios callbacks de `useFluVoiceAssistant` (deps del hook, timers
 * de preview, reintento del reconocimiento). Se consolida aqui para que la regla sea
 * una: cancelar si existe, dejarla vacia y no hacer nada fuera del navegador.
 */

/** Ref a un id de `setTimeout`/`requestAnimationFrame` ya registrado. */
export interface TimerRef {
  current: number | null
}

/**
 * Cancela el `setTimeout` pendiente de la ref y la vacia.
 *
 * @param ref Ref con el id devuelto por `window.setTimeout`.
 */
export function clearTimeoutRef(ref: TimerRef): void {
  if (typeof window === 'undefined' || !ref.current) return
  window.clearTimeout(ref.current)
  ref.current = null
}

/**
 * Cancela el `requestAnimationFrame` pendiente de la ref y la vacia.
 *
 * @param ref Ref con el id devuelto por `window.requestAnimationFrame`.
 */
export function clearAnimationFrameRef(ref: TimerRef): void {
  if (typeof window === 'undefined' || !ref.current) return
  window.cancelAnimationFrame(ref.current)
  ref.current = null
}
