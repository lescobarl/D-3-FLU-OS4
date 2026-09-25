/**
 * P7.8 - Los puentes de despacho se limpian al desmontar (y StrictMode no los pierde).
 *
 * Prueba de COMPORTAMIENTO sobre las funciones reales que usa App.tsx, con una ventana
 * inyectada (`FluBridgeHost`). No comprueba texto: ejecuta el ciclo que hace React.
 */
import { describe, expect, it } from 'vitest'
import {
  clearFluBridges,
  FLU_BRIDGE_NAMES,
  publishFluBridges,
  snapshotFluBridges,
  type FluBridgeHost,
} from '../src/app/fluBridges'

function ventanaConPuentes(): FluBridgeHost {
  return {
    __fluHandleAgendaCommandText: async () => 'ok',
    __fluHandleShoppingText: async () => 'ok',
    __fluHandleNoteText: async () => 'ok',
    __fluHandleDiaryText: async () => 'ok',
  }
}

/** Puentes que siguen publicados en la ventana. */
const presentes = (host: FluBridgeHost): string[] => FLU_BRIDGE_NAMES.filter((n) => n in host)

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
    const host = ventanaConPuentes()
    clearFluBridges(host)
    expect(presentes(host)).toEqual([])
  })

  it('no es decorativo: el detector de limpieza marca lo que sigue publicado', () => {
    const host = ventanaConPuentes()
    expect(presentes(host), 'una ventana sin limpiar debe conservar los 4').toHaveLength(4)
    clearFluBridges(host)
    expect(presentes(host), 'tras limpiar no debe quedar ninguno').toEqual([])
  })

  it('StrictMode: cleanup + effect SIN re-render no debe perder los puentes', () => {
    // Secuencia real de React.StrictMode: render (asigna) -> effect -> cleanup -> effect.
    const host = ventanaConPuentes()
    const snap = snapshotFluBridges(host)
    publishFluBridges(snap, host)
    clearFluBridges(host) // cleanup de StrictMode
    expect(presentes(host), 'el cleanup borro los puentes').toEqual([])
    publishFluBridges(snap, host) // el efecto vuelve a publicar del snapshot
    expect(presentes(host)).toHaveLength(4)
  })

  it('un snapshot previo al montaje (huecos) no publica undefined', () => {
    const host: FluBridgeHost = {}
    publishFluBridges(snapshotFluBridges(host), host)
    expect(presentes(host)).toEqual([])
  })

  it('republicar no pisa un puente distinto que ya estuviera puesto', () => {
    const host = ventanaConPuentes()
    host.__fluHandleNoteText = undefined // hueco aislado
    const snap = snapshotFluBridges(host)
    host.__fluHandleNoteText = undefined
    publishFluBridges(snap, host)
    expect(host.__fluHandleNoteText, 'el hueco no debe resucitar').toBeUndefined()
    expect(typeof host.__fluHandleDiaryText).toBe('function')
  })
})
