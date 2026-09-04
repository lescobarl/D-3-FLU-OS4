// ============================================================
// dailyAgenda — Compila pendientes de minutas en orden del día
// ============================================================
// Toma todas las minutas guardadas, extrae pendientes y
// siguientes pasos, y los compila en una "orden del día"
// lista para inyectar en el prompt de Gemini.
//
// Cumple:
//   - Rule #1: NO HARDCODE — configurable via FLU_CONFIG
//   - Pure functions — no React dependencies
//   - Fase 2 (B5): fusiona recordatorios pendientes en la agenda
// ============================================================

import { normalizeSpaces } from './textUtils';
import type { ReminderRecord } from '../core/db/fluDatabase';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface DailyAgendaItem {
    /** ID de la minuta de origen */
    minuteId: string;
    /** Título de la minuta */
    title: string;
    /** Pendientes de esa sesión */
    pendingItems: string[];
    /** Siguientes pasos de esa sesión */
    nextSteps: string[];
    /** Líneas de recordatorios pendientes fusionadas (Fase 2 — B5) */
    reminders?: string[];
    /** Código de historial (fecha + secuencia, ej. 260713-01) */
    sourceDate: string;
}

export interface DailyAgendaConfig {
    /** Máximo de items a incluir en la agenda */
    maxItems: number;
    /** Importancia mínima (0-1) para incluir un item */
    minImportance: number;
    /** Si se inyecta automáticamente al iniciar conversación */
    injectOnStartup: boolean;
    /** Si FLU puede recordar proactivamente los pendientes */
    proactiveReminder: boolean;
    /** Máximo de recordatorios a fusionar en la agenda (Fase 2 — B5) */
    maxReminders?: number;
}

export const DEFAULT_AGENDA_CONFIG: DailyAgendaConfig = {
    maxItems: 5,
    minImportance: 0.3,
    injectOnStartup: true,
    proactiveReminder: true,
    maxReminders: 5,
};

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

function parseHistoryDate(code: string = ''): number {
    // historyCode format: DDMMYY-NN → extract DDMMYY as sortable number
    const match = String(code).match(/^(\d{6})/);
    if (!match) return 0;
    // Convert DDMMYY to YYMMDD for chronological sorting
    const dd = match[1].slice(0, 2);
    const mm = match[1].slice(2, 4);
    const yy = match[1].slice(4, 6);
    return Number.parseInt(`${yy}${mm}${dd}`, 10);
}

// -----------------------------------------------------------
// Build Daily Agenda
// -----------------------------------------------------------

/**
 * Compila una "orden del día" a partir de todas las minutas guardadas.
 * Extrae pendientes y siguientes pasos de cada minuta, filtra las que
 * tienen al menos un item pendiente, y ordena por fecha descendente.
 *
 * @param records - Array de registros de minutas (desde IndexedDB)
 * @param config - Configuración opcional (usa defaults si no se provee)
 * @returns Array de items de agenda, vacío si no hay pendientes
 */
export function buildDailyAgenda(
    records: any[] = [],
    config: Partial<DailyAgendaConfig> = {},
): DailyAgendaItem[] {
    const cfg: DailyAgendaConfig = { ...DEFAULT_AGENDA_CONFIG, ...config };

    if (!Array.isArray(records) || records.length === 0) return [];

    const items: DailyAgendaItem[] = [];

    for (const record of records) {
        const snapshot = record?.summarySnapshot || record;
        const pendingItems: string[] = (
            Array.isArray(snapshot?.pendientes) ? snapshot.pendientes : []
        )
            .map((item: any) => normalizeSpaces(String(item)))
            .filter(Boolean);

        const nextSteps: string[] = (
            Array.isArray(snapshot?.siguientes_pasos) ? snapshot.siguientes_pasos : []
        )
            .map((item: any) => normalizeSpaces(String(item)))
            .filter(Boolean);

        // Solo incluir si hay al menos un pendiente o siguiente paso
        if (pendingItems.length === 0 && nextSteps.length === 0) continue;

        items.push({
            minuteId: String(record?.id || ''),
            title: normalizeSpaces(record?.description || snapshot?.titulo || ''),
            pendingItems,
            nextSteps,
            sourceDate: String(record?.historyCode || ''),
        });
    }

    if (items.length === 0) return [];

    // Ordenar por fecha descendente (más reciente primero)
    items.sort((a, b) => parseHistoryDate(b.sourceDate) - parseHistoryDate(a.sourceDate));

    // Limitar a maxItems
    return items.slice(0, cfg.maxItems);
}

// -----------------------------------------------------------
// Merge Reminders into Agenda (Fase 2 — B5)
// -----------------------------------------------------------

/**
 * Formatea un vencimiento (epoch ms) como texto legible según el idioma.
 * Determinista: no depende de la librería de fechas, solo de Date nativo.
 */
