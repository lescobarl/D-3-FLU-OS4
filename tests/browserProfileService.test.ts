// ============================================================
// browserProfileService.test.ts — Punto 2: Navegador curado
// ------------------------------------------------------------
// Tests del servicio de perfil del navegador curado con DI.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserProfileRecord } from '../src/core/db/fluDatabase';

const { addAuditLog } = vi.hoisted(() => ({ addAuditLog: vi.fn() }));

vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return {
    ...actual,
    addAuditLog,
  };
});

import {
  createBrowserProfileService,
  type BrowserProfileConfig,
  type BrowserProfilesDb,
} from '../src/core/browser/browserProfileService';
import {
  BUILTIN_SEARCH_SITES,
  deriveAllowlist,
  deriveTiles,
  type SearchSite,
} from '../src/core/search/searchSiteTypes';

const CONFIG: BrowserProfileConfig = {
  categories: {
    educacion: 'Educación',
    cuentos: 'Cuentos',
    juegos: 'Juegos',
    musica: 'Música',
  },
  readingLevels: ['simple', 'detallado', 'avanzado'],
  languages: ['es', 'en', 'both'],
  defaultProfile: {
    categories: ['educacion', 'cuentos'],
    allowlist: ['wikipedia.org', 'educ.ar'],
    readingLevel: 'detallado',
    language: 'es',
    homeTiles: ['educacion', 'cuentos'],
  },
  defaultsByRole: {
    Estudiante: {
      categories: ['educacion', 'cuentos', 'juegos'],
      allowlist: ['wikipedia.org', 'educ.ar'],
      readingLevel: 'simple',
      language: 'es',
      homeTiles: ['educacion', 'cuentos', 'juegos'],
    },
    Familiar: {
      categories: ['educacion', 'cuentos', 'juegos', 'musica'],
      allowlist: ['wikipedia.org', 'educ.ar', 'youtube.com'],
      readingLevel: 'detallado',
      language: 'es',
      homeTiles: ['educacion', 'cuentos', 'juegos', 'musica'],
    },
  },
};

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

