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
import { compareCosineSignatures } from './speakerCore';
import { registerVoiceName, resolveVoiceIdentity } from './speakerDirectory.js';
import { differentVoiceFloor, sameVoiceFloor, getSessionClusters } from './speakerClusters.js';
import { classifyVoiceAgainstClusters, namedAssignmentConfirmed, continuityLabelForMonologue } from './speakerDiarization.js';
import { canonicalSpeakerName, normalizeSpeakerLabel, pendingSpeakerLabel } from './speakerLabels';
import { getVoiceIdentityConfig } from './speakerLabels';
import { autoSpeakerIndexFromKey, getFallbackSpeaker } from './speakerCore';
import { labelToSpeakerId, resolveRowSpeakerLabel, speakerIdToDefaultName } from './conversationRow';
import { getParticipantAnchors } from './participantVoiceAnchors';
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
 * ¿El turno es DESCONOCIDO (sin id)? Un `null`/`''`/`undefined` no identifica nada.
 * @param valor id de turno
 * @returns true si no hay identidad
 */
function turnoDesconocido(valor: unknown): boolean {
    return valor === null || valor === undefined || String(valor) === '';
}

/**
 * ¿La fila puede pertenecer al turno `turnId`?
 *
 * Regla UNICA de identidad de turno para las ramas que reutilizan una fila por IDENTIDAD
 * (auditoria 2026-10-23: el bucle principal la tenia y la rama P9.67 no, asi que un trozo
 * podia completar/renombrar la fila del turno ANTERIOR).
 *
 * SIN IDENTIDAD NO SE REUTILIZA (2a pasada): antes, si faltaba el id de la fila o el del
 * commit, se devolvia `true` "para conservar la conducta anterior". Eso dejaba que un commit
 * SIN turno (la resolucion tardia o el fallback de App) completara la fila de OTRO turno. El id
 * se acuña ANTES del commit y la fila lo guarda (`ConversationEntry.turnId`); si aun asi falta,
 * la respuesta segura es NO reutilizar: se escribe fila nueva.
 *
 * @param entry fila de conversacion
 * @param turnId turno del texto que se esta commiteando
 * @returns true si la fila es DEL MISMO turno (ambos ids conocidos e iguales)
 */
function filaPuedeSerDeEsteTurno(
    entry: { turnId?: number | string | null } | null | undefined,
    turnId: number | string | null | undefined,
): boolean {
    if (!entry) return false;
    if (turnoDesconocido(turnId) || turnoDesconocido(entry.turnId)) return false;
    return String(entry.turnId) === String(turnId);
}

/**
 * ¿La fila ya tiene un NOMBRE propio? Dos formas reales del mismo dato:
 * - `speakerId` derivado de un nombre (`speaker_name_*`), o
 * - `speakerName` propio CONGELADO sobre un id automatico (`speaker_1` + "Luis").
 * La segunda es la que faltaba: tras "soy Luis" la fila conservaba el id `speaker_1`,
 * y una revision posterior del turno la reescribia con la etiqueta generica (medido
 * en el log del dueno 2026-10-18: `speaker="Hablante 1" vista="Hablante 1"`).
 * Ese nombre es write-once: no se mueve ni se degrada.
 */
