// ============================================================
// conversationTurnRow — commit ÚNICO de la fila de usuario por turno
// ------------------------------------------------------------
// Una locución puede intentar registrarse dos veces (commit temprano para
// mostrar la transcripción al instante + commit final con el hablante ya
// resuelto). Este módulo es el ÚNICO punto que escribe esa fila: si la
// frase ya existe en el TURNO ACTUAL, reutiliza la fila y completa su
// hablante; si no, la agrega. Así una frase ⇒ una fila, con hablante.
//
// El "turno actual" son las filas posteriores a la última respuesta de FLU
// (role 'flu'); las filas ambiente/sistema no cierran el turno.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { useIntegrationStore } from '../../store/integrationStore';
import { cleanForSpeech } from './audioMath';

export interface UserTurnRowInput {
    /** Frase canónica de la locución (con wake word, tal como se muestra). */
    text: string;
    /** Hablante resuelto (puede llegar en el commit final, no en el temprano). */
    speakerName?: string;
    /** Reloj inyectable (por defecto Date.now()). */
    timestamp?: number;
}

/**
 * Registra la fila del usuario del turno en curso. Idempotente por texto
 * normalizado dentro del turno: reutiliza la fila existente y completa el
 * hablante si faltaba, en lugar de agregar una segunda fila.
 */
export function commitUserTurnRow({ text, speakerName, timestamp }: UserTurnRowInput): void {
    const raw = String(text || '');
    const norm = cleanForSpeech(raw).toLowerCase();
    if (!norm) return;
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;

    for (let i = history.length - 1; i >= 0; i -= 1) {
        const entry = history[i];
        if (!entry) continue;
        // La última respuesta de FLU marca el fin del turno: no reutilizar
        // filas de turnos anteriores (una orden repetida es una fila nueva).
        if (entry.role === 'flu') break;
        if (entry.role !== 'user') continue;
        if (cleanForSpeech(entry.text || '').toLowerCase() !== norm) continue;
        const wanted = String(speakerName || '').trim();
        if (wanted && !String(entry.speakerName || '').trim()) {
            store.setConversationEntrySpeaker(entry.id, wanted);
        }
        return;
    }

    const resolved = String(speakerName || '').trim();
    store.addConversationEntry({
        id: uuidv4(),
        role: 'user',
        text: raw,
        speakerName: resolved || undefined,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
        sentiment: 'neutral',
    });
}
