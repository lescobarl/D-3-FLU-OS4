// ============================================================
// fluConversationLog — escritor ÚNICO de la fila de FLU
// ------------------------------------------------------------
// FLU es un participante más: TODO lo que FLU habla debe quedar en el
// historial de conversación, porque de ahí se arma el contexto de la IA.
// Antes, la fila de FLU solo se escribía en la ruta del contrato (y excluida
// en juegos/fast-path): durante los juegos FLU no dejaba rastro y la IA
// perdía sus propias intervenciones.
//
// Regla: hablar y registrar van juntos, por este único punto.
// ============================================================

import { useIntegrationStore } from '../../store/integrationStore.ts';

/**
 * Registra una intervención hablada de FLU en el historial de conversación.
 * Idempotente por turno: si `turnId` llega y ESE turno ya tiene su fila de FLU,
 * no se escribe otra (dos rutas pueden hablar lo mismo del mismo turno). Sin
 * `turnId` (acuses y locuciones fuera de turno) la idempotencia es por
 * adyacencia: la ÚLTIMA fila de FLU con el mismo texto no se repite. Un texto
 * repetido tras una fila del usuario SÍ se registra (en un juego es legítimo).
 * @param text Texto hablado por FLU.
 * @param options.turnId Turno del que es respuesta (identidad de la fila).
 */
export function logFluReply(
    text: string,
    options: { turnId?: number | string | null } = {},
): void {
    const clean = String(text || '').trim();
    if (!clean) return;
    const turnId = String(options.turnId ?? '').trim();
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;
    if (turnId) {
        const yaRespondido = history.some(
            (entry) => entry?.role === 'flu' && String(entry?.turnId ?? '').trim() === turnId,
        );
        if (yaRespondido) return;
    }
    const last = history[history.length - 1];
    if (!turnId && last?.role === 'flu' && String(last.text || '').trim() === clean) return;
    // P9.83: si el ULTIMO turno es un evento de sistema, esta respuesta ES su respuesta.
    // Se marca de forma ESTRUCTURAL (no por el texto): el filtro de persistencia deja de
    // depender de una lista de literales que se rompia con cualquier cambio de redaccion.
    const respuestaAEvento = Boolean(last?.meta?.systemEvent);
    store.addFluMessage(
        clean,
        respuestaAEvento ? { systemEventReply: true } : undefined,
        turnId ? { turnId } : undefined,
    );
}
