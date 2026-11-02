/**
 * CatalogPanelShell — estructura ÚNICA externa de un panel de catálogo.
 *
 * Dueño del contenedor, el editor, el aviso, el botón de crear y el grid.
 * Los paneles de ambientes y paletas aportan sus textos, su editor y sus
 * tarjetas; no repiten esta estructura.
 */
import type { ReactNode } from 'react'
import { SettingsPanelShell } from './SettingsPanelShell'

export interface CatalogPanelShellProps {
  /** Título del panel. */
  title: ReactNode
  /** Editor abierto, o null. */
  editor: ReactNode
  /** Aviso cuando no hay editor. */
  hint: string
  /** Clase del aviso. */
  hintClassName: string
  /** Texto del botón crear. */
  createLabel: string
  /** Clase del botón crear. */
  createClassName: string
  /** Test id del botón crear. */
  createTestId: string
  /** Acción de crear. */
  onCreate: () => void
  /** Clase del grid de tarjetas. */
  gridClassName: string
  /** Tarjetas del catálogo. */
  children: ReactNode
}

/**
 * Renderiza la estructura externa del panel de catálogo.
 * @param props Título, editor, aviso, creación y tarjetas.
 * @returns Panel de catálogo.
 */
export function CatalogPanelShell({
  title,
  editor,
  hint,
  hintClassName,
  createLabel,
  createClassName,
  createTestId,
  onCreate,
  gridClassName,
  children,
}: CatalogPanelShellProps) {
  return (
    <SettingsPanelShell title={title}>
      {editor || (
        <>
          <p className={hintClassName}>{hint}</p>
          <button
            type="button"
            className={createClassName}
            data-testid={createTestId}
            onClick={onCreate}
          >
            {createLabel}
          </button>
          <div className={gridClassName}>{children}</div>
        </>
      )}
    </SettingsPanelShell>
  )
}
