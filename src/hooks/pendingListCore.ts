/**
 * pendingListCore — mecánica ÚNICA de una lista de pendientes.
 *
 * Dueño del estado de una lista marcable (carga, orden pendientes‑primero,
 * recuento de restantes y refresco tras mutación). `useNotes` y
 * `useShoppingList` aportan su servicio, su predicado de "hecho" y su recuento;
 * ninguno reimplementa el estado ni el orden.
 */
import { useCallback, useEffect, useState } from 'react'
import { logCaughtError } from '../lib/caughtError'

/** Opciones de la lista pendiente. */
export interface PendingListOptions<T> {
  /** Carga la lista completa desde su servicio. */
  load: () => Promise<T[]>
  /** ¿La fila está marcada/completada? */
  isDone: (row: T) => boolean
  /** Marca temporal de creación (orden cronológico). */
  createdAt: (row: T) => number
  /** Recuento de pendientes de la lista. */
  remaining: (rows: T[]) => number
  /** Contexto de registro si la carga falla. */
  errorContext: string
}

/** Estado que expone la lista pendiente. */
export interface PendingListState<T> {
  rows: T[]
  loading: boolean
  remainingCount: number
  refresh: () => Promise<void>
}

/**
 * Carga y ordena una lista de pendientes, con refresco tras cada mutación.
 * @param options Servicio, predicado, orden y recuento de la lista.
 * @returns Filas ordenadas, estado de carga, restantes y refresco.
 */
export function usePendingList<T>({
  load,
  isDone,
  createdAt,
  remaining,
  errorContext,
}: PendingListOptions<T>): PendingListState<T> {
  const [rows, setRows] = useState<T[]>([])
  const [remainingCount, setRemainingCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await load()
      const sorted = all.slice().sort((a, b) => {
        const doneA = isDone(a)
        const doneB = isDone(b)
        if (doneA !== doneB) return doneA ? 1 : -1
        return createdAt(a) - createdAt(b)
      })
      setRows(sorted)
      setRemainingCount(remaining(sorted))
    } catch (err) {
      logCaughtError(errorContext, err)
    } finally {
      setLoading(false)
    }
  }, [load, isDone, createdAt, remaining, errorContext])

  useEffect(() => {
    refresh().catch((e) => logCaughtError(errorContext, e))
  }, [refresh, errorContext])

  return { rows, loading, remainingCount, refresh }
}

/**
 * Limpia una lista de etiquetas: recorta y descarta vacías.
 * Dueño único de la higiene de entrada de las listas.
 * @param labels Etiquetas de entrada.
 * @returns Etiquetas limpias.
 */
export function cleanLabels(labels?: readonly string[]): string[] {
  return (labels ?? []).map((label) => label.trim()).filter(Boolean)
}

/**
 * Ejecuta una mutación que devuelve cuántas filas cambió y refresca si hubo
 * cambios. Dueño único del patrón que repetían las acciones de las listas.
 * @param refresh Refresco de la lista.
 * @returns Función que ejecuta la mutación y refresca.
 */
export function useCountedMutation(
  refresh: () => Promise<void>,
): (mutate: () => Promise<number>) => Promise<number> {
  return useCallback(
    async (mutate: () => Promise<number>): Promise<number> => {
      const count = await mutate()
      if (count > 0) await refresh()
      return count
    },
    [refresh],
  )
}

/**
 * Agrega entradas en secuencia y devuelve sus resultados.
 * @param inputs Entradas ya limpias.
 * @param addOne Alta de una entrada.
 * @returns Resultados en el mismo orden.
 */
export async function addSequentially<T, R>(
  inputs: T[],
  addOne: (input: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (const input of inputs) results.push(await addOne(input))
  return results
}
