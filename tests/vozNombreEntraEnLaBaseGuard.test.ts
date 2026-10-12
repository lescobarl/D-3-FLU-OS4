// @vitest-environment jsdom
// ============================================================
// vozNombreEntraEnLaBaseGuard - P9.79
// ------------------------------------------------------------
// DEFECTO MEDIDO (dueno, 2026-10-12 16:34:28): "si hay una base de participantes debe
// de aparecer aqui a la derecha ... no lo esta poniendo como participante". El registro
// del nombre (unico dueno: `registerSpeakerIdentity`) escribia SOLO las filas, el alias
// y el primario de sesion; nunca la base (Dexie), que es lo que lee el panel.
//
// CONTRATO: el registro por VOZ escribe el participante en la base por el PUERTO
// inyectado (`refs.registerParticipant`), con el nombre CANONICO y su `speakerLabel`.
// Nace ROJO: hoy `registerSpeakerIdentity` no invoca el puerto.
// ============================================================
import { describe, expect, it, vi } from 'vitest';
import {
  createParticipantRegistry,
  type ParticipantConfig,
  type ParticipantRecord,
  type ParticipantsDb,
} from '../src/core/multiuser/participantRegistry';
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js';

// IndexedDB no existe en vitest: el log de auditoria se mockea (mismo patron que
// participantRegistry.test.ts).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

const CONFIG: ParticipantConfig = {
  roles: ['Familiar', 'Amigo'],
  defaultVoice: { voiceURI: '', voiceName: 'Voz por defecto', rate: 1, pitch: 1, volume: 1 },
  birthdayAdvanceDays: 7,
};

function mapDb(): ParticipantsDb {
  const map = new Map<string, ParticipantRecord>();
  return {
    async add(record) {
      map.set(record.id, record);
      return undefined;
    },
    async put(record) {
      map.set(record.id, record);
      return undefined;
    },
    async delete(id) {
      map.delete(id);
    },
    async get(id) {
      return map.get(id);
    },
    async toArray() {
      return [...map.values()];
    },
  };
}

describe('P9.79 - el nombre registrado por VOZ entra en la BASE de participantes', () => {
  it('registrar por voz escribe el participante (nombre canonico + speakerLabel)', async () => {
    let n = 0;
    const registry = createParticipantRegistry({
      db: mapDb(),
      config: CONFIG,
      newId: () => `p${++n}`,
      now: () => 1,
    });
    let pending: Promise<unknown> | undefined;
    registerSpeakerIdentity({
      name: 'Luis',
      clusters: [],
      refs: {
        registerParticipant: (name: string) => {
          pending = registry.register({ name, speakerLabel: name });
        },
      },
    });
    await pending;
    const rows = await registry.list();
    expect(rows.map((r) => r.name)).toEqual(['Luis']);
    expect(rows[0].speakerLabel).toBe('Luis');
  });
});
