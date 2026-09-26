/**
 * Despacho del intent del Árbitro determinista (extraído de App.tsx, god-file con
 * trinquete de tamaño): interfaz del resultado, lectura de props para log y el
 * despachador a los manejadores `__fluHandle*`.
 *
 * La RUTA de cada dominio se decide con la tabla única `arbiterDomainRoutes`: aquí
 * sólo se ejecutan los dominios `dispatcher`. Un dominio de estado (config/game/
 * environment) o de navegación tiene su propio camino y se denuncia si llega aquí,
 * en vez de caer al `else` genérico y devolver "" en silencio.
 */
import { arbiterDomainRoute } from './arbiterDomainRoutes';
import { logCaughtError } from '../lib/caughtError';
import { relayLog } from '../lib/clientLogRelay';
import { FLU_CONFIG } from '../voice/lib/fluConfig';

/** Resultado del árbitro determinista (contrato de deterministicArbiter.js). */
export interface ArbiterResult {
    matched: boolean;
    domain: string | null;
    action: unknown;
    channel: string | null;
}

/** Lee una propiedad string de un valor desconocido (para logs). */
export function readStringProp(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const prop = Reflect.get(value, key);
    return typeof prop === 'string' ? prop : undefined;
}

/**
 * Despacha el intent COMPLETO de un resultado del árbitro determinista al
 * manejador __fluHandle* correspondiente según su dominio. Devuelve la
 * confirmación hablada del manejador (o '' si no hubo dominio/intent).
 * Los manejadores se invocan vía window en runtime (siempre tienen closures
 * frescas porque se reasignan cada render).
 */
export async function dispatchArbiterIntent(
    arbiterResult: ArbiterResult,
    opts: { speakerName?: string },
): Promise<string> {
    const w = window;
    const domain = arbiterResult?.matched ? arbiterResult.domain : null;
    const intent: unknown = arbiterResult?.action || null;
    const intentLabel = readStringProp(intent, 'action')
        ?? readStringProp(intent, 'gameId')
        ?? readStringProp(intent, 'comando')
        ?? JSON.stringify(intent ?? null)?.slice(0, 120);
    relayLog('LOG', 'App', `dispatchArbiterIntent: domain="${domain}" action="${intentLabel}"`);
    if (!domain || !intent) {
        relayLog('LOG', 'App', 'dispatchArbiterIntent: SIN domain/intent → no se despacha');
        return '';
    }
    // Sólo los dominios con manejador `__fluHandle*` se despachan aquí. Un dominio
    // de estado (config/game/environment) o de navegación tiene su ruta propia y
    // NO debe llegar a este punto: si llega, se dice explícitamente en vez de
    // caer al `else` genérico y devolver '' en silencio (así se perdía la partida).
    if (arbiterDomainRoute(domain) !== 'dispatcher') {
        relayLog(
            'WARN',
            'App',
            `dispatchArbiterIntent: dominio "${domain}" no tiene manejador aquí (ruta "${arbiterDomainRoute(domain)}") → se ignora`,
        );
        return '';
    }
    let reply = '';
    try {
        if (domain === 'diary' && FLU_CONFIG.diary?.enabled && typeof w.__fluHandleDiaryText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleDiaryText (diary)');
            reply =
                (await w.__fluHandleDiaryText(intent, {
                    personId: undefined,
                    personName: opts.speakerName || undefined,
                })) || '';
        } else if (domain === 'note' && typeof w.__fluHandleNoteText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleNoteText (note)');
            reply =
                (await w.__fluHandleNoteText(intent, {
                    personId: undefined,
                    personName: opts.speakerName || undefined,
                })) || '';
        } else if (domain === 'shopping' && typeof w.__fluHandleShoppingText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleShoppingText (shopping)');
            reply = (await w.__fluHandleShoppingText(intent)) || '';
        } else if (domain === 'agendaCommand' && typeof w.__fluHandleAgendaCommandText === 'function') {
            relayLog('LOG', 'App', 'dispatchArbiterIntent → __fluHandleAgendaCommandText (agendaCommand)');
            reply =
                (await w.__fluHandleAgendaCommandText(intent, {
                    personId: undefined,
                    personName: opts.speakerName || undefined,
                })) || '';
        } else {
            relayLog('LOG', 'App', `dispatchArbiterIntent: dominio "${domain}" sin manejador window registrado (o deshabilitado)`);
        }
    } catch (err) {
        logCaughtError('[App] dispatchArbiterIntent threw (non-critical):', err);
        relayLog('WARN', 'App', `dispatchArbiterIntent threw: ${err}`);
    }
    relayLog('LOG', 'App', `dispatchArbiterIntent → reply="${String(reply).slice(0, 120)}"`);
    return reply;
}
