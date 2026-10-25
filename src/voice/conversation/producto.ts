/**
 * PUNTO DE COMPOSICIÓN del motor CONVERSACIÓN para el producto.
 *
 * Aquí se unen los adaptadores reales (Dexie, reloj, ids, config, wake, VAD) con
 * el motor y se expone el ciclo de escucha que consume el hook. El adaptador de
 * ASR no se usa en esta composición: el hook ya posee LA instancia de escucha y
 * entrega sus resultados por `evento()` (AGENTS, Anexo B invariante 1).
 *
 * IDENTIDAD DEL SEGMENTO (dueño único: este ingestor). Un segmento de voz tiene
 * UN `tramoId`; todos los finales de SEGMENTO que Chrome entrega durante el
 * dictado reutilizan ese id y entran como REVISIÓN de texto. Un `final` del
 * reconocedor no es el cierre de la locución: el cierre real es la frontera VAD
 * (silencio) o el fin de la sesión (`cerrar`). Así una locución = un tramo =
 * una fila, y no se escribe una fila por cada corte de Chrome.
 */
import {
  crearAlmacenDexieProducto,
  crearConfigFlu,
  crearIdUuid,
  crearPartidorWake,
  crearRegistroCaughtError,
  crearRelojSistema,
  crearVadProducto,
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
}>

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
  /** Cierra la sesión con el motivo real del cierre. */
  cerrar(motivo: MotivoCierre): void
}>

/**
 * Compone el motor NUEVO para el producto con los adaptadores REALES.
 * Es el único punto que crea la sesión desde el hook: almacén Dexie, reloj,
 * ids y la configuración del plan; el eco se delega a `ultimoTextoDicho`.
 * @param opciones Idioma activo, frecuencia de captura y último texto de FLU.
 * @returns Controlador de apertura, ingesta y cierre.
 */
