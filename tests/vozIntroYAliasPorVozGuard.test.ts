// ============================================================
// vozIntroYAliasPorVozGuard - B1 (el intro solo si la orden EMPIEZA en la wake) y
// B2 (la identidad es la VOZ/firma, no la etiqueta).
// ------------------------------------------------------------
// B1 (Anexo B #11: "El mandato empieza en la wake"): lo anterior a la wake es habla de
//   contexto y SE DESCARTA; el intro se lee del MANDATO (lo que SIGUE a la wake) y tiene
//   que ABRIRLO (`mustOpen`), para que una frase que HABLA del comando ("la frase es soy
//   Luis", "voy a decir el comando de soy Luis") no capture un nombre.
//   MEDIDO por el dueno (2026-10-11 21:27:40): con la condicion extra "no puede haber nada
//   antes de la wake", el ASR acumulando la locucion previa ("vamos a poner Ah voy a voy a
//   decirle Okay flu Soy Luis") dejaba el intro a CERO -> el registro NO se ejecutaba y el
//   nombre no se sustituia en sus turnos. La condicion extra se RETIRA: el mandato ya
//   empieza en la wake y el contexto de delante se descarta (que es lo que manda #11).
//
// B2 MEDIDO por el dueno:
//   registerSpeakerAlias('Hablante 1','Luis'); resolveRowSpeakerName('Hablante 1')
//     esperado 'Hablante 1' -> medido 'Luis'
//   CAUSA: `conversationTurnRow.resolveRowSpeakerName` aplicaba un mapa GLOBAL
//   etiqueta->nombre (`resolveSpeakerAlias`): si otra voz reutiliza la etiqueta, hereda
//   el nombre. REGLA: un dato (voz), un dueno; el renombre va por FIRMA del cluster.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitUserTurnRow, renameSpeakerRows, resolveRowSpeakerName } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import {
  registerSpeakerIdentity,
  registerSpeakerIdentityFromCommand,
} from '../src/voice/lib/speakerIdentityRegister.js'
import { detectIntroducedName, detectWakeIntroducedName } from '../src/voice/lib/audioMath.js'
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
    // Habla de CONTEXTO antes de la wake: el mandato (tras la wake) ES el intro.
    ['mi definicion fue hasta que yo diga okay flow soy Luis', 'Luis'],
    ['voy a decir el comando de okay flu soy Luis', 'Luis'],
    // La frase REAL del log del dueno (21:27:40) que no registraba el nombre.
    ['bueno en resumen no funciona vamos a poner Ah voy a voy a decirle Okay flu Soy Luis', 'Luis'],
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

  it('FIXTURE CRUDA del log del dueno: un "yo Luis" a MITAD de frase no introduce un nombre', () => {
    // debug.log 02:20:11.434 (asrFinal len=275 -> commit turn=1 y turn=2, replace=false):
    // texto CRUDO, sin reconstruir.
    const ASR_FINAL =
      'pruebas de transcripcion de diarizacion estoy hablando yo Luis no estoy diciendo El Comando cuando diga El Comando para que ponga mi nombre entonces debe de recuperar todas mis intervenciones y ponerles a cada una mi nombre estoy voy a hacer un alto para ver como se comporta'
    // El "estoy hablando yo Luis" va A MITAD de frase: no es una presentacion.
    expect(detectIntroducedName(ASR_FINAL)).toBe('')
    expect(resolveSpeakerNameFromUtterance(ASR_FINAL, { wakeWords: WAKES })).toBe('')
    // Y la misma frase dicha COMO mandato (la wake abre la orden): SI registra.
    expect(resolveSpeakerNameFromUtterance('voy a decir el comando Okay flu Soy Luis', { wakeWords: WAKES })).toBe('Luis')
  })

  it('control NEGATIVO (el detector no es decorativo): partir el texto por la wake en cualquier posicion si captura el nombre', () => {
    // Implementacion VIEJA aislada: basta con que la wake aparezca.
    const viejo = (text: string) => {
      const i = WAKES.map((w) => text.toLowerCase().indexOf(w)).filter((n) => n >= 0).sort((a, b) => a - b)[0]
      if (i === undefined) return ''
      const resto = text.slice(i).replace(/^(okay|ok)\s+(flow|flu)\s*/i, '')
      const m = /(?:yo\s+)?soy\s+([a-zA-Z]+)/i.exec(resto)
      return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : ''
    }
    const reporta = 'okay flu la frase es soy Luis'
    expect(viejo(reporta), 'el defecto medido: la implementacion vieja SI captura el nombre').toBe('Luis')
    expect(detectWakeIntroducedName(reporta, WAKES), 'el dueno real NO: el intro no ABRE el mandato').toBe('')
  })
})

