// @vitest-environment jsdom
// ============================================================
// useWorkspaceSearchPersonReset.test.ts — Guard de comportamiento
// ------------------------------------------------------------
// Aislamiento multiusuario del buscador del Pizarrón: al cambiar de
// participante activo, los resultados de búsqueda/imagen/video y la
// consulta deben limpiarse para no mostrar los del usuario anterior.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

describe('useWorkspaceSearch — limpiar al cambiar de participante activo', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('limpia resultados/imágenes/video y consulta al cambiar de participante', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) =>
                routeFetch(url, [sr('i1', 'https://i/1')], [sr('v1', 'https://v/1')], [sr('w1', 'https://w/1')]),
            ),
        );

        const { result, rerender } = renderHook(
            ({ participantId }) => useWorkspaceSearch({ participantId }),
            { initialProps: { participantId: 'alice' } },
        );

        await act(async () => {
            await result.current.search('gatos');
        });
        expect(result.current.state.results.length).toBe(1);
        expect(result.current.state.images.length).toBe(1);
        expect(result.current.state.video.length).toBe(1);
        expect(result.current.state.query).toBe('gatos');

        // Cambio de usuario: nada del usuario anterior debe quedar pintado.
        act(() => {
            rerender({ participantId: 'bob' });
        });
        expect(result.current.state.results).toEqual([]);
        expect(result.current.state.images).toEqual([]);
        expect(result.current.state.video).toEqual([]);
        expect(result.current.state.query).toBe('');
    });
});
