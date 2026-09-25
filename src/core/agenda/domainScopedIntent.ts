// ============================================================
// domainScopedIntent - Intencion estructurada desde el dominio LLM
// ------------------------------------------------------------
// Cuando el cerebro conversacional YA clasifico la accion (`accion.dominio`),
// ese dato es lo unico que falta cuando el texto no trae el sustantivo/verbo
// del dominio ("tomar el medicamento a las 12:00" no dice "recuerdame" ni
// "recordatorio"). Antes se descartaba en silencio: el turno no se despachaba.
//
// Regla: NO se duplica el parseo. Se invoca el MISMO parser de dominio con la
// clasificacion del LLM como pista de tipo (`kindHint`). El texto sigue siendo
// la autoridad para el instante: si no trae hora, el parser NO la inventa.
// ============================================================

import { parseNoteIntentText } from '../../voice/lib/noteIntentParser';
import { parseAgendaCommand } from './agendaCommandParser';
import type { AgendaKind } from './agendaModel';

/** Forma compatible con `ArbiterResult` de App (evita el import circular). */
export interface DomainScopedIntent {
    matched: boolean;
    domain: string | null;
    action: unknown;
    channel: string | null;
}

export interface DomainScopedIntentOptions {
    defaultOffsetMs?: number;
    now?: number;
    language?: 'es' | 'en';
}

/**
 * Tipo de agenda que implica cada dominio del LLM. Solo los dominios cuyo tipo
 * es INEQUIVOCO: `temporal` cubre alarma Y temporizador, asi que se deja fuera
 * hasta que tenga su propia politica (no se adivina cual de los dos es).
 */
const AGENDA_DOMAIN_KIND: Readonly<Record<string, AgendaKind>> = Object.freeze({
    reminder: 'recordatorio',
    recordatorio: 'recordatorio',
    horario: 'clase',
});

export function resolveDomainScopedIntent(
    domain: string | null | undefined,
    text: string,
    opts: DomainScopedIntentOptions = {},
): DomainScopedIntent | null {
    if (!domain || !text) return null;
    if (domain === 'note') {
        const parsed = parseNoteIntentText(text);
        if (parsed?.label) {
            return {
                matched: true,
                domain: 'note',
                action: {
                    handled: true,
                    action: 'notes.add',
                    data: {
                        label: parsed.label,
                        ...(parsed.body ? { body: String(parsed.body).trim() } : {}),
                    },
                },
                channel: 'flu',
            };
        }
        return null;
    }
    if (domain === 'diary') {
        // Mismo punto de parseo que __fluHandleDiaryText (texto crudo).
        const clean = String(text || '').trim();
        const enDiario =
            /^(?:escribe|guarda|anota|apunta|registra)\s+(?:en\s+)?(?:el\s+|mi\s+)?diario\s*[:,\-]?\s+(.+)$/i.exec(
                clean,
            );
        const diarioPrefijo = /^diario\s*[:,\-]?\s+(.+)$/i.exec(clean);
        const match = enDiario || diarioPrefijo;
        const content = match?.[1]?.trim();
        if (content) {
            return {
                matched: true,
                domain: 'diary',
                action: { handled: true, action: 'diary.add', data: { content } },
                channel: 'flu',
            };
        }
        return null;
    }
    const kindHint = AGENDA_DOMAIN_KIND[domain];
    if (kindHint) {
        // El parser sigue siendo el unico que interpreta el texto: solo recibe
        // el tipo que el LLM ya clasifico. Si el texto no trae instante, el
        // parser no matchea (no se inventa una hora).
        const cmd = parseAgendaCommand(text, { now: opts.now, kindHint });
        if (cmd?.handled) {
            return { matched: true, domain: 'agendaCommand', action: cmd, channel: 'flu' };
        }
        return null;
    }
    return null;
}
