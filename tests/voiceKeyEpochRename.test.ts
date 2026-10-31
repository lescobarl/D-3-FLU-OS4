// @vitest-environment node
// ============================================================
// voiceKeyEpochRename — UN SOLO DUENO DE LA ETIQUETA DE LA FILA (mandato 2026-10-26,
// reajustado 2026-10-30 con el retiro del escritor pasivo).
// ------------------------------------------------------------
// La ruta vieja renombraba filas YA ESCRITAS desde el registro de identidad
// (`renameVoiceRowsByKey`/`freezeVoiceName`). Con el modulo CONVERSACION la etiqueta
// la resuelve el modulo al cerrar su locucion: el registro de identidad solo liga el
// nombre a la VOZ en el directorio. Este guard mide:
//   1. ninguna via de identidad reescribe filas;
//   2. el high-water y el epoch siguen sin reutilizar numeros ni tocar filas viejas
//      (lo aportan la RESTAURACION y el escritor de la vista `conversationMotorProducto.js`
//      por el raiser unico del store, `noteSpeakerHighWater`; el registro de identidad NO
//      lo sube);
//   3. la fuente no vuelve a llamar al renombre viejo (detector con mutacion).
//
// PRUEBA DE DETECTOR: `llamadasAlRenombreViejo` se prueba con una entrada infractora
// (marca) y una limpia (no marca); si el registro re-introduce la llamada, CAE.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useIntegrationStore } from '../src/store/integrationStore'
import {
  applyKnownVoiceName,
  registerSpeakerIdentity,
} from '../src/voice/lib/speakerIdentityRegister'
import { nextAutoSpeakerLabel, sessionSpeakerHighWater } from '../src/voice/lib/speakerCore.js'
import { labelToSpeakerId } from '../src/voice/lib/conversationRow.js'

const store = () => useIntegrationStore.getState()

const V = (semilla: number) => {
  const v = new Array(16).fill(0)
  v[semilla % 16] = 1
  return v
}

const nombres = (speakerId?: string) =>
  store()
    .conversationHistory.filter(
      (e) => e.role === 'user' && (!speakerId || e.speakerId === speakerId),
    )
    .map((e) => String(e.speakerName || ''))

let seedId = 0
/**
 * Siembra una fila de usuario por la ÚNICA puerta del store (`addConversationEntry`),
 * la misma que usa el módulo al commitear. El escritor pasivo se retiró (2026-10-30).
 */
const seed = (texto: string, speakerName: string, turnId: number) => {
  store().addConversationEntry({
    id: `seed-${++seedId}`,
    role: 'user',
    text: texto,
    timestamp: Date.now(),
    speakerName,
    speakerId: labelToSpeakerId(speakerName),
    turnId,
  })
}

beforeEach(() => {
  useIntegrationStore.setState({
    conversationHistory: [],
    conversationEpoch: 0,
    speakerHighWater: 0,
  })
})

/**
 * Detecta llamadas REALES (no menciones en documentacion) al renombre de filas.
 * @param fuente Codigo fuente completo.
 * @returns Nombres de las funciones de renombre invocadas.
 */
export function llamadasAlRenombreViejo(fuente: string): string[] {
  const codigo = fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  return [...codigo.matchAll(/\b(renameVoiceRowsByKey|freezeVoiceName)\s*\(/g)].map(
    (match) => String(match[1]),
  )
}

describe('registrar identidad NO reescribe filas ya escritas', () => {
  it('"soy Luis" liga el nombre a la VOZ y deja intactas las filas del epoch', () => {
    const voz = V(1)
    seed('hola uno', 'Hablante 1', 1)
    expect(nombres('speaker_1')).toEqual(['Hablante 1'])

    const resultado = registerSpeakerIdentity({
      name: 'Luis',
      clusters: [{ label: 'Hablante 1', signature: voz, signatureHistory: [voz] }],
      previousLabel: 'Hablante 1',
      signatureVector: voz,
    })

    expect(resultado.registered).toBe(true)
    expect(resultado.rowsChanged, 'la fila la escribe SOLO el modulo al cerrar').toBe(0)
    expect(nombres('speaker_1'), 'ninguna fila ya escrita se renombra').toEqual(['Hablante 1'])
  })

  it('reconocer una identidad conocida tampoco reescribe filas', () => {
    const voz = V(2)
    seed('estoy probando', 'Hablante 1', 2)
    const resultado = applyKnownVoiceName({
      name: 'Luis',
      previousLabel: 'Hablante 1',
      anchorVector: voz,
    })
    expect(resultado.registered).toBe(true)
    expect(resultado.rowsChanged, 'reconocer deja la fila como la escribio el modulo').toBe(0)
    expect(nombres()).toEqual(['Hablante 1'])
  })
})

describe('high-water y epoch no dependen del renombre de filas', () => {
  it('tras registrar el nombre, la voz NUEVA sigue en max+1 (el registro no toca el high-water)', () => {
    // El high-water lo aportan la RESTAURACION y el escritor de la vista
    // (`conversationMotorProducto.js`) por el unico raiser del store; aqui se fija
    // la previa para probar que REGISTRAR una identidad ni sube ni baja.
    store().noteSpeakerHighWater(1)
    registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })

    expect(store().speakerHighWater, 'registrar ni sube ni baja el high-water').toBe(1)
    expect(nextAutoSpeakerLabel([], [], { highWater: store().speakerHighWater })).toBe('Hablante 2')
  })

  it('el epoch nuevo numera desde cero y no toca las filas restauradas', () => {
    seed('uno', 'Hablante 1', 3)
    seed('dos', 'Hablante 2', 4)

    const viejas = store().conversationHistory.map((e) => ({ ...e }))
    expect(viejas.every((e) => Number(e.epoch) === 0), 'las filas nacieron en el epoch 0').toBe(true)
    store().resetConversationHistory()
    expect(store().conversationEpoch).toBe(1)
    expect(store().speakerHighWater).toBe(0)
    useIntegrationStore.setState({ conversationHistory: viejas })

    expect(sessionSpeakerHighWater({ rows: viejas, epoch: store().conversationEpoch })).toBe(0)
    expect(nextAutoSpeakerLabel([], [], { highWater: store().speakerHighWater })).toBe('Hablante 1')
    expect(viejas.every((e) => e.speakerName !== 'Luis')).toBe(true)
  })
})

describe('guards de fuente: el renombre viejo no se llama', () => {
  it('ni el registro de identidad ni el compositor del motor llaman al renombre', () => {
    const registro = readFileSync('src/voice/lib/speakerIdentityRegister.js', 'utf8')
    const motor = readFileSync('src/voice/compose/conversationMotorProducto.js', 'utf8')
    expect(llamadasAlRenombreViejo(registro)).toEqual([])
    expect(llamadasAlRenombreViejo(motor)).toEqual([])
    // El compositor tampoco importa la tuberia vieja de decision de filas.
    expect(
      /from\s+['"][^'"]*(conversationTurnRow|conversationStreamCommit|activeListen|turnStream|transcriptIngress|speakerDiarization)/.test(
        motor,
      ),
      'el motor no importa la tuberia vieja',
    ).toBe(false)
  })

  it('el detector marca una llamada real y no una mencion documentada (mutacion)', () => {
    expect(llamadasAlRenombreViejo("renameVoiceRowsByKey(id, 'Luis');")).toEqual([
      'renameVoiceRowsByKey',
    ])
    expect(llamadasAlRenombreViejo('// renameVoiceRowsByKey(id)\nconst x = 1')).toEqual([])
    expect(llamadasAlRenombreViejo('/* freezeVoiceName(id) */')).toEqual([])
  })
})
