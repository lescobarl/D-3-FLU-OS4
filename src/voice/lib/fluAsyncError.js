/**
 * Registro de promesas fire-and-forget (evita `.catch` vacios).
 *
 * DOS destinos, un solo punto: la linea de consola (la que se grepea en el log del navegador)
 * y el registro CENTRAL (`logCaughtError` -> relay + auditoria). Antes solo hacia consola, asi
 * que estos fallos no llegaban a la traza del proyecto (auditoria 2026-10-22).
 * @param {string} scope
 * @param {unknown} error
 */
import { logCaughtError } from '../../lib/caughtError';

export function logFluAsyncError(scope, error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown')
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(`[Flu][async-error] ${scope}: ${message}`)
  }
  logCaughtError(`fluAsyncError:${scope}`, error)
}

/**
 * @param {string} scope
 * @returns {(error: unknown) => void}
 */
export function fluAsyncErrorHandler(scope) {
  return (error) => logFluAsyncError(scope, error)
}
