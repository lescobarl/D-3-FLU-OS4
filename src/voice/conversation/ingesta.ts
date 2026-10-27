/**
 * INGESTA del módulo CONVERSACIÓN: audio, drenaje del ASR y cierre pendiente.
 *
 * Mide con el VAD inyectado, corta el tramo y evalúa la frontera; el flujo de
 * texto (eco, revisión, pendientes) vive en `texto.ts`. No escribe filas: pide
 * el cierre a la sesión.
 */
import { decidirFrontera } from './frontera.ts'
import { crearFlujoTexto } from './texto.ts'
import type { FlujoTexto } from './texto.ts'
import type { Pendientes } from './cola.ts'
import type { BufferAsr, RegistroTramos } from './tramos.ts'
import type { Sesion } from './sesion.ts'
import { decidirIdentidad } from './identidad.ts'
import { concatenarMuestras, retenerCola } from './muestras.ts'
import { fusionarVoz } from './fila.ts'
import { asrEmpujaAudio } from './ports.ts'
import type { ConfiguracionConversacion, MotivoCierre } from './ports.ts'
import type {
  AsrIngestado,
  BloqueAudio,
  DependenciasConversacion,
  InstantaneaConversacion,
  LocucionAbierta,
  TramoAudio,
} from './tipos.ts'

/** Superficie de ingesta que consume el motor. */
export type Ingesta = Readonly<{
  ingestaAudio(bloque: BloqueAudio): Promise<InstantaneaConversacion>
  ingestaAsr(entrada: AsrIngestado): Promise<InstantaneaConversacion>
  drenarResultadosAsr(): Promise<void>
  cerrarPendienteAsr(): Promise<void>
  finalizarPendientes(motivo: MotivoCierre): Promise<void>
}>

/**
 * Crea la ingesta de la sesión.
 * @param opciones Puertos, config, sesión y retenes de la cola.
 * @returns Las operaciones de audio y ASR que el motor serializa.
 */
