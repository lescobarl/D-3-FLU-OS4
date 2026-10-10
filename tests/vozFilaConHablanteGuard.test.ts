// ============================================================
// vozFilaConHablanteGuard - A5 (corregida): la fila escribe la ETIQUETA DEL RESOLVER, y
// el renombre de "soy <nombre>" SUSTITUYE las filas de esa voz.
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
import { useIntegrationStore } from '../src/store/integrationStore'
import {
  commitUserTurnRow,
  renameSpeakerRows,
  resetSpeakerAliases,
  resolveRowSpeakerName,
  updateTurnRowSpeaker,
} from '../src/voice/lib/conversationTurnRow'
import { applyResolvedSpeakerToSessionRefs } from '../src/voice/lib/turnSpeakerCommit.js'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const RESPALDO = String((FLU_CONFIG as any).voiceIdentity?.labels?.fallbackSpeaker || '')

function filas(): string[] {
  return useIntegrationStore
    .getState()
    .conversationHistory.filter((e) => e.role === 'user')
    .map((e) => String(e.speakerName || ''))
}
function filaDe(turnId: number): string {
  const entry = useIntegrationStore
    .getState()
    .conversationHistory.find((e) => (e as { turnId?: number }).turnId === turnId)
  return entry ? String(entry.speakerName || '') : filas()[0]
}

describe('A5 corregida - la etiqueta del resolver se escribe y el renombre sustituye', () => {
  beforeEach(() => {
    resetSpeakerAliases()
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined })
  })

  it('(util) la fila lleva la ETIQUETA PEDIDA, no el respaldo', () => {
    commitUserTurnRow({
      text: 'también venden peperos y muchas papas coreanas',
      speakerName: 'Hablante 2',
      evidenciaAcustica: false,
      turnId: 12,
    } as never)
    expect(filas()[0], 'la etiqueta de diarizacion se escribe tal cual').toBe('Hablante 2')
    expect(resolveRowSpeakerName('Hablante 3', false)).toBe('Hablante 3')
    expect(resolveRowSpeakerName('luis', false), 'etiqueta no-propia del resolver').toBe('luis')
  })

  it('(util) tras "soy <nombre>" el renombre SUSTITUYE las filas de esa voz', () => {
    commitUserTurnRow({ text: 'vamos a poner a la mujer', speakerName: 'Hablante 2', evidenciaAcustica: false, turnId: 11 } as never)
    commitUserTurnRow({ text: 'también venden peperos', speakerName: 'Hablante 2', evidenciaAcustica: false, turnId: 12 } as never)
    expect(filas()).toEqual(['Hablante 2', 'Hablante 2'])

    applyResolvedSpeakerToSessionRefs(
      { speakerName: 'Luis', source: 'wake-intro', previousLabel: 'Hablante 2' } as never,
      {
        renameSpeakerRows,
        speakerClustersRef: { current: [{ label: 'Hablante 2', signature: [1, 0, 0] }] },
        sessionPrimarySpeakerRef: { current: '' },
      } as never,
    )
    expect(filas(), 'las filas de la voz identificada cambian a su nombre').toEqual(['Luis', 'Luis'])
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
    expect(resolveRowSpeakerName('', false)).toBe(RESPALDO)
    expect(resolveRowSpeakerName('   ', false)).toBe(RESPALDO)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): la etiqueta y el respaldo discriminan', () => {
    // Con etiqueta: se escribe la etiqueta (no el respaldo inyectado).
    expect(resolveRowSpeakerName('Hablante 2', false, {}, 'Hablante 9')).toBe('Hablante 2')
    // Sin etiqueta: manda el respaldo inyectado.
    expect(resolveRowSpeakerName('', false, {}, 'Hablante 9')).toBe('Hablante 9')
    // El vinculo registrado solo asciende CON evidencia.
    const LUIS = { registeredLabel: 'Hablante 2', registeredName: 'Luis' }
    expect(resolveRowSpeakerName('Hablante 2', false, LUIS)).toBe('Hablante 2')
    expect(resolveRowSpeakerName('Hablante 2', true, LUIS)).toBe('Luis')
  })
})
