/**
 * workerRuntime — dueno unico de la pregunta "¿puedo crear un Web Worker?".
 *
 * DUENO UNICO (auditoria de codigo 2026-10-02): la misma pregunta estaba escrita dos
 * veces: en `src/avatar/workers/fbxWorkerClient.ts` (`typeof Worker !== 'undefined'`)
 * y en `src/voice/lib/voiceIdWorkerClient.js` (`... && typeof window !== 'undefined'`).
 * La guarda extra de `window` solo cambiaria el resultado fuera del hilo principal, y
 * ese cliente no corre ahi: la semantica que se conserva es la del avatar, que es la
 * que el resto de clientes de worker puede usar.
 */

/**
 * ¿Existe el constructor de Web Worker en este runtime?
 * @returns `true` si se puede instanciar un Worker (no valida que arranque).
 */
export function isWorkerRuntime(): boolean {
    return typeof Worker !== 'undefined';
}