export function crearMotorConversacionProducto({
  idioma,
  sampleRate,
  ultimoTextoDicho,
}: {
  idioma: IdiomaLocucion
  sampleRate: number
  ultimoTextoDicho: () => string
}): MotorConversacionProducto {
  const reloj = crearRelojSistema()
  const id = crearIdUuid()
  const config = crearConfigFlu()
  const api: ConversacionApi = crearConversacion({
    reloj,
    id,
    registro: crearRegistroCaughtError(),
    almacen: crearAlmacenDexieProducto({ reloj }),
    config,
    partidor: crearPartidorWake(config),
    vad: crearVadProducto(),
    ultimoTextoDicho,
  })
  let activa = false
  let turnId: string | null = null
  let tramoId: string | null = null
  let cursorMuestras = 0
  let inicioMuestra = 0
  let ultimoMs = 0
  /** Último FINAL ya ingerido en esta sesión del reconocedor (índice + texto). */
  let ultimoFinal: Readonly<{ indice: number; texto: string }> | null = null

  // Una locución cerrada es una frontera: el texto que llegue después abre un
  // segmento NUEVO, nunca promueve la fila ya cerrada.
  api.subscribe((evento) => {
    if (evento.tipo === 'locution.closed') tramoId = null
  })

  /**
   * Id del segmento vigente. La locución abierta manda; si no hay ninguna, el
   * tramo de audio que abrió el VAD (frontera nueva); si tampoco, un id nuevo.
   * @returns El `tramoId` que identifica la locución en curso.
   */
  function tramoDelSegmento(): string {
    const retrato = api.snapshot()
    const abierta = retrato.locucionAbierta
    if (abierta) return abierta.locutionId
    const audio = retrato.tramoAudio?.tramoId
    if (audio) return audio
    if (!tramoId) tramoId = id.uuid()
    return tramoId
  }

  return {
    abrir: () => {
      // Cada `onstart` del reconocedor abre una sesión de resultados NUEVA:
      // los índices de Chrome vuelven a empezar, así que la identidad del
      // último final no cruza de una sesión a otra (si no, una frase legítima
      // idéntica se perdería; AGENTS, invariante 14).
      ultimoFinal = null
      if (activa) return
      activa = true
      turnId = id.uuid()
      tramoId = null
      cursorMuestras = 0
      inicioMuestra = 0
      ultimoMs = reloj.ahora()
      registrarFallo('conversacion.producto.start.error', api.start({ turnId, idioma }))
    },

    evento: (evento) => {
      if (!activa || !turnId) return Promise.resolve()
      const resultados = evento.results
      if (!resultados || resultados.length === 0) return Promise.resolve()
      const ingestas: Promise<void>[] = []
      const ahora = reloj.ahora()
      const porReloj = Math.max(1, Math.round(((ahora - ultimoMs) * sampleRate) / 1000))
      const primero = evento.resultIndex ?? 0
      // Un solo segmento por lote de resultados: la identidad no rota entre
      // finales del MISMO tramo (Chrome corta segmentos mientras se sigue
      // hablando; ese corte no es una locución nueva).
      const segmento = tramoDelSegmento()
      for (let indice = primero; indice < resultados.length; indice += 1) {
        const resultado = resultados[indice]
        const texto = String(resultado?.[0]?.transcript || '').trim()
        if (!texto) continue
        const final = resultado?.isFinal === true
        // Reentrega del MISMO final (Chrome repite el evento): no es una
        // locución nueva. Se compara la identidad del resultado (índice +
        // texto), nunca el texto suelto; una frase legítima idéntica llega con
        // índice nuevo o tras reiniciar la sesión.
        if (final && ultimoFinal && indice === ultimoFinal.indice && texto === ultimoFinal.texto) {
          continue
        }
        const inicio = inicioMuestra
        const fin = Math.max(inicio + porReloj, cursorMuestras)
        ingestas.push(
          registrarFallo(
            'conversacion.producto.ingest.error',
            api.ingestAsr({
              tramoId: segmento,
              texto,
              // El final del reconocedor NO cierra la locución: solo declara
              // el corte de SU segmento. El cierre lo decide la frontera VAD o
              // `cerrar()` (una fila por segmento, no una por corte de Chrome).
              final: false,
              idioma,
              tramo: { inicio, fin, sampleRate },
              turnId,
            }),
          ),
        )
        if (final) ultimoFinal = { indice, texto }
      }
      ultimoMs = ahora
      return Promise.all(ingestas).then(() => undefined)
    },

    audio: (muestras, frecuencia, inicioMuestras) => {
      if (!activa || !turnId || !muestras || muestras.length === 0) return
      const inicio =
        Number.isFinite(Number(inicioMuestras)) && Number(inicioMuestras) >= 0
          ? Number(inicioMuestras)
          : cursorMuestras
      const fin = inicio + muestras.length
      cursorMuestras = Math.max(cursorMuestras, fin)
      registrarFallo(
        'conversacion.producto.audio.error',
        api.ingestAudio({
          muestras,
          sampleRate: frecuencia,
          inicio,
          fin,
          turnId,
        }),
      )
    },

    suscribir: (oyente) => api.subscribe(oyente),

    instantanea: () => api.snapshot(),

    cerrar: (motivo) => {
      if (!activa) return
      activa = false
      // Cierre REAL: la locución abierta se declara final con SU texto ya
      // fusionado (nunca con la última reentrega, que puede ser solo la cola)
      // y recién entonces se detiene la sesión. Una sola fila por segmento.
      const abierta = api.snapshot().locucionAbierta
      if (abierta && String(abierta.texto || '').trim()) {
        registrarFallo(
          'conversacion.producto.final.error',
          api.ingestAsr({
            tramoId: abierta.locutionId,
            texto: abierta.texto,
            final: true,
            idioma,
            tramo: abierta.tramo,
            ...(turnId ? { turnId } : {}),
          }),
        )
      }
      registrarFallo('conversacion.producto.stop.error', api.stop(motivo))
      turnId = null
      tramoId = null
      ultimoFinal = null
    },
  }
}
