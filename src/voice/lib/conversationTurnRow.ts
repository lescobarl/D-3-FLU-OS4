// ============================================================
// conversationTurnRow — commit ÚNICO de la fila de usuario por turno
// ------------------------------------------------------------
// Una locución puede intentar registrarse varias veces (commit temprano para
// mostrar la transcripción al instante, emisión cruda que crece y commit final
// con el hablante resuelto). Este módulo es el ÚNICO punto que escribe esa
// fila: dentro del TURNO ACTUAL reutiliza la fila y completa su hablante, o la
// reemplaza si la emisión crece; si no, la agrega. Así una frase ⇒ una fila.
//
// El "turno actual" se identifica por SU ID (`turnId`): la fila se reutiliza por
// IDENTIDAD, no por posicion respecto a las filas de FLU. Criterio unico.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { useIntegrationStore } from '../../store/integrationStore';
import { cleanForSpeech } from './audioMath';
import { voiceProbe } from './voiceProbe';
import { isAutoSpeakerLabel, isProperSpeakerName } from './voiceIdentity';
import { resolveRegisteredSpeakerName } from './speakerLabels';

/**
 * Turno actual de la conversacion: su id y la fila de usuario que le pertenece.
 * Es lo que permite reutilizar la fila por IDENTIDAD de turno (los dos commits
 * del turno: temprano y de resolucion) en vez de por posicion respecto a FLU.
 */
let currentTurn: { id: number | string | null; rowId: string | null } = { id: null, rowId: null };

/**
 * Alias de etiqueta -> nombre (sesion). Cuando "soy Luis" renombra la etiqueta con
 * la que ese hablante venia apareciendo, TODA fila posterior escrita o completada
 * con esa etiqueta sale ya con su nombre. NO depende del microfono: es un dato de
 * sesion (log del dueno 2026-10-07 17:29-17:33: tras identificarse, sus filas
 * volvian a "Hablante 1" y la misma etiqueta se reutilizaba para otra voz).
 */
const speakerAliases = new Map<string, string>();

/** Registra el alias; devuelve 1 si cambio algo. */
export function registerSpeakerAlias(fromLabel: string, toName: string): number {
    const from = String(fromLabel || '').trim().toLowerCase();
    const to = String(toName || '').trim();
    if (!from || !to || from === to.toLowerCase()) return 0;
    if (speakerAliases.get(from) === to) return 0;
    speakerAliases.set(from, to);
    return 1;
}

/** Nombre final de un hablante: aplica los alias de sesion si los hay. */
export function resolveSpeakerAlias(speakerName: string): string {
    const name = String(speakerName || '').trim();
    return speakerAliases.get(name.toLowerCase()) || name;
}

/**
 * Hablante que puede ESCRIBIRSE en la fila del turno. DUENO UNICO de la decision,
 * consumido por la puerta unica de la fila (`commitUserTurnRow`).
 *
 * Regla: una etiqueta AUTOMATICA ("Hablante N") —y el NOMBRE de la persona que le
 * corresponde por registrado (panel) o por alias de sesion— SOLO entra con
 * evidencia acustica declarada. Sin evidencia la fila sale SIN hablante y la
 * resolucion tardia la completa por identidad de turno (`updateTurnRowSpeaker`).
 * Un nombre propio INTRODUCIDO por el texto ("soy luis") no es auto y pasa.
 *
 * @param speakerName etiqueta/nombre que aporta el que llama
 * @param evidenciaAcustica `true` si el nombre viene de una ventana de AUDIO medida
 * @param registered vinculo etiqueta->persona registrada (panel de participantes)
 * @returns el hablante a escribir ('' = sin hablante)
 */
export function resolveRowSpeakerName(
    speakerName: string,
    evidenciaAcustica: boolean,
    registered: { registeredLabel?: string; registeredName?: string } = {},
): string {
    const raw = String(speakerName || '').trim();
    if (!raw) return '';
    if (isAutoSpeakerLabel(raw) && !evidenciaAcustica) return '';
    const registrado = evidenciaAcustica ? resolveRegisteredSpeakerName(raw, registered) : '';
    return resolveSpeakerAlias(registrado || raw);
}

/** Solo para pruebas: limpia los alias de sesion. */
export function resetSpeakerAliases(): void {
    speakerAliases.clear();
}

/**
 * Un nombre PROPIO ya escrito en la fila NO lo pisa una etiqueta AUTOMATICA
 * ("Hablante N"). Medido en el log del dueno (2026-10-07): la sesion quedo
 * identificada como "Luis" y las filas acabaron en "Hablante 2/1/4/5" (D3: 8 filas)
 * porque el tick de identidad reescribia con la etiqueta generica. La etiqueta
 * automatica solo COMPLETA una fila sin hablante: nunca degrada un nombre propio.
 *
 * @param nextName etiqueta/nombre que quiere escribir el que llama
 * @param currentName hablante que la fila YA tiene
 * @returns el hablante que debe quedar
 */
