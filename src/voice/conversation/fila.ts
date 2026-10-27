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
 *   2. medida con IDENTIDAD POSITIVA          → evidencia `medida`
 *   3. continuidad con la etiqueta anterior   → evidencia `continuidad`
 *   4. medida ANÓNIMA (`Hablante N`)          → evidencia `medida`
 *   5. semilla de la configuración            → evidencia `semilla`
 *
 * `Hablante N` es una agrupación sin identidad (definición en
 * `speakerCore.isAutoSpeakerLabel`): no puede pisar la continuidad de una voz
 * ya etiquetada. Solo una medida con identidad positiva (etiqueta con nombre)
 * adelanta a la continuidad.
 *
 * `provisional` es `true` mientras el final del mismo tramo no haya llegado; la
 * promoción reutiliza `decidirRevision` (regla 3, un solo dueño de la no-pérdida)
 * y solo cambia texto/provisional. No hay borrado físico ni mutación de entrada.
 */
import { decidirRevision } from './revision.ts'
import type { EvidenciaVoz } from './tipos.ts'
import type {
  CambiosFila,
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
}>

/** Entrada para resolver la etiqueta: voz, etiqueta anterior y semilla. */
export type EntradaEtiqueta = Readonly<{
  voz: VozEtiqueta
  anterior: string | null
  semilla: string
  /** Predicado de etiqueta anónima (`Hablante N`/pendiente): no es identidad. */
  esEtiquetaAnonima: (etiqueta: string) => boolean
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
  const candidatos: ReadonlyArray<EtiquetaResuelta> = [
    { etiqueta: voz.nombreConfirmado ? String(voz.nombre || '').trim() : '', evidencia: 'nombre' },
    ...(medidaIdentifica ? [{ etiqueta: hablante, evidencia: 'medida' as const }] : []),
    { etiqueta: voz.continuidad ? String(anterior ?? '').trim() : '', evidencia: 'continuidad' },
    { etiqueta: hablante, evidencia: 'medida' },
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
      idioma: entrada.idioma,
      overlap: Boolean(entrada.overlap),
      provisional: !entrada.final,
      reason: entrada.reason,
    },
    descarte: null,
  }
}

/**
 * Promueve una fila provisional cuando llega el final del MISMO tramo.
 * La revisión del texto la decide `decidirRevision`: si el final pierde palabras,
 * conserva el texto ya escrito. Una fila borrada lógicamente no se promueve.
 *
 * @param fila Fila ya persistida del tramo.
 * @param textoFinal Texto del resultado final del ASR.
 * @returns Cambios a aplicar, o `null` si no hay nada que escribir.
 */
export function promoverFila(fila: Fila, textoFinal: string): CambiosFila | null {
  if (fila.deleted) return null
  const decision = decidirRevision({
    tramoAbierto: { id: fila.locutionId, texto: fila.texto },
    tramoId: fila.locutionId,
    texto: textoFinal,
    final: true,
  })
  if (decision.texto === fila.texto && !fila.provisional) return null
  return { texto: decision.texto, provisional: false }
}

/**
 * Cambios que consolidan una locución que cierra en la fila YA commiteada del
 * MISMO turno (Caso 8: un turnId => UNA fila por sesión).
 *
 *  - Ventana solapada (mismo origen de audio) o texto emparentado: REEMISIÓN
 *    del mismo contenido — la revisión decide el texto y la fila nunca pierde
 *    palabras.
 *  - Ventana disjunta y texto no emparentado: CONTINUACIÓN del turno — la fila
 *    crece con el texto nuevo (el usuario siguió hablando tras la pausa).
 *
 * `final` completa la fila. El tramo solo se extiende con contenido nuevo
 * (mismo origen de audio o texto que creció): un re-delivery idéntico con
 * ventana disjunta NO toca la fila.
 * @param previa Fila ya commiteada del turno.
 * @param nueva Locución que cierra con el MISMO `turnId`.
 * @returns Cambios a aplicar, o `null` si no hay nada que escribir.
 */
export function consolidarFilaDelTurno(previa: Fila, nueva: CierreLocucion): CambiosFila | null {
  if (previa.deleted) return null
  const siguiente = String(nueva.texto || '').trim()
  const mismoOrigen =
    nueva.sampleRate === previa.tramo.sampleRate && nueva.inicio < previa.tramo.fin
  const emparentado =
    siguiente !== '' &&
    (siguiente === previa.texto ||
      siguiente.startsWith(previa.texto) ||
      previa.texto.startsWith(siguiente))
  let texto: string | undefined
  if (siguiente && (mismoOrigen || emparentado)) {
    const decision = decidirRevision({
      tramoAbierto: { id: previa.locutionId, texto: previa.texto },
      tramoId: previa.locutionId,
      texto: siguiente,
      final: true,
    })
    if (decision.texto !== previa.texto) texto = decision.texto
  } else if (siguiente) {
    texto = `${previa.texto} ${siguiente}`.trim()
  }
  const finExtendido =
    (mismoOrigen || texto !== undefined) &&
    nueva.sampleRate === previa.tramo.sampleRate &&
    Number(nueva.fin) > previa.tramo.fin
      ? Number(nueva.fin)
      : undefined
  const cambios: CambiosFila = {
    ...(texto !== undefined ? { texto } : {}),
    ...(nueva.final && previa.provisional ? { provisional: false } : {}),
    ...(finExtendido !== undefined ? { tramo: { ...previa.tramo, fin: finExtendido } } : {}),
  }
  return Object.keys(cambios).length > 0 ? cambios : null
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
