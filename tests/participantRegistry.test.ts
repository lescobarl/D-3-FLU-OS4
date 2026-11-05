// ============================================================
// participantRegistry — registro multi-usuario (A3/A4/A5/B9)
// ------------------------------------------------------------
// Cubre el servicio de participantes con una base en memoria
// (misma interfaz ParticipantsDb), reloj y newId inyectables.
// Regla #1: sin hardcode; límites y voces desde config.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type ParticipantRecord } from '../src/core/db/fluDatabase';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import {
  createParticipantRegistry,
  resolveKindRole,
  type ParticipantConfig,
  type ParticipantsDb,
} from '../src/core/multiuser/participantRegistry';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const CONFIG: ParticipantConfig = {
  roles: ['Familiar', 'Amigo', 'Estudiante', 'Colega', 'Otro'],
  defaultVoice: { voiceURI: '', voiceName: 'Voz por defecto', rate: 1.0, pitch: 1.0, volume: 1.0 },
  birthdayAdvanceDays: 7,
};

// Mapa "¿Niño o adulto?" → rol, tomado del config real (sin hardcode).
const KIND_TO_ROLE: Record<string, string> = (FLU_CONFIG as any).multiuser?.kindToRole || {};

let idCounter = 0;

function createMapDb(initial: ParticipantRecord[] = []): ParticipantsDb {
  const map = new Map<string, ParticipantRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: ParticipantRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: ParticipantRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<ParticipantRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<ParticipantRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function createService(db: ParticipantsDb) {
  return createParticipantRegistry({
    db,
    config: CONFIG,
    now,
    newId: () => `par-${++idCounter}`,
  });
}

let db: ParticipantsDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('participantRegistry — registro (A3/A4/A5)', () => {
  it('register crea un registro completo, lo persiste y audita', async () => {
    const service = createService(db);
    const result = await service.register({
      name: '  Mamá  ',
      role: 'Familiar',
      birthday: '1985-05-10',
      speakerLabel: 'HABLANTE_1',
      profileId: 'perfil-familiar',
      ttsVoiceURI: 'voice://mama',
      ttsVoiceName: 'Mamá ES',
      ttsRate: 1.1,
      ttsPitch: 1.05,
      participationStyle: 'colaborativa',
    });
    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('par-1');
    expect(record.name).toBe('Mamá');
    expect(record.role).toBe('Familiar');
    expect(record.birthday).toBe('1985-05-10');
    expect(record.speakerLabel).toBe('HABLANTE_1');
    expect(record.profileId).toBe('perfil-familiar');
    expect(record.ttsVoiceURI).toBe('voice://mama');
    expect(record.ttsVoiceName).toBe('Mamá ES');
    expect(record.ttsRate).toBe(1.1);
    expect(record.ttsPitch).toBe(1.05);
    expect(record.participationStyle).toBe('colaborativa');
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.sync).toEqual({
      revision: 1,
      updated_at: new Date(NOW).toISOString(),
      deleted: false,
    });
    expect(await db.get('par-1')).toBeDefined();
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'participant.register', 'participant', 'par-1', null, { name: 'Mamá' }, 'participantRegistry',
    );
  });

  it('register normaliza espacios del nombre y rechaza vacío sin auditar', async () => {
    const service = createService(db);
    const ok = await service.register({ name: '  María   Luisa ' });
    expect(ok.ok).toBe(true);
    expect(ok.record?.name).toBe('María Luisa');

    const empty = await service.register({ name: '   ' });
    expect(empty).toEqual({ ok: false, reason: 'invalid-input' });
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
  });

  it('register normaliza o descarta el cumpleaños inválido', async () => {
    const service = createService(db);
    const invalid = await service.register({ name: 'Papá', birthday: '10-05-1980' });
    expect(invalid.ok).toBe(true);
    expect(invalid.record?.birthday).toBeUndefined();

    const valid = await service.register({ name: 'Abuela', birthday: ' 1985-01-02 ' });
    expect(valid.ok).toBe(true);
    expect(valid.record?.birthday).toBe('1985-01-02');
  });

  it('register rechaza duplicados sin distinguir mayúsculas', async () => {
    const service = createService(db);
    await service.register({ name: 'Ana' });
    const dup = await service.register({ name: '  ANA ' });
    expect(dup).toEqual({ ok: false, reason: 'duplicate' });
    expect(await db.toArray()).toHaveLength(1);
  });
});

