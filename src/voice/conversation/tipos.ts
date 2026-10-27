/**
 * CONTRATO del módulo CONVERSACIÓN: API pública y estado interno compartido.
 *
 * Solo tipos: no ejecuta nada ni importa fuera del módulo. `index.ts` los
 * re-exporta; `motor`, `sesion`, `ingesta` y `cola` los consumen.
 */
import type {
  AlmacenPort,
  AsrPort,
  ConfigPort,
  ConfiguracionConversacion,
  EmbebedorPort,
  EstadoAsr,
  EvidenciaEtiqueta,
  Fila,
  IdiomaLocucion,
  IdPort,
  MedidaFinal,
  MedidaMotor,
  MedidaVad,
  MedidorTramoPort,
  MotivoCierre,
  PartidorPort,
  RegistroPort,
  RelojPort,
  ResultadoAsr,
  TramoMuestreado,
  VadPort,
} from './ports.ts'

/** Opciones de apertura de una sesión de conversación. */
export type OpcionesInicio = Readonly<{
  /** Idioma de la sesión; por defecto el de la tabla de config. */
  idioma?: IdiomaLocucion
  /** Turno inicial; si falta, se acuña un UUIDv4. */
  turnId?: string
  /**
   * Id de la grabación a ADOPTAR (recorder, Caso 11): la sesión se abre con el
   * MISMO id de la grabación activa, así todos los commits y eventos de una
   * grabación llevan un único recordingId. Vacío o ausente => el módulo acuña
   * el propio (N/A sin recorder activo al iniciar).
   */
  sessionId?: string
}>

/** Bloque de audio con su índice de muestra (`sampleRate` incluido, regla 1). */
export type BloqueAudio = Readonly<{
  /** PCM del bloque. */
  muestras: Float32Array
  /** Frecuencia del bloque; no cambia a mitad de tramo. */
  sampleRate: number
  /** Índice de la primera muestra del bloque. */
  inicio: number
  /** Índice final (exclusivo); por defecto `inicio + muestras.length`. */
  fin?: number
  /** Medida del VAD; si falta, se pide al VAD inyectado. */
  medida?: MedidaVad
  /** Turno al que pertenece el audio; si falta, se conserva el actual. */
  turnId?: string
}>

/** Evidencia de voz que acompaña a un resultado del ASR. */
export type EvidenciaVoz = Readonly<{
  /** Identidad de la voz para asociar un nombre registrado. */
  vozId?: string
  /** Nombre propuesto; solo se afirma con `nombreConfirmado`. */
  nombre?: string
  /** ¿El nombre está confirmado por la voz que lo dijo? */
  nombreConfirmado?: boolean
  /** Etiqueta medida (`Hablante N`). */
  hablante?: string
  /** ¿La voz continúa la anterior? Sin medida, se asume continuidad. */
  continuidad?: boolean
  /** ¿Hubo solape de voces? Se declara, no se adivina. */
  overlap?: boolean
}>

/** Resultado del ASR con la identidad de su tramo. */
export type AsrIngestado = Readonly<{
  /**
   * `tramoId` emitido por el ingestor: el ÚNICO id de la locución.
   * Vacío = lo resuelve el módulo al PROCESAR (dentro de su cola): tramo de
   * audio vigente o, si ya cerró, el último medido. Sin ninguno se cuenta como
   * huérfano; nunca se inventa un tramo.
   */
  tramoId: string
  /** Texto reconocido (puede revisarse o extenderse). */
  texto: string
  /** ¿Es el final del tramo? */
  final: boolean
  /** Idioma detectado por un motor local. */
  idioma?: IdiomaLocucion
  /** Evidencia de voz del resultado. */
  voz?: EvidenciaVoz
  /** Tramo declarado por el llamador; si falta, se resuelve del registro. */
  tramo?: TramoMuestreado
  /** Métricas acústicas del motor para el final (pueden faltar). */
  medida?: MedidaMotor
  /** Turno al que pertenece la locución; si falta, se conserva el actual. */
  turnId?: string
}>

/** Datos del bautizo `ok flu soy XXX`: solo la voz que lo dijo. */
export type DatosNombre = Readonly<{
  /** Nombre confirmado por la voz. */
  nombre: string
  /** Voz que lo dijo; si falta, la de la locución abierta. */
  vozId?: string
}>

/** Motivo de un descarte contado (nunca silencioso). */
export type MotivoDescarteConversacion =
  | 'tramoInvalido'
  | 'sinTexto'
  | 'eco'
  | 'huerfano'

/** Descarte contado con su locución y su motivo. */
export type DescarteConversacion = Readonly<{
  motivo: MotivoDescarteConversacion
  locutionId: string | null
  sessionId: string
}>

/** Causa declarada del cierre (el motivo de fila es `reason`). */
export type CausaCierre = 'final' | 'frontera' | 'silencio' | 'stop' | 'asr' | 'voz'

/** Evento público del módulo (6 tipos del plan). */
export type EventoConversacion =
  | Readonly<{
      tipo: 'locution.closed'
      sessionId: string
      locutionId: string
      tramo: TramoMuestreado
      motivo: MotivoCierre
      causa: CausaCierre
      /** Medida del tramo CERRADO (Caso 7+6): nunca null. */
      medida: MedidaFinal
    }>
  | Readonly<{ tipo: 'row.committed'; sessionId: string; fila: Fila }>
  | Readonly<{
      tipo: 'speaker.labeled'
      sessionId: string
      locutionId: string
      etiqueta: string
      evidencia: EvidenciaEtiqueta
    }>
  | Readonly<{
      tipo: 'box.updated'
      sessionId: string
      texto: string
      abierta: boolean
      fraseCanonica: string
      fraseParaMostrar: string
    }>
  | Readonly<{ tipo: 'asr.status'; sessionId: string; estado: EstadoAsr; detalle?: string }>
  | Readonly<{ tipo: 'barge.in'; sessionId: string; locutionId: string; texto: string }>

