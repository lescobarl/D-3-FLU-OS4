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

import { useIntegrationStore } from '../../store/integrationStore';

/**
 * Registra una intervención hablada de FLU en el historial de conversación.
 * Idempotente por turno: si la ÚLTIMA fila ya es de FLU con el mismo texto, no
 * duplica (evita el doble registro cuando dos rutas hablan lo mismo). Un texto
 * repetido tras una fila del usuario SÍ se registra (en un juego es legítimo).
 */
export function logFluReply(text: string): void {
    const clean = String(text || '').trim();
    if (!clean) return;
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;
    const last = history[history.length - 1];
    if (last?.role === 'flu' && String(last.text || '').trim() === clean) return;
    // P9.83: si el ULTIMO turno es un evento de sistema, esta respuesta ES su respuesta.
    // Se marca de forma ESTRUCTURAL (no por el texto): el filtro de persistencia deja de
    // depender de una lista de literales que se rompia con cualquier cambio de redaccion.
    const respuestaAEvento = Boolean(last?.meta?.systemEvent);
    store.addFluMessage(clean, respuestaAEvento ? { systemEventReply: true } : undefined);
}
