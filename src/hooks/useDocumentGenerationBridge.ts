// ============================================================
// useDocumentGenerationBridge — Hook de dominio "workspace ·
// generación". Escucha los eventos de análisis/generación
// (ANALYZE_DOCUMENT, ANALYZE_APP, GENERATE_DOCUMENT, GENERATE_VIDEO)
// del bus fluEvents y los traduce a las acciones reales: abrir el
// input de archivo o generar documento/video con el tema actual de
// la conversación. Extraído de App() (Fase 2) sin cambiar el
// comportamiento observable.
// ============================================================
import { useEffect, useRef, type MutableRefObject } from 'react';
import { FLU_EVENTS, onFluEvent } from '../core/events/fluEvents';
import { useIntegrationStore } from '../store/integrationStore';
import type { DocumentGenerationState } from './useDocumentGeneration';

export interface DocumentGenerationBridgeOptions {
    /** Motor de generación (documento F3 / video F4) resuelto en App. */
    generation: Pick<DocumentGenerationState, 'generate'>;
}

export interface DocumentGenerationBridge {
    /** Ref del input file de análisis de documentos (clic por evento). */
    docInputRef: MutableRefObject<HTMLInputElement | null>;
    /** Ref del input folder de análisis de app (clic por evento). */
    projectInputRef: MutableRefObject<HTMLInputElement | null>;
}

/**
 * Captura el TEMA actual de la conversación (última pregunta del
 * usuario + última respuesta de FLU) para que el guion/video NO sea
 * una propuesta genérica sino sobre lo que se está hablando.
 */
function buildGenerationTopic(): { tema: string; contenido: string } {
    const state = useIntegrationStore.getState();
    const history = state.conversationHistory || [];
    let lastUser = '';
    for (let i = history.length - 1; i >= 0; i--) {
        const entry = history[i];
        if (entry.role === 'user' || (entry.speakerName && entry.speakerName !== 'FLU')) {
            lastUser = (entry.text || '').trim();
            break;
        }
    }
    const lastResp = (state.lastResponse || '').trim();
    const artifact = state.workspaceArtifact;
    // Prioridad de tema: la ÚLTIMA PREGUNTA del usuario (el mandato real, p. ej.
    // "un video de un conejo hablando") es la fuente de verdad del tema. El
    // artifacto activo (titulo/contenido) es la DEFINICIÓN textual que Gemini ya
    // escribió como respuesta, NO la petición visual; usarlo como tema hacía que
    // el video/documento se generara sobre el texto de la definición en vez de
    // sobre lo que el usuario pidió. Se usa solo como respaldo si no hay pregunta.
    const tema = (lastUser || artifact?.titulo || artifact?.contenido || lastResp || '').slice(0, 200);
    const contenido = [lastUser, lastResp].filter(Boolean).join('\n').slice(0, 1200);
    return { tema, contenido };
}

/**
 * Puente eventos → acciones de análisis/generación de documentos.
 * Registra los listeners de FLU_EVENTS y expone los refs de los
 * inputs (documento/proyecto) para disparar el diálogo de archivos.
 */
export function useDocumentGenerationBridge({
    generation,
}: DocumentGenerationBridgeOptions): DocumentGenerationBridge {
    const docInputRef = useRef<HTMLInputElement>(null);
    const projectInputRef = useRef<HTMLInputElement>(null);

    // Comandos de voz → eventos de ventana (dispatch en useNavigationCommands).
    useEffect(() => {
        const onAnalyzeDocument = () => {
            docInputRef.current?.click();
        };
        const onAnalyzeApp = () => {
            projectInputRef.current?.click();
        };
        const onGenerateDocument = () => {
            const { tema, contenido } = buildGenerationTopic();
            generation.generate('pdf', {
                parametros: tema ? { tema } : {},
                contenido: contenido || undefined,
            });
        };
        const onGenerateVideo = () => {
            const { tema, contenido } = buildGenerationTopic();
            generation.generate('video', {
                parametros: tema ? { tema } : {},
                contenido: contenido || undefined,
            });
        };
        const offs = [
            onFluEvent(FLU_EVENTS.ANALYZE_DOCUMENT, onAnalyzeDocument),
            onFluEvent(FLU_EVENTS.ANALYZE_APP, onAnalyzeApp),
            onFluEvent(FLU_EVENTS.GENERATE_DOCUMENT, onGenerateDocument),
            onFluEvent(FLU_EVENTS.GENERATE_VIDEO, onGenerateVideo),
        ];
        return () => offs.forEach((off) => off());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generation.generate]);

    return { docInputRef, projectInputRef };
}

export default useDocumentGenerationBridge;
