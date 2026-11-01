/**
 * CIERRE de la locución: apertura, revisión, etiqueta, fila y descarte.
 *
 * Es la única puerta que escribe filas del módulo: aplica `decidirRevision`
 * (regla 3), `construirFila` (reglas 4–5) y las INSERTA por el almacén. Una fila
 * commiteada es INMUTABLE (mandato del dueño 2026-10-30) salvo UNA cosa: el
 * HABLANTE. Una fila que nació con la etiqueta TEMPORAL (`pendiente`) y recibe
 * después una medida fiable se REETIQUETA por `AlmacenPort.actualizar` — «puedes
 * poner un hablante temporal si aun no llega, y cuando lo tengas reemplazar; ese
 * es el único campo de la conversación que se puede actualizar». La reentrega de
 * un turno ya commiteado se ignora (descarte contado) y una voz distinta medida
 * inserta SU fila. El estado lo posee la sesión, que lo entrega como contexto.
 */
import { construirFila, fusionarVoz } from './fila.ts'
import { continuaLaFrase } from '../core/locucion.js'
import type { CierreLocucion, VozEtiqueta } from './fila.ts'
import { decidirRevision } from './revision.ts'
import { decidirIdentidad, plantillasDe } from './identidad.ts'
import type { PlantillaVoz } from './identidad.ts'
import { registrarMedidaVoz } from './sesion.ts'
import { concatenarMuestras } from './muestras.ts'
import { logCaughtError } from '../../lib/caughtError.ts'
import { recordSessionEvent } from '../api/sessionLog.ts'
import type {
  CausaCierre,
  ContarDescarte,
  EventoConversacion,
  EvidenciaVoz,
  LocucionAbierta,
} from './tipos.ts'
import type {
  AlmacenPort,
  ConfigPort,
  EmbebedorPort,
  Fila,
  IdiomaLocucion,
  IdPort,
  MedidaFinal,
  MedidaMotor,
  MedidorTramoPort,
  MotivoCierre,
  RegistroPort,
  TramoMuestreado,
} from './ports.ts'

/** Parte del estado de sesión que consumen las reglas de cierre. */
export type EstadoCierre = {
  sessionId: string | null
  abierta: LocucionAbierta | null
  ultimaEtiqueta: string
  filas: Map<string, Fila>
  nombresPorVoz: Map<string, string>
  plantillasVoz: Map<string, PlantillaVoz>
  muestrasAbierta: Float32Array[]
  /** Tramos cuyo audio ya entró en `muestrasAbierta` (dueño del anti-duplicado). */
  tramosDeLaAbierta: Set<string>
  /** Muestras retenidas en el último intento de medida temprana (freno). */
  muestrasEnUltimoIntento: number
  contadorVoces: number
  /** Bautizo pendiente del comando «ok flu soy X» (problema 5). */
  nombrePendiente: string
}

/** Servicios que la sesión entrega a las reglas de cierre. */
export type ContextoCierre = Readonly<{
  estado: EstadoCierre
  emitir(evento: EventoConversacion): void
  emitirCaja(): void
  contarDescarte: ContarDescarte
  registro: RegistroPort
  almacen: AlmacenPort
  config: ConfigPort
  /** Generador UUIDv4: la voz nueva acuña su identidad (medida de respaldo). */
  id: IdPort
  /** Embeddings inyectados; sin puerto no hay medida (solo continuidad/semilla). */
  embebedor?: EmbebedorPort
  /** Medidor del tramo cerrado (Caso 7+6): obligatorio, nada de medida null. */
  medidor: MedidorTramoPort
}>

/** Datos de apertura de la única locución abierta. */
export type DatosApertura = Readonly<{
  tramoId: string
  texto: string
  tramo: TramoMuestreado
  turnId: string
  idioma: IdiomaLocucion
  voz: EvidenciaVoz
  /** ¿El final del ASR ya llegó? (Caso 7+6: marca la frase completa.) */
  finalLlego?: boolean
  /** Métricas del motor para el final (pueden faltar). */
  medidaMotor?: MedidaMotor
  /**
   * PCM del tramo cuando la locución nace de un pendiente ya hablado: la
   * evidencia de voz de la fila es SU audio, no el que venga después.
   */
  muestrasIniciales?: readonly Float32Array[]
}>

