// ============================================================
// Participant Registry — Multi-usuario (A3/A4/A5/B9)
// ------------------------------------------------------------
// Registro persistente de participantes del hogar/equipo con:
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; límites y voces desde config
// Cubre:
//   - A3: resolución de etiqueta de hablante → participante
//   - A4: perfil de asistente asignado al participante (profileId)
//   - A5: voz TTS personalizada por participante
//   - B9: cumpleaños (celebración y recordatorios anticipados)
// Inyección de dependencias: { db, config, now, newId }.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type ParticipantRecord, type SyncTuple } from '../db/fluDatabase';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// El tipo de registro proviene de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exporta aquí.
export type { ParticipantRecord } from '../db/fluDatabase';

export interface ParticipantInput {
  name: string;
  role?: string;
  birthday?: string;
  speakerLabel?: string;
  profileId?: string;
  ttsVoiceURI?: string;
  ttsVoiceName?: string;
  ttsRate?: number;
  ttsPitch?: number;
  participationStyle?: string;
}

export interface ParticipantPatch {
  name?: string;
  role?: string;
  birthday?: string;
  speakerLabel?: string;
  profileId?: string;
  ttsVoiceURI?: string;
  ttsVoiceName?: string;
  ttsRate?: number;
  ttsPitch?: number;
  participationStyle?: string;
}

export interface ResolvedTtsVoice {
  voiceURI: string;
  voiceName: string;
  rate: number;
  pitch: number;
  volume: number;
}

export interface ParticipantConfig {
  /** Roles sugeridos para la UI (el valor de rol es texto libre). */
  roles: readonly string[];
  /** Voz TTS base cuando el participante no tiene preferencia (A5). */
  defaultVoice: ResolvedTtsVoice;
  /** Días de antelación para recordar un cumpleaños (B9). */
  birthdayAdvanceDays: number;
  /**
   * Perfil anónimo por defecto (config-driven vía multiuser.skipDefaults).
   * Siempre existe desde el primer arranque, es el default activo y NO se
   * puede eliminar. `name`/`role` son la fuente de verdad para identificarlo.
   */
  anonymous?: { name: string; role: string };
}

