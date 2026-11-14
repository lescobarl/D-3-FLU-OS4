/**
 * FILA DE LA LOCUCIÓN — reglas 4 y 5 del módulo CONVERSACIÓN (puro).
 *
 * Regla 4: al cerrar, TRAMO VÁLIDO + TEXTO → una `FilaNueva`. Si falta el tramo
 * (o no avanza) o falta el texto, no se inventa fila: se devuelve el motivo del
 * descarte para que el llamador lo CUENTE. `locutionId` es el `tramoId` del
 * ingestor y debe ser UUIDv4 (clave de inserción); no se acepta una secuencia.
 *
 * Regla 5: la etiqueta se resuelve por prioridad y nunca queda `?`:
 *   1. nombre CONFIRMADO (`ok flu soy XXX`)  → evidencia `nombre`
 *   2. plantilla de sesión casada (`etiquetaVoz`) → evidencia `medida`
 *      (la voz que vuelve recupera SU etiqueta: problema 4)
 *   3. etiqueta de la VOZ MEDIDA (propia o anónima `Hablante N`) → `medida`
 *   4. continuidad con la etiqueta anterior   → evidencia `continuidad`
 *   5. etiqueta TEMPORAL (`Hablante X`)       → evidencia `pendiente`
 *   6. no identificado (`Hablante XX`)        → evidencia `medida`/`semilla`
 *
 * La etiqueta TEMPORAL es el mandato del dueño (2026-10-30): «puedes poner un
 * hablante temporal si aun no llega, y cuando lo tengas reemplazar». Se usa
 * cuando la fila NO tiene voz medida (sin `vozId` no hay plantilla, ni medida
 * anónima, ni continuidad): la fila nace con `Hablante X` y la medida tardía la
 * reemplaza (`AlmacenPort.actualizar`). Una voz YA medida conserva su etiqueta
 * —la medida no se descarta por el largo del tramo, solo se exige para ACUÑAR
 * una voz nueva—.
 *
 * Una medida ANÓNIMA (`Hablante N`) NO es identidad, pero tampoco es la fila
 * anterior: gana a la continuidad para que una voz distinta nunca herede el
 * nombre de la voz previa (la mujer salía «Luis»). La VISTA muestra `Hablante N`
 * tal cual: es una voz MEDIDA desconocida, distinta de `Hablante XX` (audio
 * insuficiente) y de `Hablante X` (medida aún no llegada).
 *
 * `provisional` es `true` mientras el final del mismo tramo no haya llegado.
 * La fila commiteada es INMUTABLE (mandato del dueño 2026-10-30): no hay
 * consolidación ni promoción; el texto se decide ANTES del insert y el final
 * solo marca la frase completa de la locución abierta.
 */
import type { EvidenciaVoz } from './tipos.ts'
import type {
  AnclaAudio,
  EvidenciaEtiqueta,
  Fila,
  FilaNueva,
  IdiomaLocucion,
  MotivoCierre,
  OrigenTranscripcion,
  TramoMuestreado,
} from './ports.ts'

/** Forma UUIDv4 de la clave de fila (`locutionId` = `tramoId`). */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Evidencia de voz disponible al cerrar una locución. */
export type VozEtiqueta = Readonly<{
  nombre: string
  nombreConfirmado: boolean
  hablante: string
  continuidad: boolean
  /**
   * Etiqueta de la plantilla de sesión que casó la medida (problema 4): la voz
   * ya conocida recupera SU etiqueta aunque otra voz haya hablado en medio.
   */
  etiquetaVoz?: string
  /**
   * Se MIDIÓ pero el audio no alcanza para un vector/para acuñar voz: la fila
   * es `Hablante XX` (no identificado), nunca `Hablante X` (en espera).
   */
  medidaInsuficiente?: boolean
}>

/** Entrada para resolver la etiqueta: voz, etiqueta anterior y semilla. */
export type EntradaEtiqueta = Readonly<{
  voz: VozEtiqueta
  anterior: string | null
  semilla: string
  /** Predicado de etiqueta anónima (`Hablante N`/pendiente): no es identidad. */
  esEtiquetaAnonima: (etiqueta: string) => boolean
  /**
   * Etiqueta TEMPORAL mientras la medida no ha llegado ('' = no usar). Sin ella,
   * la etiqueta cae a la semilla (compatibilidad de dobles de prueba).
   */
  pendiente?: string
  /**
   * Nombres declarados para etiquetas PROVISIONALES (`Hablante N`): el comando
   * «ok flu soy X» sustituye la etiqueta ya escrita sin esperar al vector.
   */
  nombresPorEtiqueta?: ReadonlyMap<string, string>
}>

