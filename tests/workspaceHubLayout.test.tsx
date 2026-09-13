// @vitest-environment jsdom
// ============================================================
// Validación del layout consolidado del WorkspaceHub
// (Pizarrón unificado — "un solo objeto").
//
// El pizarrón muestra A LA VEZ (sin pestañas que oculten regiones):
//   - Columna principal (workspace-hub__main):
//       ├─ WorkspaceSearch (barra de comandos)
//       ├─ ResultFeed (feed de resultados con insignias WEB/IA/OCR)
//       └─ zona de carga
//   - Columna lateral (workspace-hub__side): HoyPanel (HOY/DIARIO/NOTAS)
//
// Cuando NO se provee `hoy`, el contenido se renderiza directo
// (sin columnas), preservando el comportamiento previo.
//
// Para aislar el layout, se mockean los hijos pesados
// (WorkspaceSearch, HorarioPizarron, DocumentResultPanel,
// AppAnalysisPanel, GenerationProgressPanel) como stubs ligeros.
// ResultFeed y HoyPanel se renderizan REALES para verificar la
// integración del feed y del panel lateral.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { HorarioRecord, DiaryEntryRecord, NoteRecord } from '../src/core/db/fluDatabase';
import type { HoyPanelProps } from '../src/components/HoyPanel';
import type { WorkspaceHubProps } from '../src/components/WorkspaceHub';

