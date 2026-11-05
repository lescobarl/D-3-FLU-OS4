// @vitest-environment jsdom
// ============================================================
// Guard de comportamiento — el último objeto de CADA TIPO no se borra
// ------------------------------------------------------------
// Invariante: un turno/petición de un tipo NO borra el último objeto
// restaurado de los otros tipos (video / imagen / documento). Antes el
// descarte de la restauración era GLOBAL: generar un video —o arrancar
// cualquier petición— dejaba fuera del Pizarrón la imagen generada, que
// seguía siendo el último objeto de su tipo.
// El guard de casos 2 y 4 (misma petición sin resultado no repinta el
// artefacto anterior) vive en workspaceMediaResetOnRequest.test.tsx y sigue
// vigente: dentro de su tipo el descarte es definitivo.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { DocumentRecord } from '../src/core/db/fluDatabase';
import type { WorkspaceHubProps } from '../src/components/WorkspaceHub';

vi.mock('../src/components/WorkspaceSearch', () => ({
    WorkspaceSearch: () => <div data-testid="mock-workspace-search" />,
}));
vi.mock('../src/components/DocumentResultPanel', () => ({
    default: () => <div data-testid="mock-document-panel" />,
}));
vi.mock('../src/components/AppAnalysisPanel', () => ({
    default: () => <div data-testid="mock-app-panel" />,
}));
vi.mock('../src/components/GenerationProgressPanel', () => ({
    default: () => <div data-testid="mock-generation-panel" />,
}));

import { WorkspaceHub } from '../src/components/WorkspaceHub';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const SYNC_AT = new Date(NOW).toISOString();
const sync = { revision: 1, updated_at: SYNC_AT, deleted: false };

function record(id: string, formato: string, ref: string): DocumentRecord {
    return {
        id,
        kind: 'generated',
        formato,
        titulo: `${formato} anterior`,
        nombre: id,
        ref,
        createdAt: NOW,
        updatedAt: NOW,
        sync,
    };
}

const persistedVideo = record('vid-1', 'video', 'https://example.test/video.mp4');
const persistedImage = record('img-1', 'image', 'https://example.test/imagen.png');
const persistedPdf = record('pdf-1', 'pdf', 'https://example.test/carta.pdf');

const documents = {
    documents: [persistedVideo, persistedImage, persistedPdf],
    loading: false,
    onRemove: () => {},
    language: 'es' as const,
};

function baseProps(overrides: Partial<WorkspaceHubProps> = {}): WorkspaceHubProps {
    return {
        searchAllowlist: [],
        searchOverrides: {},
        workspaceArtifact: null,
        latestResponse: '',
        livePhrase: '',
        homeworkContext: null,
        image: {
            imageUrl: null,
            isLoading: false,
            isFailed: false,
            isExpanded: false,
            loadAttempt: 0,
            loadTimeoutRef: { current: 0 },
            expand: () => {},
            close: () => {},
            retry: () => {},
            retryLoad: () => {},
            fallbackToOpenRouter: async () => {},
        },
        document: { isAnalyzing: false, error: null, warnings: [], artifact: null, clear: () => {} },
        app: { isAnalyzing: false, error: null, artifact: null, clear: () => {} },
        generation: {
            isGenerating: false,
            error: null,
            job: null,
            result: null,
            videoResult: null,
            clear: () => {},
        },
        upload: {
            uploadedImage: null,
            isAnalyzing: false,
            error: null,
            fileInputRef: { current: null },
            docInputRef: { current: null },
            projectInputRef: { current: null },
            onFileDrop: () => {},
            onFileSelected: () => {},
            onDocumentFileSelected: () => {},
            onProjectFolderSelected: () => {},
            onClearImage: () => {},
        },
        language: 'es',
        documents,
        ...overrides,
    };
}

/** Abre la pestaña del tipo en el feed (cada tipo vive bajo la suya). */
function openTab(container: HTMLElement, tab: 'image' | 'media'): void {
    const button = container.querySelector(`[data-filter="${tab}"]`);
    if (!button) throw new Error(`No existe la pestaña ${tab} del feed`);
    fireEvent.click(button);
}

function restored(container: HTMLElement, id: string): Element | null {
    return container.querySelector(`[data-testid="restored-media-${id}"]`);
}

describe('WorkspaceHub — el último objeto de cada tipo', () => {
    it('control: sin peticiones en curso se pinta el último de CADA tipo', () => {
        const { container } = render(<WorkspaceHub {...baseProps()} />);
        openTab(container, 'media');
        expect(restored(container, 'vid-1')).not.toBeNull();
        expect(restored(container, 'pdf-1')).not.toBeNull();
        openTab(container, 'image');
        expect(restored(container, 'img-1')).not.toBeNull();
    });

    it('una generación de VIDEO en curso no borra la última imagen ni el último documento', () => {
        const { container } = render(
            <WorkspaceHub
                {...baseProps({
                    generation: {
                        isGenerating: true,
                        error: null,
                        job: {
                            id: 'job-1',
                            estado: 'ensamblando',
                            progreso: 10,
                            formato: 'video',
                            timestamp: NOW,
                        },
                        result: null,
                        videoResult: null,
                        clear: () => {},
                    },
                })}
            />,
        );
        // El tipo que se está produciendo no repinta el suyo…
        openTab(container, 'media');
        expect(restored(container, 'vid-1')).toBeNull();
        // …pero el otro tipo de esa pestaña y la imagen conservan su último objeto.
        expect(restored(container, 'pdf-1')).not.toBeNull();
        openTab(container, 'image');
        expect(restored(container, 'img-1')).not.toBeNull();
    });

    it('una IMAGEN en curso no borra el último video', () => {
        const { container } = render(
            <WorkspaceHub {...baseProps({ image: { ...baseProps().image, isLoading: true } })} />,
        );
        openTab(container, 'image');
        expect(restored(container, 'img-1')).toBeNull();
        openTab(container, 'media');
        expect(restored(container, 'vid-1')).not.toBeNull();
    });

    it('la generación de un VIDEO no borra la imagen que el usuario acaba de generar', () => {
        const withLiveImage = baseProps({
            image: { ...baseProps().image, imageUrl: 'https://img/nueva.png' },
        });
        const view = render(<WorkspaceHub {...withLiveImage} />);
        openTab(view.container, 'image');
        // La imagen viva es el último objeto de su tipo: no se restaura otra.
        expect(restored(view.container, 'img-1')).toBeNull();
        expect(view.container.querySelector('[data-testid="workspace-search-cell-ia-imagen"]')).not.toBeNull();

        view.rerender(
            <WorkspaceHub
                {...withLiveImage}
                generation={{
                    isGenerating: true,
                    error: null,
                    job: {
                        id: 'job-1',
                        estado: 'ensamblando',
                        progreso: 10,
                        formato: 'video',
                        timestamp: NOW,
                    },
                    result: null,
                    videoResult: null,
                    clear: () => {},
                }}
            />,
        );
        // Al arrancar el video, la imagen sigue en el Pizarrón: no hay limpieza
        // global que la borre ni restauración que la pise.
        openTab(view.container, 'image');
        expect(view.container.querySelector('[data-testid="workspace-search-cell-ia-imagen"]')).not.toBeNull();
        openTab(view.container, 'media');
        expect(restored(view.container, 'vid-1')).toBeNull();
        expect(restored(view.container, 'pdf-1')).not.toBeNull();
    });
});
