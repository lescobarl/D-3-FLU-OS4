// ============================================================
// minuteKnowledgeHelpers — OS2 parity for minute KB lookups
// ============================================================
// Adaptación de ../D-3-FLU-OS2/flu-voz/src/lib/minuteKnowledge.js
// y minuteQueryResolve.js para OS3, donde los datos viven en
// IndexedDB vía useMinuteKnowledge y el contrato del hook de
// voz exige { mode: 'local' | 'gemini', contract, diagnostics }.
//
// Funciones (todas exportadas y reusables en tests):
//   - parseMinuteHistoryCode(code)           → { date, sequence }
//   - parseMinuteSequenceFromQuery(text)     → number | null
//   - findMinuteRecordBySequence(records,n)  → record | null
//   - resolveMinuteThemeForSpeech(snap,rec)  → string (tema útil)
//   - isGenericMinuteSessionTheme(theme)     → boolean
//   - formatMinuteKnowledgeEntry(record)     → string (KB text)
//   - buildMinuteKnowledgeBase2(records)     → string (KB completa)
//   - buildMinuteLookupContract({...})        → { respuesta_voz, navegacion, workspace }
//   - resolveMinuteQuery(query,records,opts)  → { mode, contract?, diagnostics? }
//
// Las funciones de formateo de draft (createMinuteDraftFromSummary,
// formatMinuteDraftText) se mantienen inline para no depender del
// alias de Vite 'flu-voz/lib/...' en tests; el formato y campos
// coinciden con FLU_CONFIG.ui.minuteFields de OS2.
// ============================================================

import { normalizeSpaces, cleanForSpeech } from './textUtils';
import { isTutoringGlobalProgressQuery, isTutoringReviewQuery, parseTutoringProgressQuery, resolveTutoringLevel, type TutoringArea } from '../core/tutoring/tutoringModel';
import { buildTutoringProgress, listTutoringAreas, type TutoringMinuteLike, type TutoringProgress } from '../core/tutoring/tutoringProgress';
import { buildTutoringReview, type TutoringReview } from '../core/tutoring/tutoringReview';
import { MONTH_DISPLAY_ES } from '../core/temporal/calendarNames';

/** Snapshot de minuta (campos opcionales) admitido por los helpers. */
export interface MinuteSnapshotLike {
    id?: string;
    kind?: string;
    titulo?: string;
    tema_sesion?: string;
    resumen?: string;
    participantes?: string[];
    acuerdos?: string[];
    pendientes?: string[];
    siguientes_pasos?: string[];
    /** Area de tutoria de la sesion (P8.58), cuando la sesion la declaro. */
    tutoring_area?: string;
    /** Practica de la sesion (P8.63): aciertos/errores que conto el tutor. */
    practica?: { aciertos: number; errores: number };
    date?: string;
    mood?: unknown;
    content?: string;
}

/** Registro de conocimiento (minuta/conversación) admitido por los helpers. */
export interface MinuteRecordLike extends MinuteSnapshotLike {
    description?: string;
    historyCode?: string;
    summarySnapshot?: MinuteSnapshotLike;
}

/** Entrada de diario admitida por los helpers. */
export interface DiaryEntryLike {
    date?: string;
    title?: string;
    content?: string;
    mood?: unknown;
}

// ------------------------------------------------------------
// Etiquetas OS2 (FLU_CONFIG.ui.minuteFields) — versionadas
// ------------------------------------------------------------

const MINUTE_FIELDS = {
    title: 'Titulo',
    summary: 'Resumen',
    participants: 'Participantes',
    agreements: 'Acuerdos',
    pending: 'Pendientes',
    nextSteps: 'Siguientes pasos',
};

// ------------------------------------------------------------
// historyCode parser: "260713-01" → { date: "260713", sequence: 1 }
// ------------------------------------------------------------

export function parseMinuteHistoryCode(code: string = ''): { date: string; sequence: number } {
    const normalized = normalizeSpaces(code);
    const match = normalized.match(/^(\d{6})-(\d+)$/);
    if (!match) return { date: normalized, sequence: 0 };
    return {
        date: match[1],
        sequence: Number.parseInt(match[2], 10) || 0,
    };
}

/**
 * Clave de deduplicacion de una minuta: `titulo|tema` normalizado.
 *
 * DUENO UNICO (auditoria de codigo 2026-10-02): el hook de persistencia
 * (useMinuteKnowledge) y la capa de voz (voice/lib/minuteKnowledge) usan ESTA
 * misma funcion. Antes cada uno tenia su formula y YA divergian: con un titulo
 * con guion o espacios dobles la clave no coincidia y el upsert por `minuteKey`
 * duplicaba la minuta (AGENTS.md 7.7.c: un dominio, un almacen).
 */
export function buildMinuteKey(summary: MinuteSnapshotLike = {}): string {
    const title = normalizeSpaces(summary?.titulo || '');
    const sessionTheme = normalizeSpaces(summary?.tema_sesion || '');
    return cleanForSpeech(`${title}|${sessionTheme}`).toLowerCase();
}

/**
 * Codigo de historial de minuta: YYMMDD-NN (dueno unico, misma razon que
 * buildMinuteKey). `sequence` va con ceros a la izquierda para que el orden
 * lexicografico del codigo sea el orden cronologico.
 */