// ---- Mocks de los hijos pesados (stubs ligeros) ----
vi.mock('../src/components/WorkspaceSearch', () => ({
    WorkspaceSearch: () => <div data-testid="mock-workspace-search" />,
}));
vi.mock('../src/components/HorarioPizarron', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/components/HorarioPizarron')>();
    return {
        ...actual,
        // Stub solo el componente; conserva las funciones puras
        // (proximaClaseDe, clasesDelDia, diaDeFecha) que HoyPanel usa.
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

// Importar DESPUÉS de los mocks para que WorkspaceHub use los stubs.
import { WorkspaceHub } from '../src/components/WorkspaceHub';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime(); // Jueves 10:00
const SYNCHRONIZED_AT = new Date(NOW).toISOString();

function horario(overrides: Partial<HorarioRecord> = {}): HorarioRecord {
    return {
        id: overrides.id || 'hor-1',
        materia: overrides.materia || 'Matemáticas',
        dia: overrides.dia ?? 4,
        inicio: overrides.inicio || '08:00',
        fin: overrides.fin || '09:00',
        aula: overrides.aula,
        color: overrides.color || 'm1',
        reminders: [],
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
    };
}

function diario(overrides: Partial<DiaryEntryRecord> = {}): DiaryEntryRecord {
    return {
        id: overrides.id || 'dia-1',
        date: overrides.date || '2026-01-15',
        title: overrides.title ?? 'Mi día',
        content: overrides.content || 'Hoy fue un buen día.',
        mood: overrides.mood ?? 4,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
    };
}

function nota(overrides: Partial<NoteRecord> = {}): NoteRecord {
    return {
        id: overrides.id || 'nota-1',
        label: overrides.label || 'Comprar leche',
        done: overrides.done ?? false,
        createdAt: overrides.createdAt ?? NOW,
        updatedAt: overrides.updatedAt ?? NOW,
        sync: overrides.sync || { revision: 1, updated_at: SYNCHRONIZED_AT, deleted: false },
    };
}

function hoyProps(overrides: Partial<HoyPanelProps> = {}): HoyPanelProps {
    return {
        horario: {
            items: [horario({ id: 'hor-1', materia: 'Química', dia: 4, inicio: '12:00', fin: '13:00' })],
            loading: false,
            modo: 'semana',
            onModoChange: () => {},
            onAdd: async () => ({ ok: true }),
            onRemove: async () => {},
        },
        diary: {
            entries: [diario({ id: 'dia-1', mood: 4 })],
            loading: false,
        },
        notes: {
            notes: [nota({ id: 'nota-1', done: false })],
            loading: false,
            onToggle: async () => null,
            onRemove: async () => true,
        },
        now: () => NOW,
        language: 'es',
        ...overrides,
    };
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

describe('WorkspaceHub — layout consolidado (Pizarrón unificado)', () => {
    it('con prop `hoy` renderiza columns/main/side y coloca HoyPanel en la columna lateral', () => {
        const { container } = render(
            <WorkspaceHub {...baseProps({ hoy: hoyProps() })} />
        );

        const columns = container.querySelector('[data-testid="workspace-hub-columns"]');
        const main = container.querySelector('[data-testid="workspace-hub-main"]');
        const side = container.querySelector('[data-testid="workspace-hub-side"]');

        expect(columns).not.toBeNull();
        expect(main).not.toBeNull();
        expect(side).not.toBeNull();

        // El feed de resultados (real) vive en la columna principal.
        expect(main!.querySelector('[data-testid="result-feed"]')).not.toBeNull();

        // HoyPanel (real) aparece DENTRO de la columna lateral.
        const hoyPanel = side!.querySelector('[data-testid="hoy-panel"]');
        expect(hoyPanel).not.toBeNull();
        // Y NO dentro de la columna principal.
        expect(main!.querySelector('[data-testid="hoy-panel"]')).toBeNull();
    });

    it('sin prop `hoy` NO renderiza columnas y muestra el contenido directo', () => {
        const { container } = render(
            <WorkspaceHub {...baseProps({ hoy: undefined })} />
        );

        expect(container.querySelector('[data-testid="workspace-hub-columns"]')).toBeNull();
        expect(container.querySelector('[data-testid="workspace-hub-side"]')).toBeNull();

        // El contenido se renderiza directo (sin envoltura lateral).
        expect(container.querySelector('[data-testid="result-feed"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="hoy-panel"]')).toBeNull();
    });

    it('NO existe barra de pestañas: el pizarrón es un solo objeto sin switch', () => {
        const { container } = render(
            <WorkspaceHub {...baseProps({ hoy: hoyProps() })} />
        );

        // No debe existir la navegación de pestañas del layout fragmentado.
        expect(container.querySelector('.workspace-hub__tabs')).toBeNull();
        expect(container.querySelector('[data-testid="workspace-hub-tabs"]')).toBeNull();

        // Y el feed + el panel lateral coexisten a la vez (sin ocultarse).
        expect(container.querySelector('[data-testid="result-feed"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="hoy-panel"]')).not.toBeNull();
    });

    it('el feed consolida resultados de IA y OCR con sus insignias de origen', () => {
        const { container } = render(
            <WorkspaceHub
                {...baseProps({
                    hoy: hoyProps(),
                    latestResponse: 'Aquí tienes la respuesta de Flu.',
                    document: {
                        isAnalyzing: false,
                        error: null,
                        warnings: [],
                        artifact: { id: 'doc-1' } as any,
                        clear: () => {},
                    },
                })}
            />
        );

        const feed = container.querySelector('[data-testid="result-feed"]');
        expect(feed).not.toBeNull();

        // El feed puede abrir en la pestaña de su artefacto (imagen/video); para
        // ver la consolidación completa se selecciona "Todo".
        fireEvent.click(feed!.querySelector('[data-filter="all"]')!);

        // Tarjeta IA (texto) y tarjeta OCR (documento) presentes.
        expect(feed!.querySelector('[data-testid="result-feed-card-ia-texto"]')).not.toBeNull();
        expect(feed!.querySelector('[data-testid="result-feed-card-ocr-documento"]')).not.toBeNull();

        // Insignias de origen.
        const badges = Array.from(feed!.querySelectorAll('.result-feed__badge')).map((b) =>
            b.textContent
        );
        expect(badges).toContain('IA');
        expect(badges).toContain('OCR');

        // Los cuatro filtros de tipo existen.
        const filters = Array.from(feed!.querySelectorAll('.result-feed__filter')).map((b) =>
            b.getAttribute('data-filter')
        );
        expect(filters).toEqual(['all', 'image', 'media', 'history']);
    });

    it('la columna lateral conserva el HoyPanel (HOY/NOTAS; SIN DIARIO)', () => {
        const { container } = render(
            <WorkspaceHub {...baseProps({ hoy: hoyProps() })} />
        );

        const side = container.querySelector('[data-testid="workspace-hub-side"]');
        expect(side).not.toBeNull();

        const hoyPanel = side!.querySelector('[data-testid="hoy-panel"]');
        expect(hoyPanel).not.toBeNull();
        expect(hoyPanel!.querySelector('[data-testid="hoy-block"]')).not.toBeNull();
        // El bloque DIARIO se quitó del panel por decisión de producto.
        expect(hoyPanel!.querySelector('[data-testid="diario-block"]')).toBeNull();
        expect(hoyPanel!.querySelector('[data-testid="notas-block"]')).not.toBeNull();
    });
});
