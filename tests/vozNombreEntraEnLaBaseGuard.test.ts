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
// inyectado (`refs.registerParticipant`), con el nombre CANONICO y su VECTOR MEDIDO.
// MANDATO DEL DUENO (2026-10-18): la base compara VECTORES, no nombres; un nombre sin
// vector es basura y NO se escribe (sembraba un ancla ajena, defecto medido en vivo).
// ============================================================
import { describe, expect, it, vi } from 'vitest';
import {
  createParticipantRegistry,
  type ParticipantConfig,
  type ParticipantRecord,
  type ParticipantsDb,
} from '../src/core/multiuser/participantRegistry';
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js';
import { registerParticipantVoice } from '../src/app/registerParticipantVoice';
import { voiceVectorModel } from '../src/voice/lib/speakerDirectory';

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

/** Vector MEDIDO de la voz (no degenerado): la base compara vectores, no nombres. */
const VOZ_MEDIDA = [1, 0, 0];

describe('P9.79 - el nombre registrado por VOZ entra en la BASE de participantes', () => {
  it('registrar por voz escribe el participante con su VECTOR MEDIDO, su modelo y su marca de verificado', async () => {
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
      signatureVector: VOZ_MEDIDA,
      refs: {
        // El puerto REAL de la app: misma cadena que `App.tsx` (nombre canonico + base).
        registerParticipant: (name: string, _label?: string, voiceVector?: number[] | null) => {
          pending = registerParticipantVoice(registry, name, voiceVector ?? undefined);
        },
      },
    });
    await pending;
    const rows = await registry.list();
    expect(rows.map((r) => r.name)).toEqual(['Luis']);
    expect(rows[0].speakerLabel).toBe('Luis');
    expect(rows[0].voiceVector, 'sin el vector la base no puede comparar voces').toEqual(VOZ_MEDIDA);
    expect(rows[0].voiceVectorModel).toBe(voiceVectorModel());
    expect(rows[0].voiceAnchorVerified, 'el ancla nace VERIFICADA: se midio con el modelo vigente').toBe(true);
  });

  it('P9.78: el nombre entra con UNA grafia canonica ("luis" y "Luis" -> "Luis") y re-ancla su vector', async () => {
    let n = 0;
    const registry = createParticipantRegistry({
      db: mapDb(),
      config: CONFIG,
      newId: () => `q${++n}`,
      now: () => 1,
    });
    // SECUENCIAL: una locucion a la vez (el registro real ocurre por turno). Dos
    // llamadas CONCURRENTES ven la base vacia las dos y duplican -> P9.87 (carrera
    // medida aqui, no tapada).
    for (const dicho of ['luis', 'Luis']) {
      let pending: Promise<unknown> | undefined;
      registerSpeakerIdentity({
        name: dicho,
        clusters: [],
        signatureVector: VOZ_MEDIDA,
        refs: {
          registerParticipant: (name: string, _label?: string, voiceVector?: number[] | null) => {
            pending = registerParticipantVoice(registry, name, voiceVector ?? undefined);
          },
        },
      });
      await pending;
    }
    // Las dos locuciones ("soy luis" / "soy Luis") dan la MISMA fila: no hay duplicado
    // por grafia (el registro es idempotente por nombre, case-insensitive) y la grafia
    // guardada es la canonica.
    const rows = await registry.list();
    expect(rows.map((r) => r.name)).toEqual(['Luis']);
    expect(rows[0].voiceVector).toEqual(VOZ_MEDIDA);
    expect(rows[0].voiceAnchorVerified).toBe(true);
  });

  it('DETECTOR sin vector MEDIDO el puerto NO se invoca: un nombre sin vector es basura', async () => {
    let n = 0;
    const registry = createParticipantRegistry({
      db: mapDb(),
      config: CONFIG,
      newId: () => `s${++n}`,
      now: () => 1,
    });
    const port = vi.fn();
    registerSpeakerIdentity({
      name: 'Luis',
      // Sin clusters y sin medida del turno: no hay vector que guardar.
      clusters: [],
      refs: { registerParticipant: port },
    });
    expect(port, 'escribir solo el nombre envenenaba la base con un ancla sin evidencia').not.toHaveBeenCalled();
    expect(await registry.list()).toEqual([]);
  });

  it('P9.87: dos altas CONCURRENTES del mismo nombre no duplican (candado del registro)', async () => {
    let n = 0;
    const registry = createParticipantRegistry({
      db: mapDb(),
      config: CONFIG,
      newId: () => `r${++n}`,
      now: () => 1,
    });
    await Promise.all([
      registry.register({ name: 'Luis' }),
      registry.register({ name: 'Luis' }),
    ]);
    const rows = await registry.list();
    // UNA fila: la segunda alta devuelve la MISMA promesa en vuelo.
    expect(rows.map((r) => r.name)).toEqual(['Luis']);
  });
});
