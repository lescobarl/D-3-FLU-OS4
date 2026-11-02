/**
 * useCatalogEditorForm — estado y envío ÚNICOS de un formulario de catálogo.
 *
 * Dueño de busy/error y del envío por `submitCatalogEditor`. Los formularios
 * aportan slug, payload y onSubmit; no repiten el estado ni el wrapper.
 */
import { useState } from 'react'
import type { FormEvent } from 'react'
import { submitCatalogEditor } from '../components/editorSubmit'

export interface UseCatalogEditorFormOptions<T> {
  /** Slug derivado del nombre. */
  slug: string
  /** Construye el payload. */
  build: () => T
  /** Envío del payload. */
  onSubmit: (payload: T) => Promise<string | null>
  /** Mensaje si falta el nombre (default común). */
  requiredMessage?: string
}

export interface CatalogEditorFormState {
  busy: boolean
  error: string | null
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void
}

/**
 * Monta el estado y el envío de un formulario de catálogo.
 * @param options Slug, payload, envío y mensaje de obligatorio.
 * @returns Busy, error y manejador de envío.
 */
export function useCatalogEditorForm<T>({
  slug,
  build,
  onSubmit,
  requiredMessage,
}: UseCatalogEditorFormOptions<T>): CatalogEditorFormState {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) =>
    submitCatalogEditor(event, {
      busy,
      setBusy,
      setError,
      slug,
      requiredMessage:
        requiredMessage || 'El nombre es obligatorio para generar el identificador.',
      build,
      onSubmit,
    })

  return { busy, error, handleSubmit }
}
