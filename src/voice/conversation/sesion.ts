/**
 * SESIÓN del módulo CONVERSACIÓN: estado visible, caja, snapshot y reinicio.
 *
 * Es la única dueña del estado mutable de la sesión. Las reglas de cierre
 * (apertura, revisión, fila, promoción) viven en `cierre.ts`; aquí solo se
 * componen y se publican por la superficie de sesión.
 */
import { crearReglasCierre } from './cierre.ts'
import type { DatosApertura, ReglasCierre } from './cierre.ts'
import type {
  CausaCierre,
  ContarDescarte,
  DescarteConversacion,
  DependenciasConversacion,
  EventoConversacion,
  EvidenciaVoz,
  InstantaneaConversacion,
  LocucionAbierta,
  TramoAudio,
} from './tipos.ts'
import type {
  ConfiguracionConversacion,
  EstadoAsr,
  Fila,
  IdiomaLocucion,
  MedidaVad,
  MotivoCierre,
  MotorAsr,
} from './ports.ts'

/** Estado mutable de una sesión; solo `motor` e `ingesta` lo modifican. */
export type EstadoSesion = {
  activa: boolean
  sessionId: string | null
  turnoActual: string
  idiomaActual: IdiomaLocucion
  estadoAsr: EstadoAsr
  motorAsr: MotorAsr | null
  abierta: LocucionAbierta | null
  tramoAudio: TramoAudio | null
  ultimaMedida: MedidaVad
  silencioPendienteMs: number
  /** Último tramo de audio medido: destina el final que llega tras el cierre. */
  ultimoTramoId: string
  ultimaEtiqueta: string
  ultimaVozId: string
  cierreAsrPendiente: MotivoCierre | null
  descartes: DescarteConversacion[]
  filas: Map<string, Fila>
  nombresPorVoz: Map<string, string>
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
  abrirLocucion(datos: DatosApertura): void
  aplicarRevision(
    locucion: LocucionAbierta,
    texto: string,
    final: boolean,
    voz: EvidenciaVoz,
  ): boolean
  cerrarLocucion(
    locucion: LocucionAbierta,
    motivo: MotivoCierre,
    causa: CausaCierre,
    final: boolean,
  ): Promise<void>
  promoverSiCorresponde(tramoId: string, texto: string): Promise<boolean>
  reiniciar(sessionId: string, turno: string, idioma: IdiomaLocucion): void
}>

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
    idiomaActual: idiomaInicial,
    estadoAsr: 'idle',
    motorAsr: null,
    abierta: null,
    tramoAudio: null,
    ultimaMedida: { hayVoz: false, silencioMs: 0 },
    silencioPendienteMs: 0,
    ultimoTramoId: '',
    ultimaEtiqueta: '',
    ultimaVozId: '',
    cierreAsrPendiente: null,
    descartes: [],
    filas: new Map(),
    nombresPorVoz: new Map(),
    oyentes: new Set(),
  }
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
    'reloj' | 'almacen' | 'config' | 'partidor' | 'registro'
  >,
  estado: EstadoSesion,
  configuracion: ConfiguracionConversacion,
): Sesion {
  const { reloj, almacen, config, partidor, registro } = dependencias

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
          }
        : null,
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
  })

  /** Resetea el estado de una sesión nueva sin perder filas ni oyentes. */
  function reiniciar(sessionId: string, turno: string, idioma: IdiomaLocucion): void {
    estado.sessionId = sessionId
    estado.turnoActual = turno
    estado.idiomaActual = idioma
    estado.abierta = null
    estado.tramoAudio = null
    estado.ultimaMedida = { hayVoz: false, silencioMs: 0 }
    estado.silencioPendienteMs = 0
    estado.ultimoTramoId = ''
    estado.ultimaEtiqueta = ''
    estado.ultimaVozId = ''
    estado.cierreAsrPendiente = null
    estado.descartes = []
    estado.estadoAsr = 'idle'
    estado.motorAsr = null
    estado.nombresPorVoz.clear()
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
