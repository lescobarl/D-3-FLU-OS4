/**
 * PUNTO DE COMPOSICIÓN del motor CONVERSACIÓN para el producto.
 *
 * Vive fuera de `adaptersAsr.ts` para que ese archivo SOLO traduzca la fuente de
 * reconocimiento a `AsrPort` (una responsabilidad por archivo): aquí se unen los
 * adaptadores reales (Dexie, reloj, ids, config, wake, VAD) con el motor y se
 * expone el ciclo de escucha que consume el hook. El adaptador de ASR no conoce
 * el motor ni el almacén.
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
import type { EventoResultado } from './adaptersAsr.ts'
import type { IdiomaLocucion, MotivoCierre } from './ports.ts'
import type {
  ConversacionApi,
  EventoConversacion,
  InstantaneaConversacion,
} from './tipos.ts'

/** Evento real de ASR con el índice del primer resultado nuevo. */
export type EventoProducto = EventoResultado & Readonly<{ resultIndex?: number }>

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
      tramoId = id.uuid()
      cursorMuestras = 0
      inicioMuestra = 0
      ultimoMs = reloj.ahora()
      registrarFallo('conversacion.producto.start.error', api.start({ turnId, idioma }))
    },

    evento: (evento) => {
      if (!activa || !turnId || !tramoId) return Promise.resolve()
      const resultados = evento.results
      if (!resultados || resultados.length === 0) return Promise.resolve()
      const ingestas: Promise<void>[] = []
      const ahora = reloj.ahora()
      const porReloj = Math.max(1, Math.round(((ahora - ultimoMs) * sampleRate) / 1000))
      const primero = evento.resultIndex ?? 0
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
              tramoId,
              texto,
              final,
              idioma,
              tramo: { inicio, fin, sampleRate },
              turnId,
            }),
          ),
        )
        if (final) {
          ultimoFinal = { indice, texto }
          tramoId = id.uuid()
          inicioMuestra = Math.max(fin, cursorMuestras)
        }
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
      registrarFallo('conversacion.producto.stop.error', api.stop(motivo))
      turnId = null
      tramoId = null
    },
  }
}
