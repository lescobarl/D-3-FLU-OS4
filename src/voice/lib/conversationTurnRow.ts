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
import { foldSpeakerKey } from './speakerLabels';
import { compareCosineSignatures, getFallbackSpeaker } from './speakerCore';
import { normalizeRowSignature } from './conversationRow';
import { sameVoiceBySignature } from './speakerClusters'
import { isFragmentOfLocution } from './turnStream';

/**
 * Turno actual de la conversacion: su id y la fila de usuario que le pertenece.
 * Es lo que permite reutilizar la fila por IDENTIDAD de turno (los dos commits
 * del turno: temprano y de resolucion) en vez de por posicion respecto a FLU.
 */
let currentTurn: { id: number | string | null; rowId: string | null } = { id: null, rowId: null };

/**
 * ALIAS de sesion: etiqueta de diarizacion -> NOMBRE de la voz que dijo su nombre.
 *
 * Defecto del dueno (2026-10-12: "solo yo hable y a unos les puso Hablante 1 y a otros
 * Luis" / "le dije ok flu soy luis y no actualizo todos los Hablante 1"): la voz registrada
 * seguia escribiendo su etiqueta provisional en los turnos sin ventana de audio medida, asi
 * que UNA voz quedaba partida en dos grafias.
 *
 * Lo escribe UN solo dueno (`registerSpeakerIdentity`, el dueno del registro del nombre) y
 * alcanza SOLO la etiqueta con la que esa voz venia apareciendo: no es un mapa global de
 * etiquetas (ese mapa fue el defecto retirado: "Hablante 1" de OTRA voz heredaba "Luis").
 * Se vacia con la sesion (mismo punto que vacia los clusters).
 */
const speakerLabelAliases = new Map<string, Set<string>>();

/** Nombres con los que se ha registrado ESA etiqueta (vacio = ninguna voz la ha nombrado). */
function namesForLabel(label: string): Set<string> | undefined {
    return speakerLabelAliases.get(foldSpeakerKey(label));
}

/**
 * NOMBRE de esa etiqueta, SOLO si es INEQUIVOCA: una etiqueta nombrada por DOS voces distintas
 * no resuelve a ninguna (volveria a contaminar: "la misma etiqueta de OTRA voz hereda el
 * nombre"). Con un solo nombre, la etiqueta ES esa voz.
 */
function unambiguousNameForLabel(label: string): string {
    const names = namesForLabel(label);
    if (!names || names.size !== 1) return '';
    return names.values().next().value || '';
}

/** Fija el nombre registrado de una etiqueta de ESA voz. Dueno: `registerSpeakerIdentity`. */
export function setSpeakerLabelAlias(label: string, name: string): void {
    const key = foldSpeakerKey(label);
    const value = String(name || '').trim();
    if (!key || !value) return;
    const names = speakerLabelAliases.get(key) || new Set<string>();
    names.add(value);
    speakerLabelAliases.set(key, names);
}

/** Vacia los alias de sesion (reset de conversacion). */
export function resetSpeakerLabelAliases(): void {
    speakerLabelAliases.clear();
}

/**
 * Etiquetas que YA pertenecen a una voz nombrada (las que su alias apunta a ese nombre).
 * Lo consume el dueno del registro al renombrar: con esto el nombre alcanza TODAS las filas
 * de la voz, incluidas las que se escribieron con otra etiqueta provisional antes de que la
 * voz dijera su nombre (punto del dueno: "le dije ok flu soy luis y no actualizo todos los
 * Hablante 1"). Sin esto, el renombre solo alcanzaba la etiqueta de ese turno.
 */