function formatReminderWhen(at: number, language: 'es' | 'en'): string {
    const date = new Date(at);
    const now = new Date();
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

    if (date.toDateString() === now.toDateString()) {
        return language === 'en' ? `today at ${time}` : `hoy a las ${time}`;
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (date.toDateString() === tomorrow.toDateString()) {
        return language === 'en' ? `tomorrow at ${time}` : `mañana a las ${time}`;
    }

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return language === 'en'
        ? `on ${yyyy}-${mm}-${dd} at ${time}`
        : `el ${dd}/${mm}/${yyyy} a las ${time}`;
}

/**
 * Fusiona los recordatorios pendientes en la agenda del día.
 * Agrega un item sintético ("Recordatorios pendientes") al final del
 * array, ordenado por vencimiento ascendente y limitado a maxReminders.
 *
 * No muta el array original; devuelve una copia con el item agregado.
 *
 * @param items - Agenda previa (de buildDailyAgenda)
 * @param reminders - Registros de recordatorios (desde IndexedDB)
 * @param config - Configuración opcional (usa defaults si no se provee)
 * @param language - 'es' | 'en' para las etiquetas de tiempo
 * @returns La agenda con el item de recordatorios fusionado
 */
export function mergeRemindersIntoAgenda(
    items: DailyAgendaItem[],
    reminders: ReadonlyArray<ReminderRecord> = [],
    config: Partial<DailyAgendaConfig> = {},
    language: 'es' | 'en' = 'es',
): DailyAgendaItem[] {
    if (!Array.isArray(reminders) || reminders.length === 0) return items;

    const pending = reminders
        .filter((r) => r && r.status === 'pending')
        .slice()
        .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));

    if (pending.length === 0) return items;

    const cfg: DailyAgendaConfig = { ...DEFAULT_AGENDA_CONFIG, ...config };
    const top = pending.slice(0, cfg.maxReminders);

    const reminderLines = top.map((r) => {
        const text = normalizeSpaces(r.text || '');
        const when = formatReminderWhen(r.dueAt, language);
        return text ? `${when} — ${text}` : when;
    });

    const title = language === 'en' ? 'Pending reminders' : 'Recordatorios pendientes';

    const reminderItem: DailyAgendaItem = {
        minuteId: '',
        title,
        pendingItems: [],
        nextSteps: [],
        reminders: reminderLines,
        sourceDate: '',
    };

    return [...items, reminderItem];
}

// -----------------------------------------------------------
// Format Agenda for Prompt Injection
// -----------------------------------------------------------

/**
 * Formatea la agenda como texto listo para inyectar en el prompt de Gemini.
 *
 * @param items - Array de items de agenda (de buildDailyAgenda)
 * @param language - 'es' | 'en'
 * @returns Texto formateado, o string vacío si no hay items
 */
export function formatAgendaForPrompt(
    items: DailyAgendaItem[],
    language: 'es' | 'en' = 'es',
): string {
    if (!Array.isArray(items) || items.length === 0) return '';

    const isEnglish = language === 'en';

    const parts = items.map((item, index) => {
        const title = item.title || (isEnglish ? `Session ${index + 1}` : `Sesión ${index + 1}`);
        const dateLabel = item.sourceDate
            ? ` [${item.sourceDate}]`
            : '';

        const pendingText = item.pendingItems.length > 0
            ? (isEnglish
                ? `\n   Pending: ${item.pendingItems.join(' | ')}`
                : `\n   Pendientes: ${item.pendingItems.join(' | ')}`)
            : '';

        const nextText = item.nextSteps.length > 0
            ? (isEnglish
                ? `\n   Next steps: ${item.nextSteps.join(' | ')}`
                : `\n   Siguientes pasos: ${item.nextSteps.join(' | ')}`)
            : '';

        const reminders = item.reminders && item.reminders.length > 0
            ? item.reminders
            : [];
        const remindersText = reminders.length > 0
            ? (isEnglish
                ? `\n   Reminders: ${reminders.join(' | ')}`
                : `\n   Recordatorios: ${reminders.join(' | ')}`)
            : '';

        return `${index + 1}. ${title}${dateLabel}${pendingText}${nextText}${remindersText}`;
    });

    const header = isEnglish
        ? 'Pending items from previous sessions (most recent first):'
        : 'Pendientes de sesiones anteriores (más reciente primero):';

    return `\n${header}\n${parts.join('\n')}`;
}

// -----------------------------------------------------------
// Count Pending Items (for proactive engine)
// -----------------------------------------------------------

/**
 * Cuenta cuántos items pendientes hay en total en la agenda.
 * Útil para que el proactive engine sepa si hay algo que recordar.
 *
 * @param items - Array de items de agenda
 * @returns Número total de pendientes + siguientes pasos
 */
export function countPendingItems(items: DailyAgendaItem[]): number {
    if (!Array.isArray(items)) return 0;
    let count = 0;
    for (const item of items) {
        count += item.pendingItems.length;
        count += item.nextSteps.length;
        count += item.reminders?.length ?? 0;
    }
    return count;
}
