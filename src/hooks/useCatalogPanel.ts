/**
 * useCatalogPanel — estado ÚNICO del editor de un catálogo.
 *
 * Dueño de abrir/cerrar el editor y de enviar el formulario: cierra solo cuando
 * el guardado no devuelve error. Los paneles de catálogo aportan su tipo de
 * editor y su guardado (`saveCatalogEntry`/`submitCatalogPanel`); ninguno
 * vuelve a declarar el `useState` del editor ni el cierre del envío.
 */
import { useCallback, useState } from 'react'

/** Superficie del editor de catálogo. */
export interface CatalogPanelState<E, P> {
  /** Editor abierto (crear/editar) o `null`. */
  editor: E | null
  /** Abre el editor con el valor ya construido por el panel. */
  open: (editor: E) => void
  /** Cierra el editor sin guardar. */
  cancel: () => void
  /** Envía el formulario; cierra si no hay error. */
  submit: (payload: P) => Promise<string | null>
}

/** Opciones del estado del editor. */
export interface CatalogPanelOptions<E, P> {
  /** Guarda el payload para el editor abierto; devuelve el error o `null`. */
  save: (editor: E, payload: P) => Promise<string | null>
}

/**
 * Estado y envío del editor de un catálogo.
 * @param options Guardado propio del panel.
 * @returns Editor abierto, apertura, cancelación y envío.
 */
export function useCatalogPanel<E, P>({ save }: CatalogPanelOptions<E, P>): CatalogPanelState<E, P> {
  const [editor, setEditor] = useState<E | null>(null)

  const open = useCallback((next: E): void => setEditor(next), [])
  const cancel = useCallback((): void => setEditor(null), [])

  const submit = useCallback(
    async (payload: P): Promise<string | null> => {
      if (!editor) return null
      const error = await save(editor, payload)
      if (!error) setEditor(null)
      return error
    },
    [editor, save],
  )

  return { editor, open, cancel, submit }
}
