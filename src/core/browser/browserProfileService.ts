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
import { buildSyncTuple, makeTupleTimestamp } from '../db/syncTuple';
import { copyRecord, getAliveRecord, listAliveRecords } from '../db/recordCopy';
import { createSoftDelete, SOFT_DELETE_FALSE_RESULT } from '../db/entityMutations';
import { INVALID_INPUT } from '../../lib/resultReasons';
import type { InvalidInput } from '../../lib/resultReasons';

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

/** Parche de perfil: misma forma que la entrada (dueño único). */
export type BrowserProfilePatch = BrowserProfileInput;

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
  reason?: InvalidInput | 'not-found';
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createBrowserProfileService({
  db,
  config,
  now = () => Date.now(),
  newId: _newId = uuidv4,
}: BrowserProfileServiceOptions) {
  const timestamp = makeTupleTimestamp(now);

  const roleDefaults = (role?: string): RoleBrowserDefaults => {
    if (role && config.defaultsByRole[role]) return { ...config.defaultsByRole[role] };
    return { ...config.defaultProfile };
  };

  /**
   * Persiste el perfil y asienta la auditoría.
   * Dueño único del cierre de guardado (put + log + copia).
   */
  const persistAndAudit = async (
    participantId: string,
    previous: BrowserProfileRecord | null,
    updated: BrowserProfileRecord,
    action: string,
  ): Promise<SaveResult> => {
    await db.put(updated);
    await addAuditLog(action, 'browserProfile', participantId, previous, { ...updated }, 'browserProfileService');
    return { ok: true, record: copyRecord(updated) };
  };

  /**
   * Aplica un parche de perfil manteniendo lo no provisto.
   * Dueño único del mapeo de campos que compartían ensure/update.
   */
  const applyProfilePatch = (
    record: BrowserProfileRecord,
    patch: BrowserProfileInput,
    at: number,
    // Sin default: `ensure` pasa `undefined` al crear y la tupla nace en 1.
    // Un default a `record.sync` la subiría a 2 en la creación.
    syncBase: BrowserProfileRecord['sync'] | undefined,
  ): BrowserProfileRecord => ({
    ...record,
    categories: patch.categories ?? record.categories,
    allowlist: patch.allowlist ?? record.allowlist,
    readingLevel: patch.readingLevel ?? record.readingLevel,
    language: patch.language ?? record.language,
    homeTiles: patch.homeTiles ?? record.homeTiles,
    updatedAt: at,
    sync: buildSyncTuple(syncBase, at),
  });

  const ensure = async (
    participantId: string,
    participantName?: string,
    overrides: BrowserProfileInput = {},
    role?: string,
  ): Promise<SaveResult> => {
    if (!participantId) return { ok: false, reason: INVALID_INPUT };
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
    const updated = applyProfilePatch(
      { ...record, participantName: participantName ?? record.participantName },
      overrides,
      t,
      existing?.sync,
    );
    return persistAndAudit(
      participantId,
      previous,
      updated,
      existing ? 'browser.profile.save' : 'browser.profile.create',
    );
  };

  const update = async (participantId: string, patch: BrowserProfilePatch): Promise<SaveResult> => {
    if (!participantId || !patch) return { ok: false, reason: INVALID_INPUT };
    const row = await db.get(participantId);
    if (!row) return { ok: false, reason: 'not-found' };
    const previous = { ...row };
    const updated = applyProfilePatch(row, patch, timestamp(), row.sync);
    return persistAndAudit(participantId, previous, updated, 'browser.profile.save');
  };
  const reset = createSoftDelete<BrowserProfileRecord, boolean>({
    table: db,
    now: timestamp,
    copy: copyRecord,
    audit: { action: 'browser.profile.reset', entity: 'browserProfile', source: 'browserProfileService' },
    ...SOFT_DELETE_FALSE_RESULT,
  });

  const getForParticipant = async (participantId: string): Promise<BrowserProfileRecord | undefined> =>
    getAliveRecord(db, participantId);

  const list = async (): Promise<BrowserProfileRecord[]> => {
    return (await listAliveRecords(db))
      .slice()
      .sort((a, b) => (a.participantName ?? a.id).localeCompare(b.participantName ?? b.id, 'es'))
      .map(copyRecord);
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
