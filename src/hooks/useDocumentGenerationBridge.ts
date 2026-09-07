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
import { buildGenerationTopic, type GenerationConversationSlice } from '../lib/generationTopic';
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
 * Puente eventos → acciones de análisis/generación de documentos.
 * El tema/contenido se calcula con buildGenerationTopic() (función pura en
 * src/lib/generationTopic.ts): usa el artefacto doc/video del contrato y NUNCA
 * la respuesta-filler del asistente como contenido (Bug #5/#6).
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
            const state = useIntegrationStore.getState() as unknown as GenerationConversationSlice;
            const { tema, contenido } = buildGenerationTopic(state);
            generation.generate('pdf', {
                parametros: tema ? { tema } : {},
                contenido: contenido || undefined,
            });
        };
        const onGenerateVideo = () => {
            const state = useIntegrationStore.getState() as unknown as GenerationConversationSlice;
            const { tema, contenido } = buildGenerationTopic(state);
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