export function preserveProperSpeaker(
    nextName: string,
    currentName?: string,
    evidenciaAcustica = true,
): string {
    const next = String(nextName || '').trim();
    const current = String(currentName || '').trim();
    if (!next) return current;
    // Una etiqueta AUTOMATICA ("Hablante N") solo entra con evidencia declarada: el
    // sincrono sin ventana y el tick sin clusters devolvian el FALLBACK y la fila
    // acababa con dos nombres para el mismo turno (medido 2026-10-07).
    if (isAutoSpeakerLabel(next) && !evidenciaAcustica) return current;
    if (current && isProperSpeakerName(current) && isAutoSpeakerLabel(next)) return current;
    return next;
}

/**
 * Fila del usuario por turno: permite COMPLETAR su hablante cuando el embedding
 * resuelve, que puede tardar mucho (el commit SIEMPRE gana la carrera). Sin este
 * registro, una resolucion tardia no tenia a que fila aplicarse y su etiqueta se
 * perdia -> el turno se quedaba con la etiqueta heredada ("Hablante 1").
 */
const recentTurns = new Map<string, string>();
const RECENT_TURNS_MAX = 8;

function rememberTurn(turnId: number | string | null, rowId: string): void {
    if (turnId === null || turnId === undefined || !rowId) return;
    recentTurns.set(String(turnId), rowId);
    if (recentTurns.size > RECENT_TURNS_MAX) {
        const oldest = recentTurns.keys().next().value;
        if (oldest != null) recentTurns.delete(oldest);
    }
}

/**
 * COMPLETA el hablante de la fila de un turno YA registrado (mismo dueno: la fila
 * se reutiliza por IDENTIDAD de turno). Devuelve `true` si la fila cambio.
 */
/**
 * Renombra TODA la participacion de una voz YA identificada (requisito del dueno:
 * "cuando identifique a un hablante especifico toda su participacion debe llevar
 * ese nombre; soy Luis y todo lo que lleve mi hablante debe cambiar a luis").
 *
 * Quien sabe QUE etiquetas son la MISMA voz es el dueno de los clusters
 * (`findLabelsWithSharedVoice`); aqui solo se escriben las filas, con el MISMO
 * escritor unico (`batchLoadHistory`) que el resto de la conversacion.
 *
 * @param {string[]} labels etiquetas que pertenecen a esa voz (incluye el nombre)
 * @param {string} toName nombre identificado (persona registrada)
 * @returns {number} filas cambiadas
 */
export function renameSpeakerRows(labels: string[], toName: string): number {
    const name = String(toName || '').trim();
    if (!name || !Array.isArray(labels) || !labels.length) return 0;
    const normalized = new Set(
        labels.map((l) => String(l || '').trim().toLowerCase()).filter(Boolean),
    );
    normalized.add(name.toLowerCase());
    for (const label of labels) registerSpeakerAlias(label, name);
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;
    let changed = 0;
    const updated = history.map((e) => {
        if (e.role !== 'user') return e;
        const current = String(e.speakerName || '').trim();
        if (!current || !normalized.has(current.toLowerCase())) return e;
        if (current === name) return e;
        changed += 1;
        return { ...e, speakerName: name };
    });
    if (changed) store.batchLoadHistory(updated);
    return changed;
}
export function updateTurnRowSpeaker(
    turnId: number | string | null,
    speakerName: string,
    {
        evidenciaAcustica = true,
        registeredSpeaker,
    }: {
        evidenciaAcustica?: boolean;
        registeredSpeaker?: { registeredLabel?: string; registeredName?: string };
    } = {},
): boolean {
    // MISMO DUENO que el commit (`resolveRowSpeakerName`): la resolucion tardia aplica
    // la MISMA regla (etiqueta automatica -> nombre registrado SOLO con evidencia), no
    // una copia mas pobre. Antes usaba `resolveSpeakerAlias` a secas, asi que la fila
    // que rellenaba esta via tardia salia "Hablante N" aunque la persona estuviera
    // registrada (defecto del dueno: "le puso a un registro Luis y a los demas los dejo
    // como hablante dos").
    const resolved = resolveRowSpeakerName(speakerName, evidenciaAcustica, registeredSpeaker);
    if (turnId === null || turnId === undefined || !resolved) return false;
    const rowId =
        recentTurns.get(String(turnId)) ||
        (currentTurn.id === turnId ? currentTurn.rowId : null);
    if (!rowId) return false;
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;
    const entry = history.find((e) => e.id === rowId);
    if (!entry || entry.role !== 'user') return false;
    // Una etiqueta AUTOMATICA no pisa el nombre propio ya escrito en la fila.
    const objetivo = preserveProperSpeaker(resolved, entry.speakerName, evidenciaAcustica);
    voiceProbe('row-update', {
        turnId,
        pedido: resolved,
        actual: String(entry.speakerName || ''),
        objetivo,
        cambia: String(entry.speakerName || '').trim() !== objetivo,
    });
    if (String(entry.speakerName || '').trim() === objetivo) return false;
    store.batchLoadHistory(
        history.map((e) => (e.id === rowId ? { ...e, speakerName: objetivo } : e)),
    );
    return true;
}

