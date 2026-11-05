/**
 * refreshOnOk — wrappers ÚNICOS de "acción → refrescar lista".
 *
 * `refreshIf` es el dueño de la secuencia; los dos wrappers solo eligen el
 * criterio (resultado `ok` o valor presente). Antes cada hook copiaba el cuerpo.
 */
import { useCallback } from 'react'

/**
 * Ejecuta una acción y refresca si el criterio lo pide.
 * @param action Acción del servicio.
 * @param refresh Refresco de la lista.
 * @param shouldRefresh Criterio sobre el valor.
 * @returns El valor de la acción.
 */
export async function refreshIf<T>(
  action: () => Promise<T>,
  refresh: () => Promise<void> | void,
  shouldRefresh: (value: T) => boolean,
): Promise<T> {
  const value = await action()
  if (shouldRefresh(value)) await refresh()
  return value
}

/**
 * Refresca si el resultado trae `ok: true`.
 * @param action Acción del servicio.
 * @param refresh Refresco de la lista.
 * @returns El resultado de la acción.
 */
export function refreshOnOk<T extends { ok: boolean }>(
  action: () => Promise<T>,
  refresh: () => Promise<void> | void,
): Promise<T> {
  return refreshIf(action, refresh, (result) => result.ok)
}

/**
 * Refresca si el resultado es un valor presente.
 * @param action Acción del servicio.
 * @param refresh Refresco de la lista.
 * @returns El valor de la acción.
 */
export function refreshOnValue<T>(
  action: () => Promise<T>,
  refresh: () => Promise<void> | void,
): Promise<T> {
  return refreshIf(action, refresh, Boolean)
}

/**
 * Envuelve una acción del servicio para refrescar cuando devuelve valor.
 * Dueño único del wrapper con argumentos que repetían los hooks.
 * @param action Acción del servicio.
 * @param refresh Refresco de la lista.
 * @returns Acción envuelta y memorizada.
 */
export function useRefreshAction<A extends unknown[], T>(
  action: (...args: A) => Promise<T>,
  refresh: () => Promise<void> | void,
): (...args: A) => Promise<T> {
  return useCallback(
    (...args: A) => refreshOnValue(() => action(...args), refresh),
    [action, refresh],
  )
}
