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
import { arbiterDomainRoute, dispatcherHandlerFor } from './arbiterDomainRoutes';
import { logCaughtError } from '../lib/caughtError';
import { relayLog } from '../lib/clientLogRelay';
import { FLU_CONFIG } from '../voice/api/config';

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
    // El manejador se busca en la tabla declarada (fuente unica): una rama por
    // dominio escrita a mano era la segunda copia de la misma verdad y su `else`
    // se tragaba el dominio en silencio.
    const entry = dispatcherHandlerFor(domain);
    const handler = entry ? Reflect.get(w, entry.handler) : undefined;
    const enabled = entry?.configFlag
        ? Boolean(Reflect.get(FLU_CONFIG, entry.configFlag)?.enabled)
        : true;
    if (!entry || !enabled || typeof handler !== 'function') {
        relayLog('LOG', 'App', `dispatchArbiterIntent: dominio "${domain}" sin manejador window registrado (o deshabilitado)`);
        return '';
    }
    relayLog('LOG', 'App', `dispatchArbiterIntent → ${entry.handler} (${domain})`);
    let reply = '';
    try {
        const args: unknown[] = entry.withSpeaker
            ? [intent, { personId: undefined, personName: opts.speakerName || undefined }]
            : [intent];
        reply = (await handler.call(w, ...args)) || '';
    } catch (err) {
        logCaughtError('[App] dispatchArbiterIntent threw (non-critical):', err);
        relayLog('WARN', 'App', `dispatchArbiterIntent threw: ${err}`);
    }
    relayLog('LOG', 'App', `dispatchArbiterIntent → reply="${String(reply).slice(0, 120)}"`);
    return reply;
}
