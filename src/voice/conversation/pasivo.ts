/**
 * SUPERFICIE PASIVA del módulo CONVERSACIÓN (modo wake sin conversación activa).
 *
 * La fila del usuario en modo pasivo la escribe el MISMO módulo: un solo
 * escritor de la fila del usuario para los dos modos. El escritor de App
 * (`conversationTurnRow`, retirado) era un segundo dueño de esa decisión y
 * quedó sustituido por esta superficie.
 *
 * Puro: sin `Date.now()` (reloj inyectado), sin acceso al store ni a los dueños
 * vivos del proyecto (llegan por `PuertoVistaFilas` y `UtilidadesFila`). La
 * ETIQUETA la decide el dueño del módulo (`resolverEtiqueta`, fila.ts), no el
 * diarizador retirado: una etiqueta anónima no pisa la continuidad de la voz
 * etiquetada y la fila nunca queda sin etiqueta ni en `?`.
 *
 * Reglas conservadas del escritor retirado (2026-10-26):
 *  - reutilización de la fila por IDENTIDAD DE TURNO (`turnId`), nunca por
 *    posición ni por la ventana de audio (dato informativo);
 *  - `replaceLast`: la emisión que crece reutiliza la fila del turno; el texto
 *    solo se INSERTA (nunca se muta una fila ya escrita), salvo el recorte
 *    posterior del ASR (regla «es fragmento» del MÓDULO, más abajo);
 *  - write-once del nombre propio: un `speaker_name_*` commiteado no se degrada
 *    con una etiqueta automática;
 *  - sin rótulo propio (sin evidencia acústica ni etiqueta distinta del
 *    respaldo) la fila nace SIN `speakerName` escrito: su rótulo lo da su VOZ
 *    al mostrar (regla A3 del dueño);
 *  - high-water de la clave automática: nunca baja.
 */
import { resolverEtiqueta } from './fila.ts'
import { decidirIdentidad } from './identidad.ts'
import { logCaughtError } from '../../lib/caughtError.ts'
import type {
  ConfigPort,
  EmbebedorPort,
  EntradaCompromisoUsuario,
  FilaVistaUsuario,
  IdPort,
  NuevaEntradaVista,
  PuertoVistaFilas,
  RegistroPort,
  RelojPort,
  ResultadoCompromisoUsuario,
  UtilidadesFila,
} from './ports.ts'

/**
 * DECISIÓN de escritura de la fila del usuario: ¿este payload ESCRIBE en la
 * conversación? Un SERVICIO (`effectOnly`) aplica su efecto y no escribe; el
 * COMMIT TEMPRANO (`userCommitOnly`) tampoco: la conversación solo lleva datos
 * consolidados (spec del dueño 2026-10-12).
 *
 * Función pura (no toca la vista) para poder probarla directamente.
 * @param payload Payload de resolución del turno.
 * @param opciones Texto disponible y hablabilidad de la frase.
 * @returns `true` si la fila del usuario debe escribirse.
 */
export function escribeFilaDeUsuario(
  payload: { effectOnly?: boolean; userCommitOnly?: boolean; rawOnly?: boolean } | null | undefined,
  { hayTexto = false, hablable = false } = {},
): boolean {
  if (payload?.effectOnly) return false
  if (payload?.userCommitOnly) return false
  return hayTexto && (!payload?.rawOnly || hablable)
}

/**
 * ¿El turno es CONOCIDO (tiene id)? Un `null`/`undefined`/`''` no identifica
 * nada y sin identidad no hay reutilización de fila (auditoría 2026-10-23).
 * Guard de tipo: en el `false` el valor queda como `number | string`.
 * @param valor Id del turno.
 * @returns `true` si el valor es un id de turno utilizable.
 */
function esTurnoConocido(valor: unknown): valor is number | string {
  return typeof valor === 'number' || (typeof valor === 'string' && String(valor).trim() !== '')
}

/**
 * ¿La fila puede pertenecer al turno `turnId`? Regla ÚNICA de identidad de
 * turno (auditoría 2026-10-23): sin identidad NO se reutiliza; se escribe fila
 * nueva, nunca se completa la fila de otro turno.
 * @param entry Fila de la vista.
 * @param turnId Turno del texto que se está commiteando.
 * @returns `true` si la fila es DEL MISMO turno (ambos ids conocidos e iguales).
 */