/** Etiqueta resuelta con la evidencia que la sostiene. */
export type EtiquetaResuelta = Readonly<{
  etiqueta: string
  evidencia: EvidenciaEtiqueta
}>

/** Locución ya cerrada que opta a fila. */
export type CierreLocucion = Readonly<{
  locutionId: string
  sessionId: string
  turnId: string
  inicio: number
  fin: number | null
  sampleRate: number
  texto: string
  idioma: IdiomaLocucion
  overlap: boolean
  /** `true` si llegó el final del mismo tramo: la fila no queda provisional. */
  final: boolean
  reason: MotivoCierre
  voz: VozEtiqueta
  etiquetaAnterior: string | null
  semillaEtiqueta: string
  /** Predicado de etiqueta anónima (`Hablante N`/pendiente): no es identidad. */
  esEtiquetaAnonima: (etiqueta: string) => boolean
  /** Etiqueta TEMPORAL (`Hablante X`, en espera) mientras la medida no ha llegado. */
  pendienteEtiqueta?: string
  /** Nombres declarados para etiquetas provisionales (bautizo sin vector). */
  nombresPorEtiqueta?: ReadonlyMap<string, string>
  /**
   * TIMBRE medido de la voz que cierra la locución (null si no hubo medida):
   * la fila lo guarda como evidencia del vínculo fila↔voz por timbre.
   */
  firma: readonly number[] | null
  /**
   * Origen del TEXTO que sostiene la fila: `chrome` (primario) o `local`
   * (respaldo por tramo aceptado por su puerta). La reconciliación ocurre AQUÍ,
   * en la MISMA construcción: la fila se escribe una sola vez.
   */
  origen?: OrigenTranscripcion
  /**
   * Hora de VOZ del fin del tramo (ms), derivada del ancla de la sesión. La
   * fila la arrastra hasta el almacén; sin ancla se omite.
   */
  marcaFinMs?: number
}>

/** Motivo del descarte cuando no hay fila (se cuenta, no se silencia). */
export type MotivoDescarte = 'tramoInvalido' | 'sinTexto'

/** Resultado de la regla 4: una fila o un descarte con motivo. */
export type ResultadoFila = Readonly<
  | { fila: FilaNueva; descarte: null }
  | { fila: null; descarte: MotivoDescarte }
>

/**
 * Resuelve la etiqueta de la locución por prioridad (regla 5).
 *
 * @param entrada Voz disponible, etiqueta anterior y semilla de configuración.
 * @returns Etiqueta no vacía y su evidencia.
 * @throws Si la semilla queda vacía o la etiqueta elegida es `?`.
 */
export function resolverEtiqueta(entrada: EntradaEtiqueta): EtiquetaResuelta {
  const { voz, anterior, semilla, esEtiquetaAnonima } = entrada
  const hablante = String(voz.hablante || '').trim()
  // Sin medida no se inventa identidad, pero la fila NUNCA queda «?»: se usa la
  // etiqueta TEMPORAL (`Hablante X`, en espera) o la semilla (`Hablante XX`, no
  // identificado) y se conserva la evidencia para que la medida tardía la
  // reemplace.
  const respaldo = String(semilla || '').trim()
  const pendienteEtiqueta = String(entrada.pendiente || '').trim()
  const medidaInsuficiente = voz.medidaInsuficiente === true
  const candidatos: ReadonlyArray<EtiquetaResuelta> = [
    { etiqueta: voz.nombreConfirmado ? String(voz.nombre || '').trim() : '', evidencia: 'nombre' },
    // La plantilla casada identifica la voz física (anónima o con nombre): gana
    // a la continuidad con la fila anterior (A→B→A recupera la etiqueta de A).
    { etiqueta: String(voz.etiquetaVoz || '').trim(), evidencia: 'medida' },
    // La etiqueta de la VOZ MEDIDA manda sobre la continuidad: una voz distinta
    // (aunque su etiqueta sea anónima) no hereda el nombre de la fila anterior
    // (la mujer salía «Luis»).
    { etiqueta: hablante, evidencia: 'medida' },
    { etiqueta: voz.continuidad ? String(anterior ?? '').trim() : '', evidencia: 'continuidad' },
    // Se intentó medir y no alcanzó: XX (no identificado), NUNCA X (en espera).
    ...(medidaInsuficiente ? [{ etiqueta: respaldo, evidencia: 'medida' as const }] : []),
    // La medida todavía NO llegó: X (en espera) mientras la voz siga pendiente.
    { etiqueta: pendienteEtiqueta, evidencia: 'pendiente' },
    // Sin etiqueta temporal, el estado honesto es no identificado (XX).
    { etiqueta: respaldo, evidencia: 'semilla' },
  ]
  const elegido = candidatos.find((candidato) => candidato.etiqueta !== '')
  if (!elegido) throw new Error('semilla vacia: la etiqueta no puede quedar vacia')
  if (elegido.etiqueta === '?') throw new Error('etiqueta ? prohibida')
  // BAUTIZO POR ETIQUETA: un `Hablante N` sobre el que el dueño dijo su nombre se
  // sustituye por el nombre SIN esperar a que haya vector. La etiqueta es el WHERE
  // del comando; la voz medida hereda el nombre en registrarMedidaVoz.
  // Una medida INSUFICIENTE no hereda un nombre por etiqueta: XX no es una voz
  // identificable y el bautizo debe ir a su N/vector, nunca a todas las XX.
  const nombreDeEtiqueta =
    !medidaInsuficiente && elegido.evidencia !== 'nombre' && esEtiquetaAnonima(elegido.etiqueta)
      ? String(entrada.nombresPorEtiqueta?.get(elegido.etiqueta) || '').trim()
      : ''
  if (nombreDeEtiqueta) return { etiqueta: nombreDeEtiqueta, evidencia: 'nombre' }
  return { etiqueta: elegido.etiqueta, evidencia: elegido.evidencia }
}

