/**
 * MOTOR del módulo CONVERSACIÓN: las 7 llamadas del plan sobre un único cola.
 *
 * Compone la sesión, la cola y la ingesta; no decide reglas de dominio. `start`
 * elige UN motor de ASR al abrir (sin fallback en caliente) y lo publica por
 * `asr.status`; `stop` cierra con el motivo declarado y nunca pierde el texto
 * abierto. Todo tiempo sale del reloj inyectado: aquí no hay `Date.now()`.
 */
import { crearCola, crearPendientes } from './cola.ts'
import type { ColaSerializada, Pendientes } from './cola.ts'
import { crearBufferAsr, crearRegistroTramos } from './tramos.ts'
import type { BufferAsr, RegistroTramos } from './tramos.ts'
import { crearIngesta } from './ingesta.ts'
import type { Ingesta } from './ingesta.ts'
import { crearEstadoSesion, crearSesion } from './sesion.ts'
import type { Sesion } from './sesion.ts'
import { CONVERSACION_CONFIG } from './ports.ts'
import type {
  AsrPort,
  ConfiguracionConversacion,
  EstadoAsr,
  MotorAsr,
  MotivoCierre,
  OpcionesAsr,
} from './ports.ts'
import type {
  AsrIngestado,
  ConversacionApi,
  DatosNombre,
  DependenciasConversacion,
  EventoConversacion,
  InstantaneaConversacion,
  OpcionesInicio,
} from './tipos.ts'

/** Elige el motor del ASR al abrir: uno solo, sin fallback en caliente. */
function elegirMotor(
  asr: AsrPort,
  configuracion: ConfiguracionConversacion,
): MotorAsr | null {
  const preferido = configuracion.asr.engine
  if (preferido === 'auto') {
    if (asr.soportado('cloud')) return 'cloud'
    if (asr.soportado('local')) return 'local'
    return null
  }
  return asr.soportado(preferido) ? preferido : null
}

/**
 * Crea una sesión de conversación con sus puertos inyectados.
 *
 * @param dependencias Puertos del producto; la configuración es opcional.
 * @returns Las 7 llamadas del plan sobre un único escritor.
 * @throws Si falta `ultimoTextoDicho`: sin él no hay eco ni barge-in.
 */
