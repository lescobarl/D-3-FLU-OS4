// ============================================================
// registerParticipantVoice — la VOZ MEDIDA entra en la base; un alta EXISTENTE se RE-ANCLA.
// ------------------------------------------------------------
// DEFECTO MEDIDO (log del dueno 2026-10-18): "ok flu soy luis" cambiaba solo la ULTIMA
// intervencion porque el alta devolvia 'duplicate' y se descartaba: el participante
// conservaba un ancla vieja o de otro modelo|dtype, asi que su voz seguia saliendo
// "Hablante 1". El vector viaja SIEMPRE con `voiceVectorModel` (modelo + dtype).
// ============================================================
import { describe, expect, it, vi } from 'vitest'
import {
  createParticipantRegistry,
  type ParticipantConfig,
  type ParticipantRecord,
  type ParticipantsDb,
} from '../src/core/multiuser/participantRegistry'
import { registerParticipantVoice } from '../src/app/registerParticipantVoice'
import { addAuditLog } from '../src/core/db/fluDatabase'
import { resolveVoiceIdentity, voiceVectorModel } from '../src/voice/lib/speakerDirectory'

// IndexedDB no existe en vitest: el log de auditoria se mockea (mismo patron que
// participantRegistry.test.ts).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase')
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) }
})

const CONFIG: ParticipantConfig = {
  roles: ['Familiar', 'Amigo'],
  defaultVoice: { voiceURI: '', voiceName: 'Voz por defecto', rate: 1, pitch: 1, volume: 1 },
  birthdayAdvanceDays: 7,
}

/** Base en memoria (misma interfaz `ParticipantsDb` que Dexie). */
function mapDb(): ParticipantsDb {
  const map = new Map<string, ParticipantRecord>()
  return {
    async add(record) {
      map.set(record.id, record)
      return undefined
    },
    async put(record) {
      map.set(record.id, record)
      return undefined
    },
    async delete(id) {
      map.delete(id)
    },
    async get(id) {
      return map.get(id)
    },
    async toArray() {
      return [...map.values()]
    },
  }
}

/** Registro REAL de participantes sobre la base en memoria. */
function crear() {
  let n = 0
  return createParticipantRegistry({
    db: mapDb(),
    config: CONFIG,
    newId: () => `p${++n}`,
    now: () => 1,
  })
}

const VOZ_MEDIDA = [1, 0, 0]
const VOZ_VIEJA = [0, 1, 0]

describe('registerParticipantVoice: alta y re-ancla de la voz MEDIDA', () => {
  it('un alta NUEVA guarda la voz medida CON su modelo|dtype', async () => {
    const service = crear()
    expect(await registerParticipantVoice(service, 'Luis', VOZ_MEDIDA)).toBe(true)
    const [row] = await service.list()
    expect(row.name).toBe('Luis')
    expect(row.voiceVector).toEqual(VOZ_MEDIDA)
    expect(row.voiceVectorModel, 'sin la clave modelo|dtype el vector no es comparable').toBe(voiceVectorModel())
    expect(row.voiceAnchorVerified, 'un ancla medida con el modelo vigente nace VERIFICADA').toBe(true)
  })

  it('un alta EXISTENTE se RE-ANCLA: la voz vieja se sustituye por la medida', async () => {
    const service = crear()
    await service.register({ name: 'Luis', speakerLabel: 'Luis', voiceVector: VOZ_VIEJA, voiceVectorModel: 'modelo-viejo' })
    // "soy luis" con OTRA grafia: sigue siendo el MISMO participante (case-insensitive).
    expect(await registerParticipantVoice(service, 'luis', VOZ_MEDIDA)).toBe(true)
    const rows = await service.list()
    expect(rows, 'no se duplica el participante').toHaveLength(1)
    expect(rows[0].voiceVector).toEqual(VOZ_MEDIDA)
    expect(rows[0].voiceVectorModel).toBe(voiceVectorModel())
    expect(rows[0].voiceAnchorVerified, 'la voz medida REEMPLAZA el ancla vieja y la verifica').toBe(true)
  })

  it('sin vector MEDIDO no hay re-ancla: el ancla existente NO se pisa', async () => {
    const service = crear()
    await service.register({ name: 'Luis', voiceVector: VOZ_VIEJA, voiceVectorModel: 'modelo-viejo' })
    expect(await registerParticipantVoice(service, 'Luis', null)).toBe(false)
    const [row] = await service.list()
    expect(row.voiceVector).toEqual(VOZ_VIEJA)
    expect(row.voiceVectorModel).toBe('modelo-viejo')
  })

  it('DETECTOR: tras el re-ancla la VOZ MEDIDA resuelve el nombre (y el ancla vieja no casa)', async () => {
    const service = crear()
    await service.register({ name: 'Luis', speakerLabel: 'Luis', voiceVector: VOZ_VIEJA, voiceVectorModel: 'modelo-viejo' })
    await registerParticipantVoice(service, 'Luis', VOZ_MEDIDA)
    const [row] = await service.list()
    const candidates = [{ name: row.name, vector: row.voiceVector, model: row.voiceVectorModel }]
    expect(resolveVoiceIdentity(VOZ_MEDIDA, { candidates })?.name, 'la base reconoce su voz').toBe('Luis')
    // La voz VIEJA (ortogonal) no puede casar con el nombre: no se mezclan hablantes.
    expect(resolveVoiceIdentity(VOZ_VIEJA, { candidates })).toBeNull()
  })
})

