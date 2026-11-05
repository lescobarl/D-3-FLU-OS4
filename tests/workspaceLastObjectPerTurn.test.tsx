// @vitest-environment jsdom
// ============================================================
// EL ULTIMO OBJETO DE CADA TIPO NO SE BORRA (se recupera en el turno siguiente)
// ------------------------------------------------------------
// DEFECTO DEL DUENO: "ESTA BORRANDO EL ULTIMO OBJETO".
//
// Causa medida en el codigo: `dismissedKinds` (WorkspaceHub) solo CRECIA. El
// descarte nace para no repintar el artefacto viejo MIENTRAS se produce el nuevo
// (y en el mismo turno si la peticion termina sin resultado: casos 2 y 4, que
// siguen vigilados en workspaceMediaResetOnRequest.test.tsx). Pero al no
// soltarse NUNCA, una busqueda o una generacion fallida dejaba fuera del
// Pizarron, para el resto de la sesion, el ultimo objeto de su tipo: la imagen
// o el video persistidos que SI seguian siendo el ultimo de su tipo.
//
// REGLA VIGILADA: el descarte vale para el TURNO que lo provoco. Al empezar un
// turno nuevo (`turnFocus.seq` avanza, la senal por turno que ya manda App) el
// ultimo objeto de cada tipo vuelve a estar disponible. Dentro del mismo turno
// el descarte sigue siendo definitivo.
//
// PRIORIDAD DE LA SELECCION (un solo dueno, documentado): VIDEO -> IMAGEN ->
// DOC -> HISTORIAL -> TODO. Se vigila aqui para que no vuelva a divergir.
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
import { pickPriorityFilter } from '../src/components/ResultFeed';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const SYNC_AT = new Date(NOW).toISOString();
const sync = { revision: 1, updated_at: SYNC_AT, deleted: false };

function record(id: string, formato: string, ref: string): DocumentRecord {
    return {
        id,
        kind: 'generated',
        formato,
        titulo: `${formato} ultimo`,
        nombre: id,
        ref,
        createdAt: NOW,
        updatedAt: NOW,
        sync,
    };
}

const persistedVideo = record('vid-1', 'video', 'https://example.test/video.mp4');
const persistedImage = record('img-1', 'image', 'https://example.test/imagen.png');

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
        documents: documentsOf([persistedVideo, persistedImage]),
        ...overrides,
    };
}

/** Peticion de imagen en curso: el descarte legitimo del turno. */
const imageBusy = () => ({ ...baseProps().image, isLoading: true });

describe('1. el descarte del turno no es permanente: el ultimo objeto vuelve', () => {
    it('imagen: peticion en curso la descarta, pero el TURNO SIGUIENTE la recupera', () => {
        const view = render(
            <WorkspaceHub
                {...baseProps({
                    image: imageBusy(),
                    turnFocus: { kind: 'image', seq: 1 },
                })}
            />,
        );
        // Mientras la peticion esta en curso, el anterior NO se pinta (correcto).
        expect(view.container.querySelector('[data-testid="restored-media-img-1"]')).toBeNull();

        // Termina sin resultado (fallo) DENTRO del mismo turno: sigue sin pintarse
        // (casos 2 y 4 siguen vivos).
        view.rerender(
            <WorkspaceHub
                {...baseProps({
                    documents: documentsOf([persistedVideo, persistedImage]),
                    turnFocus: { kind: 'image', seq: 1 },
                })}
            />,
        );
        expect(view.container.querySelector('[data-testid="restored-media-img-1"]')).toBeNull();

        // TURNO NUEVO: el ultimo objeto de su tipo NO puede seguir borrado.
        view.rerender(
            <WorkspaceHub
                {...baseProps({
                    documents: documentsOf([persistedVideo, persistedImage]),
                    turnFocus: { kind: 'image', seq: 2 },
                })}
            />,
        );
        expect(view.container.querySelector('[data-testid="restored-media-img-1"]')).not.toBeNull();
    });

    it('video: la generacion en curso lo descarta, el TURNO SIGUIENTE lo recupera', () => {
        const generando = {
            isGenerating: true,
            error: null,
            job: { formato: 'video' },
            result: null,
            videoResult: null,
            clear: () => {},
        };
        const view = render(
            <WorkspaceHub
                {...baseProps({
                    documents: documentsOf([persistedVideo, persistedImage]),
                    generation: generando as never,
                    turnFocus: { kind: 'video', seq: 1 },
                })}
            />,
        );
        expect(view.container.querySelector('[data-testid="restored-media-vid-1"]')).toBeNull();

        view.rerender(
            <WorkspaceHub
                {...baseProps({
                    documents: documentsOf([persistedVideo, persistedImage]),
                    turnFocus: { kind: 'video', seq: 2 },
                })}
            />,
        );
        expect(view.container.querySelector('[data-testid="restored-media-vid-1"]')).not.toBeNull();
    });
});

describe('2. prioridad de la seleccion: VIDEO -> IMAGEN -> DOC -> HISTORIAL -> TODO', () => {
    const item = (kind: 'video' | 'image' | 'doc' | 'text' | 'history', onlyInKind = true) =>
        ({ id: kind, origin: 'ia' as const, kind, title: kind, body: null, onlyInKind });

    it('con video e imagen gana VIDEO', () => {
        expect(pickPriorityFilter([item('image'), item('video')])).toBe('media');
    });

    it('con imagen y doc gana IMAGEN', () => {
        expect(pickPriorityFilter([item('doc'), item('image')])).toBe('image');
    });

    it('con doc e historial gana DOC', () => {
        expect(pickPriorityFilter([item('history'), item('doc')])).toBe('media');
    });

    it('sin objetos de tipo: TODO', () => {
        expect(pickPriorityFilter([item('text', false)])).toBe('all');
        expect(pickPriorityFilter([])).toBe('all');
    });
});
