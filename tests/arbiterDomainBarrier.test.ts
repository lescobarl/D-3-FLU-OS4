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
 *
 * Cubre dos regresiones reales:
 *   1. El alta genérica de notas se llevaba los verbos de la agenda (3b66634).
 *   2. Con partida activa, una intención pendiente de OTRO dominio (crear en
 *      agenda sin instante) caía en `game/turn` y el juego se la tragaba. Se
 *      comprueban las DOS vías que ofrecen el turno: el paso 13 del árbitro y el
 *      fast-path `resolveStatefulDomains` del hook.
 */
import { describe, expect, it } from 'vitest'
import { resolveDeterministicCommand, resolveStatefulDomains } from '../src/voice/lib/deterministicArbiter'
import { resolveAgendaDomainIntent } from '../src/core/agenda/domainScopedIntent'
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

/** Acción que el fast-path de estado ofrece para la frase (undefined si ninguna). */
function statefulGameAction(frase: string): string | undefined {
  const game = resolveStatefulDomains(frase).game as { action?: string } | null
  return game?.action
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
      // Cambiar de juego y terminarlo siguen siendo del motor.
      expect((resolveDeterministicCommand('cambia a trivia').action as { action?: string })?.action).toBe(
        'switch',
      )
      expect((resolveDeterministicCommand('terminar el juego').action as { action?: string })?.action).toBe(
        'end',
      )
    })
  })

  it('una intención pendiente de agenda NO se convierte en jugada con partida activa', () => {
    // Regresión real (2026-09-28): con la lotería abierta estas tres frases caían
    // en `game/turn` — el juego se las tragaba y la agenda nunca pedía la hora.
    // Sin partida iban al carril que pregunta; con partida deben ir IGUAL
    // (el significado no cambia porque haya un juego abierto).
    conLoteriaActiva(() => {
      for (const frase of [
        'agrega matemáticas el lunes',
        'recuérdame comprar el pan',
        'cita con el dentista',
      ]) {
        const r = resolveDeterministicCommand(frase)
        expect(r.domain, `"${frase}" no es una jugada`).not.toBe('game')
        expect(r.matched, `"${frase}" va al carril que pide la hora`).toBe(false)
      }
    })
  })

  it('el fast-path de estado tampoco le ofrece el turno del juego a ese texto', () => {
    // Segunda vía real: el hook despacha el turno por `resolveStatefulDomains`
    // (fastPathGame). Guardar solo el paso 13 del árbitro dejaba este hueco.
    conLoteriaActiva(() => {
      expect(resolveStatefulDomains('agrega matemáticas el lunes').game).toBeNull()
      expect(resolveStatefulDomains('recuérdame comprar el pan').game).toBeNull()
      // Los comandos EXPLÍCITOS del motor no se tocan.
      expect(statefulGameAction('terminar el juego')).toBe('end')
      expect(statefulGameAction('cambia a trivia')).toBe('switch')
      // Y una jugada real sigue llegando como turno.
      expect(statefulGameAction('siguiente carta')).toBe('turn')
    })
  })

  it('el detector no es decorativo: los dos casos se distinguen de verdad', () => {
    // Con hora hay acción de agenda; sin hora no la hay. Si el resolutor
    // devolviera lo mismo para ambos, este caso cae.
    const conHora = resolveDeterministicCommand('agrega matemáticas el lunes a las 8')
    const sinHora = resolveDeterministicCommand('agrega matemáticas el lunes')
    expect(conHora.matched).not.toBe(sinHora.matched)
    // Marca inversa: la barrera no puede "arreglar" lo anterior rompiendo el
    // juego, así que la jugada real se comprueba en el mismo caso.
    conLoteriaActiva(() => {
      expect(resolveDeterministicCommand('siguiente carta').domain).toBe('game')
      expect(resolveDeterministicCommand('agrega matemáticas el lunes').domain).not.toBe('game')
    })
  })
})

describe('arbiterDomainBarrier — crear exige hora explícita (no se inventa)', () => {
  it('ni 09:00 (recurrente) ni 00:00 (fecha pelada): sin hora se pregunta', () => {
    // Dos invenciones silenciosas distintas, la misma regla: rellenar la hora
    // fijaba "reunión los lunes" a las 09:00 y "recuérdame … mañana" a las 00:00.
    for (const frase of [
      'crea una clase los lunes',
      'reunión los lunes',
      'recuérdame comprar el pan los lunes',
      'cita los martes',
      'clase de historia todos los días',
      'recuérdame comprar el pan mañana',
      'crea una cita para mañana',
      'junta mañana',
    ]) {
      const r = resolveDeterministicCommand(frase)
      expect(r.matched, `"${frase}" pide la hora en vez de inventarla`).toBe(false)
    }
  })

  it('con la hora dicha se crea igual que siempre', () => {
    for (const frase of [
      'crea una clase los lunes a las 9',
      'agrega matemáticas el lunes a las 8',
      'recuérdame comprar el pan mañana a las 4 de la tarde',
      'crea una junta para mañana a las 11',
      'recuérdame todos los días a las 8',
    ]) {
      const r = resolveDeterministicCommand(frase)
      expect(r.matched, `"${frase}" crea`).toBe(true)
      expect(r.domain).toBe('agendaCommand')
    }
  })

  it('la vía del LLM (dominio horario/recordatorio) también pide la hora', () => {
    // Hueco real: el árbitro no matcheaba y la clasificación del LLM creaba la
    // clase a las 09:00 por defecto. Ahora propaga la pista para preguntar.
    const sinHora = resolveAgendaDomainIntent('horario', 'agrega matemáticas el lunes')
    expect(sinHora?.needsInstant).toBe(true)
    const conHora = resolveAgendaDomainIntent('horario', 'agrega matemáticas el lunes a las 8')
    expect(conHora?.matched).toBe(true)
    expect((conHora?.action as { trigger?: unknown })?.trigger).toBeTruthy()
  })
})
