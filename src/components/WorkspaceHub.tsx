// ============================================================
// WorkspaceHub — Pizarrón unificado "un solo objeto"
// ------------------------------------------------------------
// Muestra A LA VEZ el feed de resultados consolidado (con
// insignias WEB/IA/OCR y filtro Todo/Imágenes/Doc-Video) y el
// panel lateral HOY/DIARIO/NOTAS. NO hay pestañas que fragmenten
// ni `switch` que oculte regiones.
//
// Es un componente presentacional: recibe TODO el estado por props
// desde App.tsx (que ya instancia los 4 hooks + el store). No hace
// fetching ni muta estado global.
//
// Cumple:
//   - Rule #1: NO HARDCODE — todos los labels salen de FLU_CONFIG
//     con `||` fallback, igual que los componentes actuales.
//   - No toca hooks, store, contratos ni el efecto FLU_EVENTS.
//   - El overlay de imagen se renderiza como hermano del contenido
//     (no anidado) para preservar su `position: fixed`.
// ============================================================
import { useCallback, useEffect, useMemo } from 'react';
import { pickLabel } from '../lib/textUtils';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { WorkspaceSearch } from './WorkspaceSearch';
import { ResultFeed, type ResultFeedItem } from './ResultFeed';
import { HoyPanel, type HoyPanelProps } from './HoyPanel';
import DocumentResultPanel from './DocumentResultPanel';
import { DocumentsHistoryPanel, downloadDocumentContent, type DocumentsHistoryPanelProps } from './DocumentsHistoryPanel';
import AppAnalysisPanel from './AppAnalysisPanel';
import GenerationProgressPanel from './GenerationProgressPanel';
import { ImageGrid, type GeneratedGridCell } from './ImageGrid';
import { VideoGrid } from './VideoGrid';
import { useWorkspaceSearch } from '../hooks/useWorkspaceSearch';
import type { WorkspaceEntry } from '../types/bridge';
import type {
    DocumentContract,
    AppAnalysisContract,
    GenerationJob,
} from '../types/documentContracts';
import type { GeneratedDocumentResult } from '../core/ai/IAIService';
import type { VideoAssemblyResult } from '../services/videoAssembler';
import type { DocumentRecord } from '../core/db/fluDatabase';
import type { HorarioClaseEstructurada } from '../core/horario/horarioService';
import type { SearchConfigOverrides } from '../core/search/searchConfigOverrides';
import type { SearchResult } from '../core/search/searchSession';
import { dispatchFluSearchReady, onFluResetSearch, onFluSearch } from '../core/events/fluEvents';

// ------------------------------------------------------------
// Props — todo el estado llega desde App.tsx
// ------------------------------------------------------------
export interface WorkspaceHubProps {
    // Búsqueda (WorkspaceSearch)
    searchAllowlist?: string[];
    searchOverrides?: SearchConfigOverrides;

    // Store: artefacto de workspace (respuesta + horario)
    workspaceArtifact: WorkspaceEntry | null;

    // Respuesta de Flu (texto IA)
    latestResponse: string;
    /**
     * Frase visible canónica (§9.3): MISMA cadena que bitácora/burbuja.
     * La barra solo le quita la wake word para presentación. Se deriva una
     * única vez en App (`selectVisiblePhrase`); ningún consumidor la recalcula.
     */
    livePhrase: string;
    /** Indica si el asistente está capturando voz (para el overlay en vivo). */
    isListening?: boolean;
    homeworkContext: {
        materia: string;
        problemas: string[];
        instrucciones: string;
        nivel: string;
        texto_extraido: string;
    } | null;

    // Imagen generada (IA)
    image: {
        imageUrl: string | null;
        isLoading: boolean;
        isFailed: boolean;
        isExpanded: boolean;
        /** Contador de reintentos de carga de la URL (cache-buster en el <img>). */
        loadAttempt: number;
        loadTimeoutRef: React.MutableRefObject<number>;
        expand: () => void;
        close: () => void;
        retry: () => void;
        /** Reintentar la carga de la MISMA URL (Pollinations es stateless). */
        retryLoad: () => void;
        fallbackToOpenRouter: () => Promise<void>;
        /** Limpiar todo el estado de imagen. */
        clear?: () => void;
    };

