/**
 * P7.8 - Ciclo de vida de los puentes FUNCIONALES de despacho.
 *
 * Los 4 manejadores `__fluHandle*` NO son superficie de depuracion: son el mecanismo real
 * por el que `dispatchArbiterIntent` ejecuta diario/notas/compras/agenda, asi que NO pueden
 * gatearse (ver tests/devGlobalsGuard.test.ts, FUNCTIONAL_BRIDGE). Se asignan en cada render
 * de App y hasta P7.8 NUNCA se limpiaban: un desmontaje dejaba 4 cierres colgando sobre el
 * estado del componente.
 *
 * La republicacion dentro del efecto no es opcional: `src/main.tsx` monta en
 * `React.StrictMode`, que ejecuta `cleanup -> effect` SIN volver a renderizar. Si el cleanup
 * solo borrase, tras ese ciclo los puentes quedarian ausentes y el despacho fallaria EN
 * DESARROLLO.
 *
 * Aqui no se usa ningun cast: `FluBridgeHost` describe los 4 puentes opcionales y `Window`
 * la satisface estructuralmente (los declara en src/types/fluWindow.d.ts), asi que
 * `useFluBridgesLifecycle()` se llama sin `as`. C49 (tsStrictGuard) prohibe el doble cast.
 */
import { useEffect, useRef } from 'react';

/** Puentes funcionales que la app lee en runtime. */
export const FLU_BRIDGE_NAMES = [
    '__fluHandleAgendaCommandText',
    '__fluHandleShoppingText',
    '__fluHandleNoteText',
    '__fluHandleDiaryText',
] as const;

export type FluBridgeName = (typeof FLU_BRIDGE_NAMES)[number];

/** Ventana minima necesaria: los 4 puentes. Inyectable para probar sin DOM global. */
export interface FluBridgeHost {
    __fluHandleAgendaCommandText?: unknown;
    __fluHandleShoppingText?: unknown;
    __fluHandleNoteText?: unknown;
    __fluHandleDiaryText?: unknown;
}

/** Copia [nombre, manejador] de lo publicado, para poder republicarlo. */
export type BridgeSnapshot = Array<[FluBridgeName, unknown]>;

function readBridge(host: FluBridgeHost, name: FluBridgeName): unknown {
    switch (name) {
        case '__fluHandleAgendaCommandText':
            return host.__fluHandleAgendaCommandText;
        case '__fluHandleShoppingText':
            return host.__fluHandleShoppingText;
        case '__fluHandleNoteText':
            return host.__fluHandleNoteText;
        default:
            return host.__fluHandleDiaryText;
    }
}

function writeBridge(host: FluBridgeHost, name: FluBridgeName, handler: unknown): void {
    switch (name) {
        case '__fluHandleAgendaCommandText':
            host.__fluHandleAgendaCommandText = handler;
            break;
        case '__fluHandleShoppingText':
            host.__fluHandleShoppingText = handler;
            break;
        case '__fluHandleNoteText':
            host.__fluHandleNoteText = handler;
            break;
        default:
            host.__fluHandleDiaryText = handler;
    }
}

/** Lee los puentes publicados ahora mismo. */
export function snapshotFluBridges(host: FluBridgeHost): BridgeSnapshot {
    const out: BridgeSnapshot = [];
    for (const name of FLU_BRIDGE_NAMES) out.push([name, readBridge(host, name)]);
    return out;
}

/** Republica una copia. Ignora los huecos de un snapshot anterior al montaje. */
export function publishFluBridges(snapshot: BridgeSnapshot, host: FluBridgeHost): void {
    for (const [name, handler] of snapshot) {
        if (handler !== undefined) writeBridge(host, name, handler);
    }
}

/** Retira los puentes publicados (desmontaje). */
export function clearFluBridges(host: FluBridgeHost): void {
    delete host.__fluHandleAgendaCommandText;
    delete host.__fluHandleShoppingText;
    delete host.__fluHandleNoteText;
    delete host.__fluHandleDiaryText;
}

/** Publica los puentes al montar, los limpia al desmontar y sobrevive a StrictMode. */
export function useFluBridgesLifecycle(host: FluBridgeHost = window): void {
    // El snapshot se toma en el render porque es ahi donde App asigna los manejadores.
    const snapshotRef = useRef<BridgeSnapshot>([]);
    snapshotRef.current = snapshotFluBridges(host);
    useEffect(() => {
        publishFluBridges(snapshotRef.current, host);
        return () => clearFluBridges(host);
    }, [host]);
}
