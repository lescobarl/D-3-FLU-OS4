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
import { registerVoiceName } from './speakerDirectory.js';
import { canonicalSpeakerName } from './speakerLabels';
import { getFallbackSpeaker } from './speakerCore';
import { labelToSpeakerId, speakerIdToDefaultName } from './conversationRow';
import { voiceKeyFor } from './speakerDirectory.js';
import { normalizeRowSignature } from './conversationRow';
import { isFragmentOfLocution } from './turnStream';

/**
 * Turno actual de la conversacion: su id y la fila de usuario que le pertenece.
 * Es lo que permite reutilizar la fila por IDENTIDAD de turno (los dos commits
 * del turno: temprano y de resolucion) en vez de por posicion respecto a FLU.
 */
let currentTurn: { id: number | string | null; rowId: string | null } = { id: null, rowId: null };

/**
 * ¿El `speakerId` de la fila es un NOMBRE propio (`speaker_name_*`)? Solo ese es
 * write-once: un placeholder auto (`speaker_N`) si se completa (commit temprano ->
 * resolucion con el hablante medido).
 */
function esNombrePropioDeFila(speakerId?: string | null): boolean {
    return String(speakerId || '').startsWith('speaker_name_');
}

/**
 * CONGELA el hablante RESUELTO en la fila (freeze 2026-10-17): el nombre se escribe en la fila
 * y no se re-resuelve desde el directorio. No DEGRADA un nombre propio ya congelado con una
 * etiqueta automatica.
 */
function freezeResolvedSpeakerName(
    store: { conversationHistory: Array<{ id: string; speakerName?: string }>; setEntrySpeakerName: (id: string, name: string) => void },
    rowId: string,
    resolved: string,
): void {
    const actual = String(store.conversationHistory.find((e) => e.id === rowId)?.speakerName || '').trim();
    if (isProperSpeakerName(actual) && !isProperSpeakerName(resolved)) return;
    store.setEntrySpeakerName(rowId, resolved);
}

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
/**
 * NO hay mapa etiqueta->nombre (mandato del dueno 2026-10-13): el nombre vive en la VOZ
 * (`speakerDirectory`, `registerVoiceName`). Este modulo NO escribe nombres en la fila:
 * la fila guarda LA VOZ y el nombre se resuelve al MOSTRAR. Una sola via del nombre.
 */
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
    // La etiqueta se escribe TAL CUAL: es el id provisional de ESA voz. El nombre propio
    // NO se estampa aqui (ni por alias ni por continuidad): se resuelve por la VOZ al mostrar.
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
/**
 * Renombra una VOZ (registro manual del panel). NO toca ninguna fila: la conversacion es
 * texto insertado; el nombre vive en el directorio y se resuelve al MOSTRAR.
 *
 * @param labels Etiquetas/voces a renombrar (se registran por su id de voz).
 * @param toName Nombre nuevo.
 * @returns cuantas VOCES quedaron registradas.
 */
export function renameSpeakerRows(
    labels: string[],
    toName: string,
): number {
    const name = canonicalSpeakerName(String(toName || '').trim());
    if (!name || !Array.isArray(labels)) return 0;
    let changed = 0;
    labels.forEach((label) => {
        const voz = labelToSpeakerId(String(label || ''));
        if (!voz) return;
        registerVoiceName(voz, name);
        // FREEZE: el nombre queda escrito en las filas ya mostradas de esa voz (se resuelve
        // desde la fila, no desde el directorio).
        freezeVoiceName(voz, name);
        changed += 1;
    });
    return changed;
}

/**
 * CONGELA el nombre de una voz en las filas que YA muestran su etiqueta (freeze del dueno
 * 2026-10-17): al identificar una voz ("soy Luis"), toda su participacion pasa a llevar el
 * nombre, escrito EN LA FILA, y no se vuelve a resolver desde el directorio. Solo se congelan
 * filas con etiqueta ESCRITA (auto o propia): una fila sin rotulo no tiene evidencia de esa voz
 * (el insert no estampa sin medida, regla del dueno 2026-10-08) y NO hereda nada, de modo que
 * una voz DISTINTA que reutilice la clave no se pinta (defecto "la mujer sale Luis" del log).
 * Write-once: no pisa un nombre propio ya congelado distinto.
 *
 * @returns cuantas filas se congelaron.
 */
