// @vitest-environment jsdom
// ============================================================
// Guard de comportamiento — Caso 2 (mitad "búsqueda web")
// ------------------------------------------------------------
// Una búsqueda nueva REEMPLAZA los resultados previos: al iniciarla,
// las imágenes/vídeos/resultados anteriores deben quedar vacíos de
// inmediato, sin esperar a que lleguen los nuevos. Hoy NO se vacían
// (solo se marca loading) → el artefacto anterior queda "colgado".
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkspaceSearch } from '../src/hooks/useWorkspaceSearch';

vi.mock('../src/services/geminiContractClient', () => ({
    postGeminiContract: vi.fn(async () => ({ ok: false, json: async () => ({}) })),
}));

const sr = (title: string, url: string) => ({ title, url, host: 'host', snippet: '' });

function jsonResponse(payload: unknown): Response {
    return { ok: true, json: async () => payload } as unknown as Response;
}

function routeFetch(url: string, images: unknown[], video: unknown[], web: unknown[]): Response {
    const u = String(url);
    if (u.includes('/images')) return jsonResponse({ ok: true, results: images });
    if (u.includes('/video')) return jsonResponse({ ok: true, results: video });
    return jsonResponse({ ok: true, results: web });
}

describe('useWorkspaceSearch — limpiar resultados previos al iniciar', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('vacía imágenes/vídeo/resultados al iniciar la búsqueda (antes de recibir)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) =>
                routeFetch(url, [sr('i1', 'https://i/1')], [sr('v1', 'https://v/1')], [sr('w1', 'https://w/1')]),
            ),
        );

        const { result } = renderHook(() => useWorkspaceSearch({ overrides: {} }));
        await act(async () => {
            await result.current.search('gatos');
        });
        expect(result.current.state.images.length).toBe(1);
        expect(result.current.state.video.length).toBe(1);
        expect(result.current.state.results.length).toBe(1);

        // Segunda búsqueda: la red queda pendiente a propósito.
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        (global.fetch as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
            async (url: string) => {
                await gate;
                return routeFetch(url, [], [], []);
            },
        );

        act(() => {
            void result.current.search('perros');
        });
        // De inmediato: nada del turno anterior debe seguir pintado.
        expect(result.current.state.images).toEqual([]);
        expect(result.current.state.video).toEqual([]);
        expect(result.current.state.results).toEqual([]);

        await act(async () => {
            release();
        });
        await waitFor(() => expect(result.current.state.loading).toBe(false));
    });
});