/**
 * Construye la fila de una locución cerrada o declara el descarte (regla 4).
 *
 * @param entrada Locución cerrada con su voz y la semilla de configuración.
 * @returns `{fila, descarte:null}` o `{fila:null, descarte}`.
 * @throws Si `locutionId` no es UUIDv4: sin clave válida no hay inserción.
 */
export function construirFila(entrada: CierreLocucion): ResultadoFila {
  const locutionId = String(entrada.locutionId || '').trim()
  if (!UUID_V4.test(locutionId)) {
    throw new Error(`locutionId no es UUIDv4: ${entrada.locutionId}`)
  }

  const inicio = Number(entrada.inicio)
  const fin = Number(entrada.fin)
  const sampleRate = Number(entrada.sampleRate)
  // El TEXTO manda sobre la duración: una frase corta (incluso de 1 muestra)
  // no se pierde; su hablante será `Hablante XX` porque la medida no alcanza.
  // Solo un tramo que no avanza o sin tasa es inválido (no hay audio).
  const tramoValido =
    Number.isFinite(inicio) &&
    inicio >= 0 &&
    Number.isFinite(fin) &&
    fin > inicio &&
    Number.isFinite(sampleRate) &&
    sampleRate > 0
  if (!tramoValido) return { fila: null, descarte: 'tramoInvalido' }

  const texto = String(entrada.texto || '').trim()
  if (!texto) return { fila: null, descarte: 'sinTexto' }

  const etiqueta = resolverEtiqueta({
    voz: entrada.voz,
    anterior: entrada.etiquetaAnterior,
    semilla: entrada.semillaEtiqueta,
    esEtiquetaAnonima: entrada.esEtiquetaAnonima,
    pendiente: entrada.pendienteEtiqueta,
    nombresPorEtiqueta: entrada.nombresPorEtiqueta,
  })

  return {
    fila: {
      locutionId,
      sessionId: String(entrada.sessionId || ''),
      turnId: String(entrada.turnId || ''),
      texto,
      tramo: { inicio, fin, sampleRate },
      etiqueta: etiqueta.etiqueta,
      evidencia: etiqueta.evidencia,
      firma: entrada.firma ?? null,
      idioma: entrada.idioma,
      overlap: Boolean(entrada.overlap),
      provisional: !entrada.final,
      reason: entrada.reason,
      // El origen SOLO se declara cuando NO es el primario: una fila de Chrome
      // conserva la forma de siempre y la ausencia se lee como `chrome`.
      ...(entrada.origen && entrada.origen !== 'chrome' ? { origen: entrada.origen } : {}),
      ...(Number.isFinite(Number(entrada.marcaFinMs))
        ? { marcaFinMs: Number(entrada.marcaFinMs) }
        : {}),
    },
    descarte: null,
  }
}

/**
 * Hora de VOZ del fin de un tramo: el ancla muestra↔reloj de la sesión más el
 * tiempo transcurrido desde su primera muestra. Es la hora REAL en que se habló
 * la frase (no la hora de escritura), así una fila dictada hace minutos y
 * escrita en el stop conserva su instante.
 * @param ancla Ancla de la sesión (null si aún no entró audio).
 * @param tramo Tramo a fechar.
 * @returns Milisegundos desde epoch, o `null` si no se puede fechar con honestidad
 *   (sin ancla o con frecuencias distintas: mezclar tasas inventaría una hora).
 */
