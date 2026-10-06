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

/**
 * Marca de infraccion: la imagen ANTERIOR sigue pintada cuando ya se pidio otra.
 * Devuelve [] si el estado es sano.
 */
export function previousImageOffenders(
    state: { imageUrl: string | null },
    previousUrl: string,
): string[] {
    return state.imageUrl === previousUrl
        ? ['la imagen anterior sigue pintada despues de pedir la nueva']
        : [];
}

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
        expect(previousImageOffenders(result.current, 'https://img/one.png')).toEqual([]);

        await act(async () => {
            resolveSecond({ image_url: 'https://img/two.png', trace: {} });
        });
        expect(result.current.imageUrl).toBe('https://img/two.png');
    });
});

// Prueba de detector (P2.4): el MISMO criterio marca el estado infractor y no
// marca el sano; sin esto el guard seria teatro (verde para siempre).
describe('useWorkspaceImage — el detector no es decorativo', () => {
    it('marca que la imagen previa sigue pintada y no marca el estado limpio', () => {
        expect(
            previousImageOffenders({ imageUrl: 'https://img/one.png' }, 'https://img/one.png'),
        ).toHaveLength(1);
        expect(previousImageOffenders({ imageUrl: null }, 'https://img/one.png')).toEqual([]);
        expect(
            previousImageOffenders({ imageUrl: 'https://img/two.png' }, 'https://img/one.png'),
        ).toEqual([]);
    });
});
