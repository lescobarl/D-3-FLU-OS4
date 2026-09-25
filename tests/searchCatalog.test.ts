// ============================================================
// searchCatalog — Catálogo dinámico de sitios del Buscador (F2)
// ------------------------------------------------------------
// Cubre:
//   1) Funciones puras: BUILTIN_SEARCH_SITES derivado de la config,
//      filterApprovedSites / deriveAllowlist / deriveTiles
//      ("agregar un sitio al catálogo = aparece en voz, barra,
//      tiles y resultados sin tocar código").
//   2) searchSiteSchema: validación estricta del payload.
//   3) mergeCatalog/isReservedId con keyOf por dominio.
//   4) CRUD del registro genérico con base en memoria (misma
//      interfaz CatalogDb), reloj y newId inyectables, audit log
//      mockeado (IndexedDB no está disponible en vitest).
// Regla #1: sin hardcode; valores y validadores desde la config.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog } from '../src/core/db/fluDatabase';
import { createCatalogRegistry, type CatalogDb, type CatalogRecord } from '../src/core/catalogs/catalogRegistry';
import { searchSiteSchema } from '../src/core/catalogs/catalogSchema';
import { isReservedId, mergeCatalog } from '../src/core/catalogs/mergeCatalog';
import {
  BUILTIN_SEARCH_SITES,
  deriveAllowlist,
  deriveTiles,
  filterApprovedSites,
  SEARCH_SITE_CATEGORY_KEYS,
  type SearchSite,
} from '../src/core/search/searchSiteTypes';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const KEY_OF_DOMINIO = (site: SearchSite): string => site.dominio;

function makeSite(overrides: Partial<SearchSite> = {}): SearchSite {
  return {
    dominio: 'khanacademy.org',
    label: 'Khan Academy',
    categorias: ['educacion'],
    idiomas: ['es', 'en'],
    nivel: 'detallado',
    aprobado: true,
    ...overrides,
  };
}

let idCounter = 0;

function createMapDb(initial: CatalogRecord<SearchSite>[] = []): CatalogDb<SearchSite> {
  const map = new Map<string, CatalogRecord<SearchSite>>();
  for (const r of initial) map.set(r.id, { ...r, data: structuredClone(r.data), sync: { ...r.sync } });
  return {
    async add(record) {
      map.set(record.id, { ...record, data: structuredClone(record.data), sync: { ...record.sync } });
      return undefined;
    },
    async put(record) {
      map.set(record.id, { ...record, data: structuredClone(record.data), sync: { ...record.sync } });
      return undefined;
    },
    async get(id) {
      const row = map.get(id);
      return row ? { ...row, data: structuredClone(row.data), sync: { ...row.sync } } : undefined;
    },
    async toArray() {
      return Array.from(map.values()).map((r) => ({ ...r, data: structuredClone(r.data), sync: { ...r.sync } }));
    },
  };
}

function createService(db: CatalogDb<SearchSite>) {
  return createCatalogRegistry<SearchSite>({
    db,
    schema: searchSiteSchema,
    entity: 'searchSite',
    now,
    newId: () => `rec-${++idCounter}`,
  });
}

let db: CatalogDb<SearchSite>;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

// ------------------------------------------------------------
// Built-ins derivados de FLU_CONFIG.browser.panel.tiles
// ------------------------------------------------------------
describe('searchCatalog — BUILTIN_SEARCH_SITES (sin hardcode)', () => {
  it('deriva los sitios built-in de la config (panel.tiles)', () => {
    const dominios = BUILTIN_SEARCH_SITES.map((site) => site.dominio);
    expect(dominios).toEqual(['wikipedia.org', 'educ.ar', 'youtube.com']);
  });

  it('mapea cada tile a un SearchSite aprobado con su categoría', () => {
    const wikipedia = BUILTIN_SEARCH_SITES.find((site) => site.dominio === 'wikipedia.org');
    expect(wikipedia).toMatchObject({
      label: 'Wikipedia',
      categorias: ['educacion'],
      idiomas: [],
      nivel: 'simple',
      aprobado: true,
    });
    expect(BUILTIN_SEARCH_SITES.find((site) => site.dominio === 'youtube.com')).toMatchObject({
      label: 'YouTube',
      categorias: ['musica'],
      aprobado: true,
    });
  });

  it('los dominios built-in quedan reservados en el esquema', () => {
    expect(searchSiteSchema.reservedIds.has('wikipedia.org')).toBe(true);
    expect(searchSiteSchema.reservedIds.has('educ.ar')).toBe(true);
    expect(searchSiteSchema.reservedIds.has('youtube.com')).toBe(true);
  });
});

