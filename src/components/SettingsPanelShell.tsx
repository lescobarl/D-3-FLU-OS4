/**
 * SettingsPanelShell — contenedor ÚNICO de un panel de ajustes plegable.
 *
 * Dueño de la envoltura `details` + `summary` + grupo de los paneles de ajustes.
 * Todos los paneles de configuración lo consumen en vez de repetir el marcado.
 */
import type { ReactNode } from 'react'

export interface SettingsPanelShellProps {
  /** Título del panel (texto o nodo). */
  title: ReactNode
  /** ¿Abierto por defecto? */
  open?: boolean
  /** Clase extra del summary (variantes visuales). */
  summaryClassName?: string
  /** Si se indica, envuelve el grupo en un contenedor `body` con esa clase. */
  bodyClassName?: string
  /** Si es true, no se añade el grupo: el contenido va directo al body. */
  noGroup?: boolean
  /** Si es true, el contenido ya trae sus propias envolturas (solo details+summary). */
  bare?: boolean
  /** Contenido del panel. */
  children: ReactNode
}

/**
 * Renderiza el contenedor plegable de un panel de ajustes.
 * @param props Título, apertura, clases y contenido.
 * @returns Panel de ajustes.
 */
export function SettingsPanelShell({
  title,
  open = false,
  summaryClassName,
  bodyClassName,
  noGroup = false,
  bare = false,
  children,
}: SettingsPanelShellProps) {
  const content = bare ? (
    children
  ) : noGroup ? (
    children
  ) : (
    <div className="flu-settings-image-config__group">{children}</div>
  )
  return (
    <details className="flu-settings-image-config" open={open || undefined}>
      <summary
        className={
          summaryClassName || 'flu-settings-image-config__summary'
        }
      >
        {title}
      </summary>
      {bodyClassName ? <div className={bodyClassName}>{content}</div> : content}
    </details>
  )
}
