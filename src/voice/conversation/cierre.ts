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
import { construirFila, fusionarVoz, horaDelFinDelTramo } from './fila.ts'
import type { CierreLocucion, VozEtiqueta } from './fila.ts'
import { decidirRevision } from './revision.ts'
import { decidirIdentidad, entradaIdentidadDeSesion } from './identidad.ts'
import type { PlantillaVoz } from './identidad.ts'
import type { RegistroTramos } from './tramos.ts'
import { registrarMedidaVoz } from './sesion.ts'
import { compareCosineSignatures } from '../lib/speakerCore.js'
import { sameVoiceFloor } from '../lib/speakerClusters.js'
import { continuaLaFrase } from '../core/locucion.js'
import { concatenarMuestras, vozMsDeMuestras } from './muestras.ts'
import { logCaughtError } from '../../lib/caughtError.ts'
import { normalizeForMatch } from '../../lib/textUtils.ts'
import { recordSessionEvent } from '../api/sessionLog.ts'
import type {
  CausaCierre,
  ContarDescarte,
  EventoConversacion,
  EvidenciaVoz,
  LocucionAbierta,
  MotivoDescarteConversacion,
} from './tipos.ts'
import type {
  AlmacenPort,
  AnclaAudio,
  ConfigPort,
  ConfiguracionConversacion,
  EmbebedorPort,
  Fila,
  FilaNueva,
  IdiomaLocucion,
  IdPort,
  MedidaFinal,
  MedidaMotor,
  MedidorTramoPort,
  MotivoCierre,
  RegistroPort,
  TramoMuestreado,
} from './ports.ts'
import { CONVERSACION_CONFIG } from './ports.ts'

/** Parte del estado de sesión que consumen las reglas de cierre. */
export type EstadoCierre = {
  sessionId: string | null
  /** `false` tras el stop: una transcripción que aún no commitea no escribe. */
  activa: boolean
  /** `true` desde el stop hasta que la sesión queda inactiva (cancela trabajo obsoleto). */
  cerrando: boolean
  turnoActual: string
  turnosConFila: Set<string>
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
  /** Confirmación de cambio de voz (Caso 1+3): pertenece a la locución abierta. */
  contadorCambioVoz: number
  candidatoCambioVoz: { limite: number; textoAntes: string } | null
  /**
   * Marca de reloj de la confirmación del final (pertenece a la locución
   * abierta): el flujo de texto la arma, la ingesta la rearma con voz y la
   * frontera la consume. null = sin final aplicado.
   */
  confirmacionFinalDesdeMs: number | null
  /** Nombres declarados para etiquetas provisionales (bautizo sin vector). */
  nombresPorEtiqueta: Map<string, string>
  /** Bautizo pendiente, ACOTADO a la locución abierta que lo recibió. */
  pendienteNombre: { locutionId: string; nombre: string } | null
  /** Ancla muestra↔reloj de la sesión: fecha el fin del tramo en hora de VOZ. */
  anclaAudio: AnclaAudio | null
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
  /** Tabla del plan inyectada (fronteras y compuerta de plausibilidad). */
  configuracion?: ConfiguracionConversacion
  /** Generador UUIDv4: la voz nueva acuña su identidad (medida de respaldo). */
  id: IdPort
  /** Embeddings inyectados; sin puerto no hay medida (solo continuidad/semilla). */
  embebedor?: EmbebedorPort
  /** Medidor del tramo cerrado (Caso 7+6): obligatorio, nada de medida null. */
  medidor: MedidorTramoPort
  /**
   * Audio REAL por tramo: respaldo de la medida al cerrar. La voz se mide sobre
   * el audio de la locución aunque `muestrasAbierta` se haya vaciado; una fila
   * cerrada nunca queda en `Hablante X` (regla 5/6).
   */
  tramos: RegistroTramos
  /** Anclas medidas de la base (solo lectura): vector conocido → nombre propio. */
  anclasBase?: () => ReadonlyArray<{ name?: string; vector?: readonly number[] }>
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
  /** La locución nace de una partición por cambio de voz (hecho de ingesta). */
  partidaDeVoz?: boolean
  /** Métricas del motor para el final (pueden faltar). */
  medidaMotor?: MedidaMotor
  /**
   * PCM del tramo cuando la locución nace de un pendiente ya hablado: la
   * evidencia de voz de la fila es SU audio, no el que venga después.
   */
  muestrasIniciales?: readonly Float32Array[]
}>

