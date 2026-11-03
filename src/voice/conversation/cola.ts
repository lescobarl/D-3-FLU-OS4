/**
 * COLA del módulo CONVERSACIÓN: serialización y retén de pendientes.
 *
 * No decide reglas: retiene datos y los entrega en orden. La unión del mismo
 * tramo la decide `decidirRevision` (dueño único de la regla 3).
 */
import { fusionarVoz } from './fila.ts'
import { unirRevision } from './revision.ts'
// Dueño único de «¿este texto continúa la frase?»: el retén no reimplementa la
// comparación para decidir qué pendiente adopta el tramo que llega.
import { continuaLaFrase } from '../core/locucion.js'
import type { ContarDescarte, EntradaPendiente } from './tipos.ts'
import type { RelojPort } from './ports.ts'

/** Cola serializada: una tarea a la vez, sin cierres duplicados. */
export type ColaSerializada = Readonly<{
  /** Encola una tarea; el rechazo real se devuelve a quien llamó. */
  serializar<T>(tarea: () => Promise<T>): Promise<T>
}>

/**
 * Crea la cola serializada de la sesión.
 * @returns La cola con su único método de encolado.
 */
export function crearCola(): ColaSerializada {
  let cola: Promise<unknown> = Promise.resolve()
  return {
    serializar: <T>(tarea: () => Promise<T>): Promise<T> => {
      const siguiente = cola.then(tarea)
      cola = siguiente.then(
        () => undefined,
        () => undefined,
      )
      return siguiente
    },
  }
}

/** Retén de textos de tramos ajenos: uno por tramo, sin mezclarse. */
export type Pendientes = Readonly<{
  encolar(entrada: EntradaPendiente): void
  expurgar(): void
  primero(): EntradaPendiente | null
  quitarPrimero(): void
  reiniciar(): void
}>

/**
 * Crea el retén de pendientes con expiración y descarte contado.
 * @param opciones Reloj, ventana de huérfanos y contador de descartes.
 * @returns Retén con encolado por tramo, expurgo y consumo en orden.
 */
/**
 * ¿Dos pendientes son el MISMO enunciado? Mismo tramo, o texto que continúa la
 * frase con ventanas de audio a distancia <= `silenceCloseMs`, o uno sin tramo.
 * La comparación es de `continuaLaFrase`; aquí solo se añade la proximidad.
 */
function mismoEnunciado(
  previo: EntradaPendiente,
  nuevo: EntradaPendiente,
  silenceCloseMs: number,
): boolean {
  if (previo.tramoId && nuevo.tramoId && previo.tramoId === nuevo.tramoId) return true
  if (!continuaLaFrase(previo.texto, nuevo.texto)) return false
  if (!previo.tramo || !nuevo.tramo) return true
  const rate = Math.max(
    1,
    Number(previo.tramo.sampleRate) || Number(nuevo.tramo.sampleRate) || 1,
  )
  const distanciaMs = Math.abs((nuevo.tramo.inicio - previo.tramo.fin) / rate) * 1000
  return distanciaMs <= silenceCloseMs
}

export function crearPendientes({
  reloj,
  orphanBufferMs,
  silenceCloseMs,
  contarDescarte,
}: {
  reloj: RelojPort
  orphanBufferMs: number
  silenceCloseMs: number
  contarDescarte: ContarDescarte
}): Pendientes {
  let pendientes: EntradaPendiente[] = []

  return {
    encolar: (entrada) => {
      // UN pendiente por ENUNCIADO, no por tramo. Se busca el mismo enunciado
      // (mismo tramo; o continúa la frase con audio próximo; o uno sin tramo)
      // y se funde con su dueño `unirRevision`; solo si no hay relación se crea
      // una entrada nueva. Las 179 parciales prefijo quedan en UNA.
      const indice = pendientes.findIndex((p) =>
        mismoEnunciado(p, entrada, silenceCloseMs),
      )
      if (indice < 0) {
        pendientes = [...pendientes, entrada]
        return
      }
      const previa = pendientes[indice]
      const unido = unirRevision(previa.texto, entrada.texto)
      // El tramo del grupo AVANZA al más reciente: la proximidad del siguiente
      // texto se mide contra el último audio de la frase, no contra el primero.
      const tramo = entrada.tramo ?? previa.tramo
      const siguiente: EntradaPendiente = {
        ...previa,
        tramoId: String(entrada.tramoId || '').trim() || previa.tramoId,
        texto: unido.pintar ? unido.texto : previa.texto,
        final: previa.final || entrada.final,
        idioma: entrada.idioma,
        turnId: entrada.turnId || previa.turnId,
        voz: fusionarVoz(previa.voz, entrada.voz),
        tramo,
        medida: entrada.medida ?? previa.medida,
        // La expiración se mide desde la ÚLTIMA llegada, no desde la primera.
        recibidoAt: entrada.recibidoAt,
      }
      pendientes = pendientes.map((p, posicion) =>
        posicion === indice ? siguiente : p,
      )
    },
    expurgar: () => {
      const ahora = reloj.ahora()
      const vigentes: EntradaPendiente[] = []
      for (const pendiente of pendientes) {
        if (ahora - pendiente.recibidoAt > orphanBufferMs) {
          // Un pendiente CON TEXTO no es huérfano: se abre/commitea (sintético
          // si su tramo venció). Solo el texto vacío se descarta.
          if (String(pendiente.texto || '').trim()) {
            vigentes.push(pendiente)
          } else {
            contarDescarte('huerfano', pendiente.tramoId, pendiente.tramo ?? null)
          }
        } else {
          vigentes.push(pendiente)
        }
      }
      pendientes = vigentes
    },
    primero: () => pendientes[0] ?? null,
    quitarPrimero: () => {
      pendientes = pendientes.slice(1)
    },
    reiniciar: () => {
      pendientes = []
    },
  }
}