export function crearConversacion(dependencias: DependenciasConversacion): ConversacionApi {
  if (typeof dependencias.ultimoTextoDicho !== 'function') {
    throw new Error(
      'ultimoTextoDicho es obligatorio: el modulo no habla ni detecta eco sin el',
    )
  }
  const { reloj, id, registro, asr } = dependencias
  const configuracion = dependencias.configuracion ?? CONVERSACION_CONFIG
  const estado = crearEstadoSesion(configuracion.asr.lang)
  const sesion: Sesion = crearSesion(dependencias, estado, configuracion)
  const cola: ColaSerializada = crearCola()
  const tramos: RegistroTramos = crearRegistroTramos({
    reloj,
    orphanBufferMs: configuracion.orphanBufferMs,
  })
  const pendientes: Pendientes = crearPendientes({
    reloj,
    orphanBufferMs: configuracion.orphanBufferMs,
    contarDescarte: sesion.contarDescarte,
  })
  const bufferAsr: BufferAsr = crearBufferAsr()
  const ingesta: Ingesta = crearIngesta({
    dependencias,
    configuracion,
    sesion,
    tramos,
    pendientes,
    bufferAsr,
  })

  /** Abre la sesión y, si hay ASR, lo arranca con un solo motor. */
  async function iniciar(opciones?: OpcionesInicio): Promise<InstantaneaConversacion> {
    if (estado.activa) throw new Error('conversacion ya iniciada: stop antes de start')
    const sessionId = id.uuid()
    const turno = opciones?.turnId ? String(opciones.turnId).trim() : id.uuid()
    const idioma = opciones?.idioma ?? configuracion.asr.lang
    sesion.reiniciar(sessionId, turno, idioma)
    tramos.limpiar()
    pendientes.reiniciar()
    bufferAsr.reiniciar()

    if (asr) {
      const motor = elegirMotor(asr, configuracion)
      if (!motor) {
        estado.estadoAsr = 'no-permission'
        sesion.emitir({
          tipo: 'asr.status',
          sessionId,
          estado: estado.estadoAsr,
          detalle: 'sin motor disponible',
        })
        registro.registrar('conversacion.asr.no-permission', { sessionId })
      } else {
        estado.motorAsr = motor
        estado.estadoAsr = 'starting'
        sesion.emitir({ tipo: 'asr.status', sessionId, estado: estado.estadoAsr })
        const opcionesAsr: OpcionesAsr = {
          idioma,
          motor,
          alResultado: (resultado) => {
            bufferAsr.agregar({
              ...resultado,
              tramoId: estado.tramoAudio?.tramoId ?? estado.abierta?.locutionId ?? '',
            })
          },
          alEstado: (nuevo: EstadoAsr, detalle?: string) => {
            estado.estadoAsr = nuevo
            sesion.emitir({
              tipo: 'asr.status',
              sessionId,
              estado: nuevo,
              ...(detalle ? { detalle } : {}),
            })
            if (nuevo === 'watchdog') estado.cierreAsrPendiente = 'watchdog'
            if (nuevo === 'error' || nuevo === 'aborted') estado.cierreAsrPendiente = 'system'
          },
        }
        const inicial = await asr.iniciar(opcionesAsr)
        if (inicial !== estado.estadoAsr) {
          estado.estadoAsr = inicial
          sesion.emitir({ tipo: 'asr.status', sessionId, estado: inicial })
        }
        if (motor === 'cloud') {
          registro.registrar('conversacion.asr.cloud.audio.sale', {
            sessionId,
            detalle: 'El motor de nube procesa el audio fuera del equipo',
          })
        }
      }
    }

    estado.activa = true
    await ingesta.drenarResultadosAsr()
    return sesion.snapshot()
  }

  /** Cierra la sesión con el motivo declarado; jamás pierde el texto abierto. */
  async function detener(stopKind: MotivoCierre): Promise<InstantaneaConversacion> {
    const sessionId = sesion.exigirActiva()
    if (stopKind !== 'user' && stopKind !== 'system' && stopKind !== 'watchdog') {
      throw new Error(`stop(${String(stopKind)}) no es un motivo de fila`)
    }
    await ingesta.drenarResultadosAsr()
    estado.cierreAsrPendiente = null
    if (estado.abierta) {
      const locucion = estado.abierta
      await sesion.cerrarLocucion(locucion, stopKind, 'stop', false)
    }
    await ingesta.finalizarPendientes(stopKind)
    if (asr && estado.motorAsr) asr.detener()
    estado.tramoAudio = null
    estado.ultimaMedida = { hayVoz: false, silencioMs: 0 }
    estado.silencioPendienteMs = 0
    estado.estadoAsr = 'idle'
    sesion.emitir({ tipo: 'asr.status', sessionId, estado: estado.estadoAsr })
    estado.activa = false
    return sesion.snapshot()
  }

  /** Bautiza únicamente la voz que dijo `ok flu soy XXX`. */
  function registrarNombre(datos: DatosNombre): InstantaneaConversacion {
    const sessionId = sesion.exigirActiva()
    const nombre = String(datos.nombre || '').trim()
    if (!nombre) throw new Error('nombre vacio: no se bautiza una voz sin nombre')
    if (nombre === '?') throw new Error('nombre ? prohibido')
    const vozId = String(datos.vozId || estado.abierta?.voz.vozId || '').trim()
    if (!vozId) {
      throw new Error('sin voz identificada: no se bautiza una voz que no hablo')
    }
    estado.nombresPorVoz.set(vozId, nombre)
    if (estado.abierta && estado.abierta.voz.vozId === vozId) {
      estado.abierta = {
        ...estado.abierta,
        voz: { ...estado.abierta.voz, nombre, nombreConfirmado: true },
      }
    } else if (estado.abierta && !estado.abierta.voz.vozId && datos.vozId) {
      estado.abierta = { ...estado.abierta, voz: { ...estado.abierta.voz, vozId } }
    }
    sesion.emitir({
      tipo: 'speaker.labeled',
      sessionId,
      locutionId: estado.abierta?.locutionId ?? '',
      etiqueta: nombre,
      evidencia: 'nombre',
    })
    registro.registrar('conversacion.voz.bautizada', {
      sessionId,
      vozId,
      nombre,
      locutionId: estado.abierta?.locutionId ?? null,
    })
    return sesion.snapshot()
  }

  /** Suscribe a los eventos; el oyente que lanza propaga su error al llamador. */
  function suscribir(oyente: (evento: EventoConversacion) => void): () => void {
    estado.oyentes.add(oyente)
    return () => {
      estado.oyentes.delete(oyente)
    }
  }

  return {
    start: (opciones) => cola.serializar(() => iniciar(opciones)),
    stop: (stopKind) => cola.serializar(() => detener(stopKind)),
    ingestAudio: (bloque) => cola.serializar(() => ingesta.ingestaAudio(bloque)),
    ingestAsr: (resultado: AsrIngestado) => cola.serializar(() => ingesta.ingestaAsr(resultado)),
    snapshot: sesion.snapshot,
    subscribe: suscribir,
    registerName: registrarNombre,
  }
}
