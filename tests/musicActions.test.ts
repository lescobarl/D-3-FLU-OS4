// ============================================================
// musicActions - CONDUCTA del catalogo de ids de accion de musica.
//
// Este modulo es la FUENTE UNICA del VALOR de los ids (antes copiado en
// tres sitios y con fallo SILENCIOSO: una accion desconocida solo hacia
// que no sonara nada). Se mide la conducta observable: que acciones se
// admiten, que se normaliza y que se rechaza.
// ============================================================
import { describe, it, expect } from 'vitest'

import { MUSIC_ACTIONS, asMusicAction, resolveMusicIntent, shouldAutoPlayDanceTrack } from '../src/core/media/musicActions'

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

describe('resolveMusicIntent - CONDUCTA del vocabulario de musica (P8.53/P8.54/P8.56)', () => {
  it('el marco por SUBCADENA lleva su objeto: "para/deten/apaga la musica" detiene', () => {
    for (const frase of ['para la musica', 'deten la musica', 'apaga la musica', 'quita la musica']) {
      expect(resolveMusicIntent(frase), frase).toEqual({ accion: 'stop_music' })
    }
    expect(resolveMusicIntent('pausa la musica')).toEqual({ accion: 'pause_music' })
  })

  it('la palabra SUELTA "alto"/"stop" detiene solo si el mandato ENTERO es la palabra', () => {
    for (const frase of ['alto', 'Alto', 'stop', 'stop.']) {
      expect(resolveMusicIntent(frase), frase).toEqual({ accion: 'stop_music' })
    }
    for (const frase of ['habla mas alto', 'el arbol es alto', 'salto', 'un salto alto']) {
      expect(resolveMusicIntent(frase), frase).toBeNull()
    }
  })

  it('la REPRODUCCION nombra la cancion cuando el mandato la trae', () => {
    expect(resolveMusicIntent('canta la cancion de las mananitas')).toEqual({ accion: 'play_music', cancion: 'las mananitas' })
    expect(resolveMusicIntent('pon musica relajante')).toEqual({ accion: 'play_music', cancion: 'relajante' })
    expect(resolveMusicIntent('reproduce la cancion')).toEqual({ accion: 'play_music' })
  })

  it('sin OBJETO de musica no hay peticion (ni "pon la mesa" ni la LOTERIA "canta otra")', () => {
    for (const frase of ['pon la mesa', 'dame agua', 'toca la guitarra', 'canta otra']) {
      expect(resolveMusicIntent(frase), frase).toBeNull()
    }
  })
})

// Defecto medido (sesion real del dueno, 2026-10-05): "silencio"/"silencio la
// musica" NO detenian la musica (solo "para/deten/apaga/quita/corta"), asi que la
// pista del karaoke sono ~6 min encima de la clase de ingles. Una palabra que el
// usuario dice de forma natural para callar musica tiene que detenerla.
describe('resolveMusicIntent - "silencio" detiene (medido 2026-10-05)', () => {
  it('"silencio" (y con su objeto de musica) detiene la musica', () => {
    for (const frase of ['silencio', 'Silencio', 'silencio la musica', 'silencio a la musica']) {
      expect(resolveMusicIntent(frase), frase).toEqual({ accion: 'stop_music' })
    }
  })

  it('no detiene con una frase que solo CONTIENE la palabra', () => {
    for (const frase of ['hay mucho silencio', 'guarda silencio un momento', 'hable mas silencio']) {
      expect(resolveMusicIntent(frase), frase).toBeNull()
    }
  })
})

// Defecto medido (sesion real del dueno, 2026-10-05): en clase de ingles, la pista
// "baila" arrancaba sola. La decision vivia inline en App y se disparaba tambien
// por la PROPIA respuesta de FLU ("sing/dance"). Fuente unica: el dueno de musica.
describe('shouldAutoPlayDanceTrack - el auto-play solo lo pide el USUARIO', () => {
  it('solo con Dance y sin musica en curso', () => {
    expect(shouldAutoPlayDanceTrack({ detectedAnim: 'Dance', musicaAccion: null, musicPlaying: false })).toBe(true)
    expect(shouldAutoPlayDanceTrack({ detectedAnim: 'Dance', musicaAccion: 'play_music', musicPlaying: false })).toBe(false)
    expect(shouldAutoPlayDanceTrack({ detectedAnim: 'Dance', musicaAccion: null, musicPlaying: true })).toBe(false)
    expect(shouldAutoPlayDanceTrack({ detectedAnim: 'Walk', musicaAccion: null, musicPlaying: false })).toBe(false)
    expect(shouldAutoPlayDanceTrack({})).toBe(false)
  })
})
