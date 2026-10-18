// ============================================================
// vozReplayLogDueno20261017 - FREEZE del nombre por FILA (mandato del dueno 2026-10-17)
// ------------------------------------------------------------
// DEFECTO MEDIDO en el log del dueno (debug.log, sesion 21:57-21:59):
//   - turn 8  wake-intro "Luis" sobre la etiqueta 'Hablante 1' SIN timbre (refClusters:0).
//   - turn 14/20 row-update voz=speaker_1 nombre=Luis (sin timbre de la fila).
//   - turn 16 la MUJER diariza 'Hablante 1' -> speaker_1 SIN firma -> sus filas salian "Luis".
// CAUSA: el nombre quedaba colgado de la CLAVE DE ETIQUETA (speaker_1) en el directorio y
// una fila SIN firma lo heredaba AL MOSTRAR (repintado retroactivo).
// MANDATO (freeze): el nombre se CONGELA en la fila al identificarla; NUNCA se re-resuelve
// desde el directorio. Una fila de una voz DISTINTA que reutiliza la etiqueta NO hereda.
// NACE ROJO.
// ============================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useIntegrationStore } from '../src/store/integrationStore'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
import type { ConversationEntry } from '../src/types/bridge'

function fila(id: string, speakerId: string, extra: Partial<ConversationEntry> = {}): ConversationEntry {
  return { id, role: 'user', text: `texto ${id}`, speakerId, timestamp: Number(id.replace(/\D/g, '')) || 1, ...extra }
}

function sembrar(rows: ConversationEntry[]) {
  useIntegrationStore.setState({ conversationHistory: rows })
}

function etiqueta(id: string): string {
  const row = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id)
  return resolveRowSpeakerLabel(row as ConversationEntry)
}

beforeEach(() => {
  resetVoiceDirectory()
  useIntegrationStore.setState({ conversationHistory: [] })
})
afterEach(() => resetVoiceDirectory())

describe('FREEZE: la fila congela su nombre; una etiqueta reutilizada no lo hereda', () => {
  it('la fila ya identificada lleva el nombre; la voz DISTINTA con la MISMA etiqueta NO (la mujer no sale Luis)', () => {
    // El dueno se identifica sobre 'Hablante 1' SIN timbre (su log: clusters=0)
    sembrar([fila('r1', 'speaker_1', { speakerName: 'Hablante 1' })])
    registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })
    expect(etiqueta('r1'), 'la fila identificada se congela con el nombre').toBe('Luis')

    // LLEGA la mujer: MISMA etiqueta 'Hablante 1' -> speaker_1, SIN su propio timbre
    useIntegrationStore.getState().addConversationEntry(fila('r2', 'speaker_1', { speakerName: 'Hablante 1' }))
    expect(etiqueta('r2'), 'una voz distinta NO hereda el nombre de la clave reutilizada').toBe('Hablante 1')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): si la herencia por directorio vuelve, este caso cae', () => {
    // Fila NUEVA sin nombre propio escrito y sin firma: no hay de donde heredar.
    sembrar([fila('r9', 'speaker_1')])
    registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })
    expect(etiqueta('r9'), 'sin nombre congelado en la fila, la etiqueta provisional (no el directorio)').toBe('Hablante 1')
  })

  it('el nombre congelado es WRITE-ONCE: un registro posterior de otra clave no lo mueve', () => {
    sembrar([fila('r1', 'speaker_name_luis', { speakerName: 'Luis' })])
    // Un registro de la etiqueta reutilizada 'Hablante 1' no debe tocar la fila ya con nombre propio.
    registerSpeakerIdentity({ name: 'Hablante 1', clusters: [], previousLabel: 'Hablante 1' })
    expect(etiqueta('r1')).toBe('Luis')
  })
})
