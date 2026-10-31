/**
 * PUERTOS y CONFIGURACIÓN del módulo CONVERSACIÓN.
 *
 * Puro: no importa NADA de fuera del módulo. El acceso al navegador, a
 * `src/voice/api/**` y al resto del proyecto vive en `adapters.ts`.
 *
 * La tabla de configuración se declara aquí, en un solo sitio: `fluConfig.js`
 * queda fuera del alcance de este módulo y el plan prohíbe inventar claves.
 * Los valores son los de `docs/LAE_MODULO_CONVERSACION.MD` (sección «Config»).
 */

/** Idioma activo de la aplicación (`es` / `en` / `both`). */
export type Idioma = 'es' | 'en' | 'both'

/** Idioma de una locución concreta: una locución no es «both». */
export type IdiomaLocucion = Exclude<Idioma, 'both'>

/** Motivo declarado del cierre de una locución (`stop(stopKind)`). */
export type MotivoCierre = 'user' | 'system' | 'watchdog'

/**
 * Evidencia con la que se afirmó la etiqueta de una fila.
 * `pendiente` = etiqueta TEMPORAL: la medida de la voz todavía no es fiable (o no
 * ha llegado). El dueño la autorizó el 2026-10-30 y la reemplaza la medida tardía.
 */
export type EvidenciaEtiqueta = 'nombre' | 'medida' | 'continuidad' | 'semilla' | 'pendiente'

/** Tramo de audio con su frecuencia: `[inicio, fin]` sin `sampleRate` no significa nada. */
export type TramoMuestreado = Readonly<{
  /** Muestra inicial, en el `sampleRate` del tramo. */
  inicio: number
  /** Muestra final (exclusiva), en el `sampleRate` del tramo. */
  fin: number
  /** Frecuencia de captura del tramo. */
  sampleRate: number
}>

/**
 * Fila canónica del plan: una locución cerrada = un tramo = una fila.
 * `locutionId` ES el `tramoId` del ingestor; no existe un segundo id.
 * La tupla `[revision, updated_at, deleted]` la asigna el almacén, no el dominio.
 */
export type Fila = Readonly<{
  /** Id único de la locución (= `tramoId` emitido por el ingestor). */
  locutionId: string
  /** Sesión a la que pertenece la fila. */
  sessionId: string
  /** Turno de la fila (Caso 8: un turnId => UNA fila; reemisión consolida). */
  turnId: string
  /** Texto commiteado de la locución. */
  texto: string
  /** Tramo exacto con su frecuencia. */
  tramo: TramoMuestreado
  /** Etiqueta afirmada (nunca `?`). */
  etiqueta: string
  /** Evidencia de la etiqueta. */
  evidencia: EvidenciaEtiqueta
  /**
   * TIMBRE medido de la voz de la fila (null si no hubo medida): la vista liga
   * la fila a su voz POR TIMBRE (`voiceKeyFor`), no por etiqueta — la misma voz
   * da la misma clave aunque su etiqueta provisional cambie (mandato del dueño
   * 2026-10-11/13). Es evidencia inmutable: no existe en `CambiosFila`.
   */
  firma: readonly number[] | null
  /** Idioma de la locución. */
  idioma: IdiomaLocucion
  /** ¿Hubo solape de voces? Se declara, no se adivina. */
  overlap: boolean
  /** Cierre humano o de sistema; se promueve con el final del mismo tramo. */
  provisional: boolean
  /** Motivo declarado del cierre. */
  reason: MotivoCierre
  /** Revisión del almacén (incremento atómico). */
  revision: number
  /** Milisegundos desde epoch (UTC), puestos por el reloj inyectado. */
  updated_at: number
  /** Borrado lógico; nunca se borra físicamente. */
  deleted: boolean
}>

/** Fila lista para insertar: el almacén completa `[revision, updated_at, deleted]`. */
export type FilaNueva = Omit<Fila, 'revision' | 'updated_at' | 'deleted'>

/**
 * Campos actualizables de una fila: SOLO la VOZ — su etiqueta y la evidencia de
 * esa etiqueta. Mandato del dueño (2026-10-30): «puedes poner un hablante
 * temporal si aun no llega, y cuando lo tengas reemplazar; ese es el único campo
 * de la conversación que se puede actualizar». Texto, tramo, firma, idioma,
 * estado y borrado son INMUTABLES (insert-only).
 */
