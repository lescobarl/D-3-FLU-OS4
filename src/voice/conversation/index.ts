/**
 * API del módulo CONVERSACIÓN — 7 llamadas y 6 eventos (orquestador).
 *
 * Las 7 llamadas del plan: `start`, `stop`, `ingestAudio`, `ingestAsr`,
 * `snapshot`, `subscribe`, `registerName`. Los 6 eventos: `locution.closed`,
 * `row.committed`, `speaker.labeled`, `box.updated`, `asr.status`, `barge.in`.
 *
 * Una sola locución abierta y un solo escritor. La ingesta se serializa en una
 * cola: dos llamadas concurrentes no pueden cerrar dos veces el mismo tramo.
 * El texto se aplica primero y después se evalúa la frontera (regla 2); una
 * locución que pierde palabras no se pinta (regla 3 y 6).
 *
 * Sin imports fuera del módulo: ASR, audio, VAD, almacén y reloj entran por
 * `ports.ts`. Sin `Date.now()`: todo tiempo sale del reloj inyectado.
 *
 * Eco y barge-in: el módulo NO habla. El consumidor entrega lo último que dijo
 * FLU en `ultimoTextoDicho()` (dependencia obligatoria). Un texto que es eco se
 * cuenta y descarta; uno ajeno emite `barge.in` y el consumidor apaga su voz.
 *
 * Decisiones declaradas:
 *  - `stop(user|system|watchdog)` es el único cierre manual; `aborted` es estado
 *    del ASR, nunca motivo de fila (lanza si se intenta).
 *  - Los resultados del `AsrPort` se retienen en una cola ordenada y se drenan
 *    en la siguiente llamada pública o en `stop`; nunca se procesan dos veces.
 *  - Sin cerrojo entre pestañas: se declara (el plan lo permite). El motor nuevo
 *    solo arranca con `conversation.engine: 'new'`.
 */
