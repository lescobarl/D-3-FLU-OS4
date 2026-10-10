// ============================================================
// vozLocucionRecompuestaGuard - B4: la locucion se RECOMPONE antes de commitear; ningun
// fragmento entra cortado.
// ------------------------------------------------------------
// MEDIDO (2026-10-10, con las funciones reales):
//   reconcileCommitText('a comer del', 'vamos a comer del plato') -> 'a comer del'
//   resolveTurnCommitPhrase({capture:'a comer del', fallback:'vamos a comer del plato'})
//       -> 'a comer del'
// El ASR cierra el turno con un TROZO de la locucion (corte a mitad de frase) y el commit
// escribia ESE trozo, aunque lo ultimo mostrado (`publishedLive`) y el texto validado del
// turno tuvieran la locucion COMPLETA: la fila quedaba cortada ("a comer del").
//
// DUENO UNICO: `recomposeLocution` (turnStream.js) = si el trozo es un FRAGMENTO de la
// locucion completa, manda la completa. Lo consumen `reconcileCommitText` (lado mostrado) y
// `resolveTurnCommitPhrase` (lado texto validado).
// ============================================================
import { describe, expect, it } from 'vitest'
import { reconcileCommitText, recomposeLocution } from '../src/voice/lib/turnStream.js'
import { resolveTurnCommitPhrase } from '../src/voice/lib/turnCommitPhrase.js'

describe('B4 - ningun fragmento entra cortado', () => {
  it('el trozo central se recompone con lo ultimo mostrado', () => {
    expect(reconcileCommitText('a comer del', 'vamos a comer del plato')).toBe('vamos a comer del plato')
    expect(reconcileCommitText('del plato', 'vamos a comer del plato')).toBe('vamos a comer del plato')
    expect(reconcileCommitText('plato', 'vamos a comer del plato')).toBe('vamos a comer del plato')
  })

  it('el texto VALIDADO del turno tambien recompone el trozo crudo', () => {
    expect(
      resolveTurnCommitPhrase({
        capture: 'a comer del',
        fallback: 'vamos a comer del plato',
        log: () => {},
      }),
    ).toBe('vamos a comer del plato')
  })

  it('la locucion completa NUNCA se degrada con un trozo', () => {
    expect(reconcileCommitText('vamos a comer del plato', 'a comer del')).toBe('vamos a comer del plato')
    expect(recomposeLocution('vamos a comer del plato', 'a comer del')).toBe('vamos a comer del plato')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): un texto NUEVO no se sustituye', () => {
    // Lo que el usuario dijo NO es fragmento de lo mostrado -> se conserva lo nuevo.
    expect(reconcileCommitText('pon la alarma', 'vamos a comer del plato')).toBe('pon la alarma')
    expect(recomposeLocution('pon la alarma', 'vamos a comer del plato')).toBe('pon la alarma')
    // El fragmento solo cuenta si es CONTIGUO y en orden.
    expect(recomposeLocution('plato del', 'vamos a comer del plato')).toBe('plato del')
    expect(recomposeLocution('comer plato', 'vamos a comer del plato')).toBe('comer plato')
  })
})