// ------------------------------------------------------------
// filterApprovedSites / deriveAllowlist / deriveTiles
// ------------------------------------------------------------
describe('searchCatalog — deriveAllowlist / deriveTiles (lista derivada)', () => {
  it('la allowlist por defecto (educacion+cuentos) coincide con defaultProfile.allowlist', () => {
    const allowlist = deriveAllowlist(['educacion', 'cuentos'], BUILTIN_SEARCH_SITES);
    expect(allowlist).toEqual(['wikipedia.org', 'educ.ar']);
  });

  it('la allowlist de Familiar (4 categorías) incluye youtube', () => {
    const allowlist = deriveAllowlist(['educacion', 'cuentos', 'juegos', 'musica'], BUILTIN_SEARCH_SITES);
    expect(allowlist).toEqual(['wikipedia.org', 'educ.ar', 'youtube.com']);
  });

  it('una categoría sin tiles no aporta dominios', () => {
    expect(deriveAllowlist(['juegos'], BUILTIN_SEARCH_SITES)).toEqual([]);
    expect(deriveAllowlist([], BUILTIN_SEARCH_SITES)).toEqual([]);
  });

  it('filterApprovedSites excluye sitios no aprobados', () => {
    const catalog: readonly SearchSite[] = [
      makeSite({ dominio: 'a.org', categorias: ['educacion'], aprobado: true }),
      makeSite({ dominio: 'b.org', categorias: ['educacion'], aprobado: false }),
    ];
    expect(filterApprovedSites(['educacion'], catalog).map((s) => s.dominio)).toEqual(['a.org']);
  });

  it('deriveTiles produce el contrato de browser.panel.tiles (id/label/domain/category)', () => {
    const tiles = deriveTiles(['educacion', 'cuentos'], BUILTIN_SEARCH_SITES);
    expect(tiles).toEqual([
      { id: 'wikipedia.org', label: 'Wikipedia', domain: 'wikipedia.org', category: 'educacion' },
      { id: 'educ.ar', label: 'Educ.ar', domain: 'educ.ar', category: 'educacion' },
    ]);
  });

  it('deriveTiles no muta el catálogo de origen', () => {
    const snapshot = structuredClone(BUILTIN_SEARCH_SITES);
    deriveTiles(['educacion'], BUILTIN_SEARCH_SITES);
    expect(BUILTIN_SEARCH_SITES).toEqual(snapshot);
  });

  it('agregar un sitio dinámico lo hace aparecer en allowlist y tiles sin tocar código', () => {
    const catalogo: readonly SearchSite[] = [
      ...BUILTIN_SEARCH_SITES,
      makeSite({ dominio: 'khanacademy.org', label: 'Khan Academy', categorias: ['educacion'] }),
    ];
    expect(deriveAllowlist(['educacion', 'cuentos'], catalogo)).toEqual([
      'wikipedia.org',
      'educ.ar',
      'khanacademy.org',
    ]);
    expect(deriveTiles(['educacion', 'cuentos'], catalogo)).toContainEqual({
      id: 'khanacademy.org',
      label: 'Khan Academy',
      domain: 'khanacademy.org',
      category: 'educacion',
    });
  });
});

