/**
 * IDENTIDAD de voz del módulo CONVERSACIÓN (puro).
 *
 * La MEDIDA (el embedding) la entrega `EmbebedorPort`; el coseno lo calcula el
 * MISMO dueño único del proyecto (`speakerCore.compareCosineSignatures`, llegado
 * por el puerto). Aquí vive SOLO la regla del módulo: similitud ≥ umbral de
 * continuidad contra la MEJOR plantilla de la sesión → misma voz; si no, voz
 * nueva, que acuña su identidad (`IdPort.uuid()`, regla UUIDv4) y su etiqueta
 * anónima.
 *
 * Mandato del dueño (2026-10-30, problema 4): se compara contra TODAS las
 * plantillas de la sesión, no solo contra la última voz. Así una voz que
 * vuelve (A→B→A) recupera SU etiqueta y no hereda la del hablante intermedio.
 * Las plantillas viven SOLO en la sesión (decisión B: nada persiste entre
 * sesiones).
 *
 * Sustituyó en el corte (Paso 3) a la decisión del resolutor de voz retirado;
 * desde el corte esta regla es la ÚNICA autoridad del módulo.
 */

/**
 * Plantilla de una voz medida en la sesión (la clave del mapa es su `vozId`).
 * La muta SOLO `sesion.registrarMedidaVoz` (refresco del vector) y el cierre
 * (etiqueta commiteada).
 */
export type PlantillaVoz = {
  /** Vector de la voz (refrescado con cada medida que casa). */
  vector: readonly number[]
  /** Etiqueta de la voz en la sesión (`Hablante N` o nombre del bautizo). */
  etiqueta: string
}

/** Plantilla con su clave: lo que consume la regla de identidad. */
export type PlantillaVozConId = Readonly<PlantillaVoz & { vozId: string }>

/** Plantillas de la sesión listas para la regla (dueño único del mapeo). */
export function plantillasDe(
  plantillasVoz: ReadonlyMap<string, PlantillaVoz>,
): readonly PlantillaVozConId[] {
  return [...plantillasVoz.entries()].map(([vozId, plantilla]) => ({
    vozId,
    vector: plantilla.vector,
    etiqueta: plantilla.etiqueta,
  }))
}

/** Entrada de la regla de identidad: medida, plantillas de la sesión y servicios. */
export type EntradaIdentidad = Readonly<{
  /** Vector medido de la locución. */
  vector: readonly number[]
  /** Plantillas de TODAS las voces medidas en la sesión (mejor coseno gana). */
  plantillas: readonly PlantillaVozConId[]
  /** Umbral de continuidad resuelto por el puerto de config (0..1). */
  umbral: number
  /** Etiqueta anónima de una voz nueva (`Hablante N`); se resuelve SOLO si la voz es nueva. */
  etiquetaNueva: () => string
  /** Comparador de coseno inyectado (dueño único fuera del módulo). */
  comparar: (a: readonly number[], b: readonly number[]) => number
  /** Generador de id inyectado (UUIDv4): la voz nueva acuña su identidad. */
  id: () => string
}>

/** Decisión de la regla: la voz que sostiene la locución. */
export type IdentidadDecidida = Readonly<{
  /** Voz que sostiene la locución. */
  vozId: string
  /** ¿Es la misma voz que alguna ya plantillada en la sesión? */
  continuidad: boolean
  /** Etiqueta de la plantilla casada, o anónima SOLO cuando la voz es nueva. */
  hablante: string
}>

/**
 * Decide la identidad de una locución con su vector medido.
 *
 * Misma voz = alguna plantilla de la sesión con vector comparable (misma
 * dimensión) y coseno ≥ umbral; gana la MEJOR similitud, no la más reciente.
 * Cualquier otra cosa es voz nueva: sin medir contra el silencio, dos vectores
 * de dimensión distinta nunca son la misma voz (el módulo no inventa similitud).
 *
 * @param entrada Medida, plantillas de la sesión, umbral, etiqueta y servicios.
 * @returns Continuidad con la plantilla casada o una voz nueva con id y etiqueta.
 */
export function decidirIdentidad(entrada: EntradaIdentidad): IdentidadDecidida {
  let mejor: PlantillaVozConId | null = null
  let mejorCoseno = Number.NEGATIVE_INFINITY
  for (const plantilla of entrada.plantillas) {
    if (plantilla.vector.length !== entrada.vector.length) continue
    const coseno = entrada.comparar(entrada.vector, plantilla.vector)
    if (coseno > mejorCoseno) {
      mejorCoseno = coseno
      mejor = plantilla
    }
  }
  if (mejor && mejorCoseno >= entrada.umbral) {
    return { vozId: mejor.vozId, continuidad: true, hablante: mejor.etiqueta }
  }
  return {
    vozId: entrada.id(),
    continuidad: false,
    hablante: entrada.etiquetaNueva(),
  }
}
