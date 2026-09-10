// ============================================================
// WorkspaceSearch.tsx — Barra de comandos del Pizarrón (Sección 1)
// ------------------------------------------------------------
// En el diseño "Pizarrón Un Solo Objeto" la búsqueda es una BARRA
// DE COMANDOS pura: [🔍 Buscá algo…] [Idioma ▾] [Nivel ▾] [Buscar].
//
// NO renderiza pestañas (Todos/Imágenes/Vídeos) ni su propia lista
// de resultados: eso vive en el ResultFeed consolidado (Sección 2),
// que es el ÚNICO conjunto de filtros (Todo | Imágenes | Doc/Video).
//
// El estado de búsqueda (useWorkspaceSearch) está elevado a
// WorkspaceHub, que lo inyecta por props (componente controlado) y
// vuelca los resultados web/imágenes/vídeo en el feed consolidado.
//
// Regla #1: sin hardcode — todas las etiquetas vienen de
// FLU_CONFIG.browser.search.ui con fallback || '...'.
// ============================================================

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
} from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { splitTranscriptAtWakeWord } from '../voice/lib/audioMath';
import type { SearchLevel } from '../hooks/useWorkspaceSearch';
import type { SearchConfigOverrides } from '../core/search/searchConfigOverrides';
import type { SearchConfig } from '../core/search/searchSession';

export interface WorkspaceSearchProps {
    /** Allowlist curada del participante (filtra navegabilidad). */
    allowlist?: string[];
    /** F5 — Overrides del Centro de Control (proveedores/seguridad/límite). */
    overrides?: SearchConfigOverrides;
    // ---- Estado controlado (hook elevado a WorkspaceHub) ----
    query: string;
    lang: 'es' | 'en';
    level: SearchLevel;
    loading: boolean;
    onQueryChange: (q: string) => void;
    onLangChange: (lang: 'es' | 'en') => void;
    onLevelChange: (level: SearchLevel) => void;
    onSubmit: () => void;
    onReset: () => void;
    livePhrase?: string;
    /** Indica si el asistente está capturando voz en este momento. */
    isListening?: boolean;
}

export function WorkspaceSearch({
    allowlist,
    overrides,
    query,
    lang,
    level,
    loading,
    onQueryChange,
    onLangChange,
    onLevelChange,
    onSubmit,
    onReset,
    livePhrase,
    isListening,
}: WorkspaceSearchProps) {
    const searchCfg = useMemo<SearchConfig>(
        () => (FLU_CONFIG as any).browser?.search || {},
        [],
    );

    // Etiquetas de la UI (Regla #1: sin hardcode).
    const ui = useMemo(
        () => {
            const cfg = searchCfg.ui || {};
            return {
                searchLabel: cfg.searchLabel || 'Buscar',
                // Placeholder vacío (el usuario pidió quitar "Busca algo").
                placeholder: cfg.placeholder || '',
                // Etiqueta accesible separada (no depende del placeholder).
                inputLabel: cfg.searchInputLabel || 'Buscar en el Pizarrón',
                languageLabel: cfg.languageLabel || 'Idioma',
                levelLabel: cfg.levelLabel || 'Nivel',
                level_simple: cfg.level_simple || 'Simple',
                level_detallado: cfg.level_detallado || 'Detallado',
                level_avanzado: cfg.level_avanzado || 'Avanzado',
            };
        },
        [searchCfg],
    );

    const inputRef = useRef<HTMLInputElement>(null);

    // Chrome-like: el foco arranca en la barra para poder escribir al instante.
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // §9.5: la barra es un componente PURO. No cachea comandos en un segundo
    // almacén; recibe la frase canónica por `livePhrase` y solo le quita la wake
    // word para presentación.

    const handleSubmit = useCallback(
        (event: FormEvent) => {
            event.preventDefault();
            onSubmit();
        },
        [onSubmit],
    );

    const hasQuery = Boolean(String(query).trim());
    // La barra de comandos SOLO debe reflejar los mandatos "OK FLU", NO toda la
    // transcripción en vivo (que incluye conversación de fondo sin wake word).
    // Se extrae únicamente el texto que sigue a una wake word; si no hay wake
    // word (ruido de fondo / conversación ajena), no se muestra nada en la barra.
    const rawLive = String(livePhrase || '').trim();
    const wakeWords: string[] =
        (FLU_CONFIG as any)?.voiceCommands?.wakeWords || [];
    const split = splitTranscriptAtWakeWord(rawLive, wakeWords);
    const live = split.wakeWordMatched
        ? String(split.afterWake || split.commandText || '').trim()
        : '';
    // La transcripción en vivo se muestra como "valor" de la barra SOLO
    // mientras el asistente está escuchando de verdad y no hay una consulta
    // escrita/confirmada. Así no queda texto residual ("Busca…") pegado en la
    // barra cuando la escucha ya terminó.
    // Definición: TODOS los comandos "OK FLU …" (buscar O consultar IA) deben
    // verse en la barra. Antes se ocultaban cuando isListening dejaba de ser
    // true (la bandera no siempre coincide con una captura en curso). Ahora se
    // muestra cualquier comando reconocido mientras no haya consulta escrita.
    const effectiveLive = live;
    const showLive = Boolean(effectiveLive.length) && !hasQuery;

    return (
        <div className="workspace-search" data-testid="workspace-search">
            <form className="workspace-search__bar" onSubmit={handleSubmit}>
                <span className="workspace-search__icon" aria-hidden="true">
                    🔍
                </span>
                <div className="workspace-search__field">
                    <input
                        ref={inputRef}
                        type="text"
                        className="workspace-search__input"
                        value={query}
                        onChange={(e) => {
                            onQueryChange(e.target.value);
                        }}
                        placeholder={ui.placeholder}
                        aria-label={ui.inputLabel}
                        disabled={loading}
                    />
                    {showLive && (
                        <span className="workspace-search__live" aria-hidden="true">
                            {effectiveLive}
                        </span>
                    )}
                </div>
                <select
                    className="workspace-search__select"
                    value={lang}
                    onChange={(e) => onLangChange(e.target.value as 'es' | 'en')}
                    aria-label={ui.languageLabel}
                    disabled={loading}
                >
                    <option value="es">es</option>
                    <option value="en">en</option>
                </select>
                <select
                    className="workspace-search__select"
                    value={level}
                    onChange={(e) => onLevelChange(e.target.value as SearchLevel)}
                    aria-label={ui.levelLabel}
                    disabled={loading}
                >
                    <option value="simple">{ui.level_simple}</option>
                    <option value="detallado">{ui.level_detallado}</option>
                    <option value="avanzado">{ui.level_avanzado}</option>
                </select>
                <button
                    type="submit"
                    className="workspace-search__go"
                    disabled={!hasQuery || loading}
                >
                    {loading ? '…' : ui.searchLabel}
                </button>
                {hasQuery && !loading && (
                    <button
                        type="button"
                        className="workspace-search__reset"
                        onClick={onReset}
                        title={ui.inputLabel}
                        aria-label={ui.inputLabel}
                    >
                        ✕
                    </button>
                )}
            </form>
        </div>
    );
}

export default WorkspaceSearch;