function esNombrePropioDeFila(entry?: { speakerId?: string | null; speakerName?: string | null }): boolean {
    if (String(entry?.speakerId || '').startsWith('speaker_name_')) return true;
    return isProperSpeakerName(String(entry?.speakerName || '').trim());
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
 * DUENO UNICO de la ETIQUETA VISIBLE de la fila.
 *
 * - Un NOMBRE PROPIO que llega del resolver ya esta AFIRMADO por identidad medida
 *   (ventana sostenida + ancla): es la identidad de ESTE turno y manda sobre la etiqueta
 *   de la CLAVE. DEFECTO MEDIDO (2026-10-19, sesion del dueno 18f3888c): el dueno tenia su
 *   ancla verificada en la base, pero su timbre habia casado antes con `speaker_2` y la
 *   fila se escribia con el nombre por defecto de la CLAVE («Hablante 2»), no con «Luis».
 *   La clave agrupa el TIMBRE; la identidad la afirma el resolver.
 * - Una etiqueta AUTOMATICA no se escribe por turno: la voz tiene UNA etiqueta estable (la
 *   de su clave). Escribir la del turno partia una MISMA voz en «Hablante 2» y «Hablante 3»
 *   (`vozNombrePorVozTodosLosTurnosGuard`).
 * - El respaldo no aporta etiqueta: la completa la VOZ.
 *
 * @param resolved Etiqueta del turno (lo que devolvio el resolver).
 * @param vozDeLaFila Clave de la voz (timbre) de la fila.
 * @returns Etiqueta canonica a escribir.
 */
function resolveRowVisibleLabel(resolved: string, vozDeLaFila: string): string {
    const label = normalizeSpeakerLabel(String(resolved || '').trim());
    if (isProperSpeakerName(label)) return canonicalSpeakerName(label);
    // La etiqueta PENDIENTE es de CONFIG y dice "no se sabe aun": se escribe TAL CUAL.
    // Derivarla de su clave le inventaria un numero de hablante que no tiene.
    if (label === pendingSpeakerLabel()) return label;
    return speakerIdToDefaultName(vozDeLaFila);
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
 * @param fallbackSpeaker respaldo cuando NO hay etiqueta (por defecto, el de config)
 * @returns el hablante a escribir (siempre una etiqueta)
 *
 * SIN parametros de evidencia ni de vinculo registrado: ninguno de los dos cambiaba la
 * salida (la etiqueta se escribe TAL CUAL y el nombre propio solo entra por el texto del
 * mandato, decision que vive en `updateTurnRowSpeaker`). Aceptarlos sugeria una decision
 * que aqui no existe.
 */
export function resolveRowSpeakerName(
    speakerName: string,
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
 * Fila del usuario por turno: permite COMPLETAR su hablante cuando el embedding
 * resuelve, que puede tardar mucho (el commit SIEMPRE gana la carrera). Sin este
 * registro, una resolucion tardia no tenia a que fila aplicarse y su etiqueta se
 * perdia -> el turno se quedaba con la etiqueta heredada ("Hablante 1").
 */
const recentTurns = new Map<string, string>();
const RECENT_TURNS_MAX = 8;

/** Mapa inverso fila -> turno: la medida del turno se busca por la FILA (ledger). */
const turnByRow = new Map<string, string>();

function rememberTurn(turnId: number | string | null, rowId: string): void {
    if (turnId === null || turnId === undefined || !rowId) return;
    recentTurns.set(String(turnId), rowId);
    turnByRow.set(String(rowId), String(turnId));
    if (recentTurns.size > RECENT_TURNS_MAX) {
        const oldest = recentTurns.keys().next().value;
        if (oldest != null) {
            const viejaFila = recentTurns.get(oldest);
            recentTurns.delete(oldest);
            if (viejaFila) turnByRow.delete(String(viejaFila));
        }
    }
}

/**
 * Evidencia de un turno de la sesion: su medida (`signatureVector`) y el turno al que
 * pertenece. Es lo que el preflight entrega desde el LEDGER (`getSessionSpeakerSnapshots`).
 */
export interface PendingRowEvidence {
    turnId?: number;
    signatureVector?: number[];
}

/**
 * Etiqueta que le corresponde a una fila INCIERTA, decidida por los DUENOS UNICOS.
 *
 * - Que la voz este DENTRO de la sesion lo dice `classifyVoiceAgainstClusters` (known/grey/new);
 *   en zona gris NO se asigna nada: la fila sigue pendiente.
 * - Que un NOMBRE PROPIO se pueda afirmar lo dice `namedAssignmentConfirmed` (piso + margen
 *   sobre la mejor voz ALTERNATIVA). Si el nombre no pasa, se usa la mejor etiqueta ANONIMA y,
 *   si tampoco la hay, la fila sigue pendiente: nunca se escribe el nombre de otra persona.
 *
 * @param clusters Clusters de la sesion (con `label`, `signature` y `anchorVerified`).
 * @param vector Medida de la fila (su firma o la de su turno).
 * @param floor Piso de "misma voz" (config).
 * @returns La etiqueta y la CLAVE de la voz elegidas, o `null` sin evidencia suficiente.
 */
function pickPendingRowLabel(
    clusters: Array<{ label?: string | null; signature?: number[] | null; anchorVerified?: boolean }>,
    vector: number[],
    floor: number,
    // Umbrales de la CONFIG: la reclasificacion de filas pendientes decidia con los defaults
    // del modulo y podia medir otra politica que la sesion (auditoria 2026-10-22).
    thresholds: Record<string, unknown> = {},
): { label: string; speakerId: string } | null {
    const verdict = classifyVoiceAgainstClusters({ vector, speakerClusters: clusters, thresholds });
    if (verdict.verdict !== 'known') return null;
    const medidos = clusters
        .map((cluster) => ({
            label: String(cluster?.label || '').trim(),
            signature: normalizeRowSignature(cluster?.signature),
            anchorVerified: cluster?.anchorVerified === true,
        }))
        .filter(
            (cluster): cluster is { label: string; signature: number[]; anchorVerified: boolean } =>
                Boolean(cluster.label && cluster.signature?.length),
        );
    let mejorNombre: { label: string; signature: number[]; sim: number } | null = null;
    let mejorAnonima: { label: string; signature: number[]; sim: number } | null = null;
    for (const cluster of medidos) {
        const sim = compareCosineSignatures(cluster.signature, vector);
        if (sim < floor) continue;
        if (isProperSpeakerName(cluster.label)) {
            const alternativas = medidos
                .filter((otro) => otro.label !== cluster.label)
                .map((otro) => compareCosineSignatures(otro.signature, vector));
            const bestAlternative = alternativas.length ? Math.max(...alternativas) : -1;
            const vale = namedAssignmentConfirmed({
                label: cluster.label,
                similarity: sim,
                bestAlternative,
                anchorVerified: cluster.anchorVerified,
                thresholds,
            });
            if (!vale) continue;
            if (!mejorNombre || sim > mejorNombre.sim) mejorNombre = { ...cluster, sim };
        } else if (!mejorAnonima || sim > mejorAnonima.sim) {
            mejorAnonima = { ...cluster, sim };
        }
    }
    const elegida = mejorNombre || mejorAnonima;
    if (!elegida) return null;
    return {
        label: elegida.label,
        speakerId: voiceKeyFor({ voiceId: labelToSpeakerId(elegida.label), signature: elegida.signature }),
    };
}


/**
 * Tabla de umbrales de la SESION (config del motor de identidad).
 *
 * La reclasificacion de filas pendientes es una decision de identidad: tiene que medir con la
 * MISMA tabla que el resto del pipeline, no con los defaults del modulo (auditoria 2026-10-22).
 * @returns {Record<string, unknown>}
 */
function umbralesDeLaSesion(): Record<string, unknown> {
    const cfg = getVoiceIdentityConfig();
    const tabla = cfg?.capture?.conversationSpeakerThresholds;
    return tabla && typeof tabla === 'object' ? (tabla as Record<string, unknown>) : {};
}

/**
 * Resuelve las filas INCIERTAS (etiqueta PENDIENTE) contra las medidas de la sesion.
 *
 * Es el UNICO sitio que reescribe una fila pendiente. Tres reglas:
 *  1. la asignacion la decide el dueno unico (`pickPendingRowLabel`: centroides + margen), asi
 *     que nunca se escribe el nombre de otra persona por "ser el mas parecido";
 *  2. una fila SIN firma se resuelve con la medida de SU TURNO (ledger del preflight,
 *     `getSessionSpeakerSnapshots`): el commit recuerda turno -> fila;
 *  3. ademas de `speakerName` se actualiza `speakerId` (la CLAVE de la voz) y se estampa la
 *     firma con la que se decidio, para que el renombre por clave encuentre la fila despues.
 *
 * @param clusters Clusters de la sesion.
 * @param {{ epoch?: number, floor?: number, snapshots?: PendingRowEvidence[] }} [options]
 * @returns cuantas filas salieron de pendiente.
 */
export function resolvePendingSpeakerRows(
    clusters: Array<{ label?: string | null; signature?: number[] | null; anchorVerified?: boolean }> = [],
    {
        epoch,
        floor = sameVoiceFloor(),
        snapshots = [],
    }: { epoch?: number; floor?: number; snapshots?: PendingRowEvidence[] } = {},
): number {
    const pending = pendingSpeakerLabel();
    if (!clusters.length || !pending) return 0;
    const store = useIntegrationStore.getState();
    const epochVigente = Number(store.conversationEpoch);
    const epochActual = Number.isFinite(Number(epoch)) ? Number(epoch) : epochVigente;
    // Medida por TURNO (ledger): evidencia de las filas que no traen firma propia.
    const porTurno = new Map<string, number[]>();
    for (const evidencia of snapshots) {
        const vector = normalizeRowSignature(evidencia?.signatureVector);
        if (!vector || !Number.isFinite(Number(evidencia?.turnId))) continue;
        porTurno.set(String(evidencia.turnId), vector);
    }
    let changed = 0;
    for (const e of store.conversationHistory) {
        if (e.role !== 'user') continue;
        if (String(e.speakerName || '').trim() !== pending) continue;
        const epochDeLaFila = Number.isFinite(Number(e.epoch)) ? Number(e.epoch) : epochVigente;
        if (epochDeLaFila !== epochActual) continue;
        // Firma de la fila o, si no tiene, la de SU turno: la fila puede nacer sin medida y
        // el ledger guarda el vector con el que se decidio ese turno.
        const deSuTurno =
            normalizeRowSignature(e.signature) ||
            porTurno.get(turnByRow.get(String(e.id)) || '') ||
            null;
        if (!deSuTurno) {
            // MONOLOGO sin vector (auditoria 2026-10-23): con UNA sola etiqueta en la sesion no
            // hay otra voz a la que atribuir el turno; su etiqueta es la continuidad.
            const continuidad = etiquetaUnicaDeLaSesion(store.conversationHistory, epochActual) || continuityLabelForMonologue(clusters);
            if (!continuidad) continue;
            store.setEntrySpeakerName(e.id, continuidad);
            changed += 1;
            continue;
        }
        const elegida = pickPendingRowLabel(clusters, deSuTurno, floor, umbralesDeLaSesion());
        if (!elegida) {
            // Sin margen para afirmar identidad, la CONTINUIDAD solo vale si NO hay evidencia
            // de otra voz: si la firma de la fila cae por debajo del piso de "voz distinta"
            // frente a TODOS los clusters medidos, esta fila es de OTRA persona y forzar la
            // etiqueta seria el defecto medido (la mujer heredaba la etiqueta del dueno).
            const medidas = clusters
                .map((c) => normalizeRowSignature(c?.signature))
                .filter((v): v is number[] => Array.isArray(v) && v.length > 0);
            if (medidas.length) {
                const similitudMax = Math.max(...medidas.map((v) => compareCosineSignatures(deSuTurno, v)));
                if (similitudMax < differentVoiceFloor()) continue;
            }
            const continuidad = etiquetaUnicaDeLaSesion(store.conversationHistory, epochActual) || continuityLabelForMonologue(clusters, { lastSpeaker: '' });
            if (!continuidad) continue;
            store.setEntrySpeakerName(e.id, continuidad);
            changed += 1;
            continue;
        }
        store.setEntrySpeaker(e.id, elegida.speakerId, { signature: deSuTurno });
        store.setEntrySpeakerName(e.id, elegida.label);
        changed += 1;
    }
    return changed;
}


/**
 * ETIQUETA UNICA DE LA SESION (mandato del dueno 2026-10-23): si las filas de usuario del
 * epoch usan UNA sola etiqueta automatica, esa es la continuidad de la unica voz. Devuelve ''
 * con cero etiquetas o con dos o mas (ahi `?` es legitimo y no se fuerza nada).
 * @param history filas de la conversacion
 * @param epoch epoch vigente de la fila
 * @returns etiqueta automatica unica, o ''
 */
function etiquetaUnicaDeLaSesion(
    history: Array<{ role?: string; epoch?: number | string; speakerName?: string }> = [],
    epoch?: number,
): string {
    const etiquetas = new Set<string>();
    for (const entry of history || []) {
        if (entry?.role !== 'user') continue;
        if (Number.isFinite(Number(entry?.epoch)) && Number(entry.epoch) !== Number(epoch)) continue;
        const name = normalizeSpeakerLabel(String(entry?.speakerName || '').trim());
        if (!name || name === pendingSpeakerLabel()) continue;
        if (!isAutoSpeakerLabel(name) || !/\d/.test(name)) continue;
        etiquetas.add(name);
    }
    return etiquetas.size === 1 ? [...etiquetas][0] : '';
}

/**
 * Correccion de UNA fila concreta por su id (migracion declarada). El dueno del nombre de
 * fila es ESTE modulo: la migracion no toca el store ni tiene su propia regla.
 * @param rowId id de la fila de conversacion
 * @param speakerName nombre a escribir (se canoniza)
 * @returns true si la fila existia y era de usuario
 */
export function renameRowSpeakerName(rowId: string, speakerName: string): boolean {
    const id = String(rowId || '');
    const name = canonicalSpeakerName(String(speakerName || '').trim());
    if (!id || !name) return false;
    const store = useIntegrationStore.getState();
    const entry = store.conversationHistory.find((e) => e.id === id);
    if (!entry || entry.role !== 'user') return false;
    store.setEntrySpeakerName(id, name);
    return true;
}

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
 * Renombra las filas de UNA VOZ por su CLAVE (`speakerId`), sin exigir piso de firma.
 *
 * Defecto que cierra (2026-10-21): "soy Luis" sobre `speaker_1` solo renombraba las filas
 * con firma suficiente; las filas de esa MISMA clave sin medida (o con medida debil) se
 * quedaban en "Hablante 1". El renombre por clave NO necesita el timbre: la clave ES la
 * identidad de la voz en la sesion; el piso de firma sigue gobernando el cosido del GRUPO
 * (`freezeVoiceName`, otras etiquetas de la misma voz).
 *
 * Reglas (una sola): filas `role === "user"` del epoch pedido, `speakerId === voiceId`;
 * NO se pisa un nombre propio DISTINTO sin prueba de que la fila es ESA voz (misma
 * excepcion write-once que el freeze: la firma de la fila, si la hay, la prueba).
 * El piso de firma NO se exige para renombrar; solo resuelve la excepcion.
 *
 * GUARDIA CONSERVADORA de identidad (mandato 2026-10-21, riesgo "la mujer sale Luis"):
 * la CLAVE la asigna la diarizacion y puede ser COMPARTIDA por dos personas cuando el
 * turno llega mezclado. Por eso una fila ANONIMA que SI tiene firma y cuya similitud con
 * las medidas de la voz queda POR DEBAJO de `differentVoiceFloor` (banda MEDIDA de voz
 * distinta) NO se renombra: su timbre dice que es otra persona. Una fila sin firma no
 * tiene evidencia en contra y se renombra (arreglo de huerfanos); una fila con firma
 * COMPATIBLE (>= ese piso) tambien.
 *
 * @param voiceId Clave de la voz (`speaker_1`, `speaker_name_luis`, ...).
 * @param speakerName Nombre propio a escribir (se canoniza).
 * @param {{ epoch?: number, signatures?: Array<number[] | null | undefined>, floor?: number, differentFloor?: number }} [options]
 *   `epoch` a tocar (por defecto el vigente); `signatures` medidas de la voz (prueba de
 *   misma voz); `floor` piso de "misma voz"; `differentFloor` piso de "voz CLARAMENTE
 *   distinta" (config `differentVoiceFloor`).
 * @returns cuantas filas se reescribieron.
 */
export function renameVoiceRowsByKey(
    voiceId: string,
    speakerName: string,
    {
        epoch,
        signatures = [],
        floor = sameVoiceFloor(),
        differentFloor = differentVoiceFloor(),
    }: {
        epoch?: number;
        signatures?: Array<number[] | null | undefined>;
        floor?: number;
        differentFloor?: number;
    } = {},
): number {
    const voz = String(voiceId || '').trim();
    const name = canonicalSpeakerName(String(speakerName || '').trim());
    if (!voz || !name) return 0;
    const store = useIntegrationStore.getState();
    const epochVigente = Number(store.conversationEpoch)
    const epochActual = Number.isFinite(Number(epoch)) ? Number(epoch) : epochVigente;
    const medidos = (Array.isArray(signatures) ? signatures : [])
        .map((sig) => normalizeRowSignature(sig))
        .filter((sig): sig is number[] => Boolean(sig?.length));
    const filas = store.conversationHistory.filter((e) => {
        if (e.role !== 'user') return false;
        const epochDeLaFila = Number.isFinite(Number(e.epoch)) ? Number(e.epoch) : epochVigente;
        return epochDeLaFila === epochActual && String(e.speakerId || '') === voz;
    });
    // CLAVE MIXTA: si la misma clave contiene una firma que NO es la voz del nombre,
    // la clave NO identifica a una sola persona (la diarizacion metio a otra voz en
    // `speaker_1`). En ese caso no se renombran por clave las filas sin evidencia;
    // solo las que tienen firma compatible. Antes el piso "claramente distinta"
    // (0.58) dejaba pasar a la mujer con 0.725/0.808 y el rename por clave le ponia
    // el nombre del titular (defecto medido 2026-10-21).
    let claveMixta = false;
    for (const e of filas) {
        const rowSignature = normalizeRowSignature(e.signature);
        if (!rowSignature || !medidos.length) continue;
        const bestSim = medidos.reduce(
            (best, sig) => Math.max(best, compareCosineSignatures(sig, rowSignature)),
            -1,
        );
        if (bestSim >= 0 && bestSim < floor) {
            claveMixta = true;
            break;
        }
    }
    let changed = 0;
    for (const e of filas) {
        const actual = String(e.speakerName || '').trim();
        const rowSignature = normalizeRowSignature(e.signature);
        // Mejor similitud de la FILA contra las medidas de la voz (una sola lectura).
        const bestSim = rowSignature && medidos.length
            ? medidos.reduce((best, sig) => Math.max(best, compareCosineSignatures(sig, rowSignature)), -1)
            : -1;
        const mismaVozPorFirma = bestSim >= floor;
        // Write-once entre identidades: un nombre propio DISTINTO solo se reescribe si la
        // FIRMA de la fila prueba que es la MISMA voz (la excepcion declarada de "soy X").
        if (actual && isProperSpeakerName(actual) && actual !== name) {
            if (!mismaVozPorFirma) continue;
        }
        // GUARDIA de voz CONTRARIA: una fila ANONIMA con firma CLARAMENTE por debajo del
        // piso de "voz distinta" es otra persona, aunque la diarizacion le diera la misma
        // clave (turno mezclado). No se renombra: la clave NO es la persona.
        const anonima = !actual || !isProperSpeakerName(actual);
        if (anonima && bestSim >= 0 && bestSim < differentFloor) continue;
        // En una clave MIXTA no hay evidencia para tocar filas sin firma compatible:
        // renombrarlas es exactamente lo que ponia el nombre del titular a la mujer.
        if (claveMixta && anonima && bestSim < floor) continue;
        if (actual === name) continue;
        store.setEntrySpeakerName(e.id, name);
        changed += 1;
    }
    return changed;
}

/**
 * CONGELA el nombre de una voz en las filas que YA son suyas (freeze del dueno 2026-10-17):
 * al identificar una voz ("soy Luis"), toda su participacion pasa a llevar el nombre, escrito
 * EN LA FILA, y no se vuelve a resolver desde el directorio.
 *
 * QUE FILA ES "SUYA": la que lleva su CLAVE (`speakerId`) con rotulo escrito, o la que tiene
 * un TIMBRE MEDIDO que casa con el de la voz (coseno >= piso de "misma voz"). El timbre es la
 * evidencia que faltaba: las participaciones anteriores podian quedar con una clave reciclada
 * y por eso "soy Luis" solo cambiaba la ultima intervencion (defecto del dueno 2026-10-18).
 * Una fila SIN rotulo y SIN medida no hereda nada: no hay evidencia de que sea esa voz.
 *
 * WRITE-ONCE: un nombre propio DISTINTO solo se reescribe si la firma prueba que es la MISMA
 * voz (la excepcion declarada del mandato: "ok flu soy X" sobre su propia voz).
 *
 * La firma de la voz se busca en TODAS sus medidas (`signatures`): la firma aprendida del
 * cluster y su historial. Antes solo se probaba la medida cruda del turno y las filas
 * anteriores de la MISMA voz no casaban: "soy Luis" cambiaba solo la ultima intervencion
 * (defecto medido por el dueno 2026-10-18).
 *
 * @param vector Timbre MEDIDO de la voz identificada (su ancla). Sin el, solo casa por clave.
 * @param signatures Medidas adicionales de ESA voz (firma del cluster + historial).
 * @param floor Piso de timbre para considerar la MISMA voz. Por defecto el de reutilizacion
 *   (0.66), valido cuando el ancla es una medida recien tomada ("soy X"); el
 *   RECONOCIMIENTO de una identidad REGISTRADA pasa el piso de identidad (0.76): con 0.66
 *   la fila de la mujer (0.741 al ancla de Luis) se renombro "Luis" (medido 2026-10-19
 *   21:22:52, `rows:1`). La via "soy X" pasa el piso de ANCLA VERIFICADA (0.62): la MISMA
 *   voz del titular mide 0.629–0.714 contra su ancla de la base y sus filas entre 0.629 y
 *   0.66 se quedaban sin renombrar (defecto 5 del dueno 2026-10-19). Un caller puede
 *   endurecer el piso; solo la via "soy X" (identidad afirmada con su medida fresca del
 *   turno) lo rebaja al piso verificado.
 * @returns cuantas filas se congelaron.
 */
export function freezeVoiceName(
    voiceId: string,
    speakerName: string,
    {
        vector = null,
        signatures = [],
        floor = sameVoiceFloor(),
        epoch,
    }: {
        vector?: number[] | null;
        signatures?: Array<number[] | null | undefined>;
        floor?: number;
        /** Epoch a tocar (por defecto el vigente): una fila de otra conversacion NO se reescribe. */
        epoch?: number;
    } = {},
): number {
    const voz = String(voiceId || '').trim();
    const name = canonicalSpeakerName(String(speakerName || '').trim());
    if (!voz || !name) return 0;
    const medidos = [vector, ...signatures]
        .map((sig) => normalizeRowSignature(sig))
        .filter((sig): sig is number[] => Boolean(sig?.length));
    const store = useIntegrationStore.getState();
    const epochVigente = Number(store.conversationEpoch)
    const epochActual = Number.isFinite(Number(epoch)) ? Number(epoch) : epochVigente;
    let changed = 0;
    store.conversationHistory.forEach((e) => {
        if (e.role !== 'user') return;
        // SOLO el epoch vigente: la conversacion anterior no se reescribe. Sin epoch =
        // fila legacy (cuenta como vigente; la migracion real las estampa al cargar).
        const epochDeLaFila = Number.isFinite(Number(e.epoch)) ? Number(e.epoch) : epochVigente;
        if (epochDeLaFila !== epochActual) return;
        const rowSignature = normalizeRowSignature(e.signature);
        const sameVoiceBySignature = Boolean(
            medidos.length &&
            rowSignature &&
            medidos.some((sig) => compareCosineSignatures(sig, rowSignature) >= floor),
        );
        const sameKey = String(e.speakerId || '') === voz;
        // LA CLAVE SOLA NO PRUEBA CUANDO HAY TIMBRE EN CONTRA (medido 2026-10-19 21:22:52,
        // `identity-recognized {"name":"Luis","label":"Hablante 1","voice":"speaker_1","rows":1}`):
        // la clave de etiqueta (`speaker_1`) se recicla entre personas — la fila MEDIDA de la
        // mujer (0.741 al ancla de Luis, debajo del piso registrado) se renombro "Luis" solo
        // por compartir la clave. Con un ancla medida, manda el TIMBRE de la fila; la clave
        // sigue siendo la evidencia valida para filas SIN medida o cuando no hay ancla con la
        // que comparar (registro/renombre sin vector).
        const provenByKey = sameKey && (!rowSignature || !medidos.length);
        if (!sameVoiceBySignature && !provenByKey) return;
        const actual = String(e.speakerName || '').trim();
        // Evidencia de que la fila es ESA voz: timbre que casa, o su clave con rotulo escrito.
        if (!sameVoiceBySignature && !actual) return;
        // WRITE-ONCE entre identidades: no se pisa un nombre propio DISTINTO sin prueba de
        // timbre. El renombre MANUAL del panel (`renameSpeakerRows`, sin vector) es una
        // decision HUMANA sobre su clave y se honra: no hay medida que la contradiga.
        if (medidos.length && actual && isProperSpeakerName(actual) && actual !== name && !sameVoiceBySignature) return;
        // Re-clava la fila a la voz identificada (una clave reciclada no debe quedar apuntando
        // a un rotulo generico): el nombre viaja con la VOZ, no con la etiqueta.
        if (sameVoiceBySignature && !sameKey) {
            store.setEntrySpeaker(e.id, voz, { signature: rowSignature });
        }
        if (actual === name) return;
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
        vector?: number[] | null;
    } = {},
): boolean {
    // El nombre entra CANONICO (una sola grafia para la fila y la base).
    const name = canonicalSpeakerName(String(speakerName || '').trim());
    if (turnId === null || turnId === undefined || !name) return false;
    const measuredVector = Array.isArray(vector) && vector.length ? vector : null;
    // AFIRMACION de identidad del turno: (a) COINCIDENCIA medida declarada por el resolver,
    // o (b) cluster NUEVO medido: la etiqueta automatica de ESTE turno SI se escribe (con su
    // vector) para que su voz quede rotulada y el freeze de "soy X" la alcance despues. Una
    // etiqueta automatica SIN vector es el respaldo de un tick sin clusters: no afirma nada
    // (antes estampaba "Hablante 1" en toda la sala y mezclaba a la mujer en esa etiqueta).
    if (!evidenciaAcustica && !(measuredVector && isAutoSpeakerLabel(name))) return false;
    const rowId =
        recentTurns.get(String(turnId)) ||
        (currentTurn.id === turnId ? currentTurn.rowId : null);
    if (!rowId) return false;
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;
    const entry = history.find((e) => e.id === rowId);
    if (!entry || entry.role !== 'user') return false;
    const actualName = String(entry.speakerName || '').trim();
    // Un NOMBRE PROPIO ya escrito NO se degrada con una etiqueta AUTOMATICA (su voz puede
    // re-clavarse por timbre, pero la fila conserva el nombre que ya tiene).
    if (isAutoSpeakerLabel(name) && isProperSpeakerName(actualName)) return false;
    // Tampoco se degrada una identidad CONFIRMADA POR EL TIMBRE DEL TURNO aunque la fila aun
    // no la tenga escrita (medido 2026-10-19 21:23:08: `row-update turnId:26 voz:speaker_1
    // nombre:"Hablante 3" evidencia:false medida:512`). La pregunta "es alguien" tiene dueno
    // unico (`resolveVoiceIdentity`, la misma regla del commit): si responde un nombre propio,
    // la etiqueta automatica no afirma nada y no se escribe.
    if (isAutoSpeakerLabel(name) && measuredVector) {
        // MISMOS CANDIDATOS QUE App (auditoria 2026-10-23): sin ellos esta ruta no veia las
        // anclas de la base y la misma voz salia conocida en App y desconocida en la fila.
        const conocida = resolveVoiceIdentity(measuredVector, { candidates: getParticipantAnchors() });
        if (conocida?.name && isProperSpeakerName(conocida.name)) return false;
    }
    const vozDeEtiqueta = String(entry.speakerId || '') || labelToSpeakerId(actualName);
    if (!vozDeEtiqueta) return false;
    // UNA VOZ, UNA CLAVE: con timbre medido el nombre se pega a la VOZ resuelta por su
    // firma (`voiceKeyFor`), NUNCA a la clave derivada de la ETIQUETA ("Hablante 1" ->
    // `speaker_1`), que la reutiliza otra persona al diarizar con la misma etiqueta. Sin
    // esa separacion, "Luis" quedaba colgado de `speaker_1` y la mujer que diariza
    // "Hablante 1" heredaba su nombre (medido en el log del dueno 2026-10-17: las
    // intervenciones de la mujer salian como "Luis").
    const voz = voiceKeyFor({ voiceId: vozDeEtiqueta, signature: measuredVector });
    registerVoiceName(voz, name, { vector: measuredVector });
    // La fila guarda SU VOZ y su TIMBRE: la firma es la evidencia con la que el freeze de
    // "soy X" reconoce TODAS las participaciones de esa voz (`freezeVoiceName`), aunque su
    // clave se haya reciclado o el rotulo escrito sea otro.
    store.setEntrySpeaker(rowId, voz, { signature: measuredVector });
    // FREEZE del nombre en ESTA fila (mandato 2026-10-17): el nombre queda congelado aqui y no
    // se re-resuelve desde el directorio; una voz distinta que reutilice la clave no lo hereda.
    store.setEntrySpeakerName(rowId, name);
    voiceProbe('row-update', { turnId, voz, nombre: name, fila: rowId, evidencia: evidenciaAcustica, medida: measuredVector?.length ?? 0 });
    return true;
}

export interface UserTurnRowInput {
    /** Frase canónica de la locución (con wake word, tal como se muestra). */
    text: string;
    /** Hablante resuelto (puede llegar en el commit final, no en el temprano). */
    speakerName?: string;
    /** El que llama DECLARA que el nombre viene de una ventana de AUDIO medida. */
    evidenciaAcustica?: boolean;
    /** FIRMA de la voz del turno (para sustituir el nombre en TODAS las filas de esa voz). */
    signature?: number[] | null;
    /**
     * Epoch de la fila. Por defecto lo toma del store (`useIntegrationStore.getState()`):
     * el llamador solo lo fija en replay/tests. El renombre por voz filtra por este dato.
     */
    epoch?: number;
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
        // ETIQUETA DE DISPLAY (mandato 2026-10-18): lo que el usuario VE al mostrar la
        // fila (`resolveRowSpeakerLabel`), no lo que quedo escrito. Sin esto el log solo
        // probaba la escritura y el invento del display ("Hablante 1") era invisible.
        vista: fila ? resolveRowSpeakerLabel(fila) : '',
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
    signature = null,
    sentiment = 'neutral',
    epoch,
}: UserTurnRowInput): UserTurnRowResult {
    const raw = String(text || '');
    const norm = cleanForSpeech(raw).toLowerCase();
    if (!norm) return { id: null, action: 'skipped' };
    const store = useIntegrationStore.getState();
    const history = store.conversationHistory;
    // EPOCH de la fila: dueno del dato = el store; el input solo lo fija en replay/tests.
    const epochDeLaFila = Number.isFinite(Number(epoch)) ? Number(epoch) : store.conversationEpoch;
    // Frontera del turno actual: todo lo posterior a la última respuesta de FLU.
    let turnStart = 0;
    for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i]?.role === 'flu') {
            turnStart = i + 1;
            break;
        }
    }

    const resolved = resolveRowSpeakerName(speakerName || '');
    // LA VOZ de la fila (no su nombre): el nombre se resuelve al MOSTRAR. La clave es el
    // TIMBRE cuando se midio (mismo timbre = misma clave aunque cambie la etiqueta).
    const vozDeLaFila = voiceKeyFor({ voiceId: labelToSpeakerId(resolved), signature });
    // HIGH-WATER de la sesion: la clave automatica de esta fila fija el numero usado (nunca
    // baja; borrar un hablante o podar clusters no lo toca). Escritor unico: esta puerta.
    store.noteSpeakerHighWater(autoSpeakerIndexFromKey(vozDeLaFila) ?? 0);
    // FREEZE (mandato del dueno 2026-10-17): la fila nace con su etiqueta CONGELADA — la
    // etiqueta que RESOLVIO la diarizacion para ESTE turno, canonica ("luis" -> "Luis"), no
    // la grafia cruda del aporte. Antes se escribia SIEMPRE `speakerIdToDefaultName(voz)`, y
    // una voz que el resolver ya llamaba «Hablante 3» se pintaba «Hablante 2» (o el dueno
    // con su ancla salia «Hablante 2») porque su TIMBRE habia casado antes con la clave de
    // otra etiqueta: la clave agrupa el timbre, la etiqueta la decide el turno (medido
    // 2026-10-19, sesion 18f3888c). El respaldo no aporta etiqueta y se completa con la VOZ.
    const etiquetaVisible = resolveRowVisibleLabel(resolved, vozDeLaFila);
    // MONOLOGO (mandato del dueno 2026-10-23): una fila CERRADA no puede quedar en la etiqueta
    // pendiente cuando la sesion entera tiene UNA sola etiqueta automatica; esa etiqueta es la
    // continuidad de su unica voz. Con 2+ etiquetas, `?` sigue siendo legitimo.
    const etiquetaDeLaFila =
        etiquetaVisible === pendingSpeakerLabel()
            ? etiquetaUnicaDeLaSesion(history, epochDeLaFila) ||
              continuityLabelForMonologue(getSessionClusters(), { lastSpeaker: '' }) ||
              etiquetaVisible
            : etiquetaVisible;
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
            // IDENTIDAD DE TURNO: la fila que se reutiliza tiene que ser de ESTE turno. El
            // `replaceLast` se decide por TEXTO (dos locuciones parecidas) y podia completar/renombrar
            // la fila de un turno ANTERIOR cuando FLU aun no habia respondido (auditoria 2026-10-22).
            // Si alguno de los dos turnos se desconoce, se conserva la conducta anterior.
            // Un solo criterio (`filaPuedeSerDeEsteTurno`), compartido con la rama P9.67.
            if (!filaPuedeSerDeEsteTurno(entry as { turnId?: number | string | null }, turnId)) {
                continue;
            }
            if (!entry || entry.role !== 'user') continue;
            // WRITE-ONCE del NOMBRE: un `speaker_name_*` ya commiteado no se reescribe (el
            // nombre propio no se mueve). Un placeholder auto (`speaker_N`) si se completa.
            if (esNombrePropioDeFila(entry)) {
                rememberTurn(turnId, entry.id);
                return { id: entry.id, action: 'reused' };
            }
            store.setEntrySpeaker(entry.id, vozDeLaFila, { signature });
            if (hayRotuloPropio) freezeResolvedSpeakerName(store, entry.id, etiquetaDeLaFila);
            rememberTurn(turnId, entry.id);
            return { id: entry.id, action: 'reused' };
        }
        // RECORTE POSTERIOR (P9.67): si el texto es un TROZO contiguo de la última fila de
        // usuario (o al revés), la fila se REUTILIZA — el wake recorta la locución y el commit
        // llega con la MISMA frase. El dueno de "es trozo" es `isFragmentOfLocution` (uno solo).
        // IDENTIDAD DE TURNO OBLIGATORIA (mandato del dueno 2026-10-23, 3a pasada): la fusion
        // exige que la fila sea DEL MISMO turno. Antes se admitia "aunque el turno haya
        // cambiado" y un fragmento podia completar la fila de OTRO turno (turnId 10 -> 11). Si
        // el turno cambia, la fila la escribe SU commit: identidad manda sobre parecido de texto.
        const ultima = [...history]
            .reverse()
            .find((e) => e?.role === 'user' && filaPuedeSerDeEsteTurno(e as { turnId?: number | string | null }, turnId));
        if (ultima) {
            const previo = String(ultima.text || '');
            const rawEsTrozo = isFragmentOfLocution(raw, previo);
            const previoEsTrozo = !rawEsTrozo && isFragmentOfLocution(previo, raw);
            if (rawEsTrozo || previoEsTrozo) {
                // P1 insert-only: el texto de una fila se decide UNA vez, en su insercion.
                // WRITE-ONCE del NOMBRE: un nombre propio ya commiteado no se reescribe.
                if (!esNombrePropioDeFila(ultima)) {
                    store.setEntrySpeaker(ultima.id, vozDeLaFila, { signature });
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
    const mismoTurnoPorId =
        !turnoDesconocido(turnId) && !turnoDesconocido(currentTurn.id) && currentTurn.id === turnId && currentTurn.rowId != null;
    if (mismoTurnoPorId) {
        const entry = history.find((e) => e.id === currentTurn.rowId);
        if (entry && entry.role === 'user') {
            // WRITE-ONCE del NOMBRE: un nombre propio ya commiteado no se reescribe; un
            // placeholder auto si se completa (commit temprano -> resolucion).
            if (esNombrePropioDeFila(entry)) {
                rememberTurn(turnId, entry.id);
                return { id: entry.id, action: 'reused' };
            }
            store.setEntrySpeaker(entry.id, vozDeLaFila, { signature });
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
        epoch: epochDeLaFila,
        text: raw,
        speakerId: vozDeLaFila,
        // El TURNO viaja con la fila (identidad durable, auditoria 2026-10-23): sin este dato
        // la fila no se puede reutilizar ni completar con seguridad.
        ...(turnoDesconocido(turnId) ? {} : { turnId }),
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
