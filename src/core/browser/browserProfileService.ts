// ============================================================
// Browser Profile Service — Punto 2: Navegador curado
// ------------------------------------------------------------
// Perfil por participante que define el comportamiento del
// Pizarrón-navegador curado: categorías curadas, sitios permitidos
// (allowlist), nivel de lectura, idioma, supervisión y tiles de inicio.
//
// Sigue el patrón de participantRegistry / communicationProfileService:
//   - Inyección de dependencias { db, config, now, newId }
//   - Obligación #7: tupla Sync en cada mutación
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode — catálogo y defaults desde config
// Resolución: manual (perfil guardado) > defaults por rol > default global.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type BrowserProfileRecord } from '../db/fluDatabase';
import { buildSyncTuple } from '../db/syncTuple';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// El tipo de registro proviene de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exporta aquí.
export type { BrowserProfileRecord } from '../db/fluDatabase';

export type BrowserReadingLevel = 'simple' | 'detallado' | 'avanzado';
export type BrowserLanguage = 'es' | 'en' | 'both';

export interface BrowserProfileInput {
  categories?: string[];
  allowlist?: string[];
  readingLevel?: BrowserReadingLevel;
  language?: BrowserLanguage;
  homeTiles?: string[];
}

export interface BrowserProfilePatch {
  categories?: string[];
  allowlist?: string[];
  readingLevel?: BrowserReadingLevel;
  language?: BrowserLanguage;
  homeTiles?: string[];
}

/** Defaults resolubles por rol (y default global). */
export interface RoleBrowserDefaults {
  categories: string[];
  allowlist: string[];
  readingLevel: BrowserReadingLevel;
  language: BrowserLanguage;
  homeTiles: string[];
}

export interface BrowserProfileConfig {
  /** Catálogo de categorías curadas: clave -> etiqueta legible. */
  categories: Record<string, string>;
  /** Niveles de lectura soportados (orden de UI). */
  readingLevels: readonly BrowserReadingLevel[];
  /** Idiomas soportados. */
  languages: readonly BrowserLanguage[];
  /** Esquema base (p.ej. 'https') para enlazar sitios de la allowlist. */
  allowlistScheme?: string;
  /** Perfil base global (fallback final). */
  defaultProfile: RoleBrowserDefaults;
  /** Defaults por rol sugerido (participante sin rol usa defaultProfile). */
  defaultsByRole: Record<string, RoleBrowserDefaults>;
  /** Textos de UI. */
  ui?: Record<string, string>;
  /** Alocuciones de voz. */
  voice?: Record<string, string>;
}

