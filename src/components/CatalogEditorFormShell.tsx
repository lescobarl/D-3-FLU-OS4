/**
 * CatalogEditorFormShell — esqueleto ÚNICO de un formulario de catálogo.
 *
 * Dueño del formulario, el cuerpo, el error y las acciones de guardar/cancelar.
 * Los editores de ambiente y paleta aportan sus campos como hijos.
 */
import type { FormEvent, ReactNode } from 'react'

export interface CatalogEditorFormShellProps {
  /** Test id del formulario. */
  testId: string
  /** Test id del botón guardar. */
  submitTestId: string
  /** Test id del botón cancelar. */
  cancelTestId: string
  /** Test id del mensaje de error. */
  errorTestId: string
  /** Texto del botón guardar. */
  submitLabel: string
  /** Texto del botón cancelar. */
  cancelLabel: string
  /** ¿Hay guardado en curso? */
  busy: boolean
  /** ¿El formulario puede enviarse? */
  canSubmit: boolean
  /** Error del guardado, si lo hay. */
  error: string | null
  /** Clase del contenedor de acciones. */
  actionsClassName: string
  /** Clase del botón guardar. */
  submitClassName: string
  /** Clase del botón cancelar. */
  cancelClassName: string
  /** Envío del formulario. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  /** Cancelación del formulario. */
  onCancel: () => void
  /** Campos del formulario. */
  children: ReactNode
}

/**
 * Renderiza el esqueleto común de un formulario de catálogo.
 * @param props Identificadores, textos, estado y campos.
 * @returns Formulario de catálogo.
 */
export function CatalogEditorFormShell({
  testId,
  submitTestId,
  cancelTestId,
  errorTestId,
  submitLabel,
  cancelLabel,
  busy,
  canSubmit,
  error,
  actionsClassName,
  submitClassName,
  cancelClassName,
  onSubmit,
  onCancel,
  children,
}: CatalogEditorFormShellProps) {
  return (
    <form className="flu-settings-section" onSubmit={onSubmit} data-testid={testId}>
      <div className="flu-settings-section__body">
        {children}
        {error && (
          <p className="flu-settings-image-config__error" data-testid={errorTestId}>
            {error}
          </p>
        )}
        <div className={actionsClassName}>
          <button
            type="submit"
            className={submitClassName}
            data-testid={submitTestId}
            disabled={busy || !canSubmit}
          >
            {submitLabel}
          </button>
          <button
            type="button"
            className={cancelClassName}
            data-testid={cancelTestId}
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
