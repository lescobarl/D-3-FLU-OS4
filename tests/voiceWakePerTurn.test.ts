/**
 * voiceWakePerTurn — Hito #F/#3: la wake autoriza SU enunciado, no se hereda.
 * Un comando no puede ejecutarse sin wake propia (aunque la conversación siga
 * activa por un turno anterior).
 *
 * Nace ROJO: `isCommandAuthorized` aún no existía.
 */
import { describe, expect, it } from 'vitest'
import { isCommandAuthorized } from '../src/voice/lib/deterministicArbiter'

const wakeWords = ['ok flu', 'oye flu']

describe('isCommandAuthorized — wake por turno (§F/#3)', () => {
  it('comando SIN wake en su propio enunciado → NO autorizado', () => {
    expect(isCommandAuthorized('busca en la web cómo se generan los volcanes', { wakeWords })).toBe(false)
  })

  it('comando CON wake en su propio enunciado → autorizado', () => {
    expect(isCommandAuthorized('ok flu busca en la web cómo se generan los volcanes', { wakeWords })).toBe(true)
  })

  it('excepción: control de escucha puede ir sin wake', () => {
    expect(
      isCommandAuthorized('cierra escucha', { wakeWords, allowWithoutWake: true }),
    ).toBe(true)
  })
})
