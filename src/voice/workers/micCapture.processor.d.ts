/**
 * El scope de AudioWorklet NO viene en lib.dom: `AudioWorkletProcessor` y
 * `registerProcessor` solo existen DENTRO del hilo de audio. Sin declararlos,
 * checkJs los marca como nombres inexistentes que en ejecucion SI existen
 * (falso positivo), y el guard de P6.7 no podria exigir cero errores.
 */
declare class AudioWorkletProcessor {
    readonly port: MessagePort
}

declare function registerProcessor(
    name: string,
    processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void
