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
 * compone el trozo de cada evento (`componerFraseDelEvento`) y lo integra en la
 * línea con el libro de su último hueco (`fusionarEnLineaAbierta`, dueño único en
 * `speechMerge`), en UNA cadena serializada: cada evento se compone sobre la
 * instantánea que ya incluye el audio anterior, nunca sobre una foto atrasada.
 */
import {
  componerFraseDelEvento,
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
import { crearConversacion } from './motor.ts'
import type { IdiomaLocucion, MotivoCierre } from './ports.ts'
import type {
  ConversacionApi,
  EventoConversacion,
  InstantaneaConversacion,
} from './tipos.ts'

/** Alternativa de transcripción de un resultado del reconocedor. */
type AlternativaProducto = Readonly<{ transcript?: string }>

/** Resultado del reconocedor (la nube y el motor local comparten esta forma). */
type ResultadoProducto = ArrayLike<AlternativaProducto> &
  Readonly<{ isFinal?: boolean }>

/** Evento real de ASR con el índice del primer resultado nuevo. */
export type EventoProducto = Readonly<{
  results?: ArrayLike<ResultadoProducto>
  resultIndex?: number
  /** Métricas acústicas del evento (el hook ya las manda con esta forma). */
  metrics?: Readonly<{ durationMs?: number; speechLikeMs?: number; rms?: number }>
}>

/**
 * ¿El evento trae un final del reconocedor desde `resultIndex`?
 * (Caso 7+6: dueño único de la pregunta "¿es final?"; `isFinal` es la marca
 * de Chrome de que la frase quedó completa.)
 * @param evento Evento real del reconocedor.
 * @returns `true` si algún resultado nuevo es final.
 */
export function traeFinal(evento: EventoProducto): boolean {
  const resultados = evento.results
  if (!resultados) return false
  for (let i = Number(evento.resultIndex) || 0; i < resultados.length; i += 1) {
    if (resultados[i]?.isFinal === true) return true
  }
  return false
}

/** Libro del último trozo pegado a la línea abierta (regla: `speechMerge`). */
type LibroDeLinea = Readonly<{ base: string; chunk: string; line: string }>

/** Ciclo del motor: `cerrando` solo mientras la cadena ejecuta el cierre. */
type EstadoMotorProducto = 'inactiva' | 'activa' | 'cerrando'

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
  /** Bautiza la voz de la locución del comando (problema 5: «ok flu soy X»). */
  registrarNombre(nombre: string): void
  /** Cierra la sesión con el motivo real del cierre. */
  cerrar(motivo: MotivoCierre): void
}>

/**
 * Compone el motor NUEVO para el producto con los adaptadores REALES.
 * Es el único punto que crea la sesión desde el hook: almacén Dexie, reloj,
 * ids, embeddings (worker único) y la configuración del plan; el eco se delega
 * a `ultimoTextoDicho`. La IDENTIDAD la mide el módulo por sí mismo
 * (`EmbebedorPort`, decisión del dueño Paso 5-A): el producto no recibe
 * evidencia de voz externa.
 * @param opciones Idioma activo, último texto de FLU, participante dueño de
 *   las filas y proveedor de turno del hook (leído por evento).
 * @returns Controlador de apertura, ingesta y cierre.
 */