function makeRecord(overrides: Partial<BrowserProfileRecord> = {}): BrowserProfileRecord {
  return {
    id: 'hijo-1',
    participantId: 'hijo-1',
    participantName: 'Hijo',
    categories: ['educacion', 'cuentos'],
    allowlist: ['wikipedia.org', 'educ.ar'],
    readingLevel: 'simple',
    language: 'es',
    homeTiles: ['educacion', 'cuentos'],
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

function createMapDb(initial: BrowserProfileRecord[] = []): BrowserProfilesDb {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  return {
    async add(record: BrowserProfileRecord): Promise<unknown> {
      rows.set(record.id, { ...record });
      return record.id;
    },
    async put(record: BrowserProfileRecord): Promise<unknown> {
      rows.set(record.id, { ...record });
      return record.id;
    },
    async get(id: string): Promise<BrowserProfileRecord | undefined> {
      const row = rows.get(id);
      return row ? { ...row } : undefined;
    },
    async toArray(): Promise<BrowserProfileRecord[]> {
      return Array.from(rows.values()).map((r) => ({ ...r }));
    },
  };
}

function createService(db: BrowserProfilesDb, config: BrowserProfileConfig = CONFIG) {
  return createBrowserProfileService({ db, config, now: () => NOW, newId: () => 'id-1' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('browserProfileService — resolveForSession (manual > rol > default)', () => {
  it('sin registro devuelve el default global sin persistir', async () => {
    const db = createMapDb();
    const service = createService(db);
    const resolved = await service.resolveForSession('papa-1', { name: 'Papá' });
    expect(resolved).toMatchObject({
      participantId: 'papa-1',
      participantName: 'Papá',
      source: 'default',
      categories: ['educacion', 'cuentos'],
    });
    expect(await db.toArray()).toHaveLength(0);
  });

  it('sin registro aplica los defaults por rol', async () => {
    const db = createMapDb();
    const service = createService(db);
    const resolved = await service.resolveForSession('hijo-1', { role: 'Estudiante', name: 'Hijo' });
    expect(resolved).toMatchObject({
      source: 'role',
      readingLevel: 'simple',
    });
    expect(resolved.categories).toEqual(['educacion', 'cuentos', 'juegos']);
  });

  it('con registro manual prioriza el perfil guardado', async () => {
    const db = createMapDb([makeRecord()]);
    const service = createService(db);
    const resolved = await service.resolveForSession('hijo-1', { role: 'Estudiante', name: 'Hijo' });
    expect(resolved).toMatchObject({
      source: 'manual',
      participantName: 'Hijo',
    });
    expect(resolved.categories).toEqual(['educacion', 'cuentos']);
  });

  it('con registro manual incompleto cae al rol para los campos vacíos', async () => {
    const db = createMapDb([makeRecord({ allowlist: [], homeTiles: [] })]);
    const service = createService(db);
    const resolved = await service.resolveForSession('hijo-1', { role: 'Estudiante' });
    expect(resolved.allowlist).toEqual(['wikipedia.org', 'educ.ar']);
    expect(resolved.homeTiles).toEqual(['educacion', 'cuentos', 'juegos']);
    expect(resolved.source).toBe('manual');
  });
});

describe('browserProfileService — ensure', () => {
  it('crea un registro por defecto, lo persiste y audita', async () => {
    const db = createMapDb();
    const service = createService(db);
    const result = await service.ensure('papa-1', 'Papá');
    expect(result.ok).toBe(true);
    expect(result.record?.id).toBe('papa-1');
    expect(result.record?.readingLevel).toBe('detallado');
    expect(result.record?.sync).toEqual({
      revision: 1,
      updated_at: new Date(NOW).toISOString(),
      deleted: false,
    });
    expect(addAuditLog).toHaveBeenCalledWith(
      'browser.profile.create',
      'browserProfile',
      'papa-1',
      null,
      expect.objectContaining({ participantId: 'papa-1', readingLevel: 'detallado' }),
      'browserProfileService',
    );
  });

  it('ensure sobre un registro existente sube la revisión sync y audita save', async () => {
    const db = createMapDb([makeRecord()]);
    const service = createService(db);
    const result = await service.ensure('hijo-1', 'Hijo', { readingLevel: 'detallado' });
    expect(result.ok).toBe(true);
    expect(result.record?.readingLevel).toBe('detallado');
    expect(result.record?.sync?.revision).toBe(2);
    expect(addAuditLog).toHaveBeenCalledWith(
      'browser.profile.save',
      'browserProfile',
      'hijo-1',
      expect.objectContaining({ id: 'hijo-1' }),
      expect.objectContaining({ readingLevel: 'detallado' }),
      'browserProfileService',
    );
  });

  it('ensure rechaza participante inválido sin persistir ni auditar', async () => {
    const db = createMapDb();
    const service = createService(db);
    const result = await service.ensure('');
    expect(result).toEqual({ ok: false, reason: 'invalid-input' });
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('ensure con rol siembra los escalares desde los defaults por rol', async () => {
    const db = createMapDb();
    const service = createService(db);
    // Primer edit manual de un Estudiante: solo se tocan categorías.
    const result = await service.ensure(
      'hijo-1',
      'Hijo',
      { categories: ['educacion', 'juegos'] },
      'Estudiante',
    );
    expect(result.ok).toBe(true);
    // Los escalares conservan el rol (no caen al default global).
    expect(result.record?.readingLevel).toBe('simple');
    expect(result.record?.language).toBe('es');
    // El campo editado gana y las listas no tocadas quedan vacías (fallback de rol).
    expect(result.record?.categories).toEqual(['educacion', 'juegos']);
    expect(result.record?.allowlist).toEqual([]);
    expect(result.record?.sync?.revision).toBe(1);
  });
});

describe('browserProfileService — update', () => {
  it('actualiza campos, sube la revisión y audita', async () => {
    const db = createMapDb([makeRecord()]);
    const service = createService(db);
    const result = await service.update('hijo-1', { readingLevel: 'detallado' });
    expect(result.ok).toBe(true);
    expect(result.record?.readingLevel).toBe('detallado');
    expect(result.record?.sync?.revision).toBe(2);
    expect(addAuditLog).toHaveBeenCalledWith(
      'browser.profile.save',
      'browserProfile',
      'hijo-1',
      expect.objectContaining({ readingLevel: 'simple' }),
      expect.objectContaining({ readingLevel: 'detallado' }),
      'browserProfileService',
    );
  });

  it('update rechaza id inválido o inexistente sin auditar', async () => {
    const db = createMapDb();
    const service = createService(db);
    expect(await service.update('', {})).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.update('x', {})).toEqual({ ok: false, reason: 'not-found' });
    expect(addAuditLog).not.toHaveBeenCalled();
  });
});

describe('browserProfileService — reset, get y list', () => {
  it('reset borra, audita con el previo y devuelve ok', async () => {
    const db = createMapDb([makeRecord()]);
    const service = createService(db);
    expect(await service.reset('hijo-1')).toBe(true);
    const rows = await db.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].sync?.deleted).toBe(true);
    expect(await service.getForParticipant('hijo-1')).toBeUndefined();
    expect(addAuditLog).toHaveBeenCalledWith(
      'browser.profile.reset',
      'browserProfile',
      'hijo-1',
      expect.objectContaining({ id: 'hijo-1' }),
      expect.objectContaining({ sync: expect.objectContaining({ deleted: true }) }),
      'browserProfileService',
    );
  });

  it('reset de un perfil inexistente devuelve false sin auditar', async () => {
    const db = createMapDb();
    const service = createService(db);
    expect(await service.reset('nadie')).toBe(false);
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('getForParticipant devuelve copia y undefined para inexistentes', async () => {
    const db = createMapDb([makeRecord()]);
    const service = createService(db);
    const row = await service.getForParticipant('hijo-1');
    expect(row?.id).toBe('hijo-1');
    expect(row).not.toBe((await db.toArray())[0]);
    expect(await service.getForParticipant('nadie')).toBeUndefined();
  });

  it('list devuelve copias ordenadas por nombre', async () => {
    const db = createMapDb([
      makeRecord({ id: 'a', participantId: 'a', participantName: 'Ana' }),
      makeRecord({ id: 'b', participantId: 'b', participantName: 'Luis' }),
    ]);
    const service = createService(db);
    const rows = await service.list();
    expect(rows.map((r) => r.participantName)).toEqual(['Ana', 'Luis']);
  });
});

describe('browserProfileService — consistencia con el catálogo (F2)', () => {
  // F2: la allowlist y los tiles ya NO son listas fijas — se derivan del
  // catálogo de sitios (searchSiteTypes.deriveAllowlist / deriveTiles).
  // El servicio de perfil sigue guardando las listas, pero la UI las deriva
  // del catálogo, de modo que "agregar un sitio = aparece en voz, barra,
  // tiles y resultados" sin tocar código. Estos tests fijan el invariante
  // "sin hardcode": los valores de CONFIG deben reproducirse desde el catálogo.

  it('la allowlist del defaultProfile coincide con deriveAllowlist del catálogo built-in', () => {
    expect(deriveAllowlist(CONFIG.defaultProfile.categories, BUILTIN_SEARCH_SITES)).toEqual(
      CONFIG.defaultProfile.allowlist,
    );
  });

  it('la allowlist de cada rol coincide con deriveAllowlist de sus categorías', () => {
    expect(deriveAllowlist(CONFIG.defaultsByRole.Estudiante.categories, BUILTIN_SEARCH_SITES)).toEqual(
      CONFIG.defaultsByRole.Estudiante.allowlist,
    );
    expect(deriveAllowlist(CONFIG.defaultsByRole.Familiar.categories, BUILTIN_SEARCH_SITES)).toEqual(
      CONFIG.defaultsByRole.Familiar.allowlist,
    );
  });

  it('deriveTiles reproduce los tiles de inicio con el contrato de panel.tiles', () => {
    const tiles = deriveTiles(CONFIG.defaultProfile.categories, BUILTIN_SEARCH_SITES);
    expect(tiles).toEqual([
      { id: 'wikipedia.org', label: 'Wikipedia', domain: 'wikipedia.org', category: 'educacion' },
      { id: 'educ.ar', label: 'Educ.ar', domain: 'educ.ar', category: 'educacion' },
    ]);
    // Los ids de tile son dominios normalizados (no ids arbitrarios).
    for (const tile of tiles) {
      expect(tile.id).toBe(tile.domain);
    }
  });

  it('agregar un sitio aprobado al catálogo lo hace aparecer en allowlist y tiles sin tocar código', () => {
    const catalogoConNuevo: readonly SearchSite[] = [
      ...BUILTIN_SEARCH_SITES,
      {
        dominio: 'khanacademy.org',
        label: 'Khan Academy',
        categorias: ['educacion'],
        idiomas: [],
        nivel: 'simple',
        aprobado: true,
      },
    ];
    const allowlist = deriveAllowlist(['educacion', 'cuentos'], catalogoConNuevo);
    expect(allowlist).toEqual(['wikipedia.org', 'educ.ar', 'khanacademy.org']);
    const tiles = deriveTiles(['educacion', 'cuentos'], catalogoConNuevo);
    expect(tiles.some((t) => t.id === 'khanacademy.org' && t.domain === 'khanacademy.org')).toBe(true);
  });

  it('un sitio no aprobado o de otra categoría NO entra a la allowlist', () => {
    const catalogo: readonly SearchSite[] = [
      ...BUILTIN_SEARCH_SITES,
      {
        dominio: 'webpeligrosa.com',
        label: 'Web peligrosa',
        categorias: ['educacion'],
        idiomas: [],
        nivel: 'simple',
        aprobado: false,
      },
    ];
    expect(deriveAllowlist(['educacion', 'cuentos'], catalogo)).toEqual(['wikipedia.org', 'educ.ar']);
  });
});
