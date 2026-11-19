/**
 * P6.6 — appTypeGuards: predicados de tipo de proveedores.
 *
 * Se derivan del catalogo (AI_PROVIDERS) para que la prueba no pueda quedarse
 * obsoleta si el catalogo cambia.
 */
import { describe, expect, it } from 'vitest'
import { isAIProvider } from '../src/app/appTypeGuards'
import { AI_PROVIDERS } from '../src/core/config/voiceConfigCatalog'

describe('appTypeGuards — predicados', () => {
  it('isAIProvider acepta el catalogo entero y rechaza lo de fuera', () => {
    for (const p of AI_PROVIDERS) expect(isAIProvider(p)).toBe(true)
    expect(isAIProvider('proveedor-inventado')).toBe(false)
  })

  it('PRUEBA DE DETECTOR: el detector marca el valor inventado y no marca los legitimos', () => {
    expect(AI_PROVIDERS.every((p) => isAIProvider(p))).toBe(true)
    expect(isAIProvider('proveedor-inventado')).toBe(false)
  })
})
