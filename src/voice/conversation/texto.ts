/**
 * TEXTO del ASR: eco/barge-in, revisión, pendientes y cierre por texto.
 *
 * El texto se aplica a la locución ANTES de evaluar la frontera (regla 2). Un
 * tramo ajeno sin silencio suficiente se retiene y se abre al cerrar la actual;
 * un huérfano expira contado. No escribe filas: pide el cierre a la sesión.
 */
import { esEcoDeTts } from './eco.ts'
import { decidirFrontera } from './frontera.ts'
import { ventanaDentroDe } from './fila.ts'
import type { Pendientes } from './cola.ts'
import type { RegistroTramos } from './tramos.ts'
import type { Sesion } from './sesion.ts'
import type { AsrIngestado, DependenciasConversacion, EvidenciaVoz } from './tipos.ts'
import type {
  IdiomaLocucion,
  MedidaMotor,
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
  sesion,
  tramos,
  pendientes,
}: {
  dependencias: Pick<DependenciasConversacion, 'reloj' | 'ultimoTextoDicho' | 'config'>
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

  /** Cierra la locución abierta si la frontera lo pide. */
  async function cerrarPorFrontera(
    frontera: { cerrar: boolean },
    causa: Parameters<typeof sesion.cerrarLocucion>[2],
  ): Promise<void> {
    if (!frontera.cerrar) return
    const locucion = estado.abierta
    if (locucion) await sesion.cerrarLocucion(locucion, 'system', causa, locucion.final)
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

  /** Abre los pendientes en orden mientras haya tramo; no duplica ni mezcla. */
  async function flushPendientes(): Promise<void> {
    if (estado.abierta) return
    pendientes.expurgar()
    for (;;) {
      const siguiente = pendientes.primero()
      if (!siguiente) break
      const tramo = siguiente.tramo ?? tramos.resolver(siguiente.tramoId)
      if (!tramo) break
      pendientes.quitarPrimero()
      // El pendiente nace DESPUÉS de su habla: se siembra con SU audio retenido
      // para que la identidad de voz no se mida sobre el silencio o la voz ajena.
      const muestrasIniciales = tramos.muestras(siguiente.tramoId, tramo)
      // El turno VIGENTE manda: el pendiente esperó al commit de la locución
      // anterior y el hook ya avanzó el turno. El de llegada solo respalda una
      // sesión sin turno propio (tests del módulo puro).
      abrirDesde(datosPendiente(siguiente, tramo, muestrasIniciales, estado.turnoActual || siguiente.turnId))
      // MANDATO DEL DUEÑO (2026-10-30): el final NO cierra por contenido. La
      // locución abierta cierra por silencio (5 s), cambio de voz, texto ajeno
      // o fin de sesión; aquí solo se abre y el bucle se detiene (una abierta).
      break
    }
  }

  /** Al cerrar la sesión, cada pendiente acaba en fila o en descarte contado. */
  async function finalizarPendientes(motivo: MotivoCierre): Promise<void> {
    pendientes.expurgar()
    for (;;) {
      const siguiente = pendientes.primero()
      if (!siguiente) break
      pendientes.quitarPrimero()
      const tramo = siguiente.tramo ?? tramos.resolver(siguiente.tramoId)
      if (!tramo) {
        sesion.contarDescarte('huerfano', siguiente.tramoId, null)
        continue
      }
      if (estado.abierta) {
        const previa = estado.abierta
        await sesion.cerrarLocucion(previa, motivo, 'stop', previa.final)
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
      const finalValido =
        Boolean(entrada.final) &&
        (!entrada.tramo ||
          ventanaDentroDe(entrada.tramo, {
            inicio: abierta.inicio,
            fin: abierta.fin,
            sampleRate: abierta.sampleRate,
          }))
      // MANDATO DEL DUEÑO (2026-10-30): el final MARCA la frase completa pero NO
      // cierra: la puerta de cierre es la frontera de abajo (silencio 5 s, cambio
      // de voz, texto ajeno o fin de sesión). Sin cierres ansiosos, la fila sale
      // UNA vez con la frase completa, no palabras cortas por cada final.
      sesion.aplicarRevision(
        abierta,
        texto,
        finalValido,
        voz,
        finalValido ? entrada.medida : undefined,
      )
      const frontera = decidirFrontera({
        medida: estado.ultimaMedida,
        textoAjeno: false,
        abierta: true,
      })
      await cerrarPorFrontera(frontera, 'silencio')
      // Sin flush aquí: ver la nota de `flushPendientes` (turno vigente).
      return
    }

    if (abierta) {
      encolar(entrada, tramoId, texto)
      const registrado = tramos.vigente(tramoId)
      const silencioPrevioMs =
        registrado?.silencioPrevioMs ?? estado.ultimaMedida.silencioMs
      const frontera = decidirFrontera({
        medida: { hayVoz: false, silencioMs: silencioPrevioMs },
        textoAjeno: true,
        abierta: true,
      })
      await cerrarPorFrontera(frontera, 'frontera')
      // Sin flush aquí: el pendiente NO puede nacer con el turno que acaba de
      // commitear la fila anterior. Lo abre el siguiente evento, cuyo turno ya
      // es el vigente (el hook lo avanza con ese commit).
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
