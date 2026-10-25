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

/** Evidencia con la que se afirmó la etiqueta de una fila. */
export type EvidenciaEtiqueta = 'nombre' | 'medida' | 'continuidad' | 'semilla'

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
  /** Turno que agrupa varias locuciones. */
  turnId: string
  /** Texto commiteado de la locución. */
  texto: string
  /** Tramo exacto con su frecuencia. */
  tramo: TramoMuestreado
  /** Etiqueta afirmada (nunca `?`). */
  etiqueta: string
  /** Evidencia de la etiqueta. */
  evidencia: EvidenciaEtiqueta
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

/** Campos que el almacén puede actualizar (promoción y borrado lógico). */
export type CambiosFila = Partial<Pick<Fila, 'texto' | 'provisional' | 'reason' | 'deleted'>>

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
  /** Filas de una sesión, incluidas las de borrado lógico (`deleted: true`). */
  leerSesion(sessionId: string): Promise<Fila[]>
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
}

/** Configuración viva de voz que el módulo consume por puerto. */
export interface ConfigPort {
  /** Wake words configuradas (fuente única: `FLU_CONFIG.voiceCommands.wakeWords`). */
  wakeWords(): readonly string[]
  /** Etiqueta de la primera locución sin medida ni continuidad. */
  semillaEtiqueta(): string
  /** Motor de conversación resuelto: override de runtime → producto → plan. */
  conversationEngine(): MotorConversacion
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

/** Motor de conversación activo: `legacy` hasta validar la pantalla. */
export type MotorConversacion = 'legacy' | 'new'

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
  /** Margen de solape medido en Etapa 0; `null` = sin medida → continuidad. */
  readonly overlapMargin: number | null
  /** Bandera de arranque del motor nuevo. */
  readonly conversation: Readonly<{ engine: MotorConversacion }>
}

/** Defaults del plan. Es la ÚNICA fuente de estos números dentro del módulo. */
export const CONVERSACION_CONFIG: ConfiguracionConversacion = Object.freeze({
  minSilenceMs: 900,
  silenceCloseMs: 5000,
  orphanBufferMs: 8000,
  asr: Object.freeze({ engine: 'auto', lang: 'es' }),
  maxRetentionMin: 120,
  overlapMargin: null,
  conversation: Object.freeze({ engine: 'legacy' }),
})

/** ¿El valor es un motor declarado? Evita re-enumerar `'legacy' | 'new'` fuera. */
export function esMotorConversacion(valor: unknown): valor is MotorConversacion {
  return valor === 'legacy' || valor === 'new'
}

/**
 * ¿Arranca el motor nuevo? Solo si el puerto resuelve `'new'`.
 * @param config Puerto de configuración que aporta el producto.
 * @returns `true` si el motor nuevo debe escribir filas.
 */
export function motorConversacionActivo(config: ConfigPort): boolean {
  return config.conversationEngine() === 'new'
}
