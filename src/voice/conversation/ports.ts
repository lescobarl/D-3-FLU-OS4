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
// La fila del usuario en modo pasivo la escribe el MISMO módulo (un solo
// escritor de la fila del usuario; el segundo escritor de App se retiró). La
// lógica pura vive en `pasivo.ts`; la vista del producto y las utilidades de
// etiquetado llegan por estos puertos desde `adapters.ts`.
// ---------------------------------------------------------------------------

/** Sentimiento declarado de la locución (lo calcula quien la captura). */
export type SentimientoLocucion = 'positive' | 'negative' | 'neutral' | 'question'

/** Fila de usuario en la VISTA del producto (lo que el escritor pasivo lee). */
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

/** Entrada que el escritor pasivo agrega a la vista del producto. */
export type NuevaEntradaVista = Readonly<{
  id: string
  role: 'user'
  epoch: number
  text: string
  speakerId: string
  speakerName?: string
  speakerPending?: boolean
  turnId?: number | string
  turnWindow?: { inicio: number; fin: number } | null
  timestamp: number
  sentiment: SentimientoLocucion
  signature: number[] | null
}>

/** Entrada del compromiso de una fila de usuario en modo pasivo. */
export type EntradaCompromisoUsuario = Readonly<{
  /** Frase canónica de la locución (con wake word, tal como se muestra). */
  text: string
  /** Hablante resuelto por el que llama (puede llegar solo en el commit final). */
  speakerName?: string
  /** El que llama DECLARA que el nombre viene de una ventana de AUDIO medida. */
  evidenciaAcustica?: boolean
  /** Firma de la voz del turno (clave de la voz en la vista). */
  signature?: readonly number[] | null
  /** Epoch de la fila; por defecto el vigente de la vista. */
  epoch?: number
  /** Sentimiento de la locución; por defecto `neutral`. */
  sentiment?: SentimientoLocucion
  /** Marca de tiempo inyectable; por defecto el reloj del producto. */
  timestamp?: number
  /** La emisión cruda crece: reutiliza la fila del turno en lugar de agregar. */
  replaceLast?: boolean
  /** Identidad del turno (obligatoria): único criterio de reutilización. */
  turnId: number | string | null
  /** Ventana de audio del turno: dato informativo, nunca identidad. */
  turnWindow?: { inicio: number; fin: number } | null
}>

/** Acción del compromiso sobre la fila del usuario. */
export type AccionCompromisoUsuario = 'replaced' | 'reused' | 'added' | 'skipped'

/** Resultado del compromiso: id de la fila y qué se hizo con ella. */
export type ResultadoCompromisoUsuario = Readonly<{
  id: string | null
  action: AccionCompromisoUsuario
}>

/** Vista del producto (historial de conversación): el escritor pasivo lee y escribe aquí. */
export interface PuertoVistaFilas {
  /** Historial visible, del más antiguo al más reciente. */
  leerHistorial(): readonly FilaVistaUsuario[]
  /** Agrega una entrada de usuario (una fila por locución). */
  agregarEntrada(entrada: NuevaEntradaVista): void
  /** Completa el texto de una fila existente (recorte posterior del ASR). */
  completarFragmento(id: string, texto: string): void
  /** Fija la CLAVE de la voz (`speakerId`) de una fila, con su firma si la hay. */
  fijarAltavoz(id: string, vozId: string, opciones?: Readonly<{ firma?: readonly number[] | null }>): void
  /** Fija el NOMBRE visible de una fila (freeze: no se re-resuelve). */
  fijarNombre(id: string, nombre: string, opciones?: Readonly<{ resuelta?: boolean }>): void
  /** Anota el high-water de la clave automática (nunca baja). */
  anotarHighWater(indice: number): void
  /** Epoch vigente de la conversación (dueño: la vista). */
  epoch(): number
}

/**
 * Utilidades de fila que el escritor pasivo delega en los dueños únicos vivos
 * del proyecto (`audioMath`, `speakerCore`, `speakerLabels`, `speakerDirectory`,
 * `conversationRow`, `turnStream`). Ninguna se reimplementa en el módulo.
 */
export interface UtilidadesFila {
  /** Normaliza el texto de la locución (`cleanForSpeech`). */
  normalizar(texto: string): string
  /** ¿El nombre es un nombre propio (no una etiqueta automática)? */
  nombrePropio(nombre: string): boolean
  /** Canoniza un nombre de hablante (`luis` → `Luis`). */
  canonica(nombre: string): string
  /** Etiqueta PENDIENTE de la config («aún no se sabe»). */
  etiquetaPendiente(): string
  /** Etiqueta de respaldo de la config (solo cuando no hay etiqueta). */
  respaldoEtiqueta(): string
  /** Clave de hablante de una etiqueta (`labelToSpeakerId`). */
  claveDeEtiqueta(etiqueta: string): string
  /** Clave de la VOZ: el timbre cuando se midió (`voiceKeyFor`). */
  claveVoz(datos: { voiceId: string; signature?: readonly number[] | null }): string
  /** Índice alto de una clave automática (`autoSpeakerIndexFromKey`). */
  indiceAltoDeClave(clave: string): number
  /** Firma normalizada para la fila (`normalizeRowSignature`). */
  normalizarFirma(firma?: readonly number[] | null): number[] | null
  /** Palabras de un texto (`speechWords`): el módulo las usa para decidir. */
  palabras(texto: string): string[]
  /**
   * Compacto de comparación (`compactForRevision`): sin acentos, minúsculas y
   * solo alfanuméricos. El módulo lo usa para la revisión ASR de un fragmento.
   */
  compactar(texto: string): string
}
