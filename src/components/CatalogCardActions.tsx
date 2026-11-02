/**
 * CatalogCardActions — acciones ÚNICAS de una tarjeta de catálogo.
 *
 * Dueño de activar/clonar/editar/eliminar de una tarjeta. Los paneles aportan
 * sus etiquetas y sus callbacks; no repiten los cuatro botones.
 */

export interface CatalogCardActionLabels {
  /** Etiqueta cuando la tarjeta está activa. */
  active?: string
  /** Etiqueta de activar. */
  activate?: string
  /** Etiqueta de clonar. */
  clone?: string
  /** Etiqueta de editar. */
  edit?: string
  /** Etiqueta de eliminar. */
  remove?: string
}

export interface CatalogCardActionsProps {
  /** Familia del catálogo (clases CSS). */
  kind: 'ambientes' | 'paletas'
  /** Id de la entrada. */
  id: string
  /** ¿Es la entrada activa? */
  active: boolean
  /** ¿Es una entrada fija (builtin)? */
  fixed: boolean
  /** Etiquetas de las acciones. */
  labels: CatalogCardActionLabels
  /** Activar la entrada. */
  onActivate: () => void
  /** Clonar la entrada fija. */
  onClone: () => void
  /** Editar la entrada dinámica. */
  onEdit: () => void
  /** Eliminar la entrada dinámica. */
  onRemove: () => void
}

/**
 * Renderiza las acciones de una tarjeta de catálogo.
 * @param props Familia, id, estado, etiquetas y callbacks.
 * @returns Botones de la tarjeta.
 */
export function CatalogCardActions({
  kind,
  id,
  active,
  fixed,
  labels,
  onActivate,
  onClone,
  onEdit,
  onRemove,
}: CatalogCardActionsProps) {
  const prefix = kind === 'ambientes' ? 'ambiente' : 'paleta'
  const text = {
    active: labels.active || (kind === 'paletas' ? 'Activa' : 'Activo'),
    activate: labels.activate || 'Activar',
    clone: labels.clone || 'Clonar',
    edit: labels.edit || 'Editar',
    remove: labels.remove || 'Eliminar',
  }
  return (
    <div className={`flu-${kind}-card__actions`}>
      <button
        type="button"
        className={`flu-${kind}-card__activate`}
        data-testid={`${prefix}-activate-${id}`}
        disabled={active}
        onClick={onActivate}
      >
        {active ? text.active : text.activate}
      </button>
      {fixed ? (
        <button
          type="button"
          className={`flu-${kind}-card__clone`}
          data-testid={`${prefix}-clone-${id}`}
          onClick={onClone}
        >
          {text.clone}
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`flu-${kind}-card__edit`}
            data-testid={`${prefix}-edit-${id}`}
            onClick={onEdit}
          >
            {text.edit}
          </button>
          <button
            type="button"
            className={`flu-${kind}-card__remove`}
            data-testid={`${prefix}-remove-${id}`}
            onClick={onRemove}
          >
            {text.remove}
          </button>
        </>
      )}
    </div>
  )
}
