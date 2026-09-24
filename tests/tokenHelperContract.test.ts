/**
 * Hallazgo externo #1 (P7.11) - contrato de los token helpers.
 *
 * El hallazgo pedia "importar de gameUtils (o justificar dominio distinto)" y se cerro
 * justificando el dominio distinto. Aqui se da el paso que faltaba: la capa de voz ya NO
 * se llama igual que la de juegos (hasVoiceToken / findVoiceTokenIndex frente a hasToken /
 * findTokenIndex), asi que la colision de nombre desaparece y con ella la posibilidad de
 * importar el equivocado. Lo que NO se unifica es el COMPORTAMIENTO: sus contratos siguen
 * siendo distintos a proposito (ver divergencias medidas abajo); unificar cambiaria el
 * parseo de la capa de voz, que es lo que el hallazgo llama "dominio distinto".
 *
 * Esta prueba es la barrera de las dos cosas: que los nombres no vuelvan a colisionar y
 * que cada helper conserve el contrato que le toca.
 */
import { describe, expect, it } from 'vitest'
import * as voz from '../src/voice/lib/configCommands.js'
import { hasVoiceToken } from '../src/voice/lib/configCommands.js'
import { hasToken as hasTokenJuegos, findTokenIndex as idxJuegos } from '../src/core/games/gameUtils'

describe('P7.11 - los token helpers de voz y juegos no comparten nombre', () => {
  it('voz no vuelve a exponer los nombres de juegos (colision retirada por rename)', () => {
    expect('hasToken' in voz, 'voz reabrio la colision: expone hasToken').toBe(false)
    expect('findTokenIndex' in voz, 'voz reabrio la colision: expone findTokenIndex').toBe(false)
    expect(typeof hasVoiceToken).toBe('function')
    // El indice sigue siendo privado: no puede importarse por error.
    expect((voz as { findVoiceTokenIndex?: unknown }).findVoiceTokenIndex).toBeUndefined()
    expect(typeof idxJuegos).toBe('function')
  })

  it('cada helper conserva SU contrato (no son la misma funcion)', () => {
    // El llamador de voz pasa texto normalizado y frases CRUDAS del catalogo.
    expect(hasVoiceToken('activa el modo oscuro', 'ACTIVA')).toBe(true)
    // El de juegos recibe frase ya normalizada por contrato: con caja no casa.
    expect(hasTokenJuegos('activa el modo oscuro', 'ACTIVA')).toBe(false)
    // Y con la frase normalizada, los dos coinciden: el dominio es lo que difiere.
    expect(hasTokenJuegos('activa el modo oscuro', 'activa')).toBe(true)
    // Voz admite el limite de INICIO solo en ^ o espacio; juegos tambien tras puntuacion.
    expect(hasVoiceToken('hola,activa', 'activa')).toBe(false)
    expect(hasTokenJuegos('hola,activa', 'activa')).toBe(true)
  })

  it('ambos coinciden en el caso que importa: palabra completa, no subcadena', () => {
    for (const [nf, nombre] of [
      [hasVoiceToken, 'voz'],
      [hasTokenJuegos, 'juegos'],
    ] as const) {
      expect(nf('desactiva la funcion', 'activa'), nombre).toBe(false)
      expect(nf('activa la funcion', 'activa'), nombre).toBe(true)
      expect(nf('activar settings', 'set'), nombre).toBe(false)
    }
  })

  it('el indice de juegos apunta a la FRASE (no al separador previo)', () => {
    expect(idxJuegos('cumpleanos branding', 'branding')).toBe(11)
    expect(idxJuegos('branding', 'branding')).toBe(0)
    expect(idxJuegos('desactiva la funcion', 'activa')).toBe(null)
  })
})

/** El detector: los dos contratos discrepan sobre este par (texto, frase). */
export function diverge(normalized: string, phrase: string): boolean {
  return hasVoiceToken(normalized, phrase) !== hasTokenJuegos(normalized, phrase)
}

describe('P7.11 - el detector no es decorativo', () => {
  it('detecta la divergencia donde existe de verdad', () => {
    expect(diverge('activa el modo oscuro', 'ACTIVA')).toBe(true)
    expect(diverge('hola,activa', 'activa')).toBe(true)
  })

  it('no da falso positivo donde los contratos coinciden', () => {
    expect(diverge('activa el modo oscuro', 'activa')).toBe(false)
    expect(diverge('desactiva la funcion', 'activa')).toBe(false)
  })

  it('si alguien unifica los COMPORTAMIENTOS, esta prueba se vuelve roja', () => {
    // Unificar = hacer que voz delegue en juegos. Eso forzaria diverge(...) === false en
    // los dos pares divergentes de arriba: el guard lo cazaria.
    const divergenciasMedidas = [
      ['activa el modo oscuro', 'ACTIVA'],
      ['hola,activa', 'activa'],
    ] as const
    const detectadas = divergenciasMedidas.filter(([n, f]) => diverge(n, f)).length
    expect(detectadas, 'sin divergencias el contrato unificado seria indistinguible').toBe(2)
  })
})
