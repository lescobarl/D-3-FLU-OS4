/**
 * TEXTO del ASR: eco/barge-in, revisión, pendientes y cierre por texto.
 *
 * El texto se aplica a la locución ANTES de evaluar la frontera (regla 2). Un
 * tramo ajeno sin silencio suficiente se retiene y se abre al cerrar la actual;
 * un huérfano expira contado. No escribe filas: pide el cierre a la sesión.
 */
import { DEFAULT_SAMPLE_RATE } from '../lib/audioConstants.js'
import { continuaLaFrase } from '../core/locucion.js'
import { esEcoDeTts } from './eco.ts'
import { decidirFrontera } from './frontera.ts'
import type { DecisionFrontera } from './frontera.ts'
import { ventanaDentroDe } from './fila.ts'
import type { Pendientes } from './cola.ts'
import type { RegistroTramos } from './tramos.ts'
import type { Sesion } from './sesion.ts'
import type {
  AsrIngestado,
  DependenciasConversacion,
  EntradaPendiente,
  EvidenciaVoz,
  LocucionAbierta,
} from './tipos.ts'
import type {
  ConfiguracionConversacion,
  IdiomaLocucion,
  MedidaMotor,
  MedidaVad,
  MotivoCierre,
  TramoMuestreado,
} from './ports.ts'

/** Superficie del flujo de texto que compone la ingesta. */
export type FlujoTexto = Readonly<{
  procesarResultadoAsr(entrada: AsrIngestado): Promise<void>
  flushPendientes(): Promise<void>
  finalizarPendientes(motivo: MotivoCierre): Promise<void>
}>

/**
 * Crea el flujo de texto de la sesión.
 * @param opciones Puertos, sesión, registro de tramos y retén de pendientes.
 * @returns Procesamiento de resultados, apertura de pendientes y finalización.
 */
