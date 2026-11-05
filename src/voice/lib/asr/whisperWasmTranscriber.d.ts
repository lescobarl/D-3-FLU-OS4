/**
 * Tipos del transcriptor Whisper on-device, hermano de
 * `whisperWasmTranscriber.js`. El `.js` habla con un worker propio; sin estos
 * tipos, cada consumidor `.ts` tenia que declarar `any` para usarlo.
 */

/** Inyeccion del worker y ajustes del modelo. */
export interface WhisperTranscriberOptions {
  /** Crea el worker a mano (tests); por defecto, `whisperAsr.worker.js`. */
  workerFactory?: () => Worker
  /** Id del modelo (p. ej. `Xenova/whisper-base`). */
  modelId?: string
  /** Precision del modelo (`fp32`, `q8`, ...). */
  dtype?: string
}

/** Transcriptor real: el que devuelve `createWhisperWasmTranscriber`. */
export interface WhisperTranscriber {
  readonly modelId: string
  /** Carga el modelo en el worker (idempotente). */
  preload(): Promise<unknown>
  /** Transcribe PCM mono; texto vacio si no hay muestras. */
  transcribe(samples: Float32Array | readonly number[]): Promise<string>
  /** Destruye el worker y rechaza lo pendiente. */
  dispose(): void
}

/** Crea el transcriptor (PCM -> texto) que consume el motor de escucha. */
export function createWhisperWasmTranscriber(
  options?: WhisperTranscriberOptions,
): WhisperTranscriber
