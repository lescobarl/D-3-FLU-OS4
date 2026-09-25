// ============================================================
// ImageGrid.tsx — Cuadrícula de imágenes del Pizarrón (F4)
// ------------------------------------------------------------
// Muestra los resultados de imágenes (Wikimedia Commons,
// Openverse si se agrega) en una cuadrícula responsive de
// miniaturas. Cada miniatura enlaza al archivo original en una
// pestaña nueva (target _blank).
//
// Consume useWorkspaceSearch.state.images (SearchResult[]).
//
// Regla #1: sin hardcode — todas las etiquetas vienen de
// FLU_CONFIG.browser.search.ui con fallback || '...'.
// ============================================================

import { useMemo } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { configLabel } from './configText';
import { pickLabel } from '../lib/textUtils';
import type { SearchResult } from '../core/search/searchSession';

/** Celda IA generada: primera miniatura del grid (click = ampliar overlay). */
export interface GeneratedGridCell {
    title: string;
    imageUrl: string | null;
    isLoading: boolean;
    isFailed: boolean;
    /** Cache-buster de la URL (Pollinations es stateless). */
    loadAttempt: number;
    /** Ampliar imagen (overlay del hub). */
    onExpand: () => void;
    /** Reintentar generación tras fallo. */
    onRetry: () => void;
    /** La imagen cargó: limpia el watchdog de 30 s (sin esto marca fallo falso). */
    onLoaded?: () => void;
    /** La imagen falló al cargar: reintenta la misma URL (no regenera). */
    onLoadFailed?: () => void;
}

export interface ImageGridProps {
    /** Resultados de imágenes ya normalizados por el proxy. */
    results: SearchResult[];
    /** Mientras carga se devuelve null (la barra muestra su estado). */
    loading: boolean;
    /** Celda IA opcional: se muestra como PRIMERA miniatura del mismo grid. */
    generated?: GeneratedGridCell | null;
    /** Idioma para resolver etiquetas bilingües (es/en). */
    language?: string;
}

interface ImageGridUi {
    openImageLabel: string;
    emptyImages: string;
    sourceCommons: string;
    retryLabel: string;
    expandGeneratedLabel: string;
}

/** Etiquetas de la cuadrícula desde FLU_CONFIG.browser.search.ui. */
function useImageGridUi(language: string): ImageGridUi {
    return useMemo(() => {
        const cfg = FLU_CONFIG.browser?.search?.ui || {};
        const wsUi = FLU_CONFIG.ui?.workspace || {};
        return {
            openImageLabel: pickLabel(configLabel(cfg, 'openImageLabel'), language, 'Abrir imagen'),
            emptyImages: pickLabel(configLabel(cfg, 'emptyImages'), language, 'No encontré imágenes para esta búsqueda.'),
            sourceCommons: pickLabel(configLabel(cfg, 'sourceCommons'), language, 'Wikimedia Commons'),
            // imageRetryLabel/imageExpandLabel son {es,en}: resolver SIEMPRE con pickLabel.
            retryLabel: pickLabel(wsUi.imageRetryLabel, language, 'Reintentar'),
            expandGeneratedLabel: pickLabel(wsUi.imageExpandLabel, language, 'Ampliar imagen generada'),
        };
    }, [language]);
}

/** Etiqueta legible por proveedor (config-driven). */
function sourceLabel(source: string | undefined, ui: ImageGridUi): string {
    if (source === 'commons') return ui.sourceCommons;
    return source || '';
}

export function ImageGrid({ results, loading, generated, language = 'es' }: ImageGridProps) {
    const ui = useImageGridUi(language);

    if (loading && !generated?.imageUrl) return null;

    const hasGenerated = Boolean(generated && (generated.imageUrl || generated.isLoading || generated.isFailed));
    const hasWeb = Array.isArray(results) && results.length > 0;

    if (!hasGenerated && !hasWeb) {
        return <p className="workspace-search__empty">{ui.emptyImages}</p>;
    }

    return (
        <ul className="workspace-search__grid" aria-label={ui.openImageLabel}>
            {hasGenerated && generated && (
                <li
                    className="workspace-search__grid-item workspace-search__grid-item--generated"
                    data-testid="workspace-search-cell-ia-imagen"
                >
                    {generated.isFailed ? (
                        <div className="workspace-search__grid-link workspace-search__grid-link--ia-error">
                            <span className="workspace-search__grid-fallback" aria-hidden="true">
                                🖼️
                            </span>
                            <span className="workspace-search__grid-caption">
                                <span className="workspace-search__grid-title">
                                    {generated.title || ui.openImageLabel}
                                </span>
                                <button
                                    type="button"
                                    className="flu-btn flu-btn--small"
                                    onClick={generated.onRetry}
                                >
                                    {ui.retryLabel}
                                </button>
                            </span>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="workspace-search__grid-link workspace-search__grid-link--ia"
                            onClick={() => {
                                if (generated.imageUrl) generated.onExpand();
                            }}
                            title={ui.expandGeneratedLabel}
                            data-load-attempt={generated.loadAttempt}
                        >
                            {generated.imageUrl ? (
                                <img
                                    className="workspace-search__grid-img"
                                    src={
                                        generated.imageUrl.startsWith('data:') || generated.imageUrl.startsWith('blob:')
                                            ? generated.imageUrl
                                            : `${generated.imageUrl}${generated.imageUrl.includes('?') ? '&' : '?'}retry=${generated.loadAttempt}`
                                    }
                                    alt={generated.title || ui.openImageLabel}
                                    loading="lazy"
                                    onLoad={() => generated.onLoaded?.()}
                                    onError={() => generated.onLoadFailed?.()}
                                />
                            ) : (
                                <span className="workspace-search__grid-fallback" aria-hidden="true">
                                    🖼️
                                </span>
                            )}
                            {generated.isLoading && (
                                <span className="workspace-search__grid-loading">Generando…</span>
                            )}
                            <span className="workspace-search__grid-caption">
                                <span className="workspace-search__grid-title">
                                    {generated.title || ui.openImageLabel}
                                </span>
                                <span className="workspace-search__grid-source">IA</span>
                            </span>
                        </button>
                    )}
                </li>
            )}
            {results.map((item: SearchResult, index: number) => {
                const href = item.fileUrl || item.url || '';
                const thumb = item.thumbnail || '';
                const title = item.title || '';
                return (
                    <li key={`${item.host}-${index}-${href}`} className="workspace-search__grid-item">
                        <a
                            className="workspace-search__grid-link"
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${ui.openImageLabel}: ${title}`}
                        >
                            {thumb ? (
                                <img
                                    className="workspace-search__grid-img"
                                    src={thumb}
                                    alt={title}
                                    loading="lazy"
                                />
                            ) : (
                                <span className="workspace-search__grid-fallback" aria-hidden="true">
                                    🖼️
                                </span>
                            )}
                            <span className="workspace-search__grid-caption">
                                <span className="workspace-search__grid-title">{title}</span>
                                <span className="workspace-search__grid-source">
                                    {sourceLabel(item.source, ui)}
                                </span>
                            </span>
                        </a>
                    </li>
                );
            })}
        </ul>
    );
}
