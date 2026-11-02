/**
 * CatalogCardShell — envoltura ÚNICA de una tarjeta de catálogo.
 *
 * Dueño del artículo, la vista previa, el cuerpo y las acciones. Los paneles
 * aportan el contenido de la vista previa, el cuerpo y sus acciones.
 */
import type { CSSProperties, ReactNode } from 'react'

export interface CatalogCardShellProps {
  /** Familia del catálogo (clases CSS). */
  kind: 'ambientes' | 'paletas'
  /** Id de la entrada. */
  id: string
  /** ¿Es la entrada activa? */
  active: boolean
  /** Estilo del artículo (variables del tema). */
  style?: CSSProperties
  /** Etiqueta accesible de la vista previa. */
  previewAria: string
  /** Contenido de la vista previa. */
  preview: ReactNode
  /** Acciones de la tarjeta. */
  actions: ReactNode
  /** Cuerpo de la tarjeta. */
  children: ReactNode
}

/**
 * Renderiza la envoltura de una tarjeta de catálogo.
 * @param props Familia, id, estado, vista previa, acciones y cuerpo.
 * @returns Tarjeta de catálogo.
 */
export function CatalogCardShell({
  kind,
  id,
  active,
  style,
  previewAria,
  preview,
  actions,
  children,
}: CatalogCardShellProps) {
  const prefix = kind === 'ambientes' ? 'ambiente' : 'paleta'
  return (
    <article
      className={`flu-${kind}-card${active ? ' is-active' : ''}`}
      data-testid={`${prefix}-card-${id}`}
      style={style}
    >
      <div className={`flu-${kind}-card__preview`} aria-label={previewAria}>
        {preview}
      </div>
      <div className={`flu-${kind}-card__body`}>{children}</div>
      {actions}
    </article>
  )
}