export interface UserTurnRowInput {
    /** Frase canónica de la locución (con wake word, tal como se muestra). */
    text: string;
    /** Hablante resuelto (puede llegar en el commit final, no en el temprano). */
    speakerName?: string;
    /**
     * Vinculo etiqueta de diarizacion -> persona registrada (panel de participantes).
     * Lo aporta el llamante; el dueno de la decision (`resolveRowSpeakerName`) lo
     * aplica SOLO con evidencia acustica declarada.
     */
    registeredSpeaker?: { registeredLabel?: string; registeredName?: string };
    /** El que llama DECLARA que el nombre viene de una ventana de AUDIO medida. */
    evidenciaAcustica?: boolean;
    /** Sentimiento de la locucion (lo calcula quien la captura); por defecto 'neutral'. */
    sentiment?: 'positive' | 'negative' | 'neutral' | 'question';
    /** Reloj inyectable (por defecto Date.now()). */
    timestamp?: number;
    /**
     * `true` = la emisión cruda en curso crece: reemplaza la fila de usuario del
     * turno (misma locución, texto más completo) en lugar de agregar otra.
     */
    replaceLast?: boolean;
    /**
     * Identidad del TURNO (obligatoria): la produce el dueno del turno al ABRIRLO
     * y la comparten el commit temprano, la emision que crece, el log crudo y la
     * resolucion. Es el UNICO criterio de reutilizacion de la fila.
     */
    turnId: number | string | null;
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
export function commitUserTurnRow(input: UserTurnRowInput): UserTurnRowResult {
    const result = commitUserTurnRowInner(input);
    const fila =
        result.id && useIntegrationStore.getState().conversationHistory.find((e) => e.id === result.id);
    const fullText = String(input.text || '');
    voiceProbe('row', {
        action: result.action,
        id: result.id,
        len: fullText.length,
        text: fullText,
        speaker: resolveSpeakerAlias(input.speakerName || ''),
        evidencia: input.evidenciaAcustica === true,
        efectivo: fila ? String(fila.speakerName || '') : '',
        turnId: input.turnId ?? null,
    });
    return result;
}

function commitUserTurnRowInner({
    text,
    speakerName,
    timestamp,
    replaceLast = false,
    turnId,
    evidenciaAcustica = true,
    registeredSpeaker,
    sentiment = 'neutral',
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

    const resolved = resolveRowSpeakerName(speakerName || '', evidenciaAcustica, registeredSpeaker);
    const stamp = typeof timestamp === 'number' ? timestamp : Date.now();

    // 1) Emisión que crece: reemplaza la fila de usuario del turno (una sola).
    if (replaceLast) {
        for (let i = history.length - 1; i >= turnStart; i -= 1) {
            const entry = history[i];
            if (!entry || entry.role !== 'user') continue;
            const updated = history.map((e) =>
                e.id === entry.id
                    ? { ...e, text: raw, speakerName: preserveProperSpeaker(resolved, e.speakerName, evidenciaAcustica), timestamp: stamp }
                    : e,
            );
            store.batchLoadHistory(updated);
            rememberTurn(turnId, entry.id);
            return { id: entry.id, action: 'replaced' };
        }
    }

    // 2) MISMO TURNO: la fila se reutiliza por IDENTIDAD de turno. El commit
    //    temprano y la resolucion del mismo turno comparten `turnId`, asi que el
    //    habla de FLU en medio NO la duplica, y una locucion DISTINTA (turno
    //    distinto) NO se fusiona con la anterior aunque FLU no haya hablado.
    //    Un solo criterio: la rama POSICIONAL (relacion prefijo/sufijo) se retiro
    //    porque era un segundo criterio para la misma decision.
    const mismoTurnoPorId = currentTurn.id === turnId && currentTurn.rowId != null;
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
                        speakerName: preserveProperSpeaker(resolved, e.speakerName, evidenciaAcustica),
                        timestamp: masCompleto ? stamp : e.timestamp,
                    }
                    : e,
            );
            store.batchLoadHistory(updated);
            rememberTurn(turnId, entry.id);
            return { id: entry.id, action: 'reused' };
        }
    }

    // 3) Fila nueva del turno.
    const id = uuidv4();
    store.addConversationEntry({
        id,
        role: 'user',
        text: raw,
        speakerName: preserveProperSpeaker(resolved, '', evidenciaAcustica) || undefined,
        timestamp: stamp,
        sentiment,
    });
    currentTurn = { id: turnId, rowId: id };
    rememberTurn(turnId, id);
    return { id, action: 'added' };
}
