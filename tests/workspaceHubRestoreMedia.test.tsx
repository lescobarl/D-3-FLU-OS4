// @vitest-environment jsdom
// ============================================================
// Guard de comportamiento — Caso 4
// ------------------------------------------------------------
// Al pedir un video nuevo, la restauración del historial no debe
// repintar el video anterior mientras el nuevo se genera: sólo se
// pinta el nuevo al llegar.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { DocumentRecord } from '../src/core/db/fluDatabase';
import type { WorkspaceHubProps } from '../src/components/WorkspaceHub';

vi.mock('../src/components/WorkspaceSearch', () => ({
    WorkspaceSearch: () => <div data-testid="mock-workspace-search" />,
}));
vi.mock('../src/components/HorarioPizarron', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/components/HorarioPizarron')>();
    return {
        ...actual,
        HorarioPizarron: () => <div data-testid="mock-horario-pizarron" />,
    };
});
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
const SYNCHRONIZED_AT = new Date(NOW).toISOString();

const persistedVideo: DocumentRecord = {
    id: 'vid-1',
    kind: 'generated',
    formato: 'video',
    titulo: 'Video anterior',
    nombre: 'video.mp4',
    ref: 'https://example.test/video.mp4',
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
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
        document: {
            isAnalyzing: false,
            error: null,
            warnings: [],
            artifact: null,
            clear: () => {},
        },
        app: {
            isAnalyzing: false,
            error: null,
            artifact: null,
            clear: () => {},
        },
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
        ...overrides,
    };
}

describe('WorkspaceHub — no repinta el video anterior al generar uno nuevo', () => {
    it('no restaura el video persistido mientras hay una generación en curso', () => {
        const { container } = render(
            <WorkspaceHub
                {...baseProps({
                    documents: {
                        documents: [persistedVideo],
                        loading: false,
                        onRemove: () => {},
                        language: 'es',
                    },
                    generation: {
                        isGenerating: true,
                        error: null,
                        job: null,
                        result: null,
                        videoResult: null,
                        clear: () => {},
                    },
                })}
            />
        );

        expect(container.querySelector('[data-testid="restored-media-vid-1"]')).toBeNull();
    });
});
