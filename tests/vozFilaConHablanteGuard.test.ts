// ============================================================
// vozFilaConHablanteGuard - A5: NINGUNA fila de usuario sin etiqueta
// ------------------------------------------------------------
// DEFECTO MEDIDO (2026-10-10, log del dueno): el decisor de la etiqueta de la fila
// (`resolveRowSpeakerName`) devolvia '' cuando la etiqueta era automatica y no habia
// evidencia acustica declarada, y tambien cuando no llegaba etiqueta. Resultado medido:
// 35 de 40 filas de usuario SIN hablante (P9.65) — y la fila ya no se podia leer.
//
// REGLA A5: la etiqueta final se decide en UN punto y SIEMPRE hay respaldo
// (`fallbackSpeaker` = `voiceIdentity.labels.fallbackSpeaker`, el mismo valor que usa la
// diarizacion). Sin evidencia no se inventa el NOMBRE propio (se conserva la regla de
// P9.52: una etiqueta automatica no entra como si fuera medida), pero la fila nunca
// queda vacia.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import {
  commitUserTurnRow,
  resolveRowSpeakerName,
  resetSpeakerAliases,
} from '../src/voice/lib/conversationTurnRow'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js'

const RESPALDO = String((FLU_CONFIG as any).voiceIdentity?.labels?.fallbackSpeaker || '')

function speakerDe(): string {
  const row = useIntegrationStore
    .getState()
    .conversationHistory.find((e) => e.role === 'user')
  return String((row as any)?.speakerName || '')
}

describe('A5 - ninguna fila de usuario sin etiqueta', () => {
  beforeEach(() => {
    resetSpeakerAliases()
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined })
  })

  it('el decisor SIEMPRE devuelve una etiqueta (respaldo cuando no hay nombre)', () => {
    expect(resolveRowSpeakerName('', false)).toBe(RESPALDO)
    expect(resolveRowSpeakerName('Hablante 1', false)).toBe(RESPALDO)
    // Con evidencia acustica la etiqueta automatica SI entra (no se degrada lo medido).
    expect(resolveRowSpeakerName('Hablante 3', true)).toBe('Hablante 3')
    // Un nombre propio pasa siempre.
    expect(resolveRowSpeakerName('Luz', false)).toBe('Luz')
  })

  it('0 filas de usuario sin etiqueta al escribir la conversacion', () => {
    commitUserTurnRow({ text: 'hola', turnId: 1 } as never)
    expect(speakerDe()).toBe(RESPALDO)
    commitUserTurnRow({ text: 'que tal', speakerName: 'Hablante 2', turnId: 2 } as never)
    const filas = useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user')
    expect(filas.every((f) => String((f as any).speakerName || '').trim() !== '')).toBe(true)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el respaldo es un parametro', () => {
    expect(resolveRowSpeakerName('', false, {}, 'Hablante 9')).toBe('Hablante 9')
    expect(resolveRowSpeakerName('Hablante 2', false, {}, 'Hablante 9')).toBe('Hablante 9')
    expect(resolveRowSpeakerName('Hablante 2', true, {}, 'Hablante 9')).toBe('Hablante 2')
  })
})
