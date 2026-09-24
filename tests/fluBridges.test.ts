/**
 * P7.8 - Los puentes de despacho se limpian al desmontar (y StrictMode no los pierde).
 *
 * Prueba de COMPORTAMIENTO sobre las funciones reales que usa App.tsx, con una ventana
 * inyectada. No comprueba texto: ejecuta el ciclo que hace React.
 */
import { describe, expect, it } from 'vitest'
import {
  clearFluBridges,
  FLU_BRIDGE_NAMES,
  publishFluBridges,
  snapshotFluBridges,
  type BridgeTarget,
} from '../src/app/fluBridges'

function ventanaConPuentes(): BridgeTarget {
  const w: BridgeTarget = {}
  for (const n of FLU_BRIDGE_NAMES) w[n] = async () => 'ok'
  return w
}

describe('P7.8 - ciclo de vida de los puentes __fluHandle*', () => {
  it('cubre exactamente los 4 puentes funcionales', () => {
    expect([...FLU_BRIDGE_NAMES].sort()).toEqual(
      [
        '__fluHandleAgendaCommandText',
        '__fluHandleDiaryText',
        '__fluHandleNoteText',
        '__fluHandleShoppingText',
      ].sort(),
    )
  })

  it('el snapshot captura los 4 manejadores publicados', () => {
    const snap = snapshotFluBridges(ventanaConPuentes())
    expect(snap).toHaveLength(4)
    expect(snap.every(([, fn]) => typeof fn === 'function')).toBe(true)
  })

  it('el desmontaje los retira (no quedan cierres colgando)', () => {
    const w = ventanaConPuentes()
    clearFluBridges(w)
    for (const n of FLU_BRIDGE_NAMES) expect(n in w).toBe(false)
  })

  it('StrictMode: cleanup + effect SIN re-render no debe perder los puentes', () => {
    // Secuencia real de React.StrictMode: render (asigna) -> effect -> cleanup -> effect.
    const w = ventanaConPuentes()
    const snap = snapshotFluBridges(w)
    publishFluBridges(snap, w)
    clearFluBridges(w) // cleanup de StrictMode
    for (const n of FLU_BRIDGE_NAMES) expect(n in w, 'el cleanup borro ' + n).toBe(false)
    publishFluBridges(snap, w) // el efecto vuelve a publicar del snapshot
    for (const n of FLU_BRIDGE_NAMES) expect(typeof w[n]).toBe('function')
  })

  it('un snapshot previo al montaje (huecos) no publica undefined', () => {
    const w: BridgeTarget = {}
    publishFluBridges(snapshotFluBridges(w), w)
    for (const n of FLU_BRIDGE_NAMES) expect(n in w).toBe(false)
  })
})
