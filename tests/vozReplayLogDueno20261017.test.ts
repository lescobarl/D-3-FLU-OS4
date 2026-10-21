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
import { sameVoiceFloor } from '../src/voice/lib/speakerClusters.js'
import { compareCosineSignatures } from '../src/voice/lib/speakerCore.js'
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

// ============================================================
// FREEZE por TODAS las medidas de la VOZ.
// ------------------------------------------------------------
// DEFECTO MEDIDO (dueno, 2026-10-18): "ok flu soy luis" cambiaba SOLO la ultima
// intervencion. La fila se reconocia por la medida CRUDA del turno; una medida
// anterior de la MISMA voz (la firma aprendida del cluster y su historial) no casaba
// con esa muestra concreta y la fila se quedaba en "Hablante N".
// REGLA: la voz se reconoce por CUALQUIERA de sus medidas (turno + firma del cluster
// + historial). Una fila de OTRA voz no se toca.
// ============================================================
describe('FREEZE: una voz se reconoce por TODAS sus medidas, no solo por la del turno', () => {
  const DIM = 64
  function eje(indice: number): number[] {
    const vector = new Array(DIM).fill(0)
    vector[indice] = 1
    return vector
  }
  /** Vector con coseno exacto `sim` respecto a `eje(0)`. */
  function hacia(sim: number): number[] {
    const vector = new Array(DIM).fill(0)
    vector[0] = sim
    vector[1] = Math.sqrt(1 - sim * sim)
    return vector
  }

  beforeEach(() => {
    resetVoiceDirectory()
    useIntegrationStore.setState({ conversationHistory: [] })
  })
  afterEach(() => resetVoiceDirectory())

  it('la fila previa de la MISMA voz se congela aunque su medida no case con la del turno', () => {
    const firmaDelCluster = eje(0)
    // Medida del turno que dice "soy Luis": 0.70 con la firma del cluster (>= piso).
    const medidaDelTurno = hacia(0.70)
    // Medida de una intervencion ANTERIOR de esa voz: casa con la firma del cluster
    // (0.68) pero NO con la muestra concreta del turno (banda ortogonal negativa).
    const filaPrevia = hacia(0.68).map((value, index) => (index === 1 ? -value : value))
    expect(
      compareCosineSignatures(medidaDelTurno, filaPrevia),
      'premisa: la medida cruda del turno NO reconoce a la fila por si sola',
    ).toBeLessThan(sameVoiceFloor())
    expect(
      compareCosineSignatures(firmaDelCluster, filaPrevia),
      'premisa: la firma aprendida de la voz SI reconoce a la fila',
    ).toBeGreaterThanOrEqual(sameVoiceFloor())

    sembrar([
      fila('r1', 'speaker_9', { speakerName: 'Hablante 1', signature: filaPrevia }),
      // Control negativo: otra voz (ortogonal) con su propia etiqueta escrita.
      fila('r2', 'speaker_3', { speakerName: 'Hablante 3', signature: eje(2) }),
    ])
    registerSpeakerIdentity({
      name: 'Luis',
      clusters: [{ label: 'Hablante 1', signature: [...firmaDelCluster], signatureHistory: [[...firmaDelCluster]] }],
      signatureVector: medidaDelTurno,
    })
    expect(etiqueta('r1'), 'toda la participacion de ESA voz lleva el nombre').toBe('Luis')
    expect(etiqueta('r2'), 'la voz ajena conserva su etiqueta').toBe('Hablante 3')
  })
})
