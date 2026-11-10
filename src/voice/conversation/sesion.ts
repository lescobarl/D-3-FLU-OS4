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
  abierta: LocucionAbierta | null
  tramoAudio: TramoAudio | null
  silencioPendienteMs: number
  /** Último tramo de audio medido: destina el final que llega tras el cierre. */
  ultimoTramoId: string
  ultimaEtiqueta: string
  /**
   * Marca del reloj del ÚLTIMO resultado del ASR. Es la medida del hueco que cierra la
   * locución cuando el reconocedor se queda mudo (`srGapCommitMs`, dueño la sonda del
   * hueco): sin ella, un ASR caído no cierra nada y la locución vive 43 s
   * juntando dos frases (medido 2026-11-08 02:26-02:27 en la sesión del dueño).
   */
  ultimoResultadoMs: number
  cierreAsrPendiente: MotivoCierre | null
  descartes: DescarteConversacion[]
  filas: Map<string, Fila>
  nombresPorVoz: Map<string, string>
  /** Plantillas de TODAS las voces medidas en la sesión (decisión B: efímeras). */
  plantillasVoz: Map<string, PlantillaVoz>
  /**
   * Nombre del bautizo pendiente (problema 5, mandato 2026-10-30): el comando
   * «ok flu soy X» llega con la locución ABIERTA, antes de que la medida de
   * respaldo (al cerrar) resuelva la voz. `cierre.cerrarLocucion` lo aplica a
   * la voz que cierre la locución del comando.
   */
  nombrePendiente: string
  /** PCM retenido de la locución abierta (tope en `configuracion`), para medir. */
  muestrasAbierta: Float32Array[]
  /** Tramos cuyo audio YA entró en `muestrasAbierta` (evita duplicarlo al reatribuir). */
  tramosDeLaAbierta: Set<string>
  /** Muestras retenidas en el último intento de medida temprana (freno de reintentos). */
  muestrasEnUltimoIntento: number
  /** Muestras PCM entregadas a la ingesta en la sesión (Caso 5, sin tope). */
  totalMuestrasEntregadas: number
  /** Voces nuevas contadas en la sesión (`Hablante N`). */
  contadorVoces: number
  /** ¿Hay una medida de voz en curso para la locución abierta? */
  medidaVozEnCurso: boolean
  /** Fin del tramo cubierto por la última medida de voz (partición Caso 1+3). */
  medidoHastaFin: number
  /** Ventanas SEGUIDAS de voz distinta ya contadas (confirmación Caso 1+3). */
  contadorCambioVoz: number
  /** Primera ventana sospechosa retenida: su audio y su texto van al hablante nuevo si se confirma. */
  candidatoCambioVoz: { limite: number; textoAntes: string } | null
  oyentes: Set<(evento: EventoConversacion) => void>
}

/** Superficie que la sesión ofrece al motor y a la ingesta. */
export type Sesion = Readonly<{
  estado: EstadoSesion
  emitir(evento: EventoConversacion): void
  exigirActiva(): string
  fraseActual(): Readonly<{ canonica: string; paraMostrar: string }>
  emitirCaja(): void
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
    cierreAsrPendiente: null,
    descartes: [],
    filas: new Map(),
    nombresPorVoz: new Map(),
    plantillasVoz: new Map(),
    nombrePendiente: '',
    muestrasAbierta: [],
    tramosDeLaAbierta: new Set(),
    muestrasEnUltimoIntento: 0,
    totalMuestrasEntregadas: 0,
    contadorVoces: 0,
    medidaVozEnCurso: false,
    medidoHastaFin: 0,
    contadorCambioVoz: 0,
    candidatoCambioVoz: null,
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
  estado: Pick<EstadoSesion, 'plantillasVoz' | 'contadorVoces'>,
  vector: readonly number[],
  identidad: IdentidadDecidida,
): void {
  // Sin vozId no hay identidad: turno corto pendiente. No se acuna plantilla
  // ni se incrementa el contador de voces (auditoria 2026-11-01).
  if (!String(identidad.vozId || '').trim()) return
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
    if (identidad.hablante) existente.etiqueta = identidad.hablante
    return
  }
  estado.plantillasVoz.set(identidad.vozId, {
    vector: [...vector],
    etiqueta: identidad.hablante,
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
    'reloj' | 'id' | 'almacen' | 'config' | 'partidor' | 'registro' | 'embebedor' | 'medidor'
  >,
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

  /** Emite `box.updated` con el texto abierto y su presentación. */
  function emitirCaja(): void {
    if (!estado.sessionId) return
    const frase = fraseActual()
    emitir({
      tipo: 'box.updated',
      sessionId: estado.sessionId,
      texto: estado.abierta?.texto ?? '',
      abierta: Boolean(estado.abierta),
      fraseCanonica: frase.canonica,
      fraseParaMostrar: frase.paraMostrar,
    })
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
    id,
    embebedor,
    medidor,
  })

  /** Resetea el estado de una sesión nueva sin perder filas ni oyentes. */
  function reiniciar(sessionId: string, turno: string, idioma: IdiomaLocucion): void {
    estado.sessionId = sessionId
    estado.turnoActual = turno
    estado.turnosConFila.clear()
    estado.idiomaActual = idioma
    estado.abierta = null
    estado.tramoAudio = null
    estado.silencioPendienteMs = 0
    estado.ultimoTramoId = ''
    estado.ultimaEtiqueta = ''
    estado.cierreAsrPendiente = null
    estado.descartes = []
    estado.estadoAsr = 'idle'
    estado.motorAsr = null
    estado.nombresPorVoz.clear()
    estado.plantillasVoz.clear()
    estado.nombrePendiente = ''
    estado.muestrasAbierta = []
    estado.tramosDeLaAbierta = new Set()
    estado.muestrasEnUltimoIntento = 0
    estado.totalMuestrasEntregadas = 0
    estado.contadorVoces = 0
    estado.medidaVozEnCurso = false
    estado.medidoHastaFin = 0
    estado.contadorCambioVoz = 0
    estado.candidatoCambioVoz = null
  }

  return {
    estado,
    emitir,
    exigirActiva,
    fraseActual,
    emitirCaja,
    snapshot,
    contarDescarte,
    ...reglas,
    reiniciar,
  }
}