export type CambiosFila = Readonly<Partial<Pick<Fila, 'etiqueta' | 'evidencia'>>>

/** Reloj inyectado: dentro del módulo no se llama `Date.now()`. */
export interface RelojPort {
  /** Milisegundos desde epoch (UTC). */
  ahora(): number
}

/** Generador de ids: toda inserción usa UUIDv4. */
export interface IdPort {
  /** Devuelve un UUIDv4 nuevo. */
  uuid(): string
}

/** Registro de eventos y errores capturados (implementado con `logCaughtError`). */
export interface RegistroPort {
  /** Registra un hecho con su contexto y sus datos de diagnóstico. */
  registrar(contexto: string, ...detalles: unknown[]): void
}

/** Almacén de filas: un solo escritor por sesión; el borrado es lógico. */
export interface AlmacenPort {
  /** Upsert idempotente por `locutionId`; repetir incrementa `revision`. */
  guardar(fila: FilaNueva): Promise<Fila>
  /** Actualiza una fila existente e incrementa `revision`; `null` si no existe. */
  actualizar(locutionId: string, cambios: CambiosFila): Promise<Fila | null>
}

/** Medida del VAD para un bloque de audio. El VAD mide; la frontera decide. */
export type MedidaVad = Readonly<{
  /** ¿Hay voz en el bloque? */
  hayVoz: boolean
  /** Silencio acumulado al final del bloque, en milisegundos. */
  silencioMs: number
}>

/** VAD inyectado: no decide cierres, solo mide. */
export interface VadPort {
  /** Mide voz y silencio sobre PCM con su frecuencia. */
  medir(muestras: Float32Array, sampleRate: number): MedidaVad
}

/** Embeddings de voz inyectados (Xenova/wavlm en worker, fuera de este módulo). */
export interface EmbebedorPort {
  /** Vector de la voz del bloque, o `null` si no hay medida suficiente. */
  medir(muestras: Float32Array, sampleRate: number): Promise<readonly number[] | null>
  /**
   * Coseno entre dos vectores medidos (1 = misma voz). El cálculo tiene un
   * dueño único fuera del módulo (`speakerCore.compareCosineSignatures`); el
   * módulo solo decide contra el umbral (`identidad.ts`).
   */
  comparar(a: readonly number[], b: readonly number[]): number
}

/** Configuración viva de voz que el módulo consume por puerto. */
export interface ConfigPort {
  /** Wake words configuradas (fuente única: `FLU_CONFIG.voiceCommands.wakeWords`). */
  wakeWords(): readonly string[]
  /** Etiqueta de la primera locución sin medida ni continuidad. */
  semillaEtiqueta(): string
  /**
   * Etiqueta TEMPORAL de una fila cuya medida de voz todavía no es fiable
   * (`speakerAssignDefaults.pendingSpeaker`, «Hablante ?»). Fuente única:
   * `FLU_CONFIG.voiceIdentity.labels.pendingSpeaker`. Opcional para los dobles
   * de prueba: sin ella el módulo no usa etiqueta temporal y cae a la semilla.
   * El producto la implementa SIEMPRE.
   */
  etiquetaPendiente?(): string
  /**
   * `true` si la etiqueta es una agrupación ANÓNIMA (`Hablante N` o pendiente),
   * no una identidad: no puede afirmar ni heredar un nombre propio. Definición
   * única en `speakerCore.isAutoSpeakerLabel`; el adaptador solo la delega.
   */
  esEtiquetaAnonima(etiqueta: string): boolean
  /** Umbral de continuidad de voz (coseno) de la config viva; 0..1. */
  umbralContinuidadVoz(): number
  /** Etiqueta anónima de la voz nueva nº `indice` (`Hablante N`). */
  etiquetaAnonima(indice: number): string
  /**
   * Mínimo de palabras de la COLA de FLU que abre el fragmento para declarar
   * eco (regla 2 de `eco.ts`). Fuente única:
   * `VOICE_DIARIZATION_DEFAULTS.assistantEchoMinWords` + 1.
   */
  echoMinPalabrasCola(): number
}

/** Frase canónica y su presentación. La wake se quita SOLO para mostrar. */
export type FrasePartida = Readonly<{
  /** Texto completo commiteado, con wake si la hubo: la única frase canónica. */
  canonica: string
  /** Mismo texto sin la wake: solo presentación (caja / barra de búsqueda). */
  paraMostrar: string
  /** Mandato posterior a la wake, tal como lo entrega el splitter. */
  comando: string
  /** ¿Se reconoció la wake configurada? */
  wakeWordMatched: boolean
}>

