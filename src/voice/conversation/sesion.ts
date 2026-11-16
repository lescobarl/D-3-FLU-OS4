/**
 * SESIÓN del módulo CONVERSACIÓN: estado visible, caja, snapshot y reinicio.
 *
 * Es la única dueña del estado mutable de la sesión. Las reglas de cierre
 * (apertura, revisión, fila, promoción) viven en `cierre.ts`; aquí solo se
 * componen y se publican por la superficie de sesión.
 */
import { crearReglasCierre } from './cierre.ts'
import type { ReglasCierre } from './cierre.ts'
import { compareCosineSignatures } from '../lib/speakerCore.js'
import { sameVoiceFloor } from '../lib/speakerClusters.js'
import type { IdentidadDecidida, PlantillaVoz } from './identidad.ts'
import type { RegistroTramos } from './tramos.ts'
import type {
  ContarDescarte,
  DescarteConversacion,
  DependenciasConversacion,
  EventoConversacion,
  InstantaneaConversacion,
  LocucionAbierta,
  TramoAudio,
} from './tipos.ts'
import type {
  AnclaAudio,
  ConfiguracionConversacion,
  EstadoAsr,
  Fila,
  IdiomaLocucion,
  MotivoCierre,
  MotorAsr,
} from './ports.ts'

/** Estado mutable de una sesión; solo `motor` e `ingesta` lo modifican. */
export type EstadoSesion = {
  activa: boolean
  sessionId: string | null
  turnoActual: string
  /** Turnos que ya tienen fila commiteada: el módulo acuña el siguiente. */
  turnosConFila: Set<string>
  idiomaActual: IdiomaLocucion
  estadoAsr: EstadoAsr
  motorAsr: MotorAsr | null
  /**
   * `true` desde el stop hasta que la sesión queda inactiva: los resultados ASR
   * que lleguen después del cierre de escucha NO se ingieren (regla: stop es
   * frontera; nada entra después). El volcado inicial del stop se hace con
   * `drenarResultadosAsr(true)`, que es la única puerta que lo ignora.
   */
  cerrando: boolean
  abierta: LocucionAbierta | null
  tramoAudio: TramoAudio | null
  silencioPendienteMs: number
  /** Último tramo de audio medido: destina el final que llega tras el cierre. */
  ultimoTramoId: string
  ultimaEtiqueta: string
  /**
   * Marca del reloj del ÚLTIMO resultado del ASR (final o intermedio): prueba
   * de que el reconocedor sigue vivo aunque el resultado pertenezca a otra
   * frase. Se escribe en cada ingesta como observabilidad del hueco del ASR;
   * el hueco NO es puerta de cierre (solo el silencio medido o el cambio de
   * hablante cierran la locución). La sesión nueva la reinicia.
   */
  ultimoResultadoMs: number
  /** Texto de la frase que se retiene y se está dictando AHORA (se pinta en la caja). */
  textoPendiente: string
  /** Id de la frase retenida: la caja no decrece dentro del MISMO pendiente. */
  pendienteTramoId: string
  cierreAsrPendiente: MotivoCierre | null
  descartes: DescarteConversacion[]
  filas: Map<string, Fila>
  nombresPorVoz: Map<string, string>
  /** Plantillas de TODAS las voces medidas en la sesión (decisión B: efímeras). */
  plantillasVoz: Map<string, PlantillaVoz>
  /**
   * Nombre declarado para una etiqueta PROVISIONAL (`Hablante N`) mientras esa
   * voz aún no tiene vector. El comando «ok flu soy X» sustituye la ETIQUETA ya
   * escrita (mandato del dueño): no espera a la medida. Al medirse la voz,
   * registrarMedidaVoz migra el nombre a `nombresPorVoz`.
   */
  nombresPorEtiqueta: Map<string, string>
  /**
   * Bautizo pendiente de una locución ABIERTA sin etiqueta (API `registerName`
   * antes de que la fila exista). Se aplica SOLO a esa locución; nunca a la
   * siguiente (el pendiente global fue el defecto medido 2026-11-10).
   */
  pendienteNombre: { locutionId: string; nombre: string } | null
  /** PCM retenido de la locución abierta (tope en `configuracion`), para medir. */
  muestrasAbierta: Float32Array[]
  /** Tramos cuyo audio YA entró en `muestrasAbierta` (evita duplicarlo al reatribuir). */
  tramosDeLaAbierta: Set<string>
  /** Muestras retenidas en el último intento de medida temprana (freno de reintentos). */
  muestrasEnUltimoIntento: number
  /** Muestras PCM entregadas a la ingesta en la sesión (Caso 5, sin tope). */
  totalMuestrasEntregadas: number
  /**
   * Ancla muestra↔reloj del primer bloque entregado (null hasta el primer
   * audio): fecha cualquier tramo en hora de VOZ aunque su fila se escriba
   * después. La escribe SOLO la ingesta; el cierre la lee para sellar la fila.
   */
  anclaAudio: AnclaAudio | null
  /** Voces nuevas contadas en la sesión (`Hablante N`). */
  contadorVoces: number
  /** ¿Hay una medida de voz en curso para la locución abierta? */
  medidaVozEnCurso: boolean
  /**
   * Fin cubierto por la última medida de voz de CADA tramo (el abierto es una
   * clave más, por `locutionId`). Freno del re-embed por resultado: con el VAD
   * cortado dentro de la frase, todos los interinos llegan con el tramo nuevo y
   * sin este mapa cada uno re-embebía la MISMA ventana en la cola única
   * (lentitud letra por letra, medido 2026-11-12). En el tramo abierto marca
   * además hasta dónde llega el contador del cambio de voz (partición Caso 1+3).
   */
  medidoHastaPorTramo: Map<string, number>
  /** Ventanas SEGUIDAS de voz distinta ya contadas (confirmación Caso 1+3). */
  contadorCambioVoz: number
  /** Primera ventana sospechosa retenida: su audio y su texto van al hablante nuevo si se confirma. */
  candidatoCambioVoz: { limite: number; textoAntes: string } | null
  /**
   * Hora del RELOJ en que el final del ASR se aplicó a la locución abierta
   * (la arma el flujo de texto; cada bloque con voz la rearma la ingesta).
   * La frontera adelanta el cierre con `finalCloseConfirmMs` de silencio sin
   * voz desde esta marca. null = sin final aplicado a la locución abierta.
   */
  confirmacionFinalDesdeMs: number | null
  oyentes: Set<(evento: EventoConversacion) => void>
}