// ------------------------------------------------------------
// searchSiteSchema — validación estricta
// ------------------------------------------------------------
describe('searchCatalog — searchSiteSchema (validación estricta)', () => {
  // El esquema se tipa con SearchSite; para probar payloads inválidos
  // se invoca el validador como unknown (igual que hace el runtime).
  const validateRaw = (data: unknown): string | null =>
    (searchSiteSchema.validate as (d: unknown) => string | null)(data);

  it('acepta un sitio válido (idiomas puede quedar vacío)', () => {
    expect(searchSiteSchema.validate(makeSite())).toBeNull();
    expect(searchSiteSchema.validate(makeSite({ idiomas: [] }))).toBeNull();
  });

  it('rechaza payloads que no son objeto', () => {
    expect(validateRaw(null)).toMatch(/payload inválido/);
    expect(validateRaw('nada')).toMatch(/payload inválido/);
  });

  it('rechaza dominios que no son hosts válidos', () => {
    expect(searchSiteSchema.validate(makeSite({ dominio: 'no es un host' }))).toMatch(/host válido/);
    expect(searchSiteSchema.validate(makeSite({ dominio: 'sinpunto' }))).toMatch(/host válido/);
  });

  it('rechaza label vacío', () => {
    expect(searchSiteSchema.validate(makeSite({ label: '   ' }))).toMatch(/label es obligatorio/);
  });

  it('rechaza categorías vacías o fuera del catálogo', () => {
    expect(searchSiteSchema.validate(makeSite({ categorias: [] }))).toMatch(/al menos una categoría/);
    expect(searchSiteSchema.validate(makeSite({ categorias: ['inexistente'] }))).toMatch(/categoría no válida: inexistente/);
  });

  it('rechaza idiomas que no son arreglo o con códigos inválidos', () => {
    expect(validateRaw(makeSite({ idiomas: 'es' as unknown as SearchSite['idiomas'] }))).toMatch(
      /idiomas debe ser un arreglo/,
    );
    expect(validateRaw(makeSite({ idiomas: ['frances'] as unknown as SearchSite['idiomas'] }))).toMatch(
      /idioma no válido: frances/,
    );
  });

  it('rechaza nivel fuera de readingLevels', () => {
    expect(searchSiteSchema.validate(makeSite({ nivel: 'experto' as unknown as 'simple' }))).toMatch(/nivel debe ser uno de:/);
  });

  it('rechaza aprobado que no es booleano', () => {
    expect(searchSiteSchema.validate(makeSite({ aprobado: 'si' as unknown as boolean }))).toMatch(/aprobado debe ser booleano/);
  });

  it('idOf usa el dominio como id canónico', () => {
    expect(searchSiteSchema.idOf(makeSite())).toBe('khanacademy.org');
  });

  it('expone las categorías válidas desde la config', () => {
    expect(SEARCH_SITE_CATEGORY_KEYS).toEqual(expect.arrayContaining(['educacion', 'cuentos', 'juegos', 'musica']));
  });
});

// ------------------------------------------------------------
// mergeCatalog / isReservedId con keyOf por dominio
// ------------------------------------------------------------
describe('searchCatalog — mergeCatalog / isReservedId (keyOf por dominio)', () => {
  it('mantiene built-ins primero y añade dinámicos después', () => {
    const merged = mergeCatalog(
      BUILTIN_SEARCH_SITES,
      [makeSite({ dominio: 'khanacademy.org' })],
      KEY_OF_DOMINIO,
    );
    expect(merged.map((s) => s.dominio)).toEqual(['wikipedia.org', 'educ.ar', 'youtube.com', 'khanacademy.org']);
  });

  it('omite dinámicos con dominio reservado o duplicado', () => {
    const merged = mergeCatalog(
      BUILTIN_SEARCH_SITES,
      [
        makeSite({ dominio: 'wikipedia.org', label: 'Reservado' }),
        makeSite({ dominio: 'khanacademy.org' }),
        makeSite({ dominio: 'khanacademy.org', label: 'Duplicado' }),
      ],
      KEY_OF_DOMINIO,
    );
    expect(merged.map((s) => s.dominio)).toEqual(['wikipedia.org', 'educ.ar', 'youtube.com', 'khanacademy.org']);
  });

  it('isReservedId detecta dominios pertenecientes a los built-ins', () => {
    expect(isReservedId('wikipedia.org', BUILTIN_SEARCH_SITES, KEY_OF_DOMINIO)).toBe(true);
    expect(isReservedId('khanacademy.org', BUILTIN_SEARCH_SITES, KEY_OF_DOMINIO)).toBe(false);
  });
});