export function horaDelFinDelTramo(
  ancla: AnclaAudio | null,
  tramo: TramoMuestreado,
): number | null {
  if (!ancla) return null
  const fin = Number(tramo.fin)
  const inicioAncla = Number(ancla.muestra)
  const rate = Number(ancla.sampleRate)
  if (!Number.isFinite(fin) || !Number.isFinite(inicioAncla) || !Number.isFinite(rate) || rate <= 0) {
    return null
  }
  if (Number(tramo.sampleRate) !== rate) return null
  if (fin < inicioAncla) return null
  return Math.round(Number(ancla.ms) + ((fin - inicioAncla) / rate) * 1000)
}

/**
 * Fila commiteada cuyo TRAMO se solapa con la ventana entrante: es la fila de la
 * que puede venir un prefijo ya escrito. Cuando varias solapan gana la de mayor
 * `fin` (la que cubre más audio).
 * @param tramo Ventana del texto que entra.
 * @param filas Filas vivas de la sesión.
 * @returns La fila que cubre la ventana, o null si ninguna la toca.
 */
export function filaQueCubre(tramo: TramoMuestreado, filas: Iterable<Fila>): Fila | null {
  const inicio = Number(tramo?.inicio)
  const fin = Number(tramo?.fin)
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null
  let cubre: Fila | null = null
  for (const fila of filas) {
    if (Number(fila.tramo.sampleRate) !== Number(tramo.sampleRate)) continue
    if (!(fila.tramo.fin > inicio && fin > fila.tramo.inicio)) continue
    if (!cubre || fila.tramo.fin > cubre.tramo.fin) cubre = fila
  }
  return cubre
}

/**
 * ¿La ventana del final cabe DENTRO del tramo cerrado de la locución?
 * (Caso 7+6: "frase completa" exige el asrFinal del turno con su ventana dentro
 * del tramo cerrado; un final con ventana ajena NO completa la fila.)
 * @param ventana Ventana declarada por el final del ASR.
 * @param tramo Tramo cerrado de la locución.
 * @returns `true` solo si la ventana es un sub-tramo del tramo (misma frecuencia).
 */
export function ventanaDentroDe(ventana: TramoMuestreado, tramo: TramoMuestreado): boolean {
  return (
    ventana.sampleRate === tramo.sampleRate &&
    ventana.inicio >= tramo.inicio &&
    ventana.fin <= tramo.fin
  )
}

/**
 * Última fila commiteada según el fin de su audio.
 *
 * Dueño único de «la última fila»: la cobertura de un pendiente y la
 * continuidad de la fila anterior lo consumen; nadie repite el recorrido.
 * @param filas Filas vivas de la sesión.
 * @returns La fila con mayor `tramo.fin`, o null si no hay filas.
 */
export function ultimaFilaPorFin(filas: Iterable<Fila>): Fila | null {
  let ultima: Fila | null = null
  for (const fila of filas) {
    if (!ultima || fila.tramo.fin > ultima.tramo.fin) ultima = fila
  }
  return ultima
}

/**
 * Fusiona evidencia de voz sin borrar lo ya medido con campos ausentes.
 * @param base Evidencia previa de la locución.
 * @param nueva Evidencia del resultado entrante, si la trae.
 * @returns Evidencia fusionada (la base si no hay nada nuevo).
 */
export function fusionarVoz(base: EvidenciaVoz, nueva: EvidenciaVoz | undefined): EvidenciaVoz {
  if (!nueva) return base
  // Una identidad POSITIVA manda sobre un intento anterior fallido: si la
  // medida temprana no alcanzó pero el cierre midió la voz, la fila no puede
  // quedarse en `Hablante XX`. El estado insuficiente solo se conserva cuando
  // la evidencia entrante NO trae voz medida y la base ya lo declaraba.
  const identidadPositiva = Boolean(
    String(nueva.vozId ?? '').trim() || String(nueva.hablante ?? '').trim(),
  )
  return {
    vozId: nueva.vozId ?? base.vozId,
    nombre: nueva.nombre ?? base.nombre,
    nombreConfirmado: nueva.nombreConfirmado ?? base.nombreConfirmado,
    hablante: nueva.hablante ?? base.hablante,
    continuidad: nueva.continuidad ?? base.continuidad,
    overlap: nueva.overlap ?? base.overlap,
    // El vector medido es evidencia de identidad y no se descarta al fusionar.
    vector: nueva.vector ?? base.vector,
    insuficiente:
      nueva.insuficiente ?? (identidadPositiva ? false : base.insuficiente),
  }
}
