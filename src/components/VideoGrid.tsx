// ============================================================
// VideoGrid.tsx — Cuadrícula de vídeo del Pizarrón (F4)
// ------------------------------------------------------------
// Muestra los resultados de vídeo (Commons vídeo, YouTube con
// key, Invidious) en tarjetas con miniatura + overlay de play.
// Cada tarjeta enlaza a la URL de reproducción (watch) en una
// pestaña nueva (target _blank).
//
// Consume useWorkspaceSearch.state.video (SearchResult[]).
//
// Regla #1: sin hardcode — todas las etiquetas vienen de
// FLU_CONFIG.browser.search.ui con fallback || '...'.
// ============================================================

import { useMemo } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { SearchResult } from '../core/search/searchSession';

export interface VideoGridProps {
    /** Resultados de vídeo ya normalizados por el proxy. */
    results: SearchResult[];
    /** Mientras carga se devuelve null (la barra muestra su estado). */
    loading: boolean;
}

interface VideoGridUi {
    openVideoLabel: string;
    playLabel: string;
    emptyVideo: string;
    sourceYouTube: string;
    sourceCommons: string;
    sourceInvidious: string;
}

/** Etiquetas de la cuadrícula desde FLU_CONFIG.browser.search.ui. */
function useVideoGridUi(): VideoGridUi {
    return useMemo(() => {
        const cfg = FLU_CONFIG.browser?.search?.ui || {};
        return {
            openVideoLabel: cfg.openVideoLabel || 'Abrir vídeo',
            playLabel: cfg.playLabel || 'Reproducir',
            emptyVideo: cfg.emptyVideo || 'No encontré vídeos para esta búsqueda.',
            sourceYouTube: cfg.sourceYouTube || 'YouTube',
            sourceCommons: cfg.sourceCommons || 'Wikimedia Commons',
            sourceInvidious: cfg.sourceInvidious || 'Invidious',
        };
    }, []);
}

/** Etiqueta legible por proveedor (config-driven). */
function sourceLabel(source: string | undefined, ui: VideoGridUi): string {
    if (source === 'youtube') return ui.sourceYouTube;
    if (source === 'commons-video') return ui.sourceCommons;
    if (source === 'invidious') return ui.sourceInvidious;
    return source || '';
}

export function VideoGrid({ results, loading }: VideoGridProps) {
    const ui = useVideoGridUi();

    if (loading) return null;

    if (!Array.isArray(results) || results.length === 0) {
        return <p className="workspace-search__empty">{ui.emptyVideo}</p>;
    }

    return (
        <ul className="workspace-search__video-grid" aria-label={ui.openVideoLabel}>
            {results.map((item: SearchResult, index: number) => {
                const href = item.url || item.embedUrl || '';
                const thumb = item.thumbnail || '';
                const title = item.title || '';
                return (
                    <li
                        key={`${item.host}-${index}-${href}`}
                        className="workspace-search__video-item"
                    >
                        <a
                            className="workspace-search__video-link"
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${ui.openVideoLabel}: ${title}`}
                        >
                            <span className="workspace-search__video-thumb">
                                {thumb ? (
                                    <img
                                        className="workspace-search__video-img"
                                        src={thumb}
                                        alt={title}
                                        loading="lazy"
                                    />
                                ) : (
                                    <span className="workspace-search__grid-fallback" aria-hidden="true">
                                        🎬
                                    </span>
                                )}
                                <span className="workspace-search__video-play" aria-hidden="true">
                                    ▶
                                </span>
                            </span>
                            <span className="workspace-search__video-caption">
                                <span className="workspace-search__video-title">{title}</span>
                                <span className="workspace-search__video-source">
                                    {sourceLabel(item.source, ui)} · {ui.playLabel}
                                </span>
                            </span>
                        </a>
                    </li>
                );
            })}
        </ul>
    );
}
