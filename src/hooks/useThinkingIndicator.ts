import { useIntegrationStore } from '../store/integrationStore';

/**
 * Hook de observación para el indicador de procesamiento de FLU.
 *
 * Expone si FLU está procesando una solicitud de IA (`isThinking`), derivado
 * del estado efímero `uiState.isThinking` del integrationStore.
 *
 * Regla de diseño: el indicador se controla ÚNICAMENTE por `isThinking`, no por
 * `conversationState === 'THINKING'`. Esto es determinista:
 * - La consulta local de minutas (retorno instantáneo) NO activa el indicador.
 * - Otros paths que usan THINKING solo para la expresión del avatar
 *   (Pensando / Idle_1) no muestran el overlay si no hay una llamada real a la
 *   IA en curso.
 */
export function useThinkingIndicator(): { isThinking: boolean } {
    const isThinking = useIntegrationStore((s) => s.uiState.isThinking);
    return { isThinking };
}