/** Reglas de cierre que la sesión publica en su superficie. */
export type ReglasCierre = Readonly<{
  abrirLocucion(datos: DatosApertura): void
  aplicarRevision(
    locucion: LocucionAbierta,
    texto: string,
    final: boolean,
    voz: EvidenciaVoz,
    medida?: MedidaMotor,
  ): boolean
  cerrarLocucion(
    locucion: LocucionAbierta,
    motivo: MotivoCierre,
    causa: CausaCierre,
    final: boolean,
  ): Promise<void>
  /**
   * Reemplaza la etiqueta TEMPORAL de una fila por la de su medida tardía. Es la
   * ÚNICA actualización que admite una fila (mandato del dueño 2026-10-30) y solo
   * mientras su evidencia sea `pendiente`: después, la fila vuelve a ser inmutable.
   * @param locucionId Fila commiteada a reetiquetar.
   * @param vozId Voz medida que identifica al hablante de esa fila.
   * @param hablante Etiqueta de la medida (nombre registrado o `Hablante N`).
   * @returns `true` si la fila existía con etiqueta pendiente y se actualizó.
   */
  reetiquetarFila(locucionId: string, vozId: string, hablante: string): Promise<boolean>
  tramoYaCommiteado(tramoId: string): boolean
}>

/**
 * Resuelve la evidencia de voz de una locución con el nombre registrado y la
 * plantilla de la sesión, si los hay. Es pura: la sesión aporta el mapa
 * voz→nombre, las plantillas medidas y la continuidad ya calculada.
 * @param voz Evidencia de voz del tramo.
 * @param continuidadVoz Continuidad calculada por el módulo al abrir o al recibir la primera medida.
 * @param nombresPorVoz Nombres confirmados por voz en la sesión.
 * @param plantillasVoz Plantillas de las voces medidas en la sesión.
 * @returns La voz resuelta que consume `resolverEtiqueta`.
 */
/**
 * ¿La locucion nueva es reentrega del turno ya commiteado? Es reentrega si
 * repite el texto o si lo CONTINUA/revisa (`continuaLaFrase`). Una frase NUEVA
 * del mismo turno no lo es y debe escribir su fila (antes se perdia).
 * @param previo Texto de la fila ya commiteada del turno.
 * @param texto Texto de la locucion que cierra.
 */
export function esReentregaDeTurno(previo: string, texto: string): boolean {
  const anterior = String(previo || '').trim()
  const actual = String(texto || '').trim()
  if (!anterior || !actual) return false
  return anterior === actual || continuaLaFrase(anterior, actual)
}

export function resolverVoz(
  voz: EvidenciaVoz,
  continuidadVoz: boolean,
  nombresPorVoz: ReadonlyMap<string, string>,
  plantillasVoz: ReadonlyMap<string, PlantillaVoz>,
): VozEtiqueta {
  const vozId = String(voz.vozId || '').trim()
  const registrado = vozId ? nombresPorVoz.get(vozId) : undefined
  const nombre =
    registrado ?? (voz.nombreConfirmado ? String(voz.nombre || '').trim() : '')
  return {
    nombre,
    nombreConfirmado: Boolean(nombre),
    hablante: String(voz.hablante || '').trim(),
    // La continuidad la decide el MÓDULO (`abrirLocucion`/`aplicarRevision`):
    // la evidencia entrante no puede afirmar que otra voz continúa la anterior.
    continuidad: continuidadVoz,
    // Etiqueta de la plantilla casada (problema 4): la voz que vuelve recupera
    // SU etiqueta y no hereda la de la fila anterior (A→B→A devuelve la de A).
    etiquetaVoz: vozId ? plantillasVoz.get(vozId)?.etiqueta || undefined : undefined,
  }
}