describe('participantRegistry — consultas y resolución (A3)', () => {
  it('list ordena por nombre con locale es', async () => {
    const service = createService(db);
    await service.register({ name: 'Zoe' });
    await service.register({ name: 'Luis' });
    await service.register({ name: 'Ana' });
    const list = await service.list();
    expect(list.map((p) => p.name)).toEqual(['Ana', 'Luis', 'Zoe']);
  });

  it('get devuelve una copia y undefined para ids vacíos o inexistentes', async () => {
    const service = createService(db);
    const added = (await service.register({ name: 'Mamá' })).record!;
    const found = await service.get(added.id);
    expect(found?.name).toBe('Mamá');
    found!.name = 'MODIFICADO';
    expect((await db.get(added.id))?.name).toBe('Mamá');
    expect(await service.get('')).toBeUndefined();
    expect(await service.get('nope')).toBeUndefined();
  });

  it('resolveParticipantBySpeakerLabel ignora espacios y mayúsculas', async () => {
    const service = createService(db);
    await service.register({ name: 'Mamá', speakerLabel: 'HABLANTE_1' });
    expect((await service.resolveParticipantBySpeakerLabel('  hablante_1 '))?.name).toBe('Mamá');
    expect(await service.resolveParticipantBySpeakerLabel('')).toBeUndefined();
    expect(await service.resolveParticipantBySpeakerLabel('   ')).toBeUndefined();
    expect(await service.resolveParticipantBySpeakerLabel(undefined)).toBeUndefined();
    expect(await service.resolveParticipantBySpeakerLabel('hablante_2')).toBeUndefined();
  });
});

