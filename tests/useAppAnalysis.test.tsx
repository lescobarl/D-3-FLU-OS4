// @vitest-environment jsdom
// ============================================================
// useAppAnalysis - analisis estatico + LLM de una app (F2, 0%)
// ------------------------------------------------------------
// Fronteras sustituidas: el analizador estatico (manifest/rutas), aiService.analyzeApp
// y el store global. El hook real decide cuando analiza, que input estatico reenvia,
// como publica el contrato y como degrada ante fallos del analizador o del LLM.
// ============================================================
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    analyzeApp: vi.fn(),
    analyzeAppStructure: vi.fn(),
    store: {
        appAnalysisArtifact: null as unknown,
        setAppAnalysisArtifact: vi.fn(),
    },
}));

vi.mock('../src/services/aiServiceFactory', () => ({ aiService: { analyzeApp: dobles.analyzeApp } }));
vi.mock('../src/lib/appAnalyzer', () => ({ analyzeAppStructure: dobles.analyzeAppStructure }));
vi.mock('../src/store/integrationStore', () => ({
    useIntegrationStore: (selector: (s: typeof dobles.store) => unknown) => selector(dobles.store),
}));

import { useAppAnalysis } from '../src/hooks/useAppAnalysis';

const input = {
    proyecto: 'mi-app',
    ficheros: ['src/main.ts'],
    contenidos: { 'src/main.ts': 'console.log(1)' },
};
const contractOut = { proyecto: 'mi-app', pantallas: [], flujos: [], resumen: 'r' };

const montar = () => renderHook(() => useAppAnalysis('es'));

beforeEach(() => {
    dobles.analyzeApp.mockReset();
    dobles.analyzeAppStructure.mockReset();
    dobles.store.appAnalysisArtifact = null;
    dobles.store.setAppAnalysisArtifact.mockReset();
    dobles.store.setAppAnalysisArtifact.mockImplementation((v: unknown) => {
        dobles.store.appAnalysisArtifact = v;
    });
    dobles.analyzeAppStructure.mockReturnValue({ input, heuristic: contractOut });
    dobles.analyzeApp.mockResolvedValue(contractOut);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Bloque: validacion de entrada (no toca las fronteras)
// ------------------------------------------------------------
describe('useAppAnalysis - validacion', () => {
    it('sin nombre de proyecto devuelve null y no analiza nada', async () => {
        const { result } = montar();

        let salida: unknown = 'sin-asignar';
        await act(async () => {
            salida = await result.current.analyzeProject('', ['a.ts']);
        });

        expect(salida).toBeNull();
        expect(dobles.analyzeAppStructure).not.toHaveBeenCalled();
        expect(dobles.analyzeApp).not.toHaveBeenCalled();
    });
});

// ------------------------------------------------------------
// Bloque: analisis y publicacion del contrato
// ------------------------------------------------------------
describe('useAppAnalysis - analisis', () => {
    it('analiza con el input estatico y publica el contrato en el store', async () => {
        const { result, rerender } = montar();

        let salida: unknown = null;
        await act(async () => {
            salida = await result.current.analyzeProject('mi-app', ['src/main.ts'], { 'src/main.ts': 'x' });
        });
        rerender();

        expect(salida).toEqual(contractOut);
        expect(result.current.appAnalysisArtifact).toEqual(contractOut);
        expect(result.current.error).toBeNull();
        expect(dobles.analyzeApp).toHaveBeenCalledWith(input, 'es');
    });

    it('reenvia proyecto, ficheros y contenidos al analizador estatico', async () => {
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeProject('mi-app', ['src/main.ts'], { 'src/main.ts': 'x' });
        });

        expect(dobles.analyzeAppStructure).toHaveBeenCalledWith('mi-app', ['src/main.ts'], { 'src/main.ts': 'x' });
    });

    it('el idioma explicito gana al del hook', async () => {
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeProject('mi-app', [], undefined, 'en');
        });

        expect(dobles.analyzeApp).toHaveBeenCalledWith(input, 'en');
    });

    it('marca isAnalyzing mientras el LLM esta pendiente', async () => {
        let resolver: (v: unknown) => void = () => {};
        dobles.analyzeApp.mockImplementationOnce(
            () =>
                new Promise((res) => {
                    resolver = res;
                }),
        );
        const { result } = montar();

        let pendiente: Promise<unknown> = Promise.resolve();
        act(() => {
            pendiente = result.current.analyzeProject('mi-app', []);
        });
        await waitFor(() => {
            expect(result.current.isAnalyzing).toBe(true);
        });

        await act(async () => {
            resolver(contractOut);
            await pendiente;
        });
        expect(result.current.isAnalyzing).toBe(false);
    });
});

// ------------------------------------------------------------
// Bloque: errores y limpieza
// ------------------------------------------------------------
describe('useAppAnalysis - errores y clear', () => {
    it('si el analizador estatico lanza se fija el error y no se llama al LLM', async () => {
        dobles.analyzeAppStructure.mockImplementation(() => {
            throw new Error('estructura rota');
        });
        const { result } = montar();

        let salida: unknown = 'sin-asignar';
        await act(async () => {
            salida = await result.current.analyzeProject('mi-app', []);
        });

        expect(salida).toBeNull();
        expect(result.current.error).toBe('estructura rota');
        expect(result.current.isAnalyzing).toBe(false);
        expect(dobles.analyzeApp).not.toHaveBeenCalled();
    });

    it('si el LLM rechaza se fija el mensaje y devuelve null', async () => {
        dobles.analyzeApp.mockRejectedValue(new Error('llm caido'));
        const { result } = montar();

        let salida: unknown = 'sin-asignar';
        await act(async () => {
            salida = await result.current.analyzeProject('mi-app', []);
        });

        expect(salida).toBeNull();
        expect(result.current.error).toBe('llm caido');
    });

    it('un fallo no-Error se convierte a texto', async () => {
        dobles.analyzeApp.mockRejectedValue('fallo-texto');
        const { result } = montar();

        await act(async () => {
            await result.current.analyzeProject('mi-app', []);
        });

        expect(result.current.error).toBe('fallo-texto');
    });

    it('clear limpia el artifacto y el error', async () => {
        const { result, rerender } = montar();
        await act(async () => {
            await result.current.analyzeProject('mi-app', []);
        });
        rerender();
        expect(result.current.appAnalysisArtifact).toEqual(contractOut);

        act(() => {
            result.current.clear();
        });
        rerender();

        expect(result.current.appAnalysisArtifact).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.isAnalyzing).toBe(false);
    });
});