/** Instantánea síncrona del estado de la conversación. */
export type InstantaneaConversacion = Readonly<{
  sessionId: string | null
  activa: boolean
  box: Readonly<{ texto: string; abierta: boolean }>
  /** Frase canónica completa (con wake si la hubo). */
  fraseCanonica: string
  /** Misma frase sin la wake: solo presentación. */
  fraseParaMostrar: string
  idioma: IdiomaLocucion
  asr: EstadoAsr
  locucionAbierta: Readonly<{
    locutionId: string
    texto: string
    tramo: TramoMuestreado
  }> | null
  /** Tramo de audio vigente (puede no ser el de la locución abierta). */
  tramoAudio: Readonly<{
    tramoId: string
    inicio: number
    fin: number
    sampleRate: number
  }> | null
  /** Muestras PCM entregadas a la ingesta en la sesión (Caso 5, sin tope). */
  totalMuestrasEntregadas: number
  filas: readonly Fila[]
  descartes: readonly DescarteConversacion[]
}>

/** Puertos que el producto inyecta (adapters.ts los implementa). */
export type DependenciasConversacion = Readonly<{
  reloj: RelojPort
  id: IdPort
  registro: RegistroPort
  almacen: AlmacenPort
  config: ConfigPort
  partidor: PartidorPort
  /**
   * Lo último que dijo FLU, entregado por el consumidor. Obligatorio: el módulo
   * no habla ni puede distinguir eco/barge-in sin esta función. Debe devolver
   * vacío cuando FLU no tiene voz activa.
   */
  ultimoTextoDicho: () => string
  /** Tabla del plan; por defecto `CONVERSACION_CONFIG`. */
  configuracion?: ConfiguracionConversacion
  vad?: VadPort
  asr?: AsrPort
  /**
   * Embeddings de voz (`adapters.crearEmbebedorProducto`): con el puerto, el
   * módulo mide la identidad por sí mismo (decisión del dueño, Paso 5-A). Sin
   * él, las locuciones cierran con continuidad/semilla, sin medida.
   */
  embebedor?: EmbebedorPort
  /**
   * Medidor del tramo cerrado (Caso 7+6): obligatorio. Sin él no hay
   * `speechLikeMs`/`rms` del PCM retenido cuando el motor no trae métricas.
   */
  medidor: MedidorTramoPort
}>

/** Las 7 llamadas del plan. */
export interface ConversacionApi {
  /** Abre la sesión (una sola a la vez); arranca el ASR inyectado si existe. */
  start(opciones?: OpcionesInicio): Promise<InstantaneaConversacion>
  /** Cierra la sesión con el motivo declarado; nunca pierde el texto abierto. */
  stop(stopKind: MotivoCierre): Promise<InstantaneaConversacion>
  /** Ingesta un bloque PCM con su índice de muestra (regla 1). */
  ingestAudio(bloque: BloqueAudio): Promise<InstantaneaConversacion>
  /** Ingesta un resultado del ASR para su tramo (regla 3). */
  ingestAsr(resultado: AsrIngestado): Promise<InstantaneaConversacion>
  /** Estado actual, sin efectos secundarios. */
  snapshot(): InstantaneaConversacion
  /** Suscribe a los 6 eventos; devuelve la baja. */
  subscribe(oyente: (evento: EventoConversacion) => void): () => void
  /** Bautiza SOLO la voz que dijo `ok flu soy XXX`. */
  registerName(datos: DatosNombre): InstantaneaConversacion
}

/** Tramo de audio vivo: `[inicio, fin]` con su frecuencia y su turno. */
export type TramoAudio = Readonly<{
  tramoId: string
  inicio: number
  fin: number
  sampleRate: number
  turnId: string
  /** Silencio medido antes de abrir este tramo (frontera de la regla 2). */
  silencioPrevioMs: number
}>

/** Única locución abierta: su texto, su tramo y la voz que la sostiene. */
export type LocucionAbierta = Readonly<{
  locutionId: string
  texto: string
  inicio: number
  fin: number
  sampleRate: number
  turnId: string
  idioma: IdiomaLocucion
  voz: EvidenciaVoz
  final: boolean
  /** Métricas del motor para el final (pasan tal cual al cierre). */
  medidaMotor?: MedidaMotor
  /** Continuidad de voz calculada al abrir (no se reescribe al azar). */
  continuidadVoz: boolean
}>

/** Texto de un tramo ajeno retenido hasta que se pueda abrir sin mezclarse. */
export type EntradaPendiente = Readonly<{
  tramoId: string
  texto: string
  final: boolean
  idioma: IdiomaLocucion
  turnId: string
  voz: EvidenciaVoz
  tramo?: TramoMuestreado
  /** Métricas del motor para el final retenido (pueden faltar). */
  medida?: MedidaMotor
  recibidoAt: number
}>

/** Resultado crudo del `AsrPort` con el tramo al que se atribuyó al drenar. */
export type ResultadoAsrCrudo = Readonly<ResultadoAsr & { tramoId: string }>

/** Cuenta un descarte con motivo y su tramo (nunca se pierde en silencio). */
export type ContarDescarte = (
  motivo: MotivoDescarteConversacion,
  locutionId: string | null,
  tramo: TramoMuestreado | null,
) => void
