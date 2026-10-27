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
// CORTE 2026-10-26: el arnés de la tubería vieja (integrateMicPacket/readTurnLive de
// conversationStream.js y createActiveListenState de activeListen.js, islas retiradas) se
// sustituye por el DUENO VIVO de la línea abierta: `mergeIntoOpenLine` (speechMerge.js), el
// mismo que consumen los adaptadores del módulo (`fusionarEnLineaAbierta`). La regla se
// ejercita con el libro `{ base, chunk, line }` arrastrado por la secuencia real, sin
// arnés muerto. La fila = frase de la caja (cierre por silencio) la cubren nativamente
// tests/conversacionEtapa56CajaPlayback.test.ts y tests/conversacionAcumulacionAsr.test.ts.
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  isSameFragmentRevision,
  resolveMicFragmentMerge,
  mergeIntoOpenLine,
} from '../src/voice/lib/speechMerge.js'
import { utterancesSameRevision } from '../src/voice/core/locucion.js'

/** Pasa la secuencia por el DUENO real de la linea viva y devuelve lo que se ve. */
function lineaTras(secuencia: string[], { inicial = '' } = {}): string {
  let linea = inicial
  let libro: { base: string; chunk: string; line: string } | null = null
  for (const trozo of secuencia) {
    const r = mergeIntoOpenLine(linea, libro, trozo)
    linea = r.linea
    libro = r.libro
  }
  return linea
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

describe('ingress - UNA hipotesis por hueco de audio (dueno vivo mergeIntoOpenLine)', () => {
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
    const primera = lineaTras(['voy a poner a la mujer'])
    expect(primera).toBe('voy a poner a la mujer')
    // El cierre real vacia la linea: el tramo nuevo arranca sin libro ni linea.
    const segunda = lineaTras(['no lo voy a preparar al 100%'])
    expect(segunda).toBe('no lo voy a preparar al 100%')
    expect(segunda.toLowerCase()).not.toContain('mujer')
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
//  - no hay perdida de FILA: las dos hipotesis son la MISMA locucion
//    (`utterancesSameRevision`, dueno vivo core/locucion.js), y el replay sigue
//    escribiendo su fila.
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

  // B.3 RETIRADO (corte 2026-10-26): «el cierre por SILENCIO escribe la MISMA frase
  // que la caja» lo decidía `evaluateSrGapSegmentCommit` (conversationStream.js,
  // isla sin dueño vivo). La regla viva la custodian nativamente
  // tests/conversacionEtapa56CajaPlayback.test.ts («la caja manda») y
  // tests/conversacionAcumulacionAsr.test.ts.
})