/** Partidor de la wake: una sola implementación (la del proyecto) tras un puerto. */
export interface PartidorPort {
  /** Parte el texto en frase canónica, texto para mostrar y mandato. */
  partir(texto: string): FrasePartida
}

/** Motor concreto de ASR (el `auto` se resuelve antes de abrir). */
export type MotorAsr = 'cloud' | 'local'

/** Motor local de ASR: única etiqueta del valor dentro del módulo. */
const MOTOR_ASR_LOCAL: MotorAsr = 'local'

/**
 * ¿El motor elegido consume PCM por el puerto (`empujarAudio`)?
 * La nube captura por su cuenta; solo el motor local recibe bloques.
 * @param motor Motor elegido al abrir, o `null` si no hay ASR.
 * @returns `true` solo para el motor local.
 */
export function asrEmpujaAudio(motor: MotorAsr | null): boolean {
  return motor === MOTOR_ASR_LOCAL
}

/**
 * Medida final del tramo CERRADO de una locución (Caso 7+6): nunca null.
 * `ms` es SIEMPRE la duración del tramo cerrado del módulo (no la ventana de
 * apertura del reconocedor); `speechLikeMs`/`rms` los trae el motor o, si no,
 * los calcula el módulo sobre el PCM retenido (`MedidorTramoPort`).
 */
export type MedidaFinal = Readonly<{
  /** Duración del tramo cerrado, en milisegundos. */
  ms: number
  /** Muestras speech-like del tramo, en milisegundos. */
  speechLikeMs: number
  /** Energía RMS del tramo. */
  rms: number
}>

/** Métricas acústicas que el motor de ASR entrega con el final (pueden faltar). */
export type MedidaMotor = Readonly<{
  /** Muestras speech-like medidas por el motor, en milisegundos. */
  speechLikeMs?: number
  /** Energía RMS medida por el motor. */
  rms?: number
}>

/**
 * Medidor del tramo cerrado: habla y energía del PCM retenido, con los dueños
 * únicos de `voicedActivity`. El módulo lo usa SOLO cuando el motor no trae
 * métricas con el final.
 */
export interface MedidorTramoPort {
  /** Mide speech-like (ms) y RMS de los bloques del tramo cerrado. */
  medir(
    bloques: readonly Float32Array[],
    sampleRate: number,
  ): Readonly<{ speechLikeMs: number; rms: number }>
}

/** Estado del ASR. `aborted` es estado del ASR, nunca de la fila. */
export type EstadoAsr =
  | 'idle'
  | 'starting'
  | 'active'
  | 'aborted'
  | 'no-permission'
  | 'error'
  | 'watchdog'

/** Resultado del ASR: texto, si es final y el idioma de la locución. */
export type ResultadoAsr = Readonly<{
  /** Texto reconocido. */
  texto: string
  /** ¿Es el final del tramo? */
  final: boolean
  /** Idioma de la locución reconocida. */
  idioma: IdiomaLocucion
  /** Métricas acústicas del motor para el final (pueden faltar). */
  medida?: MedidaMotor
}>

/** Opciones de apertura del ASR: un solo ASR por sesión, sin fallback en caliente. */
export type OpcionesAsr = Readonly<{
  /** Idioma fijado al abrir (la nube no cambia a mitad de sesión). */
  idioma: IdiomaLocucion
  /** Motor concreto ya elegido. */
  motor: MotorAsr
  /** Entrega de resultados del motor. */
  alResultado: (resultado: ResultadoAsr) => void
  /** Entrega de cambios de estado del motor. */
  alEstado: (estado: EstadoAsr, detalle?: string) => void
}>

/** ASR por puerto: nube (Chrome) o local (Whisper); el módulo no importa ninguno. */
export interface AsrPort {
  /** ¿Este entorno puede abrir el motor pedido? */
  soportado(motor: MotorAsr): boolean
  /** Abre el motor y devuelve su estado inicial. */
  iniciar(opciones: OpcionesAsr): Promise<EstadoAsr>
  /** Entrega PCM al motor local; la nube captura por su cuenta. */
  empujarAudio(muestras: Float32Array, sampleRate: number): void
  /** Cierra el motor sin abortar. */
  detener(): void
  /** Aborta el motor (barge-in / reinicio). */
  abortar(): void
}