export function crearIngesta({
  dependencias,
  configuracion,
  sesion,
  tramos,
  pendientes,
  bufferAsr,
  encolar,
}: {
  dependencias: Pick<
    DependenciasConversacion,
    'reloj' | 'id' | 'vad' | 'asr' | 'ultimoTextoDicho' | 'config' | 'registro' | 'embebedor'
  >
  configuracion: ConfiguracionConversacion
  sesion: Sesion
  tramos: RegistroTramos
  pendientes: Pendientes
  bufferAsr: BufferAsr
  /** Reentrada a la cola ÚNICA: la medida temprana muta el estado al resolverse. */
  encolar: <T>(tarea: () => Promise<T>) => Promise<T>
}): Ingesta {
  const estado = sesion.estado
  const flujo: FlujoTexto = crearFlujoTexto({
    dependencias,
    sesion,
    tramos,
    pendientes,
  })

  /**
   * Tramo de un resultado que no trae id: el vigente al PROCESAR (la cola ya
   * ingirió el audio) y, si no hay ninguno abierto, el último medido, que
   * destina el final tardío del tramo ya cerrado.
   */
  function tramoVigente(): string {
    return (
      estado.tramoAudio?.tramoId ||
      estado.abierta?.locutionId ||
      estado.ultimoTramoId ||
      ''
    )
  }

  /** Drena los resultados del `AsrPort` en orden; el tramo se fija al drenar. */
  async function drenarResultadosAsr(): Promise<void> {
    for (const crudo of bufferAsr.drenar()) {
      const tramoId = crudo.tramoId || tramoVigente()
      await flujo.procesarResultadoAsr({ ...crudo, tramoId })
    }
  }

  /** Cierra lo abierto si el ASR avisó de un estado terminal (watchdog/error). */
  async function cerrarPendienteAsr(): Promise<void> {
    if (!estado.cierreAsrPendiente) return
    const motivo = estado.cierreAsrPendiente
    estado.cierreAsrPendiente = null
    if (estado.abierta) {
      const locucion = estado.abierta
      await sesion.cerrarLocucion(locucion, motivo, 'asr', locucion.final)
    }
    await flujo.flushPendientes(motivo)
  }

  /** Ingesta un bloque de audio: mide, corta el tramo y evalúa la frontera. */
  async function ingestaAudio(bloque: BloqueAudio): Promise<InstantaneaConversacion> {
    sesion.exigirActiva()
    await drenarResultadosAsr()
    await cerrarPendienteAsr()

    const sampleRate = Number(bloque.sampleRate)
    const inicio = Number(bloque.inicio)
    const fin =
      bloque.fin === undefined ? inicio + bloque.muestras.length : Number(bloque.fin)
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error(`sampleRate invalido: ${bloque.sampleRate}`)
    }
    if (!Number.isFinite(inicio) || inicio < 0) {
      throw new Error(`indice de muestra invalido: ${bloque.inicio}`)
    }
    if (!Number.isFinite(fin) || fin <= inicio) {
      throw new Error(`tramo de audio invalido: [${inicio}, ${fin}]`)
    }
    // Caso 5 (INGESTA): un bloque validado está ENTREGADO, con voz o sin ella.
    // El criterio es entregadas >= 0,98N de la sesión. Único dueño del contador.
    estado.totalMuestrasEntregadas += bloque.muestras.length
    if (estado.tramoAudio && estado.tramoAudio.sampleRate !== sampleRate) {
      throw new Error(
        `sampleRate inconsistente en el tramo ${estado.tramoAudio.tramoId}: ${estado.tramoAudio.sampleRate} != ${sampleRate}`,
      )
    }
    if (bloque.turnId) estado.turnoActual = String(bloque.turnId).trim()

    const medida =
      bloque.medida ??
      (dependencias.vad
        ? dependencias.vad.medir(bloque.muestras, sampleRate)
        : null)
    if (!medida) throw new Error('falta medida VAD: sin medida no hay frontera')
    estado.ultimaMedida = medida

    if (!estado.tramoAudio) {
      if (medida.hayVoz) {
        const tramoId = dependencias.id.uuid()
        const nuevo: TramoAudio = {
          tramoId,
          inicio,
          fin,
          sampleRate,
          turnId: estado.turnoActual,
          silencioPrevioMs: estado.silencioPendienteMs,
        }
        estado.silencioPendienteMs = 0
        estado.tramoAudio = nuevo
        estado.ultimoTramoId = tramoId
        tramos.registrar(nuevo)
        if (!estado.abierta) {
          sesion.abrirLocucion({
            tramoId,
            texto: '',
            tramo: { inicio, fin, sampleRate },
            turnId: estado.turnoActual,
            idioma: estado.idiomaActual,
            voz: {},
          })
        }
        if (dependencias.asr && asrEmpujaAudio(estado.motorAsr)) {
          dependencias.asr.empujarAudio(bloque.muestras, sampleRate)
        }
      }
    } else {
      const finPrevio = estado.tramoAudio.fin
      const actualizado: TramoAudio = {
        ...estado.tramoAudio,
        fin: Math.max(estado.tramoAudio.fin, fin),
      }
      estado.tramoAudio = actualizado
      tramos.registrar(actualizado)
      if (estado.abierta && estado.abierta.locutionId === actualizado.tramoId) {
        estado.abierta = { ...estado.abierta, fin: actualizado.fin }
      }
      if (dependencias.asr && asrEmpujaAudio(estado.motorAsr)) {
        dependencias.asr.empujarAudio(bloque.muestras, sampleRate)
      }
      if (!medida.hayVoz && medida.silencioMs >= configuracion.minSilenceMs) {
        const candidato =
          actualizado.fin - Math.round((medida.silencioMs * sampleRate) / 1000)
        const finHabla = candidato > actualizado.inicio ? candidato : finPrevio
        const cortado: TramoAudio = { ...actualizado, fin: finHabla }
        tramos.registrar(cortado)
        if (estado.abierta && estado.abierta.locutionId === cortado.tramoId) {
          estado.abierta = { ...estado.abierta, fin: cortado.fin }
        }
        estado.silencioPendienteMs = medida.silencioMs
        estado.tramoAudio = null
        // Caso 7+6: el corte NO cierra por reloj; si el final del tramo ya
        // llegó, este cierre es POR CONTENIDO (causa 'final', no 'frontera').
        if (
          estado.abierta &&
          estado.abierta.locutionId === cortado.tramoId &&
          estado.abierta.final
        ) {
          await sesion.cerrarLocucion(estado.abierta, 'system', 'final', true)
          await flujo.flushPendientes('system')
        }
      }
    }

    const abierta = estado.abierta
    if (abierta) {
      estado.muestrasAbierta = retenerCola(
        estado.muestrasAbierta,
        bloque.muestras,
        configuracion.maxSegundosVozRetenida * sampleRate,
      )
      lanzarMedidaSiCorresponde(abierta, sampleRate)
    }
    if (abierta) {
      const frontera = decidirFrontera({
        medida,
        textoAjeno: false,
        abierta: true,
      })
      if (frontera.cerrar) {
        await sesion.cerrarLocucion(abierta, 'system', 'silencio', abierta.final)
        await flujo.flushPendientes('system')
      }
    }
    return sesion.snapshot()
  }

  /** Ingesta un resultado del ASR por su tramo (regla 3). */
  async function ingestaAsr(entrada: AsrIngestado): Promise<InstantaneaConversacion> {
    sesion.exigirActiva()
    await drenarResultadosAsr()
    await cerrarPendienteAsr()
    const tramoId = String(entrada.tramoId || '').trim() || tramoVigente()
    if (!tramoId) {
      // Sin audio medido no hay tramo: se cuenta, no se inventa uno.
      sesion.contarDescarte('huerfano', null, entrada.tramo ?? null)
      return sesion.snapshot()
    }
    await flujo.procesarResultadoAsr({ ...entrada, tramoId })
    return sesion.snapshot()
  }

  /**
   * Medida TEMPRANA de la voz: con el puerto y audio retenido suficiente, se
   * embebe en el worker mientras la locución sigue abierta (como hacía el
   * preflight, pero decidida por el módulo). La continuación vuelve por la cola
   * ÚNICA: el estado solo muta serializado. Un fallo se registra y no rompe la
   * locución (cerrará con continuidad/semilla).
   */
  function lanzarMedidaSiCorresponde(locucion: LocucionAbierta, sampleRate: number): void {
    const embebedor = dependencias.embebedor
    if (!embebedor || String(locucion.voz.vozId || '').trim() || estado.medidaVozEnCurso) {
      return
    }
    const totalMuestras = estado.muestrasAbierta.reduce(
      (suma, bloque) => suma + bloque.length,
      0,
    )
    if (sampleRate > 0 && totalMuestras / sampleRate < configuracion.minSegundosVozMedida) {
      return
    }
    const locutionId = locucion.locutionId
    estado.medidaVozEnCurso = true
    embebedor.medir(concatenarMuestras(estado.muestrasAbierta), sampleRate).then(
      (vector) => encolar(() => Promise.resolve().then(() => aplicarMedidaVoz(locutionId, vector))),
      (error) =>
        encolar(() =>
          Promise.resolve().then(() => {
            estado.medidaVozEnCurso = false
            dependencias.registro.registrar('conversacion.voz.medida.fallo', {
              sessionId: estado.sessionId,
              locutionId,
              error,
            })
          }),
        ),
    )
  }

  /** Aplica la medida a la locución abierta (dentro de la cola): una sola vez. */
  function aplicarMedidaVoz(locutionId: string, vector: readonly number[] | null): void {
    estado.medidaVozEnCurso = false
    const abierta = estado.abierta
    const embebedor = dependencias.embebedor
    if (!abierta || !embebedor || !vector) return
    if (abierta.locutionId !== locutionId) return
    if (String(abierta.voz.vozId || '').trim()) return
    const identidad = decidirIdentidad({
      vector,
      ultimoVozId: estado.ultimaVozId,
      ultimoVector: estado.ultimoVectorVoz,
      umbral: dependencias.config.umbralContinuidadVoz(),
      // Perezoso: la plantilla SOLO se resuelve si la voz es nueva (Caso 10).
      etiquetaNueva: () => dependencias.config.etiquetaAnonima(estado.contadorVoces + 1),
      comparar: embebedor.comparar,
      id: dependencias.id.uuid,
    })
    if (!identidad.continuidad) estado.contadorVoces += 1
    estado.ultimaVozId = identidad.vozId
    estado.ultimoVectorVoz = [...vector]
    estado.abierta = {
      ...abierta,
      voz: fusionarVoz(abierta.voz, {
        vozId: identidad.vozId,
        hablante: identidad.hablante,
        continuidad: identidad.continuidad,
      }),
      continuidadVoz: identidad.continuidad,
    }
  }

  return {
    ingestaAudio,
    ingestaAsr,
    drenarResultadosAsr,
    cerrarPendienteAsr,
    finalizarPendientes: flujo.finalizarPendientes,
  }
}
