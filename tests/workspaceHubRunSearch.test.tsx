// @vitest-environment jsdom
// ============================================================
// Validación del flujo de voz RUN_SEARCH → feed consolidado.
//
// Escenario productivo: un comando de voz NAVEGAR/BUSCAR dispara
// el evento `flu:run-search` (dispatchFluSearch). WorkspaceHub lo
// consume vía onFluSearch y ejecuta runSearch({ query, lang }), que
// pide web/imágenes/vídeo al proxy (fetch global) y vuelca los
// resultados al feed consolidado (Sección 2) como tarjeta WEB.
//
// Para aislar el flujo se mockean los hijos pesados y el `fetch`
// global (los hooks de búsqueda usan el fetch global, no axios).
// ResultFeed se renderiza REAL para verificar la integración
// evento → búsqueda → tarjeta WEB en el feed.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { HorarioRecord, DiaryEntryRecord, NoteRecord } from '../src/core/db/fluDatabase';
import type { HoyPanelProps } from '../src/components/HoyPanel';
import type { WorkspaceHubProps } from '../src/components/WorkspaceHub';
import type { SearchResult } from '../src/core/search/searchSession';

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
vi.mock('../src/components/ImageGrid', () => ({
    ImageGrid: () => <div data-testid="mock-image-grid" />,
}));
vi.mock('../src/components/VideoGrid', () => ({
    VideoGrid: () => <div data-testid="mock-video-grid" />,
}));

// Importar DESPUÉS de los mocks para que WorkspaceHub use los stubs.
import { WorkspaceHub } from '../src/components/WorkspaceHub';
import { dispatchFluSearch } from '../src/core/events/fluEvents';

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
        liveTranscript: '',
        currentTranscript: '',
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
            fallbackToGemini: async () => {},
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

// ---- Datos productivos de búsqueda ----
function webResult(overrides: Partial<SearchResult> = {}): SearchResult {
    return {
        title: overrides.title || 'Fotos de gatos — Wikipedia',
        snippet: overrides.snippet || 'Artículo sobre la historia y cuidados de los gatos domésticos.',
        url: overrides.url || 'https://es.wikipedia.org/wiki/Gato',
        host: overrides.host || 'es.wikipedia.org',
        source: overrides.source || 'wikipedia',
        allowed: overrides.allowed ?? true,
        type: overrides.type || 'web',
        ...overrides,
    };
}

/**
 * Mock del fetch global: enruta por URL.
 *  - /api/search/web      → { ok: true, results: [webResult] }
 *  - /api/search/images   → { ok: true, results: [] }
 *  - /api/search/video    → { ok: true, results: [] }
 *  - /api/gemini/contract → { respuesta_voz: '' } (IA no aporta texto)
 */
function installFetchMock(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/search/web')) {
            return {
                ok: true,
                json: async () => ({ ok: true, results: [webResult()] }),
            } as Response;
        }
        if (url.includes('/api/search/images')) {
            return {
                ok: true,
                json: async () => ({ ok: true, results: [] }),
            } as Response;
        }
        if (url.includes('/api/search/video')) {
            return {
                ok: true,
                json: async () => ({ ok: true, results: [] }),
            } as Response;
        }
        if (url.includes('/api/gemini/contract')) {
            return {
                ok: true,
                json: async () => ({ respuesta_voz: '' }),
            } as Response;
        }
        return {
            ok: false,
            json: async () => ({ ok: false, results: [] }),
        } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('WorkspaceHub — flujo de voz RUN_SEARCH → feed consolidado', () => {
    beforeEach(() => {
        installFetchMock();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('un comando de voz (RUN_SEARCH) vuelca resultados web al feed como tarjeta WEB', async () => {
        render(<WorkspaceHub {...baseProps({ hoy: hoyProps() })} />);

        // El feed arranca vacío (sin tarjeta web-resultados).
        expect(screen.queryByTestId('result-feed-card-web-resultados')).toBeNull();

        // Dispara el evento de voz NAVEGAR/BUSCAR y deja que la búsqueda
        // asíncrona (3 fetches en paralelo + overview de IA) resuelva
        // dentro de `act` para que los setState queden cubiertos.
        await act(async () => {
            dispatchFluSearch({ query: 'fotos de gatos', lang: 'es' });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        // La tarjeta WEB ya debe estar en el feed.
        expect(screen.getByTestId('result-feed-card-web-resultados')).toBeTruthy();

        const card = screen.getByTestId('result-feed-card-web-resultados');
        // Origen WEB y tipo texto.
        expect(card.getAttribute('data-origin')).toBe('web');
        expect(card.getAttribute('data-kind')).toBe('text');
        // Insignia WEB.
        expect(card.textContent).toContain('Web');
        // El resultado productivo se renderiza con su enlace.
        expect(card.querySelector('.workspace-search__result-link')?.textContent).toBe(
            'Fotos de gatos — Wikipedia',
        );
        expect(card.querySelector('.workspace-search__result-host')?.textContent).toBe(
            'es.wikipedia.org',
        );
    });

    it('el fetch se invoca para web, imágenes y vídeo en paralelo (proxy)', async () => {
        const fetchMock = installFetchMock();
        render(<WorkspaceHub {...baseProps({ hoy: hoyProps() })} />);

        await act(async () => {
            dispatchFluSearch({ query: 'recetas de cocina', lang: 'es' });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(screen.getByTestId('result-feed-card-web-resultados')).toBeTruthy();

        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes('/api/search/web'))).toBe(true);
        expect(urls.some((u) => u.includes('/api/search/images'))).toBe(true);
        expect(urls.some((u) => u.includes('/api/search/video'))).toBe(true);
    });
});
