// ============================================================
// useAsyncAction — dueño único del estado "busy" de un panel
// ------------------------------------------------------------
// Los paneles repetían el mismo patrón: `if (busy) return`, `setBusy(true)`,
// `await accion()`, `setBusy(false)`. Ese patrón tiene tres defectos reales:
//   1) dos envíos en el mismo tick pueden leer `busy=false` antes del re-render;
//   2) si la acción rechaza, la promesa queda sin manejar y el panel no registra
//      el fallo;
//   3) si el usuario desmonta el panel durante la espera, el `finally` actualiza
//      estado de un componente que ya no existe.
// Este hook concentra la guardia de reentrada (ref síncrona), el registro del
// error y el respeto al desmontaje. Los paneles solo deciden qué hacer si la
// acción terminó bien.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { logCaughtError } from '../lib/caughtError'

/** Resultado de una acción protegida: éxito con valor, o fallo ya registrado. */
export type AsyncActionResult<T> = { ok: true; value: T } | { ok: false }

export interface UseAsyncAction {
  /** Verdadero mientras haya alguna acción protegida en vuelo. */
  busy: boolean
  /**
   * Ejecuta `action` una sola vez por `key`. Dos acciones con claves distintas
   * pueden correr a la vez (dos filas diferentes); repetir la MISMA clave
   * mientras está en vuelo se ignora. Un rechazo se registra y devuelve
   * `{ ok: false }`; nunca propaga la excepción al evento de React.
   */
  run: <T>(action: () => Promise<T>, key?: string) => Promise<AsyncActionResult<T>>
}

/**
 * Estado de ocupado con guardia síncrona, registro de errores y limpieza al
 * desmontar.
 * @param context Contexto legible para `logCaughtError`.
 * @returns `busy` y `run`.
 */
export function useAsyncAction(context: string): UseAsyncAction {
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(new Set<string>())
  const mounted = useRef(true)
  const contextRef = useRef(context)

  useEffect(() => {
    contextRef.current = context
  }, [context])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    async <T>(action: () => Promise<T>, key = 'default'): Promise<AsyncActionResult<T>> => {
      if (inFlight.current.has(key)) return { ok: false }
      inFlight.current.add(key)
      if (mounted.current) setBusy(true)
      try {
        const value = await action()
        return { ok: true, value }
      } catch (error) {
        logCaughtError(contextRef.current, error)
        return { ok: false }
      } finally {
        inFlight.current.delete(key)
        if (mounted.current) setBusy(inFlight.current.size > 0)
      }
    },
    [],
  )

  return { busy, run }
}