    // Análisis de documento
    document: {
        isAnalyzing: boolean;
        error: string | null;
        warnings: string[];
        artifact: DocumentContract | null;
        clear: () => void;
    };

    // Análisis de app
    app: {
        isAnalyzing: boolean;
        error: string | null;
        artifact: AppAnalysisContract | null;
        clear: () => void;
    };

    // Generación de documento / video
    generation: {
        isGenerating: boolean;
        error: string | null;
        job: GenerationJob | null;
        result: GeneratedDocumentResult | null;
        videoResult: VideoAssemblyResult | null;
        clear: () => void;
    };

    /**
     * Historial por usuario (punteros a los artefactos generados/cargados).
     * Única fuente: `useDocuments` (App). Se pinta en la pestaña "Historial"
     * del Pizarrón. Opcional para no romper tests previos.
     */
    documents?: DocumentsHistoryPanelProps;

    /**
     * Foco del turno (señal por turno desde App): `seq` monotónico + `kind` del
     * resultado. `text` → vuelve a "Todo"; video/doc → "Video/Docs"; image →
     * "Imágenes". Tiene prioridad sobre el foco derivado.
     */
    turnFocus?: { kind: 'video' | 'doc' | 'image' | 'text'; seq: number } | null;

    // Confirmación del parseo de una imagen de horario (digitalización → HOY).
    // Genérico: entradas estructuradas pendientes del visto bueno del usuario.
    horarioImport?: {
        pending: HorarioClaseEstructurada[] | null;
        busy: boolean;
        onConfirm: () => Promise<void>;
        onCancel: () => void;
    };

    // Subir archivo (hub de entrada)
    upload: {
        uploadedImage: { dataUrl: string; mimeType: string; fileName: string } | null;
        isAnalyzing: boolean;
        error: string | null;
        fileInputRef: React.RefObject<HTMLInputElement | null>;
        docInputRef: React.RefObject<HTMLInputElement | null>;
        projectInputRef: React.RefObject<HTMLInputElement | null>;
        onFileDrop: (e: React.DragEvent) => void;
        onFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onDocumentFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onProjectFolderSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onClearImage: () => void;
    };

    // Idioma
    language: string;

    // Panel lateral "Hoy" (Pizarrón consolidado — Paso 2/4).
    // Cuando se provee, el hub se muestra en layout de 2 columnas:
    // columna principal = feed de resultados consolidado; columna
    // lateral = HoyPanel (HOY/DIARIO/NOTAS). Opcional para no romper
    // los usos/test que aún no lo cablean.
    hoy?: HoyPanelProps;
}

// ------------------------------------------------------------
// HorarioImportConfirm — confirmación del parseo de una imagen
// de horario (digitalización → HOY). Presentacional: recibe las
// entradas estructuradas pendientes y los callbacks por props.
// Sin hardcode: etiquetas y días salen de FLU_CONFIG.horario.
// ------------------------------------------------------------
export interface HorarioImportConfirmProps {
    pending: HorarioClaseEstructurada[];
    busy: boolean;
    onConfirm: () => Promise<void>;
    onCancel: () => void;
    language: string;
}