export function crearFlujoTexto({
  dependencias,
  configuracion,
  sesion,
  tramos,
  pendientes,
}: {
  dependencias: Pick<DependenciasConversacion, 'reloj' | 'ultimoTextoDicho' | 'config'>
  configuracion: ConfiguracionConversacion
  sesion: Sesion
  tramos: RegistroTramos
  pendientes: Pendientes
}): FlujoTexto {
  const estado = sesion.estado

  /**
   * Abre la locución con los datos ya resueltos por el flujo de texto. Es el
   * ÚNICO ensamblado de `DatosApertura` en este flujo: los caminos aportan sus
   * datos y el dueño de la apertura aplica defaults y normaliza.
   * @param datos Campos resueltos por el llamador.
   */
  function abrirDesde(datos: {
    tramoId: string
    texto: string
    tramo: TramoMuestreado
    turnId: string
    idioma: IdiomaLocucion
    voz: EvidenciaVoz
    finalLlego: boolean
    medidaMotor?: MedidaMotor
    muestrasIniciales?: readonly Float32Array[] | null
  }): void {
    sesion.abrirLocucion({
      tramoId: datos.tramoId,
      texto: datos.texto,
      tramo: datos.tramo,
      turnId: datos.turnId,
      idioma: datos.idioma,
      voz: datos.voz,
      finalLlego: datos.finalLlego,
      medidaMotor: datos.medidaMotor,
      ...(datos.muestrasIniciales ? { muestrasIniciales: datos.muestrasIniciales } : {}),
    })
  }

  /** Datos de apertura de un pendiente (dueño único del literal). */
  function datosPendiente(
    p: {
      tramoId: string
      texto: string
      idioma: Parameters<typeof abrirDesde>[0]['idioma']
      voz: Parameters<typeof abrirDesde>[0]['voz']
      final: boolean
      medida?: Parameters<typeof abrirDesde>[0]['medidaMotor']
    },
    tramo: Parameters<typeof abrirDesde>[0]['tramo'],
    muestrasIniciales: Parameters<typeof abrirDesde>[0]['muestrasIniciales'],
    turnId: string,
  ): Parameters<typeof abrirDesde>[0] {
    return {
      tramoId: p.tramoId,
      texto: p.texto,
      tramo,
      turnId,
      idioma: p.idioma,
      voz: p.voz,
      finalLlego: p.final,
      medidaMotor: p.medida,
      muestrasIniciales,
    }
  }

  /** Cierra la locución abierta si la frontera lo pide (dueño único: frontera.ts). */
  async function cerrarPorFrontera(frontera: DecisionFrontera): Promise<void> {
    if (!frontera.cerrar || !frontera.causa) return
    const locucion = estado.abierta
    if (locucion) {
      await sesion.cerrarLocucion(locucion, 'system', frontera.causa, locucion.final)
    }
  }

  /**
   * El final solo completa la frase si su ventana cabe DENTRO del tramo ya
   * cerrado de la locución (un final con ventana ajena no la marca).
   */
  function finalDentroDeLaAbierta(
    abierta: LocucionAbierta,
    entrada: AsrIngestado,
  ): boolean {
    return (
      Boolean(entrada.final) &&
      (!entrada.tramo ||
        ventanaDentroDe(entrada.tramo, {
          inicio: abierta.inicio,
          fin: abierta.fin,
          sampleRate: abierta.sampleRate,
        }))
    )
  }

  /**
   * Aplica el texto/final a la locución abierta. La frontera NO se evalúa aquí:
   * el silencio lo decide `ingestaAudio` y la voz `ingestaAsr`, ambos con el
   * dueño único `frontera.ts`. Así un final no cierra ni se mide con el silencio
   * de APERTURA del tramo.
   */
  function aplicarTextoDeLaAbierta(
    abierta: LocucionAbierta,
    texto: string,
    finalValido: boolean,
    voz: EvidenciaVoz,
    medida: MedidaMotor | undefined,
    tramoOrigen: string,
  ): void {
    sesion.aplicarRevision(
      abierta,
      texto,
      finalValido,
      voz,
      finalValido ? medida : undefined,
      tramoOrigen,
    )
  }

  /** Idioma de la locución: la nube queda fija al arrancar; local autodetecta. */
  function idiomaDe(entrada: AsrIngestado): IdiomaLocucion {
    if (estado.motorAsr === 'cloud') return estado.idiomaActual
    return entrada.idioma ?? estado.idiomaActual
  }

  /** Retiene un texto de tramo ajeno sin mezclarlo con la locución abierta. */
  function encolar(entrada: AsrIngestado, tramoId: string, texto: string): void {
    pendientes.encolar({
      tramoId,
      texto,
      final: Boolean(entrada.final),
      idioma: idiomaDe(entrada),
      turnId: entrada.turnId ? String(entrada.turnId).trim() : estado.turnoActual,
      voz: entrada.voz ?? {},
      tramo: entrada.tramo,
      medida: entrada.medida,
      recibidoAt: dependencias.reloj.ahora(),
    })
  }

  /**
   * Drena el retén. El agrupado por enunciado ya lo hizo `cola.encolar`; aquí
   * solo se descarta el grupo SIN texto (`huerfano`). Un grupo con texto nunca
   * se tira.
   */
  function drenarPendientes(): EntradaPendiente[] {
    const lotes: EntradaPendiente[] = []
    for (;;) {
      const siguiente = pendientes.primero()
      if (!siguiente) break
      pendientes.quitarPrimero()
      if (!String(siguiente.texto || '').trim()) {
        sesion.contarDescarte('huerfano', siguiente.tramoId, siguiente.tramo ?? null)
        continue
      }
      lotes.push(siguiente)
    }
    return lotes
  }

  /** Abre el primer grupo; el resto queda retenido en orden. */
  async function flushPendientes(): Promise<void> {
    if (estado.abierta) return
    const lotes = drenarPendientes()
    const primero = lotes[0]
    if (!primero) return
    for (const lote of lotes.slice(1)) pendientes.encolar(lote)
    const tramo = primero.tramo ?? tramos.resolver(primero.tramoId)
    if (!tramo) {
      // Durante la sesión NO se inventa un tramo: el grupo espera al stop, que
      // crea UN sintético por grupo sin audio real (nunca uno por pendiente).
      pendientes.encolar(primero)
      return
    }
    // El pendiente nace DESPUÉS de su habla: se siembra con SU audio retenido
    // para que la identidad de voz no se mida sobre el silencio o la voz ajena.
    const muestrasIniciales = tramos.muestras(primero.tramoId, tramo)
    // El turno VIGENTE manda: el pendiente esperó al commit de la locución
    // anterior y el hook ya avanzó el turno.
    abrirDesde(datosPendiente(primero, tramo, muestrasIniciales, estado.turnoActual || primero.turnId))
  }

  /**
   * Tramo de respaldo para un pendiente con texto cuyo tramo ya venció: el stop
   * no puede tirar la frase. Solo el texto vacío sigue siendo huérfano.
   */
  function tramoSintetico(p: {
    tramoId: string
    texto: string
    turnId: string
    tramo?: TramoMuestreado
  }): TramoMuestreado | null {
    if (!String(p.texto || '').trim()) return null
    const sampleRate = p.tramo?.sampleRate || DEFAULT_SAMPLE_RATE
    const tramo = { inicio: 0, fin: 1, sampleRate }
    tramos.registrar({
      tramoId: p.tramoId,
      inicio: tramo.inicio,
      fin: tramo.fin,
      sampleRate,
      turnId: p.turnId,
      silencioPrevioMs: 0,
    })
    return tramo
  }

  /** Al cerrar la sesión, cada FRASE pendiente acaba en UNA fila o descarte. */
  async function finalizarPendientes(motivo: MotivoCierre): Promise<void> {
    const lotes = drenarPendientes()
    if (estado.abierta) {
      const abierta = estado.abierta
      const primero = lotes[0]
      // A y el primer grupo solo se funden si son la MISMA frase o la MISMA voz.
      // Si son frases ajenas, A se cierra ANTES y el grupo emite su fila; nunca
      // se deja que `unirRevision` conserve A y pierda B (o al revés).
      const misma =
        Boolean(primero) && continuaLaFrase(abierta.texto, primero.texto)
      if (primero && misma) {
        sesion.aplicarRevision(
          abierta,
          primero.texto,
          Boolean(abierta.final || primero.final),
          primero.voz,
          primero.medida,
          primero.tramoId,
        )
        lotes.shift()
      }
      const cerrada = estado.abierta ?? abierta
      await sesion.cerrarLocucion(cerrada, motivo, 'stop', cerrada.final)
    }
    for (const siguiente of lotes) {
      const tramo =
        siguiente.tramo ?? tramos.resolver(siguiente.tramoId) ?? tramoSintetico(siguiente)
      if (!tramo) {
        sesion.contarDescarte('huerfano', siguiente.tramoId, null)
        continue
      }
      const muestrasIniciales = tramos.muestras(siguiente.tramoId, tramo)
      abrirDesde(datosPendiente(siguiente, tramo, muestrasIniciales, siguiente.turnId))
      const locucion = estado.abierta
      if (locucion) await sesion.cerrarLocucion(locucion, motivo, 'stop', locucion.final)
    }
  }

  /** Procesa un resultado ya identificado por tramo (cola ordenada). */
  async function procesarResultadoAsr(entrada: AsrIngestado): Promise<void> {
    const sesionId = sesion.exigirActiva()
    const tramoId = String(entrada.tramoId || '').trim()
    // SIN TRAMO solo es huérfano si NO hay locución abierta (regla 1). Con la
    // locución abierta, el texto sin tramo es de otra frase que el VAD no
    // segmentó: entra por la puerta de texto ajeno (se retiene como pendiente y
    // su llegada evalúa la frontera), nunca se tira en silencio.
    if (!tramoId && !estado.abierta) {
      sesion.contarDescarte('huerfano', null, null)
      return
    }

    const texto = String(entrada.texto || '')

    if (dependencias.config.esComandoDeControl?.(texto)) {
      sesion.contarDescarte('control', tramoId, null)
      return
    }

    const dicho = String(dependencias.ultimoTextoDicho() || '').trim()
    if (dicho) {
      if (esEcoDeTts(texto, dicho, dependencias.config.echoMinPalabrasCola())) {
        sesion.contarDescarte('eco', tramoId, null)
        return
      }
      sesion.emitir({
        tipo: 'barge.in',
        sessionId: sesionId,
        locutionId: estado.abierta?.locutionId ?? tramoId,
        texto,
      })
    }

    // MANDATO DEL DUEÑO (2026-10-30, insert-only): la reentrega de un tramo ya
    // commiteado se ignora — la fila es inmutable, no se promueve ni reescribe.
    if (sesion.tramoYaCommiteado(tramoId)) return

    const voz = entrada.voz ?? {}
    const turnId = entrada.turnId ? String(entrada.turnId).trim() : estado.turnoActual
    if (entrada.turnId) estado.turnoActual = turnId

    if (!estado.abierta) await flushPendientes()

    const abierta = estado.abierta
    if (abierta && abierta.locutionId === tramoId) {
      // Caso 7+6: el final SOLO completa la frase si su ventana cabe DENTRO del
      // tramo cerrado de la locución (un final con ventana ajena no la marca).
      const finalValido = finalDentroDeLaAbierta(abierta, entrada)
      // MANDATO DEL DUEÑO (2026-10-30): el final MARCA la frase completa pero NO
      // cierra: la puerta de cierre es la frontera (silencio medido o cambio de
      // voz medido). Sin cierres ansiosos, la fila sale UNA vez con la frase
      // completa, no palabras cortas por cada final.
      aplicarTextoDeLaAbierta(abierta, texto, finalValido, voz, entrada.medida, tramoId)
      // Sin flush aquí: ver la nota de `flushPendientes` (turno vigente).
      return
    }

    if (abierta) {
      // La frontera por TIEMPO se mide con el silencio MEDIDO antes del tramo
      // entrante, no con el hueco de índices ni con la última medida acumulada.
      const silencioPrevioMs =
        entrada.silencioPrevioMs ??
        tramos.vigente(tramoId)?.silencioPrevioMs ??
        0
      // La MISMA FRASE la decide `continuaLaFrase`; la voz ya la verificó
      // `ingesta.verificarCambioVoz` sobre el tramo entrante antes de llegar aquí.
      const continua = continuaLaFrase(abierta.texto, texto)
      const medidaVad: MedidaVad = { hayVoz: false, silencioMs: silencioPrevioMs }
      // UNA sola puerta: `frontera.ts` decide con silencio medido o voz distinta.
      const frontera = decidirFrontera({
        medida: medidaVad,
        textoAjeno: true,
        abierta: true,
      }, configuracion)
      if (frontera.cerrar) {
        await cerrarPorFrontera(frontera)
        encolar(entrada, tramoId, texto)
        // El grupo pendiente se abre EN EL ACTO: la caja pinta la frase nueva
        // antes del stop.
        await flushPendientes()
        return
      }
      if (!continua) {
        // Texto que NO continúa y NINGUNA frontera medida: es otra frase, pero
        // A no se cierra. Queda pendiente hasta el silencio o la voz distinta.
        encolar(entrada, tramoId, texto)
        return
      }
      // MISMA frase y sin frontera: el texto entra en la abierta y la caja lo
      // pinta ya.
      const finalValido = finalDentroDeLaAbierta(abierta, entrada)
      aplicarTextoDeLaAbierta(abierta, texto, finalValido, voz, entrada.medida, tramoId)
      return
    }

    const tramo = tramos.resolver(tramoId, entrada.tramo)
    if (!tramo) {
      encolar(entrada, tramoId, texto)
      return
    }
    // El final puede llegar después de sonar su tramo: se siembra su audio
    // retenido (si lo hay) para que la voz de la fila sea la de SU hablante.
    const muestrasIniciales = tramos.muestras(tramoId, tramo)
    abrirDesde({
      tramoId,
      texto,
      tramo,
      turnId,
      idioma: idiomaDe(entrada),
      voz,
      finalLlego: Boolean(entrada.final),
      medidaMotor: entrada.medida,
      muestrasIniciales,
    })
    // MANDATO DEL DUEÑO (2026-10-30): el final MARCA la frase completa pero NO
    // cierra; la locución abierta espera la frontera (silencio, voz, ajeno, fin).
  }

  return { procesarResultadoAsr, flushPendientes, finalizarPendientes }
}
