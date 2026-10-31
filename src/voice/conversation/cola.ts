/**
 * COLA del módulo CONVERSACIÓN: serialización y retén de pendientes.
 *
 * No decide reglas: retiene datos y los entrega en orden. La unión del mismo
 * tramo la decide `decidirRevision` (dueño único de la regla 3).
 */
import { fusionarVoz } from './fila.ts'
import { decidirRevision } from './revision.ts'
// Dueño único de «¿este texto continúa la frase?»: el retén no reimplementa la
// comparación para decidir qué pendiente sin tramo adopta el tramo que llega.
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
export function crearPendientes({
  reloj,
  orphanBufferMs,
  contarDescarte,
}: {
  reloj: RelojPort
  orphanBufferMs: number
  contarDescarte: ContarDescarte
}): Pendientes {
  let pendientes: EntradaPendiente[] = []

  return {
    encolar: (entrada) => {
      const tramoId = String(entrada.tramoId || '').trim()
      // SIN TRAMO: el texto aún no tiene audio que lo sostenga. Se retiene hasta
      // su ventana de huérfano y NO se fusiona con otro texto sin tramo: la
      // regla de revisión exige un tramo y nada prueba que sean la misma frase.
      if (!tramoId) {
        pendientes = [...pendientes, entrada]
        return
      }
      // El texto de un tramo CONTINÚA a un pendiente SIN tramo: es la MISMA
      // frase y el tramo que llega ahora ES el suyo. El parcial sin audio cede
      // al final que ya trae audio (medido 2026-10-31: tras una pausa que el
      // VAD no segmentó, el final del enunciado llegó sin tramo y su
      // continuación con tramo; sin adoptar, el parcial quedaba delante).
      const delTramo = pendientes.findIndex((p) => p.tramoId === tramoId)
      const indice =
        delTramo >= 0
          ? delTramo
          : pendientes.findIndex(
              (p) => !p.tramoId && continuaLaFrase(p.texto, entrada.texto),
            )
      if (indice < 0) {
        pendientes = [...pendientes, entrada]
        return
      }
      const previa = pendientes[indice]
      const decision = decidirRevision({
        tramoAbierto: { id: tramoId, texto: previa.texto },
        tramoId,
        texto: entrada.texto,
        final: previa.final || entrada.final,
      })
      const siguiente: EntradaPendiente = {
        ...previa,
        tramoId,
        texto: decision.pintar ? decision.texto : previa.texto,
        final: previa.final || entrada.final,
        idioma: entrada.idioma,
        turnId: entrada.turnId,
        voz: fusionarVoz(previa.voz, entrada.voz),
        tramo: previa.tramo ?? entrada.tramo,
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
          contarDescarte('huerfano', pendiente.tramoId, pendiente.tramo ?? null)
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
