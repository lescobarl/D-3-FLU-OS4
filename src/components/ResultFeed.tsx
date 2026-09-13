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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pickLabel } from '../lib/textUtils';
import { FLU_CONFIG } from '../voice/lib/fluConfig';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

/** Origen de la tarjeta (informativo → insignia de color). */
export type ResultOrigin = 'web' | 'ia' | 'ocr';

/** Tipo de contenido (filtro superior del feed). */
export type ResultKind = 'text' | 'image' | 'doc' | 'video' | 'history';

/** Filtro por tipo visible en la cabecera del feed. */
export type ResultFeedFilter = 'all' | 'image' | 'media' | 'history';

/** Foco solicitado por el padre (artefacto recién creado). */
export type ResultFeedFocusKind = 'video' | 'doc' | 'image' | null;

/** Traduce el tipo de artefacto a la pestaña que debe abrirse. */
function filterForKind(kind: ResultFeedFocusKind): ResultFeedFilter {
  if (kind === 'image') return 'image';
  if (kind === 'video' || kind === 'doc') return 'media';
  return 'all';
}

/** Filtro inicial derivado del contenido: video o documento → "Video/Docs",
 *  imagen → "Imágenes", historial → "Historial", si no → Todo. Prioridad
 *  video > imagen > doc > historial. */
function pickInitialFilter(list: ResultFeedItem[]): ResultFeedFilter {
  if (list.some((item) => item.onlyInKind && item.kind === 'video')) return 'media';
  if (list.some((item) => item.onlyInKind && item.kind === 'image')) return 'image';
  if (list.some((item) => item.onlyInKind && item.kind === 'doc')) return 'media';
  if (list.some((item) => item.onlyInKind && item.kind === 'history')) return 'history';
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
  /**
   * Artefacto recién creado por el turno (video/doc/imagen). Cuando CAMBIA,
   * el feed salta a la pestaña correspondiente sin pisar la elección manual
   * si no hay artefacto nuevo. `null` = sin foco.
   */
  focusKind?: ResultFeedFocusKind;
}

// ------------------------------------------------------------
// ------------------------------------------------------------
// Componente
// ------------------------------------------------------------
export function ResultFeed({
  items,
  title,
  language = 'es',
  focusKind = null,
}: ResultFeedProps) {
  const [filter, setFilter] = useState<ResultFeedFilter>(() => pickInitialFilter(items));

  // Foco en caliente: cuando llega un artefacto NUEVO (focusKind cambia de
  // null a su tipo), el feed salta a su pestaña. No pisa la elección manual
  // porque solo actúa cuando el tipo enfocado cambia.
  const lastFocusRef = useRef<ResultFeedFocusKind>(null);
  useEffect(() => {
    if (!focusKind) {
      lastFocusRef.current = null;
      return;
    }
    if (lastFocusRef.current !== focusKind) {
      setFilter(filterForKind(focusKind));
      lastFocusRef.current = focusKind;
    }
  }, [focusKind]);

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
  const filterMedia =
    pickLabel((FLU_CONFIG as any).ui?.workspace?.feedFilterMedia, language, 'Video/Docs');
  const filterHistory =
    pickLabel((FLU_CONFIG as any).ui?.workspace?.feedFilterHistory, language, 'Historial');

  // Etiquetas de origen (insignias).
  const originWeb = pickLabel(ui.origenWebLabel, language, 'Web');
  const originIa = pickLabel(ui.origenIaLabel, language, 'IA');
  const originOcr = pickLabel(
    (FLU_CONFIG as any).ui?.workspace?.origenOcrLabel,
    language,
    'OCR'
  );

  // Un ítem entra en "Video/Docs" si es documento o video. Un ítem marcado
  // `onlyInKind` SOLO se muestra con su filtro de tipo activo (nunca en
  // "Todo"): evita que contenido generado se intercale bajo la Respuesta de
  // Flu en la vista general del pizarrón.
  const matchesFilter = (item: ResultFeedItem): boolean => {
    if (filter === 'all') return !item.onlyInKind;
    if (filter === 'image') return item.kind === 'image';
    if (filter === 'media') return item.kind === 'doc' || item.kind === 'video';
    return item.kind === 'history';
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
          {filterBtn('media', filterMedia)}
          {filterBtn('history', filterHistory)}
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
