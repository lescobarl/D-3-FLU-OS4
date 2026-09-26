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

/** Dominios con manejador `__fluHandle*` (ejecuta `dispatchArbiterIntent`). */
export const DISPATCHER_DOMAINS = Object.freeze([
    'agendaCommand',
    'diary',
    'note',
    'shopping',
] as const);

/** Dominios de navegación (los ejecuta `handleNavigationCommand`). */
export const NAVIGATION_DOMAINS = Object.freeze(['navigation'] as const);

/** Dominios de estado: se ejecutan por su fast-path propio (no por el dispatcher). */
export const STATE_FAST_PATH_DOMAINS = Object.freeze([
    'config',
    'environment',
    'game',
] as const);

/** Quién ejecuta el resultado del Árbitro para un dominio. */
export type ArbiterDomainRoute = 'dispatcher' | 'navigation' | 'stateFastPath';

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
