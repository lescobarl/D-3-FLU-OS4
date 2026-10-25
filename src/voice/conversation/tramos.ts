/**
 * TRAMOS del módulo CONVERSACIÓN: registro de tramos vivos y búfer del ASR.
 *
 * Retiene y entrega datos en orden; no decide frontera ni revisión. La
 * expiración de un tramo huérfano se cuenta al consumirse (ingesta).
 */
import type { ResultadoAsrCrudo, TramoAudio } from './tipos.ts'
import type { RelojPort, TramoMuestreado } from './ports.ts'

/** Tramo registrado con la marca de su último uso (expira por huérfano). */
export type TramoRegistrado = Readonly<TramoAudio & { ultimaVez: number }>

/** Registro de tramos vivos: resuelve el tramo de un resultado del ASR. */
export type RegistroTramos = Readonly<{
  registrar(tramo: TramoAudio): void
  vigente(tramoId: string): TramoRegistrado | null
  resolver(tramoId: string, declarado?: TramoMuestreado): TramoMuestreado | null
  limpiar(): void
}>

/**
 * Crea el registro de tramos con expiración por `orphanBufferMs`.
 * @param opciones Reloj inyectado y ventana de retención de huérfanos.
 * @returns Registro con alta, consulta, resolución y limpieza.
 */
export function crearRegistroTramos({
  reloj,
  orphanBufferMs,
}: {
  reloj: RelojPort
  orphanBufferMs: number
}): RegistroTramos {
  const tramos = new Map<string, TramoRegistrado>()

  const vigente = (tramoId: string): TramoRegistrado | null => {
    const registrado = tramos.get(tramoId)
    if (!registrado) return null
    if (reloj.ahora() - registrado.ultimaVez > orphanBufferMs) {
      tramos.delete(tramoId)
      return null
    }
    return registrado
  }

  return {
    registrar: (tramo) => {
      tramos.set(tramo.tramoId, { ...tramo, ultimaVez: reloj.ahora() })
    },
    vigente,
    resolver: (tramoId, declarado) => {
      if (
        declarado &&
        Number.isFinite(declarado.inicio) &&
        Number.isFinite(declarado.fin) &&
        declarado.fin > declarado.inicio &&
        declarado.sampleRate > 0
      ) {
        return declarado
      }
      const registrado = vigente(tramoId)
      if (!registrado) return null
      return {
        inicio: registrado.inicio,
        fin: registrado.fin,
        sampleRate: registrado.sampleRate,
      }
    },
    limpiar: () => {
      tramos.clear()
    },
  }
}

/** Resultados del `AsrPort` retenidos hasta la siguiente llamada pública. */
export type BufferAsr = Readonly<{
  agregar(resultado: ResultadoAsrCrudo): void
  drenar(): ResultadoAsrCrudo[]
  reiniciar(): void
}>

/**
 * Crea el búfer ordenado de resultados del ASR.
 * @returns Búfer con alta, drenaje completo y reinicio.
 */
export function crearBufferAsr(): BufferAsr {
  let resultados: ResultadoAsrCrudo[] = []
  return {
    agregar: (resultado) => {
      resultados = [...resultados, resultado]
    },
    drenar: () => {
      const actuales = resultados
      resultados = []
      return actuales
    },
    reiniciar: () => {
      resultados = []
    },
  }
}
