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

import { MediaResultItem } from './MediaResultItem';
import { useMemo } from 'react';
import { FLU_CONFIG } from '../voice/api/config';
import { SEARCH_PROVIDER_IDS } from '../core/config/sharedConfig';
import type { SearchResult } from '../core/search/searchSession';
import { sourceLabelFor } from '../lib/sourceLabel';

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

export function VideoGrid({ results, loading }: VideoGridProps) {
    const ui = useVideoGridUi();
    const sourceLabels: Record<string, string> = {
        [SEARCH_PROVIDER_IDS.YOUTUBE]: ui.sourceYouTube,
        [SEARCH_PROVIDER_IDS.COMMONS_VIDEO]: ui.sourceCommons,
        [SEARCH_PROVIDER_IDS.INVIDIOUS]: ui.sourceInvidious,
    };

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
                    <MediaResultItem
                        key={`${item.host}-${index}-${href}`}
                        kind="video"
                        href={href}
                        thumb={thumb}
                        title={title}
                        label={ui.openVideoLabel}
                        sourceText={sourceLabelFor(item.source, sourceLabels)}
                        suffix={ui.playLabel}
                        imageClassName="workspace-search__video-img"
                        fallback="🎬"
                    />
                );
            })}
        </ul>
    );
}