/** Firma de la revisión de una locución (dueño único de la firma). */
export type AplicarRevision = (
  locucion: LocucionAbierta,
  texto: string,
  final: boolean,
  voz: EvidenciaVoz,
  medida?: MedidaMotor,
  /** Tramo al que pertenece `texto`; sin él, el tramo base de la locución. */
  tramoOrigen?: string,
  /**
   * `true` si el texto llega del retén (frase que no continuaba la abierta).
   * Un aporte nuevo que crece se AÑADE; una revisión directa sigue sustituyendo
   * su tramo. Así el final que limpia ruido no se parte y la cola de una frase
   * nueva no borra el principio.
   */
  esAporteNuevo?: boolean,
) => boolean

/** Aporte de texto de un tramo dentro de la locución abierta (orden de llegada). */
type TextoPorTramo = Readonly<{ tramoId: string; texto: string }>

/** Compone la línea visible a partir de los aportes de cada tramo. */
function componerTramos(aportes: readonly TextoPorTramo[]): string {
  return aportes
    .map((aporte) => aporte.texto.trim())
    .filter(Boolean)
    .join(' ')
}

/** ¿`contenedor` ya incluye `contenido`? Emisión acumulativa del ASR. */
function contieneTexto(contenedor: string, contenido: string): boolean {
  const amplio = normalizeForMatch(contenedor)
  const corto = normalizeForMatch(contenido)
  return Boolean(amplio) && Boolean(corto) && amplio.includes(corto)
}