export interface BrowserProfilesDb {
  add(record: BrowserProfileRecord): Promise<unknown>;
  put(record: BrowserProfileRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<BrowserProfileRecord | undefined>;
  toArray(): Promise<BrowserProfileRecord[]>;
}

export interface BrowserProfileServiceOptions {
  db: BrowserProfilesDb;
  config: BrowserProfileConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

/** Perfil resuelto y listo para consumir (Pizarrón / voz). */
export interface ResolvedBrowserProfile extends RoleBrowserDefaults {
  participantId: string;
  participantName?: string;
  /** Origen de la resolución: perfil guardado > rol > default. */
  source: 'manual' | 'role' | 'default';
}

export interface SaveResult {
  ok: boolean;
  record?: BrowserProfileRecord;
  reason?: 'invalid-input' | 'not-found';
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createBrowserProfileService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: BrowserProfileServiceOptions) {
  const timestamp = (): number => now();

  const toRecord = (row: BrowserProfileRecord): BrowserProfileRecord => ({ ...row });

  const roleDefaults = (role?: string): RoleBrowserDefaults => {
    if (role && config.defaultsByRole[role]) return { ...config.defaultsByRole[role] };
    return { ...config.defaultProfile };
  };

  const ensure = async (
    participantId: string,
    participantName?: string,
    overrides: BrowserProfileInput = {},
    role?: string,
  ): Promise<SaveResult> => {
    if (!participantId) return { ok: false, reason: 'invalid-input' };
    const existing = await db.get(participantId);
    const previous = existing ? { ...existing } : null;
    const t = timestamp();
    // Al crear el registro, los escalares se siembran desde los defaults del
    // ROL (no del default global): así el primer edit manual de un Estudiante
    // conserva readingLevel simple. Las listas (categorías, allowlist,
    // homeTiles) quedan vacías y la resolución y el editor caen al rol vía su
    // fallback de array vacío.
    const defaults = roleDefaults(role);
    const record: BrowserProfileRecord = existing ?? {
      id: participantId,
      participantId,
      categories: [],
      allowlist: [],
      readingLevel: defaults.readingLevel,
      language: defaults.language,
      homeTiles: [],
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    const updated: BrowserProfileRecord = {
      ...record,
      participantName: participantName ?? record.participantName,
      categories: overrides.categories ?? record.categories,
      allowlist: overrides.allowlist ?? record.allowlist,
      readingLevel: overrides.readingLevel ?? record.readingLevel,
      language: overrides.language ?? record.language,
      homeTiles: overrides.homeTiles ?? record.homeTiles,
      updatedAt: t,
      sync: buildSyncTuple(existing?.sync, timestamp()),
    };
    await db.put(updated);
    await addAuditLog(
      existing ? 'browser.profile.save' : 'browser.profile.create',
      'browserProfile',
      participantId,
      previous,
      { ...updated },
      'browserProfileService',
    );
    return { ok: true, record: toRecord(updated) };
  };

  const update = async (participantId: string, patch: BrowserProfilePatch): Promise<SaveResult> => {
    if (!participantId || !patch) return { ok: false, reason: 'invalid-input' };
    const row = await db.get(participantId);
    if (!row) return { ok: false, reason: 'not-found' };
    const previous = { ...row };
    const updated: BrowserProfileRecord = {
      ...row,
      categories: patch.categories ?? row.categories,
      allowlist: patch.allowlist ?? row.allowlist,
      readingLevel: patch.readingLevel ?? row.readingLevel,
      language: patch.language ?? row.language,
      homeTiles: patch.homeTiles ?? row.homeTiles,
      updatedAt: timestamp(),
      sync: buildSyncTuple(row.sync, timestamp()),
    };
    await db.put(updated);
    await addAuditLog(
      'browser.profile.save',
      'browserProfile',
      participantId,
      previous,
      { ...updated },
      'browserProfileService',
    );
    return { ok: true, record: toRecord(updated) };
  };

  const reset = async (participantId: string): Promise<boolean> => {
    const row = await db.get(participantId);
    if (!row) return false;
    await db.delete(participantId);
    await addAuditLog('browser.profile.reset', 'browserProfile', participantId, row, null, 'browserProfileService');
    return true;
  };

  const getForParticipant = async (participantId: string): Promise<BrowserProfileRecord | undefined> => {
    if (!participantId) return undefined;
    const row = await db.get(participantId);
    return row ? toRecord(row) : undefined;
  };

  const list = async (): Promise<BrowserProfileRecord[]> => {
    const all = await db.toArray();
    return all
      .slice()
      .sort((a, b) => (a.participantName ?? a.id).localeCompare(b.participantName ?? b.id, 'es'))
      .map(toRecord);
  };

  const resolveForSession = async (
    participantId: string,
    opts: { role?: string; name?: string } = {},
  ): Promise<ResolvedBrowserProfile> => {
    const base = roleDefaults(opts.role);
    const row = participantId ? await db.get(participantId) : undefined;
    if (!row) {
      return {
        ...base,
        participantId,
        participantName: opts.name,
        source: opts.role && config.defaultsByRole[opts.role] ? 'role' : 'default',
      };
    }
    const merged: ResolvedBrowserProfile = {
      categories: row.categories && row.categories.length > 0 ? row.categories : base.categories,
      allowlist: row.allowlist && row.allowlist.length > 0 ? row.allowlist : base.allowlist,
      readingLevel: row.readingLevel ?? base.readingLevel,
      language: row.language ?? base.language,
      homeTiles: row.homeTiles && row.homeTiles.length > 0 ? row.homeTiles : base.homeTiles,
      participantId,
      participantName: row.participantName ?? opts.name,
      source: 'manual',
    };
    return merged;
  };

  return {
    ensure,
    update,
    reset,
    getForParticipant,
    list,
    resolveForSession,
  };
}

export type BrowserProfileService = ReturnType<typeof createBrowserProfileService>;