// ------------------------------------------------------------
export function HorarioImportConfirm({
    pending,
    busy,
    onConfirm,
    onCancel,
    language,
}: HorarioImportConfirmProps) {
    const cfg = FLU_CONFIG.horario || {};
    const ui = cfg.ui || {};
    const dayLabels: string[] = cfg.dayLabels || ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const count = pending.length;
    const countLabel =
        count === 1
            ? pickLabel(ui.importCountOne, language, '1 entrada detectada')
            : String(pickLabel(ui.importCountMany, language, '{n} entradas detectadas')).replace('{n}', String(count));

    return (
        <section className="flu-horario-import" data-testid="horario-import-confirm">
            <header className="flu-horario-import__header">
                <h4 className="flu-horario-import__title">
                    {pickLabel(ui.importTitle, language, 'Leí un horario en la imagen')}
                </h4>
                <span className="flu-horario-import__count">{countLabel}</span>
            </header>
            <p className="flu-horario-import__hint">
                {pickLabel(ui.importHint, language, 'Revisa las entradas detectadas. Al confirmar, quedan registradas en tu horario.')}
            </p>
            <ul className="flu-horario-import__list">
                {pending.map((entry, idx) => {
                    const dia = entry.dia >= 1 && entry.dia <= 7 ? dayLabels[entry.dia] || String(entry.dia) : String(entry.dia);
                    return (
                        <li key={`${idx}-${entry.materia}-${entry.dia}-${entry.inicio}`} className="flu-horario-import__item">
                            <span className="flu-horario-import__item-titulo">{entry.materia}</span>
                            <span className="flu-horario-import__item-meta">
                                {dia}
                                {entry.tipo ? ` · ${entry.tipo}` : ''}
                            </span>
                            <span className="flu-horario-import__item-hora">
                                {entry.inicio}–{entry.fin}
                                {entry.aula ? ` · ${entry.aula}` : ''}
                            </span>
                        </li>
                    );
                })}
            </ul>
            <footer className="flu-horario-import__actions">
                <button
                    type="button"
                    className="flu-horario-import__btn flu-horario-import__btn--cancel"
                    onClick={onCancel}
                    disabled={busy}
                >
                    {pickLabel(ui.importCancel, language, 'Descartar')}
                </button>
                <button
                    type="button"
                    className="flu-horario-import__btn flu-horario-import__btn--confirm"
                    onClick={() => void onConfirm()}
                    disabled={busy}
                >
                    {busy
                        ? pickLabel(ui.importBusy, language, 'Guardando…')
                        : pickLabel(ui.importConfirm, language, 'Confirmar y guardar')}
                </button>
            </footer>
        </section>
    );
}

