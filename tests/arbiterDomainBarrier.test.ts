/**
 * arbiterDomainBarrier — Barrera de COMPORTAMIENTO de la resolución por dominio.
 *
 * MOTIVO (riesgo estructural medido): `lint:guards` corre 56 archivos de HIGIENE
 * (rutas, fuentes, hardcode) y NO incluía ninguna prueba de COMPORTAMIENTO del
 * árbitro. `deterministicArbiter.test.ts` quedaba FUERA de la barrera, así que una
 * regresión de precedencia pasaba con "typecheck + guardias en verde" y solo se
 * veía en la suite completa (que exige autorización). Ocurrió de verdad: en
 * 3b66634 el alta genérica de notas se llevó los verbos de la agenda y
 * "agrega matemáticas el lunes" (clase sin hora) se guardaba como NOTA.
 *
 * Esta barrera fija la PRECEDENCIA por dueño: cada dominio conserva sus comandos
 * y ninguno invade al vecino. Usa los resolutores de PRODUCCIÓN (sin mocks).
 */
import { describe, expect, it } from 'vitest'
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter'
import { getGameEngine } from '../src/core/games/gameCatalog'
import { setActiveGameSession, clearActiveGameSession } from '../src/core/games/gameSessionStore'

function conLoteriaActiva(fn: () => void) {
  const engine = getGameEngine('loteria' as Parameters<typeof getGameEngine>[0])
  expect(engine, 'el motor de loteria existe').toBeTruthy()
  if (!engine) return
  const session = engine.createSession({})
  engine.start(session, {})
  setActiveGameSession(session)
  try {
    fn()
  } finally {
    clearActiveGameSession()
  }
}

describe('arbiterDomainBarrier — cada dominio conserva sus comandos', () => {
  it('la agenda con hora crea; sin hora NO la roba otro dominio', () => {
    const conHora = resolveDeterministicCommand('agrega matemáticas el lunes a las 8')
    expect(conHora.matched).toBe(true)
    expect(conHora.domain).toBe('agendaCommand')

    // Sin hora el parser NO detecta el tipo: el turno es para la aclaración
    // conversacional. Lo que NO puede pasar es que otro dominio (nota) lo tome
    // como acción y guarde una nota con el texto de una clase.
    const sinHora = resolveDeterministicCommand('agrega matemáticas el lunes')
    expect(sinHora.matched, 'una clase sin hora no es una acción ejecutable').toBe(false)
    expect(sinHora.domain, 'la nota no debe apropiarse de "agrega X el lunes"').not.toBe('note')
  })

  it('la nota conserva su alta y su destino explícito', () => {
    for (const frase of [
      'apunta comprar pan',
      'anota guitarra',
      'agrega guitarra en la nota',
    ]) {
      expect(resolveDeterministicCommand(frase).domain, `"${frase}" es nota`).toBe('note')
    }
  })

  it('compra, diario y configuración resuelven en su dueño', () => {
    expect(resolveDeterministicCommand('agrega leche a la lista de compras').domain).toBe('shopping')
    expect(resolveDeterministicCommand('anota en el diario que hoy fue un buen día').domain).toBe('diary')
    expect(resolveDeterministicCommand('restablece los colores del avatar').domain).toBe('config')
  })

  it('con partida activa, los comandos de otros dominios NO se vuelven jugada', () => {
    conLoteriaActiva(() => {
      expect(resolveDeterministicCommand('restablece los colores del avatar').domain).toBe('config')
      expect(resolveDeterministicCommand('agrega leche a la lista de compras').domain).toBe('shopping')
      expect(resolveDeterministicCommand('apunta comprar pan').domain).toBe('note')
      expect(resolveDeterministicCommand('agrega matemáticas el lunes a las 8').domain).toBe(
        'agendaCommand',
      )
    })
  })

  it('con partida activa, el motor sigue mandando en los suyos', () => {
    conLoteriaActiva(() => {
      const propio = resolveDeterministicCommand('siguiente carta')
      expect(propio.domain).toBe('game')
      expect((propio.action as { action?: string })?.action).toBe('turn')
    })
  })

  it('el detector no es decorativo: los dos casos se distinguen de verdad', () => {
    // Sin esta discriminación, la barrera podría estar en verde con cualquier
    // implementación. Con hora hay match de agenda; sin hora no hay match: si el
    // resolutor devolviera lo mismo para ambos, este caso cae.
    const conHora = resolveDeterministicCommand('agrega matemáticas el lunes a las 8')
    const sinHora = resolveDeterministicCommand('agrega matemáticas el lunes')
    expect(conHora.matched).not.toBe(sinHora.matched)
    // Y la marca inversa: con partida activa el texto sin dueño SÍ cae en el
    // juego, de modo que la aserción "no es nota" no es trivialmente cierta.
    conLoteriaActiva(() => {
      const ambiguo = resolveDeterministicCommand('agrega matemáticas el lunes')
      expect(ambiguo.domain).toBe('game')
      expect(ambiguo.domain).not.toBe('note')
    })
  })
})
