// ============================================================
// domainScopedIntent - la clasificacion del LLM cubre el tipo de agenda
// ------------------------------------------------------------
// `App.resolveDomainScopedIntent` rescata una intencion cuando el Arbitro NO
// matcheo el texto libre, y lo hace SIN exigir el trigger verbal. Ese rescate
// solo cubria note y diary. Aqui vive el tramo de AGENDA: cuando el cerebro
// conversacional ya clasifico el dominio (`accion.dominio`), ese dato es lo que
// falta si el texto no trae el sustantivo ni el verbo del tipo ("tomar el
// medicamento a las 12:00" no dice "recuerdame" ni "recordatorio").
//
// Regla: NO se duplica el parseo. Se invoca el MISMO parser de agenda
// (`parseAgendaCommand`) con la clasificacion del LLM como pista de tipo. El
// texto sigue siendo la autoridad del instante: sin hora, no hay match.
//
// P7.30(b): sin hora el turno se DESCARTA BAJO SILENCIO. El modelo exige
// instante (`trigger absolute/...`), asi que la salida correcta no es inventar
// uno (eso cambiaria QUE HACE el producto, y `defaultReminderOffsetMinutes` es
// una decision de producto, no del agente): es PREGUNTAR. El parser devuelve la
// pista (kind+label) aunque no haya instante, y aqui se propaga para que el
// manejador pida la hora.
// ============================================================

import { parseAgendaCommand } from './agendaCommandParser';
import type { AgendaKind } from './agendaModel';

/** Forma minima compatible con `ArbiterResult` de App (no importa de App). */
export interface AgendaDomainIntent {
    matched: boolean;
    domain: string | null;
    action: unknown;
    channel: string | null;
    /** El texto traia contenido pero NO instante: hay que preguntar la hora. */
    needsInstant?: boolean;
}

/** Frase con la que se pide la hora cuando el texto no trae instante. */
export function askMissingInstant(language: 'es' | 'en' = 'es'): string {
    return language === 'en'
        ? 'When should I remind you? Tell me the time, please.'
        : '¿Para cuándo te lo recuerdo? Dime la hora, por favor.';
}

export interface AgendaDomainIntentOptions {
    defaultOffsetMs?: number;
    now?: number;
    language?: 'es' | 'en';
}

/**
 * Tipo de agenda que implica cada dominio del LLM. Solo los dominios cuyo tipo
 * es INEQUIVOCO: `temporal` cubre alarma Y temporizador, asi que se queda fuera
 * hasta que tenga su propia politica (el tipo no se adivina).
 */
const AGENDA_DOMAIN_KIND: Readonly<Record<string, AgendaKind>> = Object.freeze({
    reminder: 'recordatorio',
    recordatorio: 'recordatorio',
    horario: 'clase',
});

export function resolveAgendaDomainIntent(
    domain: string | null | undefined,
    text: string,
    opts: AgendaDomainIntentOptions = {},
): AgendaDomainIntent | null {
    const kindHint = domain ? AGENDA_DOMAIN_KIND[domain] : undefined;
    if (!kindHint || !text) return null;
    const cmd = parseAgendaCommand(text, { now: opts.now, kindHint });
    if (cmd?.handled) {
        return { matched: true, domain: 'agendaCommand', action: cmd, channel: 'flu' };
    }
    // Crear sin instante: el texto trae contenido ("recuerdame comprar el pan")
    // pero no hora. NO se inventa el instante y NO se descarta el turno: se
    // propaga la pista para que el manejador pida la hora (P7.30b).
    if (cmd?.action === 'agenda.create' && cmd.kind) {
        return {
            matched: true,
            domain: 'agendaCommand',
            channel: 'flu',
            needsInstant: true,
            action: {
                handled: true,
                action: 'agenda.create',
                kind: cmd.kind,
                ...(cmd.label ? { label: cmd.label } : {}),
            },
        };
    }
    return null;
}