export function crearMotorConversacionProducto({
  idioma,
  ultimoTextoDicho,
  participantId,
  turnId: proveedorDeTurno,
  recordingId,
}: {
  idioma: IdiomaLocucion
  ultimoTextoDicho: () => string
  /** Participante activo: aísla las filas del motor por usuario. */
  participantId?: string
  /**
   * Turno del hook, leído POR EVENTO: el motor queda abierto entre locuciones
   * (modo pasivo) y el número de turno avanza con cada commit, así que un valor
   * capturado en `abrir` pegaría el turno 1 a todas las filas. Sin proveedor, o
   * con valor vacío, rige el uuid propio de la sesión.
   */
  turnId?: () => number | string | null
  /**
   * Id de la grabación activa (recorder, Caso 11), leído al ABRIR: la sesión
   * ADOPTA ese id y todos sus commits/eventos lo llevan (nunca dos). Vacío o
   * sin proveedor => el módulo acuña el propio (N/A sin recorder al iniciar).
   */
  recordingId?: () => string | null
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
  })
  let estadoMotor: EstadoMotorProducto = 'inactiva'
  /** Uuid propio de la sesión (abrir); el proveedor lo pisa por evento si existe. */
  let turnoDeSesion: string | null = null
  let cursorMuestras = 0
  /**
   * Turno vigente del evento: el proveedor manda si aporta valor; si no, el uuid
   * de la sesión. Un solo dueño de la pregunta "¿qué turno es este?" por evento.
   */
  const leerTurno = (): string => {
    const aportado = String(proveedorDeTurno?.() ?? '').trim()
    return aportado || turnoDeSesion || ''
  }
  /** Libro del último hueco pegado a la línea abierta (dueño de la regla: speechMerge). */
  let libroDeLinea: LibroDeLinea | null = null
  /** Locución DUEÑA del libro: si el tramo cambia, el libro no describe su texto. */
  let locucionDelLibro = ''
  /**
   * Cadena del límite: cada paso lee la instantánea DESPUÉS de que el paso anterior
   * terminó. Sin ella, un evento compuesto antes de que el módulo procesara el audio
   * pendiente pegaba su texto a la locución anterior (medido en el playback del
   * 2026-10-25: tramos fabricados y filas de 119–152 s).
   */
  let cadena: Promise<void> = Promise.resolve()

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

  return {
    abrir: () => {
      // Cada `onstart` abre una sesión de resultados NUEVA del reconocedor: los
      // índices de Chrome vuelven a empezar y sus trozos no son los del libro
      // anterior, así que el libro se descarta. Si la locución sigue abierta, el
      // módulo conserva su texto y la siguiente fusión parte de él.
      libroDeLinea = null
      locucionDelLibro = ''
      if (estadoMotor !== 'inactiva') return
      estadoMotor = 'activa'
      const turno = leerTurno() || id.uuid()
      turnoDeSesion = turno
      cursorMuestras = 0
      // Caso 11: la conversación ADOPTA el id de la grabación activa al abrir la
      // sesión; sin grabación (proveedor vacío) el módulo acuña el propio (N/A).
      const grabacion = String(recordingId?.() ?? '').trim()
      void encadenar(() =>
        registrarFallo(
          'conversacion.producto.start.error',
          api.start({
            turnId: turno,
            idioma,
            ...(grabacion ? { sessionId: grabacion } : {}),
          }),
        ),
      )
    },

    evento: (evento) =>
      encadenar(async () => {
        if (estadoMotor !== 'activa') return
        // Se relee POR EVENTO: el commit del hook avanza el número de turno con la
        // locución ABIERTA todavía, y esta ingesta pertenece al turno nuevo.
        const turno = leerTurno()
        if (!turno) return
        const instantanea = api.snapshot()
        const abierta = instantanea.locucionAbierta
        const tramoVigente = instantanea.tramoAudio?.tramoId ?? ''
        // El texto sin tramo lo atribuye el MÓDULO dentro de su cola: va al tramo de
        // audio si existe y, si no, a la locución abierta. Solo hay continuidad
        // cuando no los separa un tramo nuevo; con tramo nuevo el texto empieza de
        // cero (esa frontera la decide el módulo).
        const continua = Boolean(abierta) && (!tramoVigente || tramoVigente === abierta?.locutionId)
        const clave = continua && abierta ? abierta.locutionId : ''
        if (clave !== locucionDelLibro) {
          libroDeLinea = null
          locucionDelLibro = clave
        }
        const trozo = componerFraseDelEvento(evento.results, evento.resultIndex)
        if (!trozo) return
        const hayFinal = traeFinal(evento)
        const lineaPrevia = continua && abierta ? abierta.texto : ''
        const fusion = fusionarEnLineaAbierta(lineaPrevia, libroDeLinea, trozo)
        libroDeLinea = fusion.libro
        // Misma línea = síntoma de reentrega del MISMO tramo (Chrome repite el
        // evento): no se reingiere, SALVO que el evento traiga el final (Caso 7+6:
        // el final MARCA la frase completa y debe llegar al módulo).
        if (!fusion.linea) return
        if (fusion.linea === lineaPrevia && !hayFinal) return
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
            turnId: turno,
            ...(metrics
              ? { medida: { speechLikeMs: metrics.speechLikeMs, rms: metrics.rms } }
              : {}),
          }),
        )
      }),

    audio: (muestras, frecuencia, inicioMuestras) => {
      if (estadoMotor !== 'activa' || !muestras || muestras.length === 0) return
      const turno = leerTurno()
      if (!turno) return
      const inicio =
        Number.isFinite(Number(inicioMuestras)) && Number(inicioMuestras) >= 0
          ? Number(inicioMuestras)
          : cursorMuestras
      const fin = inicio + muestras.length
      cursorMuestras = Math.max(cursorMuestras, fin)
      // El audio entra en la MISMA cadena que el texto: así el evento siguiente
      // compone sobre una instantánea que ya incluye estos bloques.
      void encadenar(() =>
        registrarFallo(
          'conversacion.producto.audio.error',
          api.ingestAudio({ muestras, sampleRate: frecuencia, inicio, fin, turnId: turno }),
        ),
      )
    },

    suscribir: (oyente) => api.subscribe(oyente),

    instantanea: () => api.snapshot(),

    registrarNombre: (nombre) => {
      if (estadoMotor !== 'activa') return
      // El nombre entra en la MISMA cadena que el audio y el texto: la locución
      // del comando sigue abierta cuando se aplica (medida de respaldo al cerrar).
      void encadenar(() => api.registerName({ nombre }))
    },

    cerrar: (motivo) => {
      void encadenar(async () => {
        if (estadoMotor !== 'activa') return
        estadoMotor = 'cerrando'
        try {
          // Cierre REAL: la locución abierta se declara final con SU texto ya
          // compuesto (nunca con la última reentrega, que puede ser solo la cola)
          // y recién entonces se detiene la sesión. Una sola fila por segmento.
          const abierta = api.snapshot().locucionAbierta
          if (abierta && String(abierta.texto || '').trim()) {
            const turno = leerTurno()
            await registrarFallo(
              'conversacion.producto.final.error',
              api.ingestAsr({
                tramoId: abierta.locutionId,
                texto: abierta.texto,
                final: true,
                idioma,
                tramo: abierta.tramo,
                ...(turno ? { turnId: turno } : {}),
              }),
            )
          }
          await registrarFallo('conversacion.producto.stop.error', api.stop(motivo))
        } finally {
          estadoMotor = 'inactiva'
          turnoDeSesion = null
          libroDeLinea = null
          locucionDelLibro = ''
        }
      })
    },
  }
}