describe('participantRegistry — actualización y borrado', () => {
  it('upsert fusiona el patch, conserva el resto y audita con el previo', async () => {
    const service = createService(db);
    const added = (await service.register({ name: 'Mamá', role: 'Familiar', birthday: '1985-05-10' })).record!;
    const updated = await service.upsert(added.id, { name: 'Papá' });
    expect(updated.ok).toBe(true);
    expect(updated.record?.name).toBe('Papá');
    expect(updated.record?.role).toBe('Familiar');
    expect(updated.record?.birthday).toBe('1985-05-10');
    expect(updated.record?.sync.revision).toBe(2);
    expect(updated.record?.updatedAt).toBe(NOW);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'participant.update', 'participant', added.id, added, { name: 'Papá' }, 'participantRegistry',
    );
  });

  it('upsert valida id, existencia y nombre', async () => {
    const service = createService(db);
    expect(await service.upsert('', { name: 'X' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.upsert('nope', { name: 'X' })).toEqual({ ok: false, reason: 'not-found' });
    const added = (await service.register({ name: 'Mamá' })).record!;
    expect(await service.upsert(added.id, { name: '   ' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect((await db.get(added.id))?.name).toBe('Mamá');
  });

  it('remove borra, devuelve true y audita con el registro previo', async () => {
    const service = createService(db);
    const added = (await service.register({ name: 'Mamá' })).record!;
    const removed = await service.remove(added.id);
    expect(removed).toBe(true);
    const row = await db.get(added.id);
    expect(row?.sync.deleted).toBe(true);
    expect(await service.get(added.id)).toBeUndefined();
    expect(await service.list()).toHaveLength(0);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'participant.remove', 'participant', added.id, added,
      expect.objectContaining({ sync: expect.objectContaining({ deleted: true }) }),
      'participantRegistry',
    );
  });

  it('remove de un id inexistente devuelve false sin auditar', async () => {
    const service = createService(db);
    expect(await service.remove('nope')).toBe(false);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });
});

describe('participantRegistry — cumpleaños (B9)', () => {
  it('participantsWithBirthdayOn filtra por MM-DD', async () => {
    const service = createService(db);
    await service.register({ name: 'Ana', birthday: '1990-05-10' });
    await service.register({ name: 'Luis', birthday: '1985-05-10' });
    await service.register({ name: 'Zoe', birthday: '1995-03-01' });

    const onDate = await service.participantsWithBirthdayOn('2026-05-10');
    expect(onDate.map((p) => p.name).sort()).toEqual(['Ana', 'Luis']);
    expect((await service.participantsWithBirthdayOn('2026-03-01')).map((p) => p.name)).toEqual(['Zoe']);
    expect(await service.participantsWithBirthdayOn('2026-12-31')).toHaveLength(0);
  });

  it('nextBirthday calcula la próxima ocurrencia respecto a la referencia', () => {
    const service = createService(db);
    expect(service.nextBirthday(undefined)).toBeUndefined();
    expect(service.nextBirthday('abc')).toBeUndefined();
    expect(service.nextBirthday('1899-01-01')).toBeUndefined();
    expect(service.nextBirthday('2026-01-15', NOW)).toEqual({ date: '2026-01-15', daysUntil: 0 });
    expect(service.nextBirthday('2026-01-20', NOW)).toEqual({ date: '2026-01-20', daysUntil: 5 });
    expect(service.nextBirthday('1990-01-05', NOW)).toEqual({ date: '2027-01-05', daysUntil: 355 });
  });

  it('participantsWithBirthdayNear devuelve los del margen configurado en orden de inserción', async () => {
    const service = createService(db);
    await service.register({ name: 'Hoy', birthday: '2026-01-15' });
    await service.register({ name: 'Cerca', birthday: '2026-01-20' });
    await service.register({ name: 'Borde', birthday: '2026-01-22' });
    await service.register({ name: 'Fuera', birthday: '2026-01-23' });
    await service.register({ name: 'Anio', birthday: '1990-01-05' });

    const near = await service.participantsWithBirthdayNear(NOW);
    expect(near.map((p) => p.name)).toEqual(['Hoy', 'Cerca', 'Borde']);
  });
});

describe('participantRegistry — voz TTS (A5)', () => {
  it('resolveTtsVoice usa la voz base sin participante', () => {
    const service = createService(db);
    expect(service.resolveTtsVoice()).toEqual(CONFIG.defaultVoice);
    expect(service.resolveTtsVoice(undefined)).toEqual(CONFIG.defaultVoice);
  });

  it('resolveTtsVoice combina base y preferencias del participante', async () => {
    const service = createService(db);
    const added = (await service.register({
      name: 'Mamá',
      ttsVoiceURI: 'voice://mama',
      ttsVoiceName: 'Mamá ES',
      ttsRate: 1.5,
      ttsPitch: 1.2,
    })).record!;
    const voice = service.resolveTtsVoice(added);
    expect(voice).toEqual({
      voiceURI: 'voice://mama',
      voiceName: 'Mamá ES',
      rate: 1.5,
      pitch: 1.2,
      volume: CONFIG.defaultVoice.volume,
    });
  });

  it('resolveTtsVoice conserva la base para campos ausentes', async () => {
    const service = createService(db);
    const added = (await service.register({ name: 'Luis', ttsRate: 1.25 })).record!;
    const voice = service.resolveTtsVoice(added);
    expect(voice.voiceURI).toBe(CONFIG.defaultVoice.voiceURI);
    expect(voice.voiceName).toBe(CONFIG.defaultVoice.voiceName);
    expect(voice.rate).toBe(1.25);
    expect(voice.pitch).toBe(CONFIG.defaultVoice.pitch);
    expect(voice.volume).toBe(CONFIG.defaultVoice.volume);
  });
});

describe('participantRegistry — resolveKindRole (niño/adulto → rol)', () => {
  it('mapea niño/niña y variantes sin acento a Estudiante', () => {
    expect(resolveKindRole('niño', KIND_TO_ROLE)).toBe('Estudiante');
    expect(resolveKindRole('niña', KIND_TO_ROLE)).toBe('Estudiante');
    expect(resolveKindRole('nino', KIND_TO_ROLE)).toBe('Estudiante');
  });

  it('mapea adulto/adulta/adult a Familiar', () => {
    expect(resolveKindRole('adulto', KIND_TO_ROLE)).toBe('Familiar');
    expect(resolveKindRole('adulta', KIND_TO_ROLE)).toBe('Familiar');
    expect(resolveKindRole('adult', KIND_TO_ROLE)).toBe('Familiar');
  });

  it('normaliza mayúsculas, espacios y acentos antes de resolver', () => {
    expect(resolveKindRole('  Niño  ', KIND_TO_ROLE)).toBe('Estudiante');
    expect(resolveKindRole('ADULTO', KIND_TO_ROLE)).toBe('Familiar');
  });

  it('devuelve undefined para respuestas desconocidas o vacías', () => {
    expect(resolveKindRole('robot', KIND_TO_ROLE)).toBeUndefined();
    expect(resolveKindRole(undefined, KIND_TO_ROLE)).toBeUndefined();
    expect(resolveKindRole('', KIND_TO_ROLE)).toBeUndefined();
    expect(resolveKindRole('   ', KIND_TO_ROLE)).toBeUndefined();
  });

  it('tolera puntuación final que el ASR puede añadir', () => {
    expect(resolveKindRole('adulto.', KIND_TO_ROLE)).toBe('Familiar');
    expect(resolveKindRole('adulto,', KIND_TO_ROLE)).toBe('Familiar');
    expect(resolveKindRole('niño?', KIND_TO_ROLE)).toBe('Estudiante');
    expect(resolveKindRole('adulto!', KIND_TO_ROLE)).toBe('Familiar');
  });

  it('tolera plurales hablados (adultos/niños)', () => {
    expect(resolveKindRole('adultos', KIND_TO_ROLE)).toBe('Familiar');
    expect(resolveKindRole('niños', KIND_TO_ROLE)).toBe('Estudiante');
  });

  it('tolera frases habladas que contienen la palabra clave', () => {
    expect(resolveKindRole('soy adulto', KIND_TO_ROLE)).toBe('Familiar');
    expect(resolveKindRole('yo soy niño', KIND_TO_ROLE)).toBe('Estudiante');
    expect(resolveKindRole('soy adulta', KIND_TO_ROLE)).toBe('Familiar');
  });
});

describe('participantRegistry — seedAnonymous (Anónimo Estudiante por defecto)', () => {
  const ANON_CONFIG: ParticipantConfig = {
    ...CONFIG,
    anonymous: { name: 'Anónimo', role: 'Estudiante' },
  };

  function createAnonService(db: ParticipantsDb) {
    return createParticipantRegistry({
      db,
      config: ANON_CONFIG,
      now,
      newId: () => `par-${++idCounter}`,
    });
  }

  it('siembra el Anónimo con el rol por defecto si no existe', async () => {
    const service = createAnonService(db);
    const seeded = await service.seedAnonymous();
    expect(seeded).toBeDefined();
    expect(seeded?.name).toBe('Anónimo');
    expect(seeded?.role).toBe('Estudiante');
    const all = await service.list();
    expect(all).toHaveLength(1);
  });

  it('es idempotente: no duplica si ya existe', async () => {
    const service = createAnonService(db);
    await service.seedAnonymous();
    await service.seedAnonymous();
    const all = await service.list();
    expect(all).toHaveLength(1);
  });

  it('es seguro ante llamadas concurrentes (StrictMode): no duplica', async () => {
    // React.StrictMode dispara el efecto de siembra dos veces en paralelo en
    // desarrollo. Sin el candado, ambas pasan findAnonymous antes de hacer
    // add() y se crean DOS "Anónimo Estudiante".
    const service = createAnonService(db);
    const [a, b] = await Promise.all([service.seedAnonymous(), service.seedAnonymous()]);
    expect(a?.id).toBe(b?.id);
    const all = await service.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Anónimo');
    expect(all[0].role).toBe('Estudiante');
  });

  it('reconcilia duplicados preexistentes dejando un único Anónimo', async () => {
    // Simula el estado corrupto que ya quedó en el dispositivo: dos registros
    // "Anónimo" creados por una carrera previa.
    const dup1: ParticipantRecord = {
      id: 'par-dup1',
      name: 'Anónimo',
      role: 'Estudiante',
      createdAt: NOW,
      updatedAt: NOW,
      sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    };
    const dup2: ParticipantRecord = {
      id: 'par-dup2',
      name: 'Anónimo',
      role: 'Estudiante',
      createdAt: NOW + 1000,
      updatedAt: NOW + 1000,
      sync: { revision: 1, updated_at: new Date(NOW + 1000).toISOString(), deleted: false },
    };
    db = createMapDb([dup1, dup2]);
    const service = createAnonService(db);
    const seeded = await service.seedAnonymous();
    // Conserva el más antiguo (par-dup1) y elimina el duplicado.
    expect(seeded?.id).toBe('par-dup1');
    const all = await service.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('par-dup1');
  });

  it('repara un Anónimo preexistente sin rol (creado por versiones antiguas)', async () => {
    // Simula el registro viejo de skip(): nombre "Anónimo" pero sin rol.
    const legacy: ParticipantRecord = {
      id: 'par-legacy',
      name: 'Anónimo',
      role: undefined,
      createdAt: NOW,
      updatedAt: NOW,
      sync: { revision: 0, updated_at: new Date(NOW).toISOString(), deleted: false },
    };
    db = createMapDb([legacy]);
    const service = createAnonService(db);
    const seeded = await service.seedAnonymous();
    expect(seeded?.id).toBe('par-legacy');
    expect(seeded?.role).toBe('Estudiante');
    const all = await service.list();
    expect(all).toHaveLength(1);
    expect(all[0].role).toBe('Estudiante');
  });

  it('repara un Anónimo preexistente con rol incorrecto', async () => {
    const wrong: ParticipantRecord = {
      id: 'par-wrong',
      name: 'Anónimo',
      role: 'Familiar',
      createdAt: NOW,
      updatedAt: NOW,
      sync: { revision: 0, updated_at: new Date(NOW).toISOString(), deleted: false },
    };
    db = createMapDb([wrong]);
    const service = createAnonService(db);
    const seeded = await service.seedAnonymous();
    expect(seeded?.role).toBe('Estudiante');
  });
});
