/**
 * PUNTO DE COMPOSICIÓN del motor CONVERSACIÓN para el producto.
 *
 * Aquí se unen los adaptadores reales (Dexie, reloj, ids, config, wake, VAD) con
 * el motor y se expone el ciclo de escucha que consume el hook. El adaptador de
 * ASR no se usa en esta composición: el hook ya posee LA instancia de escucha y
 * entrega sus resultados por `evento()` (AGENTS, Anexo B invariante 1).
 *
 * IDENTIDAD DEL SEGMENTO (dueño único: el VAD del módulo). El tramo de audio que
 * abre `ingestaAudio` es el id de la locución; el texto del reconocedor NO trae
 * tramo y lo resuelve el módulo DENTRO de su cola, cuando el audio ya está
 * procesado. Atribuirlo aquí con una foto del estado podía ir un bloque por
 * detrás y pegaba el texto a la locución anterior (defecto medido en el
 * playback del 2026-10-25: tramos fabricados `[0, cursor]` y filas de 119–152 s).
 *
 * Un `final` del reconocedor MARCA la frase completa (Caso 7+6) pero NO cierra
 * la locución: el cierre por contenido llega con el corte del tramo (ingesta) o
 * con el fin de la sesión (`cerrar`). Un final con la ventana FUERA del tramo
 * cerrado no marca nada; sin final, el cierre por silencio queda provisional.
 * Así una locución = un tramo = una fila, y no se escribe una fila por cada
 * corte de Chrome.
 *
 * TEXTO ACUMULADO DEL TRAMO. El módulo recibe el texto de la locución COMPLETO en
 * cada ingesta (`revision.ts` decide crecer/revisar/mantener), pero el reconocedor
 * entrega FRAGMENTOS: re-emite delante el final retenido del enunciado anterior,
 * manda prefijo re-plegado + cola que crece y puede re-escuchar el mismo tramo dos
 * veces (medido 8f3112c2: patrones `10`/`11` y `"bien"` + `" vamos"`). Este límite
 * compone la HIPÓTESIS COMPLETA de cada evento con `composicion.ts` (desde 0 o,
 * si ya hay filas commiteadas, desde la FRONTERA que estas cubrieron: la
 * re-emisión retenida no se vuelve a entregar) y la entrega al módulo, en UNA
 * cadena serializada: el módulo decide la pertenencia y la revisión; el límite no
 * pega deltas de eventos anteriores.
 */
import {
  crearAlmacenDexieProducto,
  crearConfigFlu,
  crearEmbebedorProducto,
  crearIdUuid,
  crearMedidorTramo,
  crearPartidorWake,
  crearRegistroCaughtError,
  crearRelojSistema,
  crearVadProducto,
  ejecutarRegistrando,
  fusionarEnLineaAbierta,
  registrarFallo,
} from './adapters.ts'
import {
  avanzarFrontera,
  componerEvento,
  FRONTERA_INICIAL,
} from './composicion.ts'
import type { EventoComposicion, FronteraComposicion } from './composicion.ts'
import { crearConversacion } from './motor.ts'
import { perteneceALineaAbierta } from './fusion.ts'
import { CONVERSACION_CONFIG } from './ports.ts'
import type { IdiomaLocucion, MotivoCierre } from './ports.ts'
import type {
  ConversacionApi,
  EventoConversacion,
  InstantaneaConversacion,
} from './tipos.ts'

/** Evento real de ASR con el índice del primer resultado nuevo. */
export type EventoProducto = EventoComposicion

/** Libro del último trozo pegado a la línea abierta (regla: `speechMerge`). */
type LibroDeLinea = Readonly<{ base: string; chunk: string; line: string }>

/** Ciclo del motor: `cerrando` solo mientras la cadena ejecuta el cierre. */
type EstadoMotorProducto = 'inactiva' | 'activa' | 'cerrando'

/**
 * Muestras que se acumulan antes de entrar a la cola única del motor.
 *
 * El AudioWorklet entrega bloques de 128 muestras (~2,7 ms a 48 kHz): encolar
 * cada uno hacía 375 tareas/s y, con la retención de la locución, copias
 * repetidas de miles de bloques. Esa carga retrasaba el texto del ASR y el
 * cierre por silencio (medido en el log del dueño 2026-11-11: el cierre tardó
 * decenas de segundos mientras el hilo principal procesaba el atraso).
 * 2048 muestras son ~43 ms a 48 kHz y ~128 ms a 16 kHz: resolución de sobra
 * para el VAD y la frontera, con 16 veces menos tareas.
 */