// ------------------------------------------------------------
// CRUD del registro genérico sobre el esquema searchSite
// ------------------------------------------------------------
describe('searchCatalog — registro (register)', () => {
  it('register crea un registro completo, lo persiste y audita', async () => {
    const service = createService(db);
    const result = await service.register(makeSite());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.id).toBe('rec-1');
    expect(result.record.data).toEqual(makeSite());
    expect(result.record.createdAt).toBe(NOW);
    expect(result.record.updatedAt).toBe(NOW);
    expect(result.record.sync.revision).toBe(1);
    expect(result.record.sync.deleted).toBe(false);
    expect(result.record.sync.updated_at).toBe(new Date(NOW).toISOString());

    // Persistido en la base
    expect((await service.list()).map((s) => s.dominio)).toEqual(['khanacademy.org']);
    // Auditado con el dominio canónico y el payload
    expect(addAuditLog).toHaveBeenCalledWith(
      'searchSite.register',
      'searchSite',
      'khanacademy.org',
      null,
      { data: result.record.data },
      'catalogRegistry',
    );
  });

  it('register rechaza payloads inválidos sin persistir ni auditar', async () => {
    const service = createService(db);
    const result = await service.register(makeSite({ dominio: 'no es host' }));

    expect(result).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await service.list()).toEqual([]);
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('register rechaza dominios reservados (built-ins)', async () => {
    const service = createService(db);
    const result = await service.register(makeSite({ dominio: 'wikipedia.org', label: 'Duplicado reservado' }));

    expect(result).toEqual({ ok: false, reason: 'reserved' });
    expect(await service.list()).toEqual([]);
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('register rechaza duplicados por dominio canónico', async () => {
    const service = createService(db);
    await service.register(makeSite());
    const result = await service.register(makeSite({ label: 'Otro nombre, mismo dominio' }));

    expect(result).toEqual({ ok: false, reason: 'duplicate' });
    expect((await service.list()).length).toBe(1);
  });
});

describe('searchCatalog — consultas (get/list)', () => {
  it('get devuelve una copia de los datos por dominio canónico', async () => {
    const service = createService(db);
    await service.register(makeSite());

    const site = await service.get('khanacademy.org');
    expect(site).toEqual(makeSite());
  });

  it('get devuelve undefined para ids vacíos o inexistentes', async () => {
    const service = createService(db);
    expect(await service.get('')).toBeUndefined();
    expect(await service.get('nada.org')).toBeUndefined();
  });

  it('list devuelve los datos de todos los registros', async () => {
    const service = createService(db);
    await service.register(makeSite({ dominio: 'a.org' }));
    await service.register(makeSite({ dominio: 'b.org' }));

    const all = await service.list();
    expect(all.map((s) => s.dominio).sort()).toEqual(['a.org', 'b.org']);
  });
});

describe('searchCatalog — actualización (update)', () => {
  it('update conserva el registro, incrementa revisión y audita con el previo', async () => {
    const service = createService(db);
    await service.register(makeSite());

    const result = await service.update('khanacademy.org', makeSite({ label: 'Khan Academy (nuevo)' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.id).toBe('rec-1');
    expect(result.record.data.label).toBe('Khan Academy (nuevo)');
    expect(result.record.sync.revision).toBe(2);
    expect(result.record.createdAt).toBe(NOW);
    expect(result.record.updatedAt).toBe(NOW);
    expect(addAuditLog).toHaveBeenCalledWith(
      'searchSite.update',
      'searchSite',
      'khanacademy.org',
      makeSite(),
      { data: result.record.data },
      'catalogRegistry',
    );
  });

  it('update permite renombrar el dominio canónico sin colisión', async () => {
    const service = createService(db);
    await service.register(makeSite());

    const result = await service.update('khanacademy.org', makeSite({ dominio: 'phet.colorado.edu' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await service.get('phet.colorado.edu')).toEqual(makeSite({ dominio: 'phet.colorado.edu' }));
    expect(await service.get('khanacademy.org')).toBeUndefined();
  });

  it('update rechaza colisión con otro registro', async () => {
    const service = createService(db);
    await service.register(makeSite({ dominio: 'a.org' }));
    await service.register(makeSite({ dominio: 'b.org' }));

    const result = await service.update('b.org', makeSite({ dominio: 'a.org' }));
    expect(result).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('update devuelve not-found para un dominio canónico inexistente', async () => {
    const service = createService(db);
    const result = await service.update('inexistente.org', makeSite());
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('update rechaza dominios reservados y payloads inválidos', async () => {
    const service = createService(db);
    await service.register(makeSite());

    expect(await service.update('wikipedia.org', makeSite())).toEqual({ ok: false, reason: 'reserved' });
    expect(await service.update('khanacademy.org', makeSite({ dominio: 'no es host' }))).toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    // Solo el register del setup audita; los updates rechazados no auditan.
    expect(addAuditLog).toHaveBeenCalledTimes(1);
  });
});

describe('searchCatalog — borrado (remove)', () => {
  it('remove borra el registro, devuelve true y audita con el previo', async () => {
    const service = createService(db);
    await service.register(makeSite());

    const removed = await service.remove('khanacademy.org');
    expect(removed).toBe(true);
    expect(await service.list()).toEqual([]);
    expect(addAuditLog).toHaveBeenCalledWith(
      'searchSite.remove',
      'searchSite',
      'khanacademy.org',
      makeSite(),
      null,
      'catalogRegistry',
    );
  });

  it('remove devuelve false sin auditar para inexistente, reservado o vacío', async () => {
    const service = createService(db);
    expect(await service.remove('')).toBe(false);
    expect(await service.remove('nada.org')).toBe(false);
    expect(await service.remove('wikipedia.org')).toBe(false);
    expect(addAuditLog).not.toHaveBeenCalled();
  });
});
