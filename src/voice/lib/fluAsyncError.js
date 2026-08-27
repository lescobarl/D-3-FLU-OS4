/**
 * Registro mínimo para promesas fire-and-forget (evita .catch vacíos).
 * @param {string} scope
 * @param {unknown} error
 */
export function logFluAsyncError(scope, error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown')
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(`[Flu][async-error] ${scope}: ${message}`)
  }
}

/**
 * @param {string} scope
 * @returns {(error: unknown) => void}
 */
export function fluAsyncErrorHandler(scope) {
  return (error) => logFluAsyncError(scope, error)
}
