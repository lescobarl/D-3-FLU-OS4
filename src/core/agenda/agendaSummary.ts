// ============================================================
// src/core/agenda/agendaSummary.ts
// Consulta ÚNICA hablable del calendario unificado (P2/P6 de la spec).
// ------------------------------------------------------------
// "¿qué hay para hoy / esta semana / este mes?" responde desde la MISMA
// fuente (`agenda`) en una sola lista, con la hora y el color por tipo.
// Puro, sin I/O: recibe los items y el reloj. La UI y el handler de voz
// consumen ESTO (fuente única de la consulta hablable).
// ============================================================
import { dayKey } from '../../lib/dateKey'
import { itemsInView, type AgendaView } from './agendaQuery';
import { nextAgendaDue, colorForKind, type AgendaColorMap, type AgendaItem } from './agendaModel';

export interface AgendaSummaryLine {
    id: string;
    kind: AgendaItem['kind'];
    label: string;
    /** Hora local 'HH:MM' de la próxima ocurrencia, o '' si no aplica. */
    time: string;
    color: string;
    /** Día local de la ocurrencia (para ordenar/agrupar en semana/mes). */
    dueAt: number;
}

function localHHMM(at: number): string {
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface AgendaSummaryResult {
    view: AgendaView;
    lines: AgendaSummaryLine[];
    /** `true` si no hay nada vigente en la vista. */
    empty: boolean;
}

/**
 * Lista única de la vista, ordenada por día y hora, con el color derivado
 * del tipo. Los borrados lógicos se excluyen.
 */
export function summarizeAgenda(
    items: readonly AgendaItem[],
    view: AgendaView,
    now: number,
    colors: AgendaColorMap,
): AgendaSummaryResult {
    const visible = itemsInView(items, view, now);
    const lines: AgendaSummaryLine[] = visible
        .map((item) => {
            const dueAt = nextAgendaDue(item.trigger, now);
            return {
                id: item.id,
                kind: item.kind,
                label: item.label,
                time: localHHMM(dueAt),
                color: colorForKind(item.kind, colors),
                dueAt,
            };
        })
        .sort((a, b) => {
            const dk = dayKey(a.dueAt).localeCompare(dayKey(b.dueAt));
            return dk !== 0 ? dk : a.time.localeCompare(b.time);
        });

    return { view, lines, empty: lines.length === 0 };
}

/** Texto hablable de la vista (una línea por item, agrupado). */
export function agendaSummaryText(
    result: AgendaSummaryResult,
    language: 'es' | 'en',
    emptyText?: { es: string; en: string },
): string {
    if (result.empty) {
        return language === 'en'
            ? emptyText?.en ?? 'Nothing scheduled.'
            : emptyText?.es ?? 'No tienes nada programado.';
    }
    const joined = result.lines.map((line) => `${line.time} ${line.label}`).join('. ');
    return joined;
}