export function labelsAliasedTo(name: string): string[] {
    const target = foldSpeakerKey(name);
    if (!target) return [];
    const out: string[] = [];
    speakerLabelAliases.forEach((names, key) => {
        if (names.size !== 1) return;
        const value = names.values().next().value || '';
        if (foldSpeakerKey(value) === target) out.push(key);
    });
    return out;
}
/**
 * NO hay mapa etiqueta->nombre. Un dato (la VOZ/firma), un dueno.
 *
 * Existia (`speakerAliases`) para que las filas POSTERIORES de "soy Luis" salieran ya con
 * su nombre, pero mapeaba una ETIQUETA desnuda de forma GLOBAL: en cuanto otra voz
 * reutilizaba "Hablante 1", heredaba "Luis" (defecto medido por el dueno 2026-10-10:
 * `resolveRowSpeakerName('Hablante 1', false)` devolvia 'Luis'). El renombre va por VOZ:
 * `findLabelsWithSharedVoice` (firma, en el dueno de los clusters) elige QUE etiquetas son
 * esa voz, `renameSpeakerRows` reescribe sus filas y `registerSpeakerIdentity` deja el
 * NOMBRE en el CLUSTER de esa voz, que es quien lo resuelve en los turnos siguientes.
 * La etiqueta automatica se escribe TAL CUAL (A5): no es un alias de nadie.
 */

/**
 * Hablante que puede ESCRIBIRSE en la fila del turno. DUENO UNICO de la decision,
 * consumido por la puerta unica de la fila (`commitUserTurnRow`).
 *
 * Regla (A5, corregida): la etiqueta de DIARIZACION es PROVISIONAL y se escribe TAL CUAL
 * ("Hablante 2", "luis"…): la evidencia acustica NO decide si se escribe, solo si se
 * ASCIENDE a nombre propio. El RESPALDO (`getFallbackSpeaker`) se usa SOLO cuando no hay
 * etiqueta ninguna, para que la fila nunca quede vacia. Un nombre propio SIN evidencia
 * acustica (p. ej. el del participante activo o el de otra voz) NO se estampa: la fila
 * conserva su etiqueta de diarizacion (el "soy <nombre>" asciende por el renombre del
 * registro, que es dato de sesion, no por esta via).
 *
 * @param speakerName etiqueta/nombre que aporta el que llama
 * @param evidenciaAcustica `true` SOLO si el nombre viene de una ventana de AUDIO medida
 *   (coincidencia). OMITIRLA equivale a `false` (sin evidencia): la identidad NO se da por
 *   "medida" por omision -> etiqueta generica, nunca un nombre propio sin coincidencia.
 * @param registered vinculo etiqueta->persona registrada (panel de participantes)
 * @param fallbackSpeaker respaldo cuando NO hay etiqueta (por defecto, el de config)
 * @returns el hablante a escribir (siempre una etiqueta)
 */
