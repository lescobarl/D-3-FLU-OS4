// ============================================================
// vozFilaConHablanteGuard - A5 (corregida): la fila escribe la ETIQUETA DEL RESOLVER y
// las filas ya escritas NO se reescriben (fila inmutable, mandato 2026-10-26).
// ------------------------------------------------------------
// LO QUE MIDIO MAL LA PRIMERA VERSION (medido en la sesion del dueno 14:00-14:08):
// el guard solo exigia "la fila nunca queda vacia", asi que paso en verde mientras la
// fila escribia el RESPALDO ("Hablante 1") en vez de la etiqueta del resolver
// ("Hablante 2"): el renombre de "soy Luis" no encontraba ninguna fila con esa etiqueta
// (no sustituia nada) y el relleno tardio estampaba "Luis" en la voz de la mujer.
//
// REGLA (dueno, 2026-10-10): la etiqueta de DIARIZACION es PROVISIONAL -> se escribe TAL
// CUAL. La evidencia acustica decide si se ASCIENDE a nombre propio, no si se escribe.
// El respaldo se usa SOLO cuando no hay etiqueta.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest'
import { commitUserTurnRow, resolveRowSpeakerName, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { useIntegrationStore } from '../src/store/integrationStore'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const RESPALDO = String((FLU_CONFIG as any).voiceIdentity?.labels?.fallbackSpeaker || '')

function filas(): string[] {
  return useIntegrationStore
    .getState()
    .conversationHistory.filter((e) => e.role === 'user')
    .map((e) => resolveRowSpeakerLabel(e))
}
function filaDe(turnId: number): string {
  const entry = useIntegrationStore
    .getState()
    .conversationHistory.find((e) => (e as { turnId?: number }).turnId === turnId)
  return entry ? resolveRowSpeakerLabel(entry) : filas()[0]
}

describe('A5 corregida - la etiqueta del resolver se escribe y la fila es inmutable', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined })
    // Aislamiento de sesion (mandato 2026-10-13): el nombre vive en el DIRECTORIO por VOZ,
    // que es estado de sesion. Sin vaciarlo, el registro de un caso se filtraba al siguiente.
    resetVoiceDirectory()
  })

  it('(util) la fila lleva la ETIQUETA PEDIDA, no el respaldo', () => {
    commitUserTurnRow({
      text: 'también venden peperos y muchas papas coreanas',
      speakerName: 'Hablante 2',
      evidenciaAcustica: false,
      turnId: 12,
    } as never)
    expect(filas()[0], 'la etiqueta de diarizacion se escribe tal cual').toBe('Hablante 2')
expect(resolveRowSpeakerName('Hablante 3')).toBe('Hablante 3')
expect(resolveRowSpeakerName('luis'), 'etiqueta no-propia del resolver').toBe('luis')
  })

  it('(util) tras "soy <nombre>" las filas ya escritas NO se reescriben', () => {
    commitUserTurnRow({ text: 'vamos a poner a la mujer', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 11 } as never)
    commitUserTurnRow({ text: 'también venden peperos', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 12 } as never)
    expect(filas()).toEqual(['Hablante 2', 'Hablante 2'])

    const result = registerSpeakerIdentity({
      name: 'Luis',
      previousLabel: 'Hablante 2',
      clusters: [{ label: 'Hablante 2', signature: [1, 0, 0] }],
    })
    expect(result.rowsChanged, 'el registro no escribe filas').toBe(0)
    expect(filas(), 'la etiqueta ya escrita se conserva (un solo dueno de la fila)').toEqual(['Hablante 2', 'Hablante 2'])
  })

  it('(util) el nombre propio NO asciende sin evidencia (Luis no cae en la voz de la mujer)', () => {
    commitUserTurnRow({ text: 'el relleno se ve igualita a la de Corea', speakerName: 'Hablante 2', evidenciaAcustica: false, turnId: 25 } as never)
    updateTurnRowSpeaker(25, 'Luis', { evidenciaAcustica: false } as never)
    expect(filaDe(25), 'sin evidencia la fila conserva su etiqueta de diarizacion').toBe('Hablante 2')
  })

  it('(util) CON evidencia acustica el nombre propio SI asciende', () => {
    commitUserTurnRow({ text: 'el relleno se ve igualita a la de Corea', speakerName: 'Hablante 2', evidenciaAcustica: false, turnId: 26 } as never)
    updateTurnRowSpeaker(26, 'Luis', { evidenciaAcustica: true } as never)
    expect(filaDe(26)).toBe('Luis')
  })

  it('la fila NUNCA queda vacia: sin etiqueta -> respaldo', () => {
    commitUserTurnRow({ text: 'hola', turnId: 1 } as never)
    expect(filas()[0]).toBe(RESPALDO)
    expect(resolveRowSpeakerName('')).toBe(RESPALDO)
    expect(resolveRowSpeakerName('   ')).toBe(RESPALDO)
  })

  it('(flanco) fila VACIA + nombre propio SIN evidencia -> NO se estampa', () => {
    // El relleno tardio de identidad pedia "Luis" sin evidencia sobre una fila vacia y
    // colaba el nombre en una voz que no era la suya. Sin evidencia acustica NI del
    // texto, la fila se queda con el RESPALDO, no con el nombre propio.
    // Por la puerta REAL: el relleno tardio sobre una fila vacia no escribe el nombre.
    commitUserTurnRow({ text: 'okay flu soy luis', speakerName: 'Hablante 2', evidenciaAcustica: false, turnId: 25 } as never)
    useIntegrationStore.setState({ conversationHistory: useIntegrationStore.getState().conversationHistory.map((e) => ((e as { turnId?: number }).turnId === 25 ? { ...e, speakerName: '' } : e)) })
    updateTurnRowSpeaker(25, 'Luis', { evidenciaAcustica: false } as never)
    expect(filaDe(25), 'la fila vacia no estampa el nombre propio').not.toBe('Luis')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): la etiqueta y el respaldo discriminan', () => {
    // Con etiqueta: se escribe la etiqueta (no el respaldo inyectado).
    expect(resolveRowSpeakerName('Hablante 2', 'Hablante 9')).toBe('Hablante 2')
    // Sin etiqueta: manda el respaldo inyectado.
    expect(resolveRowSpeakerName('', 'Hablante 9')).toBe('Hablante 9')
    // Una etiqueta automatica NO asciende por el vinculo con un participante registrado:
    // la unica via del nombre propio es el texto del comando; la voz no lo introduce.
    commitUserTurnRow({ text: 'hola a todos', speakerName: 'Hablante 2', evidenciaAcustica: true, turnId: 41 } as never)
    expect(filaDe(41), 'la voz no introduce el nombre').toBe('Hablante 2')
  })
})
