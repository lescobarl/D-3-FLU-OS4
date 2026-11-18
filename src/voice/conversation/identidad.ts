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
 * Las plantillas MEDIDAS viven en la sesión; las anclas de la base se consultan
 * como candidatas de SOLO LECTURA (regla 8: vector conocido → nombre propio) y
 * no se persisten aquí.
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

/**
 * Plantillas de la sesión MÁS las anclas de la base (solo lectura). La voz
 * medida que casa con un ancla conocida recibe su nombre propio; la que no casa
 * sigue el camino normal (`Hablante N`). El ancla se identifica con un id
 * estable de sesión (`base:<nombre>`), nunca con un UUID de voz medida.
 * @param plantillasVoz Plantillas medidas en la sesión.
 * @param anclasBase Anclas verificadas de la base (nombre + vector).
 * @returns Candidatas para `decidirIdentidad`, sesión primero.
 */
export function plantillasDeSesion(
  plantillasVoz: ReadonlyMap<string, PlantillaVoz>,
  anclasBase?: () => ReadonlyArray<{ name?: string; vector?: readonly number[] }>,
): readonly PlantillaVozConId[] {
  const base: PlantillaVozConId[] = []
  const vistos = new Set<string>()
  for (const ancla of anclasBase?.() ?? []) {
    const nombre = String(ancla?.name || '').trim()
    const vector = Array.isArray(ancla?.vector) ? ancla.vector : []
    if (!nombre || vector.length === 0) continue
    const clave = nombre.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    base.push({ vozId: `base:${clave}`, vector, etiqueta: nombre })
  }
  return [...plantillasDe(plantillasVoz), ...base]
}

/** Entrada de la regla de identidad: medida, plantillas de la sesión y servicios. */
export type EntradaIdentidad = Readonly<{
  /** Vector medido de la locución. */
  vector: readonly number[]
  /** Plantillas de TODAS las voces medidas en la sesión (mejor coseno gana). */
  plantillas: readonly PlantillaVozConId[]
  /** Umbral de continuidad resuelto por el puerto de config (0..1). */
  umbral: number
  /**
   * Duración mínima de VOZ (ms) para afirmar cualquier identidad, también la de
   * una voz ya conocida. Por debajo, la fila es `Hablante XX` (regla 6): una
   * ventana corta no distingue voces y una coincidencia por coseno con un piso
   * bajo etiquetaba a la mujer como el hablante anterior (medido 2026-11-17:
   * ventana de 540 ms -> Luis en vez de Hablante 2).
   */
  minVozIdentidadMs?: number
  /**
   * Duracion REAL de la evidencia de voz de esta locucion (ms). Un turno corto
   * no basta para acunar una voz nueva: queda pendiente (auditoria 2026-11-01).
   */
  duracionMs?: number
  /** Duracion minima para crear una voz nueva (ms); si falta, 0. */
  minNuevaVozMs?: number
  /** Piso para casar con una voz YA existente (turnos cortos no huerfanos). */
  umbralExistente?: number
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
  /**
   * `true` si se midió pero el AUDIO del turno no alcanza para acuñar una voz.
   * La fila es `Hablante XX` (no identificado), distinta de `Hablante X`
   * (medida aún no llegada). El texto corto NO es insuficiencia de voz.
   */
  insuficiente?: boolean
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
  const duracion = Number(entrada.duracionMs)
  const minimoIdentidad = Number(entrada.minVozIdentidadMs) || 0
  // REGLA 6: una ventana con menos VOZ que el mínimo de identidad no identifica
  // a nadie, ni siquiera por coincidencia con una voz conocida. Antes se casaba
  // con el piso bajo `umbralExistente` y una ventana corta de otra persona
  // heredaba el nombre del hablante anterior.
  if (
    Number.isFinite(duracion) &&
    duracion > 0 &&
    minimoIdentidad > 0 &&
    duracion < minimoIdentidad
  ) {
    return { vozId: '', continuidad: false, hablante: '', insuficiente: true }
  }
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
  // Turno por encima del piso de medida y por debajo de la duración de una voz
  // nueva: si casa con una voz YA conocida, conserva su etiqueta. El piso bajo
  // (`umbralExistente`) NO se aplica a ventanas cortas: esas son XX (arriba).
  const umbralExistente = Number(entrada.umbralExistente) || entrada.umbral
  if (mejor && mejorCoseno >= umbralExistente) {
    return { vozId: mejor.vozId, continuidad: true, hablante: mejor.etiqueta }
  }
  const minimo = Number(entrada.minNuevaVozMs) || 0
  if (Number.isFinite(duracion) && duracion < minimo) {
    // Turno corto: no hay evidencia suficiente para ACUNAR una voz nueva.
    // La fila nace NO IDENTIFICADA (`Hablante XX`), no en espera: se midió y el
    // audio no alcanzó (regla 6). `insuficiente` separa este caso de la medida
    // que todavía no ha llegado (`Hablante X`).
    return { vozId: '', continuidad: false, hablante: '', insuficiente: true }
  }
  return {
    vozId: entrada.id(),
    continuidad: false,
    hablante: entrada.etiquetaNueva(),
  }
}