/** Superficie que la sesión ofrece al motor y a la ingesta. */
export type Sesion = Readonly<{
  estado: EstadoSesion
  emitir(evento: EventoConversacion): void
  exigirActiva(): string
  fraseActual(): Readonly<{ canonica: string; paraMostrar: string }>
  emitirCaja(): void
  /**
   * Publica el texto de la frase retenida que se dicta ahora. Único escritor:
   * el flujo de texto (`texto.ts`); la caja lo pinta junto al texto abierto.
   * @param texto Texto vigente del pendiente (vacío al aplicar a la línea abierta).
   * @param tramoId Id de la frase retenida (la caja lo usa para no decrecer).
   */
  mostrarPendiente(texto: string, tramoId?: string): void
  snapshot(): InstantaneaConversacion
  contarDescarte: ContarDescarte
  reiniciar(sessionId: string, turno: string, idioma: IdiomaLocucion): void
}> & ReglasCierre

/**
 * Crea el estado vacío de una sesión.
 * @param idiomaInicial Idioma de la tabla de config.
 * @returns Estado sin sesión activa ni locución abierta.
 */
export function crearEstadoSesion(idiomaInicial: IdiomaLocucion): EstadoSesion {
  return {
    activa: false,
    sessionId: null,
    turnoActual: '',
    cerrando: false,
    turnosConFila: new Set(),
    idiomaActual: idiomaInicial,
    estadoAsr: 'idle',
    motorAsr: null,
    abierta: null,
    tramoAudio: null,
    silencioPendienteMs: 0,
    ultimoTramoId: '',
    ultimaEtiqueta: '',
    ultimoResultadoMs: 0,
    textoPendiente: '',
    pendienteTramoId: '',
    cierreAsrPendiente: null,
    descartes: [],
    filas: new Map(),
    nombresPorVoz: new Map(),
    nombresPorEtiqueta: new Map(),
    pendienteNombre: null,
    plantillasVoz: new Map(),
    muestrasAbierta: [],
    tramosDeLaAbierta: new Set(),
    muestrasEnUltimoIntento: 0,
    totalMuestrasEntregadas: 0,
    anclaAudio: null,
    contadorVoces: 0,
    medidaVozEnCurso: false,
    medidoHastaPorTramo: new Map(),
    contadorCambioVoz: 0,
    candidatoCambioVoz: null,
    confirmacionFinalDesdeMs: null,
    oyentes: new Set(),
  }
}

/**
 * Registra la medida de una voz en la sesión (dueño único; la usan `ingesta` y
 * `cierre`). Una voz nueva acuña su plantilla (vector + etiqueta) y cuenta en
 * `contadorVoces`; una voz ya plantillada refresca su vector (deriva dentro de
 * la sesión) y conserva su etiqueta.
 * @param estado Estado mutable de la sesión.
 * @param vector Vector medido que sostiene la decisión.
 * @param identidad Decisión de la regla de identidad.
 */
