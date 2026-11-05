// @vitest-environment jsdom
// ============================================================
// Guard de comportamiento — Casos 2 y 4 (restauración one-shot)
// ------------------------------------------------------------
// La restauración del historial NO debe repintar el artefacto
// anterior una vez que el usuario pidió algo nuevo. Hoy sólo se
// oculta MIENTRAS está en curso; si la petición termina sin
// resultado (fallo), el artefacto viejo reaparece.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
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

const persistedVideo: DocumentRecord = {
    id: 'vid-1',
    kind: 'generated',
    formato: 'video',
    titulo: 'Video anterior',
    nombre: 'video.mp4',
    ref: 'https://example.test/video.mp4',
    createdAt: NOW,
    updatedAt: NOW,
    sync,
};

const persistedImage: DocumentRecord = {
    id: 'img-1',
    kind: 'generated',
    formato: 'image',
    titulo: 'Imagen anterior',
    nombre: 'imagen.png',
    ref: 'https://example.test/imagen.png',
    createdAt: NOW,
    updatedAt: NOW,
    sync,
};

const documents = {
    documents: [persistedVideo, persistedImage],
    loading: false,
    onRemove: () => {},
    language: 'es' as const,
};

function documentsOf(records: DocumentRecord[]) {
    return { documents: records, loading: false, onRemove: () => {}, language: 'es' as const };
}

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

describe('WorkspaceHub — la restauración no repinta el artefacto anterior tras una petición', () => {
    it('control: sin peticiones, sí restaura el último artefacto persistido', () => {
        const videoView = render(<WorkspaceHub {...baseProps({ documents: documentsOf([persistedVideo]) })} />);
        expect(videoView.container.querySelector('[data-testid="restored-media-vid-1"]')).not.toBeNull();

        const imageView = render(<WorkspaceHub {...baseProps({ documents: documentsOf([persistedImage]) })} />);
        expect(imageView.container.querySelector('[data-testid="restored-media-img-1"]')).not.toBeNull();
    });

    it('no repinta el video anterior si la petición nueva terminó sin resultado', () => {
        const view = render(
            <WorkspaceHub
                {...baseProps({
                    documents: documentsOf([persistedVideo]),
                    generation: {
                        isGenerating: true,
                        error: null,
                        job: null,
                        result: null,
                        videoResult: null,
                        clear: () => {},
                    },
                })}
            />,
        );
        expect(view.container.querySelector('[data-testid="restored-media-vid-1"]')).toBeNull();

        view.rerender(
            <WorkspaceHub
                {...baseProps({
                    documents: documentsOf([persistedVideo]),
                    generation: {
                        isGenerating: false,
                        error: 'falló',
                        job: null,
                        result: null,
                        videoResult: null,
                        clear: () => {},
                    },
                })}
            />,
        );
        expect(view.container.querySelector('[data-testid="restored-media-vid-1"]')).toBeNull();
    });

    it('no repinta la imagen anterior si la petición nueva terminó sin resultado', () => {
        const view = render(
            <WorkspaceHub
                {...baseProps({
                    documents: documentsOf([persistedImage]),
                    image: { ...baseProps().image, isLoading: true },
                })}
            />,
        );
        expect(view.container.querySelector('[data-testid="restored-media-img-1"]')).toBeNull();

        view.rerender(<WorkspaceHub {...baseProps({ documents: documentsOf([persistedImage]) })} />);
        expect(view.container.querySelector('[data-testid="restored-media-img-1"]')).toBeNull();
    });
});