export function formatMinuteHistoryCode(date: Date = new Date(), sequence = 1): string {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const seq = String(sequence).padStart(2, '0');
    return `${year}${month}${day}-${seq}`;
}

/** Code admitido por el comparador: el string o una entrada con `historyCode`. */
export type MinuteHistoryCodeLike = string | { historyCode?: string } | null | undefined;

function historyCodeOf(value: MinuteHistoryCodeLike): string {
    return typeof value === 'string' ? value : value?.historyCode || '';
}

/**
 * Compara dos codigos de historial DESCENDENTE (mas reciente primero).
 *
 * DUENO UNICO (auditoria 2026-10-02): el hook pasaba strings y la capa de voz
 * entradas; eran DOS copias de la misma regla (compareHistoryCodeDesc vs
 * compareMinuteHistoryCodeDesc). Acepta las dos formas para que ambos caminos
 * llamen a ESTA funcion.
 */
export function compareMinuteHistoryCodeDesc(
    left: MinuteHistoryCodeLike = '',
    right: MinuteHistoryCodeLike = '',
): number {
    const a = parseMinuteHistoryCode(historyCodeOf(left));
    const b = parseMinuteHistoryCode(historyCodeOf(right));
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return b.sequence - a.sequence;
}

/** Inverso exacto del comparador descendente. */
export function compareMinuteHistoryCodeAsc(
    left: MinuteHistoryCodeLike = '',
    right: MinuteHistoryCodeLike = '',
): number {
    return compareMinuteHistoryCodeDesc(right, left);
}

/**
 * Siguiente secuencia universal de historyCode (1-based).
 *
 * DUENO UNICO: era getNextUniversalHistorySequence (voz) y getNextSequence
 * (hook), dos copias identicas.
 */
export function nextMinuteHistorySequence(entries: Array<{ historyCode?: string }> = []): number {
    return (
        entries.reduce((max, entry) => {
            const { sequence } = parseMinuteHistoryCode(entry?.historyCode || '');
            return Math.max(max, sequence);
        }, 0) + 1
    );
}

/**
 * Etiqueta de historial `CODE-Descripcion` (o solo lo que haya).
 *
 * DUENO UNICO: formatMinuteHistoryLabel (voz) y formatMinuteHistoryLabelForUi
 * (hook) eran la misma funcion con dos nombres.
 */
export function formatMinuteHistoryLabel(entry: MinuteRecordLike = {}): string {
    const code = normalizeSpaces(entry?.historyCode || '');
    const description = normalizeSpaces(
        entry?.description || entry?.summarySnapshot?.titulo || entry?.titulo || '',
    );
    if (!code) return description;
    if (!description) return code;
    return `${code}-${description}`;
}

// ------------------------------------------------------------
// Minuta: "minuta uno" / "minute 4" → número de secuencia
// ------------------------------------------------------------

const MINUTE_NUMBER_WORDS: Record<string, number> = {
    uno: 1, one: 1,
    dos: 2, two: 2,
    tres: 3, three: 3,
    cuatro: 4, four: 4,
    cinco: 5, five: 5,
    seis: 6, six: 6,
    siete: 7, seven: 7,
    ocho: 8, eight: 8,
    nueve: 9, nine: 9,
    diez: 10, ten: 10,
};