/**
 * Mide el tramo CERRADO de la locución (Caso 7+6): `ms` sale del tramo del
 * módulo `((fin-inicio)/sampleRate)*1000`; `speechLikeMs`/`rms` los calcula el
 * medidor inyectado sobre el PCM retenido. Nada queda null.
 * @param tramo Tramo cerrado que se commitea (es el que se mide).
 * @param bloques PCM retenido de la locución abierta.
 * @param medidor Medidor inyectado (dueños únicos en voicedActivity).
 * @returns Medida completa del tramo cerrado, nunca null.
 */
export function medirTramoCerrado(
  tramo: TramoMuestreado,
  bloques: readonly Float32Array[],
  medidor: MedidorTramoPort,
): MedidaFinal {
  const ms = ((tramo.fin - tramo.inicio) / tramo.sampleRate) * 1000
  const { speechLikeMs, rms } = medidor.medir(bloques, tramo.sampleRate)
  return { ms, speechLikeMs, rms }
}

/**
 * Crea las reglas de cierre sobre el estado de una sesión.
 * @param contexto Estado de sesión, emisión, almacén, config y registro.
 * @returns Apertura, revisión, cierre y promoción de filas.
 */
export function crearReglasCierre(contexto: ContextoCierre): ReglasCierre {
  const {
    estado,
    emitir,
    emitirCaja,
    contarDescarte,
    registro,
    almacen,
    config,
    id,
    embebedor,
    medidor,
  } = contexto
  /** Abre la única locución abierta; el llamador garantiza que no hay otra. */
  function abrirLocucion(datos: DatosApertura): void {
    const vozId = String(datos.voz.vozId || '').trim()
    // MANDATO DEL DUEÑO (2026-10-30, problema 4): sin medida positiva NO hay
    // continuidad. Una locución sin vozId no hereda la etiqueta anterior; solo
    // una medida que casa con una plantilla de la sesión afirma continuidad.
    const continuidadVoz = vozId ? estado.plantillasVoz.has(vozId) : false
    // Sin siembra la locución arranca sorda (su tramo ya sonó): el pendiente
    // trae SU audio retenido y la medida de voz parte de él.
    estado.muestrasAbierta = datos.muestrasIniciales ? [...datos.muestrasIniciales] : []
    // El tramo de la locución ya está en el búfer; un tramo de CONTINUACIÓN
    // entra cuando su texto se le atribuye (ingesta: `sumarAudioAtribuido`).
    estado.tramosDeLaAbierta = new Set([datos.tramoId])
    estado.muestrasEnUltimoIntento = 0
    // Caso 8: sin proveedor de turno, cada locución ES su turno (uuid propio);
    // un turnId solo agrupa lo que vino con el MISMO turno del llamador.
    const turno = String(datos.turnId || '').trim() || id.uuid()
    estado.abierta = {
      locutionId: datos.tramoId,
      texto: datos.texto,
      inicio: datos.tramo.inicio,
      fin: datos.tramo.fin,
      sampleRate: datos.tramo.sampleRate,
      turnId: turno,
      idioma: datos.idioma,
      voz: datos.voz,
      final: Boolean(datos.finalLlego),
      medidaMotor: datos.medidaMotor,
      continuidadVoz,
    }
    registro.registrar('conversacion.locucion.abierta', {
      sessionId: estado.sessionId,
      locutionId: datos.tramoId,
      tramo: datos.tramo,
    })
    if (datos.texto) emitirCaja()
  }

  /** Aplica texto a la locución abierta ANTES de evaluar la frontera (regla 2). */
  function aplicarRevision(
    locucion: LocucionAbierta,
    texto: string,
    final: boolean,
    voz: EvidenciaVoz,
    medida?: MedidaMotor,
  ): boolean {
    const decision = decidirRevision({
      tramoAbierto: { id: locucion.locutionId, texto: locucion.texto },
      tramoId: locucion.locutionId,
      texto,
      final: locucion.final || final,
    })
    const vozId = String(voz.vozId || '').trim()
    let continuidadVoz = locucion.continuidadVoz
    if (vozId && !String(locucion.voz.vozId || '').trim()) {
      // Medida tardía: la continuidad la afirma una plantilla de la sesión.
      continuidadVoz = estado.plantillasVoz.has(vozId)
    }
    const siguiente: LocucionAbierta = {
      ...locucion,
      texto: decision.pintar ? decision.texto : locucion.texto,
      final: locucion.final || final,
      // Las métricas del motor viajan con SU final; sin final no se guardan.
      medidaMotor: final ? medida ?? locucion.medidaMotor : locucion.medidaMotor,
      voz: fusionarVoz(locucion.voz, voz),
      continuidadVoz,
    }
    estado.abierta = siguiente
    if (siguiente.texto !== locucion.texto) emitirCaja()
    return siguiente.final
  }

  /**
   * Medida de respaldo al cerrar: una locución que se midió en el habla (ingesta)
   * ya trae `vozId` y no entra aquí. Sin medida temprana, se embebe el PCM retenido
   * y se decide la identidad ANTES de construir la fila; un fallo de la medida se
   * registra y la locución cierra con la evidencia que tenía.
   *
   * El piso de VOZ no vive aquí: lo posee el embebedor del adaptador, que exige
   * una ventana con habla real y descarta el resto (problema 3: acuñar con una
   * ventana corta fabricaba `Hablante N`). Si no hay voz medible el vector es
   * null, la fila nace TEMPORAL y su medida tardía la reemplaza (`reetiquetarFila`).
   * @param locucion Locución que se cierra, con su evidencia de voz previa.
   * @returns Evidencia de voz que cierra; la misma si no se mide.
   */
  async function medirVozAlCerrar(locucion: LocucionAbierta): Promise<EvidenciaVoz> {
    if (
      !embebedor ||
      String(locucion.voz.vozId || '').trim() ||
      estado.muestrasAbierta.length === 0
    ) {
      return locucion.voz
    }
    const muestras = concatenarMuestras(estado.muestrasAbierta)
    let vector: readonly number[] | null = null
    try {
      vector = await embebedor.medir(muestras, locucion.sampleRate)
    } catch (error) {
      // AGENTS §1.5: el catch registra por logCaughtError con la excepción.
      logCaughtError('conversacion.voz.medida.fallo', error, {
        sessionId: estado.sessionId,
        locutionId: locucion.locutionId,
      })
    }
    if (!vector) {
      // Traza MEDIDA (Caso 12): la fila nace TEMPORAL y esta es la razón del
      // audio que se midió (el piso de VOZ lo aplica el embebedor del adaptador).
      registro.registrar('conversacion.voz.medida.sinVector', {
        sessionId: estado.sessionId,
        locutionId: locucion.locutionId,
        muestras: muestras.length,
        sampleRate: locucion.sampleRate,
      })
      return locucion.voz
    }
    const identidad = decidirIdentidad({
      vector,
      plantillas: plantillasDe(estado.plantillasVoz),
      umbral: config.umbralContinuidadVoz(),
      // Perezoso: la plantilla SOLO se resuelve si la voz es nueva (Caso 10).
      etiquetaNueva: () => config.etiquetaAnonima(estado.contadorVoces + 1),
      comparar: embebedor.comparar,
      id: id.uuid,
    })
    registrarMedidaVoz(estado, vector, identidad)
    registro.registrar('conversacion.voz.medida.cerrada', {
      sessionId: estado.sessionId,
      locutionId: locucion.locutionId,
      muestras: muestras.length,
      sampleRate: locucion.sampleRate,
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      continuidad: identidad.continuidad,
    })
    return {
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      continuidad: identidad.continuidad,
    }
  }

  /**
   * Fila commiteada del MISMO turno en la sesión (Caso 8: un turnId => una fila).
   * La usa la puerta INSERT-ONLY: si el turno ya commiteó, una locución que no
   * aporta una voz distinta medida es reentrega y no se escribe.
   */
  function filaDelTurno(turno: string, etiqueta?: string): Fila | null {
    const id = String(turno || '').trim()
    if (!id) return null
    let reciente: Fila | null = null
    for (const fila of estado.filas.values()) {
      if (fila.sessionId !== estado.sessionId) continue
      if (fila.deleted) continue
      if (String(fila.turnId || '').trim() !== id) continue
      reciente = fila
      if (etiqueta && fila.etiqueta === etiqueta) return fila
    }
    return reciente
  }

  /**
   * Commitea la fila: emite `row.committed` y deja la TRAZA del commit (Caso 12)
   * en la grabación de diagnóstico — turnId, hablante y longitud del texto — por
   * el sink único `recordSessionEvent` (no-op sin grabación activa; jamás
   * `console.*`). ÚNICO dueño del commit: ningún `row.committed` sale fuera de
   * aquí, así todo commit tiene traza por construcción.
   * @param fila Fila commiteada que se emite y se traza.
   */
  function commitar(fila: Fila): void {
    emitir({ tipo: 'row.committed', sessionId: fila.sessionId, fila })
    recordSessionEvent('conversacion', 'fila.commiteada', {
      sessionId: fila.sessionId,
      turnId: fila.turnId,
      hablante: fila.etiqueta,
      longitud: String(fila.texto || '').length,
      locutionId: fila.locutionId,
    })
  }

  /** Cierra la locución abierta: una fila o un descarte contado (regla 4). */
  async function cerrarLocucion(
    locucion: LocucionAbierta,
    motivo: MotivoCierre,
    causa: CausaCierre,
    final: boolean,
  ): Promise<void> {
    const sesion = estado.sessionId ?? ''
    const tramo: TramoMuestreado = {
      inicio: locucion.inicio,
      fin: locucion.fin,
      sampleRate: locucion.sampleRate,
    }
    // Caso 7+6: la medida SIEMPRE parte del tramo CERRADO; las métricas del motor
    // (si el final las trajo) sustituyen speechLikeMs/rms, nunca el ms del tramo.
    const medidaTramo = medirTramoCerrado(tramo, estado.muestrasAbierta, medidor)
    const medida: MedidaFinal = {
      ms: medidaTramo.ms,
      speechLikeMs: locucion.medidaMotor?.speechLikeMs ?? medidaTramo.speechLikeMs,
      rms: locucion.medidaMotor?.rms ?? medidaTramo.rms,
    }
    // La medida del cierre NO tiene puerta de duración aquí: el habla REAL de la
    // ventana la exige el embebedor del adaptador (problema 3). Duplicar el piso
    // en el módulo impedía medir voces legítimas al cerrar.
    const vozMedida = await medirVozAlCerrar(locucion)
    let vozCerrada = vozMedida === locucion.voz ? locucion.voz : fusionarVoz(locucion.voz, vozMedida)
    const continuidadVoz =
      vozMedida === locucion.voz ? locucion.continuidadVoz : Boolean(vozMedida.continuidad)
    // BAUTIZO PENDIENTE (problema 5, mandato 2026-10-30): el nombre del comando
    // «ok flu soy X» llegó con la locución ABIERTA (la medida de respaldo aún no
    // resuelve la voz). Se aplica a la voz que cierra ESTA locución: con vozId el
    // nombre queda REGISTRADO para esa voz (sus filas siguientes lo llevan y la
    // plantilla aprende el nombre); sin medida, solo marca la fila del comando.
    if (estado.nombrePendiente) {
      const vozIdCerrada = String(vozCerrada.vozId || '').trim()
      if (vozIdCerrada) {
        estado.nombresPorVoz.set(vozIdCerrada, estado.nombrePendiente)
        const plantilla = estado.plantillasVoz.get(vozIdCerrada)
        if (plantilla) plantilla.etiqueta = estado.nombrePendiente
      }
      vozCerrada = { ...vozCerrada, nombre: estado.nombrePendiente, nombreConfirmado: true }
      estado.nombrePendiente = ''
      registro.registrar('conversacion.nombre.aplicado', {
        sessionId: sesion,
        locutionId: locucion.locutionId,
        vozId: vozIdCerrada || null,
        nombre: vozCerrada.nombre,
      })
    }
    // TIMBRE DE LA FILA (mandato del dueño 2026-10-11/13): la fila lleva la firma
    // de SU voz — el vector de la plantilla de sesión, refrescado por la medida —
    // para que la vista la ligue POR TIMBRE (`voiceKeyFor`), no por etiqueta. Sin
    // medida (sin vozId) la fila no afirma timbre.
    const vozIdFirma = String(vozCerrada.vozId || '').trim()
    const firma = vozIdFirma ? estado.plantillasVoz.get(vozIdFirma)?.vector ?? null : null
    // Etiqueta TEMPORAL mientras la medida no es fiable: solo tiene sentido si
    // hay embebedor (sin él nunca llegará medida) y la config la declara.
    const pendienteEtiqueta =
      embebedor && config.etiquetaPendiente ? String(config.etiquetaPendiente() || '').trim() : ''
    const cierre: CierreLocucion = {
      locutionId: locucion.locutionId,
      sessionId: sesion,
      turnId: locucion.turnId,
      inicio: locucion.inicio,
      fin: locucion.fin,
      sampleRate: locucion.sampleRate,
      texto: locucion.texto,
      idioma: locucion.idioma,
      overlap: Boolean(locucion.voz.overlap),
      final,
      reason: motivo,
      voz: resolverVoz(vozCerrada, continuidadVoz, estado.nombresPorVoz, estado.plantillasVoz),
      etiquetaAnterior: estado.ultimaEtiqueta || null,
      semillaEtiqueta: config.semillaEtiqueta(),
      esEtiquetaAnonima: config.esEtiquetaAnonima,
      pendienteEtiqueta,
      firma,
    }
    estado.abierta = null
    estado.muestrasAbierta = []
    estado.tramosDeLaAbierta.clear()
    estado.muestrasEnUltimoIntento = 0
    emitirCaja()

    const resultado = construirFila(cierre)
    if (!resultado.fila) {
      emitir({
        tipo: 'locution.closed',
        sessionId: sesion,
        locutionId: locucion.locutionId,
        tramo,
        motivo,
        causa,
        medida,
      })
      contarDescarte(resultado.descarte, locucion.locutionId, tramo)
      registro.registrar('conversacion.locucion.cerrada', {
        sessionId: sesion,
        locutionId: locucion.locutionId,
        tramo,
        motivo,
        causa,
        descarte: resultado.descarte,
      })
      return
    }

    // MANDATO DEL DUEÑO (2026-10-30, INSERT-ONLY): la fila se INSERTA una vez y
    // NUNCA se toca — la ÚNICA excepción es el HABLANTE (`reetiquetarFila`), que
    // reemplaza una etiqueta TEMPORAL por su medida. Si el turno ya commiteó y
    // esta locución NO aporta una voz distinta medida, es reentrega/continuación:
    // se ignora sin tocar la fila (descarte contado, nunca una segunda fila).
    // Caso 1+3: una voz distinta medida (continuidad false) SÍ inserta SU fila
    // — dos voces sin pausa son DOS filas del mismo turno.
    const previaDelTurno = filaDelTurno(cierre.turnId)
    const vozDistintaMedida =
      String(vozCerrada.vozId || '').trim() !== '' && !continuidadVoz
    // La reentrega es la MISMA locucion o una REVISION/continuacion de su texto.
    // Una frase NUEVA del mismo turno (p. ej. el comando commiteado por el hook
    // antes de que el modulo cierre) NO es reentrega: antes se descartaba y la
    // conversacion perdia la ultima frase (auditoria 2026-11-01).
    const esReentrega = previaDelTurno
      ? esReentregaDeTurno(previaDelTurno.texto, cierre.texto)
      : false
    if (previaDelTurno && !vozDistintaMedida && esReentrega) {
      emitir({
        tipo: 'locution.closed',
        sessionId: sesion,
        locutionId: locucion.locutionId,
        tramo,
        motivo,
        causa,
        medida,
      })
      contarDescarte('turnoYaEscrito', locucion.locutionId, tramo)
      registro.registrar('conversacion.locucion.cerrada', {
        sessionId: sesion,
        locutionId: locucion.locutionId,
        tramo,
        motivo,
        causa,
        descarte: 'turnoYaEscrito',
      })
      return
    }

    const fila = await almacen.guardar(resultado.fila)
    estado.filas.set(fila.locutionId, fila)
    estado.ultimaEtiqueta = fila.etiqueta
    // La plantilla de la voz aprende la etiqueta commiteada (nombre del bautizo).
    const vozIdFila = String(vozCerrada.vozId || '').trim()
    if (vozIdFila) {
      const plantilla = estado.plantillasVoz.get(vozIdFila)
      if (plantilla) plantilla.etiqueta = fila.etiqueta
    }
    emitir({
      tipo: 'locution.closed',
      sessionId: sesion,
      locutionId: fila.locutionId,
      tramo,
      motivo,
      causa,
      medida,
    })
    commitar(fila)
    emitir({
      tipo: 'speaker.labeled',
      sessionId: sesion,
      locutionId: fila.locutionId,
      etiqueta: fila.etiqueta,
      evidencia: fila.evidencia,
    })
    registro.registrar('conversacion.locucion.cerrada', {
      sessionId: sesion,
      locutionId: fila.locutionId,
      tramo,
      motivo,
      causa,
      descarte: null,
    })
  }

  /**
   * Reemplaza la etiqueta TEMPORAL de una fila ya commiteada (`pendiente`) por la
   * de su medida tardía y por NADA más. `CambiosFila` limita el almacén a
   * etiqueta+evidencia, y aquí se exige además que la evidencia previa siga siendo
   * `pendiente`: en cuanto la fila tiene un hablante afirmado, vuelve a ser
   * inmutable (un segundo intento no la toca).
   * @param locucionId Fila commiteada a reetiquetar.
   * @param vozId Voz medida que identifica al hablante de esa fila.
   * @param hablante Etiqueta de la medida (nombre registrado o `Hablante N`).
   * @returns `true` si la fila existía pendiente y quedó reetiquetada.
   */
  async function reetiquetarFila(
    locucionId: string,
    vozId: string,
    hablante: string,
  ): Promise<boolean> {
    const idFila = String(locucionId || '').trim()
    const fila = idFila ? estado.filas.get(idFila) : undefined
    if (!fila || fila.deleted) return false
    if (fila.evidencia !== 'pendiente') return false
    const nombreRegistrado = estado.nombresPorVoz.get(String(vozId || '').trim())
    const etiqueta = String(nombreRegistrado ?? hablante ?? '').trim()
    if (!etiqueta) return false
    // La plantilla aprende la etiqueta que la medida acaba de afirmar.
    const plantilla = estado.plantillasVoz.get(String(vozId || '').trim())
    if (plantilla) plantilla.etiqueta = etiqueta
    const evidencia = nombreRegistrado ? 'nombre' : 'medida'
    // La medida tardía trae el TIMBRE de la voz. Persistirlo en la fila es lo
    // que evita que `voiceKeyFor` caiga a la etiqueta y abra hablantes nuevos
    // (auditoría 2026-11-01: commits con signature:null tras vozMedida ok).
    const firma = plantilla?.vector ?? fila.firma
    const actualizada = await almacen.actualizar(fila.locutionId, {
      etiqueta,
      evidencia,
      ...(firma ? { firma } : {}),
    })
    if (!actualizada) return false
    estado.filas.set(fila.locutionId, actualizada)
    // La continuidad de la sesión sigue a la fila más reciente ya etiquetada.
    if (estado.ultimaEtiqueta === fila.etiqueta) estado.ultimaEtiqueta = etiqueta
    emitir({
      tipo: 'speaker.labeled',
      sessionId: fila.sessionId,
      locutionId: fila.locutionId,
      etiqueta,
      evidencia,
    })
    recordSessionEvent('conversacion', 'fila.reetiquetada', {
      sessionId: fila.sessionId,
      locutionId: fila.locutionId,
      turnId: fila.turnId,
      hablante: etiqueta,
      anterior: fila.etiqueta,
    })
    return true
  }

  /** ¿El tramo ya tiene su fila commiteada? La reentrega no la toca (insert-only). */
  function tramoYaCommiteado(tramoId: string): boolean {
    return estado.filas.has(tramoId)
  }

  return { abrirLocucion, aplicarRevision, cerrarLocucion, reetiquetarFila, tramoYaCommiteado }
}
