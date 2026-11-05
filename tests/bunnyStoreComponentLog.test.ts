/**
 * Test-first del log de componentes del avatar 3D (dictamen §8.5).
 *
 * Fija el comportamiento observable antes de unificar la escritura del log:
 * toggle y visibilidad fija comparten la MISMA entrada, y con logs apagados no
 * se escribe nada.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useBunnyStore } from '../src/avatar/store/bunnyStore'

beforeEach(() => {
  useBunnyStore.setState({ logs: [], logsEnabled: false })
})

describe('bunnyStore — log de componentes', () => {
  it('toggle sin logs no escribe y cambia la visibilidad', () => {
    useBunnyStore.getState().toggleComponent('Bunny_cap')
    const state = useBunnyStore.getState()
    expect(state.components.Bunny_cap).toBe(false)
    expect(state.logs).toHaveLength(0)
  })

  it('toggle con logs escribe SHOW con el componente', () => {
    useBunnyStore.setState({ logsEnabled: true })
    useBunnyStore.getState().toggleComponent('Bunny_glasses')
    const state = useBunnyStore.getState()
    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({ type: 'component', action: 'SHOW' })
    expect(state.logs[0].detail).toContain('Bunny_glasses')
  })

  it('setComponentVisibility fija el valor y escribe HIDE', () => {
    useBunnyStore.setState({ logsEnabled: true })
    useBunnyStore.getState().setComponentVisibility('Bunny_ears', false)
    const state = useBunnyStore.getState()
    expect(state.components.Bunny_ears).toBe(false)
    expect(state.logs.at(-1)).toMatchObject({ type: 'component', action: 'HIDE' })
  })
})