const MUESTRAS_POR_BLOQUE_DE_TRABAJO = 2048

/** Controlador que el producto usa en el ciclo real de escucha. */
export type MotorConversacionProducto = Readonly<{
  /** Abre la sesión del motor la primera vez del ciclo de escucha. */
  abrir(): void
  /** Ingesta los resultados reales del reconocedor; resuelve tras persistir. */
  evento(evento: EventoProducto): Promise<void>
  /** Ingesta el bloque PCM real con su frecuencia y su índice de muestra. */
  audio(muestras: Float32Array, sampleRate: number, inicioMuestras?: number): void
  /** Suscribe a los 6 eventos del módulo; devuelve la baja. */
  suscribir(oyente: (evento: EventoConversacion) => void): () => void
  /** Instantánea síncrona de la caja y las filas de la sesión. */
  instantanea(): InstantaneaConversacion
  /** Bautiza la voz de la locución del comando (problema 5: «ok flu soy X»).
   * `etiqueta` es el WHERE del renombrado cuando la fila ya cerró. */
  registrarNombre(nombre: string, etiqueta?: string, locucionId?: string): void
  /**
   * Cierra la sesión con el motivo real del cierre.
   * @param motivo Motivo del cierre.
   * @returns Promesa que resuelve cuando el motor terminó de persistir.
   */
  cerrar(motivo: MotivoCierre): Promise<void>
}>

/**
 * Compone el motor NUEVO para el producto con los adaptadores REALES.
 * Es el único punto que crea la sesión desde el hook: almacén Dexie, reloj,
 * ids, embeddings (worker único) y la configuración del plan; el eco se delega
 * a `ultimoTextoDicho`. La IDENTIDAD la mide el módulo por sí mismo
 * (`EmbebedorPort`, decisión del dueño Paso 5-A): el producto no recibe
 * evidencia de voz externa.
 * @param opciones Idioma activo, último texto de FLU, participante dueño de
 *   las filas, grabación activa y anclas medidas de la base; el turno lo acuña
 *   el módulo.
 * @returns Controlador de apertura, ingesta y cierre.
 */