import { normalizarParaComparar } from './adapters.ts'
import { decidirFrontera } from './frontera.ts'
import { construirFila, promoverFila } from './fila.ts'
import type { CierreLocucion, VozEtiqueta } from './fila.ts'
import { decidirRevision } from './revision.ts'
import { CONVERSACION_CONFIG, asrEmpujaAudio } from './ports.ts'
import type {
  AlmacenPort,
  AsrPort,
  ConfigPort,
  ConfiguracionConversacion,
  EstadoAsr,
  EvidenciaEtiqueta,
  Fila,
  IdiomaLocucion,
  IdPort,
  MedidaVad,
  MotivoCierre,
  MotorAsr,
  OpcionesAsr,
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
  /** `tramoId` emitido por el ingestor: el ÚNICO id de la locución. */
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
export type CausaCierre = 'final' | 'frontera' | 'silencio' | 'stop' | 'asr'

/** Evento público del módulo (6 tipos del plan). */
export type EventoConversacion =
  | Readonly<{
      tipo: 'locution.closed'
      sessionId: string
      locutionId: string
      tramo: TramoMuestreado
      motivo: MotivoCierre
      causa: CausaCierre
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

type TramoAudio = Readonly<{
  tramoId: string
  inicio: number
  fin: number
  sampleRate: number
  turnId: string
  /** Silencio medido antes de abrir este tramo (frontera de la regla 2). */
  silencioPrevioMs: number
}>

type TramoRegistrado = Readonly<TramoAudio & { ultimaVez: number }>

type LocucionAbierta = Readonly<{
  locutionId: string
  texto: string
  inicio: number
  fin: number
  sampleRate: number
  turnId: string
  idioma: IdiomaLocucion
  voz: EvidenciaVoz
  final: boolean
  /** Continuidad de voz calculada al abrir (no se reescribe al azar). */
  continuidadVoz: boolean
}>

type EntradaPendiente = Readonly<{
  tramoId: string
  texto: string
  final: boolean
  idioma: IdiomaLocucion
  turnId: string
  voz: EvidenciaVoz
  tramo?: TramoMuestreado
  recibidoAt: number
}>

type ResultadoAsrCrudo = Readonly<ResultadoAsr & { tramoId: string }>

/** Palabras normalizadas por el dueño único (sin acentos) y sin signos. */
function palabrasNormalizadas(texto: string): string[] {
  return normalizarParaComparar(texto)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * ¿El texto es eco del último TTS? Cobertura y sufijo: todas las palabras del
 * candidato son la cola de las palabras del TTS, en el mismo orden. Un texto
 * vacío nunca es eco. La comparación es por PALABRAS, no por caracteres.
 *
 * @param texto Texto reconocido como posible eco.
 * @param ultimoTts Último texto entregado al TTS.
 * @returns `true` si es eco y por tanto nunca produce fila de usuario.
 */
export function esEcoDeTts(texto: string, ultimoTts: string): boolean {
  const candidato = palabrasNormalizadas(texto)
  const tts = palabrasNormalizadas(ultimoTts)
  if (candidato.length === 0 || tts.length === 0) return false
  if (candidato.length > tts.length) return false
  const cola = tts.slice(tts.length - candidato.length)
  return cola.every((palabra, indice) => palabra === candidato[indice])
}

/** Fusiona evidencia de voz sin borrar lo ya medido con campos ausentes. */
function fusionarVoz(base: EvidenciaVoz, nueva: EvidenciaVoz | undefined): EvidenciaVoz {
  if (!nueva) return base
  return {
    vozId: nueva.vozId ?? base.vozId,
    nombre: nueva.nombre ?? base.nombre,
    nombreConfirmado: nueva.nombreConfirmado ?? base.nombreConfirmado,
    hablante: nueva.hablante ?? base.hablante,
    continuidad: nueva.continuidad ?? base.continuidad,
    overlap: nueva.overlap ?? base.overlap,
  }
}

/** Elige el motor del ASR al abrir: uno solo, sin fallback en caliente. */
function elegirMotor(
  asr: AsrPort,
  configuracion: ConfiguracionConversacion,
): MotorAsr | null {
  const preferido = configuracion.asr.engine
  if (preferido === 'auto') {
    if (asr.soportado('cloud')) return 'cloud'
    if (asr.soportado('local')) return 'local'
    return null
  }
  return asr.soportado(preferido) ? preferido : null
}

/**
 * Crea una sesión de conversación con sus puertos inyectados.
 *
 * @param dependencias Puertos del producto; la configuración es opcional.
 * @returns Las 7 llamadas del plan sobre un único escritor.
 */
export function crearConversacion(dependencias: DependenciasConversacion): ConversacionApi {
  if (typeof dependencias.ultimoTextoDicho !== 'function') {
    throw new Error(
      'ultimoTextoDicho es obligatorio: el modulo no habla ni detecta eco sin el',
    )
  }
  const { reloj, id, registro, almacen, config, partidor, ultimoTextoDicho } = dependencias
  const configuracion = dependencias.configuracion ?? CONVERSACION_CONFIG
  const asr = dependencias.asr
  const vad = dependencias.vad

  let activa = false
  let sessionId: string | null = null
  let turnoActual = ''
  let idiomaActual: IdiomaLocucion = configuracion.asr.lang
  let estadoAsr: EstadoAsr = 'idle'
  let motorAsr: MotorAsr | null = null
  let abierta: LocucionAbierta | null = null
  let tramoAudio: TramoAudio | null = null
  let ultimaMedida: MedidaVad = { hayVoz: false, silencioMs: 0 }
  let silencioPendienteMs = 0
  let ultimaEtiqueta = ''
  let ultimaVozId = ''
  let cierreAsrPendiente: MotivoCierre | null = null
  let descartes: DescarteConversacion[] = []
  let pendientes: EntradaPendiente[] = []
  let resultadosAsr: ResultadoAsrCrudo[] = []
  const tramos = new Map<string, TramoRegistrado>()
  const filas = new Map<string, Fila>()
  const nombresPorVoz = new Map<string, string>()
  const oyentes = new Set<(evento: EventoConversacion) => void>()

  /** Cola serializada: una operación a la vez, sin cierres duplicados. */
  let cola: Promise<unknown> = Promise.resolve()

  /**
   * Serializa una tarea sobre la cola. La copia de la cola absorbe el rechazo
   * para seguir atendiendo llamadas; el rechazo REAL se devuelve a quien llamó.
   */
  function serializar<T>(tarea: () => Promise<T>): Promise<T> {
    const siguiente = cola.then(tarea)
    cola = siguiente.then(
      () => undefined,
      () => undefined,
    )
    return siguiente
  }

  /** Emite un evento a los oyentes actuales (una copia, por si se dan de baja). */
  function emitir(evento: EventoConversacion): void {
    for (const oyente of [...oyentes]) oyente(evento)
  }

  /** Exige sesión activa y devuelve su id. */
  function exigirActiva(): string {
    if (!activa || !sessionId) throw new Error('conversacion no iniciada')
    return sessionId
  }

  /** Frase canónica y presentación de la locución abierta. */
  function fraseActual(): { canonica: string; paraMostrar: string } {
    const partida = partidor.partir(abierta?.texto ?? '')
    return { canonica: partida.canonica, paraMostrar: partida.paraMostrar }
  }

  /** Emite `box.updated` con el texto abierto y su presentación. */
  function emitirCaja(): void {
    if (!sessionId) return
    const frase = fraseActual()
    emitir({
      tipo: 'box.updated',
      sessionId,
      texto: abierta?.texto ?? '',
      abierta: Boolean(abierta),
      fraseCanonica: frase.canonica,
      fraseParaMostrar: frase.paraMostrar,
    })
  }

  /** Snapshot síncrono; la retención solo oculta del snapshot, no borra filas. */
  function snapshot(): InstantaneaConversacion {
    const frase = fraseActual()
    const limite = reloj.ahora() - configuracion.maxRetentionMin * 60_000
    return {
      sessionId,
      activa,
      box: { texto: abierta?.texto ?? '', abierta: Boolean(abierta) },
      fraseCanonica: frase.canonica,
      fraseParaMostrar: frase.paraMostrar,
      idioma: idiomaActual,
      asr: estadoAsr,
      locucionAbierta: abierta
        ? {
            locutionId: abierta.locutionId,
            texto: abierta.texto,
            tramo: {
              inicio: abierta.inicio,
              fin: abierta.fin,
              sampleRate: abierta.sampleRate,
            },
          }
        : null,
      filas: [...filas.values()].filter(
        (fila) => fila.sessionId === sessionId && fila.updated_at >= limite,
      ),
      tramoAudio: tramoAudio
        ? {
            tramoId: tramoAudio.tramoId,
            inicio: tramoAudio.inicio,
            fin: tramoAudio.fin,
            sampleRate: tramoAudio.sampleRate,
          }
        : null,
      descartes: [...descartes],
    }
  }

  /** Cuenta un descarte con motivo; nunca se pierde en silencio. */
  function contarDescarte(
    motivo: MotivoDescarteConversacion,
    locutionId: string | null,
    tramo: TramoMuestreado | null,
  ): void {
    descartes = [...descartes, { motivo, locutionId, sessionId: sessionId ?? '' }]
    registro.registrar('conversacion.descarte', {
      sessionId,
      locutionId,
      motivo,
      tramo,
    })
  }

  /** Resuelve la voz de una locución con el nombre registrado, si lo hay. */
  function resolverVoz(voz: EvidenciaVoz, continuidadVoz: boolean): VozEtiqueta {
    const vozId = String(voz.vozId || '').trim()
    const registrado = vozId ? nombresPorVoz.get(vozId) : undefined
    const nombre = registrado ?? (voz.nombreConfirmado ? String(voz.nombre || '').trim() : '')
    return {
      nombre,
      nombreConfirmado: Boolean(nombre),
      hablante: String(voz.hablante || '').trim(),
      continuidad: voz.continuidad ?? continuidadVoz,
    }
  }

  /** Guarda (o refresca) un tramo en el registro de huérfanos. */
  function registrarTramo(tramo: TramoAudio): void {
    tramos.set(tramo.tramoId, { ...tramo, ultimaVez: reloj.ahora() })
  }

  /** Tramo del registro, descartándolo si superó `orphanBufferMs`. */
  function tramoRegistrado(tramoId: string): TramoRegistrado | null {
    const registrado = tramos.get(tramoId)
    if (!registrado) return null
    if (reloj.ahora() - registrado.ultimaVez > configuracion.orphanBufferMs) {
      tramos.delete(tramoId)
      return null
    }
    return registrado
  }

  /** Resuelve el tramo de un resultado: declarado, registrado o `null`. */
  function tramoDe(tramoId: string, declarado?: TramoMuestreado): TramoMuestreado | null {
    if (
      declarado &&
      Number.isFinite(declarado.inicio) &&
      Number.isFinite(declarado.fin) &&
      declarado.fin > declarado.inicio &&
      declarado.sampleRate > 0
    ) {
      return declarado
    }
    const registrado = tramoRegistrado(tramoId)
    if (!registrado) return null
    return {
      inicio: registrado.inicio,
      fin: registrado.fin,
      sampleRate: registrado.sampleRate,
    }
  }

  /** Abre la única locución abierta; el llamador garantiza que no hay otra. */
  function abrirLocucion(datos: {
    tramoId: string
    texto: string
    tramo: TramoMuestreado
    turnId: string
    idioma: IdiomaLocucion
    voz: EvidenciaVoz
  }): void {
    const vozId = String(datos.voz.vozId || '').trim()
    const continuidadVoz = vozId ? vozId === ultimaVozId : Boolean(ultimaEtiqueta)
    if (vozId) ultimaVozId = vozId
    abierta = {
      locutionId: datos.tramoId,
      texto: datos.texto,
      inicio: datos.tramo.inicio,
      fin: datos.tramo.fin,
      sampleRate: datos.tramo.sampleRate,
      turnId: datos.turnId,
      idioma: datos.idioma,
      voz: datos.voz,
      final: false,
      continuidadVoz,
    }
    registro.registrar('conversacion.locucion.abierta', {
      sessionId,
      locutionId: datos.tramoId,
      tramo: datos.tramo,
    })
    if (datos.texto) emitirCaja()
  }

  /** Aplica texto a la locución abierta ANTES de evaluar la frontera (regla 2). */
  function aplicarRevision(
    locucion: LocucionAbierta,
    texto: string,
    final: boolean,
    voz: EvidenciaVoz,
  ): boolean {
    const decision = decidirRevision({
      tramoAbierto: { id: locucion.locutionId, texto: locucion.texto },
      tramoId: locucion.locutionId,
      texto,
      final: locucion.final || final,
    })
    const vozId = String(voz.vozId || '').trim()
    let continuidadVoz = locucion.continuidadVoz
    if (vozId && !String(locucion.voz.vozId || '').trim()) {
      continuidadVoz = vozId === ultimaVozId
    }
    if (vozId) ultimaVozId = vozId
    const siguiente: LocucionAbierta = {
      ...locucion,
      texto: decision.pintar ? decision.texto : locucion.texto,
      final: locucion.final || final,
      voz: fusionarVoz(locucion.voz, voz),
      continuidadVoz,
    }
    abierta = siguiente
    if (siguiente.texto !== locucion.texto) emitirCaja()
    return siguiente.final
  }

  /**
   * Cierra la locución abierta: una fila o un descarte contado (regla 4).
   * La caja se vacía solo aquí (regla 6).
   */
  async function cerrarLocucion(
    locucion: LocucionAbierta,
    motivo: MotivoCierre,
    causa: CausaCierre,
    final: boolean,
  ): Promise<void> {
    const sesion = sessionId ?? ''
    const tramo: TramoMuestreado = {
      inicio: locucion.inicio,
      fin: locucion.fin,
      sampleRate: locucion.sampleRate,
    }
    const cierre: CierreLocucion = {
      locutionId: locucion.locutionId,
      sessionId: sesion,
      turnId: locucion.turnId,
      inicio: locucion.inicio,
      fin: locucion.fin,
      sampleRate: locucion.sampleRate,
      texto: locucion.texto,
      idioma: locucion.idioma,
      overlap: Boolean(locucion.voz.overlap),
      final,
      reason: motivo,
      voz: resolverVoz(locucion.voz, locucion.continuidadVoz),
      etiquetaAnterior: ultimaEtiqueta || null,
      semillaEtiqueta: config.semillaEtiqueta(),
    }
    abierta = null
    emitirCaja()

    const resultado = construirFila(cierre)
    if (!resultado.fila) {
      emitir({
        tipo: 'locution.closed',
        sessionId: sesion,
        locutionId: locucion.locutionId,
        tramo,
        motivo,
        causa,
      })
      contarDescarte(resultado.descarte, locucion.locutionId, tramo)
      registro.registrar('conversacion.locucion.cerrada', {
        sessionId: sesion,
        locutionId: locucion.locutionId,
        tramo,
        motivo,
        causa,
        descarte: resultado.descarte,
      })
      return
    }

    const fila = await almacen.guardar(resultado.fila)
    filas.set(fila.locutionId, fila)
    ultimaEtiqueta = fila.etiqueta
    emitir({
      tipo: 'locution.closed',
      sessionId: sesion,
      locutionId: fila.locutionId,
      tramo,
      motivo,
      causa,
    })
    emitir({ tipo: 'row.committed', sessionId: sesion, fila })
    emitir({
      tipo: 'speaker.labeled',
      sessionId: sesion,
      locutionId: fila.locutionId,
      etiqueta: fila.etiqueta,
      evidencia: fila.evidencia,
    })
    registro.registrar('conversacion.locucion.cerrada', {
      sessionId: sesion,
      locutionId: fila.locutionId,
      tramo,
      motivo,
      causa,
      descarte: null,
    })
  }

  /** Si el tramo ya se cerró, promueve su fila; nunca abre una segunda. */
  async function promoverSiCorresponde(tramoId: string, texto: string): Promise<boolean> {
    const previa = filas.get(tramoId)
    if (!previa) return false
    const cambios = promoverFila(previa, texto)
    if (cambios) {
      const actualizada = await almacen.actualizar(tramoId, cambios)
      if (actualizada) {
        filas.set(tramoId, actualizada)
        ultimaEtiqueta = actualizada.etiqueta
        emitir({
          tipo: 'row.committed',
          sessionId: actualizada.sessionId,
          fila: actualizada,
        })
      }
    }
    return true
  }

  /** Retiene el texto de un tramo ajeno sin mezclarlo con la locución abierta. */
  function encolarPendiente(entrada: EntradaPendiente): void {
    const indice = pendientes.findIndex((pendiente) => pendiente.tramoId === entrada.tramoId)
    if (indice < 0) {
      pendientes = [...pendientes, entrada]
      return
    }
    const previa = pendientes[indice]
    const decision = decidirRevision({
      tramoAbierto: { id: previa.tramoId, texto: previa.texto },
      tramoId: entrada.tramoId,
      texto: entrada.texto,
      final: previa.final || entrada.final,
    })
    const siguiente: EntradaPendiente = {
      ...previa,
      texto: decision.pintar ? decision.texto : previa.texto,
      final: previa.final || entrada.final,
      idioma: entrada.idioma,
      turnId: entrada.turnId,
      voz: fusionarVoz(previa.voz, entrada.voz),
      tramo: previa.tramo ?? entrada.tramo,
    }
    pendientes = pendientes.map((pendiente, posicion) =>
      posicion === indice ? siguiente : pendiente,
    )
  }

  /** Descarta los huérfanos que superaron `orphanBufferMs` (contados). */
  function expurgarPendientes(): void {
    const ahora = reloj.ahora()
    const vigentes: EntradaPendiente[] = []
    for (const pendiente of pendientes) {
      if (ahora - pendiente.recibidoAt > configuracion.orphanBufferMs) {
        contarDescarte('huerfano', pendiente.tramoId, pendiente.tramo ?? null)
      } else {
        vigentes.push(pendiente)
      }
    }
    pendientes = vigentes
  }

  /** Abre los pendientes en orden mientras haya tramo; no duplica ni mezcla. */
  async function flushPendientes(motivo: MotivoCierre): Promise<void> {
    if (abierta) return
    expurgarPendientes()
    while (pendientes.length > 0) {
      const siguiente = pendientes[0]
      const tramo = siguiente.tramo ?? tramoDe(siguiente.tramoId)
      if (!tramo) break
      pendientes = pendientes.slice(1)
      abrirLocucion({
        tramoId: siguiente.tramoId,
        texto: siguiente.texto,
        tramo,
        turnId: siguiente.turnId,
        idioma: siguiente.idioma,
        voz: siguiente.voz,
      })
      if (!siguiente.final) break
      const locucion = abierta
      if (locucion) await cerrarLocucion(locucion, motivo, 'final', true)
    }
  }

  /** Al cerrar la sesión, cada pendiente acaba en fila o en descarte contado. */
  async function finalizarPendientes(motivo: MotivoCierre): Promise<void> {
    expurgarPendientes()
    while (pendientes.length > 0) {
      const siguiente = pendientes[0]
      pendientes = pendientes.slice(1)
      const tramo = siguiente.tramo ?? tramoDe(siguiente.tramoId)
      if (!tramo) {
        contarDescarte('huerfano', siguiente.tramoId, null)
        continue
      }
      if (abierta) {
        const previa = abierta
        await cerrarLocucion(previa, motivo, 'stop', false)
      }
      abrirLocucion({
        tramoId: siguiente.tramoId,
        texto: siguiente.texto,
        tramo,
        turnId: siguiente.turnId,
        idioma: siguiente.idioma,
        voz: siguiente.voz,
      })
      const locucion = abierta
      if (locucion) await cerrarLocucion(locucion, motivo, 'stop', siguiente.final)
    }
  }

  /** Idioma de la locución: la nube queda fija al arrancar; local autodetecta. */
  function idiomaDe(entrada: AsrIngestado): IdiomaLocucion {
    if (motorAsr === 'cloud') return idiomaActual
    return entrada.idioma ?? idiomaActual
  }

  /** Procesa un resultado ya identificado por tramo (cola ordenada). */
  async function procesarResultadoAsr(entrada: AsrIngestado): Promise<void> {
    const sesion = exigirActiva()
    const tramoId = String(entrada.tramoId || '').trim()
    if (!tramoId) {
      contarDescarte('huerfano', null, null)
      return
    }

    const texto = String(entrada.texto || '')

    const dicho = String(ultimoTextoDicho() || '').trim()
    if (dicho) {
      if (esEcoDeTts(texto, dicho)) {
        contarDescarte('eco', tramoId, null)
        return
      }
      emitir({
        tipo: 'barge.in',
        sessionId: sesion,
        locutionId: abierta?.locutionId ?? tramoId,
        texto,
      })
    }

    if (await promoverSiCorresponde(tramoId, texto)) return

    const idioma = idiomaDe(entrada)
    const voz = entrada.voz ?? {}
    const turnId = entrada.turnId ? String(entrada.turnId).trim() : turnoActual
    if (entrada.turnId) turnoActual = turnId

    if (!abierta) await flushPendientes('system')

    if (abierta && abierta.locutionId === tramoId) {
      const completa = aplicarRevision(abierta, texto, Boolean(entrada.final), voz)
      if (completa) {
        const locucion = abierta
        await cerrarLocucion(locucion, 'system', 'final', true)
        await flushPendientes('system')
        return
      }
      const frontera = decidirFrontera({
        medida: ultimaMedida,
        textoAjeno: false,
        abierta: true,
      })
      if (frontera.cerrar) {
        const locucion = abierta
        await cerrarLocucion(locucion, 'system', 'silencio', false)
        await flushPendientes('system')
      }
      return
    }

    if (abierta) {
      encolarPendiente({
        tramoId,
        texto,
        final: Boolean(entrada.final),
        idioma,
        turnId,
        voz,
        tramo: entrada.tramo,
        recibidoAt: reloj.ahora(),
      })
      const registrado = tramoRegistrado(tramoId)
      const silencioPrevioMs = registrado?.silencioPrevioMs ?? ultimaMedida.silencioMs
      const frontera = decidirFrontera({
        medida: { hayVoz: false, silencioMs: silencioPrevioMs },
        textoAjeno: true,
        abierta: true,
      })
      if (frontera.cerrar) {
        const locucion = abierta
        await cerrarLocucion(locucion, 'system', 'frontera', false)
        await flushPendientes('system')
      }
      return
    }

    const tramo = tramoDe(tramoId, entrada.tramo)
    if (!tramo) {
      encolarPendiente({
        tramoId,
        texto,
        final: Boolean(entrada.final),
        idioma,
        turnId,
        voz,
        tramo: entrada.tramo,
        recibidoAt: reloj.ahora(),
      })
      return
    }
    abrirLocucion({ tramoId, texto, tramo, turnId, idioma, voz })
    if (entrada.final) {
      const locucion = abierta
      if (locucion) await cerrarLocucion(locucion, 'system', 'final', true)
      await flushPendientes('system')
    }
  }

  /** Drena los resultados del `AsrPort` en orden; el tramo se fija al drenar. */
  async function drenarResultadosAsr(): Promise<void> {
    const pendientesDeDrenar = resultadosAsr
    resultadosAsr = []
    for (const crudo of pendientesDeDrenar) {
      const tramoId =
        crudo.tramoId || tramoAudio?.tramoId || abierta?.locutionId || ''
      await procesarResultadoAsr({ ...crudo, tramoId })
    }
  }

  /** Cierra lo abierto si el ASR avisó de un estado terminal (watchdog/error). */
  async function cerrarPendienteAsr(): Promise<void> {
    if (!cierreAsrPendiente) return
    const motivo = cierreAsrPendiente
    cierreAsrPendiente = null
    if (abierta) {
      const locucion = abierta
      await cerrarLocucion(locucion, motivo, 'asr', false)
    }
    await flushPendientes(motivo)
  }

  /** Abre la sesión y, si hay ASR, lo arranca con un solo motor. */
  async function iniciar(opciones?: OpcionesInicio): Promise<InstantaneaConversacion> {
    if (activa) throw new Error('conversacion ya iniciada: stop antes de start')
    sessionId = id.uuid()
    turnoActual = opciones?.turnId ? String(opciones.turnId).trim() : id.uuid()
    idiomaActual = opciones?.idioma ?? configuracion.asr.lang
    abierta = null
    tramoAudio = null
    ultimaMedida = { hayVoz: false, silencioMs: 0 }
    silencioPendienteMs = 0
    ultimaEtiqueta = ''
    ultimaVozId = ''
    cierreAsrPendiente = null
    descartes = []
    pendientes = []
    resultadosAsr = []
    tramos.clear()
    nombresPorVoz.clear()
    estadoAsr = 'idle'
    motorAsr = null

    if (asr) {
      const motor = elegirMotor(asr, configuracion)
      if (!motor) {
        estadoAsr = 'no-permission'
        emitir({
          tipo: 'asr.status',
          sessionId,
          estado: estadoAsr,
          detalle: 'sin motor disponible',
        })
        registro.registrar('conversacion.asr.no-permission', { sessionId })
      } else {
        motorAsr = motor
        estadoAsr = 'starting'
        emitir({ tipo: 'asr.status', sessionId, estado: estadoAsr })
        const opcionesAsr: OpcionesAsr = {
          idioma: idiomaActual,
          motor,
          alResultado: (resultado) => {
            resultadosAsr = [
              ...resultadosAsr,
              {
                ...resultado,
                tramoId: tramoAudio?.tramoId ?? abierta?.locutionId ?? '',
              },
            ]
          },
          alEstado: (estado, detalle) => {
            estadoAsr = estado
            if (sessionId) {
              emitir({
                tipo: 'asr.status',
                sessionId,
                estado,
                ...(detalle ? { detalle } : {}),
              })
            }
            if (estado === 'watchdog') cierreAsrPendiente = 'watchdog'
            if (estado === 'error' || estado === 'aborted') cierreAsrPendiente = 'system'
          },
        }
        const inicial = await asr.iniciar(opcionesAsr)
        if (inicial !== estadoAsr) {
          estadoAsr = inicial
          emitir({ tipo: 'asr.status', sessionId, estado: inicial })
        }
        if (motor === 'cloud') {
          registro.registrar('conversacion.asr.cloud.audio.sale', {
            sessionId,
            detalle: 'El motor de nube procesa el audio fuera del equipo',
          })
        }
      }
    }

    activa = true
    await drenarResultadosAsr()
    return snapshot()
  }

  /** Ingesta un bloque de audio: mide, corta el tramo y evalúa la frontera. */
  async function ingestaAudio(bloque: BloqueAudio): Promise<InstantaneaConversacion> {
    exigirActiva()
    await drenarResultadosAsr()
    await cerrarPendienteAsr()

    const sampleRate = Number(bloque.sampleRate)
    const inicio = Number(bloque.inicio)
    const fin =
      bloque.fin === undefined ? inicio + bloque.muestras.length : Number(bloque.fin)
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error(`sampleRate invalido: ${bloque.sampleRate}`)
    }
    if (!Number.isFinite(inicio) || inicio < 0) {
      throw new Error(`indice de muestra invalido: ${bloque.inicio}`)
    }
    if (!Number.isFinite(fin) || fin <= inicio) {
      throw new Error(`tramo de audio invalido: [${inicio}, ${fin}]`)
    }
    if (tramoAudio && tramoAudio.sampleRate !== sampleRate) {
      throw new Error(
        `sampleRate inconsistente en el tramo ${tramoAudio.tramoId}: ${tramoAudio.sampleRate} != ${sampleRate}`,
      )
    }
    if (bloque.turnId) turnoActual = String(bloque.turnId).trim()

    const medida = bloque.medida ?? (vad ? vad.medir(bloque.muestras, sampleRate) : null)
    if (!medida) throw new Error('falta medida VAD: sin medida no hay frontera')
    ultimaMedida = medida

    if (!tramoAudio) {
      if (medida.hayVoz) {
        const tramoId = id.uuid()
        const nuevo: TramoAudio = {
          tramoId,
          inicio,
          fin,
          sampleRate,
          turnId: turnoActual,
          silencioPrevioMs: silencioPendienteMs,
        }
        silencioPendienteMs = 0
        tramoAudio = nuevo
        registrarTramo(nuevo)
        if (!abierta) {
          abrirLocucion({
            tramoId,
            texto: '',
            tramo: { inicio, fin, sampleRate },
            turnId: turnoActual,
            idioma: idiomaActual,
            voz: {},
          })
        }
        if (asr && asrEmpujaAudio(motorAsr)) asr.empujarAudio(bloque.muestras, sampleRate)
      }
    } else {
      const finPrevio = tramoAudio.fin
      const actualizado: TramoAudio = {
        ...tramoAudio,
        fin: Math.max(tramoAudio.fin, fin),
      }
      tramoAudio = actualizado
      registrarTramo(actualizado)
      if (abierta && abierta.locutionId === actualizado.tramoId) {
        abierta = { ...abierta, fin: actualizado.fin }
      }
      if (asr && asrEmpujaAudio(motorAsr)) asr.empujarAudio(bloque.muestras, sampleRate)
      if (!medida.hayVoz && medida.silencioMs >= configuracion.minSilenceMs) {
        const candidato = actualizado.fin - Math.round((medida.silencioMs * sampleRate) / 1000)
        const finHabla = candidato > actualizado.inicio ? candidato : finPrevio
        const cortado: TramoAudio = { ...actualizado, fin: finHabla }
        registrarTramo(cortado)
        if (abierta && abierta.locutionId === cortado.tramoId) {
          abierta = { ...abierta, fin: cortado.fin }
        }
        silencioPendienteMs = medida.silencioMs
        tramoAudio = null
      }
    }

    if (abierta) {
      const frontera = decidirFrontera({
        medida,
        textoAjeno: false,
        abierta: true,
      })
      if (frontera.cerrar) {
        const locucion = abierta
        await cerrarLocucion(locucion, 'system', 'silencio', false)
        await flushPendientes('system')
      }
    }
    return snapshot()
  }

  /** Ingesta un resultado del ASR por su tramo (regla 3). */
  async function ingestaAsr(entrada: AsrIngestado): Promise<InstantaneaConversacion> {
    exigirActiva()
    const tramoId = String(entrada.tramoId || '').trim()
    if (!tramoId) throw new Error('tramoId vacio: sin tramo no hay locucion')
    await drenarResultadosAsr()
    await cerrarPendienteAsr()
    await procesarResultadoAsr({ ...entrada, tramoId })
    return snapshot()
  }

  /** Cierra la sesión con el motivo declarado; jamás pierde el texto abierto. */
  async function detener(stopKind: MotivoCierre): Promise<InstantaneaConversacion> {
    const sesion = exigirActiva()
    if (stopKind !== 'user' && stopKind !== 'system' && stopKind !== 'watchdog') {
      throw new Error(`stop(${String(stopKind)}) no es un motivo de fila`)
    }
    await drenarResultadosAsr()
    cierreAsrPendiente = null
    if (abierta) {
      const locucion = abierta
      await cerrarLocucion(locucion, stopKind, 'stop', false)
    }
    await finalizarPendientes(stopKind)
    if (asr && motorAsr) asr.detener()
    tramoAudio = null
    ultimaMedida = { hayVoz: false, silencioMs: 0 }
    silencioPendienteMs = 0
    estadoAsr = 'idle'
    emitir({ tipo: 'asr.status', sessionId: sesion, estado: estadoAsr })
    activa = false
    return snapshot()
  }

  /** Bautiza únicamente la voz que dijo `ok flu soy XXX`. */
  function registrarNombre(datos: DatosNombre): InstantaneaConversacion {
    const sesion = exigirActiva()
    const nombre = String(datos.nombre || '').trim()
    if (!nombre) throw new Error('nombre vacio: no se bautiza una voz sin nombre')
    if (nombre === '?') throw new Error('nombre ? prohibido')
    const vozId = String(datos.vozId || abierta?.voz.vozId || '').trim()
    if (!vozId) {
      throw new Error('sin voz identificada: no se bautiza una voz que no hablo')
    }
    nombresPorVoz.set(vozId, nombre)
    if (abierta && abierta.voz.vozId === vozId) {
      abierta = {
        ...abierta,
        voz: { ...abierta.voz, nombre, nombreConfirmado: true },
      }
    } else if (abierta && !abierta.voz.vozId && datos.vozId) {
      abierta = { ...abierta, voz: { ...abierta.voz, vozId } }
    }
    emitir({
      tipo: 'speaker.labeled',
      sessionId: sesion,
      locutionId: abierta?.locutionId ?? '',
      etiqueta: nombre,
      evidencia: 'nombre',
    })
    registro.registrar('conversacion.voz.bautizada', {
      sessionId: sesion,
      vozId,
      nombre,
      locutionId: abierta?.locutionId ?? null,
    })
    return snapshot()
  }

  /** Suscribe a los eventos; el oyente que lanza propaga su error al llamador. */
  function suscribir(oyente: (evento: EventoConversacion) => void): () => void {
    oyentes.add(oyente)
    return () => {
      oyentes.delete(oyente)
    }
  }

  return {
    start: (opciones) => serializar(() => iniciar(opciones)),
    stop: (stopKind) => serializar(() => detener(stopKind)),
    ingestAudio: (bloque) => serializar(() => ingestaAudio(bloque)),
    ingestAsr: (resultado) => serializar(() => ingestaAsr(resultado)),
    snapshot,
    subscribe: suscribir,
    registerName: registrarNombre,
  }
}

export { decidirRevision }
export type { DecisionRevision, TramoAbierto } from './revision.ts'
export { decidirFrontera }
export type {
  CausaFrontera,
  DecisionFrontera,
  EntradaFrontera,
  UmbralesFrontera,
} from './frontera.ts'
export { construirFila, promoverFila }
export { resolverEtiqueta } from './fila.ts'
export type {
  CierreLocucion,
  EntradaEtiqueta,
  EtiquetaResuelta,
  MotivoDescarte,
  ResultadoFila,
  VozEtiqueta,
} from './fila.ts'
export { CONVERSACION_CONFIG, motorConversacionActivo } from './ports.ts'
export {
  crearAlmacenMemoria,
  crearConfigFlu,
  crearIdUuid,
  crearPartidorWake,
  crearRegistroCaughtError,
  crearRelojSistema,
} from './adapters.ts'
