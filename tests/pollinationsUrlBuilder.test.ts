/**
 * P7.6 - El ensamblado de la URL de imagen de Pollinations vive solo en su dueno.
 *
 * POR QUE EXISTE: el dueno (`sharedConfig.buildPollinationsImageUrl`) y el pipeline
 * visual (`fluVisualPipeline.buildPollinationsArtifact`) construian la misma URL por
 * separado. La BASE ya era unica (C7 pollinationsFuenteUnica), pero la ENSAMBLADURA
 * no: el pipeline visual la hacia a mano y ademas evadia transportSingleOwnerGuard
 * usando `params.set('nologo', 'true')` en vez del literal `nologo=true`.
 *
 * El test fija las dos cosas: la forma historica del dueno (para no romper a sus
 * llamadores) y que el artefacto visual pasa por el dueno.
 */
import { describe, expect, it } from 'vitest'
import { buildPollinationsImageUrl, POLLINATIONS_DEFAULTS } from '../src/core/config/sharedConfig'
import { buildPollinationsArtifact } from '../src/voice/lib/fluVisualPipeline.js'

const BASE = POLLINATIONS_DEFAULTS.BASE_URL
const CANONICA = 'https://image.pollinations.ai/prompt'

describe('P7.6 - buildPollinationsImageUrl (dueno unico)', () => {
  it('la base canonica es la de /prompt', () => {
    expect(BASE).toBe(CANONICA)
  })

  it('forma historica intacta: width, height, nologo (sin seed)', () => {
    expect(buildPollinationsImageUrl(BASE, 'un gato')).toBe(
      CANONICA + '/un%20gato?width=1024&height=768&nologo=true',
    )
  })

  it('el seed explicito se anexa al final, como antes', () => {
    expect(buildPollinationsImageUrl(BASE, 'x', { seed: 7 })).toBe(
      CANONICA + '/x?width=1024&height=768&nologo=true&seed=7',
    )
  })

  it('model y enhance son opcionales y no ensucian la forma base', () => {
    const sin = buildPollinationsImageUrl(BASE, 'x')
    expect(sin).not.toContain('model=')
    expect(sin).not.toContain('enhance=')
    const con = buildPollinationsImageUrl(BASE, 'x', { model: 'flux', enhance: true })
    expect(con).toContain('&model=flux')
    expect(con).toContain('&enhance=true')
  })

  it('nologo:false lo omite', () => {
    expect(buildPollinationsImageUrl(BASE, 'x', { nologo: false })).not.toContain('nologo')
  })
})

describe('P7.6 - el artefacto visual pasa por el dueno', () => {
  it('construye la URL canonica con los parametros del pipeline visual', () => {
    const a = buildPollinationsArtifact('un gato', { seedInput: 'es::un gato' })
    expect(a.image_url.startsWith(CANONICA + '/un%20gato?')).toBe(true)
    for (const p of ['width=', 'height=', 'model=flux', 'nologo=true', 'enhance=true', 'seed=']) {
      expect(a.image_url, 'falta ' + p).toContain(p)
    }
  })

  it('no es decorativo: el artefacto aporta params que la llamada pelada no tiene', () => {
    // Si el artefacto NO pasara por el dueno, se perderian model/enhance del pipeline.
    const pelada = buildPollinationsImageUrl(BASE, 'un gato')
    const artefacto = buildPollinationsArtifact('un gato', { seedInput: 'x' }).image_url
    expect(pelada).not.toContain('model=')
    expect(pelada).not.toContain('enhance=')
    expect(artefacto).toContain('&model=flux')
    expect(artefacto).toContain('&enhance=true')
    expect(artefacto).not.toBe(pelada)
  })

  it('el seed es estable para el mismo seedInput (hash determinista)', () => {
    const a = buildPollinationsArtifact('un gato', { seedInput: 'es::un gato' })
    const b = buildPollinationsArtifact('un gato', { seedInput: 'es::un gato' })
    expect(a.image_url).toBe(b.image_url)
  })
})
