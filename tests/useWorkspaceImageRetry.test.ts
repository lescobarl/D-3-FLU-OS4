// ============================================================
// #4 — REINTENTAR LA IMAGEN APLICA EL RESULTADO (guard de COMPORTAMIENTO)
// ------------------------------------------------------------
// Defecto medido al leer el codigo (introducido en 12da3ea, "P4.8 un orden en
// la cascada de imagen"): `applyImageResult` quedo con una llamada a SI MISMA
// y sin el cuerpo que aplica el resultado:
//
//   if (requestRef.current !== requestId) return false;
//       applyImageResult(result, requestId);   // recursa
//   setIsLoading(false);
//   setIsFailed(true);
//
// `retry` la usa dentro de un `.then` SIN `.catch`, asi que el RangeError de la
// recursion deja `isLoading` en `true` para siempre -> la tarjeta se queda en
// "Generando..." (ImageGrid) y la imagen nunca se pinta.
//
// Invariante: reintentar con exito fija la URL, quita `isLoading` y quita
// `isFailed`.
// ============================================================
// @vitest-environment jsdom
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

/**
 * Marca de infraccion: la tarjeta quedaria atascada en "Generando..." sin
 * imagen. Devuelve [] si el estado es sano.
 */
export function stuckImageOffenders(state: { isLoading: boolean; imageUrl: string | null }): string[] {
    return state.isLoading && !state.imageUrl
        ? ['la tarjeta quedaria en "Generando..." (isLoading) sin imagen']
        : [];
}

describe('#4 — reintentar la imagen aplica el resultado', () => {
    beforeEach(() => {
        generateMock.mockReset();
    });

    it('retry con exito fija la URL, quita loading y quita failed', async () => {
        // 1) Generacion inicial que NO trae imagen (deja promptRef y isFailed).
        generateMock.mockResolvedValueOnce({ image_url: '', trace: {} });
        const { result } = renderHook(() => useWorkspaceImage('es'));
        await act(async () => {
            await result.current.generateFromContract('un gato', 'image_prompt');
        });
        expect(result.current.isFailed).toBe(true);
        expect(result.current.isLoading).toBe(false);

        // 2) Reintento que SI trae imagen.
        generateMock.mockResolvedValueOnce({ image_url: 'https://img/ok.png', trace: {} });
        await act(async () => {
            result.current.retry();
        });

        expect(result.current.imageUrl).toBe('https://img/ok.png');
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isFailed).toBe(false);
        expect(stuckImageOffenders(result.current)).toEqual([]);
    });
});

// Prueba de detector (P2.4): el MISMO criterio marca el estado atascado y no
// marca el sano; sin esto el guard seria teatro (verde para siempre).
describe('#4 — el detector no es decorativo', () => {
    it('marca el estado atascado en "Generando..." y no marca el sano', () => {
        expect(stuckImageOffenders({ isLoading: true, imageUrl: null })).toHaveLength(1);
        expect(stuckImageOffenders({ isLoading: false, imageUrl: 'https://img/ok.png' })).toEqual([]);
        expect(stuckImageOffenders({ isLoading: false, imageUrl: null })).toEqual([]);
    });
});
