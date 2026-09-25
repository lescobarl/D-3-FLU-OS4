// ============================================================
// conversationTurnRow — commit ÚNICO de la fila de usuario por turno
// ------------------------------------------------------------
// Una locución puede intentar registrarse varias veces (commit temprano para
// mostrar la transcripción al instante, emisión cruda que crece y commit final
// con el hablante resuelto). Este módulo es el ÚNICO punto que escribe esa
// fila: dentro del TURNO ACTUAL reutiliza la fila y completa su hablante, o la
// reemplaza si la emisión crece; si no, la agrega. Así una frase ⇒ una fila.
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
    /**
     * `true` = la emisión cruda en curso crece: reemplaza la fila de usuario del
     * turno (misma locución, texto más completo) en lugar de agregar otra.
     */
    replaceLast?: boolean;
}

export type UserTurnRowAction = 'replaced' | 'reused' | 'added' | 'skipped';

export interface UserTurnRowResult {
    id: string | null;
    action: UserTurnRowAction;
}

/**
 * Registra la fila del usuario del turno en curso. Único escritor de esa fila:
 * idempotente por texto normalizado dentro del turno (reutiliza y completa
 * hablante) y por identidad de emisión cuando `replaceLast` (texto que crece).
 */
export function commitUserTurnRow({
    text,
    speakerName,
    timestamp,
    replaceLast = false,
}: UserTurnRowInput): UserTurnRowResult {
    const raw = String(text || '');
    const norm = cleanForSpeech(raw).toLowerCase();
    if (!norm) return { id: null, action: 'skipped' };
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;

    // Frontera del turno actual: todo lo posterior a la última respuesta de FLU.
    let turnStart = 0;
    for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i]?.role === 'flu') {
            turnStart = i + 1;
            break;
        }
    }

    const resolved = String(speakerName || '').trim();
    const stamp = typeof timestamp === 'number' ? timestamp : Date.now();

    // 1) Emisión que crece: reemplaza la fila de usuario del turno (una sola).
    if (replaceLast) {
        for (let i = history.length - 1; i >= turnStart; i -= 1) {
            const entry = history[i];
            if (!entry || entry.role !== 'user') continue;
            const updated = history.map((e) =>
                e.id === entry.id
                    ? { ...e, text: raw, speakerName: resolved || e.speakerName, timestamp: stamp }
                    : e,
            );
            store.batchLoadHistory(updated);
            return { id: entry.id, action: 'replaced' };
        }
    }

    // 2) Misma frase ya commiteada en el turno: reutiliza la fila y completa hablante.
    for (let i = history.length - 1; i >= turnStart; i -= 1) {
        const entry = history[i];
        if (!entry || entry.role !== 'user') continue;
        if (cleanForSpeech(entry.text || '').toLowerCase() !== norm) continue;
        if (resolved && !String(entry.speakerName || '').trim()) {
            store.setConversationEntrySpeaker(entry.id, resolved);
        }
        return { id: entry.id, action: 'reused' };
    }

    // 3) Fila nueva del turno.
    const id = uuidv4();
    store.addConversationEntry({
        id,
        role: 'user',
        text: raw,
        speakerName: resolved || undefined,
        timestamp: stamp,
        sentiment: 'neutral',
    });
    return { id, action: 'added' };
}