export function registrarMedidaVoz(
  estado: Pick<
    EstadoSesion,
    'plantillasVoz' | 'contadorVoces' | 'nombresPorVoz' | 'nombresPorEtiqueta'
  >,
  vector: readonly number[],
  identidad: IdentidadDecidida,
): void {
  // Sin vozId no hay identidad: turno corto pendiente. No se acuna plantilla
  // ni se incrementa el contador de voces (auditoria 2026-11-01).
  if (!String(identidad.vozId || '').trim()) return
  const etiquetaDicha = String(identidad.hablante || '').trim()
  const nombreDeEtiqueta = etiquetaDicha
    ? estado.nombresPorEtiqueta.get(etiquetaDicha)
    : undefined
  // El nombre que el comando dio a la etiqueta provisional manda sobre el
  // rótulo anónimo: la voz medida hereda el nombre de ESA etiqueta.
  const etiqueta = nombreDeEtiqueta || etiquetaDicha
  if (nombreDeEtiqueta) estado.nombresPorVoz.set(identidad.vozId, nombreDeEtiqueta)
  if (!identidad.continuidad) estado.contadorVoces += 1
  const existente = estado.plantillasVoz.get(identidad.vozId)
  if (existente) {
    // REFRESCO SOLO SI ES LA MISMA VOZ (medido 2026-11-09 10:35, sesión 36a8bc05): un turno
    // CORTO de otra voz decidido como continuidad sobrescribía el ancla y desde ahí la fila
    // de Luis llevaba el timbre de la mujer (cos 0.436 contra su propio ancla). Un ancla no
    // se envenena con una medida ajena: mismo piso que decide la continuidad.
    const ancla = Array.isArray(existente.vector) ? existente.vector : []
    const mismaVoz =
      ancla.length === 0 ||
      compareCosineSignatures([...vector], [...ancla]) >= sameVoiceFloor()
    if (mismaVoz) existente.vector = [...vector]
    if (etiqueta) existente.etiqueta = etiqueta
    return
  }
  estado.plantillasVoz.set(identidad.vozId, {
    vector: [...vector],
    etiqueta,
  })
}

/**
 * Crea la sesión: estado, caja, snapshot, descartes y reglas de cierre.
 * @param dependencias Puertos de almacén, configuración y registro.
 * @param estado Estado mutable de la sesión.
 * @param configuracion Tabla del plan inyectada.
 * @returns La superficie de sesión que consumen motor e ingesta.
 */
