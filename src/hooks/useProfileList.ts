/**
 * useProfileList — cableado ÚNICO de un servicio de perfiles + listado recargable.
 *
 * Dueño de la construcción del servicio (una sola vez), del refresco y de la
 * recarga del listado. Los hooks de perfiles aportan su servicio y su tabla;
 * ninguno vuelve a montar `useServiceRef` + `useListReload` a mano.
 */
import { useCallback, useRef } from 'react'
import { useListReload } from './useListReload'
import { useServiceRef } from './useServiceRef'

/** Opciones del listado de perfiles. */
export interface UseProfileListOptions<T, S> {
  /** Construye el servicio con el reloj inyectable. */
  create: (now: () => number) => S
  /** Reloj inyectable (por defecto Date.now). */
  now?: () => number
  /** Etiqueta de error del refresco. */
  errorLabel: string
  /** Listado del servicio. */
  list: (service: S) => Promise<T[]>
}

/** Estado que expone el listado. */
export interface UseProfileListResult<T, S> {
  service: S
  items: T[]
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Monta el servicio de perfiles y su listado recargable.
 * @param options Constructor, reloj, etiqueta y listado.
 * @returns Servicio, items, carga y refresco.
 */
export function useProfileList<T, S>({
  create,
  now,
  errorLabel,
  list,
}: UseProfileListOptions<T, S>): UseProfileListResult<T, S> {
  const service = useServiceRef<S>(() => create(now || (() => Date.now())))

  const listRef = useRef(list)
  listRef.current = list

  const load = useCallback(() => listRef.current(service), [service])
  const { items, loading, refresh } = useListReload(load, errorLabel)

  return { service, items, loading, refresh }
}