/** Reglas de cierre que la sesión publica en su superficie. */
export type ReglasCierre = Readonly<{
  abrirLocucion(datos: DatosApertura): void
  aplicarRevision: AplicarRevision
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
   * @param evidenciaPedida `'nombre'` cuando el comando «ok flu soy X» declara el
   *   nombre sin voz medida: el renombrado va por ETIQUETA, no por `vozId`.
   * @returns `true` si la fila existía con etiqueta pendiente y se actualizó.
   */
  reetiquetarFila(
    locucionId: string,
    vozId: string,
    hablante: string,
    evidenciaPedida?: 'nombre' | '',
  ): Promise<boolean>
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
export function resolverVoz(
  voz: EvidenciaVoz,
  continuidadVoz: boolean,
  nombresPorVoz: ReadonlyMap<string, string>,
  plantillasVoz: ReadonlyMap<string, PlantillaVoz>,
): VozEtiqueta {
  const vozId = String(voz.vozId || '').trim()
  const registrado = vozId ? nombresPorVoz.get(vozId) : undefined
  // EL NOMBRE NO SE HEREDA SIN SU TIMBRE (medido 2026-11-09 10:35, sesión 36a8bc05): dos
  // filas con cos 0.566 y 0.436 contra el ancla de Luis salieron etiquetadas «Luis» porque
  // la voz recibió SU clave. Si la medida del turno no casa con el ancla de esa voz, el
  // nombre no se afirma: la fila degrada a su etiqueta provisional («Hablante N»).
  const ancla = vozId ? plantillasVoz.get(vozId)?.vector : null
  const medida = Array.isArray(voz.vector) ? voz.vector : null
  const mismaVoz =
    !Array.isArray(ancla) || ancla.length === 0 || !medida || medida.length === 0
      ? true
      : compareCosineSignatures([...medida], [...ancla]) >= sameVoiceFloor()
  const nombre = mismaVoz
    ? registrado ?? (voz.nombreConfirmado ? String(voz.nombre || '').trim() : '')
    : ''
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
    // Medida intentada sin vector suficiente: la fila es XX, no X.
    medidaInsuficiente: voz.insuficiente === true,
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
    tramos,
    anclasBase,
  } = contexto
  // El producto SIEMPRE inyecta la tabla; los dobles de prueba pueden omitirla y
  // usan la del plan (tope y compuerta de plausibilidad).
  const configuracion = contexto.configuracion ?? CONVERSACION_CONFIG
  /** Abre la única locución abierta; el llamador garantiza que no hay otra. */
  function abrirLocucion(datos: DatosApertura): void {
    // El contador/candidato de cambio de voz pertenecen a la locución ABIERTA:
    // una locución nueva arranca la confirmación de cero (sin arrastre).
    estado.contadorCambioVoz = 0
    estado.candidatoCambioVoz = null
    // La confirmación del final también es de la locución abierta: una locución
    // nueva arranca SIN ventana armada; `abrirDesde` la arma si abre con su
    // final ya llegado (`finalLlego`).
    estado.confirmacionFinalDesdeMs = null
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
    const sugerido = String(datos.turnId || '').trim() || estado.turnoActual
    const turno = sugerido && !estado.turnosConFila.has(sugerido) ? sugerido : id.uuid()
    estado.turnoActual = turno
    estado.abierta = {
      locutionId: datos.tramoId,
      texto: datos.texto,
      textoTramos: String(datos.texto || '').trim()
        ? [{ tramoId: datos.tramoId, texto: datos.texto }]
        : [],
      inicio: datos.tramo.inicio,
      fin: datos.tramo.fin,
      sampleRate: datos.tramo.sampleRate,
      turnId: turno,
      idioma: datos.idioma,
      voz: datos.voz,
      final: Boolean(datos.finalLlego),
      medidaMotor: datos.medidaMotor,
      continuidadVoz,
      partidaDeVoz: Boolean(datos.partidaDeVoz),
    }
    registro.registrar('conversacion.locucion.abierta', {
      sessionId: estado.sessionId,
      locutionId: datos.tramoId,
      tramo: datos.tramo,
    })
    if (datos.texto) emitirCaja()
  }

  /** Aplica texto a la locución abierta ANTES de evaluar la frontera (regla 2). */
  const aplicarRevision: AplicarRevision = (
    locucion,
    texto,
    final,
    voz,
    medida,
    tramoOrigen,
    esAporteNuevo = false,
  ) => {
    const origen =
      String(tramoOrigen || locucion.locutionId).trim() || locucion.locutionId;
    const aportes: readonly TextoPorTramo[] = locucion.textoTramos.length
      ? locucion.textoTramos
      : String(locucion.texto || '').trim()
        ? [{ tramoId: locucion.locutionId, texto: locucion.texto }]
        : [];
    const indice = aportes.findIndex((aporte) => aporte.tramoId === origen);
    const previoTramo = indice >= 0 ? aportes[indice]?.texto ?? '' : '';
    // Regla 3 DENTRO DEL TRAMO: crece o revisa; si pierde palabras, no pinta.
    const decision = decidirRevision({
      tramoAbierto: previoTramo ? { id: origen, texto: previoTramo } : null,
      tramoId: origen,
      texto,
      final,
    });
    // El final es la hipótesis confirmada de SU tramo: reemplaza SOLO ese
    // aporte. Lo dicho en tramos anteriores se conserva (antes el final de un
    // tramo posterior borraba las frases previas de la locución).
    const textoFinal = String(texto || '').trim()
    const finalEsPrefijo = Boolean(
      textoFinal &&
        previoTramo &&
        previoTramo.toLowerCase().startsWith(textoFinal.toLowerCase()),
    )
    // Un final que NO crece, NO es revisión y NO es prefijo del texto ya dicho
    // (p. ej. el sufijo suelto "duplicados" tras una frase larga) no puede
    // reemplazar la frase: se conserva lo dicho.
    //
    // REGLA DEL DUEÑO (2026-11-12): la transcripción NUNCA decrece; la caja y
    // la frase canónica no pierden palabras ya oídas. El final sigue siendo la
    // hipótesis confirmada cuando crece o corrige con el mismo tamaño, pero si
    // llega MÁS CORTO no borra la cola ya visible (antes `finalEsPrefijo`
    // reemplazaba por el prefijo y truncaba la frase y los comandos).
    const esFraseNuevaDelMismoTramo =
      esAporteNuevo &&
      indice >= 0 &&
      Boolean(previoTramo) &&
      Boolean(textoFinal) &&
      textoFinal.length > previoTramo.length &&
      !previoTramo.toLowerCase().startsWith(textoFinal.toLowerCase()) &&
      !continuaLaFrase(previoTramo, textoFinal)
    const finalNoTrunca =
      Boolean(textoFinal) && textoFinal.length >= previoTramo.length
    const textoDelTramo = esFraseNuevaDelMismoTramo
      ? textoFinal
      : final
        ? finalNoTrunca && (decision.pintar || finalEsPrefijo)
          ? textoFinal
          : previoTramo
        : decision.texto
    let siguientes: readonly TextoPorTramo[]
    if (esFraseNuevaDelMismoTramo) {
      siguientes = [
        ...aportes.filter((aporte) => aporte.texto.trim()),
        { tramoId: `${origen}#${aportes.length}`, texto: textoDelTramo },
      ]
    } else if (indice >= 0) {
      siguientes = aportes.map((aporte, i) =>
        i === indice ? { tramoId: origen, texto: textoDelTramo } : aporte,
      )
    } else {
      siguientes = [
        ...aportes.filter((aporte) => aporte.texto.trim()),
        { tramoId: origen, texto: textoDelTramo },
      ]
    }
    // El ASR puede reemitir de forma ACUMULATIVA: si el texto de este tramo ya
    // contiene el de los demás, se colapsa para no duplicar lo ya dicho.
    const otros = siguientes.filter(
      (aporte) => aporte.tramoId !== origen && aporte.texto.trim(),
    );
    if (
      !esFraseNuevaDelMismoTramo &&
      otros.length > 0 &&
      otros.every((aporte) => contieneTexto(textoDelTramo, aporte.texto))
    ) {
      siguientes = [{ tramoId: origen, texto: textoDelTramo }];
    }
    const textoCompuesto = componerTramos(siguientes);
    const vozId = String(voz.vozId || '').trim()
    let continuidadVoz = locucion.continuidadVoz
    if (vozId && !String(locucion.voz.vozId || '').trim()) {
      // Medida tardía: la continuidad la afirma una plantilla de la sesión.
      continuidadVoz = estado.plantillasVoz.has(vozId)
    }
    const siguiente: LocucionAbierta = {
      ...locucion,
      texto: textoCompuesto,
      textoTramos: siguientes,
      final: locucion.final || final,
      // Las métricas del motor viajan con SU final; sin final no se guardan.
      medidaMotor: final ? medida ?? locucion.medidaMotor : locucion.medidaMotor,
      voz: fusionarVoz(locucion.voz, voz),
      continuidadVoz,
    }
    estado.abierta = siguiente
    if (siguiente.texto !== locucion.texto) emitirCaja()
    return siguiente.final
  };

  /** Registra un evento de medida de voz con el payload común. */
  function registrarEventoVoz(
    tipo: string,
    locucion: LocucionAbierta,
    muestras: number,
    extra: Record<string, unknown> = {},
  ): void {
    registro.registrar(tipo, {
      sessionId: estado.sessionId,
      locutionId: locucion.locutionId,
      muestras,
      sampleRate: locucion.sampleRate,
      ...extra,
    })
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
    if (!embebedor || String(locucion.voz.vozId || '').trim()) {
      return locucion.voz
    }
    // La voz se mide sobre el audio REAL de la locución. `muestrasAbierta` es el
    // camino vivo, pero puede haberse vaciado; el registro de tramos conserva
    // la ventana cerrada y es el respaldo que evita commitear `Hablante X`.
    let muestras = concatenarMuestras(estado.muestrasAbierta)
    if (muestras.length === 0) {
      const delTramo = tramos.muestras(locucion.locutionId, {
        inicio: locucion.inicio,
        fin: locucion.fin,
        sampleRate: locucion.sampleRate,
      })
      if (delTramo) muestras = concatenarMuestras(delTramo)
    }
    if (muestras.length === 0) {
      // No hay audio que medir: la fila cerrada es NO IDENTIFICADA (`XX`), nunca
      // `X` (que significa «la medida aún no llegó» y solo vale en la caja).
      registrarEventoVoz('conversacion.voz.medida.sinAudio', locucion, 0)
      return { ...locucion.voz, insuficiente: true }
    }
    // La evidencia que decide la voz es la VOZ medida, no la longitud del tramo.
    const vozMs = vozMsDeMuestras(muestras, locucion.sampleRate)
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
      // Traza MEDIDA (Caso 12): se intentó medir y no hubo vector suficiente.
      // La fila NO queda «en espera»: es `Hablante XX` (regla 6).
      registrarEventoVoz('conversacion.voz.medida.sinVector', locucion, muestras.length)
      return { ...locucion.voz, insuficiente: true }
    }
    const identidad = decidirIdentidad(
      entradaIdentidadDeSesion({
        vector,
        plantillasVoz: estado.plantillasVoz,
        anclasBase,
        config,
        minVozIdentidadMs: configuracion.minVozIdentidadMs,
        duracionMs: vozMs,
        // Perezoso: la plantilla SOLO se resuelve si la voz es nueva (Caso 10).
        etiquetaNueva: () => config.etiquetaAnonima(estado.contadorVoces + 1),
        comparar: embebedor.comparar,
        id: id.uuid,
      }),
    )
    registrarMedidaVoz(estado, vector, identidad, config.umbralContinuidadVoz())
    registrarEventoVoz('conversacion.voz.medida.cerrada', locucion, muestras.length, {
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      continuidad: identidad.continuidad,
      insuficiente: identidad.insuficiente === true,
      vozMs,
    })
    return {
      vozId: identidad.vozId,
      hablante: identidad.hablante,
      continuidad: identidad.continuidad,
      ...(identidad.insuficiente ? { insuficiente: true } : {}),
    }
  }

  /**
   * UNICA escritura de fila del cierre: upsert, estado, ultima etiqueta y
   * aprendizaje de la plantilla. Las ramas normal y fusionada la comparten;
   * antes cada una llamaba a `almacen.guardar` por su cuenta.
   */
  async function guardarFila(filaNueva: FilaNueva, vozId: string): Promise<Fila> {
    const fila = await almacen.guardar(filaNueva)
    estado.filas.set(fila.locutionId, fila)
    estado.ultimaEtiqueta = fila.etiqueta
    const idVoz = String(vozId || '').trim()
    if (idVoz) {
      const plantilla = estado.plantillasVoz.get(idVoz)
      if (plantilla) estado.plantillasVoz.set(idVoz, { ...plantilla, etiqueta: fila.etiqueta })
    }
    // AUDITORÍA DE IDENTIDAD (una por fila): la medida temprana no registraba su
    // decisión y no se podía saber si una voz nueva (p. ej. la mujer) quedó con
    // su etiqueta o heredó la anterior. No es una segunda ruta de decisión: la
    // etiqueta ya está commiteada; esto solo la deja en el log del cliente.
    registro.registrar('conversacion.fila.etiquetada', {
      sessionId: estado.sessionId,
      locutionId: fila.locutionId,
      etiqueta: fila.etiqueta,
      vozId: idVoz,
      evidencia: fila.evidencia ?? null,
    })
    return fila
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
    estado.turnosConFila.add(String(fila.turnId))
    emitir({ tipo: 'row.committed', sessionId: fila.sessionId, fila })
    recordSessionEvent('conversacion', 'fila.commiteada', {
      sessionId: fila.sessionId,
      turnId: fila.turnId,
      hablante: fila.etiqueta,
      longitud: String(fila.texto || '').length,
      locutionId: fila.locutionId,
    })
  }

  /** Datos comunes de un cierre de locución. */
  type CierreComun = {
    sessionId: string
    locucion: LocucionAbierta
    tramo: TramoMuestreado
    motivo: MotivoCierre
    causa: CausaCierre
    medida: MedidaFinal
  }

  /**
   * Emite el cierre de la locución con su medida y metadatos.
   * Dueño único del payload de `locution.closed`.
   * @param c Datos del cierre.
   */
  function emitirCierre({ sessionId, locucion, tramo, motivo, causa, medida }: CierreComun): void {
    emitir({
      tipo: 'locution.closed',
      sessionId,
      locutionId: locucion.locutionId,
      turnId: locucion.turnId,
      tramo,
      motivo,
      causa,
      medida,
    })
  }

  /**
   * Registra el cierre de una locución. Dueño único del asiento de cierre.
   * @param sessionId Sesión de la conversación.
   * @param locutionId Locución cerrada.
   * @param tramo Tramo medido.
   * @param motivo Motivo de cierre.
   * @param causa Causa del cierre.
   * @param descarte Descarte contado, o null si se commiteó.
   */
  function registrarCierre(
    sessionId: string,
    locutionId: string,
    tramo: TramoMuestreado,
    motivo: MotivoCierre,
    causa: CausaCierre,
    descarte: MotivoDescarteConversacion | null,
  ): void {
    registro.registrar('conversacion.locucion.cerrada', {
      sessionId,
      locutionId,
      tramo,
      motivo,
      causa,
      descarte,
    })
  }

  /**
   * Cierra una locución descartada: emite, cuenta el descarte y lo registra.
   * Dueño único de esa secuencia.
   * @param c Datos del cierre y descarte.
   */
  function cerrarDescartada({
    descarte,
    ...comun
  }: CierreComun & { descarte: MotivoDescarteConversacion }): void {
    emitirCierre(comun)
    contarDescarte(descarte, comun.locucion.locutionId, comun.tramo)
    registrarCierre(comun.sessionId, comun.locucion.locutionId, comun.tramo, comun.motivo, comun.causa, descarte)
  }

  /**
   * ÚNICO dueño de la secuencia "fila -> cierre -> commit -> etiqueta":
   * la usan el cierre síncrono y el commit local tardío. Evita dos copias del
   * protocolo insert-only (el detector de duplicados medía 23 líneas clonadas).
   */
  async function confirmarFilaCommiteada({
    resultado,
    vozId,
    sesion,
    locucion,
    tramo,
    motivo,
    causa,
    medida,
  }: {
    resultado: ReturnType<typeof construirFila>
    vozId: string
    sesion: string
    locucion: LocucionAbierta
    tramo: TramoMuestreado
    motivo: MotivoCierre
    causa: CausaCierre
    medida: MedidaFinal
  }): Promise<void> {
    if (!resultado.fila) {
      cerrarDescartada({
        sessionId: sesion,
        locucion,
        tramo,
        motivo,
        causa,
        medida,
        descarte: resultado.descarte,
      })
      return
    }
    if (config.esComandoDeControl?.(resultado.fila.texto)) {
      cerrarDescartada({
        sessionId: sesion,
        locucion,
        tramo,
        motivo,
        causa,
        medida,
        descarte: 'control',
      })
      return
    }
    const fila = await guardarFila(resultado.fila, vozId)
    emitirCierre({ sessionId: sesion, locucion, tramo, motivo, causa, medida })
    commitar(fila)
    emitir({
      tipo: 'speaker.labeled',
      sessionId: sesion,
      locutionId: fila.locutionId,
      etiqueta: fila.etiqueta,
      evidencia: fila.evidencia,
    })
    registrarCierre(sesion, fila.locutionId, tramo, motivo, causa, null)
  }

  async function cerrarLocucion(
    locucion: LocucionAbierta,
    motivo: MotivoCierre,
    causa: CausaCierre,
    final: boolean,
  ): Promise<void> {
    // El candidato de cambio de voz no sobrevive al cierre: pertenece a la
    // locución que se cierra, no a la siguiente.
    estado.contadorCambioVoz = 0
    estado.candidatoCambioVoz = null
    // La marca de la confirmación del final tampoco: sin ella, una locución
    // nueva cerraría antes de tiempo con la ventana de la anterior.
    estado.confirmacionFinalDesdeMs = null
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
    // BAUTIZO PENDIENTE ACOTADO (problema 5): el nombre llegó con una locución
    // ABIERTA sin etiqueta; se aplica SOLO a esa locución al cerrar. Nunca a la
    // siguiente: el pendiente global bautizaba la voz ajena que cerrara después
    // (defecto medido 2026-11-10: «No manches» salió como Luis con vozId null).
    const pendiente = estado.pendienteNombre
    if (pendiente && pendiente.locutionId === locucion.locutionId) {
      const vozIdCerrada = String(vozCerrada.vozId || '').trim()
      if (vozIdCerrada) {
        estado.nombresPorVoz.set(vozIdCerrada, pendiente.nombre)
        const plantilla = estado.plantillasVoz.get(vozIdCerrada)
        if (plantilla) {
          estado.plantillasVoz.set(vozIdCerrada, { ...plantilla, etiqueta: pendiente.nombre })
        }
      }
      vozCerrada = { ...vozCerrada, nombre: pendiente.nombre, nombreConfirmado: true }
      estado.pendienteNombre = null
      registro.registrar('conversacion.nombre.aplicado', {
        sessionId: sesion,
        locutionId: locucion.locutionId,
        vozId: vozIdCerrada || null,
        nombre: vozCerrada.nombre,
      })
    }
    // INVARIANTE: una fila CERRADA nunca queda en `Hablante X`. `X` es el estado
    // transitorio de la caja mientras la locución está viva; al cerrar, o hay
    // voz/nombre, o es `Hablante XX` (no identificado).
    const etiquetaResoluble =
      Boolean(vozCerrada.nombreConfirmado) ||
      Boolean(String(vozCerrada.hablante || '').trim()) ||
      Boolean(
        String(vozCerrada.vozId || '').trim() &&
          estado.plantillasVoz.get(String(vozCerrada.vozId).trim())?.etiqueta,
      )
    if (!etiquetaResoluble && vozCerrada.insuficiente !== true) {
      vozCerrada = { ...vozCerrada, insuficiente: true }
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
    // HORA DE VOZ del fin del tramo: el almacén la usa como `updated_at` y el
    // escritor de `conversations` deriva de ella el inicio real de la frase. Sin
    // ancla no se declara y el almacén cae a su reloj (compatibilidad).
    const marcaFinMs = horaDelFinDelTramo(estado.anclaAudio, tramo)
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
      nombresPorEtiqueta: estado.nombresPorEtiqueta,
      firma,
      ...(marcaFinMs !== null ? { marcaFinMs } : {}),
    }
    estado.abierta = null
    estado.muestrasAbierta = []
    estado.tramosDeLaAbierta.clear()
    estado.muestrasEnUltimoIntento = 0
    emitirCaja()

    const resultado = construirFila(cierre)
    if (!resultado.fila) {
      cerrarDescartada({ sessionId: sesion, locucion, tramo, motivo, causa, medida, descarte: resultado.descarte })
      return
    }

    // MANDATO DEL DUEÑO (2026-10-30, INSERT-ONLY): la fila se INSERTA una vez y
    // NUNCA se toca — la ÚNICA excepción es el HABLANTE (`reetiquetarFila`), que
    // reemplaza una etiqueta TEMPORAL por su medida. Si el turno ya commiteó y
    // esta locución NO aporta una voz distinta medida, es reentrega/continuación:
    // se ignora sin tocar la fila (descarte contado, nunca una segunda fila).
    // Caso 1+3: una voz distinta medida (continuidad false) SÍ inserta SU fila
    // — dos voces sin pausa son DOS filas del mismo turno.
    // Una sola frontera: si el módulo abrió esta locución, es una locución
    // legítima (silencio >5 s o voz distinta). El cierre NO decide otra vez por
    // texto, turno, reentrega ni contención: esa segunda frontera era la que
    // creaba la fila 51 y descartaba las filas 6–9.
    await confirmarFilaCommiteada({
      resultado,
      vozId: String(vozCerrada.vozId || ''),
      sesion,
      locucion,
      tramo,
      motivo,
      causa,
      medida,
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
    evidenciaPedida: 'nombre' | '' = '',
  ): Promise<boolean> {
    const idFila = String(locucionId || '').trim()
    const fila = idFila ? estado.filas.get(idFila) : undefined
    if (!fila || fila.deleted) return false
    const nombreRegistrado = estado.nombresPorVoz.get(String(vozId || '').trim())
    // Dos motivos legitimos para tocar el hablante, y solo el hablante:
    //  - medida tardia sobre una fila que nacio `pendiente` (caso original);
    //  - NOMBRE registrado (o declarado por el comando «ok flu soy X»), que
    //    reemplaza la etiqueta automatica (`Hablante N`) ya afirmada.
    const esNombre = Boolean(nombreRegistrado) || evidenciaPedida === 'nombre'
    if (fila.evidencia !== 'pendiente' && !esNombre) return false
    const etiqueta = String(nombreRegistrado ?? hablante ?? '').trim()
    if (!etiqueta) return false
    // La plantilla aprende la etiqueta que la medida acaba de afirmar.
    const idVoz = String(vozId || '').trim()
    const plantilla = estado.plantillasVoz.get(idVoz)
    if (plantilla) estado.plantillasVoz.set(idVoz, { ...plantilla, etiqueta })
    const evidencia = esNombre ? 'nombre' : 'medida'
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
      // Revision de la MISMA fila: el grabador actualiza el snapshot del turno
      // con la firma/tramo finales (auditoria 2026-11-01: signature:null).
      fila: actualizada,
      revision: true,
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
