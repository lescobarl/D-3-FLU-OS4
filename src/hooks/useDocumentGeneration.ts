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
import { fetchFalVideo } from '../voice/lib/imageGeneration';
import { resolveFalApiKey, resolveFalVideoModel } from '../core/config/appConfig';
import type {
    GenerationFormato,
    GenerationParams,
    GenerationSource,
    GenerationJob,
} from '../types/documentContracts';
import type { GeneratedDocumentResult } from '../core/ai/IAIService';
import { safeFileName } from '../lib/formatAdapters';

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

                // El contenido de conversación NO debe ir como contenido_analizado:
                // eso dispara el atajo que serializa el texto crudo sin pasar por el
                // LLM (el video no capturaba el tema). Se alimenta al LLM como fuente
                // de contexto para que genere un guion coherente con el tema.
                const contenido = (opts?.contenido || '').trim();
                let fuentesFinal = fuentes;
                if (contenido) {
                    // Reemplaza la fuente 'conversacion' por defecto (que solo trae la
                    // última respuesta) por el contexto completo (pregunta + respuesta),
                    // evitando duplicar la conversación en el prompt del LLM.
                    fuentesFinal = [
                        ...fuentes.filter((f) => f.tipo !== 'conversacion'),
                        { tipo: 'conversacion', ref: contenido.slice(0, 1200) },
                    ];
                }

                setJob('analizando', formato);
                const docResult = await aiService.generateDocument(
                    {
                        formato,
                        parametros: parametros as GenerationInputParams,
                        fuentes: fuentesFinal,
                        // Solo se usa cuando hay contenido genuinamente pre-analizado
                        // (flujo F3 de documento analizado); nunca la conversación cruda.
                        contenido_analizado: undefined,
                    },
                    language,
                );
                setJob('escribiendo', formato, { progreso: 60 });

                // Nombre de descarga legible: el TEMA pedido, no el contenido
                // (antes el archivo se llamaba con el texto de la carta).
                const temaNombre = String((parametros as GenerationInputParams).tema || '').trim();
                const nombreTema = temaNombre
                    ? safeFileName(temaNombre, docResult.ext || 'txt')
                    : '';
                const namedResult =
                    nombreTema && nombreTema.length > 4
                        ? { ...docResult, nombre: nombreTema }
                        : docResult;

                if (formato === 'video') {
                    setJob('ensamblando', formato, { progreso: 85 });
                    // 1) Video REAL con fal.ai (text-to-video). El prompt es el tema
                    //    pedido por el usuario ("un conejo saltando"); si no hay tema,
                    //    se usa el contenido del guion (truncado).
                    const temaPrompt = String((parametros as GenerationInputParams).tema || '').trim();
                    const falPrompt = temaPrompt || (docResult.content || '').trim().slice(0, 500);
                    const falApiKey = resolveFalApiKey();
                    if (!falApiKey) {
                        console.warn(
                            '[useDocumentGeneration] Falta la API key de fal.ai (Ajustes → Video): se genera solo guion/storyboard.',
                        );
                    }
                    const fal = falApiKey
                        ? await fetchFalVideo({
                              prompt: falPrompt,
                              language,
                              apiKey: falApiKey,
                              model: resolveFalVideoModel(),
                          })
                        : {
                              video_url: '',
                              trace: {
                                  provider: 'falai',
                                  source: 'missing_api_key',
                                  hasVideo: false,
                                  prompt: falPrompt,
                              },
                          };
                    if (fal.video_url) {
                        const realVideo: VideoAssemblyResult = {
                            url: fal.video_url,
                            script: docResult.content || '',
                            storyboard: [],
                            estimatedSeconds: 0,
                            degraded: false,
                            warnings: [],
                        };
                        setVideoResult(realVideo);
                        setJob('listo', formato, { progreso: 100, url_resultado: realVideo.url });
                        return namedResult;
                    }
                    // 2) Fallback: ensamblado offline (ffmpeg.wasm walkthrough).
                    const video = await assembleVideo(docResult.content || '', {
                        calidad: parametros.calidad,
                        duracion_min: parametros.duracion_min,
                        orientacion: parametros.orientacion,
                        tema: parametros.tema,
                    }, language);
                    if (!falApiKey) {
                        video.warnings = [
                            ...(video.warnings || []),
                            'Falta la API key de fal.ai (Ajustes → Video). Sin ella no hay video real; se generó guion/storyboard.',
                        ];
                    }
                    setVideoResult(video);
                    setJob('listo', formato, { progreso: 100, url_resultado: video.url });
                    return namedResult;
                }

                setJob('listo', formato, {
                    progreso: 100,
                    url_resultado: docResult.url,
                });
                setResult(namedResult);
                return namedResult;
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