describe('higiene de anclas (invalidateVoiceAnchors): sin modelo|dtype vigente o sin verificar, el ancla es BASURA', () => {
  it('conserva el ancla VERIFICADA del modelo vigente', async () => {
    const service = crear()
    await service.register({
      name: 'Luis',
      voiceVector: VOZ_MEDIDA,
      voiceVectorModel: voiceVectorModel(),
      voiceAnchorVerified: true,
    })
    expect(await service.invalidateVoiceAnchors({ model: voiceVectorModel() })).toBe(0)
    const [row] = await service.list()
    expect(row.voiceVector).toEqual(VOZ_MEDIDA)
    expect(row.voiceAnchorVerified).toBe(true)
  })

  it('borra el ancla SIN verificar y la de OTRO modelo, conservando al participante', async () => {
    const service = crear()
    // Mismo modelo pero SIN verificar: no hay evidencia de que se midiera.
    await service.register({ name: 'Luis', voiceVector: VOZ_MEDIDA, voiceVectorModel: voiceVectorModel() })
    // Otro modelo|dtype, aunque se haya declarado verificado: no es comparable.
    await service.register({ name: 'Ana', voiceVector: VOZ_VIEJA, voiceVectorModel: 'modelo-viejo', voiceAnchorVerified: true })
    expect(await service.invalidateVoiceAnchors({ model: voiceVectorModel() })).toBe(2)
    const rows = await service.list()
    expect(rows.map((row) => row.name).sort(), 'el PARTICIPANTE se conserva').toEqual(['Ana', 'Luis'])
    for (const row of rows) {
      expect(row.voiceVector, `${row.name}: el vector basura se borra`).toBeUndefined()
      expect(row.voiceVectorModel).toBeUndefined()
      expect(row.voiceAnchorVerified).toBeUndefined()
    }
  })

  it('no toca a un participante sin vector (no hay ancla que invalidar)', async () => {
    const service = crear()
    await service.register({ name: 'Sin Voz' })
    expect(await service.invalidateVoiceAnchors({ model: voiceVectorModel() })).toBe(0)
    const [row] = await service.list()
    expect(row.name).toBe('Sin Voz')
  })

  it('audita cada ancla invalidada con su motivo (unverified / model-mismatch)', async () => {
    const audit = vi.mocked(addAuditLog)
    audit.mockClear()
    const service = crear()
    await service.register({ name: 'Luis', voiceVector: VOZ_MEDIDA, voiceVectorModel: voiceVectorModel() })
    await service.register({ name: 'Ana', voiceVector: VOZ_VIEJA, voiceVectorModel: 'modelo-viejo', voiceAnchorVerified: true })
    await service.invalidateVoiceAnchors({ model: voiceVectorModel() })
    const invalidaciones = audit.mock.calls.filter(([action]) => action === 'participant.invalidate-voice-anchor')
    expect(invalidaciones).toHaveLength(2)
    const motivos = invalidaciones.map(([, , , , details]) => String((details as { reason?: string })?.reason))
    expect(motivos.sort()).toEqual(['model-mismatch', 'unverified'])
  })

  it('sin modelo vigente NINGUN ancla es comparable: se invalidan todas (la higiene exige la clave)', async () => {
    const service = crear()
    await service.register({
      name: 'Luis',
      voiceVector: VOZ_MEDIDA,
      voiceVectorModel: voiceVectorModel(),
      voiceAnchorVerified: true,
    })
    expect(await service.invalidateVoiceAnchors()).toBe(1)
    const [row] = await service.list()
    expect(row.voiceVector).toBeUndefined()
  })
})
