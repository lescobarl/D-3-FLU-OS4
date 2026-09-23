/**
 * Tipos del motor unico de escucha, hermano de
 * `whisperRecognitionEngine.js`. La salida imita la Web Speech API, que es lo
 * que ya consume `useFluVoiceAssistant`: `{ resultIndex, results: [...] }`.
 */

/** Lo que el motor necesita de un transcriptor (`WhisperTranscriber` lo cumple). */
export interface WhisperTranscriberLike {
  preload?(): Promise<unknown>
  transcribe(samples: Float32Array | readonly number[]): Promise<string>
  dispose?(): void
}

/** Un turno transcrito, con la forma que leen los consumidores. */
export interface WhisperResult {
  readonly isFinal: boolean
  readonly length: number
  readonly 0: { readonly transcript: string; readonly confidence: number }
}

/** Evento de resultado del motor (`onresult`). */
export interface WhisperResultEvent {
  readonly resultIndex: number
  readonly results: readonly WhisperResult[]
}

/** Error del motor (`onerror`). */
export interface WhisperEngineError {
  error: string
  name: string
  message: string
}

/** Opciones del motor. */
export interface WhisperEngineOptions {
  sampleRate?: number
  transcriber?: WhisperTranscriberLike
  finalTranscriber?: WhisperTranscriberLike
  interimTranscriber?: WhisperTranscriberLike
}

/** Motor `onstart/onresult/onerror/onend` alimentado con PCM continuo. */
export interface WhisperRecognitionEngine {
  onstart: (() => void) | null
  onresult: ((event: WhisperResultEvent) => void) | null
  onerror: ((event: WhisperEngineError) => void) | null
  onend: (() => void) | null
  readonly active: boolean
  readonly continuous: boolean
  start(): void
  stop(): void
  abort(): void
  /** Alimenta PCM (AudioWorklet) en regimen continuo. */
  pushAudio(samples: Float32Array | readonly number[], rate?: number): void
  dispose(): void
}

/** Crea el motor de escucha que ya consume `useFluVoiceAssistant`. */
export function createWhisperRecognitionEngine(
  options?: WhisperEngineOptions,
): WhisperRecognitionEngine
