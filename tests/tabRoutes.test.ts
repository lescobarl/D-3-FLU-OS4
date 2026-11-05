/**
 * P6.6 — tabRoutes: la tabla de rutas del panel derecho.
 *
 * Extraida de App.tsx; antes no tenia prueba propia (el mapeo ruta<->pestana
 * solo se ejercitaba de refilon al montar la app).
 */
import { describe, expect, it } from 'vitest'
import { pathForTab, tabFromPath, type RightTab } from '../src/app/tabRoutes'

const TABS: RightTab[] = ['workspace', 'conversation', 'minutes', 'settings', 'system']

describe('tabRoutes — ruta <-> pestana', () => {
  it('tabFromPath reconoce las cinco rutas', () => {
    for (const tab of TABS) {
      expect(tabFromPath(`/${tab}`)).toBe(tab)
    }
  })

  it('tabFromPath cae a workspace con una ruta desconocida', () => {
    expect(tabFromPath('/no-existe')).toBe('workspace')
    expect(tabFromPath('')).toBe('workspace')
  })

  it('pathForTab es el inverso de tabFromPath', () => {
    for (const tab of TABS) {
      expect(tabFromPath(pathForTab(tab))).toBe(tab)
    }
  })

  it('pathForTab inventa /pestana si la tabla no la conoce', () => {
    expect(pathForTab('otra' as RightTab)).toBe('/otra')
  })
})
