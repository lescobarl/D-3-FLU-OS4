/**
 * Hallazgo externo #1 (P7.11) - contrato de los token helpers.
 *
 * El hallazgo pedia "importar de gameUtils (o justificar dominio distinto)". La
 * justificacion existia, pero era PROSA en un comentario de duplicationGuard.test.ts.
 * Aqui se convierte en barrera: si alguien "unifica" los dos hasToken pensando que son
 * el mismo, estas pruebas fallan y le ensenan donde se rompe.
 *
 * No se unifican a proposito: NO son la misma funcion (ver divergencias medidas abajo).
 */
import { describe, expect, it } from 'vitest'
import { hasToken as hasTokenVoz } from '../src/voice/lib/configCommands.js'
import { hasToken as hasTokenJuegos, findTokenIndex as idxJuegos } from '../src/core/games/gameUtils'

describe('hasToken: los dos contratos NO son el mismo (justificacion medida, no prosa)', () => {
  it('voz normaliza la FRASE; juegos la exige ya normalizada (diverge en caja)', () => {
    // El llamador de voz pasa texto normalizado y frases CRUDAS del catalogo.
    expect(hasTokenVoz('activa el modo oscuro', 'ACTIVA')).toBe(true)
    // El de juegos recibe frase ya normalizada por contrato: con caja no casa.
    expect(hasTokenJuegos('activa el modo oscuro', 'ACTIVA')).toBe(false)
    // Y con la frase normalizada, los dos coinciden: el dominio es lo que difiere.
    expect(hasTokenJuegos('activa el modo oscuro', 'activa')).toBe(true)
  })

  it('voz admite el limite de INICIO solo en ^ o espacio; juegos tambien tras puntuacion', () => {
    expect(hasTokenVoz('hola,activa', 'activa')).toBe(false)
    expect(hasTokenJuegos('hola,activa', 'activa')).toBe(true)
  })

  it('solo hasToken colisiona: el findTokenIndex de voz es PRIVADO (medido)', () => {
    // Por eso el universo de colisiones solo incluye `hasToken`, no `findTokenIndex`:
    // el de voz no se exporta, asi que no puede importarse por error.
    expect(typeof idxJuegos).toBe('function')
    // El indice de juegos apunta a la FRASE (no al separador previo).
    expect(idxJuegos('cumpleanos branding', 'branding')).toBe(11)
    expect(idxJuegos('branding', 'branding')).toBe(0)
    expect(idxJuegos('desactiva la funcion', 'activa')).toBe(null)
  })

  it('ambos coinciden en el caso que importa: palabra completa, no subcadena', () => {
    for (const [nf, nombre] of [
      [hasTokenVoz, 'voz'],
      [hasTokenJuegos, 'juegos'],
    ] as const) {
      expect(nf('desactiva la funcion', 'activa'), nombre).toBe(false)
      expect(nf('activa la funcion', 'activa'), nombre).toBe(true)
      expect(nf('activar settings', 'set'), nombre).toBe(false)
    }
  })
})

/** El detector: los dos contratos discrepan sobre este par (texto, frase). */
export function diverge(normalized: string, phrase: string): boolean {
  return hasTokenVoz(normalized, phrase) !== hasTokenJuegos(normalized, phrase)
}

describe('hasToken: el detector no es decorativo', () => {
  it('detecta la divergencia donde existe de verdad', () => {
    expect(diverge('activa el modo oscuro', 'ACTIVA')).toBe(true)
    expect(diverge('hola,activa', 'activa')).toBe(true)
  })

  it('no da falso positivo donde los contratos coinciden', () => {
    expect(diverge('activa el modo oscuro', 'activa')).toBe(false)
    expect(diverge('desactiva la funcion', 'activa')).toBe(false)
  })

  it('si alguien "unifica" los dos, esta prueba se vuelve roja (no puede pasar en silencio)', () => {
    // Unificar = hacer que voz delegue en juegos. Eso forzaria diverge(...) === false
    // en los dos pares divergentes de arriba: el guard lo cazaria.
    const divergenciasMedidas = [
      ['activa el modo oscuro', 'ACTIVA'],
      ['hola,activa', 'activa'],
    ] as const
    const detectadas = divergenciasMedidas.filter(([n, f]) => diverge(n, f)).length
    expect(detectadas, 'sin divergencias el contrato unificado seria indistinguible').toBe(2)
  })
})
