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
import { useEffect, useMemo } from 'react';
import { pickLabel } from '../lib/textUtils';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { WorkspaceSearch } from './WorkspaceSearch';
import { ResultFeed, type ResultFeedItem } from './ResultFeed';
import { HoyPanel, type HoyPanelProps } from './HoyPanel';
import DocumentResultPanel from './DocumentResultPanel';
import AppAnalysisPanel from './AppAnalysisPanel';
import GenerationProgressPanel from './GenerationProgressPanel';
import { ImageGrid } from './ImageGrid';
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
import type { HorarioClaseEstructurada } from '../core/horario/horarioService';
import type { SearchConfigOverrides } from '../core/search/searchConfigOverrides';
import type { SearchResult } from '../core/search/searchSession';
import { onFluResetSearch, onFluSearch } from '../core/events/fluEvents';

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
    liveTranscript: string;
    currentTranscript: string;
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
        fallbackToGemini: () => Promise<void>;
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
    liveTranscript,
    currentTranscript,
    isListening,
    homeworkContext,
    image,
    document,
    app,
    generation,
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

    // Comando de voz NAVEGAR/BUSCAR (evento RUN_SEARCH): ejecuta la búsqueda
    // externa inyectando consulta e idioma, y vuelca los resultados al feed
    // consolidado (Sección 2). Antes vivía en WorkspaceSearch; al elevar el
    // hook a WorkspaceHub, el listener se registra aquí.
    useEffect(() => {
        const offSearch = onFluSearch((payload) => {
            void runSearch({ query: payload.query, lang: payload.lang });
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
    }, [runSearch, resetSearch]);

    // ---- Feed de resultados consolidado (Paso 1 del plan) ----
    // Ensambla ResultFeedItem[] desde el estado real que llega por props.
    // Cada tarjeta reutiliza el JSX presentacional existente (sin duplicar
    // lógica) y lleva su insignia de origen (WEB/IA/OCR).
    const feedItems = useMemo<ResultFeedItem[]>(() => {
        const items: ResultFeedItem[] = [];

        // IA texto: respuesta de Flu + contenido + puntos clave + tarea.
        const iaTextParts: string[] = [];
        if (latestResponse) iaTextParts.push(latestResponse);
        if (workspaceArtifact?.contenido) iaTextParts.push(workspaceArtifact.contenido);
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

        // IA imagen: la imagen generada.
        if (image.imageUrl || image.isLoading || image.isFailed) {
            items.push({
                id: 'ia-imagen',
                origin: 'ia',
                kind: 'image',
                title: pickLabel(ws.imageTitle, language, 'Imagen generada'),
                body: (
                    <div className="frame-content__generated-image">
                        <div className="generated-image__header" style={{ justifyContent: 'flex-end', gap: 8 }}>
                            <button
                                type="button"
                                className="panel-frame__toggle"
                                onClick={() => image.expand()}
                                aria-label={pickLabel(ws.imageExpandLabel, language, 'Ampliar')}
                                title={pickLabel(ws.imageExpandLabel, language, 'Ampliar')}
                            >
                                ⤢
                            </button>
                        </div>
                        <div className="generated-image__preview">
                            <img
                                className="generated-image__img"
                                src={image.imageUrl ? `${image.imageUrl}${image.imageUrl.includes('?') ? '&' : '?'}retry=${image.loadAttempt}` : undefined}
                                alt={workspaceArtifact?.prompt_visual || ws.imageAlt || 'Visual generado por Flu'}
                                onLoad={() => {
                                    if (image.loadTimeoutRef.current) {
                                        clearTimeout(image.loadTimeoutRef.current);
                                        image.loadTimeoutRef.current = 0;
                                    }
                                }}
                                onError={() => {
                                    console.warn('[WorkspaceHub] Generated image failed to load:', image.imageUrl);
                                    if (image.loadTimeoutRef.current) {
                                        clearTimeout(image.loadTimeoutRef.current);
                                        image.loadTimeoutRef.current = 0;
                                    }
                                    // Reintenta la MISMA URL (Pollinations es stateless) hasta
                                    // MAX_LOAD_RETRIES; solo entonces cae al fallback de Gemini.
                                    image.retryLoad();
                                }}
                            />
                            {image.isLoading && (
                                <div className="generated-image__loading">🔄 Generando imagen...</div>
                            )}
                            {image.isFailed && (
                                <div className="generated-image__error">
                                    <p>{pickLabel(ws.imageErrorTitle, language, 'No se pudo cargar la imagen')}</p>
                                    <button
                                        type="button"
                                        className="flu-btn flu-btn--small"
                                        onClick={() => image.retry()}
                                    >
                                        {pickLabel(ws.imageRetryLabel, language, 'Reintentar')}
                                    </button>
                                </div>
                            )}
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

        // WEB búsqueda: imágenes → tarjeta tipo 'image'.
        if (searchState.images.length > 0) {
            items.push({
                id: 'web-imagenes',
                origin: 'web',
                kind: 'image',
                title: pickLabel(undefined, language, 'Imágenes'),
                body: <ImageGrid results={searchState.images} loading={searchState.loading} />,
            });
        }

        // WEB búsqueda: vídeo → tarjeta tipo 'video'.
        if (searchState.video.length > 0) {
            items.push({
                id: 'web-video',
                origin: 'web',
                kind: 'video',
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
        image.fallbackToGemini,
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
        language,
        ws,
        searchState,
    ]);

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
                    onSubmit={() => void runSearch()}
                    onReset={resetSearch}
                    livePhrase={liveTranscript || currentTranscript}
                    isListening={isListening}
                />
            </div>
            <div className="workspace-hub__body">
                {hoy ? (
                    <div className="workspace-hub__columns" data-testid="workspace-hub-columns">
                        <div className="workspace-hub__main" data-testid="workspace-hub-main">
                            {/* Feed de resultados consolidado (columna principal) */}
                            <ResultFeed items={feedItems} language={language} />

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
                                        <p className="flu-upload-zone__hint">{pickLabel(ws.uploadDropHint, language, 'Arrastra una imagen aquí')}</p>
                                        <p className="flu-upload-zone__or">{pickLabel(ws.uploadDropOr, language, '— o —')}</p>
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
                                            <button
                                                type="button"
                                                className="flu-btn"
                                                onClick={() => upload.projectInputRef.current?.click()}
                                            >
                                                {pickLabel(ws.uploadAppLabel, language, '🧭 Analizar app')}
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
                                        <input
                                            ref={upload.projectInputRef}
                                            type="file"
                                            multiple
                                            hidden
                                            onChange={upload.onProjectFolderSelected}
                                            {...({ webkitdirectory: '', directory: '' } as any)}
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
                                now={hoy.now}
                                language={language}
                            />
                        </aside>
                    </div>
                ) : (
                    <div className="workspace-hub__main" data-testid="workspace-hub-main">
                        <ResultFeed items={feedItems} language={language} />
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
                                    <p className="flu-upload-zone__hint">{pickLabel(ws.uploadDropHint, language, 'Arrastra una imagen aquí')}</p>
                                    <p className="flu-upload-zone__or">{pickLabel(ws.uploadDropOr, language, '— o —')}</p>
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
                                        <button
                                            type="button"
                                            className="flu-btn"
                                            onClick={() => upload.projectInputRef.current?.click()}
                                        >
                                            {pickLabel(ws.uploadAppLabel, language, '🧭 Analizar app')}
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
                                    <input
                                        ref={upload.projectInputRef}
                                        type="file"
                                        multiple
                                        hidden
                                        onChange={upload.onProjectFolderSelected}
                                        {...({ webkitdirectory: '', directory: '' } as any)}
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