export function freezeVoiceName(voiceId: string, speakerName: string): number {
    const voz = String(voiceId || '').trim();
    const name = canonicalSpeakerName(String(speakerName || '').trim());
    if (!voz || !name) return 0;
    const store = useIntegrationStore.getState();
    let changed = 0;
    store.conversationHistory.forEach((e) => {
        if (e.role !== 'user') return;
        if (String(e.speakerId || '') !== voz) return;
        const actual = String(e.speakerName || '').trim();
        if (!actual || actual === name) return;
        store.setEntrySpeakerName(e.id, name);
        changed += 1;
    });
    return changed;
}
/**
 * La MEDIDA tardia de un turno llega cuando el commit ya escribio la fila. Antes esto
 * REESCRIBIA el nombre de la fila (segunda via del nombre y mutacion de la conversacion).
 * Ahora registra el nombre en el DIRECTORIO de la VOZ de ese turno: la conversacion queda
 * intacta (texto insertado) y TODAS las filas de esa voz se ven con su nombre al MOSTRAR.
 * Sin evidencia medida no se afirma nada (no se adivina).
 *
 * @returns `true` si el nombre quedo registrado para esa voz.
 */
export function updateTurnRowSpeaker(
    turnId: number | string | null,
    speakerName: string,
    {
        evidenciaAcustica = false,
        vector = null,
    }: {
        evidenciaAcustica?: boolean;
        registeredSpeaker?: { registeredLabel?: string; registeredName?: string };
        vector?: number[] | null;
    } = {},
): boolean {
    // El nombre entra CANONICO (una sola grafia para la fila y la base).
    const name = canonicalSpeakerName(String(speakerName || '').trim());
    if (turnId === null || turnId === undefined || !name) return false;
    if (!evidenciaAcustica) return false;
    const rowId =
        recentTurns.get(String(turnId)) ||
        (currentTurn.id === turnId ? currentTurn.rowId : null);
    if (!rowId) return false;
    const history = useIntegrationStore.getState().conversationHistory;
    const entry = history.find((e) => e.id === rowId);
    if (!entry || entry.role !== 'user') return false;
    const vozDeEtiqueta = String(entry.speakerId || '') || labelToSpeakerId(String(entry.speakerName || ''));
    if (!vozDeEtiqueta) return false;
    // UNA VOZ, UNA CLAVE: con timbre medido el nombre se pega a la VOZ resuelta por su
    // firma (`voiceKeyFor`), NUNCA a la clave derivada de la ETIQUETA ("Hablante 1" ->
    // `speaker_1`), que la reutiliza otra persona al diarizar con la misma etiqueta. Sin
    // esa separacion, "Luis" quedaba colgado de `speaker_1` y la mujer que diariza
    // "Hablante 1" heredaba su nombre (medido en el log del dueno 2026-10-17: las
    // intervenciones de la mujer salian como "Luis").
    const voz = voiceKeyFor({ voiceId: vozDeEtiqueta, signature: vector });
    registerVoiceName(voz, name, { vector });
    // FREEZE del nombre en ESTA fila (mandato 2026-10-17): el nombre queda congelado aqui y no
    // se re-resuelve desde el directorio; una voz distinta que reutilice la clave no lo hereda.
    useIntegrationStore.getState().setEntrySpeakerName(rowId, name);
    voiceProbe('row-update', { turnId, voz, nombre: name, fila: rowId });
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
    // LA VOZ de la fila (no su nombre): el nombre se resuelve al MOSTRAR. La clave es el
    // TIMBRE cuando se midio (mismo timbre = misma clave aunque cambie la etiqueta).
    const vozDeLaFila = voiceKeyFor({ voiceId: labelToSpeakerId(resolved), signature });
    // FREEZE (mandato del dueno 2026-10-17): la fila nace con su etiqueta CONGELADA — la MISMA
    // que renderiza su VOZ (canonica por id: "luis" -> "Luis", "Lider" con su canon), no la
    // grafia cruda del aporte. Una voz distinta que reutilice la clave no la hereda.
    const etiquetaDeLaFila = speakerIdToDefaultName(vozDeLaFila);
    // ROTULO PROPIO: la fila solo lleva `speakerName` cuando el resolver aporto identidad de
    // ESTE turno (etiqueta de diarizacion distinta del RESPALDO, nombre propio del texto o
    // medida). El respaldo no se escribe: es lo que su VOZ ya muestra al renderizar, y
    // estamparlo dejaba una etiqueta generica escrita en filas sin evidencia (regla del dueno
    // 2026-10-08, e2e `A3`: sin evidencia la fila queda SIN hablante escrito).
    const respaldoHablante = String(getFallbackSpeaker() || '').trim();
    const hayRotuloPropio =
        evidenciaAcustica || String(resolved || '').trim() !== respaldoHablante;
    const stamp = typeof timestamp === 'number' ? timestamp : Date.now();

    // 1) Emisión que crece: la fila del turno se reutiliza (UNA), pero su TEXTO no se
    //    reescribe — la conversación solo se INSERTA (spec del dueño 2026-10-12). El texto
    //    consolidado entra en la INSERCIÓN (el cierre del turno), nunca por mutación
    //    posterior; aquí solo se COMPLETA el hablante.
    if (replaceLast) {
        for (let i = history.length - 1; i >= turnStart; i -= 1) {
            const entry = history[i];
            if (!entry || entry.role !== 'user') continue;
            // WRITE-ONCE del NOMBRE: un `speaker_name_*` ya commiteado no se reescribe (el
            // nombre propio no se mueve). Un placeholder auto (`speaker_N`) si se completa.
            if (esNombrePropioDeFila(entry.speakerId)) {
                rememberTurn(turnId, entry.id);
                return { id: entry.id, action: 'reused' };
            }
            store.setEntrySpeaker(entry.id, vozDeLaFila);
            if (hayRotuloPropio) freezeResolvedSpeakerName(store, entry.id, etiquetaDeLaFila);
            rememberTurn(turnId, entry.id);
            return { id: entry.id, action: 'reused' };
        }
        // RECORTE POSTERIOR (P9.67): si el texto es un TROZO contiguo de la última fila de
        // usuario (o al revés), la fila se REUTILIZA aunque el turno haya cambiado — el wake
        // recorta la locución y el commit va con el turno vivo; el dueno de ese criterio es
        // `isFragmentOfLocution` (uno solo). Fundir por texto no reescribe lo ya commitado
        // (write-once arriba), solo evita la segunda fila del recorte.
        const ultima = [...history].reverse().find((e) => e?.role === 'user');
        if (ultima) {
            const previo = String(ultima.text || '');
            const rawEsTrozo = isFragmentOfLocution(raw, previo);
            const previoEsTrozo = !rawEsTrozo && isFragmentOfLocution(previo, raw);
            if (rawEsTrozo || previoEsTrozo) {
                // P1 insert-only: el texto de una fila se decide UNA vez, en su insercion.
                // WRITE-ONCE del NOMBRE: un nombre propio ya commiteado no se reescribe.
                if (!esNombrePropioDeFila(ultima.speakerId)) {
                    store.setEntrySpeaker(ultima.id, vozDeLaFila);
                    if (hayRotuloPropio) freezeResolvedSpeakerName(store, ultima.id, etiquetaDeLaFila);
                }
                if (previoEsTrozo) store.completeEntryFragment(ultima.id, raw);
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
            // WRITE-ONCE del NOMBRE: un nombre propio ya commiteado no se reescribe; un
            // placeholder auto si se completa (commit temprano -> resolucion).
            if (esNombrePropioDeFila(entry.speakerId)) {
                rememberTurn(turnId, entry.id);
                return { id: entry.id, action: 'reused' };
            }
            store.setEntrySpeaker(entry.id, vozDeLaFila);
            if (hayRotuloPropio) freezeResolvedSpeakerName(store, entry.id, etiquetaDeLaFila);
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
        speakerId: vozDeLaFila,
        // SIN ROTULO PROPIO no se escribe nada en la fila (regla del dueno 2026-10-08,
        // e2e `A3`): sin medida ni etiqueta propia la fila queda SIN hablante escrito y su
        // rotulo lo da su VOZ al MOSTRAR. El respaldo jamas se estampa aqui.
        ...(hayRotuloPropio ? { speakerName: etiquetaDeLaFila } : {}),
        timestamp: stamp,
        sentiment,
        signature: normalizeRowSignature(signature),
    });
    currentTurn = { id: turnId, rowId: id };
    rememberTurn(turnId, id);
    return { id, action: 'added' };
}
