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
import type { AsrIngestado, DependenciasConversacion } from './tipos.ts'
import type { IdiomaLocucion, MotivoCierre } from './ports.ts'

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
      sesion.abrirLocucion({
        tramoId: siguiente.tramoId,
        texto: siguiente.texto,
        tramo,
        turnId: siguiente.turnId,
        idioma: siguiente.idioma,
        voz: siguiente.voz,
        finalLlego: siguiente.final,
        medidaMotor: siguiente.medida,
      })
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
      sesion.abrirLocucion({
        tramoId: siguiente.tramoId,
        texto: siguiente.texto,
        tramo,
        turnId: siguiente.turnId,
        idioma: siguiente.idioma,
        voz: siguiente.voz,
        finalLlego: siguiente.final,
        medidaMotor: siguiente.medida,
      })
      const locucion = estado.abierta
      if (locucion) await sesion.cerrarLocucion(locucion, motivo, 'stop', locucion.final)
    }
  }

  /** Procesa un resultado ya identificado por tramo (cola ordenada). */
  async function procesarResultadoAsr(entrada: AsrIngestado): Promise<void> {
    const sesionId = sesion.exigirActiva()
    const tramoId = String(entrada.tramoId || '').trim()
    if (!tramoId) {
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
      if (frontera.cerrar) {
        const locucion = estado.abierta
        if (locucion) await sesion.cerrarLocucion(locucion, 'system', 'silencio', locucion.final)
        await flushPendientes()
      }
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
      if (frontera.cerrar) {
        const locucion = estado.abierta
        if (locucion) await sesion.cerrarLocucion(locucion, 'system', 'frontera', locucion.final)
        await flushPendientes()
      }
      return
    }

    const tramo = tramos.resolver(tramoId, entrada.tramo)
    if (!tramo) {
      encolar(entrada, tramoId, texto)
      return
    }
    sesion.abrirLocucion({
      tramoId,
      texto,
      tramo,
      turnId,
      idioma: idiomaDe(entrada),
      voz,
      finalLlego: Boolean(entrada.final),
      medidaMotor: entrada.medida,
    })
    // MANDATO DEL DUEÑO (2026-10-30): el final MARCA la frase completa pero NO
    // cierra; la locución abierta espera la frontera (silencio, voz, ajeno, fin).
  }

  return { procesarResultadoAsr, flushPendientes, finalizarPendientes }
}
