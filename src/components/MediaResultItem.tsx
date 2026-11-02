/**
 * MediaResultItem — tarjeta ÚNICA de un resultado de imagen o vídeo.
 *
 * Dueño del enlace, la miniatura, el fallback y la leyenda que repetían los
 * grids de imagen y vídeo. Los paneles aportan los datos y el tipo.
 */

export interface MediaResultItemProps {
  /** Tipo de resultado. */
  kind: 'image' | 'video'
  /** URL de apertura. */
  href: string
  /** Miniatura (puede faltar). */
  thumb: string
  /** Título del resultado. */
  title: string
  /** Etiqueta de apertura. */
  label: string
  /** Texto de la fuente. */
  sourceText: string
  /** Sufijo de la leyenda (p. ej. "Reproducir"). */
  suffix?: string
  /** Clase de la imagen. */
  imageClassName: string
  /** Emoji si no hay miniatura. */
  fallback: string
}

/**
 * Renderiza la tarjeta de un resultado multimedia.
 * @param props Tipo, datos y textos.
 * @returns Elemento de la lista.
 */
export function MediaResultItem({
  kind,
  href,
  thumb,
  title,
  label,
  sourceText,
  suffix,
  imageClassName,
  fallback,
}: MediaResultItemProps) {
  const base = kind === 'image' ? 'grid' : 'video'
  return (
    <li className={`workspace-search__${base}-item`}>
      <a
        className={`workspace-search__${base}-link`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={`${label}: ${title}`}
      >
        {kind === 'video' ? (
          <span className="workspace-search__video-thumb">
            {thumb ? (
              <img
                className={imageClassName}
                src={thumb}
                alt={title}
                loading="lazy"
              />
            ) : (
              <span className="workspace-search__grid-fallback" aria-hidden="true">
                {fallback}
              </span>
            )}
            <span className="workspace-search__video-play" aria-hidden="true">
              ▶
            </span>
          </span>
        ) : thumb ? (
          <img
            className={imageClassName}
            src={thumb}
            alt={title}
            loading="lazy"
          />
        ) : (
          <span className="workspace-search__grid-fallback" aria-hidden="true">
            {fallback}
          </span>
        )}
        <span className={`workspace-search__${base}-caption`}>
          <span className={`workspace-search__${base}-title`}>{title}</span>
          <span className={`workspace-search__${base}-source`}>
            {sourceText}
            {suffix ? ` · ${suffix}` : ''}
          </span>
        </span>
      </a>
    </li>
  )
}