// ------------------------------------------------------------
// Componente
// ------------------------------------------------------------
export function WorkspaceHub({
    searchAllowlist,
    searchOverrides,
    workspaceArtifact,
    latestResponse,
    livePhrase,
    isListening,
    homeworkContext,
    image,
    document,
    app,
    generation,
    documents,
    turnFocus,
    horarioImport,
    upload,
    language,
    hoy,
}: WorkspaceHubProps) {
    const ws = FLU_CONFIG.ui?.workspace || {};

    // ---- Búsqueda web (Sección 1 → Sección 2) ----
    // El estado de búsqueda (useWorkspaceSearch) vive aquí, elevado desde
    // WorkspaceSearch (que ahora es una barra de comandos pura y controlada).
    // Los resultados web/imágenes/vídeo se vuelcan al feed consolidado como
    // tarjetas WEB (origen 'web'), bajo el ÚNICO filtro Todo|Imágenes|Doc/Video.
    const {
        state: searchState,
        setQuery: setSearchQuery,
        setLang: setSearchLang,
        setLevel: setSearchLevel,
        search: runSearch,
        reset: resetSearch,
    } = useWorkspaceSearch({
        allowlist: searchAllowlist,
        overrides: searchOverrides,
    });

    // Búsqueda nueva → limpiar la imagen generada (IA) de un turno anterior para
    // que no quede "colgada" junto a los resultados de otra consulta. La imagen
    // IA generada se muestra dentro de la zona de imágenes (ver feedItems).
    const handleRunSearch = useCallback(
        (opts?: Parameters<typeof runSearch>[0]) => {
            image.clear?.();
            return runSearch(opts);
        },
        [image, runSearch],
    );

    // Comando de voz NAVEGAR/BUSCAR (evento RUN_SEARCH): ejecuta la búsqueda
    // externa inyectando consulta e idioma, y vuelca los resultados al feed
    // consolidado (Sección 2). Antes vivía en WorkspaceSearch; al elevar el
    // hook a WorkspaceHub, el listener se registra aquí.
    useEffect(() => {
        const offSearch = onFluSearch((payload) => {
            void handleRunSearch({ query: payload.query, lang: payload.lang }).then(() => {
                // §4: los resultados ya están pintados → FLU lo anuncia por voz.
                dispatchFluSearchReady({ query: payload.query, lang: payload.lang });
            });
        });
        // Cuando comienza un turno NO relacionado con búsqueda (conversación,
        // generación de imagen, etc.), App emite RESET_SEARCH para limpiar los
        // resultados web/imágenes/vídeo y la consulta de la barra del turno
        // anterior. Así el feed no conserva resultados "pegados" de una búsqueda
        // vieja cuando la IA responde otra cosa.
        const offReset = onFluResetSearch(() => {
            resetSearch();
        });
        return () => {
            offSearch();
            offReset();
        };
    }, [handleRunSearch, resetSearch]);

    // ---- Feed de resultados consolidado (Paso 1 del plan) ----
    // Ensambla ResultFeedItem[] desde el estado real que llega por props.
    // Cada tarjeta reutiliza el JSX presentacional existente (sin duplicar
    // lógica) y lleva su insignia de origen (WEB/IA/OCR).
    const feedItems = useMemo<ResultFeedItem[]>(() => {
        const items: ResultFeedItem[] = [];

        // IA imagen generada: se muestra como PRIMERA celda del grid de imágenes
        // (misma cuadrícula que las imágenes web) y al hacer click se amplía el
        // overlay. Comportamiento web/IA unificado (opción 2).
        const generatedCell: GeneratedGridCell | null =
            image.imageUrl || image.isLoading || image.isFailed
                ? {
                    title: workspaceArtifact?.prompt_visual || ws.imageAlt || 'Imagen generada',
                    imageUrl: image.imageUrl,
                    isLoading: image.isLoading,
                    isFailed: image.isFailed,
                    loadAttempt: image.loadAttempt,
                    onExpand: image.expand,
                    onRetry: image.retry,
                    // La imagen cargó → limpiar el watchdog de 30 s (sin esto, un
                    // onLoad lento marcaba un fallo FALSO aunque la imagen se veía).
                    onLoaded: () => {
                        if (image.loadTimeoutRef.current) {
                            clearTimeout(image.loadTimeoutRef.current);
                            image.loadTimeoutRef.current = 0;
                        }
                    },
                    // La imagen falló al cargar → reintentar la MISMA URL
                    // (Pollinations es stateless), como hacía el bloque original.
                    onLoadFailed: () => image.retryLoad(),
                }
                : null;

        // IA texto: respuesta de Flu + contenido + puntos clave + tarea.
        // Los artefactos GENERADOS (documento/carta/pdf, video) NO se pintan aquí:
        // su contenido va en su tarjeta de generación (ia-generacion). Antes la
        // carta completa aparecía como "Respuesta de Flu" además de generarse.
        const artifactTipo = String(workspaceArtifact?.tipo || '');
        const artifactEsGenerado = artifactTipo === 'doc' || artifactTipo === 'video';
        const iaTextParts: string[] = [];
        if (latestResponse) iaTextParts.push(latestResponse);
        if (workspaceArtifact?.contenido && !artifactEsGenerado) {
            iaTextParts.push(workspaceArtifact.contenido);
        }
        if (Array.isArray(workspaceArtifact?.puntos_clave) && workspaceArtifact.puntos_clave.length > 0) {
            iaTextParts.push(workspaceArtifact.puntos_clave.join('\n'));
        }
        if (homeworkContext) {
            iaTextParts.push(
                `📚 ${homeworkContext.materia}\nNivel: ${homeworkContext.nivel}\nInstrucciones: ${homeworkContext.instrucciones}${
                    homeworkContext.problemas.length > 0 ? `\n${homeworkContext.problemas.join('\n')}` : ''
                }`
            );
        }
        if (iaTextParts.length > 0) {
            items.push({
                id: 'ia-texto',
                origin: 'ia',
                kind: 'text',
                title: pickLabel(ws.responseTitle, language, 'Respuesta de Flu'),
                body: (
                    <div className="frame-content__response">
                        <div className="frame-content__response-scroll">
                            <span>{iaTextParts.join('\n\n')}</span>
                        </div>
                    </div>
                ),
            });
        }

        // OCR documento: análisis de documento subido.
        if (document.artifact || document.isAnalyzing) {
            items.push({
                id: 'ocr-documento',
                origin: 'ocr',
                kind: 'doc',
                title: pickLabel(ws.documentTitle, language, 'Análisis de documento'),
                body: (
                    <DocumentResultPanel
                        document={document.artifact}
                        isAnalyzing={document.isAnalyzing}
                        warnings={document.warnings}
                        error={document.error}
                        onClear={document.clear}
                        language={language}
                        hideHeader
                    />
                ),
            });
        }

        // IA app: análisis de app.
        if (app.artifact || app.isAnalyzing) {
            items.push({
                id: 'ia-app',
                origin: 'ia',
                kind: 'doc',
                title: pickLabel(ws.appTitle, language, 'Análisis de app'),
                body: (
                    <AppAnalysisPanel
                        analysis={app.artifact}
                        isAnalyzing={app.isAnalyzing}
                        error={app.error}
                        onClear={app.clear}
                        language={language}
                        hideHeader
                    />
                ),
            });
        }

        // IA generación: documento / video.
        if (
            generation.isGenerating ||
            generation.result ||
            generation.videoResult ||
            generation.job
        ) {
            items.push({
                id: 'ia-generacion',
                origin: 'ia',
                kind: generation.videoResult ? 'video' : 'doc',
                onlyInKind: true,
                title: pickLabel(ws.generationTitle, language, 'Generación de documento / video'),
                body: (
                    <GenerationProgressPanel
                        job={generation.job}
                        result={generation.result}
                        videoResult={generation.videoResult}
                        isGenerating={generation.isGenerating}
                        error={generation.error}
                        language={language}
                        onClear={generation.clear}
                        hideHeader
                    />
                ),
            });
        }

        // Historial por usuario: punteros a los artefactos generados/cargados
        // (video, documento/carta, imagen). Vive SOLO bajo la pestaña
        // "Historial"; nunca se intercala en "Todo".
        if (documents && (documents.documents.length > 0 || documents.loading)) {
            items.push({
                id: 'documents-history',
                origin: 'ia',
                kind: 'history',
                onlyInKind: true,
                title: pickLabel(FLU_CONFIG.documents?.ui?.title, language, 'Historial'),
                body: <DocumentsHistoryPanel {...documents} />,
            });
        }

        // Restauración al iniciar sesión: último artefacto PERSISTIDO por tipo
        // (prioridad video > imagen > documento). ÚNICA fuente: `documents`
        // (Dexie, por usuario). UN solo builder. Si el tipo ya está vivo en
        // pantalla se omite, para no duplicar el render. El foco inicial lo
        // decide `pickInitialFilter` (una sola vez) al remontar el feed cuando
        // termina de cargar el historial.
        if (documents && !documents.loading) {
            const latestByFormato = (formato: string): DocumentRecord | undefined =>
                documents.documents.find(
                    (d) => String(d.formato || '').toLowerCase() === formato,
                );
            // Un artefacto está "vivo" si ya llegó o si se está generando/cargando:
            // mientras hay una petición en curso NO se restaura el anterior, para
            // que sólo se pinte el nuevo al llegar (no el de la vez pasada).
            const liveMedia = {
                video: Boolean(generation.videoResult) || generation.isGenerating,
                image: Boolean(image.imageUrl) || image.isLoading,
                doc: Boolean(generation.result) || generation.isGenerating,
            };
            const restored: Array<{ rec?: DocumentRecord; kind: 'video' | 'image' | 'doc'; live: boolean }> = [
                { rec: latestByFormato('video'), kind: 'video', live: liveMedia.video },
                { rec: latestByFormato('image'), kind: 'image', live: liveMedia.image },
                { rec: latestByFormato('pdf'), kind: 'doc', live: liveMedia.doc },
            ];
            restored.forEach(({ rec, kind, live }) => {
                if (!rec || live) return;
                const label = String(rec.titulo || rec.nombre || '');
                const pointer = String(rec.ref || '');
                const docSource = String(rec.ref || rec.contenido || '');
                items.push({
                    id: `restored-${kind}-${rec.id}`,
                    origin: 'ia',
                    kind,
                    onlyInKind: true,
                    title: label,
                    body: (
                        <div className="frame-content__response">
                            <div className="frame-content__response-scroll">
                                {kind === 'image' && pointer ? (
                                    <img
                                        src={pointer}
                                        alt={label}
                                        data-testid={`restored-media-${rec.id}`}
                                        style={{ maxWidth: '100%', borderRadius: '8px' }}
                                    />
                                ) : kind === 'video' && pointer ? (
                                    <video
                                        src={pointer}
                                        controls
                                        data-testid={`restored-media-${rec.id}`}
                                        style={{ maxWidth: '100%', borderRadius: '8px' }}
                                    />
                                ) : kind === 'doc' && docSource ? (
                                    <a
                                        href={docSource}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        data-testid={`restored-media-${rec.id}`}
                                    >
                                        📄 {label}
                                    </a>
                                ) : (
                                    <span>{label}</span>
                                )}
                            </div>
                            <div className="flu-reminders-item__actions">
                                <button
                                    type="button"
                                    data-testid={`restored-open-${rec.id}`}
                                    title={pickLabel(FLU_CONFIG.documents?.ui?.downloadTitle, language, 'Abrir')}
                                    onClick={() => downloadDocumentContent(rec)}
                                >
                                    ⬇️
                                </button>
                            </div>
                        </div>
                    ),
                });
            });
        }

        // WEB búsqueda: resultados de texto (web) → tarjeta tipo 'text'.
        if (searchState.results.length > 0) {
            items.push({
                id: 'web-resultados',
                origin: 'web',
                kind: 'text',
                title: pickLabel(undefined, language, 'Resultados de búsqueda'),
                body: (
                    <ul className="workspace-search__list">
                        {searchState.results.map((r: SearchResult, index: number) => (
                            <li key={`${r.host}-${index}-${r.url}`} className="workspace-search__result">
                                <a
                                    className="workspace-search__result-link"
                                    href={r.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {r.title}
                                </a>
                                {r.snippet && (
                                    <p className="workspace-search__result-snippet">{r.snippet}</p>
                                )}
                                {r.host && (
                                    <span className="workspace-search__result-host">{r.host}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                ),
            });
        }

        // Diagnóstico visible de la cadena de búsqueda: si un proveedor falló
        // (clave inválida, sin crédito, modelo inexistente…), se muestra aquí.
        if (searchState.error) {
            items.push({
                id: 'web-error',
                origin: 'web',
                kind: 'text',
                title: pickLabel(undefined, language, 'Búsqueda'),
                body: (
                    <p className="flu-error-box" role="alert" data-testid="search-error">
                        {searchState.error}
                    </p>
                ),
            });
        }

        // Imágenes → UNA sola cuadrícula SOLO bajo el filtro "Imágenes".
        // - Imagen IA generada (sin búsqueda web): tarjeta de ORIGEN IA.
        // - Con imágenes web: tarjeta web mixta (IA encabeza + grid web).
        // `onlyInKind: true` en ambos casos → la cuadrícula NO se intercala en
        // "Todo" (ni bajo la respuesta de Flu ni bajo los resultados web).
        const soloIa = generatedCell !== null && searchState.images.length === 0;
        if (generatedCell !== null || searchState.images.length > 0) {
            items.push({
                id: soloIa ? 'ia-imagen' : 'web-imagenes',
                origin: soloIa ? 'ia' : 'web',
                kind: 'image',
                onlyInKind: true,
                title: soloIa
                    ? pickLabel(ws.imageTitle, language, 'Imagen generada')
                    : pickLabel(undefined, language, 'Imágenes'),
                body: (
                    <div className="workspace-images__zone">
                        <ImageGrid
                            results={searchState.images}
                            loading={searchState.loading}
                            generated={generatedCell}
                            language={language}
                        />
                    </div>
                ),
            });
        }

        // WEB búsqueda: vídeo → tarjeta tipo 'video'.
        if (searchState.video.length > 0) {
            items.push({
                id: 'web-video',
                origin: 'web',
                kind: 'video',
                onlyInKind: true,
                title: pickLabel(undefined, language, 'Vídeos'),
                body: <VideoGrid results={searchState.video} loading={searchState.loading} />,
            });
        }

        return items;
    }, [
        latestResponse,
        workspaceArtifact,
        homeworkContext,
        image.imageUrl,
        image.isLoading,
        image.isFailed,
        image.loadTimeoutRef,
        image.expand,
        image.retry,
        image.fallbackToOpenRouter,
        document.artifact,
        document.isAnalyzing,
        document.warnings,
        document.error,
        document.clear,
        app.artifact,
        app.isAnalyzing,
        app.error,
        app.clear,
        generation.isGenerating,
        generation.result,
        generation.videoResult,
        generation.job,
        generation.error,
        generation.clear,
        image.imageUrl,
        documents,
        language,
        ws,
        searchState,
    ]);

    // Foco por artefacto del turno: video o documento → "Video/Docs";
    // imagen generada → "Imágenes". ResultFeed salta a esa pestaña cuando
    // el artefacto es NUEVO (ver efecto en ResultFeed).
    const focusKind: 'video' | 'doc' | 'image' | null = generation.videoResult
        ? 'video'
        : generation.result
            ? 'doc'
            : image.imageUrl
                ? 'image'
                : null;

    const hasPendingImport = Boolean(
        horarioImport?.pending && horarioImport.pending.length > 0
    );

    return (
        <div className="workspace-hub" data-testid="workspace-hub">
            {/* Sección 1 — barra de comandos (región permanente, ancho completo).
                Vive como hermana por encima del cuerpo desplazable para poder
                extenderse de borde a borde del frame sin márgenes laterales. */}
            <div className="workspace-hub__searchbar">
                <WorkspaceSearch
                    allowlist={searchAllowlist}
                    overrides={searchOverrides}
                    query={searchState.query}
                    lang={searchState.lang}
                    level={searchState.level}
                    loading={searchState.loading}
                    onQueryChange={setSearchQuery}
                    onLangChange={setSearchLang}
                    onLevelChange={setSearchLevel}
                    onSubmit={() => void handleRunSearch()}
                    onReset={resetSearch}
                    // Fuente canónica única de la frase (regla #6): la barra
                    // recibe la MISMA cadena que bitácora/burbuja y solo le quita
                    // la wake word para pintar comandos.
                    livePhrase={livePhrase}
                    isListening={isListening}
                />
            </div>
            <div className="workspace-hub__body">
                {hoy ? (
                    <div className="workspace-hub__columns" data-testid="workspace-hub-columns">
                        <div className="workspace-hub__main" data-testid="workspace-hub-main">
                            {/* Feed de resultados consolidado (columna principal) */}
                            <ResultFeed items={feedItems} language={language} focusKind={turnFocus?.kind ?? focusKind} focusSeq={turnFocus?.seq} key={documents?.loading ? 'feed-loading' : 'feed-ready'} />

                            {/* Sección 3 — cargas (región permanente) */}
                            <div className="frame-content__upload-zone">
                                {upload.error && (
                                    <div className="flu-error-box" role="alert">{upload.error}</div>
                                )}
                                {!upload.uploadedImage ? (
                                    <div
                                        className="flu-upload-zone__drop"
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={upload.onFileDrop}
                                    >
                                        <p className="flu-upload-zone__hint">{pickLabel(ws.uploadDropHint, language, 'Arrastra tu documento aquí')}</p>
                                        <div className="flu-upload-zone__buttons">
                                            <button
                                                type="button"
                                                className="flu-btn"
                                                onClick={() => upload.fileInputRef.current?.click()}
                                            >
                                                {pickLabel(ws.uploadSelectLabel, language, '📁 Subir imagen')}
                                            </button>
                                            <button
                                                type="button"
                                                className="flu-btn"
                                                onClick={() => upload.docInputRef.current?.click()}
                                            >
                                                {pickLabel(ws.uploadDocumentLabel, language, '📄 Analizar documento')}
                                            </button>
                                        </div>
                                        <input
                                            ref={upload.fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            hidden
                                            onChange={upload.onFileSelected}
                                        />
                                        <input
                                            ref={upload.docInputRef}
                                            type="file"
                                            accept=".xlsx,.xlsm,.pdf,.docx,.pptx,.csv,.txt,.md,text/*,application/pdf"
                                            hidden
                                            data-testid="doc-input"
                                            onChange={upload.onDocumentFileSelected}
                                        />
                                    </div>
                                ) : (
                                    <div className="flu-upload-zone__preview">
                                        <img
                                            className="flu-upload-zone__img"
                                            src={upload.uploadedImage.dataUrl}
                                            alt="Tarea subida"
                                        />
                                        <div className="flu-upload-zone__actions">
                                            {upload.isAnalyzing && (
                                                <span className="flu-upload-zone__analyzing">
                                                    {pickLabel(ws.uploadAnalyzingLabel, language, '🔍 Analizando con IA...')}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                className="flu-btn flu-btn--danger"
                                                onClick={upload.onClearImage}
                                            >
                                                {pickLabel(ws.uploadRemoveLabel, language, '✕ Quitar')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <aside className="workspace-hub__side" data-testid="workspace-hub-side">
                            {/* Digitalización de horario → confirmación dentro del HOY */}
                            {hasPendingImport && horarioImport && (
                                <HorarioImportConfirm
                                    pending={horarioImport.pending!}
                                    busy={horarioImport.busy}
                                    onConfirm={horarioImport.onConfirm}
                                    onCancel={horarioImport.onCancel}
                                    language={language}
                                />
                            )}
                            <HoyPanel
                                horario={hoy.horario}
                                diary={hoy.diary}
                                notes={hoy.notes}
                                reminders={hoy.reminders}
                                temporals={hoy.temporals}
                                now={hoy.now}
                                language={language}
                            />
                        </aside>
                    </div>
                ) : (
                    <div className="workspace-hub__main" data-testid="workspace-hub-main">
                        <ResultFeed items={feedItems} language={language} focusKind={turnFocus?.kind ?? focusKind} focusSeq={turnFocus?.seq} key={documents?.loading ? 'feed-loading' : 'feed-ready'} />
                        <div className="frame-content__upload-zone">
                            {upload.error && (
                                <div className="flu-error-box" role="alert">{upload.error}</div>
                            )}
                            {!upload.uploadedImage ? (
                                <div
                                    className="flu-upload-zone__drop"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={upload.onFileDrop}
                                >
                                    <p className="flu-upload-zone__hint">{pickLabel(ws.uploadDropHint, language, 'Arrastra tu documento aquí')}</p>
                                    <div className="flu-upload-zone__buttons">
                                        <button
                                            type="button"
                                            className="flu-btn"
                                            onClick={() => upload.fileInputRef.current?.click()}
                                        >
                                            {pickLabel(ws.uploadSelectLabel, language, '📁 Subir imagen')}
                                        </button>
                                        <button
                                            type="button"
                                            className="flu-btn"
                                            onClick={() => upload.docInputRef.current?.click()}
                                        >
                                            {pickLabel(ws.uploadDocumentLabel, language, '📄 Analizar documento')}
                                        </button>
                                    </div>
                                    <input
                                        ref={upload.fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={upload.onFileSelected}
                                    />
                                    <input
                                        ref={upload.docInputRef}
                                        type="file"
                                        accept=".xlsx,.xlsm,.pdf,.docx,.pptx,.csv,.txt,.md,text/*,application/pdf"
                                        hidden
                                        onChange={upload.onDocumentFileSelected}
                                    />
                                </div>
                            ) : (
                                <div className="flu-upload-zone__preview">
                                    <img
                                        className="flu-upload-zone__img"
                                        src={upload.uploadedImage.dataUrl}
                                        alt="Tarea subida"
                                    />
                                    <div className="flu-upload-zone__actions">
                                        {upload.isAnalyzing && (
                                            <span className="flu-upload-zone__analyzing">
                                                {pickLabel(ws.uploadAnalyzingLabel, language, '🔍 Analizando con IA...')}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            className="flu-btn flu-btn--danger"
                                            onClick={upload.onClearImage}
                                        >
                                            {pickLabel(ws.uploadRemoveLabel, language, '✕ Quitar')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Overlay de imagen ampliada — hermano del contenido (position: fixed) */}
            {image.isExpanded && image.imageUrl && (
                <div
                    className="workspace-image-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Imagen ampliada"
                    onClick={() => image.close()}
                >
                    <div
                        className="workspace-image-container"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="workspace-image-close"
                            onClick={() => image.close()}
                            aria-label="Cerrar imagen ampliada"
                            title="Cerrar"
                        >
                            ✕
                        </button>
                        <img
                            src={image.imageUrl}
                            alt={workspaceArtifact?.prompt_visual || ws.imageAlt || 'Visual generado por Flu'}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default WorkspaceHub;
