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
 * Tipo de agenda que implica cada etiqueta de dominio.
 *
 * FUENTE UNICA de dos hechos que antes vivian en listas separadas y por eso
 * podian divergir: QUE etiquetas acepta el resolver y CUALES se ofrecen al
 * modelo. Cada entrada declara las dos cosas.
 *
 * - `kind`: tipo de agenda que implica la etiqueta.
 * - `offered`: true = se ofrece al modelo en `acciones[].dominio`. Los sinonimos
 *   internos (recordatorio/reunion/meeting) se ACEPTAN pero NO se ofrecen: el
 *   modelo debe tener un solo nombre por concepto, no tres.
 *
 * Anadir una etiqueta es UNA edicion aqui; el vocabulario del prompt y el guard
 * se derivan de esta tabla, asi que no hay una segunda lista que actualizar.
 *
 * Nota: "temporal" NO esta a proposito. Cubre alarma Y temporizador, y el tipo
 * no se adivina; el parser ya resuelve ambas formas por su cuenta.
 */
export interface AgendaDomainSpec {
    kind: AgendaKind;
    offered: boolean;
}

export const AGENDA_DOMAIN_KIND: Readonly<Record<string, AgendaDomainSpec>> = Object.freeze({
    reminder: { kind: 'recordatorio', offered: true },
    alarma: { kind: 'alarma', offered: true },
    horario: { kind: 'clase', offered: true },
    junta: { kind: 'junta', offered: true },
    cita: { kind: 'cita', offered: true },
    // Sinonimos internos: se aceptan, no se ofrecen.
    recordatorio: { kind: 'recordatorio', offered: false },
    reunion: { kind: 'junta', offered: false },
    meeting: { kind: 'junta', offered: false },
});

/**
 * Vocabulario canonico del campo `acciones[].dominio`.
 *
 * FUENTE UNICA: lo consumen los DOS prompts del sistema - services/capabilities.ts
 * y voice/lib/gemini.js. Antes cada uno ofrecia una lista distinta y
 * contradictoria ("agenda"/"shopping" en uno, "reminder"/"temporal" en el otro,
 * y hasta el conteo se contradecia: decia "five" y listaba siete), y etiquetas
 * como "agenda" o "temporal" NO las entiende este resolver, asi que la accion
 * se descartaba EN SILENCIO: la IA confirmaba en voz algo que nunca se creo.
 *
 * Invariante (tests/actionDomainContract.test.ts): TODO valor de esta lista esta
 * aceptado por el resolver - los de agenda por AGENDA_DOMAIN_KIND y shopping/note/
 * diary por el despacho de App. Si alguien añade un dominio, el guard lo valida.
 */
/** Etiquetas de agenda que el resolver ACEPTA (incluye sinonimos internos). */
export const AGENDA_DOMAINS_ACCEPTED: readonly string[] = Object.freeze(
  Object.keys(AGENDA_DOMAIN_KIND),
)

/** Etiquetas de agenda que se OFRECEN al modelo, derivadas de la tabla. */
export const AGENDA_DOMAINS_OFFERED: readonly string[] = Object.freeze(
  AGENDA_DOMAINS_ACCEPTED.filter((d) => AGENDA_DOMAIN_KIND[d].offered),
)

/**
 * Dominios de acciones que NO son agenda: los resuelve el arbitro determinista
 * (no pasan por la pista de tipo de agenda). Es una lista corta y explicita a
 * proposito: no hay tabla de la que derivarlos, porque no comparten resolver.
 */
export const NON_AGENDA_ACTION_DOMAINS = Object.freeze(['shopping', 'note', 'diary'] as const)

export const CONTRACT_ACTION_DOMAINS: readonly string[] = Object.freeze([
  ...AGENDA_DOMAINS_OFFERED,
  ...NON_AGENDA_ACTION_DOMAINS,
])

/** Lista lista para el prompt: `reminder | alarma | ...`. */
export function actionDomainList(): string {
  return CONTRACT_ACTION_DOMAINS.join(' | ')
}

export function resolveAgendaDomainIntent(
    domain: string | null | undefined,
    text: string,
    opts: AgendaDomainIntentOptions = {},
): AgendaDomainIntent | null {
    const kindHint = domain ? AGENDA_DOMAIN_KIND[domain]?.kind : undefined;
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
