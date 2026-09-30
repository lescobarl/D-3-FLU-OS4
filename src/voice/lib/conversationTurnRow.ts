// ============================================================
// conversationTurnRow — commit ÚNICO de la fila de usuario por turno
// ------------------------------------------------------------
// Una locución puede intentar registrarse varias veces (commit temprano para
// mostrar la transcripción al instante, emisión cruda que crece y commit final
// con el hablante resuelto). Este módulo es el ÚNICO punto que escribe esa
// fila: dentro del TURNO ACTUAL reutiliza la fila y completa su hablante, o la
// reemplaza si la emisión crece; si no, la agrega. Así una frase ⇒ una fila.
//
// El "turno actual" se identifica por SU ID (`turnId`, que el hook publica en el
// commit temprano y en la resolución): la fila se reutiliza por identidad, no por
// posición. Sin `turnId` (compatibilidad) se usa el criterio posicional: filas
// posteriores a la última respuesta de FLU (role 'flu'); ambiente/sistema no cierran.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { useIntegrationStore } from '../../store/integrationStore';
import { cleanForSpeech } from './audioMath';
import { phrasesRelate } from './activeListen';

/**
 * Turno actual de la conversacion: su id y la fila de usuario que le pertenece.
 * Es lo que permite reutilizar la fila por IDENTIDAD de turno (los dos commits
 * del turno: temprano y de resolucion) en vez de por posicion respecto a FLU.
 */
let currentTurn: { id: number | string | null; rowId: string | null } = { id: null, rowId: null };

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
     * Identidad del TURNO (produccion la aporta: `activeTurnIdRef`). La fila del
     * usuario se reutiliza DENTRO DEL MISMO TURNO por esta identidad, no por
     * posicion respecto a las filas de FLU: asi dos resoluciones del mismo turno
     * siguen siendo una fila aunque el motor hable en medio, y dos locuciones
     * DISTINTAS (turnos distintos) son dos filas aunque FLU no haya hablado.
     * Sin `turnId` (llamadores sin identidad de turno) se conserva el criterio
     * posicional.
     */
    turnId?: number | string | null;
}

export type UserTurnRowAction = 'replaced' | 'reused' | 'added' | 'skipped';

/**
 * DECISIÓN de escritura de la fila del usuario: ¿este payload de resolución
 * ESCRIBE en la conversación?
 *
 * Un SERVICIO (juego/ambiente/configuración) manda `effectOnly`: aplica su
 * efecto en su motor y NO escribe la conversación. La transcripción tiene su
 * único dueño (`commitAndResolveTurn`). Antes los tres fast-path pasaban
 * `transcript` a secas y escribían fila: una ruta de escritura de más.
 *
 * Función pura (no toca el store) para poder probarla directamente.
 */
export function escribeFilaDeUsuario(
    payload: { effectOnly?: boolean; userCommitOnly?: boolean; rawOnly?: boolean } | null | undefined,
    { hayTexto = false, hablable = false } = {},
): boolean {
    if (payload?.effectOnly) return false;
    if (payload?.userCommitOnly) return true;
    return hayTexto && (!payload?.rawOnly || hablable);
}

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
    turnId = null,
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

    // 2) MISMO TURNO: la fila se reutiliza por IDENTIDAD de turno cuando el
    //    llamador la aporta (produccion: el commit temprano y la resolucion del
    //    mismo turno comparten `turnId`). Asi el habla de FLU en medio NO la
    //    duplica, y una locucion DISTINTA del turno siguiente NO se fusiona con
    //    la anterior aunque FLU no haya hablado (defecto medido: se "borraba" una
    //    orden real repetida). Sin identidad (compatibilidad) el criterio es el
    //    posicional: una reemision del ASR que CRECE o se RECORTA es la MISMA
    //    locucion (relacion prefijo/sufijo, `phrasesRelate`) y se conserva el
    //    texto MAS COMPLETO: nunca se pierde lo dicho.
    const mismoTurnoPorId =
        turnId != null && currentTurn.id === turnId && currentTurn.rowId != null;
    if (mismoTurnoPorId) {
        const entry = history.find((e) => e.id === currentTurn.rowId);
        if (entry && entry.role === 'user') {
            const previo = cleanForSpeech(entry.text || '');
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
    } else if (turnId == null) {
        for (let i = history.length - 1; i >= turnStart; i -= 1) {
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
            currentTurn = { id: turnId, rowId: entry.id };
            return { id: entry.id, action: 'reused' };
        }
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
    currentTurn = { id: turnId, rowId: id };
    return { id, action: 'added' };
}
