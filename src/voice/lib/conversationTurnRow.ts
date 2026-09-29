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
import { phrasesRelate } from './activeListen';

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
    /**
     * `true` = resolución del MISMO turno ya iniciado: reutiliza su fila de
     * usuario aunque FLU haya hablado en medio. Sin esta marca, la frontera del
     * turno (posterior a la última fila de FLU) hacía que el cierre volviera a
     * escribir la MISMA locución como fila nueva (defecto medido: la misma orden
     * aparecía dos veces en la conversación). Un turno NUEVO no la usa: por eso
     * repetir a propósito tras una respuesta de FLU sigue abriendo fila propia.
     */
    sameTurn?: boolean;
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
    sameTurn = false,
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

    // 2) Misma LOCUCION ya commiteada en el turno: reutiliza la fila y completa
    //    hablante. La comparacion es por RELACION (prefijo/sufijo normalizado,
    //    `phrasesRelate`), no por igualdad estricta: una reemision del ASR que CRECE
    //    ("Okay Flow empiezas" -> "Okay Flow empiezas Okay Flow empieza tu") o que se
    //    recorta es la MISMA locucion, y con igualdad abria una SEGUNDA fila (defecto
    //    medido 18:12:06 y 18:12:34; la respuesta de FLU quedaba alineada a una sola).
    //    De la reemision se conserva el texto MAS COMPLETO: nunca se pierde lo dicho.
    //    `sameTurn` (resolucion del MISMO turno) ignora la frontera de FLU: la fila
    //    del turno ya existe y el cierre debe completarla, no abrir una segunda.
    const reuseFrom = sameTurn ? 0 : turnStart;
    for (let i = history.length - 1; i >= reuseFrom; i -= 1) {
        const entry = history[i];
        if (!entry || entry.role !== 'user') continue;
        const previo = cleanForSpeech(entry.text || '');
        if (!phrasesRelate(previo, raw)) continue;
        const masCompleto = norm.length > previo.toLowerCase().length;
        const updated = history.map((e) =>
            e.id === entry.id
                ? {
                    ...e,
                    text: masCompleto ? raw : e.text,
                    speakerName: resolved || e.speakerName,
                    timestamp: masCompleto ? stamp : e.timestamp,
                }
                : e,
        );
        store.batchLoadHistory(updated);
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
