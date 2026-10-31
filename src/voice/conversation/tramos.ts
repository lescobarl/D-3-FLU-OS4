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

/** Bloque PCM retenido de un tramo, con su ventana absoluta de muestras. */
export type BloqueRetenido = Readonly<{
  inicio: number
  fin: number
  muestras: Float32Array
}>

/** Registro de tramos vivos: resuelve el tramo de un resultado del ASR. */
export type RegistroTramos = Readonly<{
  registrar(tramo: TramoAudio): void
  /**
   * Retiene el PCM del tramo para medir la voz de una locución que nace de un
   * pendiente ya hablado: al abrirse tarde, su audio quedó atrás y sin esta
   * evidencia la identidad se mediría sobre el silencio o la voz siguiente
   * (etiquetas falsas tipo «Hablante X» para el mismo hablante).
   */
  retener(tramoId: string, bloque: BloqueRetenido, maxMuestras: number): void
  /** PCM retenido del tramo recortado a su ventana cerrada; null sin audio. */
  muestras(tramoId: string, ventana: TramoMuestreado): Float32Array[] | null
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
  /** PCM retenido por tramo, con el total para aplicar el tope sin recorrer. */
  const audio = new Map<string, { bloques: BloqueRetenido[]; total: number }>()

  /** Suelta un tramo con su audio: nada de PCM de tramos que ya no existen. */
  const soltar = (tramoId: string): void => {
    tramos.delete(tramoId)
    audio.delete(tramoId)
  }

  /** Poda los tramos vencidos al registrar (mismo criterio que `vigente`). */
  const podar = (): void => {
    const ahora = reloj.ahora()
    for (const [tramoId, registrado] of tramos) {
      if (ahora - registrado.ultimaVez > orphanBufferMs) soltar(tramoId)
    }
  }

  const vigente = (tramoId: string): TramoRegistrado | null => {
    const registrado = tramos.get(tramoId)
    if (!registrado) return null
    if (reloj.ahora() - registrado.ultimaVez > orphanBufferMs) {
      soltar(tramoId)
      return null
    }
    return registrado
  }

  return {
    registrar: (tramo) => {
      podar()
      tramos.set(tramo.tramoId, { ...tramo, ultimaVez: reloj.ahora() })
    },
    retener: (tramoId, bloque, maxMuestras) => {
      if (!(bloque.muestras.length > 0) || bloque.fin <= bloque.inicio) return
      const limite = Math.max(1, Math.round(maxMuestras))
      const retenido = audio.get(tramoId) ?? { bloques: [], total: 0 }
      retenido.bloques.push(bloque)
      retenido.total += bloque.muestras.length
      // Tope en cola: se descarta el bloque MÁS VIEJO (el audio reciente manda).
      while (retenido.total > limite && retenido.bloques.length > 1) {
        const caido = retenido.bloques.shift()
        if (!caido) break
        retenido.total -= caido.muestras.length
      }
      const unico = retenido.bloques.length === 1 ? retenido.bloques[0] : undefined
      if (unico && retenido.total > limite) {
        const recorte = unico.muestras.slice(unico.muestras.length - limite)
        retenido.bloques[0] = { ...unico, inicio: unico.fin - recorte.length, muestras: recorte }
        retenido.total = recorte.length
      }
      audio.set(tramoId, retenido)
    },
    muestras: (tramoId, ventana) => {
      const bloques = audio.get(tramoId)?.bloques
      if (!bloques || bloques.length === 0) return null
      const partes: Float32Array[] = []
      for (const bloque of bloques) {
        const desde = Math.max(bloque.inicio, ventana.inicio)
        const hasta = Math.min(bloque.fin, ventana.fin)
        if (hasta <= desde) continue
        const offset = desde - bloque.inicio
        partes.push(bloque.muestras.subarray(offset, offset + (hasta - desde)))
      }
      return partes.length > 0 ? partes : null
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
      audio.clear()
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
