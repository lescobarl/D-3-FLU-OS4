// ============================================================
// musicCatalog - CONDUCTA del catalogo de pistas.
//
// Es CONFIG, no servicio: las URLs viven aqui y el reproductor
// (src/services/musicPlayer.ts) solo las consume. Se miden las
// invariantes observables del catalogo: forma de cada pista, ids
// unicos, URLs mp3 absolutas y la atribucion honesta de fuente.
// ============================================================
import { describe, it, expect } from 'vitest'

import { MUSIC_CATALOG } from '../src/core/config/musicCatalog'

describe('MUSIC_CATALOG - estructura del catalogo', () => {
  it('no esta vacio y cada pista tiene id, titulo y url no vacios', () => {
    expect(MUSIC_CATALOG.length).toBeGreaterThan(0)
    for (const pista of MUSIC_CATALOG) {
      expect(pista.id.trim().length, `id vacio en ${JSON.stringify(pista)}`).toBeGreaterThan(0)
      expect(pista.title.trim().length).toBeGreaterThan(0)
      expect(pista.url.trim().length).toBeGreaterThan(0)
    }
  })

  it('los ids son unicos (el reproductor los usa como clave)', () => {
    const ids = MUSIC_CATALOG.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('los titulos son unicos', () => {
    const titulos = MUSIC_CATALOG.map((p) => p.title)
    expect(new Set(titulos).size).toBe(titulos.length)
  })

  it('todas las urls son absolutas, https y terminan en .mp3', () => {
    for (const pista of MUSIC_CATALOG) {
      expect(pista.url.startsWith('https://'), pista.url).toBe(true)
      expect(pista.url.toLowerCase().endsWith('.mp3'), pista.url).toBe(true)
    }
  })
})

describe('MUSIC_CATALOG - contenido esperado', () => {
  const porId = (id: string) => MUSIC_CATALOG.find((p) => p.id === id)

  it('incluye las cuatro muestras instrumentales de la base SoundHelix', () => {
    const muestras = ['sueño', 'baila', 'canta', 'fiesta']
    for (const id of muestras) {
      const pista = porId(id)
      expect(pista, `falta ${id}`).toBeDefined()
      expect(pista!.url).toContain('soundhelix.com/examples/mp3/')
    }
    expect(MUSIC_CATALOG.filter((p) => p.url.includes('soundhelix.com'))).toHaveLength(4)
  })

  it('incluye las canciones de dominio publico esperadas', () => {
    for (const id of ['cumpleaños', 'mañanitas', 'estrellita', 'elisa', 'cielito']) {
      expect(porId(id), `falta ${id}`).toBeDefined()
    }
  })

  it('las pistas del Internet Archive declaran una fuente/licencia honesta', () => {
    const archive = MUSIC_CATALOG.filter((p) => p.url.includes('archive.org'))
    expect(archive.length).toBeGreaterThan(0)
    for (const pista of archive) {
      expect(pista.source, `sin source: ${pista.id}`).toBeTruthy()
      expect(pista.source!.toLowerCase()).toContain('archive')
    }
  })

  it('la pista de cumpleaños apunta al Internet Archive', () => {
    expect(porId('cumpleaños')!.url).toContain('archive.org')
  })

  it('la base de las muestras vive en el dominio SoundHelix', () => {
    const base = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-'
    for (const id of ['sueño', 'baila', 'canta', 'fiesta']) {
      expect(porId(id)!.url.startsWith(base)).toBe(true)
    }
  })
})
