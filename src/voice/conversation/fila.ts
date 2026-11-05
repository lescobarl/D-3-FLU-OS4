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
 *   3. medida con IDENTIDAD POSITIVA          → evidencia `medida`
 *   4. continuidad con la etiqueta anterior   → evidencia `continuidad`
 *   5. medida ANÓNIMA (`Hablante N`)          → evidencia `medida`
 *   6. etiqueta TEMPORAL (`Hablante ?`)       → evidencia `pendiente`
 *   7. semilla de la configuración            → evidencia `semilla`
 *
 * La etiqueta TEMPORAL es el mandato del dueño (2026-10-30): «puedes poner un
 * hablante temporal si aun no llega, y cuando lo tengas reemplazar». Se usa
 * cuando la fila NO tiene voz medida (sin `vozId` no hay plantilla, ni medida
 * anónima, ni continuidad): la fila nace con la pendiente y la medida tardía la
 * reemplaza (`AlmacenPort.actualizar`). Una voz YA medida conserva su etiqueta
 * —la medida no se descarta por el largo del tramo, solo se exige para ACUÑAR
 * una voz nueva—.
 *
 * `Hablante N` es una agrupación sin identidad (definición en
 * `speakerCore.isAutoSpeakerLabel`): no puede pisar la continuidad de una voz
 * ya etiquetada. Solo una medida con identidad positiva (etiqueta con nombre)
 * adelanta a la continuidad.
 *
 * `provisional` es `true` mientras el final del mismo tramo no haya llegado.
 * La fila commiteada es INMUTABLE (mandato del dueño 2026-10-30): no hay
 * consolidación ni promoción; el texto se decide ANTES del insert y el final
 * solo marca la frase completa de la locución abierta.
 */
import type { EvidenciaVoz } from './tipos.ts'
import type {
  EvidenciaEtiqueta,
  Fila,
  FilaNueva,
  IdiomaLocucion,
  MotivoCierre,
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
  /** Etiqueta TEMPORAL (`Hablante ?`) mientras la medida no ha llegado. */
  pendienteEtiqueta?: string
  /**
   * TIMBRE medido de la voz que cierra la locución (null si no hubo medida):
   * la fila lo guarda como evidencia del vínculo fila↔voz por timbre.
   */
  firma: readonly number[] | null
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
  // Una etiqueta anónima no es identidad: solo adelanta a la continuidad una
  // medida que SÍ identifica (etiqueta con nombre propio).
  const medidaIdentifica = hablante !== '' && !esEtiquetaAnonima(hablante)
  // Sin medida no se inventa identidad, pero la fila NUNCA queda «?»: se usa la
  // etiqueta anterior o la semilla de config (`Hablante 1`) y se conserva la
  // evidencia `pendiente` para que la medida tardía la reemplace.
  const respaldo = String(semilla || '').trim()
  const usaPendiente = Boolean(String(entrada.pendiente || '').trim())
  const candidatos: ReadonlyArray<EtiquetaResuelta> = [
    { etiqueta: voz.nombreConfirmado ? String(voz.nombre || '').trim() : '', evidencia: 'nombre' },
    // La plantilla casada identifica la voz física (anónima o con nombre): gana
    // a la continuidad con la fila anterior (A→B→A recupera la etiqueta de A).
    { etiqueta: String(voz.etiquetaVoz || '').trim(), evidencia: 'medida' },
    ...(medidaIdentifica ? [{ etiqueta: hablante, evidencia: 'medida' as const }] : []),
    { etiqueta: voz.continuidad ? String(anterior ?? '').trim() : '', evidencia: 'continuidad' },
    // Medida ANÓNIMA: solo existe si una medida acuñó la voz (vozId).
    { etiqueta: hablante, evidencia: 'medida' },
    // Sin voz medida no hay identidad que afirmar: evidencia TEMPORAL, pero
    // etiqueta de continuidad/semilla (regla 5: nunca «?»).
    { etiqueta: respaldo, evidencia: usaPendiente ? 'pendiente' : 'semilla' },
    { etiqueta: String(semilla || '').trim(), evidencia: 'semilla' },
  ]
  const elegido = candidatos.find((candidato) => candidato.etiqueta !== '')
  if (!elegido) throw new Error('semilla vacia: la etiqueta no puede quedar vacia')
  if (elegido.etiqueta === '?') throw new Error('etiqueta ? prohibida')
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
    },
    descarte: null,
  }
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
  return {
    vozId: nueva.vozId ?? base.vozId,
    nombre: nueva.nombre ?? base.nombre,
    nombreConfirmado: nueva.nombreConfirmado ?? base.nombreConfirmado,
    hablante: nueva.hablante ?? base.hablante,
    continuidad: nueva.continuidad ?? base.continuidad,
    overlap: nueva.overlap ?? base.overlap,
  }
}
