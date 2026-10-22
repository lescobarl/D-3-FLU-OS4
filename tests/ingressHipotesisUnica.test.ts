// @vitest-environment node
// ============================================================
// ingressHipotesisUnica - la linea viva (openLine) se queda con UNA hipotesis por hueco de
// audio; no mezcla las dos del ASR.
// ------------------------------------------------------------
// DEFECTO MEDIDO (d4c1c8f3): dos motores entregan la MISMA locucion por tick (uno acumulativo
// y otro con deltas que reescribe). Cada delta se pegaba detras del anterior y la linea viva
// acababa mezclando las dos hipotesis:
//   "… no me acuerdo si le puse así de debido debió de poner debió debió de …"
//   "… ya está todo Cloud de que ya está ya …"
// De ahí pasaba a la caja (boxDuplicated / noBoxDuplicatedBlock) y a la fila.
//
// La regla (un solo dueno, `integrateOpenLine` + `isSameFragmentRevision`): un trozo que
// REVISA el ultimo pegado se REEMPLAZA sobre la misma base; una hipotesis que repite la
// locucion de la linea se conserva UNA (la mas completa), no se concatena; y el habla nueva
// (que si extiende) se sigue anadiendo sin perder texto.
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  isSameFragmentRevision,
  resolveMicFragmentMerge,
} from '../src/voice/lib/speechMerge.js'
import { integrateMicPacket, readTurnLive, utterancesSameRevision, evaluateSrGapSegmentCommit } from '../src/voice/lib/conversationStream.js'
import { createActiveListenState } from '../src/voice/lib/activeListen.js'

/** Pasa la secuencia por el DUENO real de la linea viva y devuelve lo que se ve. */
function lineaTras(secuencia: string[], { inicial = '' } = {}): string {
  const state = createActiveListenState()
  if (inicial) {
    state.openLine = inicial
    state.pendingInterim = ''
  }
  for (const interim of secuencia) integrateMicPacket(state, { interim })
  return readTurnLive(state)
}

/** Ningun bloque de 4+ palabras puede aparecer dos veces. */
function tieneBloqueRepetido(texto: string, size = 4): boolean {
  const palabras = String(texto || '').toLowerCase().split(/\s+/).filter(Boolean)
  const vistos = new Set<string>()
  for (let i = 0; i + size <= palabras.length; i += 1) {
    const bloque = palabras.slice(i, i + size).join(' ')
    if (vistos.has(bloque)) return true
    vistos.add(bloque)
  }
  return false
}

describe('ingress - UNA hipotesis por hueco de audio (dos motores)', () => {
  it('`isSameFragmentRevision` distingue una revision del mismo trozo de habla nueva', () => {
    expect(isSameFragmentRevision('de', 'debido')).toBe(true)
    expect(isSameFragmentRevision('debido', 'debió')).toBe(true)
    expect(isSameFragmentRevision('debió de', 'debió de poner')).toBe(true)
    expect(isSameFragmentRevision('ya está', 'ya está todo')).toBe(true)
    // Habla nueva (distinta): no es una revision del trozo anterior.
    expect(isSameFragmentRevision('de', 'el')).toBe(false)
    expect(isSameFragmentRevision('no me acuerdo', 'pon musica relajante')).toBe(false)
    expect(isSameFragmentRevision('el', 'el a Luis')).toBe(true)
  })

  it('la SECUENCIA REAL de d4c1c8f3 deja una sola hipotesis, sin bloque duplicado', () => {
    // A = acumulativa de Chrome; B = deltas que reescribe el otro motor (mismo instante).
    const A1 = 'no me acuerdo si le puse así'
    const secuencia = [
      A1,
      ' de',
      A1,
      ' debido',
      A1,
      ' debió',
      A1,
      ' debió de',
      'no me acuerdo si le puse así debió',
      ' debió de poner',
      'no me acuerdo si le puse así debió de',
      ' el',
      'no me acuerdo si le puse así debió de poner',
      ' el a',
      ' el a Luis',
      'no me acuerdo si le puse así debió de poner el a Luis al principio no lo está haciendo',
    ]
    const linea = lineaTras(secuencia)
    expect(linea).toBe('no me acuerdo si le puse así debió de poner el a Luis al principio no lo está haciendo')
    expect(tieneBloqueRepetido(linea), `bloque repetido en "${linea}"`).toBe(false)
  })

  it('dos HIPOTESIS de la misma locucion: se conserva una, no se concatenan', () => {
    const completa =
      'bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cierto lo que nos dijo cla Cloud de que ya está todo'
    const variante =
      'bien Vamos a retomar el tema de las pruebas realización transcripción etcétera vamos a ver si es cierto lo que nos dijo Cloud de que ya está ya'
    const linea = lineaTras([completa, variante])
    // Ni se pega la variante detras, ni se pierde la hipotesis larga.
    expect(linea).toBe(completa)
    expect(linea.toLowerCase()).not.toContain('cloud de que ya está ya cloud')
  })

  it('el habla NUEVA se sigue anadiendo: no se pierde texto', () => {
    const linea = lineaTras([
      'hola que tal',
      'hola que tal como estas',
      'hola que tal como estas te cuento una cosa',
    ])
    expect(linea).toBe('hola que tal como estas te cuento una cosa')
  })

  it('la locucion siguiente NO se pega a la anterior (caja vaciada en el cierre)', () => {
    const state = createActiveListenState()
    integrateMicPacket(state, { interim: 'voy a poner a la mujer' })
    expect(readTurnLive(state)).toBe('voy a poner a la mujer')
    // El cierre real vacia la linea (lo hace `resetInterimControlBuffers` del ingress).
    state.openLine = ''
    state.pendingInterim = ''
    integrateMicPacket(state, { interim: 'no lo voy a preparar al 100%' })
    expect(readTurnLive(state)).toBe('no lo voy a preparar al 100%')
    expect(readTurnLive(state).toLowerCase()).not.toContain('mujer')
  })

  it('`resolveMicFragmentMerge` sigue siendo el dueno de la fusion de trozos', () => {
    // Control: dos fragmentos consecutivos de verdad se unen.
    expect(resolveMicFragmentMerge('hola', 'que tal')).toBe('hola que tal')
    // Y una reemision de la misma locucion no se duplica.
    expect(resolveMicFragmentMerge('hola que tal', 'hola que tal como estas')).toBe('hola que tal como estas')
  })
})