export function crearSesion(
  dependencias: Pick<
    DependenciasConversacion,
    | 'reloj'
    | 'id'
    | 'almacen'
    | 'config'
    | 'partidor'
    | 'registro'
    | 'embebedor'
    | 'medidor'
    | 'transcriptorTramo'
    | 'anclasBase'
  >,
  tramos: RegistroTramos,
  estado: EstadoSesion,
  configuracion: ConfiguracionConversacion,
): Sesion {
  const { reloj, id, almacen, config, partidor, registro, embebedor, medidor } = dependencias

  /** Emite un evento a los oyentes actuales (una copia, por si se dan de baja). */
  function emitir(evento: EventoConversacion): void {
    for (const oyente of [...estado.oyentes]) oyente(evento)
  }

  /** Exige sesión activa y devuelve su id. */
  function exigirActiva(): string {
    if (!estado.activa || !estado.sessionId) throw new Error('conversacion no iniciada')
    return estado.sessionId
  }

  /** Frase canónica y presentación de la locución abierta. */
  function fraseActual(): Readonly<{ canonica: string; paraMostrar: string }> {
    const partida = partidor.partir(estado.abierta?.texto ?? '')
    return { canonica: partida.canonica, paraMostrar: partida.paraMostrar }
  }

  /** Emite `box.updated` con el texto abierto, el retenido y su presentación. */
  function emitirCaja(): void {
    if (!estado.sessionId) return
    const frase = fraseActual()
    const pendiente = partidor.partir(estado.textoPendiente)
    emitir({
      tipo: 'box.updated',
      sessionId: estado.sessionId,
      texto: estado.abierta?.texto ?? '',
      abierta: Boolean(estado.abierta),
      locucionAbiertaId: estado.abierta?.locutionId ?? '',
      fraseCanonica: frase.canonica,
      fraseParaMostrar: frase.paraMostrar,
      textoPendiente: estado.textoPendiente,
      textoPendienteId: estado.pendienteTramoId,
      fraseCanonicaPendiente: pendiente.canonica,
      fraseParaMostrarPendiente: pendiente.paraMostrar,
    })
  }

  /**
   * Publica el texto de la frase retenida que se dicta ahora. Único escritor:
   * el flujo de texto; la caja lo pinta aunque la locución anterior siga abierta.
   * @param texto Texto vigente del pendiente (vacío al aplicar a la línea abierta).
   * @revisor CREAR NUEVO — la caja solo pintaba `estado.abierta`; el pendiente
   *   que se dicta en vivo no tenía emisor y la pantalla se congelaba.
   */
  function mostrarPendiente(texto: string, tramoId = ''): void {
    const limpio = String(texto || '').trim()
    const id = limpio ? String(tramoId || '').trim() : ''
    if (limpio === estado.textoPendiente && id === estado.pendienteTramoId) return
    estado.textoPendiente = limpio
    estado.pendienteTramoId = id
    emitirCaja()
  }

  /** Snapshot síncrono; la retención solo oculta del snapshot, no borra filas. */
  function snapshot(): InstantaneaConversacion {
    const frase = fraseActual()
    const limite = reloj.ahora() - configuracion.maxRetentionMin * 60_000
    return {
      sessionId: estado.sessionId,
      activa: estado.activa,
      box: {
        texto: estado.abierta?.texto ?? '',
        abierta: Boolean(estado.abierta),
        textoPendiente: estado.textoPendiente,
      },
      fraseCanonica: frase.canonica,
      fraseParaMostrar: frase.paraMostrar,
      idioma: estado.idiomaActual,
      asr: estado.estadoAsr,
      locucionAbierta: estado.abierta
        ? {
            locutionId: estado.abierta.locutionId,
            texto: estado.abierta.texto,
            turnId: estado.abierta.turnId,
            tramo: {
              inicio: estado.abierta.inicio,
              fin: estado.abierta.fin,
              sampleRate: estado.abierta.sampleRate,
            },
          }
        : null,
      filas: [...estado.filas.values()].filter(
        (fila) => fila.sessionId === estado.sessionId && fila.updated_at >= limite,
      ),
      tramoAudio: estado.tramoAudio
        ? {
            tramoId: estado.tramoAudio.tramoId,
            inicio: estado.tramoAudio.inicio,
            fin: estado.tramoAudio.fin,
            sampleRate: estado.tramoAudio.sampleRate,
            silencioPrevioMs: estado.tramoAudio.silencioPrevioMs,
          }
        : null,
      totalMuestrasEntregadas: estado.totalMuestrasEntregadas,
      descartes: [...estado.descartes],
    }
  }

  /** Cuenta un descarte con motivo; nunca se pierde en silencio. */
  const contarDescarte: ContarDescarte = (motivo, locutionId, tramo) => {
    estado.descartes = [
      ...estado.descartes,
      { motivo, locutionId, sessionId: estado.sessionId ?? '' },
    ]
    registro.registrar('conversacion.descarte', {
      sessionId: estado.sessionId,
      locutionId,
      motivo,
      tramo,
    })
  }

  const reglas: ReglasCierre = crearReglasCierre({
    estado,
    emitir,
    emitirCaja,
    contarDescarte,
    registro,
    almacen,
    config,
    configuracion,
    id,
    embebedor,
    medidor,
    transcriptorTramo: dependencias.transcriptorTramo,
    tramos,
    anclasBase: dependencias.anclasBase,
  })

  /**
   * Resetea el estado de una sesión nueva sin perder filas ni oyentes.
   *
   * Deriva del estado VACÍO (`crearEstadoSesion`): un campo nuevo nace
   * reseteado por construcción y no hay dos listas de inicialización que
   * puedan divergir. Solo `filas` (histórico de la caja) y `oyentes`
   * (suscripciones vivas) sobreviven al cambio de sesión; `activa` queda en
   * `false`, que es la invariante del arranque (`motor.iniciar` la exige).
   * @param sessionId Id de la sesión que abre.
   * @param turno Turno de sesión ('' si lo acuña cada locución).
   * @param idioma Idioma vigente de la sesión.
   */
  function reiniciar(sessionId: string, turno: string, idioma: IdiomaLocucion): void {
    Object.assign(estado, crearEstadoSesion(idioma), {
      sessionId,
      turnoActual: turno,
      filas: estado.filas,
      oyentes: estado.oyentes,
    })
  }

  return {
    estado,
    emitir,
    exigirActiva,
    fraseActual,
    emitirCaja,
    mostrarPendiente,
    snapshot,
    contarDescarte,
    ...reglas,
    reiniciar,
  }
}
