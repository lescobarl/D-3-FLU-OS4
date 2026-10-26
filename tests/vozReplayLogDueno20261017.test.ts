// ============================================================
// vozReplayLogDueno20261017 - FILA INMUTABLE y nombre por VOZ (mandato 2026-10-26)
// ------------------------------------------------------------
// DEFECTO MEDIDO en el log del dueno (debug.log, sesion 21:57-21:59):
//   - turn 8  wake-intro "Luis" sobre la etiqueta 'Hablante 1' SIN timbre (refClusters:0).
//   - turn 14/20 row-update voz=speaker_1 nombre=Luis (sin timbre de la fila).
//   - turn 16 la MUJER diariza 'Hablante 1' -> speaker_1 SIN firma -> sus filas salian "Luis".
// CAUSA: el nombre quedaba colgado de la CLAVE DE ETIQUETA (speaker_1) y una fila SIN
// firma lo heredaba AL MOSTRAR (repintado retroactivo).
// REGLA VIGENTE: el nombre se liga a la VOZ (directorio por timbre); NINGUNA fila ya
// escrita se reescribe (la etiqueta la decidio el modulo CONVERSACION al cerrar). Una
// fila de una voz DISTINTA que reutiliza la etiqueta NO hereda. Una fila SIN firma
// conserva la etiqueta con la que se escribio (antes se congelaba al nombre: retirado).
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

describe('FILA INMUTABLE: el nombre vive en la VOZ; una etiqueta reutilizada no lo hereda', () => {
  it('una fila SIN firma conserva su etiqueta; la MISMA clave reutilizada tampoco hereda', () => {
    // El dueno se identifica sobre 'Hablante 1' SIN timbre (su log: clusters=0).
    sembrar([fila('r1', 'speaker_1', { speakerName: 'Hablante 1' })])
    const result = registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })
    // Mandato 2026-10-26: ninguna fila ya escrita se reescribe.
    expect(etiqueta('r1'), 'la fila conserva la etiqueta con la que se cerro').toBe('Hablante 1')
    expect(result.rowsChanged).toBe(0)

    // LLEGA la mujer: MISMA etiqueta 'Hablante 1' -> speaker_1, SIN su propio timbre.
    useIntegrationStore.getState().addConversationEntry(fila('r2', 'speaker_1', { speakerName: 'Hablante 1' }))
    expect(etiqueta('r2'), 'una voz distinta NO hereda un nombre de la clave reutilizada').toBe('Hablante 1')
  })

  it(
    'CAMBIO DECLARADO (2026-10-26): la fila de la MISMA clave NO se reescribe',
    () => {
      // La ruta de renombre por clave/epoch se retiro (mandato 2026-10-26): "soy Luis" liga
      // el nombre a la VOZ, no a las filas ya escritas. La fila de la misma clave conserva
      // su etiqueta; las locuciones siguientes las etiqueta el modulo al cerrarlas.
      sembrar([fila('r9', 'speaker_1')])
      const result = registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })
      expect(result.rowsChanged).toBe(0)
      expect(etiqueta('r9'), 'la fila ya escrita no se renombra').toBe('Hablante 1')
    },
  )

  it('la VOZ CONTRARIA bajo la misma clave no se renombra: la firma manda sobre la clave', () => {
    // Firma de la voz del dueno (base canonica) y firma de OTRA persona (ortogonal).
    const vozLuis = new Array(16).fill(0)
    vozLuis[0] = 1
    const vozAjena = new Array(16).fill(0)
    vozAjena[7] = 1

    sembrar([
      fila('r1', 'speaker_1', { speakerName: 'Hablante 1', signature: vozLuis }),
      fila('r2', 'speaker_1', { speakerName: 'Hablante 1', signature: vozAjena }),
    ])
    registerSpeakerIdentity({
      name: 'Luis',
      clusters: [],
      previousLabel: 'Hablante 1',
      signatureVector: vozLuis,
    })

    // La fila del titular pasa al nombre; la de la OTRA voz conserva su etiqueta anonima
    // aunque comparta clave: la clave agrupa turnos, no personas.
    expect(etiqueta('r1')).toBe('Luis')
    expect(etiqueta('r2'), 'la mujer no sale Luis').toBe('Hablante 1')
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

  it('la fila previa cuya firma no case con la medida del turno conserva su etiqueta (perdida declarada)', () => {
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
    // PERDIDA DECLARADA (mandato 2026-10-26): antes el freeze alcanzaba esta fila por la
    // firma aprendida del cluster. Ahora la fila es INMUTABLE: su firma no casa con la
    // medida del turno, asi que el directorio no la reconoce y conserva su etiqueta de VOZ
    // ('Hablante 9', la clave con la que se escribio), no el nombre. El nombre si queda
    // ligado a la VOZ para las locuciones siguientes.
    expect(etiqueta('r1'), 'la fila ya escrita no se renombra').toBe('Hablante 9')
    expect(etiqueta('r2'), 'la voz ajena conserva su etiqueta').toBe('Hablante 3')
  })
})
