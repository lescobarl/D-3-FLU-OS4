/**
 * catalogos dinamicos (search / paletas / ambientes) — el mismo contrato x3 (0%).
 *
 * POR QUE ESTE TEST: los tres `*Catalog.ts` (~65 sentencias cada uno) son el puente
 * entre la tabla Dexie y la CACHE FUSIONADA que consume el runtime (built-ins +
 * dinamicos). El registro generico ya tiene test propio; lo que estaba sin ejecutar
 * es SU politica: hidratar, CRUD con re-hidratacion, ids reservados, duplicados y
 * el reset. Aqui se corre EL MISMO CONTRATO contra los tres, con `fluDb` sustituido
 * por tablas en memoria (la frontera de persistencia; la tabla real no aporta nada
 * al contrato) y con payloads clonados de los propios built-ins, para que la
 * validacion sea la del catalogo y no una copia mia.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tablas = vi.hoisted(() => {
    const make = () => {
        const rows = new Map<string, Record<string, unknown>>();
        return {
            rows,
            add: async (row: Record<string, unknown>) => {
                rows.set(String(row.id), row);
            },
            put: async (row: Record<string, unknown>) => {
                rows.set(String(row.id), row);
            },
            get: async (id: string) => rows.get(String(id)),
            toArray: async () => [...rows.values()],
        };
    };
    return { searchSites: make(), paletas: make(), ambientes: make(), auditoria: [] as unknown[] };
});

// Aislado a proposito: cargar el modulo REAL de fluDatabase construye el Dexie y,
// sin IndexedDB en el entorno node, revienta al importar. Se expone `fluDb` (tablas
// en memoria) y `addAuditLog` (el registro AUDITA cada mutacion del catalogo).
vi.mock('../src/core/db/fluDatabase', () => ({
    fluDb: {
        searchSites: tablas.searchSites,
        paletas: tablas.paletas,
        ambientes: tablas.ambientes,
    },
    addAuditLog: async (...args: unknown[]) => {
        tablas.auditoria.push(args);
    },
}));

import {
    getSearchSites,
    getDynamicSearchSite,
    hydrateSearchSites,
    listDynamicSearchSites,
    registerSearchSite,
    removeSearchSite,
    resetSearchSitesCache,
    updateSearchSite,
} from '../src/core/search/searchCatalog.js';
import {
    getDynamicPaleta,
    hydratePalettes,
    listDynamicPaletas,
    registerPaleta,
    removePaleta,
    resetPaletasCache,
    updatePaleta,
} from '../src/core/branding/paletasCatalog.js';
import {
    getDynamicAmbiente,
    hydrateAmbientes,
    listDynamicAmbientes,
    registerAmbiente,
    removeAmbiente,
    resetAmbientesCache,
    updateAmbiente,
} from '../src/core/environments/ambientesCatalog.js';
import { getAllPalettes, PALETTES } from '../src/core/branding/seasonalPalettes.js';
import { getAmbientes, getAmbiente, ENVIRONMENTS } from '../src/core/environments/environmentRegistry.js';
import { BUILTIN_SEARCH_SITES } from '../src/core/search/searchSiteTypes.js';

/** Payloads validos: un CLON de un built-in con id/slug nuevo. */
const nuevaPaleta = () => ({ ...PALETTES[Object.keys(PALETTES)[0]], id: 'mi-paleta', name: 'Mi paleta' });
const nuevoAmbiente = () => ({ ...getAmbiente('chef')!, id: 'mi-ambiente', nombre: 'Mi ambiente' });
const nuevoSitio = () => ({ ...BUILTIN_SEARCH_SITES[0], dominio: 'escuela.example.org', label: 'Escuela' });

type Resultado = { ok: boolean; reason?: string; record?: { id: string; data: unknown } };

