/**
 * Rutas de ejecución de los dominios del Árbitro determinista.
 *
 * Defecto medido (sesión real, 14:31:58): `dispatchArbiterIntent` sólo tenía
 * rama para los dominios con manejador `__fluHandle*`; todo lo demás caía a un
 * `else` que registraba "dominio ... sin manejador window registrado" y devolvía
 * ''. El Árbitro SÍ emite dominios de estado (config/game/environment) y
 * navegación, así que su resolución se descartaba en silencio: la partida de
 * juego no arrancaba (`vamos a jugar lotería` → `domain="game" action="start"`
 * → reply="") y el LLM la simulaba.
 *
 * Esta tabla es la FUENTE ÚNICA de qué ruta ejecuta cada dominio del Árbitro,
 * para que (a) el despacho consulte la ruta en vez de encadenar ramas sueltas y
 * (b) los guards verifiquen el DESPACHO, no sólo la clasificación.
 *
 * Contrato de rutas:
 * - `dispatcher`:        lo ejecuta `dispatchArbiterIntent` (manejador `__fluHandle*`).
 * - `navigation`:        lo ejecuta `handleNavigationCommand` (vía `navegacion.comando`).
 * - `stateFastPath`:     lo ejecuta su fast-path propio (configAction / juegoAction /
 *                        environmentAction): el resultado del Árbitro se REENVÍA a ese
 *                        camino, no se despacha por el dispatcher.
 */

/**
 * Tabla de MANEJADORES de los dominios `dispatcher` (FUENTE ÚNICA, junto a la
 * clasificación de rutas). Antes el despacho era una cadena de `if (domain ===
 * 'diary') … else if (… 'note') …` escrita a mano en `arbiterDispatch.ts`: la
 * misma verdad (qué ejecuta cada dominio) vivía en dos sitios, así que añadir un
 * dominio obligaba a tocar la cadena y era fácil que el `else` genérico se
 * tragara la resolución en silencio (justo el defecto que abrió esta tabla).
 *
 * `withSpeaker`: el manejador recibe `{ personId, personName }` (diario/nota/
 * calendario registran de quién es la entrada; compras no).
 * `configFlag`: interruptor de producto en `FLU_CONFIG` (p. ej. `diary`).
 */
export interface DispatcherDomainEntry {
    readonly domain: string;
    readonly handler: string;
    readonly withSpeaker?: boolean;
    readonly configFlag?: string;
}

/** Manejador `window.__fluHandle*` que ejecuta cada dominio `dispatcher`. */
export const DISPATCHER_HANDLERS = Object.freeze([
    { domain: 'diary', handler: '__fluHandleDiaryText', withSpeaker: true, configFlag: 'diary' },
    { domain: 'note', handler: '__fluHandleNoteText', withSpeaker: true },
    { domain: 'shopping', handler: '__fluHandleShoppingText' },
    { domain: 'agendaCommand', handler: '__fluHandleAgendaCommandText', withSpeaker: true },
] as const satisfies readonly DispatcherDomainEntry[]);

/** Dominios con manejador `__fluHandle*` (ejecuta `dispatchArbiterIntent`). */
export const DISPATCHER_DOMAINS = Object.freeze(
    DISPATCHER_HANDLERS.map((entry) => entry.domain),
);

/**
 * Manejador declarado para un dominio `dispatcher`, o `null` si el dominio no lo
 * tiene. `null` es señal de hueco: ningún dominio debe caer al `else` genérico.
 */
export function dispatcherHandlerFor(domain: unknown): DispatcherDomainEntry | null {
    const value = String(domain ?? '');
    return DISPATCHER_HANDLERS.find((entry) => entry.domain === value) ?? null;
}

/**
 * Marcas del contrato que declaran "esta parte del turno YA la ejecutó su dueño"
 * (el fast-path de estado del hook), por dominio. El hook las escribe; aquí vive
 * la ÚNICA fuente de su nombre para que el consumidor no repita una condición
 * por dominio (`domain === 'game' && !resolved?.fastPathGame`, y lo mismo para
 * environment) en cada rama. Un dominio de estado nuevo se declara AQUÍ.
 */
export const FAST_PATH_EXECUTED_MARKS: Readonly<Record<string, string>> = Object.freeze({
    config: 'fastPathConfig',
    game: 'fastPathGame',
    environment: 'fastPathEnvironment',
});

/**
 * true si el fast-path de estado del hook YA ejecutó el turno para ese dominio,
 * así que el contrato NO debe volver a aplicarlo (re-aplicar = dos cartas, dos
 * veces el mismo ambiente). Dominio sin marca declarada => false (sin cambio de
 * comportamiento: el calendario/estado se sigue aplicando como hasta ahora).
 */
export function isTurnAlreadyExecuted(resolved: unknown, domain: unknown): boolean {
    const mark = FAST_PATH_EXECUTED_MARKS[String(domain ?? '')];
    if (!mark) return false;
    return (resolved as Record<string, unknown> | null | undefined)?.[mark] === true;
}

/** Quién ejecuta el resultado del Árbitro para un dominio. */
export type ArbiterDomainRoute = 'dispatcher' | 'navigation' | 'stateFastPath';

/** Dominios de navegación (los ejecuta `handleNavigationCommand`). */
export const NAVIGATION_DOMAINS = Object.freeze(['navigation'] as const);

/** Dominios de estado: se ejecutan por su fast-path propio (no por el dispatcher). */
export const STATE_FAST_PATH_DOMAINS = Object.freeze([
    'config',
    'environment',
    'game',
] as const);

/** true si el dominio se ejecuta por su fast-path de estado (no por el dispatcher). */
export function isStateFastPathDomain(domain: unknown): boolean {
    return (STATE_FAST_PATH_DOMAINS as readonly string[]).includes(String(domain ?? ''));
}

/**
 * Ruta del dominio, o `null` si no tiene ruta declarada. `null` es señal de
 * hueco: ningún dominio del Árbitro debe despacharse por el `else` genérico.
 */
export function arbiterDomainRoute(domain: unknown): ArbiterDomainRoute | null {
    const value = String(domain ?? '');
    if ((DISPATCHER_DOMAINS as readonly string[]).includes(value)) return 'dispatcher';
    if ((NAVIGATION_DOMAINS as readonly string[]).includes(value)) return 'navigation';
    if (isStateFastPathDomain(value)) return 'stateFastPath';
    return null;
}