function filaPuedeSerDeEsteTurno(
  entry: { turnId?: number | string | null } | null | undefined,
  turnId: number | string | null | undefined,
): boolean {
  if (!entry) return false
  if (!esTurnoConocido(turnId) || !esTurnoConocido(entry.turnId)) return false
  return String(entry.turnId) === String(turnId)
}

/**
 * ¿La fila ya tiene un NOMBRE propio? Dos formas reales del mismo dato: un
 * `speakerId` derivado de un nombre (`speaker_name_*`) o un `speakerName`
 * propio CONGELADO. Un nombre propio commiteado no se reescribe.
 * @param entry Fila de la vista.
 * @param utilidades Utilidades delegadas (dueño único del predicado).
 * @returns `true` si la fila tiene nombre propio.
 */
function esNombrePropioDeFila(
  entry: { speakerId?: string | null; speakerName?: string } | null | undefined,
  utilidades: UtilidadesFila,
): boolean {
  if (String(entry?.speakerId || '').startsWith('speaker_name_')) return true
  return utilidades.nombrePropio(String(entry?.speakerName || '').trim())
}

/**
 * Ventana de audio del turno NORMALIZADA: `[inicio, fin)` finitos y ordenados,
 * o `null`. Dato informativo, nunca identidad de fila (auditoría 2026-10-24).
 * @param ventana Ventana cruda del llamador.
 * @returns Ventana válida o `null`.
 */
function normalizarVentanaDelTurno(
  ventana?: { inicio?: number; fin?: number } | null,
): { inicio: number; fin: number } | null {
  const inicio = Number(ventana?.inicio)
  const fin = Number(ventana?.fin)
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return null
  return { inicio, fin }
}

// --- REGLA «ES FRAGMENTO» (P9.67) -------------------------------------------
// El dueño retirado era `isFragmentOfLocution` (turnStream, fuera del alcance
// del proyecto). Se SUSTITUYE por el módulo: las PRIMITIVAS (palabras y
// compacto) se delegan a los dueños vivos por `UtilidadesFila`; la DECISIÓN
// (contigüidad + revisión ASR) vive aquí, con los mismos umbrales medidos.
// ---------------------------------------------------------------------------

/** Mínimo de compactos del trozo para aceptar una REVISIÓN (una frase corta no). */
const REVISION_MIN_COMPACT = 40
/** Cobertura mínima del tramo contiguo común sobre el trozo (medido: 0.910 y 0.859). */
const REVISION_MIN_COVERAGE = 0.8
/** Tope de celdas de la DP; por encima se conserva solo la vía exacta. */
const REVISION_MAX_PAIR_CELLS = 1000000

/**
 * Longitud del tramo CONTIGUO más largo común a `a` y `b` (subcadena, no
 * subsecuencia: «comer plato» NO es trozo de «vamos a comer del plato», aunque
 * las palabras aparezcan en ese orden). Algoritmo del dueño retirado, ahora
 * propiedad del módulo.
 * @param a Compacto de comparación del trozo.
 * @param b Compacto de comparación del todo.
 * @returns Longitud del tramo contiguo común más largo.
 */
function tramoContiguoComun(a: string, b: string): number {
  if (!a || !b) return 0
  let mejor = 0
  let previo = new Uint32Array(b.length + 1)
  let actual = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        actual[j] = previo[j - 1] + 1
        if (actual[j] > mejor) mejor = actual[j]
      } else {
        actual[j] = 0
      }
    }
    const intercambio = previo
    previo = actual
    actual = intercambio
  }
  return mejor
}

/**
 * ¿La REVISIÓN del ASR de la misma locución? Un trozo contiguo común ≥80% de un
 * trozo suficientemente largo; por debajo no hay revisión (frase nueva).
 * @param parte Texto candidato a trozo.
 * @param todo Texto completo (la fila ya escrita).
 * @param utilidades Utilidades delegadas (compacto).
 * @returns `true` si el trozo es la revisión del ASR del todo.
 */