const catalogo = ({
    nombre,
    tabla,
    builtin,
    clave,
    leerCache,
    hydrate,
    resetCache,
    register,
    update,
    remove,
    listDynamic,
    getDynamic,
    nuevo,
    editar,
}: {
    nombre: string;
    tabla: { rows: Map<string, unknown> };
    builtin: readonly Record<string, unknown>[];
    clave: (item: Record<string, unknown>) => string;
    leerCache: () => readonly Record<string, unknown>[];
    hydrate: () => Promise<void>;
    resetCache: () => void;
    register: (data: unknown) => Promise<Resultado>;
    update: (id: string, data: unknown) => Promise<Resultado>;
    remove: (id: string) => Promise<boolean>;
    listDynamic: () => Promise<Record<string, unknown>[]>;
    getDynamic: (id: string) => Promise<Record<string, unknown> | undefined>;
    nuevo: () => Record<string, unknown>;
    editar: (item: Record<string, unknown>) => Record<string, unknown>;
}) => {
    describe(`catalogo dinamico — ${nombre}`, () => {
        beforeEach(() => {
            tabla.rows.clear();
            tablas.auditoria.length = 0;
            resetCache();
        });

        it('la cache arranca en los built-ins y la hidratacion suma los dinamicos', async () => {
            expect(leerCache()).toEqual(builtin);

            const item = nuevo();
            const id = clave(item);
            await register(item);
            await hydrate();

            const fusion = leerCache();
            expect(fusion.length).toBe(builtin.length + 1);
            expect(fusion.map(clave)).toContain(id);

            // Hidratar otra vez no duplica: la tabla es la fuente.
            await hydrate();
            expect(leerCache().length).toBe(fusion.length);
        });

        it('registrar persiste, devuelve el registro y re-hidrata', async () => {
            const item = nuevo();
            const id = clave(item);

            const resultado = await register(item);

            expect(resultado.ok).toBe(true);
            // El id del CATALOGO (canonico) vive en data; el id del REGISTRO es un UUIDv4.
            expect(clave(resultado.record!.data as Record<string, unknown>)).toBe(id);
            expect(resultado.record!.id).not.toBe(id);
            expect(tabla.rows.has(resultado.record!.id)).toBe(true);
            expect(leerCache().map(clave)).toContain(id);
            expect((await listDynamic()).map(clave)).toEqual([id]);
            expect(clave((await getDynamic(id))!)).toBe(id);
            // El registro AUDITA la mutacion del catalogo (etiqueta de la entidad).
            expect(tablas.auditoria.length).toBeGreaterThan(0);
        });

        it('un id reservado por los built-ins no se registra', async () => {
            const antes = tabla.rows.size;

            const resultado = await register(builtin[0]);

            expect(resultado).toEqual({ ok: false, reason: 'reserved' });
            expect(tabla.rows.size).toBe(antes);
        });

        it('un payload invalido no se registra', async () => {
            const resultado = await register({});

            expect(resultado.ok).toBe(false);
            expect(resultado.reason).toBe('invalid-input');
            expect(tabla.rows.size).toBe(0);
        });

        it('el mismo id no entra dos veces', async () => {
            const item = nuevo();
            expect((await register(item)).ok).toBe(true);

            expect(await register(item)).toEqual({ ok: false, reason: 'duplicate' });
            expect(tabla.rows.size).toBe(1);
        });

        it('actualizar cambia los datos, re-hidrata y respeta reservados y ausentes', async () => {
            const item = nuevo();
            const id = clave(item);
            await register(item);
            const editado = editar(item);

            const resultado = await update(id, editado);

            expect(resultado.ok).toBe(true);
            expect(leerCache().map(clave)).toContain(id);
            expect(clave((await getDynamic(id))!)).toBe(id);

            expect(await update('no-existe', editado)).toEqual({ ok: false, reason: 'not-found' });
            expect(await update(clave(builtin[0]), builtin[0])).toEqual({ ok: false, reason: 'reserved' });
        });

        it('quitar borra de la tabla y de la cache, y no toca los built-ins', async () => {
            const item = nuevo();
            const id = clave(item);
            await register(item);

            expect(await remove(id)).toBe(true);
            // Borrado LOGICO: la fila sigue en la tabla pero marcada `deleted`.
            expect(tabla.rows.size).toBe(1);
            const fila = [...tabla.rows.values()][0] as { data: Record<string, unknown>; sync: { deleted?: boolean } };
            expect(clave(fila.data)).toBe(id);
            expect(fila.sync.deleted).toBe(true);
            expect(await listDynamic()).toEqual([]);
            expect(leerCache().map(clave)).not.toContain(id);

            expect(await remove('no-existe')).toBe(false);
            expect(await remove(clave(builtin[0]))).toBe(false);
            expect(leerCache().length).toBe(builtin.length);
        });

        it('el reset devuelve la cache a los built-ins sin tocar la tabla', async () => {
            await register(nuevo());
            expect(tabla.rows.size).toBe(1);

            resetCache();

            expect(leerCache()).toEqual(builtin);
            expect(tabla.rows.size).toBe(1);
        });
    });
};

catalogo({
    nombre: 'sitios de busqueda',
    tabla: tablas.searchSites,
    builtin: BUILTIN_SEARCH_SITES as unknown as Record<string, unknown>[],
    clave: (item) => String(item.dominio),
    leerCache: () => getSearchSites() as unknown as Record<string, unknown>[],
    hydrate: hydrateSearchSites,
    resetCache: resetSearchSitesCache,
    register: (data) => registerSearchSite(data as never),
    update: (id, data) => updateSearchSite(id, data as never),
    remove: removeSearchSite,
    listDynamic: () => listDynamicSearchSites() as unknown as Promise<Record<string, unknown>[]>,
    getDynamic: (id) => getDynamicSearchSite(id) as unknown as Promise<Record<string, unknown> | undefined>,
    nuevo: nuevoSitio,
    editar: (item) => ({ ...item, label: 'Escuela nueva' }),
});

catalogo({
    nombre: 'paletas',
    tabla: tablas.paletas,
    builtin: getAllPalettes() as unknown as Record<string, unknown>[],
    clave: (item) => String(item.id),
    leerCache: () => getAllPalettes() as unknown as Record<string, unknown>[],
    hydrate: hydratePalettes,
    resetCache: resetPaletasCache,
    register: (data) => registerPaleta(data as never),
    update: (id, data) => updatePaleta(id, data as never),
    remove: removePaleta,
    listDynamic: () => listDynamicPaletas() as unknown as Promise<Record<string, unknown>[]>,
    getDynamic: (id) => getDynamicPaleta(id) as unknown as Promise<Record<string, unknown> | undefined>,
    nuevo: nuevaPaleta,
    editar: (item) => ({ ...item, name: 'Mi paleta editada' }),
});

catalogo({
    nombre: 'ambientes',
    tabla: tablas.ambientes,
    builtin: ENVIRONMENTS as unknown as Record<string, unknown>[],
    clave: (item) => String(item.id),
    leerCache: () => getAmbientes() as unknown as Record<string, unknown>[],
    hydrate: hydrateAmbientes,
    resetCache: resetAmbientesCache,
    register: (data) => registerAmbiente(data as never),
    update: (id, data) => updateAmbiente(id, data as never),
    remove: removeAmbiente,
    listDynamic: () => listDynamicAmbientes() as unknown as Promise<Record<string, unknown>[]>,
    getDynamic: (id) => getDynamicAmbiente(id) as unknown as Promise<Record<string, unknown> | undefined>,
    nuevo: nuevoAmbiente,
    editar: (item) => ({ ...item, nombre: 'Mi ambiente editado' }),
});