export function resolveRowSpeakerName(
    speakerName: string,
    _evidenciaAcustica?: boolean,
    _registered: { registeredLabel?: string; registeredName?: string } = {},
    fallbackSpeaker: string = getFallbackSpeaker(),
): string {
    const respaldo = String(fallbackSpeaker || '').trim() || getFallbackSpeaker();
    const raw = String(speakerName || '').trim();
    // El RESPALDO se usa SOLO cuando no hay etiqueta (la fila nunca queda vacia).
    if (!raw) return respaldo;
    // NOMBRE REGISTRADO de ESA voz (dueno 2026-10-12): una sola voz = una sola grafia. La
    // etiqueta PROVISIONAL ("Hablante N") pasa a llevar el nombre de la voz que lo dijo,
    // tambien en los turnos sin ventana de audio medida. Un nombre propio que YA llega en la
    // fila se escribe TAL CUAL (dueño 2026-10-11): el alias solo sustituye la etiqueta.
    const alias = isAutoSpeakerLabel(raw) ? unambiguousNameForLabel(raw) : '';
    if (alias) return alias;
    // DUENO UNICO (spec del dueno 2026-10-11): la etiqueta se escribe TAL CUAL. El NOMBRE PROPIO
    // tiene UNA sola via de introduccion (wake + comando); la evidencia de VOZ no lo introduce,
    // solo lo CONFIRMA si ya venia introducido. Por eso NO se asciende la etiqueta al registrado.
    return raw;
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
    evidenciaAcustica = false,
    { evidenciaDeTexto = true }: { evidenciaDeTexto?: boolean } = {},
): string {
    const next = String(nextName || '').trim();
    const current = String(currentName || '').trim();
    if (!next) return current;
    // Una etiqueta AUTOMATICA ("Hablante N") solo entra con evidencia declarada: el
    // sincrono sin ventana y el tick sin clusters devolvian el FALLBACK y la fila
    // acababa con dos nombres para el mismo turno (medido 2026-10-07).
    // A5: sin evidencia no se DEGRADA un nombre ya escrito; si la fila esta vacia se
    // escribe la etiqueta disponible (nunca vacia).
    // A5 corregida + FLANCO: sin evidencia acustica NI del texto de ESTE turno, un
    // nombre propio NO se estampa sobre una fila (ni siquiera vacia: el relleno tardio
    // de identidad colaba "Luis" en la voz de la mujer). El nombre que SI viene del
    // texto ("soy Luis") es evidencia de identidad y pasa (`evidenciaDeTexto`).
    if (!evidenciaDeTexto && isProperSpeakerName(next) && !evidenciaAcustica) return current || getFallbackSpeaker();
    if (isAutoSpeakerLabel(next) && !evidenciaAcustica) return current || next;
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
export function renameSpeakerRows(
    labels: string[],
    toName: string,
    { anchorSignature = null }: { anchorSignature?: number[] | null } = {},
): number {
    const name = String(toName || '').trim();
    if (!name || !Array.isArray(labels) || !labels.length) return 0;
    const normalized = new Set(
        labels.map((l) => foldSpeakerKey(l)).filter(Boolean),
    );
    normalized.add(foldSpeakerKey(name));
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;
    // FIRMA DE LA FILA: la sustitucion alcanza TAMBIEN las filas cuya etiqueta YA NO existe en
    // los clusters (medido 2026-10-11: "Hablante 1" no se renombraba). Un solo criterio de
    // "misma voz", el del dueno (sameVoiceBySignature), nunca el de la etiqueta.
    const ancla = normalizeRowSignature(anchorSignature) || undefined;
    let changed = 0;
    const updated = history.map((e) => {
        if (e.role !== 'user') return e;
        const current = String(e.speakerName || '').trim();
        const porEtiqueta = Boolean(current) && normalized.has(foldSpeakerKey(current));
        const porFirma = Boolean(ancla) && sameVoiceBySignature(compareCosineSignatures(ancla, normalizeRowSignature(e.signature ?? undefined) || []));
        if (!porEtiqueta && !porFirma) return e;
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
        evidenciaAcustica = false,
        registeredSpeaker,
    }: {
        evidenciaAcustica?: boolean;
        registeredSpeaker?: { registeredLabel?: string; registeredName?: string };
    } = {},
): boolean {
    // MISMO DUENO que el commit (`resolveRowSpeakerName`): la resolucion tardia aplica
    // la MISMA regla (etiqueta automatica -> nombre registrado SOLO con evidencia), no
    // una copia mas pobre: una etiqueta de diarizacion solo asciende al nombre de la
    // persona registrada CON evidencia acustica, y el nombre propio ya escrito NO se
    // degrada (defecto del dueno: "le puso a un registro Luis y a los demas los dejo
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
    const objetivo = preserveProperSpeaker(resolved, entry.speakerName, evidenciaAcustica, { evidenciaDeTexto: false });
    voiceProbe('row-update', {
        ev: evidenciaAcustica === true,
        turnId,
        pedido: resolved,
        actual: String(entry.speakerName || ''),
        objetivo,
        cambia: String(entry.speakerName || '').trim() !== objetivo,
    });
    if (String(entry.speakerName || '').trim() === objetivo) return false;
    // La VOZ queda registrada: la etiqueta con la que venia apareciendo pertenece a ese
    // nombre. Ese dato es el que permite que el nombre alcance sus OTRAS etiquetas mas tarde.
    if (evidenciaAcustica && isProperSpeakerName(objetivo) && isAutoSpeakerLabel(String(entry.speakerName || ''))) {
        setSpeakerLabelAlias(String(entry.speakerName || ''), objetivo);
    }
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
    /** FIRMA de la voz del turno (para sustituir el nombre en TODAS las filas de esa voz). */
    signature?: number[] | null;
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
/**
 * DECISIÓN de escritura de la fila del usuario: ¿este payload de resolución
 * ESCRIBE en la conversación?
 *
 * Un SERVICIO (juego/ambiente/configuración) manda `effectOnly`: aplica su
 * efecto en su motor y NO escribe la conversación. La transcripción tiene su
 * único dueño (`commitAndResolveTurn`). Antes los tres fast-path pasaban
 * `transcript` a secas y escribían fila: una ruta de escritura de más.
 *
 * `userCommitOnly` es el COMMIT TEMPRANO (visibilidad inmediata, sin esperar a la IA):
 * NO escribe la conversación. La conversación solo lleva datos CONSOLIDADOS, y lo
 * consolidado se conoce cuando CIERRA la última frase (spec del dueño 2026-10-12:
 * "la conversación solo lleva datos consolidados una vez que termina la última frase").
 * El texto sigue visible en ÚLTIMA FRASE mientras se habla; la fila entra al cerrar
 * (`emitTurnRow` con `settlesTurn`), una vez, con el texto completo.
 *
 * Función pura (no toca el store) para poder probarla directamente.
 */
export function escribeFilaDeUsuario(
    payload: { effectOnly?: boolean; userCommitOnly?: boolean; rawOnly?: boolean } | null | undefined,
    { hayTexto = false, hablable = false } = {},
): boolean {
    if (payload?.effectOnly) return false;
    if (payload?.userCommitOnly) return false;
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
        speaker: String(input.speakerName || ''),
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
    evidenciaAcustica = false,
    registeredSpeaker,
    signature = null,
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

    // 1) Emisión que crece: la fila del turno se reutiliza (UNA), pero su TEXTO no se
    //    reescribe — la conversación solo se INSERTA (spec del dueño 2026-10-12). El texto
    //    consolidado entra en la INSERCIÓN (el cierre del turno), nunca por mutación
    //    posterior; aquí solo se COMPLETA el hablante.
    if (replaceLast) {
        for (let i = history.length - 1; i >= turnStart; i -= 1) {
            const entry = history[i];
            if (!entry || entry.role !== 'user') continue;
            const updated = history.map((e) =>
                e.id === entry.id
                    ? { ...e, speakerName: preserveProperSpeaker(resolved, e.speakerName, evidenciaAcustica), timestamp: stamp }
                    : e,
            );
            store.batchLoadHistory(updated);
            rememberTurn(turnId, entry.id);
            return { id: entry.id, action: 'reused' };
        }
        // La respuesta de FLU NO puede DERROTAR la accion de fila ya decidida
        // (`replaceLast` = "esta emision reemplaza la ultima"): si la fila de la MISMA
        // locucion quedo ANTES de esa respuesta, se reutiliza. El criterio de "es el
        // mismo texto, mas corto/largo" es el DUENO UNICO de la recompuesta
        // (`isFragmentOfLocution`). Medido (log del dueno): la locucion con wake
        // "voy a decir el comando Okay flu Soy Luis" dejo DOS filas (turn=12 y turn=13,
        // la 2.a recortada encima de la respuesta de FLU).
        const ultima = [...history].reverse().find((e) => e?.role === 'user');
        if (ultima) {
            const previo = String(ultima.text || '');
            const rawEsTrozo = isFragmentOfLocution(raw, previo);
            const previoEsTrozo = !rawEsTrozo && isFragmentOfLocution(previo, raw);
            if (rawEsTrozo || previoEsTrozo) {
                const completa = rawEsTrozo ? previo : raw;
                if (completa !== previo) {
                    store.batchLoadHistory(
                        history.map((e) => (e.id === ultima.id ? { ...e, text: completa } : e)),
                    );
                }
                rememberTurn(turnId, ultima.id);
                return { id: ultima.id, action: rawEsTrozo ? 'reused' : 'replaced' };
            }
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
            const updated = history.map((e) =>
                e.id === entry.id
                    ? {
                        ...e,
                        speakerName: preserveProperSpeaker(resolved, e.speakerName, evidenciaAcustica),
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
        signature: normalizeRowSignature(signature),
    });
    currentTurn = { id: turnId, rowId: id };
    rememberTurn(turnId, id);
    return { id, action: 'added' };
}
