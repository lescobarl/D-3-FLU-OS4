// ============================================================
// FluCollapsibleCard — Tarjeta plegable del Pizarrón
// ------------------------------------------------------------
// Tarjeta colapsable construida con <details>/<summary> nativos
// (accesible). Agrupa las secciones del pizarrón: respuesta,
// imagen, horario, análisis, generación y subida.
//
// Cumple:
//   - Rule #1: NO HARDCODE — el título y los mensajes llegan por
//     props resueltos desde FLU_CONFIG.ui.workspace (App).
//   - El estado abierto/cerrado es controlado por React mediante la
//     prop `open` (React no soporta `defaultOpen` en <details>).
//     Se inicializa desde `empty` y se sincroniza cuando `empty`
//     cambia, de modo que una tarjeta con contenido se abre sola y
//     una vacía se muestra colapsada. El usuario puede plegar o
//     desplegar con el header vía el evento `onToggle`.
// ============================================================
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface FluCollapsibleCardProps {
  /** Título de la tarjeta (resuelto por idioma por el llamador). */
  title: string;
  /** Emoji/icono opcional que precede al título. */
  icon?: string;
  /** Badge opcional (p. ej. "3 clases") junto al título. */
  badge?: string;
  /** Mensaje amigable mostrado cuando la tarjeta está vacía. */
  emptyMessage?: string;
  /** Si es true la tarjeta se muestra colapsada con emptyMessage. */
  empty?: boolean;
  /** Resalta la tarjeta con borde de color (zona de subida). */
  highlighted?: boolean;
  /** Contenido cuando la tarjeta no está vacía. */
  children?: ReactNode;
  /** Clase extra opcional. */
  className?: string;
}

export function FluCollapsibleCard({
  title,
  icon,
  badge,
  emptyMessage,
  empty = false,
  highlighted = false,
  children,
  className,
}: FluCollapsibleCardProps) {
  const [isOpen, setIsOpen] = useState(!empty);

  // Cuando `empty` cambia (p. ej. llega contenido nuevo), la tarjeta
  // se abre sola si tiene contenido o se colapsa si quedó vacía.
  useEffect(() => {
    setIsOpen(!empty);
  }, [empty]);

  const classes = [
    'flu-card',
    empty ? 'flu-card--empty' : 'flu-card--open',
    highlighted ? 'flu-card--highlighted' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <details
      className={classes}
      open={isOpen}
      onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flu-card__header">
        <span className="flu-card__title">
          {icon && <span className="flu-card__icon" aria-hidden="true">{icon}</span>}
          <span className="flu-card__title-text">{title}</span>
          {badge && <span className="flu-badge">{badge}</span>}
        </span>
        <span className="flu-card__chev" aria-hidden="true">▶</span>
      </summary>
      <div className="flu-card__body">
        {empty ? (
          <p className="flu-card__empty">{emptyMessage || '\u00a0'}</p>
        ) : (
          children
        )}
      </div>
    </details>
  );
}

export default FluCollapsibleCard;
