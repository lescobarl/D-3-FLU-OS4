/**
 * IDENTIDAD de voz del módulo CONVERSACIÓN (puro).
 *
 * La MEDIDA (el embedding) la entrega `EmbebedorPort`; el coseno lo calcula el
 * MISMO dueño único del proyecto (`speakerCore.compareCosineSignatures`, llegado
 * por el puerto). Aquí vive SOLO la regla del módulo: similitud ≥ umbral de
 * continuidad contra el ÚLTIMO vector → misma voz; si no, voz nueva, que acuña
 * su identidad (`IdPort.uuid()`, regla UUIDv4) y su etiqueta anónima.
 *
 * Sustituye en el corte (Paso 3) a la decisión que vivía en
 * `voiceIdentityResolve.js` + `speakerDiarization.js`; mientras conviven, la
 * autoridad del módulo es ESTA regla.
 */

/** Entrada de la regla de identidad: medida, memoria de la sesión y servicios. */
export type EntradaIdentidad = Readonly<{
  /** Vector medido de la locución. */
  vector: readonly number[]
  /** Voz de la última locución, si la sesión midió alguna. */
  ultimoVozId: string
  /** Vector de la última voz; `null` si la sesión no midió ninguna. */
  ultimoVector: readonly number[] | null
  /** Umbral de continuidad resuelto por el puerto de config (0..1). */
  umbral: number
  /** Etiqueta anónima de una voz nueva (`Hablante N`), del dueño de la plantilla. */
  etiquetaNueva: string
  /** Comparador de coseno inyectado (dueño único fuera del módulo). */
  comparar: (a: readonly number[], b: readonly number[]) => number
  /** Generador de id inyectado (UUIDv4): la voz nueva acuña su identidad. */
  id: () => string
}>

/** Decisión de la regla: la voz que sostiene la locución. */
export type IdentidadDecidida = Readonly<{
  /** Voz que sostiene la locución. */
  vozId: string
  /** ¿Es la misma voz que la locución anterior? */
  continuidad: boolean
  /** Etiqueta anónima SOLO cuando la voz es nueva (la continuidad la hereda). */
  hablante: string
}>

/**
 * Decide la identidad de una locución con su vector medido.
 *
 * Misma voz = hay voz previa, el vector es comparable (misma dimensión) y el
 * coseno alcanza el umbral de continuidad. Cualquier otra cosa es voz nueva:
 * sin medir contra el silencio, dos vectores de dimensión distinta nunca son
 * la misma voz (el módulo no inventa similitud).
 *
 * @param entrada Medida, memoria de sesión, umbral, etiqueta y servicios.
 * @returns Continuidad con la voz anterior o una voz nueva con id y etiqueta.
 */
export function decidirIdentidad(entrada: EntradaIdentidad): IdentidadDecidida {
  const ultimo = entrada.ultimoVector
  const mismaVoz =
    entrada.ultimoVozId !== '' &&
    ultimo !== null &&
    ultimo.length > 0 &&
    entrada.vector.length === ultimo.length &&
    entrada.comparar(entrada.vector, ultimo) >= entrada.umbral
  if (mismaVoz) {
    return { vozId: entrada.ultimoVozId, continuidad: true, hablante: '' }
  }
  return {
    vozId: entrada.id(),
    continuidad: false,
    hablante: entrada.etiquetaNueva,
  }
}