// REGRESION #11 (d4c1c8f3): la locucion se dijo con DOS hipotesis divergentes del mismo
// tramo ("... 100 porque" / "... al 100%"). No se pueden conservar las dos colas sin
// MEZCLARLAS (concatenar dos hipotesis completas es justo lo que se proscribe), asi que:
//  - se conserva UNA (la mas completa) y NO se pega la otra detras;
//  - no hay perdida de FILA: las dos hipotesis son la MISMA locucion (`utterancesSameRevision`),
//    y el replay sigue escribiendo su fila (ver `replayEvents` sobre d4c1c8f3: 18 filas,
//    `missingUnique: 0`, y la cola descartada entra como VARIANTE de la fuente).
describe('ingress - REGRESION #11: dos hipotesis divergentes no se concatenan', () => {
  const COMPLETA = 'no lo voy a preparar 100 porque'
  const CORREGIDA = 'no lo voy a preparar al 100%'

  it('las dos emisiones son la MISMA locucion (no dos locuciones distintas)', () => {
    expect(utterancesSameRevision(COMPLETA, CORREGIDA)).toBe(true)
  })

  it('la linea conserva UNA hipotesis: no aparece la mezcla', () => {
    const linea = lineaTras([COMPLETA, CORREGIDA])
    expect(linea).toBe(COMPLETA)
    expect(linea.toLowerCase()).not.toContain('100 porque al 100')
    expect(tieneBloqueRepetido(linea), `bloque repetido en "${linea}"`).toBe(false)
  })

  it('el orden inverso tampoco mezcla (la mas completa, una sola vez)', () => {
    const linea = lineaTras([CORREGIDA, COMPLETA])
    expect(linea).toBe(COMPLETA)
    expect(linea.toLowerCase()).not.toContain('al 100 no lo voy a preparar 100')
  })

  it('CONTROL: una correccion que EXTIENDE la linea si entra (no se pierde texto)', () => {
    const linea = lineaTras(['no lo voy a preparar', 'no lo voy a preparar al 100%'])
    expect(linea).toBe('no lo voy a preparar al 100%')
  })

  it('CONTROL: la correccion de una palabra del medio se aplica sin duplicar el tramo', () => {
    const linea = lineaTras([
      'no se como se comporta la diarizacion en la caja',
      'no se como se comporta la transcripcion en la caja de la frase',
    ])
    expect(linea).toBe('no se como se comporta la transcripcion en la caja de la frase')
    expect(tieneBloqueRepetido(linea)).toBe(false)
  })

  // B.3 (mandato 2026-10-21): la FILA es la MISMA frase que la caja. No se elige una
  // "correccion" del ultimo interino que la caja no muestra.
  it('el cierre por SILENCIO escribe la MISMA frase que la caja', () => {
    const state = createActiveListenState()
    integrateMicPacket(state, { interim: COMPLETA })
    integrateMicPacket(state, { interim: CORREGIDA })
    expect(readTurnLive(state)).toBe(COMPLETA)
    const cierre = evaluateSrGapSegmentCommit(state, {
      sinceLastResultMs: 10001,
      lastCommitted: '',
      published: COMPLETA,
    })
    expect(cierre.flush).toBe(true)
    expect(cierre.capture).toBe(COMPLETA)
  })

  it('si la caja esta en la locucion nueva, la fila NO se lleva la linea vieja', () => {
    const state = createActiveListenState()
    integrateMicPacket(state, { interim: 'por eso le escribe a mi papá para que fuera por mí tan peligroso soy Porque no solo te fuiste y ya' })
    const cajaNueva = 'se me hace como que no te acuerdas muy bien de qué pasó'
    const cierre = evaluateSrGapSegmentCommit(state, {
      sinceLastResultMs: 10001,
      lastCommitted: '',
      published: cajaNueva,
    })
    expect(cierre.flush).toBe(true)
    expect(cierre.capture).toBe(cajaNueva)
  })
})
