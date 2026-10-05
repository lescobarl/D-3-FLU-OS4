// ============================================================
// musicActions - CONDUCTA del catalogo de ids de accion de musica.
//
// Este modulo es la FUENTE UNICA del VALOR de los ids (antes copiado en
// tres sitios y con fallo SILENCIOSO: una accion desconocida solo hacia
// que no sonara nada). Se mide la conducta observable: que acciones se
// admiten, que se normaliza y que se rechaza.
// ============================================================
import { describe, it, expect } from 'vitest'

import { MUSIC_ACTIONS, asMusicAction, resolveMusicControl } from '../src/core/media/musicActions'

describe('MUSIC_ACTIONS - conjunto admitido de acciones de musica', () => {
  it('contiene exactamente reproducir, pausar y detener', () => {
    expect([...MUSIC_ACTIONS]).toEqual(['play_music', 'pause_music', 'stop_music'])
  })

  it('no admite acciones de otros dominios (play, stop, next)', () => {
    expect(MUSIC_ACTIONS as readonly string[]).not.toContain('play')
    expect(MUSIC_ACTIONS as readonly string[]).not.toContain('stop')
    expect(MUSIC_ACTIONS as readonly string[]).not.toContain('next')
  })
})

describe('asMusicAction - normaliza el valor crudo del contrato', () => {
  it('acepta cada id valido tal cual', () => {
    expect(asMusicAction('play_music')).toBe('play_music')
    expect(asMusicAction('pause_music')).toBe('pause_music')
    expect(asMusicAction('stop_music')).toBe('stop_music')
  })

  it('recorta espacios alrededor del id', () => {
    expect(asMusicAction('  play_music  ')).toBe('play_music')
    expect(asMusicAction('\tstop_music\n')).toBe('stop_music')
  })

  it('devuelve undefined para una cadena desconocida', () => {
    expect(asMusicAction('dar_brincos')).toBeUndefined()
    expect(asMusicAction('')).toBeUndefined()
    expect(asMusicAction('   ')).toBeUndefined()
  })

  it('devuelve undefined para null y undefined', () => {
    expect(asMusicAction(null)).toBeUndefined()
    expect(asMusicAction(undefined)).toBeUndefined()
  })

  it('es sensible a mayusculas: los ids deben venir en minusculas', () => {
    expect(asMusicAction('PLAY_MUSIC')).toBeUndefined()
    expect(asMusicAction('Play_Music')).toBeUndefined()
  })

  it('rechaza valores no textuales (numero, booleano, objeto)', () => {
    expect(asMusicAction(42)).toBeUndefined()
    expect(asMusicAction(true)).toBeUndefined()
    expect(asMusicAction({ action: 'play_music' })).toBeUndefined()
  })

  // CONDUCTA REAL (supuesto inicial falso): el valor se coerciona con String(),
  // asi que un array de UN elemento cae en su contenido y se acepta.
  it('coerciona el crudo con String: un array de un elemento cae en su contenido', () => {
    expect(asMusicAction(['play_music'])).toBe('play_music')
  })

  it('lo aceptado siempre pertenece a MUSIC_ACTIONS (coherencia tipo/valor)', () => {
    for (const accion of MUSIC_ACTIONS) {
      expect(MUSIC_ACTIONS as readonly string[]).toContain(asMusicAction(accion))
    }
  })
})

describe('resolveMusicControl - CONDUCTA de la tabla de control (P8.53 + P8.54)', () => {
  it('el marco por SUBCADENA lleva su objeto: "para/deten/apaga la musica" detiene', () => {
    for (const frase of ['para la musica', 'deten la musica', 'apaga la musica', 'quita la musica']) {
      expect(resolveMusicControl(frase), frase).toBe('stop_music')
    }
    expect(resolveMusicControl('pausa la musica')).toBe('pause_music')
  })

  it('la palabra SUELTA "alto"/"stop" detiene solo si el mandato ENTERO es la palabra', () => {
    for (const frase of ['alto', 'Alto', 'stop', 'stop.']) {
      expect(resolveMusicControl(frase), frase).toBe('stop_music')
    }
    for (const frase of ['habla mas alto', 'el arbol es alto', 'salto', 'un salto alto']) {
      expect(resolveMusicControl(frase), frase).toBeNull()
    }
  })

  it('una PETICION de reproduccion no es un control', () => {
    for (const frase of ['pon musica', 'ponme una cancion', 'reproduce la cancion']) {
      expect(resolveMusicControl(frase), frase).toBeNull()
    }
  })
})