export function crearMotorConversacionProducto({
  idioma,
  ultimoTextoDicho,
  participantId,
  recordingId,
  anclasBase,
}: {
  idioma: IdiomaLocucion
  ultimoTextoDicho: () => string
  /** Participante activo: aísla las filas del motor por usuario. */
  participantId?: string
  /**
   * Id de la grabación activa (recorder, Caso 11), leído al ABRIR: la sesión
   * ADOPTA ese id y todos sus commits/eventos lo llevan (nunca dos). Vacío o
   * sin proveedor => el módulo acuña el propio (N/A sin recorder al iniciar).
   */
  recordingId?: () => string | null
  /** Anclas medidas de la base (solo lectura): vector conocido → nombre propio. */
  anclasBase?: () => ReadonlyArray<{ name?: string; vector?: readonly number[] }>
}): MotorConversacionProducto {
  const reloj = crearRelojSistema()
  const id = crearIdUuid()
  const config = crearConfigFlu()
  const registro = crearRegistroCaughtError()
  const api: ConversacionApi = crearConversacion({
    reloj,
    id,
    registro,
    almacen: crearAlmacenDexieProducto({ reloj, participantId }),
    config,
    partidor: crearPartidorWake(config),
    vad: crearVadProducto(),
    medidor: crearMedidorTramo(),
    ultimoTextoDicho,
    embebedor: crearEmbebedorProducto(),
    anclasBase,
  })
  let estadoMotor: EstadoMotorProducto = 'inactiva'
  /** Promesa del cierre en curso: `cerrar()` es idempotente y esperable. */
  let cierreEnCurso: Promise<void> | null = null
  let cursorMuestras = 0
  /** Libro del último hueco de la frase NUEVA pegada a la línea abierta. */
  let libroDeLinea: LibroDeLinea | null = null
  /** Locución dueña del libro: si cambia, el libro no describe su texto. */
  let locucionDelLibro = ''
  /**
   * Cadena del límite: cada paso lee la instantánea DESPUÉS de que el paso anterior
   * terminó. Sin ella, un evento compuesto antes de que el módulo procesara el audio
   * pendiente pegaba su texto a la locución anterior (medido en el playback del
   * 2026-10-25: tramos fabricados y filas de 119–152 s).
   */
  let cadena: Promise<void> = Promise.resolve()
  /** Bloques PCM recibidos y todavía no encolados (se agrupan). */
  let audioPendiente: Float32Array[] = []
  let muestrasPendientes = 0
  let inicioPendiente = -1
  let finPendiente = -1
  let sampleRatePendiente = 0
  /**
   * FRONTERA del reconocedor: índices de resultados YA cubiertos por una fila
   * commiteada. Chrome ACUMULA los resultados de su instancia y re-emite delante
   * el final retenido al arrancar el enunciado siguiente (patrones 10/11);
   * compuesto desde 0, ese final viajaba dentro de la frase nueva («después que
   * cierro la escucha escribe cosas que ya había escrito antes», dueño
   * 2026-11-12). El motor local REEMPLAZA el array en cada segmento (longitud
   * 1), así que `total` nunca supera la frontera y su composición queda intacta.
   * Esto NO es un dedupe por texto (D11: la repetición legítima tras pausa
   * conserva su fila): es una marca de transporte por índice cuyo dueño es
   * `composicion.ts`.
   */
  let frontera: FronteraComposicion = FRONTERA_INICIAL
  // La frontera avanza cuando una fila commitea: lo que sostuvo su texto ya
  // está escrito y no se re-compone. Cubre también el commit del stop.
  api.subscribe((evento) => {
    if (evento.tipo !== 'row.committed') return
    frontera = avanzarFrontera(frontera)
  })

  /**
   * Encola un paso del límite y registra su fallo sin romper la cadena.
   * @param tarea Paso que lee y escribe el estado del límite.
   * @returns Promesa del paso (resuelve siempre).
   */
  function encadenar(tarea: () => Promise<unknown> | unknown): Promise<void> {
    const correr = (): Promise<void> =>
      ejecutarRegistrando('conversacion.producto.cadena.error', tarea)
    const siguiente = cadena.then(correr, correr)
    cadena = siguiente
    return siguiente
  }

  /**
   * Descarta el acumulador de PCM (sin encolarlo).
   * @revisor CREAR NUEVO — el límite del producto acumula bloques de audio para
   *   no encolar 375 tareas/s; ningún dueño existente agrupa PCM del motor.
   */
  function descartarAudioPendiente(): void {
    audioPendiente = []
    muestrasPendientes = 0
    inicioPendiente = -1
    finPendiente = -1
    sampleRatePendiente = 0
  }

  /**
   * Encola el PCM acumulado como UN bloque con su ventana real.
   *
   * La cola del motor procesa audio y texto en orden: agrupar conserva el orden
   * (el bloque se encola antes que el evento del ASR que lo sigue) y el índice
   * de muestra de sus extremos, que es lo que usan el VAD y la fila.
   * @revisor CREAR NUEVO — el volcado del acumulador es del límite del producto;
   *   `api.ingestAudio` sigue siendo el único que procesa el bloque.
   */
  function encolarAudioPendiente(): void {
    if (muestrasPendientes <= 0 || inicioPendiente < 0) return
    const datos = new Float32Array(muestrasPendientes)
    let offset = 0
    for (const bloque of audioPendiente) {
      datos.set(bloque, offset)
      offset += bloque.length
    }
    const inicio = inicioPendiente
    const fin = finPendiente
    const frecuencia = sampleRatePendiente
    descartarAudioPendiente()
    void encadenar(() => {
      if (estadoMotor !== 'activa') return undefined
      return registrarFallo(
        'conversacion.producto.audio.error',
        api.ingestAudio({ muestras: datos, sampleRate: frecuencia, inicio, fin }),
      )
    })
  }

  /**
   * Acumula un bloque PCM y lo encola al alcanzar el tamaño de trabajo.
   *
   * Un hueco de índices o un cambio de frecuencia fuerza el volcado previo: la
   * ventana `[inicio, fin]` que recibe el motor no puede mentir sobre el audio.
   * @param muestras PCM del bloque.
   * @param frecuencia Frecuencia del bloque.
   * @param inicio Índice de su primera muestra.
   * @revisor CREAR NUEVO — el producto necesita un acumulador propio para
   *   entregar bloques de trabajo; no reimplementa VAD, tramo ni fila.
   */
  function acumularAudio(
    muestras: Float32Array,
    frecuencia: number,
    inicio: number,
  ): void {
    const contiguo = finPendiente < 0 || inicio === finPendiente
    if (muestrasPendientes > 0 && (!contiguo || frecuencia !== sampleRatePendiente)) {
      encolarAudioPendiente()
    }
    if (inicioPendiente < 0) {
      inicioPendiente = inicio
      sampleRatePendiente = frecuencia
    }
    audioPendiente.push(muestras)
    muestrasPendientes += muestras.length
    finPendiente = inicio + muestras.length
    if (muestrasPendientes >= MUESTRAS_POR_BLOQUE_DE_TRABAJO) encolarAudioPendiente()
  }

  return {
    abrir: () => {
      libroDeLinea = null
      locucionDelLibro = ''
      if (estadoMotor !== 'inactiva') return
      descartarAudioPendiente()
      cierreEnCurso = null
      estadoMotor = 'activa'
      cursorMuestras = 0
      // Caso 11: la conversación ADOPTA el id de la grabación activa al abrir la
      // sesión; sin grabación (proveedor vacío) el módulo acuña el propio (N/A).
      const grabacion = String(recordingId?.() ?? '').trim()
      void encadenar(() =>
        registrarFallo(
          'conversacion.producto.start.error',
          api.start({
            idioma,
            ...(grabacion ? { sessionId: grabacion } : {}),
          }),
        ),
      )
    },

    evento: (evento) => {
      // Cierre ya pedido: NO se encola nada más. El estado se marca de forma
      // síncrona en `cerrar()`, así una ráfaga del ASR posterior al stop no
      // sigue escribiendo desde la memoria del motor.
      if (estadoMotor !== 'activa') return Promise.resolve()
      // El texto se aplica DESPUÉS del audio que ya sonó: el bloque acumulado
      // entra en la cadena antes que el evento (regla 2: primero texto, pero con
      // el audio ya procesado para que el tramo sea el suyo).
      encolarAudioPendiente()
      return encadenar(async () => {
        if (estadoMotor !== 'activa') return
        const instantanea = api.snapshot()
        const abierta = instantanea.locucionAbierta
        // El FINAL es la HIPÓTESIS COMPLETA del tramo: sustituye la línea
        // acumulada, no se concatena. `composicion.ts` la compone desde la
        // FRONTERA ya cubierta por filas commiteadas (0 si no hay): la
        // re-emisión retenida del enunciado anterior no se vuelve a entregar.
        // Los interinos siguen usando `resultIndex` (solo los resultados
        // NUEVOS), nunca por debajo de la frontera.
        const compuesta = componerEvento(evento, frontera)
        frontera = compuesta.frontera
        const trozo = compuesta.trozo
        const hayFinal = compuesta.hayFinal
        if (!trozo) return
        const laContinua =
          abierta !== null &&
          perteneceALineaAbierta({
            locucionId: abierta.locutionId,
            textoAbierto: abierta.texto,
            trozo,
            tramoVigente: instantanea.tramoAudio ?? null,
            silenceCloseMs: CONVERSACION_CONFIG.silenceCloseMs,
          })
        const clave = laContinua && abierta ? abierta.locutionId : ''
        if (clave !== locucionDelLibro) {
          libroDeLinea = null
          locucionDelLibro = clave
        }
        const lineaPrevia = !hayFinal && laContinua && abierta ? abierta.texto : ''
        const fusion = hayFinal
          ? { linea: trozo, libro: null }
          : fusionarEnLineaAbierta(lineaPrevia, libroDeLinea, trozo)
        libroDeLinea = hayFinal ? null : fusion.libro
        if (!fusion.linea) return
        if (!hayFinal && fusion.linea === lineaPrevia) return
        const metrics = evento.metrics
        await registrarFallo(
          'conversacion.producto.ingest.error',
          api.ingestAsr({
            // El tramo lo resuelve el módulo dentro de su cola, con el audio ya
            // procesado. Aquí no se fabrica un `[0, cursor]`: esa foto podía ir un
            // bloque por detrás y atribuía el texto a la locución anterior.
            tramoId: '',
            texto: fusion.linea,
            // Caso 7+6: el final NO cierra la locución: marca la frase completa;
            // el cierre por contenido llega con el corte o con `cerrar()`.
            final: hayFinal,
            idioma,
            // Medida del BLOQUE actual: el silencio medido antes del tramo
            // vigente. La frontera no relee una medida acumulada.
            silencioPrevioMs: instantanea.tramoAudio?.silencioPrevioMs ?? 0,
            ...(metrics
              ? { medida: { speechLikeMs: metrics.speechLikeMs, rms: metrics.rms } }
              : {}),
          }),
        )
      })
    },

    /**
     * Ingesta PCM agrupado en bloques de trabajo y conserva el orden de la cola.
     * @param muestras PCM del bloque recibido.
     * @param frecuencia Frecuencia del bloque.
     * @param inicioMuestras Índice absoluto de su primera muestra.
     * @revisor EXTENDER — agrupa PCM del límite para no encolar cientos de
     *   tareas por segundo; el contrato con `api.ingestAudio` no cambia.
     */
    audio: (muestras, frecuencia, inicioMuestras) => {
      if (estadoMotor !== 'activa' || !muestras || muestras.length === 0) return
      const inicio =
        Number.isFinite(Number(inicioMuestras)) && Number(inicioMuestras) >= 0
          ? Number(inicioMuestras)
          : cursorMuestras
      const fin = inicio + muestras.length
      cursorMuestras = Math.max(cursorMuestras, fin)
      // El audio entra en la MISMA cadena que el texto: así el evento siguiente
      // compone sobre una instantánea que ya incluye estos bloques.
      acumularAudio(muestras, frecuencia, inicio)
    },

    /**
     * Suscribe un oyente a los eventos del motor.
     * @revisor EXTENDER — el objeto del límite se recompone; el contrato de
     *   suscripción es el mismo del motor.
     */
    suscribir: (oyente) => api.subscribe(oyente),

    /**
     * Instantánea síncrona de la caja y las filas de la sesión.
     * @revisor EXTENDER — el objeto del límite se recompone; la instantánea
     *   sigue siendo la del motor.
     */
    instantanea: () => api.snapshot(),

    /**
     * Bautiza la voz de la locución del comando.
     * @param nombre Nombre confirmado.
     * @param etiqueta Etiqueta que usaba esa voz (WHERE del renombrado).
     * @param locucionId Locución que pronunció el nombre.
     * @revisor EXTENDER — el objeto del límite se recompone; la delegación al
     *   único dueño (`api.registerName`) no cambia.
     */
    registrarNombre: (nombre, etiqueta, locucionId) => {
      if (estadoMotor !== 'activa') return
      // El nombre entra en la MISMA cadena que el audio y el texto: la locución
      // del comando sigue abierta cuando se aplica (medida de respaldo al cerrar).
      // `etiqueta` es el WHERE del renombrado cuando la fila ya cerró; `locucionId`
      // acota el caso sin vector a la fila que pronunció el nombre.
      void encadenar(() =>
        api.registerName({
          nombre,
          ...(etiqueta ? { etiqueta } : {}),
          ...(locucionId ? { locucionId } : {}),
        }),
      )
    },

    /**
     * Cierra la sesión y devuelve la promesa del cierre completo.
     *
     * El consumidor espera esta promesa para vaciar la caja DESPUÉS de que los
     * pendientes con texto ya se commitearon: antes la caja se vaciaba al
     * instante y la última frase visible desaparecía aunque su fila llegara
     * después.
     * @param motivo Motivo real del cierre.
     * @returns Promesa que resuelve cuando el motor terminó de persistir.
     * @revisor EXTENDER — el cierre ya existía; ahora expone su promesa para
     *   ordenar el vaciado de la caja con los commits pendientes.
     */
    cerrar: (motivo) => {
      if (estadoMotor === 'inactiva') return Promise.resolve()
      if (estadoMotor === 'cerrando') return cierreEnCurso ?? Promise.resolve()
      // CORTE SÍNCRONO: desde esta misma línea `evento()` y `audio()` rechazan
      // trabajo nuevo. El backlog que ya estaba en la cola se descarta al
      // ejecutarse (comprueban el estado) y el cierre corre como última tarea.
      // Antes el estado seguía en 'activa' hasta el final de la cola: por eso
      // el motor seguía transcribiendo audio de memoria 42 s después del stop.
      estadoMotor = 'cerrando'
      descartarAudioPendiente()
      cierreEnCurso = encadenar(async () => {
        try {
          // Cierre REAL: la locución abierta se declara final con SU texto ya
          // compuesto (nunca con la última reentrega, que puede ser solo la cola)
          // y recién entonces se detiene la sesión. Una sola fila por segmento.
          const abierta = api.snapshot().locucionAbierta
          if (abierta && String(abierta.texto || '').trim()) {
            await registrarFallo(
              'conversacion.producto.final.error',
              api.ingestAsr({
                tramoId: abierta.locutionId,
                texto: abierta.texto,
                final: true,
                idioma,
                tramo: abierta.tramo,
              }),
            )
          }
          await registrarFallo('conversacion.producto.stop.error', api.stop(motivo))
        } finally {
          estadoMotor = 'inactiva'
          cierreEnCurso = null
          libroDeLinea = null
          locucionDelLibro = ''
        }
      })
      return cierreEnCurso
    },
  }
}