const MINUTE_SEQUENCE_PATTERNS = [
    /\b(?:la\s+)?minuta\s+(?:numero\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\b/i,
    /\bde\s+(?:la\s+)?minuta\s+(?:numero\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\b/i,
    /\bminute\s+(?:number\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i,
];

function parseMinuteSequenceToken(token: string = ''): number | null {
    const normalized = normalizeSpaces(token).toLowerCase();
    if (!normalized) return null;
    if (MINUTE_NUMBER_WORDS[normalized]) return MINUTE_NUMBER_WORDS[normalized];
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Extrae el número de minuta pedido en voz ("minuta 2", "minuta dos", "minute 4"). */
export function parseMinuteSequenceFromQuery(text: string = ''): number | null {
    const normalized = cleanForSpeech(text);
    if (!normalized) return null;
    for (const pattern of MINUTE_SEQUENCE_PATTERNS) {
        const match = normalized.match(pattern);
        const sequence = parseMinuteSequenceToken(match?.[1] || '');
        if (sequence) return sequence;
    }
    return null;
}

// ------------------------------------------------------------
// Búsqueda por secuencia: 1 → primer record con historyCode "-01"
// ------------------------------------------------------------

/** Localiza la minuta cuyo historyCode termina en la secuencia pedida (p. ej. 2 → 260630-02). */
export function findMinuteRecordBySequence<T extends { historyCode?: string }>(records: T[] = [], sequence: number = 0): T | null {
    const target = Number.parseInt(String(sequence), 10);
    if (!Number.isFinite(target) || target <= 0 || !Array.isArray(records) || !records.length) {
        return null;
    }
    const matches = records.filter((record) => {
        const { sequence: codeSequence } = parseMinuteHistoryCode(record?.historyCode || '');
        return codeSequence === target;
    });
    if (!matches.length) return null;
    // Si hay varias con la misma secuencia, tomar la más reciente (lexicográficamente mayor).
    return [...matches].sort((a, b) =>
        String(b?.historyCode || '').localeCompare(String(a?.historyCode || '')),
    )[0] || null;
}

// ------------------------------------------------------------
// Tema: omitir placeholder genérico y duplicado del título
// ------------------------------------------------------------

export function isGenericMinuteSessionTheme(theme: string = '', defaultTheme: string = ''): boolean {
    const normalized = cleanForSpeech(theme).toLowerCase();
    if (!normalized) return true;
    if (defaultTheme) return normalized === cleanForSpeech(defaultTheme).toLowerCase();
    return false;
}

/** Tema útil para voz/UI; omite placeholder genérico y duplicado del título. */
export function resolveMinuteThemeForSpeech(
    snapshot: MinuteSnapshotLike = {},
    record: MinuteRecordLike = {},
    options: { defaultTheme?: string } = {},
): string {
    const titulo = normalizeSpaces(snapshot?.titulo || record?.description || '');
    const tema = normalizeSpaces(snapshot?.tema_sesion || '');
    if (!tema || isGenericMinuteSessionTheme(tema, options.defaultTheme)) return '';
    if (titulo && cleanForSpeech(titulo).toLowerCase() === cleanForSpeech(tema).toLowerCase()) return '';
    return tema;
}

// ------------------------------------------------------------
// createMinuteDraftFromSummary (OS2 parity) — usado por buildMinuteLookupContract
// ------------------------------------------------------------

export function createMinuteDraftFromSummary(summary: MinuteSnapshotLike = {}, theme: string = '', id: string = ''): {
    id: string;
    titulo: string;
    participantes: string[];
    resumen: string;
    acuerdos: string[];
    pendientes: string[];
    siguientes_pasos: string[];
    tema_sesion: string;
} {
    return {
        id: String(id || summary?.id || '').trim(),
        titulo: normalizeSpaces(summary?.titulo || ''),
        participantes: Array.isArray(summary?.participantes)
            ? summary.participantes.map((item: string) => normalizeSpaces(item)).filter(Boolean)
            : [],
        resumen: normalizeSpaces(summary?.resumen || ''),
        acuerdos: Array.isArray(summary?.acuerdos)
            ? summary.acuerdos.map((item: string) => normalizeSpaces(item)).filter(Boolean)
            : [],
        pendientes: Array.isArray(summary?.pendientes)
            ? summary.pendientes.map((item: string) => normalizeSpaces(item)).filter(Boolean)
            : [],
        siguientes_pasos: Array.isArray(summary?.siguientes_pasos)
            ? summary.siguientes_pasos.map((item: string) => normalizeSpaces(item)).filter(Boolean)
            : [],
        tema_sesion: normalizeSpaces(summary?.tema_sesion || theme),
    };
}

// ------------------------------------------------------------
// formatMinuteDraftText (OS2 parity) — formatea un draft como bloque de texto
// ------------------------------------------------------------

function listSection(label: string, items: string[] = []): string {
    if (!items.length) return `${label}:`;
    return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

export function formatMinuteDraftText(draft: MinuteSnapshotLike = {}): string {
    return [
        `${MINUTE_FIELDS.title}: ${normalizeSpaces(draft?.titulo || '')}`,
        `${MINUTE_FIELDS.participants}: ${Array.isArray(draft?.participantes) ? draft.participantes.join(', ') : ''}`,
        `${MINUTE_FIELDS.summary}: ${normalizeSpaces(draft?.resumen || '')}`,
        listSection(MINUTE_FIELDS.agreements, Array.isArray(draft?.acuerdos) ? draft.acuerdos : []),
        listSection(MINUTE_FIELDS.pending, Array.isArray(draft?.pendientes) ? draft.pendientes : []),
        listSection(MINUTE_FIELDS.nextSteps, Array.isArray(draft?.siguientes_pasos) ? draft.siguientes_pasos : []),
    ].join('\n\n');
}

// ------------------------------------------------------------
// Formato de una minuta individual para KB
// ------------------------------------------------------------

/**
 * Resuelve la etiqueta legible de un registro según su `kind`.
 * Los registros sin `kind` (retrocompatibles) se tratan como 'minuta'.
 */
function resolveKindLabel(kind: string = ''): string {
    switch (kind) {
        case 'conversacion':
            return 'Conversacion';
        case 'diario':
            return 'Diario';
        case 'minuta':
        default:
            return 'Minuta';
    }
}

export function formatMinuteKnowledgeEntry(
    record: MinuteRecordLike = {},
    { fallbackIndex = 0, defaultTheme }: { fallbackIndex?: number; defaultTheme?: string } = {},
): string {
    const snapshot = record?.summarySnapshot || record;
    const kind = String(snapshot?.kind || record?.kind || 'minuta');
    const kindLabel = resolveKindLabel(kind);
    const code = normalizeSpaces(record?.historyCode || '');
    const { sequence } = parseMinuteHistoryCode(code);
    const seqLabel = sequence > 0 ? String(sequence) : String(fallbackIndex + 1);
    const header = code
        ? `[${kindLabel} ${seqLabel} · ${code}] ${record?.description || snapshot?.titulo || ''}`.trim()
        : `[${kindLabel} ${seqLabel}] ${record?.description || snapshot?.titulo || ''}`.trim();

    // Diario: renderiza la entrada directamente (fecha + contenido + ánimo),
    // sin las etiquetas de minuta (acuerdos/pendientes/siguientes pasos).
    if (kind === 'diario') {
        const date = String(snapshot?.date || record?.date || '');
        const mood = snapshot?.mood != null ? ` (ánimo ${snapshot.mood})` : '';
        const content = String(snapshot?.content || snapshot?.resumen || '').trim();
        const body = [
            date ? `Fecha: ${date}` : '',
            content ? `Contenido: ${content}` : '',
        ]
            .filter(Boolean)
            .join('\n');
        return `${header}${mood}\n${body}`.trim();
    }

    const speechTheme = resolveMinuteThemeForSpeech(snapshot, record, { defaultTheme });
    const body = [
        snapshot?.titulo ? `Titulo: ${snapshot.titulo}` : '',
        speechTheme ? `Tema: ${speechTheme}` : '',
        snapshot?.resumen ? `Resumen: ${snapshot.resumen}` : '',
        snapshot?.participantes?.length ? `Participantes: ${snapshot.participantes.join(', ')}` : '',
        snapshot?.acuerdos?.length ? `Acuerdos: ${snapshot.acuerdos.join(' | ')}` : '',
        snapshot?.pendientes?.length ? `Pendientes: ${snapshot.pendientes.join(' | ')}` : '',
        snapshot?.siguientes_pasos?.length ? `Siguientes pasos: ${snapshot.siguientes_pasos.join(' | ')}` : '',
    ]
        .filter(Boolean)
        .join('\n');

    return `${header}\n${body}`.trim();
}

/** Convierte una entrada de diario (DiaryEntryRecord) a un registro de conocimiento con kind 'diario'. */
function diaryEntryToKnowledgeRecord(entry: DiaryEntryLike = {}): MinuteRecordLike {
    const date = String(entry?.date || '');
    const title = String(entry?.title || '').trim();
    const content = String(entry?.content || '').trim();
    const mood = entry?.mood;
    const description = title || (date ? `Diario ${date}` : 'Diario');
    return {
        kind: 'diario',
        description,
        summarySnapshot: {
            kind: 'diario',
            titulo: description,
            date,
            content,
            mood,
            resumen: content,
            participantes: [],
            acuerdos: [],
            pendientes: [],
            siguientes_pasos: [],
            tema_sesion: '',
        },
    };
}

/**
 * Construye KB2 (texto) a partir de minutas, resúmenes de conversación y
 * entradas de diario, listo para inyectar al prompt de Gemini.
 * - `records`: MinuteRecord[] (minutas + conversaciones con kind).
 * - `options.diary`: DiaryEntryRecord[] (se normalizan a kind 'diario').
 */
export function buildMinuteKnowledgeBase2(records: MinuteRecordLike[] = [], options?: { diary?: DiaryEntryLike[] }): string {
    const diaryRecords = (options?.diary || []).map(diaryEntryToKnowledgeRecord);
    const all = [...(Array.isArray(records) ? records : []), ...diaryRecords];
    if (!all.length) return '';
    return all
        .map((record, index) => formatMinuteKnowledgeEntry(record, { fallbackIndex: index }))
        .filter(Boolean)
        .join('\n\n');
}

// ------------------------------------------------------------
// Selección de minuta por historyCode (para poblar MinuteDraftPanel
// en onContractResolved cuando diagnostics.route === 'minute-lookup-hit')
// ------------------------------------------------------------

export interface MinuteLookupSelection {
    matched: MinuteRecordLike;
    draft: ReturnType<typeof createMinuteDraftFromSummary>;
    shouldSwitchTab: boolean;
}

export interface MinuteLookupSelectionInput {
    diagnostics: { route?: string; historyCode?: string | null; [k: string]: unknown } | null | undefined;
    minutes: MinuteRecordLike[];
    conversationActive: boolean;
    fallbackTheme?: string;
}

/**
 * Determina qué minuta debe poblar el panel "Minuta de acuerdos" cuando
 * llega un contrato desde el hook de voz.
 * Retorna `null` si no aplica (route distinto o no encuentra la minuta).
 *
 * Reglas:
 *  - Sólo aplica cuando diagnostics.route === 'minute-lookup-hit' y hay historyCode.
 *  - Busca la minuta en `minutes` por historyCode exacto.
 *  - Construye el draft usando createMinuteDraftFromSummary.
 *  - shouldSwitchTab === !conversationActive (no interrumpir conversación activa).
 */
export function selectMinuteForLookup(input: MinuteLookupSelectionInput): MinuteLookupSelection | null {
    const { diagnostics, minutes, conversationActive, fallbackTheme = '' } = input;
    if (!diagnostics || diagnostics.route !== 'minute-lookup-hit' || !diagnostics.historyCode) {
        return null;
    }
    const targetCode = diagnostics.historyCode;
    if (!Array.isArray(minutes) || !minutes.length) return null;
    const matched = minutes.find((m) => m && m.historyCode === targetCode);
    if (!matched) return null;
    const snapshot = matched.summarySnapshot || matched;
    const theme = snapshot?.tema_sesion || fallbackTheme;
    return {
        matched,
        draft: createMinuteDraftFromSummary(snapshot, theme, matched.id),
        shouldSwitchTab: !conversationActive,
    };
}

// ------------------------------------------------------------
// Catálogo de minutas (para mensaje de "no encontrada")
// ------------------------------------------------------------

function minuteCatalogSpeech(records: MinuteRecordLike[] = [], { language = 'es' }: { language?: string } = {}): string {
    const isEnglish = language === 'en';
    if (!Array.isArray(records) || !records.length) {
        return isEnglish ? 'No saved minutes yet.' : 'Aun no hay minutas guardadas.';
    }
    const labels = records
        .map((record, index) => {
            const snapshot = record?.summarySnapshot || record;
            const kind = String(snapshot?.kind || record?.kind || 'minuta');
            const kindLabel = resolveKindLabel(kind).toLowerCase();
            const code = String(record?.historyCode || '').trim();
            const { sequence } = parseMinuteHistoryCode(code);
            const seqLabel = sequence > 0 ? sequence : index + 1;
            const title = String(record?.description || snapshot?.titulo || '').trim();
            return title ? `${kindLabel} ${seqLabel} (${title})` : `${kindLabel} ${seqLabel}`;
        })
        .filter(Boolean);
    return labels.join(', ');
}

// ------------------------------------------------------------
// Contrato Flu para consulta de minuta (respuesta local)
// ------------------------------------------------------------

export interface MinuteLookupWorkspace {
    tipo: 'text';
    titulo: string;
    contenido: string;
    prompt_visual: string;
    puntos_clave: string[];
}

export interface MinuteLookupContract {
    respuesta_voz: string;
    navegacion: { comando: null; destino: null; parametros: Record<string, never> };
    workspace: MinuteLookupWorkspace | null;
}

export interface MinuteLookupContractInput {
    sequence?: number;
    record?: MinuteRecordLike | null;
    records?: MinuteRecordLike[];
    language?: string;
}

/** Con registro presente, el workspace queda garantizado (no nulo). */
export function buildMinuteLookupContract(
    input: MinuteLookupContractInput & { record: MinuteRecordLike },
): MinuteLookupContract & { workspace: MinuteLookupWorkspace };
export function buildMinuteLookupContract(
    input: MinuteLookupContractInput,
): MinuteLookupContract;
export function buildMinuteLookupContract({
    sequence = 0,
    record = null,
    records = [],
    language = 'es',
}: MinuteLookupContractInput = {}): MinuteLookupContract {
    const isEnglish = language === 'en';
    const target = Number.parseInt(String(sequence), 10);

    if (!record) {
        const catalog = minuteCatalogSpeech(records, { language });
        const respuesta_voz = isEnglish
            ? `I could not find minute ${target} in the history. Available: ${catalog}.`
            : `No encuentro la minuta ${target} en el historial. Disponibles: ${catalog}.`;

        return {
            respuesta_voz: cleanForSpeech(respuesta_voz),
            navegacion: { comando: null, destino: null, parametros: {} },
            workspace: null,
        };
    }

    const snapshot = record?.summarySnapshot || record;
    const kind = String(snapshot?.kind || record?.kind || 'minuta');
    const kindLabel = resolveKindLabel(kind);
    const code = String(record?.historyCode || '').trim();
    const { sequence: codeSequence } = parseMinuteHistoryCode(code);
    const seqLabel = codeSequence > 0 ? codeSequence : target;
    const titulo = String(snapshot?.titulo || record?.description || '').trim();
    const titleLabel = titulo || (isEnglish ? `${kindLabel} ${seqLabel}` : `${kindLabel} ${seqLabel}`);
    const codeSpeech = code ? code.replace('-', ' ') : '';
    const speechTheme = resolveMinuteThemeForSpeech(snapshot, record);

    const spokenParts: string[] = [];
    if (isEnglish) {
        spokenParts.push(
            `${kindLabel} ${seqLabel}${codeSpeech ? `, id ${codeSpeech},` : ','} ${titleLabel}.`,
        );
        if (speechTheme) spokenParts.push(`Topic: ${speechTheme}.`);
        if (snapshot?.resumen) spokenParts.push(snapshot.resumen);
        if (snapshot?.acuerdos?.length) spokenParts.push(`Agreements: ${snapshot.acuerdos.join('. ')}.`);
        if (snapshot?.pendientes?.length) spokenParts.push(`Pending: ${snapshot.pendientes.join('. ')}.`);
        if (snapshot?.siguientes_pasos?.length) {
            spokenParts.push(`Next steps: ${snapshot.siguientes_pasos.join('. ')}.`);
        }
    } else {
        spokenParts.push(
            `La ${kindLabel.toLowerCase()} ${seqLabel}${codeSpeech ? `, identificada como ${codeSpeech},` : ''} ${titulo ? `titulada ${titulo},` : ''}`,
        );
        if (speechTheme) spokenParts.push(` trata sobre ${speechTheme}.`);
        if (snapshot?.resumen) spokenParts.push(` ${snapshot.resumen}`);
        if (snapshot?.acuerdos?.length) spokenParts.push(` Acuerdos: ${snapshot.acuerdos.join('. ')}.`);
        if (snapshot?.pendientes?.length) spokenParts.push(` Pendientes: ${snapshot.pendientes.join('. ')}.`);
        if (snapshot?.siguientes_pasos?.length) {
            spokenParts.push(` Siguientes pasos: ${snapshot.siguientes_pasos.join('. ')}.`);
        }
    }

    const draft = createMinuteDraftFromSummary(snapshot, snapshot?.tema_sesion, record?.id);
    const puntosClave = [
        ...(Array.isArray(snapshot?.acuerdos) ? snapshot.acuerdos : []),
        ...(Array.isArray(snapshot?.siguientes_pasos) ? snapshot.siguientes_pasos : []),
    ]
        .map((item: string) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 5);

    return {
        respuesta_voz: cleanForSpeech(spokenParts.join('')),
        navegacion: { comando: null, destino: null, parametros: {} },
        workspace: {
            tipo: 'text',
            titulo: titleLabel,
            contenido: formatMinuteDraftText(draft),
            prompt_visual: '',
            puntos_clave: puntosClave,
        },
    };
}

// ------------------------------------------------------------
// Resolver consulta de minuta: número → local; otra → gemini
// ------------------------------------------------------------

export type MinuteLookupMode = 'local' | 'gemini';

export interface MinuteLookupResult {
    mode: MinuteLookupMode;
    contract?: ReturnType<typeof buildMinuteLookupContract>;
    diagnostics?: {
        provider: string;
        route: string;
        sequence: number | null;
        historyCode: string | null;
    };
}

/**
 * Consulta numerada → lectura local determinista; historial general → Gemini.
 */
// ------------------------------------------------------------
// TUTORIA: avance por AREA, derivado de las minutas (P8.57)
// ------------------------------------------------------------
// La consulta "¿como voy en ingles?" no la contestaba nadie: caia al LLM, que
// solo puede inventarse el avance. Las minutas son el UNICO almacen del avance,
// asi que aqui se DERIVA (no hay tabla nueva, AGENTS 7.7.c) y la respuesta sale
// en local, sin IA. El vocabulario de areas y la deteccion de la consulta viven
// en su dueno (core/tutoring/tutoringModel).


/**
 * Fecha legible de la ultima sesion (P8.59). La minuta guarda el codigo YYMMDD
 * (o una fecha ISO); se presenta como "5 de octubre de 2026" (es) o "2026-10-05"
 * (en). Los nombres de mes salen de su dueno unico (calendarNames).
 */
function tutoringDateLabel(raw: string = '', language = 'es'): string {
    const value = normalizeSpaces(raw);
    if (!value) return '';
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const code = value.match(/^(\d{2})(\d{2})(\d{2})(?:-\d+)?$/);
    let year = '';
    let month = 0;
    let day = 0;
    if (iso) {
        year = iso[1];
        month = Number(iso[2]);
        day = Number(iso[3]);
    } else if (code) {
        year = `20${code[1]}`;
        month = Number(code[2]);
        day = Number(code[3]);
    } else {
        return value;
    }
    if (!month || month > 12 || !day) return value;
    if (language === 'en') return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return `${day} de ${MONTH_DISPLAY_ES[month - 1]} de ${year}`;
}

/** "9 aciertos" / "1 error": singular o plural segun el numero (P8.63). */
function plural(n: number, singular: string, pluralForm: string): string {
    return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Une items quitando su punto final (evita ".." al cerrar la frase). */
function joinSpeechItems(items: string[] = []): string {
    return items.map((item) => String(item).replace(/\.+$/, '').trim()).filter(Boolean).join('. ');
}

/** Respuesta hablada del avance: honesta (0 sesiones se dice, no se inventa). */
export function buildTutoringProgressSpeech(
    progress: TutoringProgress,
    { language = 'es' }: { language?: string } = {},
): string {
    const isEnglish = language === 'en';
    const { area, sesiones, practicado, enCurso, anteriores, ultimaFecha, primeraFecha, dominio } = progress;
    if (!sesiones) {
        return cleanForSpeech(
            isEnglish
                ? `You have no ${area.label} sessions saved yet. Tell me your level and we start practising today.`
                : `Todavía no hay sesiones de ${area.label} en tus minutas. Dime tu nivel y practicamos hoy mismo.`,
        );
    }
    const parts: string[] = [];
    const rangoDesde = (desde: string): string =>
        (isEnglish ? ' since ' : ' desde el ') + tutoringDateLabel(desde, isEnglish ? 'en' : 'es');
    const rangoSuffix = primeraFecha && primeraFecha !== ultimaFecha ? rangoDesde(primeraFecha) : '';
    const nivel = resolveTutoringLevel(sesiones, isEnglish ? 'en' : 'es');
    const nivelPrefijo = isEnglish ? 'Level' : 'Nivel';
    const hayDominio = dominio.aciertos + dominio.errores > 0;
    if (isEnglish) {
        parts.push(
            `On ${area.label} you have ${sesiones} session${sesiones === 1 ? '' : 's'} saved${rangoSuffix}${ultimaFecha ? `, the latest on ${tutoringDateLabel(ultimaFecha, 'en')}` : ''}.`,
        );
        parts.push(`${nivelPrefijo}: ${nivel.label}.`);
        if (hayDominio) parts.push(`Mastery: ${dominio.aciertos} correct and ${dominio.errores} wrong (${dominio.precision}% accuracy).`);
        if (practicado.length) parts.push(`Worked on: ${joinSpeechItems(practicado)}.`);
        if (enCurso.length) parts.push(`In progress: ${joinSpeechItems(enCurso)}.`);
        else parts.push('Nothing pending: let us move to the next step.');
        if (anteriores.length) parts.push(`No longer pending: ${joinSpeechItems(anteriores)}.`);
    } else {
        parts.push(
            `De ${area.label} llevas ${sesiones} ${sesiones === 1 ? 'sesión registrada' : 'sesiones registradas'}${rangoSuffix}${ultimaFecha ? `, la última el ${tutoringDateLabel(ultimaFecha, 'es')}` : ''}.`,
        );
        parts.push(`${nivelPrefijo}: ${nivel.label}.`);
        if (hayDominio) parts.push(`Dominio: ${plural(dominio.aciertos, 'acierto', 'aciertos')} y ${plural(dominio.errores, 'error', 'errores')} (${dominio.precision}% de acierto).`);
        if (practicado.length) parts.push(`Trabajado: ${joinSpeechItems(practicado)}.`);
        if (enCurso.length) parts.push(`En curso: ${joinSpeechItems(enCurso)}.`);
        else parts.push('Sin pendientes: pasemos al siguiente paso.');
        if (anteriores.length) parts.push(`Ya no figura como pendiente: ${joinSpeechItems(anteriores)}.`);
    }
    return cleanForSpeech(parts.join(' '));
}

/** Contrato local de la consulta de avance (voz + documento en el Pizarron). */
export function buildTutoringProgressContract(
    progress: TutoringProgress,
    { language = 'es' }: { language?: string } = {},
): MinuteLookupContract {
    const isEnglish = language === 'en';
    const { area, sesiones, practicado, enCurso, anteriores, ultimaFecha, primeraFecha, dominio } = progress;
    const labels = isEnglish
        ? { title: `${area.label} progress`, sessions: 'Sessions', last: 'Last', worked: 'Worked on', next: 'Next', since: 'Since', done: 'No longer pending', level: 'Level', mastery: 'Mastery' }
        : { title: `Avance de ${area.label}`, sessions: 'Sesiones', last: 'Última', worked: 'Trabajado', next: 'Pendiente', since: 'Desde', done: 'Ya no pendiente', level: 'Nivel', mastery: 'Dominio' };
    const nivel = resolveTutoringLevel(sesiones, isEnglish ? 'en' : 'es');
    const bullets = [
        `${labels.sessions}: ${sesiones}`,
        `${labels.level}: ${nivel.label}`,
        dominio.aciertos + dominio.errores > 0 ? `${labels.mastery}: ${dominio.aciertos} / ${dominio.errores} (${dominio.precision}%)` : '',
        primeraFecha && primeraFecha !== ultimaFecha ? `${labels.since}: ${tutoringDateLabel(primeraFecha, isEnglish ? 'en' : 'es')}` : '',
        ultimaFecha ? `${labels.last}: ${tutoringDateLabel(ultimaFecha, isEnglish ? 'en' : 'es')}` : '',
        practicado.length ? `${labels.worked}:\n${practicado.map((item) => `- ${item}`).join('\n')}` : '',
        enCurso.length ? `${labels.next}:\n${enCurso.map((item) => `- ${item}`).join('\n')}` : '',
        anteriores.length ? `${labels.done}:\n${anteriores.map((item) => `- ${item}`).join('\n')}` : '',
    ].filter(Boolean);
    return {
        respuesta_voz: buildTutoringProgressSpeech(progress, { language }),
        navegacion: { comando: null, destino: null, parametros: {} },
        workspace: {
            tipo: 'text',
            titulo: labels.title,
            contenido: bullets.join('\n\n'),
            prompt_visual: '',
            puntos_clave: enCurso.slice(0, 5),
        },
    };
}

/**
 * Consulta numerada → lectura local determinista; historial general → Gemini.
 * Consulta de AVANCE por area → avance local derivado de las minutas.
 */
/** Una fila del avance GLOBAL: un area con su progreso derivado. */
export interface TutoringAreaProgress {
    area: TutoringArea;
    progress: TutoringProgress;
}

/** Respuesta hablada de la vista GLOBAL (todas las areas) (P8.64). */
export function buildTutoringGlobalSpeech(
    items: TutoringAreaProgress[] = [],
    { language = 'es' }: { language?: string } = {},
): string {
    const isEnglish = language === 'en';
    if (!items.length) {
        return cleanForSpeech(isEnglish
            ? 'You have no tutoring areas saved yet. Tell me what you want to learn and we start today.'
            : 'Todavia no tienes areas de tutoria en tus minutas. Dime que quieres aprender y empezamos hoy.');
    }
    const parts = items.map((item) => {
        const nivel = resolveTutoringLevel(item.progress.sesiones, isEnglish ? 'en' : 'es');
        const total = item.progress.dominio.aciertos + item.progress.dominio.errores;
        const dom = total > 0
            ? (isEnglish ? `, ${item.progress.dominio.precision}% accuracy` : `, ${item.progress.dominio.precision}% de acierto`)
            : '';
        return `${item.area.label} (${nivel.label}${dom})`;
    });
    return cleanForSpeech((isEnglish ? 'Your tutoring areas: ' : 'Tus areas de tutoria: ') + parts.join('; ') + '.');
}

/** Contrato local de la vista GLOBAL (voz + documento en el Pizarron) (P8.64). */
export function buildTutoringGlobalContract(
    items: TutoringAreaProgress[] = [],
    { language = 'es' }: { language?: string } = {},
): MinuteLookupContract {
    const isEnglish = language === 'en';
    const contenido = items
        .map((item) => {
            const nivel = resolveTutoringLevel(item.progress.sesiones, isEnglish ? 'en' : 'es');
            const total = item.progress.dominio.aciertos + item.progress.dominio.errores;
            const dom = total > 0 ? ` (${item.progress.dominio.precision}%)` : '';
            return `- ${item.area.label}: ${nivel.label}${dom}`;
        })
        .join('\n');
    return {
        respuesta_voz: buildTutoringGlobalSpeech(items, { language }),
        navegacion: { comando: null, destino: null, parametros: {} },
        workspace: {
            tipo: 'text',
            titulo: isEnglish ? 'Tutoring progress' : 'Avance de tutoria',
            contenido,
            prompt_visual: '',
            puntos_clave: [],
        },
    };
}

/** Respuesta hablada del REPASO (P8.66): lo pendiente de sesiones anteriores, con su antiguedad. */
export function buildTutoringReviewSpeech(
    review: TutoringReview,
    { language = 'es' }: { language?: string } = {},
): string {
    const isEnglish = language === 'en';
    if (!review.due.length) {
        return cleanForSpeech(isEnglish
            ? 'Nothing to review yet. Keep practising and I will remind you.'
            : 'Todavia no hay nada que repasar. Sigue practicando y te aviso.');
    }
    const parts = review.due.map((item) => {
        const cuando = isEnglish ? `${item.dias} days ago` : `hace ${item.dias} dias`;
        return `${item.area.label} (${cuando}): ${joinSpeechItems(item.temas)}.`;
    });
    const intervalos = review.intervalos.join(', ');
    const cola = isEnglish ? ` Reviews at ${intervalos} days.` : ` Revisiones a los ${intervalos} dias.`;
    return cleanForSpeech((isEnglish ? 'To review: ' : 'Para repasar: ') + parts.join(' ') + cola);
}

/** Contrato local del REPASO (voz + documento en el Pizarron) (P8.66). */
export function buildTutoringReviewContract(
    review: TutoringReview,
    { language = 'es' }: { language?: string } = {},
): MinuteLookupContract {
    const isEnglish = language === 'en';
    const contenido = review.due
        .map((item) => {
            const cuando = isEnglish ? `${item.dias} days` : `hace ${item.dias} dias`;
            return `- ${item.area.label} (${cuando}):\n${item.temas.map((tema) => `  - ${tema}`).join('\n')}`;
        })
        .join('\n\n');
    return {
        respuesta_voz: buildTutoringReviewSpeech(review, { language }),
        navegacion: { comando: null, destino: null, parametros: {} },
        workspace: {
            tipo: 'text',
            titulo: isEnglish ? 'To review' : 'Para repasar',
            contenido,
            prompt_visual: '',
            puntos_clave: review.due.flatMap((item) => item.temas).slice(0, 5),
        },
    };
}

export function resolveMinuteQuery(
    query: string = '',
    records: MinuteRecordLike[] = [],
    { language = 'es', now }: { language?: string; now?: number } = {},
): MinuteLookupResult {
    const area: TutoringArea | null = parseTutoringProgressQuery(query);
    if (area) {
        // El orden (mas reciente primero) lo fija el comparador de codigos de esta
        // casa; la derivacion NO reimplementa el orden.
        const ordered = [...(Array.isArray(records) ? records : [])].sort(compareMinuteHistoryCodeDesc);
        const progress = buildTutoringProgress(ordered as TutoringMinuteLike[], area);
        return {
            mode: 'local',
            contract: buildTutoringProgressContract(progress, { language }),
            diagnostics: {
                provider: 'minute-store',
                route: progress.sesiones ? 'tutoring-progress' : 'tutoring-progress-empty',
                sequence: null,
                historyCode: null,
            },
        };
    }
    if (isTutoringGlobalProgressQuery(query)) {
        const ordered = [...(Array.isArray(records) ? records : [])].sort(compareMinuteHistoryCodeDesc);
        const areas = listTutoringAreas(ordered as TutoringMinuteLike[]);
        const items: TutoringAreaProgress[] = areas.map((area) => ({
            area,
            progress: buildTutoringProgress(ordered as TutoringMinuteLike[], area),
        }));
        return {
            mode: 'local',
            contract: buildTutoringGlobalContract(items, { language }),
            diagnostics: {
                provider: 'minute-store',
                route: items.length ? 'tutoring-progress' : 'tutoring-progress-empty',
                sequence: null,
                historyCode: null,
            },
        };
    }
    if (isTutoringReviewQuery(query)) {
        const ordered = [...(Array.isArray(records) ? records : [])].sort(compareMinuteHistoryCodeDesc);
        const areas = listTutoringAreas(ordered as TutoringMinuteLike[]);
        const items = areas.map((area) => ({
            area,
            progress: buildTutoringProgress(ordered as TutoringMinuteLike[], area),
        }));
        const ahora = Number.isFinite(now) ? Number(now) : Date.now();
        const review = buildTutoringReview(items, ahora);
        return {
            mode: 'local',
            contract: buildTutoringReviewContract(review, { language }),
            diagnostics: {
                provider: 'minute-store',
                route: review.due.length ? 'tutoring-review' : 'tutoring-review-empty',
                sequence: null,
                historyCode: null,
            },
        };
    }
    const sequence = parseMinuteSequenceFromQuery(query);
    if (!sequence) {
        return { mode: 'gemini' };
    }
    const record = findMinuteRecordBySequence(records, sequence);
    return {
        mode: 'local',
        contract: buildMinuteLookupContract({ sequence, record, records, language }),
        diagnostics: {
            provider: 'minute-store',
            route: record ? 'minute-lookup-hit' : 'minute-lookup-miss',
            sequence,
            historyCode: record?.historyCode || null,
        },
    };
}
