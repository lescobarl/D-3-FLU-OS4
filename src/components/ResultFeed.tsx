// ============================================================
// ResultFeed — Feed de resultados unificado del Pizarrón (Paso 3)
// ------------------------------------------------------------
// Consolida las tarjetas WEB / IA / OCR en una sola lista.
// Cada tarjeta lleva una insignia de color de origen:
//   🟢 WEB  → origen 'web'
//   🔵 IA   → origen 'ia'
//   ⚪ OCR  → origen 'ocr'
// Filtro superior por TIPO (Todo | Imágenes | Doc/Video) — nunca
// por origen (el origen es solo informativo, no un filtro).
//
// Componente presentacional controlado: recibe los ítems ya
// construidos por props (patrón de AgendaHub / WorkspaceHub).
// NO hace fetching propio. Las etiquetas vienen de FLU_CONFIG
// con pickLabel (Regla #1: sin hardcode).
// ============================================================
import { useMemo, useState, type ReactNode } from 'react';
import { pickLabel } from '../lib/textUtils';
import { FLU_CONFIG } from '../voice/lib/fluConfig';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

/** Origen de la tarjeta (informativo → insignia de color). */
export type ResultOrigin = 'web' | 'ia' | 'ocr';

/** Tipo de contenido (filtro superior del feed). */
export type ResultKind = 'text' | 'image' | 'doc' | 'video';

/** Filtro por tipo visible en la cabecera del feed. */
export type ResultFeedFilter = 'all' | 'image' | 'video' | 'doc';

/** Filtro inicial derivado del contenido: si hay video → Vídeos, si hay
 *  imagen → Imágenes, si no → Todo. */
function pickInitialFilter(list: ResultFeedItem[]): ResultFeedFilter {
  if (list.some((item) => item.onlyInKind && item.kind === 'video')) return 'video';
  if (list.some((item) => item.onlyInKind && item.kind === 'image')) return 'image';
  return 'all';
}

/** Un ítem del feed: origen + tipo + título + cuerpo ya renderizado. */
export interface ResultFeedItem {
  id: string;
  origin: ResultOrigin;
  kind: ResultKind;
  title: string;
  body: ReactNode;
  /**
   * Cuando es true, la tarjeta SOLO aparece bajo el filtro de su tipo
   * (p. ej. "Imágenes"), nunca en "Todo". Útil para contenido generado
   * por IA que no debe intercalarse bajo la respuesta de texto.
   */
  onlyInKind?: boolean;
}

export interface ResultFeedProps {
  /** Ítems del feed (tarjetas ya construidas por el padre). */
  items: ResultFeedItem[];
  /** Etiqueta de cabecera del feed. */
  title?: string;
  /** Idioma actual para etiquetas bilingües (es/en). */
  language?: string;
}

// ------------------------------------------------------------
// ------------------------------------------------------------
// Componente
// ------------------------------------------------------------
export function ResultFeed({
  items,
  title,
  language = 'es',
}: ResultFeedProps) {
  const [filter, setFilter] = useState<ResultFeedFilter>(() => pickInitialFilter(items));

  // Etiquetas de la UI (Regla #1: sin hardcode).
  const ui = FLU_CONFIG.ui?.workspace || {};
  const feedTitle =
    title ||
    pickLabel(
      (FLU_CONFIG as any).ui?.workspace?.feedTitle,
      language,
      'Resultados'
    );
  // El usuario pidió quitar el texto de estado vacío del Pizarrón:
  // cuando no hay resultados no se muestra ningún mensaje.
  const filterAll =
    pickLabel((FLU_CONFIG as any).ui?.workspace?.feedFilterAll, language, 'Todo');
  const filterImages =
    pickLabel((FLU_CONFIG as any).ui?.workspace?.feedFilterImages, language, 'Imágenes');
  const filterVideo =
    pickLabel((FLU_CONFIG as any).ui?.workspace?.feedFilterVideo, language, 'Vídeos');
  const filterDoc =
    pickLabel((FLU_CONFIG as any).ui?.workspace?.feedFilterDoc, language, 'Documentos');

  // Etiquetas de origen (insignias).
  const originWeb = pickLabel(ui.origenWebLabel, language, 'Web');
  const originIa = pickLabel(ui.origenIaLabel, language, 'IA');
  const originOcr = pickLabel(
    (FLU_CONFIG as any).ui?.workspace?.origenOcrLabel,
    language,
    'OCR'
  );

  // Un ítem entra en el filtro "doc" si es documento o video.
  // Un ítem marcado `onlyInKind` SOLO se muestra con su filtro de tipo
  // activo (nunca en "Todo"): evita que contenido de imagen generada se
  // intercale bajo la Respuesta de Flu en la vista general del pizarrón.
  const matchesFilter = (item: ResultFeedItem): boolean => {
    if (filter === 'all') return !item.onlyInKind;
    if (filter === 'image') return item.kind === 'image';
    if (filter === 'video') return item.kind === 'video';
    return item.kind === 'doc';
  };

  const visible = useMemo(
    () => items.filter(matchesFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filter]
  );

  const originLabel = (origin: ResultOrigin): string => {
    if (origin === 'web') return originWeb;
    if (origin === 'ia') return originIa;
    return originOcr;
  };

  const originClass = (origin: ResultOrigin): string => {
    if (origin === 'web') return 'result-feed__badge--web';
    if (origin === 'ia') return 'result-feed__badge--ia';
    return 'result-feed__badge--ocr';
  };

  const filterBtn = (
    value: ResultFeedFilter,
    label: string
  ): ReactNode => (
    <button
      key={value}
      type="button"
      className={`result-feed__filter${filter === value ? ' result-feed__filter--active' : ''}`}
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      data-filter={value}
    >
      {label}
    </button>
  );

  return (
    <section className="result-feed" data-testid="result-feed">
      <header className="result-feed__header">
        <h4 className="result-feed__title">{feedTitle}</h4>
        <div className="result-feed__filters" role="group" aria-label="Filtrar por tipo">
          {filterBtn('all', filterAll)}
          {filterBtn('image', filterImages)}
          {filterBtn('video', filterVideo)}
          {filterBtn('doc', filterDoc)}
        </div>
      </header>

      {visible.length === 0 ? null : (
        <ul className="result-feed__list" data-testid="result-feed-list">
          {visible.map((item) => (
            <li
              key={item.id}
              className="result-feed__card"
              data-origin={item.origin}
              data-kind={item.kind}
              data-testid={`result-feed-card-${item.id}`}
            >
              <div className="result-feed__card-head">
                <span
                  className={`result-feed__badge ${originClass(item.origin)}`}
                  title={originLabel(item.origin)}
                >
                  {originLabel(item.origin)}
                </span>
                <span className="result-feed__card-title">{item.title}</span>
              </div>
              <div className="result-feed__card-body">{item.body}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ResultFeed;
