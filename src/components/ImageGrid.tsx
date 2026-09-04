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
import type { SearchResult } from '../core/search/searchSession';

export interface ImageGridProps {
    /** Resultados de imágenes ya normalizados por el proxy. */
    results: SearchResult[];
    /** Mientras carga se devuelve null (la barra muestra su estado). */
    loading: boolean;
}

interface ImageGridUi {
    openImageLabel: string;
    emptyImages: string;
    sourceCommons: string;
}

/** Etiquetas de la cuadrícula desde FLU_CONFIG.browser.search.ui. */
function useImageGridUi(): ImageGridUi {
    return useMemo(() => {
        const cfg = (FLU_CONFIG as any).browser?.search?.ui || {};
        return {
            openImageLabel: cfg.openImageLabel || 'Abrir imagen',
            emptyImages: cfg.emptyImages || 'No encontré imágenes para esta búsqueda.',
            sourceCommons: cfg.sourceCommons || 'Wikimedia Commons',
        };
    }, []);
}

/** Etiqueta legible por proveedor (config-driven). */
function sourceLabel(source: string | undefined, ui: ImageGridUi): string {
    if (source === 'commons') return ui.sourceCommons;
    return source || '';
}

export function ImageGrid({ results, loading }: ImageGridProps) {
    const ui = useImageGridUi();

    if (loading) return null;

    if (!Array.isArray(results) || results.length === 0) {
        return <p className="workspace-search__empty">{ui.emptyImages}</p>;
    }

    return (
        <ul className="workspace-search__grid" aria-label={ui.openImageLabel}>
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
