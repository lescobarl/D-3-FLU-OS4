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
        // NOTA: GENERATE_DOCUMENT / GENERATE_VIDEO se eliminaron de este bus.
        // La generación de medios ahora tiene RUTA ÚNICA e idempotente en App
        // (requestMediaRef): el bus era la segunda ruta y permitía re-generar.
        const offs = [
            onFluEvent(FLU_EVENTS.ANALYZE_DOCUMENT, onAnalyzeDocument),
            onFluEvent(FLU_EVENTS.ANALYZE_APP, onAnalyzeApp),
        ];
        return () => offs.forEach((off) => off());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generation.generate]);

    return { docInputRef, projectInputRef };
}

export default useDocumentGenerationBridge;
