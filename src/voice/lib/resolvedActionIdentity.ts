// ============================================================
// resolvedActionIdentity — identidad de la ACCIÓN resuelta (no del texto)
// ------------------------------------------------------------
// Bug real: el turno se despacha por el árbitro y además por el fragmento del
// LLM. Si el fragmento difería del transcript, ambos pasaban (el dedup era por
// TEXTO) → el primero creaba el evento y el segundo respondía "Ese evento ya
// existe." con la agenda recién creada.
// Invariante: se deduplica por la IDENTIDAD de la acción ya estructurada
// (mismo tipo+etiqueta+disparo en agenda; misma etiqueta en nota). Dos textos
// distintos que resuelven al MISMO evento cuentan como uno.
// ============================================================
import { normalizeAgendaLabel } from '../../core/agenda/agendaModel';

type ResolvedResult = { domain?: string | null; action?: unknown } | null | undefined;

/** Etiqueta normalizada para la clave: sin acentos, minúsculas y espacios simples. */
function normLabel(value: unknown): string {
    return normalizeAgendaLabel(String(value || '')).replace(/\s+/g, ' ').trim();
}

export function resolvedActionIdentity(result: ResolvedResult): string {
    const action = (result?.action ?? {}) as Record<string, unknown>;
    const data = (action.data ?? {}) as Record<string, unknown>;
    const domain = String(result?.domain || '');
    const act = String(action.action || '');

    if (domain === 'agendaCommand' && act === 'agenda.create' && action.kind && action.trigger) {
        return `agenda|${String(action.kind)}|${normLabel(action.label)}|${JSON.stringify(action.trigger)}`;
    }
    if (domain === 'note' && act === 'notes.add') {
        return `note|${normLabel(data.label)}`;
    }
    return `${domain}|${act}|${normLabel(data.label ?? action.label ?? '')}`;
}
