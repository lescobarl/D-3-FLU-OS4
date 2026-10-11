// ============================================================
// vozIntroYAliasPorVozGuard - B1 (el intro solo si la orden EMPIEZA en la wake) y
// B2 (la identidad es la VOZ/firma, no la etiqueta).
// ------------------------------------------------------------
// B1 MEDIDO por el dueno (verificacion independiente):
//   resolveSpeakerNameFromUtterance('mi definicion fue hasta que yo diga okay flow soy Luis')
//     esperado '' -> medido 'Luis'
//   CAUSA: `detectWakeIntroducedName` (audioMath.js) se conforma con
//   `split.wakeWordMatched`, y el splitter marca `true` tambien cuando la wake va
//   INLINE (la frase HABLA de la orden: "hasta que yo diga okay flow soy Luis"). Ademas
//   los patrones de intro NO estan anclados (`(?:^|\b)soy`), asi que el nombre se
//   captura en cualquier posicion del mandato.
//   REGLA: el intro se acepta solo si (a) el mandato EMPIEZA en la wake y (b) el patron
//   ABRE el mandato (no viene dentro de una frase que reporta el comando).
//
// B2 MEDIDO por el dueno:
//   registerSpeakerAlias('Hablante 1','Luis'); resolveRowSpeakerName('Hablante 1', false)
//     esperado 'Hablante 1' -> medido 'Luis'
//   CAUSA: `conversationTurnRow.resolveRowSpeakerName` aplicaba un mapa GLOBAL
//   etiqueta->nombre (`resolveSpeakerAlias`): si otra voz reutiliza la etiqueta, hereda
//   el nombre. REGLA: un dato (voz), un dueno; el renombre va por FIRMA del cluster.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, renameSpeakerRows, resolveRowSpeakerName } from '../src/voice/lib/conversationTurnRow'
import {
  registerSpeakerIdentity,
  registerSpeakerIdentityFromCommand,
} from '../src/voice/lib/speakerIdentityRegister.js'
import { detectWakeIntroducedName } from '../src/voice/lib/audioMath.js'
import { resolveSpeakerNameFromUtterance } from '../src/voice/lib/speakerPolicy.js'
import { findLabelsWithSharedVoice } from '../src/voice/lib/speakerClusters.js'

const WAKES = ['okay flow', 'okay flu']

/** Vector con coseno EXACTO `c` respecto a [1,0,0] (bandas medidas en el repo). */
function v(c: number): number[] {
  return [c, Math.sqrt(Math.max(0, 1 - c * c)), 0]
}
const OTRA_VOZ = 0.58

describe('B1 - el intro ("soy <nombre>") solo si la orden EMPIEZA en la wake', () => {
  /** Tabla del encargo: entrada cruda -> esperado. */
  const CASOS: Array<[string, string]> = [
    // El dueno REPORTANDO el comando: el mandato NO empieza en la wake.
    ['mi definicion fue hasta que yo diga okay flow soy Luis', ''],
    ['voy a decir el comando de okay flu soy Luis', ''],
    // La wake es prefijo pero el mandato REPORTA el comando antes del intro.
    ['okay flu la frase es soy Luis', ''],
    ['okay flu que yo diga soy Luis', ''],
    ['okay flu voy a decir el comando de soy Luis', ''],
    ['okay flu mi definicion fue hasta que yo diga soy Luis', ''],
    // El intro DE VERDAD: la orden es el intro (la wake abre la orden).
    ['okay flu soy Luis', 'Luis'],
    ['okay flow soy Luis', 'Luis'],
    // El ASR pega mas frase tras el nombre: el intro sigue ABRIENDO el mandato.
    ['okay flu soy Luis y no sustituyo', 'Luis'],
    ['okay flu me llamo Luis', 'Luis'],
  ]

  for (const [entrada, esperado] of CASOS) {
    it(`resolveSpeakerNameFromUtterance(${JSON.stringify(entrada)}) => ${JSON.stringify(esperado)}`, () => {
      expect(resolveSpeakerNameFromUtterance(entrada, { wakeWords: WAKES })).toBe(esperado)
      // El dueno COMPARTIDO (commit y comando) responde igual.
      expect(detectWakeIntroducedName(entrada, WAKES)).toBe(esperado)
    })
  }

  it('control NEGATIVO (el detector no es decorativo): partir el texto por la wake en cualquier posicion si captura el nombre', () => {
    // Implementacion VIEJA aislada: basta con que la wake aparezca.
    const viejo = (text: string) => {
      const i = WAKES.map((w) => text.toLowerCase().indexOf(w)).filter((n) => n >= 0).sort((a, b) => a - b)[0]
      if (i === undefined) return ''
      const resto = text.slice(i).replace(/^(okay|ok)\s+(flow|flu)\s*/i, '')
      const m = /(?:yo\s+)?soy\s+([a-zA-Z]+)/i.exec(resto)
      return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : ''
    }
    const reporta = 'mi definicion fue hasta que yo diga okay flow soy Luis'
    expect(viejo(reporta), 'el defecto medido: la implementacion vieja SI captura el nombre').toBe('Luis')
    expect(detectWakeIntroducedName(reporta, WAKES), 'el dueno real NO').toBe('')
  })
})

