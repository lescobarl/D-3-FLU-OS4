/**
 * P6.7 - jsReferenceGuard: ningun fichero de src/ usa un nombre que no existe.
 *
 * CONTEXTO MEDIDO: `tsc -b` no mira los .js porque el tsconfig no tiene checkJs
 * (el item hablaba de "84 .js sin verificar"). Con `--checkJs` el proyecto da
 * 1764 errores, pero 1735 son ruido de tipado incremental (TS2339 745
 * propiedades, TS7006 539 parametros implicitos, TS7031 107...): perseguirlos es
 * reescribir 143 ficheros JS sin tipos, no cerrar un item. La unica clase que
 * significa "esto revienta al ejecutarse" es TS2304/TS2552 ("Cannot find name"):
 * codigo que llama a algo que no existe.
 *
 * CAUSA RAIZ de los casos medidos entonces, la misma: `export { X } from './y'`
 * NO crea un binding local de X. Comprobado con Node: da `ReferenceError: X is
 * not defined`. El reexport deja el nombre visible para los demas modulos, pero
 * dentro del fichero X sigue sin existir.
 *
 * La metrica es una sola fuente (scripts/js-ref-metric.mjs, export
 * `erroresDeNombreLibre`) y este guard la importa para que metrica y guard no
 * puedan divergir.
 *
 * Corte 2026-10-26 (feature/conversacion-modulo-nuevo): los 5 casos de
 * ejemplar (stripCommittedPrefix, evaluateSrGapSegmentCommit x2,
 * isTailOnlyInterimCapture y applyMicPreview) se retiraron con sus duenos
 * (turnTranscript.js BORRADO; conversationStream.js, transcriptDelta.js y
 * turnStream.js huerfanos tras el commit 365eeef5). Quedan los DOS casos que
 * miden la metrica en si: la ausencia completa y el no-bloqueo del event loop.
 */
import { describe, expect, it } from 'vitest'
import { ticksWhile } from './_asyncExec'
import { erroresDeNombreLibre } from '../scripts/js-ref-metric.mjs'

describe('P6.7 jsReferenceGuard - referencias a nombres que no existen', () => {
  // `tsc --checkJs` tarda ~11 s: el timeout se declara aqui para que el
  // guard no dependa de que quien lo invoque pase --testTimeout (lint:guards
  // no lo pasa y el defecto de 5 s lo cortaria).
  it('no queda ningun nombre inexistente en src/ (checkJs)', { timeout: 120000 }, async () => {
    // La metrica es la unica fuente (scripts/js-ref-metric.mjs); aqui se mide la
    // ausencia completa. Si aparece un nombre nuevo sin definir, este caso lo caza.
    const errores = await erroresDeNombreLibre()
    expect(errores, `nombres inexistentes:\n  ${errores.join('\n  ')}`).toEqual([])
  })

  // Defecto medido (P7.68): lanzar `tsc` con `spawnSync` BLOQUEA el event loop del
  // worker durante toda la medicion. Bajo contencion (12 CPUs logicas -> 10 workers)
  // esos ~9 s pasan de los 60 s del timeout del RPC de vitest, el worker deja de
  // latir y la corrida COMPLETA sale roja por "Unhandled Error: [vitest-worker]:
  // Timeout calling onTaskUpdate" con los 3868 tests verdes. MEDIDO con sonda:
  // spawnSync 9445ms/ticks=0, execFile 8913ms/ticks=281. Este caso falsifica de
  // verdad: si alguien vuelve a la version sincrona, ticks es 0 y cae.
  it('la medicion no bloquea el event loop (el RPC del worker sigue latiendo)', { timeout: 120000 }, async () => {
    let errores: string[] = []
    const ticks = await ticksWhile(async () => {
      errores = await erroresDeNombreLibre()
    })
    expect(errores).toEqual([])
    expect(ticks).toBeGreaterThan(0)
  })
})
