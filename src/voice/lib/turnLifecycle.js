/**
 * Ciclo de vida del trabajo del turno de voz: overlay "Pensando" + cronómetro.
 *
 * Defecto medido: el overlay se gobernaba por la LLAMADA A LA IA (se apagaba en
 * su `finally` y al entrar en SPEAKING), pero el turno sigue trabajando después
 * de la IA (escrituras, despacho de la acción y locución): el mensaje
 * desaparecía mientras FLU seguía haciendo cosas. Y el reparto del tiempo del
 * turno se atribuía por suposición porque solo se cronometraba la firma de audio.
 *
 * Única fuente del contrato: `startTurn` cuando el turno empieza a trabajar,
 * `lap` por fase y `endTurn` cuando termina (con el resumen en una línea). El
 * store y el log se inyectan (DI): este módulo no conoce ni la app ni la consola.
 */
import { createTurnWorkIndicator } from './turnWorkIndicator'
import { createTurnStopwatch } from './turnStopwatch'

/** @param {{ getStore?: () => object|null, log?: (message: string) => void, now?: () => number }} deps */
export function createTurnLifecycle({ getStore, log, now } = {}) {
  const work = createTurnWorkIndicator(getStore, log)
  const stopwatch = createTurnStopwatch(now)

  return {
    /** Arranca el trabajo del turno: overlay encendido y cronómetro a cero. */
    startTurn(reason) {
      stopwatch.restart()
      work.begin(reason)
    },
    /** Fin de una fase del turno (la etiqueta la nombra el llamante). */
    lap(label) {
      stopwatch.lap(label)
    },
    /**
     * FLU empezó a hablar: fin de la ESPERA (lo que el usuario percibe como
     * "procesando"). El cronómetro NO se reinicia: marca el corte para que el
     * resumen distinga tiempo-hasta-respuesta de duración del habla.
     */
    markSpeaking(reason) {
      stopwatch.lap('hastaVoz')
      work.markSpeaking(reason)
      // El número que el usuario percibe: de "procesando" a que FLU habla.
      log?.(`turnTiming: ESPERA_HABLA total=${stopwatch.elapsedMs()}ms (${reason || 'n/d'})`)
    },
    /** ¿Queda trabajo vivo? (diagnóstico) */
    isWorking: () => work.isActive(),
    /** Cierra el turno: overlay apagado y reparto real del tiempo en una línea. */
    endTurn(reason) {
      work.end(reason)
      const summary = `${stopwatch.report()} total=${stopwatch.elapsedMs()}ms`
      log?.(reason ? `${summary} cierre=${reason}` : summary)
    },
    /** Cierra TODO el trabajo vivo (reset de sesión/estado terminal). */
    resetTurn(reason) {
      work.reset(reason)
    },
  }
}
