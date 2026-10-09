/**
 * serviceSingleton.ts — DUENO UNICO de "instancia global de modulo + arranque/parada".
 *
 * POR QUE EXISTE (auditoria 2026-10-09): los servicios de autonomia repetian la MISMA forma
 * cambiando solo el nombre: `let globalX = null`; `getX(config)` que crea la primera vez;
 * `startGlobalX` que arranca y devuelve; `stopGlobalX` que para si existe. Eran 3 copias de
 * `get` y 4 de `start`/`stop` (P9.40). Aqui vive una vez; cada servicio aporta su creador.
 */

/** Servicio con arranque y parada (los que no los declaran los ignoran). */
export interface StartStop {
    start?: () => void;
    stop?: () => void;
}

/** Cara publica de un singleton de modulo. */
export interface ModuleSingleton<A extends unknown[], T> {
    /** La instancia global, creandola con `args` la primera vez. */
    get: (...args: A) => T;
    /** La instancia viva, o `null` si aun no se creo (getters de "ultimo resultado"). */
    current: () => T | null;
    /** Crea (si hace falta), arranca y devuelve la instancia global. */
    start: (...args: A) => T;
    /** Para la instancia global si existe. */
    stop: () => void;
}

/**
 * Envuelve el patron singleton de modulo.
 * @param create creador de la instancia (recibe los mismos argumentos que `get`)
 */
export function createModuleSingleton<A extends unknown[], T>(
    create: (...args: A) => T,
): ModuleSingleton<A, T> {
    let instance: T | null = null;
    const get = (...args: A): T => {
        if (!instance) instance = create(...args);
        return instance;
    };
    return {
        get,
        current: () => instance,
        start: (...args: A): T => {
            const system = get(...args);
            (system as StartStop).start?.();
            return system;
        },
        stop: () => {
            (instance as StartStop | null)?.stop?.();
        },
    };
}
