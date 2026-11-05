/**
 * P6.6 — appTypeGuards: predicados de tipo de componentes y proveedores.
 *
 * Extraidos de App.tsx. Se derivan del catalogo (AI_PROVIDERS) para que la
 * prueba no pueda quedarse obsoleta si el catalogo cambia.
 */
import { describe, expect, it } from 'vitest'
import { isAIProvider, isBunnyComponent } from '../src/app/appTypeGuards'
import { AI_PROVIDERS } from '../src/core/config/voiceConfigCatalog'

const MIEMBROS_BUNNY = [
  'Bunny_full',
  'Bunny_body',
  'Bunny_cap',
  'Bunny_pants',
  'Bunny_face',
  'Bunny_eyes',
  'Bunny_glasses',
  'Bunny_ears',
]

describe('appTypeGuards — predicados', () => {
  it('isBunnyComponent acepta los ocho miembros del tipo', () => {
    for (const c of MIEMBROS_BUNNY) expect(isBunnyComponent(c)).toBe(true)
  })

  it('isBunnyComponent rechaza lo que no esta en la lista', () => {
    expect(isBunnyComponent('Bunny_inventado')).toBe(false)
    expect(isBunnyComponent('')).toBe(false)
  })

  it('isAIProvider acepta el catalogo entero y rechaza lo de fuera', () => {
    for (const p of AI_PROVIDERS) expect(isAIProvider(p)).toBe(true)
    expect(isAIProvider('proveedor-inventado')).toBe(false)
  })

  it('PRUEBA DE DETECTOR: el detector marca el valor inventado y no marca los legitimos', () => {
    const inventados = ['Bunny_inventado', '', 'proveedor-inventado']
    const marcas = inventados.filter((v) => isBunnyComponent(v) || isAIProvider(v))
    expect(marcas).toEqual([])
    expect(MIEMBROS_BUNNY.every((c) => isBunnyComponent(c))).toBe(true)
    expect(AI_PROVIDERS.every((p) => isAIProvider(p))).toBe(true)
  })
})