function esRevisionAsr(parte: string, todo: string, utilidades: UtilidadesFila): boolean {
  const cp = utilidades.compactar(parte)
  const cw = utilidades.compactar(todo)
  if (cp.length < REVISION_MIN_COMPACT || cp.length >= cw.length) return false
  if (cp.length * cw.length > REVISION_MAX_PAIR_CELLS) return false
  return tramoContiguoComun(cp, cw) >= Math.ceil(cp.length * REVISION_MIN_COVERAGE)
}

/**
 * ¿`parte` es un FRAGMENTO de `todo`? — contiguo exacto (todas sus palabras, en
 * orden y seguidas) o la revisión del ASR de la misma locución. Un trozo del
 * ASR a mitad de frase lo cumple; una frase nueva no. Es la regla del recorte
 * posterior (P9.67): el wake recorta la locución y el commit llega con la
 * MISMA frase, que debe reutilizar la fila del turno, no duplicarla.
 * @param parte Texto candidato a trozo (más corto que el todo).
 * @param todo Texto completo (la fila ya escrita).
 * @param utilidades Utilidades delegadas (palabras y compacto).
 * @returns `true` si `parte` es fragmento de `todo`.
 */
function esFragmentoDeLocucion(parte: string, todo: string, utilidades: UtilidadesFila): boolean {
  const p = utilidades.palabras(parte)
  const w = utilidades.palabras(todo)
  if (!p.length || p.length >= w.length) return false
  for (let i = 0; i + p.length <= w.length; i += 1) {
    let ok = true
    for (let j = 0; j < p.length; j += 1) {
      if (p[j] !== w[i + j]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return esRevisionAsr(parte, todo, utilidades)
}

/** Dependencias del escritor de la fila del usuario en modo pasivo. */
export type DependenciasEscritorFila = Readonly<{
  vista: PuertoVistaFilas
  utilidades: UtilidadesFila
  config: Pick<ConfigPort, 'esEtiquetaAnonima' | 'semillaEtiqueta'>
  id: IdPort
  reloj: RelojPort
  registro: RegistroPort
}>

/** Escritor de la fila del usuario en modo pasivo (único dueño de esa fila). */
export type EscritorFilaUsuario = Readonly<{
  /** Compromete la fila del usuario del turno (reutiliza, reemplaza o agrega). */
  commitUserTurnRow(entrada: EntradaCompromisoUsuario): ResultadoCompromisoUsuario
  /** Corrige el nombre de UNA fila concreta de usuario por su id (migración). */
  renameRowSpeakerName(rowId: string, speakerName: string): boolean
}>

/** Turno actual del escritor: id y la fila que le pertenece (reúso por identidad). */
type TurnoActual = { id: number | string | null; rowId: string | null }

/**
 * Etiqueta de CONTINUIDAD de la vista: la última etiqueta ANÓNIMA de una fila
 * de usuario del mismo epoch. Sustituye a `continuityLabelForTurn` del
 * diarizador retirado: sin clusters de sesión, el historial visible ES el
 * registro de la sesión. Nunca devuelve un nombre propio (no se hereda sin
 * medida) ni la etiqueta pendiente.
 * @param historial Filas visibles, de la más antigua a la más reciente.
 * @param epochDeLaFila Epoch de la fila que se está escribiendo.
 * @param utilidades Utilidades delegadas.
 * @param config Config del módulo (predicado de etiqueta anónima).
 * @returns Etiqueta de continuidad, o `''` si no hay.
 */
function continuidadPasiva(
  historial: readonly FilaVistaUsuario[],
  epochDeLaFila: number,
  utilidades: UtilidadesFila,
  config: Pick<ConfigPort, 'esEtiquetaAnonima'>,
): string {
  const pendiente = utilidades.etiquetaPendiente()
  for (let i = historial.length - 1; i >= 0; i -= 1) {
    const fila = historial[i]
    if (fila?.role !== 'user') continue
    if (Number.isFinite(Number(fila.epoch)) && Number(fila.epoch) !== Number(epochDeLaFila)) continue
    const nombre = String(fila.speakerName || '').trim()
    if (!nombre || nombre === pendiente) continue
    if (!config.esEtiquetaAnonima(nombre)) continue
    return nombre
  }
  return ''
}

/**
 * CONGELA el nombre resuelto en la fila: el nombre se escribe y no se
 * re-resuelve desde el directorio. No DEGRADA un nombre propio ya congelado
 * con una etiqueta automática.
 * @param rowId Fila de la vista.
 * @param resuelto Etiqueta resuelta por el módulo.
 * @param deps Dependencias del escritor.
 */
function congelarNombre(rowId: string, resuelto: string, deps: DependenciasEscritorFila): void {
  const fila = deps.vista.leerHistorial().find((e) => e.id === rowId)
  const actual = String(fila?.speakerName || '').trim()
  if (deps.utilidades.nombrePropio(actual) && !deps.utilidades.nombrePropio(resuelto)) return
  deps.vista.fijarNombre(rowId, resuelto)
}

/**
 * Compromiso de la fila del usuario: decisión del módulo, escritura delegada a
 * la vista por puerto. Misma regla de reutilización que el escritor retirado
 * (identidad de turno, write-once del nombre, insert-only del texto).
 * @param deps Dependencias del escritor.
 * @param estado Turno actual del escritor (mutación privada del factory).
 * @param entrada Entrada del compromiso.
 * @returns Id de la fila y acción realizada.
 */
function commitUserTurnRowInner(
  deps: DependenciasEscritorFila,
  estado: TurnoActual,
  entrada: EntradaCompromisoUsuario,
): ResultadoCompromisoUsuario {
  const { vista, utilidades, config, id, reloj } = deps
  const raw = String(entrada.text || '')
  const norm = utilidades.normalizar(raw).toLowerCase()
  if (!norm) return { id: null, action: 'skipped' }

  const historial = vista.leerHistorial()
  const epochDeLaFila = Number.isFinite(Number(entrada.epoch)) ? Number(entrada.epoch) : vista.epoch()

  // Frontera del turno actual: todo lo posterior a la última respuesta de FLU.
  let turnStart = 0
  for (let i = historial.length - 1; i >= 0; i -= 1) {
    if (historial[i]?.role === 'flu') {
      turnStart = i + 1
      break
    }
  }

  const respaldo = utilidades.respaldoEtiqueta()
  const aportado = String(entrada.speakerName || '').trim()
  const resolved = aportado || respaldo

  // LA VOZ de la fila (no su nombre): la clave es el TIMBRE cuando se midió
  // (mismo timbre = misma clave aunque cambie la etiqueta del turno).
  const vozDeLaFila = utilidades.claveVoz({
    voiceId: utilidades.claveDeEtiqueta(resolved),
    signature: entrada.signature ?? null,
  })
  // HIGH-WATER de la sesión: la clave automática fija el número usado (nunca baja).
  vista.anotarHighWater(utilidades.indiceAltoDeClave(vozDeLaFila))

  // ETIQUETA: la decide el dueño del módulo (`resolverEtiqueta`). Una etiqueta
  // anónima o ausente NO pisa la continuidad de la voz etiquetada (mandato del
  // escritor retirado: la continuidad aplica SIN medida); un nombre propio del
  // que llama sí adelanta. Con EVIDENCIA ACÚSTICA la etiqueta anónima medía es
  // de ESTA voz y se respeta (decisión A: dos voces → dos etiquetas). Nunca `?`.
  const pendiente = utilidades.etiquetaPendiente()
  const esAnonima = config.esEtiquetaAnonima(resolved)
  const resuelta = resolverEtiqueta({
    voz: {
      nombre: '',
      nombreConfirmado: false,
      hablante: resolved,
      continuidad: aportado === '' || (esAnonima && entrada.evidenciaAcustica !== true),
    },
    anterior: continuidadPasiva(historial, epochDeLaFila, utilidades, config),
    semilla: config.semillaEtiqueta(),
    esEtiquetaAnonima: config.esEtiquetaAnonima,
  }).etiqueta
  // RÓTULO VISIBLE: un nombre propio se muestra CANÓNICO (`luis` → `Luis`), como
  // lo resolvía el escritor retirado (`resolveRowVisibleLabel`); las automáticas
  // y la pendiente pasan tal cual.
  const etiqueta = utilidades.nombrePropio(resuelta) ? utilidades.canonica(resuelta) : resuelta

  // SIN IDENTIDAD al escribir: la fila lleva la CONTINUIDAD (nunca «?») y queda
  // marcada para que se complete cuando llegue una medida (mismo contrato que
  // el escritor retirado).
  const faltabaIdentidad = resolved === pendiente
  // RÓTULO PROPIO: sin evidencia ni etiqueta propia la fila nace SIN hablante
  // escrito (regla A3 del dueño); su rótulo lo da su VOZ al mostrar.
  const hayRotuloPropio = entrada.evidenciaAcustica === true || resolved !== respaldo
  const stamp = typeof entrada.timestamp === 'number' ? entrada.timestamp : reloj.ahora()
  const ventanaDelTurno = normalizarVentanaDelTurno(entrada.turnWindow)
  const sentimiento = entrada.sentiment ?? 'neutral'
  const firma = utilidades.normalizarFirma(entrada.signature ?? null)
  const turnId = entrada.turnId ?? null
  const replaceLast = entrada.replaceLast === true

  // 1) Emisión que crece: la fila del turno se reutiliza (UNA), pero su TEXTO
  //    no se reescribe — la conversación solo se INSERTA (spec del dueño
  //    2026-10-12). Aquí solo se completa el hablante.
  if (replaceLast) {
    for (let i = historial.length - 1; i >= turnStart; i -= 1) {
      const entry = historial[i]
      if (!entry || entry.role !== 'user') continue
      // IDENTIDAD DE TURNO: la fila que se reutiliza tiene que ser de ESTE turno
      // (auditoría 2026-10-22: por texto se podía completar la fila de otro turno).
      if (!filaPuedeSerDeEsteTurno(entry, turnId)) continue
      // WRITE-ONCE del NOMBRE: un nombre propio ya commiteado no se reescribe.
      if (esNombrePropioDeFila(entry, utilidades)) {
        return { id: entry.id, action: 'reused' }
      }
      vista.fijarAltavoz(entry.id, vozDeLaFila, { firma })
      if (hayRotuloPropio) congelarNombre(entry.id, etiqueta, deps)
      return { id: entry.id, action: 'reused' }
    }
    // RECORTE POSTERIOR (P9.67): si el texto es un TROZO contiguo de la última
    // fila de usuario del MISMO turno (o al revés), la fila se REUTILIZA — el
    // wake recorta la locución y el commit llega con la MISMA frase. La regla
    // «es fragmento» es del MÓDULO (`esFragmentoDeLocucion`, arriba).
    const ultima = [...historial]
      .reverse()
      .find((e) => e?.role === 'user' && filaPuedeSerDeEsteTurno(e, turnId))
    if (ultima) {
      const previo = String(ultima.text || '')
      const rawEsTrozo = esFragmentoDeLocucion(raw, previo, utilidades)
      const previoEsTrozo = !rawEsTrozo && esFragmentoDeLocucion(previo, raw, utilidades)
      if (rawEsTrozo || previoEsTrozo) {
        if (!esNombrePropioDeFila(ultima, utilidades)) {
          vista.fijarAltavoz(ultima.id, vozDeLaFila, { firma })
          if (hayRotuloPropio) congelarNombre(ultima.id, etiqueta, deps)
        }
        if (previoEsTrozo) vista.completarFragmento(ultima.id, raw)
        return { id: ultima.id, action: rawEsTrozo ? 'reused' : 'replaced' }
      }
    }
  }

  // 2) MISMO TURNO: la fila se reutiliza por IDENTIDAD de turno. El commit
  //    temprano y la resolución del mismo turno comparten `turnId`; el habla de
  //    FLU en medio NO duplica la fila, y una locución distinta no se fusiona
  //    aunque FLU no haya hablado. Tras el corte (2026-10-26) el MOTOR escribe
  //    primero la fila del turno (`row.committed`): este escritor la COMPLETA
  //    (hablante/firma) por la misma identidad, sin agregar una segunda.
  const mismoTurnoPorId =
    esTurnoConocido(turnId) &&
    esTurnoConocido(estado.id) &&
    estado.id === turnId &&
    estado.rowId != null
  let filaDelTurno: FilaVistaUsuario | null = null
  if (mismoTurnoPorId) {
    const propia = historial.find((e) => e.id === estado.rowId)
    if (propia && propia.role === 'user') filaDelTurno = propia
  }
  // La fila del turno pudo escribirla YA el motor (la vista es compartida): se
  // busca la del MISMO turno, de la más reciente a la más antigua, DENTRO del
  // mismo epoch (el número de turno se reinicia por sesión: una fila de una
  // conversación anterior no es de ESTE turno). Reutiliza SOLO con relación de
  // texto (igual, trozo o crecimiento — la misma regla P9.67 del recorte): una
  // frase nueva del mismo turno NO reutiliza la fila anterior.
  if (!filaDelTurno && esTurnoConocido(turnId)) {
    for (let i = historial.length - 1; i >= 0; i -= 1) {
      const entry = historial[i]
      if (entry?.role !== 'user' || !filaPuedeSerDeEsteTurno(entry, turnId)) continue
      if (
        Number.isFinite(Number(entry.epoch)) &&
        Number(entry.epoch) !== Number(epochDeLaFila)
      ) {
        continue
      }
      const previo = String(entry.text || '')
      const mismoTexto = utilidades.compactar(raw) === utilidades.compactar(previo)
      const rawEsTrozo = !mismoTexto && esFragmentoDeLocucion(raw, previo, utilidades)
      const previoEsTrozo = !mismoTexto && !rawEsTrozo && esFragmentoDeLocucion(previo, raw, utilidades)
      if (!mismoTexto && !rawEsTrozo && !previoEsTrozo) continue
      filaDelTurno = entry
      break
    }
  }
  if (filaDelTurno) {
    if (esNombrePropioDeFila(filaDelTurno, utilidades)) {
      return { id: filaDelTurno.id, action: 'reused' }
    }
    vista.fijarAltavoz(filaDelTurno.id, vozDeLaFila, { firma })
    if (hayRotuloPropio) congelarNombre(filaDelTurno.id, etiqueta, deps)
    return { id: filaDelTurno.id, action: 'reused' }
  }

  // 3) Fila nueva del turno.
  const rowId = id.uuid()
  const entradaVista: NuevaEntradaVista = {
    id: rowId,
    role: 'user',
    epoch: epochDeLaFila,
    text: raw,
    speakerId: vozDeLaFila,
    // El TURNO viaja con la fila (identidad durable): sin este dato la fila no
    // se puede reutilizar ni completar con seguridad.
    ...(esTurnoConocido(turnId) ? { turnId } : {}),
    // SIN RÓTULO PROPIO no se escribe nada en la fila (regla A3): el respaldo
    // jamás se estampa aquí.
    ...(hayRotuloPropio ? { speakerName: etiqueta } : {}),
    ...(faltabaIdentidad ? { speakerPending: true } : {}),
    ...(ventanaDelTurno ? { turnWindow: ventanaDelTurno } : {}),
    timestamp: stamp,
    sentiment: sentimiento,
    signature: firma,
  }
  vista.agregarEntrada(entradaVista)
  estado.id = turnId
  estado.rowId = rowId
  return { id: rowId, action: 'added' }
}

/**
 * Crea el escritor de la fila del usuario en modo pasivo: la MISMA puerta para
 * los dos modos del producto. El estado de turno vive en el factory (como el
 * escritor retirado) y se registra cada compromiso con su contexto.
 * @param deps Dependencias del escritor (vista, utilidades, config, id, reloj, registro).
 * @returns El escritor con `commitUserTurnRow` y `renameRowSpeakerName`.
 */
export function crearEscritorFilaUsuario(deps: DependenciasEscritorFila): EscritorFilaUsuario {
  const estado: TurnoActual = { id: null, rowId: null }

  /** Compromiso con registro: un hecho por fila, con su contexto. */
  function comprometerFila(entrada: EntradaCompromisoUsuario): ResultadoCompromisoUsuario {
    const resultado = commitUserTurnRowInner(deps, estado, entrada)
    const texto = String(entrada.text || '')
    deps.registro.registrar('conversacion.pasivo.fila', {
      action: resultado.action,
      id: resultado.id,
      len: texto.length,
      text: texto,
      speaker: String(entrada.speakerName || ''),
      evidencia: entrada.evidenciaAcustica === true,
      turnId: entrada.turnId ?? null,
    })
    return resultado
  }

  /** Renombre de UNA fila concreta por su id (migración de la fachada). */
  function renombrarFila(rowId: string, speakerName: string): boolean {
    const idFila = String(rowId || '')
    const nombre = deps.utilidades.canonica(String(speakerName || '').trim())
    if (!idFila || !nombre) return false
    const entry = deps.vista.leerHistorial().find((e) => e.id === idFila)
    if (!entry || entry.role !== 'user') return false
    deps.vista.fijarNombre(idFila, nombre)
    return true
  }

  return { commitUserTurnRow: comprometerFila, renameRowSpeakerName: renombrarFila }
}

/**
 * RESOLUCIÓN PASIVA del hablante (identidad nativa por puerto, decisión A).
 *
 * La MEDIDA la hace el embebedor del módulo (`EmbebedorPort.medir`, que ya
 * recorta la ventana de voz con `selectVoicedWindow`); la regla de identidad
 * es `decidirIdentidad` — el MISMO dueño único que usan `ingesta` y `cierre` —;
 * la ETIQUETA la decide `resolverEtiqueta` dentro del escritor (sin preflight
 * ni diarizador: un dueño de etiqueta para los dos modos). Un fallo de la
 * medida se registra y la locución sigue SIN evidencia (regla A3 del escritor).
 */

/** Entrada de la resolución: audio retenido y memoria de voz de la sesión. */
export type EntradaResolucionPasiva = Readonly<{
  /** PCM retenido de la locución (cola ya acotada por el llamador). */
  muestras: Float32Array
  /** Frecuencia de las muestras. */
  sampleRate: number
  /** Voz de la última locución medida, si la sesión midió alguna. */
  ultimoVozId: string
  /** Vector de la última voz; `null` si la sesión no midió ninguna. */
  ultimoVector: readonly number[] | null
  /** Voces nuevas acuñadas hasta ahora (para la etiqueta anónima N+1). */
  contadorVoces: number
}>

/** Resultado de la resolución: la voz que sostiene la locución y su evidencia. */
export type ResolucionPasiva = Readonly<{
  /** Voz decidida; `''` cuando no hubo medida (el escritor aplica A3). */
  vozId: string
  /** Etiqueta anónima SOLO para una voz nueva; la continuidad la hereda. */
  hablante: string
  /** ¿Es la misma voz que la locución anterior? */
  continuidad: boolean
  /** Hubo ventana medida: el rótulo propio está permitido (regla A3). */
  evidencia: boolean
  /** Vector MEDIDO de la locución (la MISMA medida sirve de firma del turno); `null` sin medida. */
  vector: readonly number[] | null
}>

/** Dependencias de la resolución pasiva: medida y reglas, todo inyectado. */
export type DependenciasResolucionPasiva = Readonly<{
  embebedor: EmbebedorPort
  config: Pick<ConfigPort, 'umbralContinuidadVoz' | 'etiquetaAnonima'>
  id: Pick<IdPort, 'uuid'>
  registro: RegistroPort
}>

/** Resolutor del hablante del modo pasivo (medida asíncrona). */
export type ResolucionPasivaHablante = (
  entrada: EntradaResolucionPasiva,
) => Promise<ResolucionPasiva>

/**
 * Crea el resolutor del hablante del modo pasivo: mismo patrón de medida y
 * decisión que el cierre del modo activo (`cierre.medirVozAlCerrar`).
 * @param deps Embebedor, config de identidad, generador de ids y registro.
 * @returns El resolutor `resolverHablante`.
 */
export function crearResolucionPasiva(deps: DependenciasResolucionPasiva): ResolucionPasivaHablante {
  return async function resolverHablante(entrada: EntradaResolucionPasiva): Promise<ResolucionPasiva> {
    let vector: readonly number[] | null = null
    try {
      vector = await deps.embebedor.medir(entrada.muestras, entrada.sampleRate)
    } catch (error) {
      // AGENTS §1.5: el catch registra por logCaughtError con la excepción.
      logCaughtError('conversacion.pasivo.voz.medida.fallo', error)
    }
    if (!vector) {
      return { vozId: '', hablante: '', continuidad: false, evidencia: false, vector: null }
    }
    const identidad = decidirIdentidad({
      vector,
      ultimoVozId: entrada.ultimoVozId,
      ultimoVector: entrada.ultimoVector,
      umbral: deps.config.umbralContinuidadVoz(),
      etiquetaNueva: deps.config.etiquetaAnonima(entrada.contadorVoces + 1),
      comparar: deps.embebedor.comparar,
      id: deps.id.uuid,
    })
    return {
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      continuidad: identidad.continuidad,
      evidencia: true,
      vector,
    }
  }
}
