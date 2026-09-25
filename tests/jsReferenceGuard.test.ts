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
 * Eran 8 en base 7bf93f0. Seis REALES y dos falsos positivos:
 *   - turnTranscript.js:49 usaba `getTranscriptDelta` desnudo, pero el import lo
 *     renombraba a `getTranscriptDeltaFromBoundary`. El caso 1 de aqui LANZABA
 *     ReferenceError.
 *   - conversationStream.js usaba `countSpeechWords` en 4 sitios, y el import lo
 *     renombraba a `countWordsFromPauseCfg`. `evaluateSrGapSegmentCommit` (gap de
 *     10 s por defecto, NO desactivado) LANZABA ReferenceError: casos 3 y 4.
 *   - turnStream.js:37 usaba `readTurnLive` sin importarlo: caso 5.
 *   - micCapture.processor.js: `AudioWorkletProcessor` y `registerProcessor` si
 *     existen, pero en el hilo de audio, y lib.dom no los declara. No tocados
 *     como bug: se declaran en micCapture.processor.d.ts.
 *
 * CAUSA RAIZ de los tres primeros, la misma: `export { X } from './y'` NO crea un
 * binding local de X. Comprobado con Node: da `ReferenceError: X is not defined`.
 * El reexport deja el nombre visible para los demas modulos, pero dentro del
 * fichero X sigue sin existir; por eso los tres pasaban desapercibidos.
 *
 * El guard se prueba con entradas REALES y valores exactos (prueba de mutacion:
 * en base, los casos 1, 3, 4 y 5 fallan con ReferenceError, asi que estos casos
 * falsifican de verdad y no son decorativos).
 */
import { describe, expect, it } from 'vitest'
import { erroresDeNombreLibre } from '../scripts/js-ref-metric.mjs'
import {
  evaluateSrGapSegmentCommit,
  isTailOnlyInterimCapture,
} from '../src/voice/lib/conversationStream.js'
import { getTranscriptDelta } from '../src/voice/lib/transcriptDelta.js'
import { applyMicPreview, createTurnStreamState } from '../src/voice/lib/turnStream.js'
import { stripCommittedPrefix } from '../src/voice/lib/turnTranscript.js'

describe('P6.7 jsReferenceGuard - referencias a nombres que no existen', () => {
  it('stripCommittedPrefix usa el delta real y no un nombre libre', () => {
    // Antes: `getTranscriptDelta is not defined` por este mismo camino.
    expect(stripCommittedPrefix('aa bb', 'xx yy zz')).toBe(getTranscriptDelta('aa bb', 'xx yy zz'))
    expect(stripCommittedPrefix('aa bb', 'xx yy zz')).toBe('xx yy zz')
    // El camino que ya funcionaba (el fragmento empieza por lo registrado) sigue igual.
    expect(stripCommittedPrefix('buenos dias', 'buenos dias que tal')).toBe('que tal')
  })

  it('evaluateSrGapSegmentCommit cuenta palabras y no revienta (linea 359)', () => {
    const r = evaluateSrGapSegmentCommit(
      { openLine: 'hola mundo' },
      { sinceLastResultMs: 10001, lastCommitted: '' },
    )
    expect(r).toEqual({ flush: false, capture: 'hola mundo', reason: 'too-short' })
  })

  it('evaluateSrGapSegmentCommit con prior cuenta la extension (lineas 369/370)', () => {
    const r = evaluateSrGapSegmentCommit(
      { openLine: 'hola mundo que tal' },
      { sinceLastResultMs: 10001, lastCommitted: 'hola' },
    )
    expect(r).toEqual({
      flush: true,
      capture: 'hola mundo que tal',
      reason: 'sr-gap-segment-commit',
      sinceLastResultMs: 10001,
      openLineAgeMs: 0,
    })
  })

  it('isTailOnlyInterimCapture sigue dando un booleano', () => {
    expect(isTailOnlyInterimCapture('hola mundo')).toBe(false)
    expect(typeof isTailOnlyInterimCapture('hola mundo que tal y mas')).toBe('boolean')
  })

  it('applyMicPreview no depende de readTurnLive sin importar (linea 37)', () => {
    const r = applyMicPreview(createTurnStreamState(), {}, {})
    expect(r.changed).toBe(false)
    expect(r.preview).toBe('')
    expect(typeof r.packet).toBe('object')
  })

  // `tsc --checkJs` tarda ~11 s: el timeout se declara aqui para que el
  // guard no dependa de que quien lo invoque pase --testTimeout (lint:guards
  // no lo pasa y el defecto de 5 s lo cortaria).
  it('no queda ningun nombre inexistente en src/ (checkJs)', { timeout: 120000 }, () => {
    // El detector se prueba en los casos de arriba; aqui se mide la ausencia
    // completa. Si aparece un nombre nuevo sin definir, este caso lo caza.
    const errores = erroresDeNombreLibre()
    expect(errores, `nombres inexistentes:\n  ${errores.join('\n  ')}`).toEqual([])
  })
})
