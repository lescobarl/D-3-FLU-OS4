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
import { CONVERSACION_CONFIG, MOTIVOS_CIERRE, MOTOR_ASR_CLOUD, MOTOR_ASR_LOCAL } from './ports.ts'
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
    if (asr.soportado(MOTOR_ASR_CLOUD)) return MOTOR_ASR_CLOUD
    if (asr.soportado(MOTOR_ASR_LOCAL)) return MOTOR_ASR_LOCAL
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
 * @throws Si falta `medidor` (Caso 7+6): sin él la medida del tramo quedaría null.
 */
export function crearConversacion(dependencias: DependenciasConversacion): ConversacionApi {
  if (typeof dependencias.ultimoTextoDicho !== 'function') {
    throw new Error(
      'ultimoTextoDicho es obligatorio: el modulo no habla ni detecta eco sin el',
    )
  }
  if (typeof dependencias.medidor?.medir !== 'function') {
    throw new Error(
      'medidor es obligatorio: sin el, la medida del tramo cerrado quedaria null',
    )
  }
  const { reloj, id, registro, asr } = dependencias
  const configuracion = dependencias.configuracion ?? CONVERSACION_CONFIG
  const estado = crearEstadoSesion(configuracion.asr.lang)
  const tramos: RegistroTramos = crearRegistroTramos({
    reloj,
    orphanBufferMs: configuracion.orphanBufferMs,
  })
  const sesion: Sesion = crearSesion(dependencias, tramos, estado, configuracion)
  const cola: ColaSerializada = crearCola()
  const pendientes: Pendientes = crearPendientes({
    reloj,
    orphanBufferMs: configuracion.orphanBufferMs,
    silenceCloseMs: configuracion.silenceCloseMs,
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
    encolar: cola.serializar,
  })

  /** Abre la sesión y, si hay ASR, lo arranca con un solo motor. */
  async function iniciar(opciones?: OpcionesInicio): Promise<InstantaneaConversacion> {
    if (estado.activa) throw new Error('conversacion ya iniciada: stop antes de start')
    // Caso 11: la grabación activa (recorder) presta SU id a la sesión — un id
    // por grabación, nunca dos. Sin grabación el módulo acuña el propio (N/A).
    const sessionId = String(opciones?.sessionId ?? '').trim() || id.uuid()
    // Caso 8: sin proveedor de turno NO hay turno de sesión (''): cada locución
    // acuña el suyo al abrir, así un turnId agrupa solo lo que ES un turno.
    const turno = opciones?.turnId ? String(opciones.turnId).trim() : ''
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
        if (motor === MOTOR_ASR_CLOUD) {
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
    if (!(MOTIVOS_CIERRE as readonly string[]).includes(stopKind)) {
      throw new Error(`stop(${String(stopKind)}) no es un motivo de fila`)
    }
    // CONGELA la entrada ANTES de volcar: lo que el ASR entregue a partir de aquí
    // («cerrando») ya no entra. El volcado forzado procesa SOLO lo que estaba
    // aceptado en el buffer antes del stop.
    estado.cerrando = true
    await ingesta.drenarResultadosAsr(true)
    estado.cierreAsrPendiente = null
    if (estado.abierta) {
      const locucion = estado.abierta
      await sesion.cerrarLocucion(locucion, stopKind, 'stop', locucion.final)
    }
    await ingesta.finalizarPendientes(stopKind)
    if (asr && estado.motorAsr) asr.detener()
    estado.tramoAudio = null
    estado.silencioPendienteMs = 0
    estado.estadoAsr = 'idle'
    sesion.emitir({ tipo: 'asr.status', sessionId, estado: estado.estadoAsr })
    estado.activa = false
    return sesion.snapshot()
  }

  /**
   * Bautiza la voz que dijo `ok flu soy XXX` y RENOMBRA sus filas ya escritas.
   *
   * El hablante es el ÚNICO campo actualizable de una fila: con el nombre
   * registrado se reemplaza la etiqueta automática (`Hablante N`) de TODAS las
   * filas de ESA voz en esta sesión — «UPDATE ... WHERE voz = la del comando».
   * No hay segundo escritor: se pide al dueño del reetiquetado
   * (`sesion.reetiquetarFila`) fila por fila, y el disparo lo da el consumidor
   * (`conversationMotorProducto`), que es el único que conoce la wake.
   */
  async function registrarNombre(datos: DatosNombre): Promise<InstantaneaConversacion> {
    const sessionId = sesion.exigirActiva()
    const nombre = String(datos.nombre || '').trim()
    if (!nombre) throw new Error('nombre vacio: no se bautiza una voz sin nombre')
    if (nombre === '?') throw new Error('nombre ? prohibido')
    const etiquetaDicha = String(datos.etiqueta || '').trim()
    let vozId = String(datos.vozId || estado.abierta?.voz.vozId || '').trim()
    if (!vozId && etiquetaDicha) {
      // La locución del comando ya cerró: la voz se identifica por la etiqueta
      // que venía usando (una plantilla por voz).
      const candidatas = [...estado.plantillasVoz].filter(
        ([, plantilla]) => String(plantilla.etiqueta || '').trim() === etiquetaDicha,
      )
      // AMBIGUO = NO se bautiza a ciegas (medido 2026-11-09 11:48, sesión 02ba561f): dos
      // voces de la sesión compartían la etiqueta «Hablante 1» y el bautizo se quedó con la
      // PRIMERA del mapa; el nombre «Luis» acabó pegado a la voz de la mujer, cuyas filas
      // siguientes salieron «Luis» con cos 0.397. Con una sola candidata no hay duda.
      if (candidatas.length === 1) vozId = candidatas[0][0]
    }
    if (vozId) {
      // Etiqueta que ESA voz venía usando (su plantilla): es el WHERE del UPDATE.
      // Se captura ANTES de tocar nada; `reetiquetarFila` la sube al nombre.
      const etiquetaDeLaVoz = String(estado.plantillasVoz.get(vozId)?.etiqueta || '').trim()
      const etiquetaWhere = etiquetaDeLaVoz || etiquetaDicha
      estado.nombresPorVoz.set(vozId, nombre)
      if (etiquetaWhere) estado.nombresPorEtiqueta.set(etiquetaWhere, nombre)
      let renombradas = 0
      if (etiquetaWhere) {
        for (const fila of [...estado.filas.values()]) {
          if (fila.deleted || fila.sessionId !== sessionId) continue
          // Solo las filas de ESA voz: las que llevan su etiqueta automática.
          if (fila.etiqueta !== etiquetaWhere) continue
          if (await sesion.reetiquetarFila(fila.locutionId, vozId, nombre)) renombradas += 1
        }
      }
      // La plantilla aprende el nombre: las filas SIGUIENTES de esa voz nacen con él.
      const plantillaDeLaVoz = estado.plantillasVoz.get(vozId)
      if (plantillaDeLaVoz) {
        estado.plantillasVoz.set(vozId, { ...plantillaDeLaVoz, etiqueta: nombre })
      }
      if (renombradas > 0) {
        registro.registrar('conversacion.nombre.renombrado', {
          sessionId,
          vozId,
          nombre,
          filas: renombradas,
        })
      }
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
    // SIN voz medida: la fila del comando YA está escrita. El WHERE es su
    // ETIQUETA, pero `X` y `XX` son ESTADOS compartidos, no voces: renombrar
    // todas las filas de ese estado pegaría el nombre a voces ajenas (regla 9).
    // Con un estado compartido solo se toca la locución que pronunció el nombre.
    const pendienteEtiqueta = String(dependencias.config.etiquetaPendiente?.() || '').trim()
    const noIdentificada = String(dependencias.config.semillaEtiqueta?.() || '').trim()
    const etiquetaEsEstado =
      Boolean(etiquetaDicha) &&
      ((Boolean(pendienteEtiqueta) && etiquetaDicha === pendienteEtiqueta) ||
        (Boolean(noIdentificada) && etiquetaDicha === noIdentificada))
    const locucionId = String(datos.locucionId || '').trim()
    if (etiquetaDicha) {
      // `Hablante N` (voz medida por vector) y nombres propios SÍ son el WHERE
      // de esa voz: se renombran sus filas ya escritas. Un ESTADO compartido
      // (X/XX) solo puede renombrar la locución que pronunció el nombre.
      if (!etiquetaEsEstado) estado.nombresPorEtiqueta.set(etiquetaDicha, nombre)
      const destinos = etiquetaEsEstado
        ? [locucionId ? estado.filas.get(locucionId) : undefined]
        : [...estado.filas.values()].filter(
            (fila) =>
              !fila.deleted &&
              fila.sessionId === sessionId &&
              fila.etiqueta === etiquetaDicha,
          )
      let renombradas = 0
      for (const fila of destinos) {
        if (!fila || fila.deleted || fila.sessionId !== sessionId) continue
        if (await sesion.reetiquetarFila(fila.locutionId, '', nombre, 'nombre')) renombradas += 1
      }
      if (renombradas > 0) {
        registro.registrar('conversacion.nombre.renombrado', {
          sessionId,
          vozId: '',
          nombre,
          filas: renombradas,
          etiqueta: etiquetaDicha,
          ...(locucionId ? { locucionId } : {}),
        })
        registro.registrar('conversacion.voz.bautizada', {
          sessionId,
          vozId: '',
          nombre,
          locutionId: locucionId || null,
        })
        return sesion.snapshot()
      }
    }
    // Sin fila que reetiquetar: solo una locución ABIERTA puede recibir el nombre
    // al cerrar. El pendiente va ACOTADO a esa locución; nunca queda global.
    const abierta = estado.abierta
    if (!abierta) {
      registro.registrar('conversacion.nombre.sinDestino', { sessionId, nombre })
      return sesion.snapshot()
    }
    // El nombre es de la locución que lo dijo: si ya cerró, no se aplica a la
    // siguiente (el pendiente global bautizaba la voz ajena; defecto 2026-11-10).
    if (locucionId && abierta.locutionId !== locucionId) {
      registro.registrar('conversacion.nombre.sinDestino', { sessionId, nombre, locucionId })
      return sesion.snapshot()
    }
    estado.pendienteNombre = { locutionId: abierta.locutionId, nombre }
    registro.registrar('conversacion.nombre.pendiente', {
      sessionId,
      nombre,
      locutionId: abierta.locutionId,
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
    ingestAsr: (resultado: AsrIngestado) => {
      // PINTAR PRIMERO: la caja recibe el interim en el acto, fuera de la cola
      // serial. La verificación de voz sigue en `ingestaAsr` para atribuir/partir,
      // pero ya no bloquea el texto visible.
      const texto = String(resultado.texto || '').trim()
      if (texto && estado.activa) {
        sesion.mostrarPendiente(texto, String(resultado.tramoId || '').trim())
      }
      return cola.serializar(() => ingesta.ingestaAsr(resultado))
    },
    snapshot: sesion.snapshot,
    subscribe: suscribir,
    registerName: registrarNombre,
  }
}