describe('B2 - la identidad es la VOZ (firma), no la etiqueta', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
    // El nombre vive en el DIRECTORIO por VOZ (estado de sesion): se vacia por caso
    // para que el registro de uno no se filtre al siguiente (mandato 2026-10-13).
    resetVoiceDirectory()
  })

  const CLUSTERS = [
    { label: 'Hablante 1', signature: [1, 0, 0] },
    { label: 'Hablante 3', signature: v(OTRA_VOZ) },
  ]

  it('una etiqueta reusada por OTRA voz NO se vuelve el nombre', () => {
    // El defecto medido: el mapa global etiqueta->nombre contaminaba la etiqueta.
    expect(resolveRowSpeakerName('Hablante 1'), 'sin voz que la respalde').toBe('Hablante 1')
    commitUserTurnRow({ text: 'hola que tal', speakerName: 'Hablante 1', evidenciaAcustica: false, turnId: 1 } as never)
    // Si "Luis" se registra para ESA voz, la ETIQUETA sigue siendo una etiqueta: una fila
    // nueva de OTRA voz que reutilice "Hablante 1" no hereda "Luis".
    expect(resolveRowSpeakerName('Hablante 1')).toBe('Hablante 1')
  })

  it('"soy X" registra el nombre en la VOZ y NO reescribe filas ya escritas', () => {
    // Mandato del dueño 2026-10-26: registrar el nombre NO muta ninguna fila (la conversacion
    // es texto insertado); el nombre se liga a la VOZ y cada fila conserva la etiqueta con la
    // que el modulo CONVERSACION la cerro.
    commitUserTurnRow({ text: 'hola', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1 } as never)
    commitUserTurnRow({ text: 'que tal', speakerName: 'Hablante 3', evidenciaAcustica: true, turnId: 2 } as never)
    commitUserTurnRow({ text: 'bueno', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 3 } as never)
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
      .map((e) => resolveRowSpeakerLabel(e))
    expect(filas, 'ninguna fila cambia: la etiqueta la decidio el modulo al cerrar').toEqual([
      'Hablante 1',
      'Hablante 3',
      'Hablante 1',
    ])
    // Mandato 2026-10-26: el registro NO reescribe filas ya escritas (ruta retirada).
    expect(result.rowsChanged, 'el registro no escribe filas').toBe(0)
    expect(
      useIntegrationStore
        .getState()
        .conversationHistory.filter((e) => e.role === 'user')
        .map((e) => String((e as { speakerName?: string }).speakerName || '')),
      'cada fila conserva su etiqueta escrita',
    ).toEqual(['Hablante 1', 'Hablante 3', 'Hablante 1'])
    // El renombre va por VOZ: el CLUSTER de esa voz queda con el nombre (las filas
    // siguientes lo resuelven por firma, sin mapa de etiquetas).
    expect(setClusters).toHaveBeenCalled()
    const relabeled = setClusters.mock.calls.at(-1)?.[0] as Array<{ label: string }>
    expect(relabeled.map((c) => c.label).sort()).toEqual(['Hablante 3', 'Luis'])
  })

  it('RUTA DEL COMANDO: registra igual, deja la VOZ con el nombre y no reescribe filas', () => {
    commitUserTurnRow({ text: 'hola', speakerName: 'Hablante 1', evidenciaAcustica: true, turnId: 1 } as never)
    const setClusters = vi.fn()
    const result = registerSpeakerIdentityFromCommand({
      transcript: 'okay flu soy Luis',
      speakerName: 'Hablante 1',
      clusters: CLUSTERS as never,
      refs: { setClusters, sessionPrimarySpeakerRef: { current: '' } } as never,
    })
    expect(result.registered).toBe(true)
    // Mandato 2026-10-26: el nombre queda en la VOZ (clusters + primario), no en la fila.
    expect(result.rowsChanged).toBe(0)
    expect(
      useIntegrationStore
        .getState()
        .conversationHistory.filter((e) => e.role === 'user')
        .map((e) => resolveRowSpeakerLabel(e)),
    ).toEqual(['Hablante 1'])
    expect(setClusters).toHaveBeenCalled()
  })

  it('control NEGATIVO (el detector no es decorativo): un mapa global etiqueta->nombre SI contamina', () => {
    // Defecto medido, aislado: con el mapa por etiqueta la fila de otra voz hereda el nombre.
    const aliasGlobal = new Map<string, string>([['hablante 1', 'Luis']])
    const viejo = (label: string) => aliasGlobal.get(label.trim().toLowerCase()) || label
    expect(viejo('Hablante 1'), 'el defecto medido').toBe('Luis')
    // El dueno real NO usa ese mapa.
    expect(resolveRowSpeakerName('Hablante 1')).toBe('Hablante 1')
    // Y el renombre por etiqueta desnuda ya no cambia el nombre de una fila por si solo.
    renameSpeakerRows(['Hablante 1'], 'Luis')
    expect(resolveRowSpeakerName('Hablante 1')).toBe('Hablante 1')
  })
})
