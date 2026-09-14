// @vitest-environment jsdom
// ============================================================
// Guard de comportamiento — Caso 2
// ------------------------------------------------------------
// Al pedir una imagen nueva, el resultado anterior debe limpiarse
// de inmediato (imageUrl=null) y sólo pintarse el nuevo al llegar.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspaceImage } from '../src/hooks/useWorkspaceImage';

const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));

vi.mock('../src/services/aiServiceFactory', () => ({
    aiService: { generateWorkspaceImage: generateMock },
}));
vi.mock('../src/voice/lib/imageGeneration', () => ({
    fetchOpenRouterImageFallback: vi.fn(async () => ({ image_url: '', trace: {} })),
}));
vi.mock('../src/core/config/appConfig', () => ({ resolveTextApiKey: () => '' }));
vi.mock('../src/lib/clientLogRelay', () => ({ relayLog: () => {} }));

type ImageResult = { image_url: string; trace: Record<string, unknown> };

describe('useWorkspaceImage — limpieza de la imagen anterior', () => {
    beforeEach(() => {
        generateMock.mockReset();
    });

    it('limpia la imagen previa al iniciar una petición nueva', async () => {
        generateMock.mockResolvedValueOnce({ image_url: 'https://img/one.png', trace: {} });
        const { result } = renderHook(() => useWorkspaceImage('es'));

        await act(async () => {
            await result.current.generateFromContract('un gato', 'image_prompt');
        });
        expect(result.current.imageUrl).toBe('https://img/one.png');

        let resolveSecond: (value: ImageResult) => void = () => {};
        generateMock.mockImplementationOnce(
            () =>
                new Promise<ImageResult>((resolve) => {
                    resolveSecond = resolve;
                }),
        );

        act(() => {
            void result.current.generateFromContract('un perro', 'image_prompt');
        });
        // La anterior ya no debe estar pintada mientras llega la nueva.
        expect(result.current.imageUrl).toBeNull();

        await act(async () => {
            resolveSecond({ image_url: 'https://img/two.png', trace: {} });
        });
        expect(result.current.imageUrl).toBe('https://img/two.png');
    });
});
