/**
 * P7.8 - Ciclo de vida de los puentes FUNCIONALES de despacho.
 *
 * Los 4 manejadores `__fluHandle*` NO son superficie de depuracion: son el mecanismo
 * real por el que `dispatchArbiterIntent` ejecuta diario/notas/compras/agenda, asi que
 * NO pueden gatearse (ver tests/devGlobalsGuard.test.ts, FUNCTIONAL_BRIDGE). Se asignan
 * en cada render de App y hasta ahora NUNCA se limpiaban: un desmontaje dejaba 4 cierres
 * colgando sobre el estado del componente.
 *
 * La reasignacion dentro del efecto no es opcional: `src/main.tsx` monta en
 * `React.StrictMode`, que ejecuta `cleanup -> effect` SIN volver a renderizar. Si el
 * cleanup solo borrase, tras el ciclo de StrictMode los puentes quedarian ausentes y el
 * despacho fallaria EN DESARROLLO.
 */

/** Puentes funcionales que la app lee en runtime (mismo orden que devGlobalsGuard). */
export const FLU_BRIDGE_NAMES = [
    '__fluHandleAgendaCommandText',
    '__fluHandleShoppingText',
    '__fluHandleNoteText',
    '__fluHandleDiaryText',
] as const;

/** Ventana minima necesaria; inyectable para probar sin DOM global. */
export interface BridgeTarget {
    [key: string]: unknown;
}

/** Copia [nombre, manejador] de lo publicado ahora mismo, para poder republicarlo. */
export type BridgeSnapshot = Array<[string, unknown]>;

/** Lee los puentes publicados actualmente. */
export function snapshotFluBridges(target: BridgeTarget): BridgeSnapshot {
    return FLU_BRIDGE_NAMES.map((name) => [name, target[name]] as [string, unknown]);
}

/** Republica una copia. Idempotente; ignora los huecos de un snapshot previo al montaje. */
export function publishFluBridges(snapshot: BridgeSnapshot, target: BridgeTarget): void {
    for (const [name, handler] of snapshot) {
        if (handler !== undefined) target[name] = handler;
    }
}

/** Retira los puentes publicados (desmontaje). */
export function clearFluBridges(target: BridgeTarget): void {
    for (const name of FLU_BRIDGE_NAMES) delete target[name];
}