/** Preferencia de ASR en configuración: `auto` elige al abrir. */
export type MotorAsrPreferido = 'auto' | MotorAsr

/** Tabla de configuración del plan (defaults declarados, sin literales dispersos). */
export interface ConfiguracionConversacion {
  /** Silencio mínimo para que la frontera pueda cerrar. */
  readonly minSilenceMs: number
  /** Silencio sin texto ajeno que cierra por la segunda vía. */
  readonly silenceCloseMs: number
  /** Ventana de retención del ASR huérfano. */
  readonly orphanBufferMs: number
  /** ASR: motor preferido e idioma fijo de la nube. */
  readonly asr: Readonly<{ engine: MotorAsrPreferido; lang: IdiomaLocucion }>
  /** Retención máxima del buffer de sesión, en minutos. */
  readonly maxRetentionMin: number
  /** Identidad por medida: segundos mínimos de audio retenido antes de medir. */
  readonly minSegundosVozMedida: number
  /** Identidad por medida: tope de PCM retenido por locución, en segundos. */
  readonly maxSegundosVozRetenida: number
  /** Margen de solape medido en Etapa 0; `null` = sin medida → continuidad. */
  readonly overlapMargin: number | null
}

/** Defaults del plan. Es la ÚNICA fuente de estos números dentro del módulo. */
export const CONVERSACION_CONFIG: ConfiguracionConversacion = Object.freeze({
  minSilenceMs: 900,
  silenceCloseMs: 5000,
  orphanBufferMs: 8000,
  asr: Object.freeze({ engine: 'auto', lang: 'es' }),
  maxRetentionMin: 120,
  minSegundosVozMedida: 1.5,
  maxSegundosVozRetenida: 60,
  overlapMargin: null,
})

// ---------------------------------------------------------------------------
// SUPERFICIE PASIVA del módulo (modo wake sin conversación activa).
//
// La fila del usuario la escribe el MISMO módulo (`row.committed`) en AMBOS
// modos (un solo escritor; el segundo escritor de App se retiró, 2026-10-30).
// La superficie pasiva solo RESUELVE el hablante (`pasivo.ts`) y RENOMBRA una
// fila concreta por su id; la vista del producto y las utilidades de etiquetado
// llegan por estos puertos desde `adapters.ts`.
// ---------------------------------------------------------------------------

/** Sentimiento declarado de la locución (lo calcula quien la captura). */
export type SentimientoLocucion = 'positive' | 'negative' | 'neutral' | 'question'

/** Fila de usuario en la VISTA del producto (lo que la superficie pasiva lee). */
export type FilaVistaUsuario = Readonly<{
  id: string
  role: string
  text: string
  /** Epoch de la fila; las filas legacy pueden no traerlo (lo sella el store). */
  epoch?: number | string
  turnId?: number | string | null
  speakerId?: string | null
  speakerName?: string
  /** La fila espera su etiqueta real (nació con la pendiente). */
  speakerPending?: boolean
  signature?: readonly number[] | null
  timestamp?: number
  turnWindow?: { inicio: number; fin: number } | null
  sentiment?: SentimientoLocucion
}>

/**
 * Vista del producto (historial de conversación). Tras el retiro del escritor
 * pasivo (2026-10-30) la superficie pasiva solo LEE el historial y FIJA el
 * nombre de una fila concreta: los métodos de escritura de filas quedaron
 * retirados con el escritor (la fila la escribe el módulo).
 */
export interface PuertoVistaFilas {
  /** Historial visible, del más antiguo al más reciente. */
  leerHistorial(): readonly FilaVistaUsuario[]
  /** Fija el NOMBRE visible de una fila (freeze: no se re-resuelve). */
  fijarNombre(id: string, nombre: string, opciones?: Readonly<{ resuelta?: boolean }>): void
}

/**
 * Utilidades de fila que la superficie pasiva delega en los dueños únicos
 * vivos del proyecto (`speakerLabels`). Ninguna se reimplementa en el módulo.
 * Tras el retiro del escritor pasivo (2026-10-30) solo queda la canonización
 * del renombre.
 */
export interface UtilidadesFila {
  /** Canoniza un nombre de hablante (`luis` → `Luis`). */
  canonica(nombre: string): string
}