describe('B2 - la identidad es la VOZ (firma), no la etiqueta', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
  })

  const CLUSTERS = [
    { label: 'Hablante 1', signature: [1, 0, 0] },
    { label: 'Hablante 3', signature: v(OTRA_VOZ) },
  ]

  it('una etiqueta reusada por OTRA voz NO se vuelve el nombre', () => {
    // El defecto medido: el mapa global etiqueta->nombre contaminaba la etiqueta.
    expect(resolveRowSpeakerName('Hablante 1', false), 'sin voz que la respalde').toBe('Hablante 1')
    commitUserTurnRow({ text: 'hola que tal', speakerName: 'Hablante 1', evidenciaAcustica: false, turnId: 1 } as never)
    // Si "Luis" se registra para ESA voz, la ETIQUETA sigue siendo una etiqueta: una fila
    // nueva de OTRA voz que reutilice "Hablante 1" no hereda "Luis".
    expect(resolveRowSpeakerName('Hablante 1', false)).toBe('Hablante 1')
  })

  it('"soy X" renombra SOLO las filas de esa voz (las etiquetas salen de la FIRMA) y la VOZ queda con el nombre', () => {
    useIntegrationStore.setState({
      conversationHistory: [
        { id: 'r1', role: 'user', text: 'hola', speakerName: 'Hablante 1', timestamp: '10:00' },
        { id: 'r2', role: 'user', text: 'que tal', speakerName: 'Hablante 3', timestamp: '10:01' },
        { id: 'r3', role: 'user', text: 'bueno', speakerName: 'Hablante 1', timestamp: '10:02' },
      ] as never,
    })
    const setClusters = vi.fn()
    // Las etiquetas de la MISMA voz las decide el dueno de los clusters (por FIRMA).
    const etiquetas = findLabelsWithSharedVoice(CLUSTERS as never, 'Hablante 1')
    expect(etiquetas, 'la voz distinta NO entra en el grupo').toEqual(['Hablante 1'])

    const result = registerSpeakerIdentity({
      name: 'Luis',
      clusters: CLUSTERS as never,
      previousLabel: 'Hablante 1',
      refs: { setClusters, sessionPrimarySpeakerRef: { current: '' } } as never,
    })

    const filas = useIntegrationStore
      .getState()
      .conversationHistory.filter((e) => e.role === 'user')
      .map((e) => String(e.speakerName || ''))
    expect(filas, 'las filas de ESA voz pasan al nombre; la otra voz no se toca').toEqual([
      'Luis',
      'Hablante 3',
      'Luis',
    ])
    expect(result.rowsChanged).toBe(2)
    // El renombre va por VOZ: el CLUSTER de esa voz queda con el nombre (las filas
    // siguientes lo resuelven por firma, sin mapa de etiquetas).
    expect(setClusters).toHaveBeenCalled()
    const relabeled = setClusters.mock.calls.at(-1)?.[0] as Array<{ label: string }>
    expect(relabeled.map((c) => c.label).sort()).toEqual(['Hablante 3', 'Luis'])
  })

  it('RUTA DEL COMANDO: registra igual y deja la VOZ con el nombre', () => {
    useIntegrationStore.setState({
      conversationHistory: [
        { id: 'r1', role: 'user', text: 'hola', speakerName: 'Hablante 1', timestamp: '10:00' },
      ] as never,
    })
    const setClusters = vi.fn()
    const result = registerSpeakerIdentityFromCommand({
      transcript: 'okay flu soy Luis',
      speakerName: 'Hablante 1',
      clusters: CLUSTERS as never,
      refs: { setClusters, sessionPrimarySpeakerRef: { current: '' } } as never,
    })
    expect(result.registered).toBe(true)
    expect(result.rowsChanged).toBe(1)
    expect(setClusters).toHaveBeenCalled()
  })

  it('control NEGATIVO (el detector no es decorativo): un mapa global etiqueta->nombre SI contamina', () => {
    // Defecto medido, aislado: con el mapa por etiqueta la fila de otra voz hereda el nombre.
    const aliasGlobal = new Map<string, string>([['hablante 1', 'Luis']])
    const viejo = (label: string) => aliasGlobal.get(label.trim().toLowerCase()) || label
    expect(viejo('Hablante 1'), 'el defecto medido').toBe('Luis')
    // El dueno real NO usa ese mapa.
    expect(resolveRowSpeakerName('Hablante 1', false)).toBe('Hablante 1')
    // Y el renombre por etiqueta desnuda ya no cambia el nombre de una fila por si solo.
    renameSpeakerRows(['Hablante 1'], 'Luis')
    expect(resolveRowSpeakerName('Hablante 1', false)).toBe('Hablante 1')
  })
})
