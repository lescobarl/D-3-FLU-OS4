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

function isGenericMinuteSessionTheme(theme: string = ''): boolean {
    const normalized = cleanForSpeech(theme).toLowerCase();
    if (!normalized) return true;
    // Sin acceso a FLU_CONFIG aquí; el placeholder típico ("clase", "sesión activa", etc.) no es
    // crítico porque resolveMinuteThemeForSpeech ya filtra duplicados con el título.
    return false;
}

/** Tema útil para voz/UI; omite placeholder genérico y duplicado del título. */
export function resolveMinuteThemeForSpeech(snapshot: any = {}, record: any = {}): string {
    const titulo = normalizeSpaces(snapshot?.titulo || record?.description || '');
    const tema = normalizeSpaces(snapshot?.tema_sesion || '');
    if (!tema || isGenericMinuteSessionTheme(tema)) return '';
    if (titulo && cleanForSpeech(titulo).toLowerCase() === cleanForSpeech(tema).toLowerCase()) return '';
    return tema;
}

// ------------------------------------------------------------
// createMinuteDraftFromSummary (OS2 parity) — usado por buildMinuteLookupContract
// ------------------------------------------------------------

export function createMinuteDraftFromSummary(summary: any = {}, theme: string = '', id: string = ''): {
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
        tema_sesion: normalizeSpaces(theme),
    };
}

// ------------------------------------------------------------
// formatMinuteDraftText (OS2 parity) — formatea un draft como bloque de texto
// ------------------------------------------------------------

function listSection(label: string, items: string[] = []): string {
    if (!items.length) return `${label}:`;
    return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

export function formatMinuteDraftText(draft: any = {}): string {
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

function formatMinuteKnowledgeEntry(record: any = {}, { fallbackIndex = 0 }: { fallbackIndex?: number } = {}): string {
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

    const speechTheme = resolveMinuteThemeForSpeech(snapshot, record);
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
function diaryEntryToKnowledgeRecord(entry: any = {}): any {
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
export function buildMinuteKnowledgeBase2(records: any[] = [], options?: { diary?: any[] }): string {
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
    matched: any;
    draft: ReturnType<typeof createMinuteDraftFromSummary>;
    shouldSwitchTab: boolean;
}

export interface MinuteLookupSelectionInput {
    diagnostics: { route?: string; historyCode?: string | null;[k: string]: any } | null | undefined;
    minutes: any[];
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

function minuteCatalogSpeech(records: any[] = [], { language = 'es' }: { language?: string } = {}): string {
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
            if (isEnglish) {
                return title ? `${kindLabel} ${seqLabel} (${title})` : `${kindLabel} ${seqLabel}`;
            }
            return title ? `${kindLabel} ${seqLabel} (${title})` : `${kindLabel} ${seqLabel}`;
        })
        .filter(Boolean);
    return labels.join(', ');
}

// ------------------------------------------------------------
// Contrato Flu para consulta de minuta (respuesta local)
// ------------------------------------------------------------

export function buildMinuteLookupContract({
    sequence = 0,
    record = null,
    records = [],
    language = 'es',
}: {
    sequence?: number;
    record?: any;
    records?: any[];
    language?: string;
} = {}): { respuesta_voz: string; navegacion: { comando: null; destino: null; parametros: Record<string, never> }; workspace: any } {
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
export function resolveMinuteQuery(
    query: string = '',
    records: any[] = [],
    { language = 'es' }: { language?: string } = {},
): MinuteLookupResult {
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
