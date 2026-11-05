// @vitest-environment jsdom
/**
 * useBrowserProfiles - perfiles de navegador curado sobre Dexie (0%).
 *
 * POR QUE ESTE TEST: el hook es el unico camino del PizarrA3n-navegador a los
 * perfiles por persona. Se sustituyen las fronteras (la tabla Dexie y el servicio,
 * que tiene test propio) y se comprueba su politica: un solo servicio con el
 * adaptador de tabla correcto, refresco SOLO si la operacion fue bien, `update`
 * delegando en `ensure` con el rol (que siembra los escalares del rol) y
 * `resolveForSession` como consulta que no persiste.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crear: vi.fn(),
    servicio: {
        list: vi.fn(async () => [] as unknown[]),
        ensure: vi.fn(async () => ({ ok: true })),
        reset: vi.fn(async () => true),
        resolveForSession: vi.fn(async () => ({ categories: [] })),
    },
    tabla: {
        add: vi.fn(async () => 1),
        put: vi.fn(async () => 1),
        get: vi.fn(async () => undefined as unknown),
        toArray: vi.fn(async () => [] as unknown[]),
    },
    argumentos: null as unknown,
}));

vi.mock('../src/core/db/fluDatabase.js', () => ({ fluDb: { browserProfiles: dobles.tabla } }));

vi.mock('../src/core/browser/browserProfileService.js', () => ({
    createBrowserProfileService: (opciones: unknown) => {
        dobles.argumentos = opciones;
        dobles.crear(opciones);
        return dobles.servicio;
    },
}));

import { useBrowserProfiles } from '../src/hooks/useBrowserProfiles.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const montar = (opciones: { now?: () => number } = {}) => renderHook(() => useBrowserProfiles(opciones));

beforeEach(() => {
    dobles.crear.mockClear();
    for (const fn of Object.values(dobles.servicio)) fn.mockClear();
    for (const fn of Object.values(dobles.tabla)) fn.mockClear();
    dobles.servicio.list.mockResolvedValue([]);
    dobles.servicio.ensure.mockResolvedValue({ ok: true });
    dobles.servicio.reset.mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useBrowserProfiles - arranque', () => {
    it('crea un unico servicio con el adaptador de tabla, la config y el reloj', async () => {
        const ahora = () => 4242;
        const { result } = montar({ now: ahora });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(dobles.crear).toHaveBeenCalledTimes(1);
        const opciones = dobles.argumentos as { config: unknown; now: () => number; db: Record<string, unknown> };
        expect(opciones.config).toBe(FLU_CONFIG.browser);
        expect(opciones.now()).toBe(4242);
        expect(result.current.service).toBe(dobles.servicio);

        // El adaptador delega en la tabla real (misma puerta, no una copia).
        await (opciones.db.toArray as () => Promise<unknown>)();
        await (opciones.db.get as (id: string) => Promise<unknown>)('p1');
        expect(dobles.tabla.toArray).toHaveBeenCalled();
        expect(dobles.tabla.get).toHaveBeenCalledWith('p1');
    });

    it('la carga inicial trae los perfiles y termina en loading=false', async () => {
        dobles.servicio.list.mockResolvedValue([{ participantId: 'p1' }]);

        const { result } = montar();

        expect(result.current.loading).toBe(true);
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.profiles).toEqual([{ participantId: 'p1' }]);
    });

    it('un fallo de listado se registra y no deja loading colgado', async () => {
        dobles.servicio.list.mockRejectedValue(new Error('dexie caido'));

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(dobles.servicio.list).toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
    });
});

describe('useBrowserProfiles - escrituras', () => {
    it('ensure refresca solo si fue bien', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.list.mock.calls.length;

        dobles.servicio.ensure.mockResolvedValueOnce({ ok: false, reason: 'invalid' } as never);
        await result.current.ensure('p1', 'Ana');
        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas);

        dobles.servicio.ensure.mockResolvedValueOnce({ ok: true });
        await result.current.ensure('p1', 'Ana');
        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas + 1);
    });

    it('update construye la entrada explicita y reenvia el rol a ensure', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        await result.current.update('p1', { categories: ['educacion'], allowlist: ['a.org'] }, 'Ana', 'nino');

        expect(dobles.servicio.ensure).toHaveBeenCalledWith(
            'p1',
            'Ana',
            {
                categories: ['educacion'],
                allowlist: ['a.org'],
                readingLevel: undefined,
                language: undefined,
                homeTiles: undefined,
            },
            'nino',
        );
    });

    it('reset refresca solo si borro algo', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.list.mock.calls.length;

        dobles.servicio.reset.mockResolvedValueOnce(false);
        expect(await result.current.reset('p1')).toBe(false);
        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas);

        dobles.servicio.reset.mockResolvedValueOnce(true);
        expect(await result.current.reset('p1')).toBe(true);
        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas + 1);
    });

    it('resolveForSession es consulta: pasa directa y NO refresca', async () => {
        dobles.servicio.resolveForSession.mockResolvedValue({ categories: ['x'], readingLevel: 'simple' } as never);
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.list.mock.calls.length;

        const resuelto = await result.current.resolveForSession('p1', { role: 'nino', name: 'Ana' });

        expect(resuelto).toEqual({ categories: ['x'], readingLevel: 'simple' });
        expect(dobles.servicio.resolveForSession).toHaveBeenCalledWith('p1', { role: 'nino', name: 'Ana' });
        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas);
    });
});
