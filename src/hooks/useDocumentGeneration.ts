// ============================================================
// useDocumentGeneration — Hook F3/F4: generación de documentos y video
// ============================================================
// Flujo (F3):
//   1. Fuentes auto-construidas desde los artifactos del store
//   2. aiService.generateDocument (LLM contenido → adaptador serializa)
//   3. Resultado descargable + generationJob (progreso) en el store
// Flujo (F4): guion via generateDocument(formato:'video') → assembleVideo
// ============================================================

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { aiService } from '../services/aiServiceFactory';
import { useIntegrationStore } from '../store/integrationStore';
import { assembleVideo, type VideoAssemblyResult } from '../services/videoAssembler';
import type {
    GenerationFormato,
    GenerationParams,
    GenerationSource,
    GenerationJob,
} from '../types/documentContracts';
import type { GeneratedDocumentResult } from '../core/ai/IAIService';

export interface DocumentGenerationState {
    isGenerating: boolean;
    error: string | null;
    generationJob: GenerationJob | null;
    result: GeneratedDocumentResult | null;
    videoResult: VideoAssemblyResult | null;
    /** Generar un documento (F3) o guion+video (F4). */
    generate: (
        formato: GenerationFormato,
        opts?: {
            parametros?: GenerationParams;
            fuentes?: GenerationSource[];
            contenido?: string;
        },
    ) => Promise<GeneratedDocumentResult | null>;
    clear: () => void;
}

/** Progreso por estado del job (pendiente→…→listo/error). */
const STATE_PROGRESS: Record<string, number> = {
    pendiente: 5,
    analizando: 25,
    escribiendo: 60,
    ensamblando: 85,
    listo: 100,
    error: 100,
};

export function useDocumentGeneration(language: string): DocumentGenerationState {
    const generationJob = useIntegrationStore((s) => s.generationJob);
    const setGenerationJob = useIntegrationStore((s) => s.setGenerationJob);
    const documentArtifact = useIntegrationStore((s) => s.documentArtifact);
    const appAnalysisArtifact = useIntegrationStore((s) => s.appAnalysisArtifact);

    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<GeneratedDocumentResult | null>(null);
    const [videoResult, setVideoResult] = useState<VideoAssemblyResult | null>(null);

    const setJob = useCallback(
        (estado: GenerationJob['estado'], formato: string, extra?: Partial<GenerationJob>) => {
            const current = useIntegrationStore.getState().generationJob;
            setGenerationJob({
                id: current?.id || uuidv4(),
                estado,
                progreso: STATE_PROGRESS[estado] ?? 0,
                formato,
                timestamp: Date.now(),
                ...extra,
            });
        },
        [setGenerationJob],
    );

    /** Construye fuentes automáticamente desde los artifactos del store. */
    const buildDefaultFuentes = useCallback((): GenerationSource[] => {
        const fuentes: GenerationSource[] = [];
        const state = useIntegrationStore.getState();
        if (state.documentArtifact) {
            fuentes.push({ tipo: 'documento', ref: state.documentArtifact.nombre });
        }
        if (state.appAnalysisArtifact) {
            fuentes.push({ tipo: 'app', ref: state.appAnalysisArtifact.proyecto });
        }
        const lastResponse = state.lastResponse?.trim();
        if (lastResponse) {
            fuentes.push({ tipo: 'conversacion', ref: lastResponse.slice(0, 200) });
        }
        if (state.minuteHistory && state.minuteHistory.length > 0) {
            const minute = state.minuteHistory[0];
            const ref = minute.description
                || minute.summarySnapshot?.titulo
                || 'Minuta reciente';
            fuentes.push({ tipo: 'minuta', ref });
        }
        return fuentes;
    }, []);

    const generate = useCallback(
        async (
            formato: GenerationFormato,
            opts?: {
                parametros?: GenerationParams;
                fuentes?: GenerationSource[];
                contenido?: string;
            },
        ): Promise<GeneratedDocumentResult | null> => {
            setIsGenerating(true);
            setError(null);
            setResult(null);
            setVideoResult(null);
            try {
                const fuentes = opts?.fuentes && opts.fuentes.length > 0 ? opts.fuentes : buildDefaultFuentes();
                const parametros = opts?.parametros ?? {};

                setJob('analizando', formato);
                const docResult = await aiService.generateDocument(
                    {
                        formato,
                        parametros: parametros as GenerationInputParams,
                        fuentes,
                        contenido_analizado: opts?.contenido,
                    },
                    language,
                );
                setJob('escribiendo', formato, { progreso: 60 });

                if (formato === 'video') {
                    setJob('ensamblando', formato, { progreso: 85 });
                    const video = await assembleVideo(docResult.content || '', {
                        calidad: parametros.calidad,
                        duracion_min: parametros.duracion_min,
                        orientacion: parametros.orientacion,
                        tema: parametros.tema,
                    }, language);
                    setVideoResult(video);
                    setJob('listo', formato, { progreso: 100 });
                    return docResult;
                }

                setJob('listo', formato, {
                    progreso: 100,
                    url_resultado: docResult.url,
                });
                setResult(docResult);
                return docResult;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn('[useDocumentGeneration] Generación falló:', err);
                setError(msg);
                setJob('error', formato, { error: msg });
                return null;
            } finally {
                setIsGenerating(false);
            }
        },
        [language, buildDefaultFuentes, setJob],
    );

    const clear = useCallback(() => {
        setGenerationJob(null);
        setResult(null);
        setVideoResult(null);
        setError(null);
        setIsGenerating(false);
    }, [setGenerationJob]);

    return {
        isGenerating,
        error,
        generationJob,
        result,
        videoResult,
        generate,
        clear,
    };
}

/** Tipo auxiliar interno para el payload del servicio (parametros). */
type GenerationInputParams = {
    calidad?: string;
    duracion_min?: number;
    orientacion?: string;
    tema?: string;
};