export interface ParticipantsDb {
  add(record: ParticipantRecord): Promise<unknown>;
  put(record: ParticipantRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<ParticipantRecord | undefined>;
  toArray(): Promise<ParticipantRecord[]>;
}

export interface ParticipantRegistryOptions {
  db: ParticipantsDb;
  config: ParticipantConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface RegisterResult {
  ok: boolean;
  record?: ParticipantRecord;
  reason?: 'invalid-input' | 'duplicate';
}

export interface UpsertResult {
  ok: boolean;
  record?: ParticipantRecord;
  reason?: 'invalid-input' | 'not-found';
}

export interface NextBirthday {
  /** Próxima ocurrencia 'YYYY-MM-DD' (puede ser el año siguiente). */
  date: string;
  /** Días hasta la próxima ocurrencia (0 si es hoy). */
  daysUntil: number;
}

/**
 * Mapea la respuesta "¿Niño o adulto?" (capturada en onboarding) al rol de
 * participante (Estudiante/Familiar). Config-driven vía `multiuser.kindToRole`;
 * normaliza mayúsculas/acentos para aceptar voz y texto. Si no se reconoce,
 * devuelve undefined (el navegador cae al perfil por defecto).
 */
export function resolveKindRole(
  kind: string | undefined,
  kindToRole: Record<string, string> = {},
): string | undefined {
  if (!kind) return undefined;
  // Normaliza mayúsculas, espacios, acentos y duplicados para aceptar voz y texto.
  const normKey = (value: string): string =>
    String(value)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  // Limpia signos de puntuación finales que el ASR puede añadir ("adulto.", "niño?").
  const stripPunct = (value: string): string => value.replace(/[.,;:!?¿¡]+$/g, '').trim();
  // Raíz sin plural: quita una "s" final para aceptar "adultos"/"niños" por voz.
  const singular = (value: string): string =>
    value.length > 1 && value.endsWith('s') ? value.slice(0, -1) : value;

  const norm = normKey(kind);
  if (!norm) return undefined;
  const normStripped = stripPunct(norm);
  const normSingular = singular(normStripped);

  // Las claves del config pueden estar acentuadas ('niño') o no ('nino'):
  // se normalizan ambas partes para que coincidan siempre.
  for (const [key, role] of Object.entries(kindToRole)) {
    const keyNorm = normKey(key);
    // 1) Coincidencia exacta normalizada (texto o voz limpia).
    if (keyNorm === norm || keyNorm === normStripped || keyNorm === normSingular) {
      return role;
    }
    // 2) Frase hablada que contiene la palabra clave ("soy adulto", "yo soy niño").
    if (normStripped.split(' ').includes(keyNorm)) {
      return role;
    }
  }
  return undefined;
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createParticipantRegistry({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: ParticipantRegistryOptions) {
  const timestamp = (): number => now();

  const toRecord = (row: ParticipantRecord): ParticipantRecord => ({ ...row });

  const buildSync = (previous?: SyncTuple): SyncTuple => {
    if (!previous) return { revision: 1, updated_at: new Date(timestamp()).toISOString(), deleted: false };
    return {
      revision: previous.revision + 1,
      updated_at: new Date(timestamp()).toISOString(),
      deleted: previous.deleted,
    };
  };

  const normalizeName = (name: string): string =>
    (name || '').trim().replace(/\s+/g, ' ');

  const normalizeBirthday = (birthday?: string): string | undefined => {
    if (!birthday) return undefined;
    const value = birthday.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    return value;
  };

  const pad = (value: number): string => String(value).padStart(2, '0');

  const toDateKey = (value: number): string => {
    const d = new Date(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const register = async (input: ParticipantInput): Promise<RegisterResult> => {
    const name = normalizeName(input?.name);
    if (!name) return { ok: false, reason: 'invalid-input' };

    const all = await db.toArray();
    const duplicate = all.some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return { ok: false, reason: 'duplicate' };

    const id = newId();
    const t = timestamp();
    const record: ParticipantRecord = {
      id,
      name,
      role: input.role,
      birthday: normalizeBirthday(input.birthday),
      speakerLabel: input.speakerLabel,
      profileId: input.profileId,
      ttsVoiceURI: input.ttsVoiceURI,
      ttsVoiceName: input.ttsVoiceName,
      ttsRate: input.ttsRate,
      ttsPitch: input.ttsPitch,
      participationStyle: input.participationStyle,
      createdAt: t,
      updatedAt: t,
      sync: buildSync(),
    };
    await db.add(record);
    await addAuditLog('participant.register', 'participant', id, null, { name: record.name }, 'participantRegistry');
    return { ok: true, record };
  };

  // Identifica el perfil anónimo por defecto (config-driven). Devuelve el
  // registro si existe; si no, undefined. Es la fuente de verdad para saber
  // qué participante es el "Anónimo Estudiante" no eliminable.
  const findAnonymous = async (): Promise<ParticipantRecord | undefined> => {
    const anon = config.anonymous;
    if (!anon?.name) return undefined;
    const needle = anon.name.toLowerCase();
    const all = await db.toArray();
    const found = all.find((p) => p.name.toLowerCase() === needle);
    return found ? toRecord(found) : undefined;
  };

  // Siembra el perfil anónimo por defecto si aún no existe. Idempotente:
  // se llama en cada arranque para garantizar que "Anónimo Estudiante"
  // siempre esté presente (default activo, no eliminable).
  const seedAnonymous = async (): Promise<ParticipantRecord | undefined> => {
    const anon = config.anonymous;
    if (!anon?.name) return undefined;
    const existing = await findAnonymous();
    if (existing) {
      // Auto-reparación: si el Anónimo preexistente quedó sin rol (creado por
      // versiones anteriores de skip()), se le asigna el rol por defecto para
      // que siempre figure como "Estudiante" y no como perfil vacío.
      if (!existing.role || existing.role !== anon.role) {
        const repaired = await upsert(existing.id, { role: anon.role });
        if (repaired.ok && repaired.record) return repaired.record;
      }
      return existing;
    }
    const id = newId();
    const t = timestamp();
    const record: ParticipantRecord = {
      id,
      name: anon.name,
      role: anon.role,
      createdAt: t,
      updatedAt: t,
      sync: buildSync(),
    };
    await db.add(record);
    await addAuditLog('participant.seed-anonymous', 'participant', id, null, { name: record.name }, 'participantRegistry');
    return toRecord(record);
  };

  const upsert = async (id: string, patch: ParticipantPatch): Promise<UpsertResult> => {
    if (!id || !patch) return { ok: false, reason: 'invalid-input' };
    const row = await db.get(id);
    if (!row) return { ok: false, reason: 'not-found' };

    const name = patch.name === undefined ? row.name : normalizeName(patch.name);
    if (!name) return { ok: false, reason: 'invalid-input' };

    const previous = { ...row };
    const updated: ParticipantRecord = {
      ...row,
      name,
      role: patch.role === undefined ? row.role : patch.role,
      birthday: patch.birthday === undefined ? row.birthday : normalizeBirthday(patch.birthday),
      speakerLabel: patch.speakerLabel === undefined ? row.speakerLabel : patch.speakerLabel,
      profileId: patch.profileId === undefined ? row.profileId : patch.profileId,
      ttsVoiceURI: patch.ttsVoiceURI === undefined ? row.ttsVoiceURI : patch.ttsVoiceURI,
      ttsVoiceName: patch.ttsVoiceName === undefined ? row.ttsVoiceName : patch.ttsVoiceName,
      ttsRate: patch.ttsRate === undefined ? row.ttsRate : patch.ttsRate,
      ttsPitch: patch.ttsPitch === undefined ? row.ttsPitch : patch.ttsPitch,
      participationStyle: patch.participationStyle === undefined ? row.participationStyle : patch.participationStyle,
      updatedAt: timestamp(),
      sync: buildSync(row.sync),
    };
    await db.put(updated);
    await addAuditLog('participant.update', 'participant', id, previous, { name: updated.name }, 'participantRegistry');
    return { ok: true, record: toRecord(updated) };
  };

  const get = async (id: string): Promise<ParticipantRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.get(id);
    return row ? toRecord(row) : undefined;
  };

  const list = async (): Promise<ParticipantRecord[]> => {
    const all = await db.toArray();
    return all
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map(toRecord);
  };

  const remove = async (id: string): Promise<boolean> => {
    const row = await db.get(id);
    if (!row) return false;
    // El perfil anónimo por defecto NO se puede eliminar: es el default
    // activo y la red de seguridad del dispositivo compartido.
    const anon = config.anonymous;
    if (anon?.name && row.name.toLowerCase() === anon.name.toLowerCase()) return false;
    await db.delete(id);
    await addAuditLog('participant.remove', 'participant', id, row, null, 'participantRegistry');
    return true;
  };

  // A3: etiqueta de hablante de la diarización → participante.
  const resolveParticipantBySpeakerLabel = async (
    speakerLabel?: string,
  ): Promise<ParticipantRecord | undefined> => {
    if (!speakerLabel || !speakerLabel.trim()) return undefined;
    const needle = speakerLabel.trim().toLowerCase();
    const all = await db.toArray();
    const found = all.find(
      (p) => p.speakerLabel && p.speakerLabel.trim().toLowerCase() === needle,
    );
    return found ? toRecord(found) : undefined;
  };

  // B9: participantes cuyo cumpleaños cae en la fecha indicada (MM-DD).
  const participantsWithBirthdayOn = async (date?: string): Promise<ParticipantRecord[]> => {
    const reference = date || toDateKey(timestamp());
    const key = reference.length >= 5 ? reference.slice(5) : '';
    const all = await db.toArray();
    return all
      .filter((p) => p.birthday && p.birthday.slice(5) === key)
      .map(toRecord);
  };

  // B9: próxima ocurrencia del cumpleaños respecto a una referencia.
  const nextBirthday = (birthday?: string, reference?: number): NextBirthday | undefined => {
    if (!birthday) return undefined;
    const parts = birthday.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return undefined;
    const [birthYear, birthMonth, birthDay] = parts;
    if (birthYear < 1900 || birthYear > 2100 || birthMonth < 1 || birthMonth > 12 || birthDay < 1 || birthDay > 31) {
      return undefined;
    }

    const today = new Date(reference ?? timestamp());
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    let candidate = new Date(today.getFullYear(), birthMonth - 1, birthDay).getTime();
    if (candidate < todayMs) {
      candidate = new Date(today.getFullYear() + 1, birthMonth - 1, birthDay).getTime();
    }
    const daysUntil = Math.round((candidate - todayMs) / (24 * 60 * 60 * 1000));
    return { date: toDateKey(candidate), daysUntil };
  };

  // B9: participantes cuyo próximo cumpleaños ocurre dentro de la antelación configurada.
  const participantsWithBirthdayNear = async (reference?: number): Promise<ParticipantRecord[]> => {
    const all = await db.toArray();
    const results: ParticipantRecord[] = [];
    for (const p of all) {
      const next = nextBirthday(p.birthday, reference);
      if (next && next.daysUntil <= config.birthdayAdvanceDays) results.push(toRecord(p));
    }
    return results;
  };

  // A5: voz TTS resuelta (base del config + preferencias del participante).
  const resolveTtsVoice = (participant?: ParticipantRecord): ResolvedTtsVoice => {
    const base = config.defaultVoice;
    if (!participant) return { ...base };
    return {
      voiceURI: participant.ttsVoiceURI ?? base.voiceURI,
      voiceName: participant.ttsVoiceName ?? base.voiceName,
      rate: typeof participant.ttsRate === 'number' ? participant.ttsRate : base.rate,
      pitch: typeof participant.ttsPitch === 'number' ? participant.ttsPitch : base.pitch,
      volume: base.volume,
    };
  };

  return {
    register,
    upsert,
    get,
    list,
    remove,
    seedAnonymous,
    findAnonymous,
    resolveParticipantBySpeakerLabel,
    participantsWithBirthdayOn,
    participantsWithBirthdayNear,
    nextBirthday,
    resolveTtsVoice,
  };
}

export type ParticipantRegistry = ReturnType<typeof createParticipantRegistry>;
