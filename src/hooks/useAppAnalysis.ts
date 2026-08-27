// ============================================================
// useAppAnalysis — Hook F2: análisis de funcionalidad de una app
// ============================================================
// Flujo:
//   1. analyzeAppStructure (fase estática: manifest/config/rutas)
//   2. aiService.analyzeApp (LLM → AppAnalysisContract)
//   3. Resultado en integrationStore.appAnalysisArtifact
// Degradación elegante: sin API key → contrato heurístico.
// ============================================================

import { useState, useCallback } from 'react';
import { aiService } from '../services/aiServiceFactory';
import { analyzeAppStructure } from '../lib/appAnalyzer';
import { useIntegrationStore } from '../store/integrationStore';
import type { AppAnalysisContract } from '../types/documentContracts';

export interface AppAnalysisState {
    isAnalyzing: boolean;
    error: string | null;
    appAnalysisArtifact: AppAnalysisContract | null;
    /** Analizar un proyecto (estructura estática). */
    analyzeProject: (
        proyecto: string,
        files: string[],
        contents?: Record<string, string>,
        language?: string,
    ) => Promise<AppAnalysisContract | null>;
    clear: () => void;
}

export function useAppAnalysis(language: string): AppAnalysisState {
    const appAnalysisArtifact = useIntegrationStore((s) => s.appAnalysisArtifact);
    const setAppAnalysisArtifact = useIntegrationStore((s) => s.setAppAnalysisArtifact);

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const analyzeProject = useCallback(
        async (
            proyecto: string,
            files: string[],
            contents?: Record<string, string>,
            lang?: string,
        ): Promise<AppAnalysisContract | null> => {
            if (!proyecto) return null;
            setIsAnalyzing(true);
            setError(null);
            try {
                const { input } = analyzeAppStructure(proyecto, files, contents);
                const contract = await aiService.analyzeApp(input, lang ?? language);
                setAppAnalysisArtifact(contract);
                return contract;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn('[useAppAnalysis] Análisis de app falló:', err);
                setError(msg);
                return null;
            } finally {
                setIsAnalyzing(false);
            }
        },
        [language, setAppAnalysisArtifact],
    );

    const clear = useCallback(() => {
        setAppAnalysisArtifact(null);
        setError(null);
        setIsAnalyzing(false);
    }, [setAppAnalysisArtifact]);

    return {
        isAnalyzing,
        error,
        appAnalysisArtifact,
        analyzeProject,
        clear,
    };
}
