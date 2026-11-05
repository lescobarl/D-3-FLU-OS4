// @vitest-environment jsdom
/**
 * useShoppingList - la lista de la compra sobre Dexie (0%).
 *
 * POR QUE ESTE TEST: el hook es el unico dueño de la lista (alta simple y multiple,
 * marcar, renombrar, borrar, desmarcar todo y vaciar comprados). Se sustituye la
 * frontera (el servicio, que tiene test propio) y se prueban sus reglas: el ORDEN
 * que ve el usuario (pendientes primero, luego por fecha), el contador de pendientes
 * y el refresco SOLO cuando la operacion cambio algo.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crear: vi.fn(),
    servicio: {
        list: vi.fn(async () => [] as unknown[]),
        add: vi.fn(async () => ({ ok: true })),
        toggle: vi.fn(async () => null as unknown),
        rename: vi.fn(async () => null as unknown),
        remove: vi.fn(async () => false),
        uncheckAll: vi.fn(async () => 0),
        clearChecked: vi.fn(async () => 0),
    },
    argumentos: null as unknown,
}));

vi.mock('../src/core/reminders/shoppingService.js', () => ({
    createShoppingService: (opciones: unknown) => {
        dobles.argumentos = opciones;
        dobles.crear(opciones);
        return dobles.servicio;
    },
}));

import { useShoppingList } from '../src/hooks/useShoppingList.js';
import { itemsRemaining } from '../src/core/reminders/shoppingList.js';

const ficha = (id: string, checked: boolean, createdAt: number, label = id) => ({ id, checked, createdAt, label });

const montar = (opciones: { now?: () => number } = {}) => renderHook(() => useShoppingList(opciones));

beforeEach(() => {
    dobles.crear.mockClear();
    for (const fn of Object.values(dobles.servicio)) fn.mockClear();
    dobles.servicio.list.mockResolvedValue([]);
    dobles.servicio.add.mockResolvedValue({ ok: true });
    dobles.servicio.toggle.mockResolvedValue(null);
    dobles.servicio.rename.mockResolvedValue(null);
    dobles.servicio.remove.mockResolvedValue(false);
    dobles.servicio.uncheckAll.mockResolvedValue(0);
    dobles.servicio.clearChecked.mockResolvedValue(0);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useShoppingList - carga y orden', () => {
    it('crea un unico servicio con el reloj inyectado', async () => {
        const ahora = () => 777;
        const { result } = montar({ now: ahora });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(dobles.crear).toHaveBeenCalledTimes(1);
        expect((dobles.argumentos as { now: () => number }).now()).toBe(777);
        expect(result.current.service).toBe(dobles.servicio);
    });

    it('pone los pendientes PRIMERO y los comprados por detras, cada grupo por fecha', async () => {
        dobles.servicio.list.mockResolvedValue([
            ficha('comprado-viejo', true, 1),
            ficha('pendiente-nuevo', false, 30),
            ficha('comprado-nuevo', true, 20),
            ficha('pendiente-viejo', false, 10),
        ]);

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.items.map((i) => i.id)).toEqual([
            'pendiente-viejo',
            'pendiente-nuevo',
            'comprado-viejo',
            'comprado-nuevo',
        ]);
    });

    it('el contador de pendientes cuenta los NO marcados', async () => {
        const lista = [ficha('a', false, 1), ficha('b', true, 2), ficha('c', false, 3)];
        dobles.servicio.list.mockResolvedValue(lista);

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.remainingCount).toBe(2);
        expect(result.current.remainingCount).toBe(itemsRemaining(lista as never));
    });

    it('un fallo de listado se registra y no deja loading colgado', async () => {
        dobles.servicio.list.mockRejectedValue(new Error('dexie caido'));

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(console.error).toHaveBeenCalled();
        expect(result.current.items).toEqual([]);
    });
});

describe('useShoppingList - acciones', () => {
    it('add refresca solo si entro el item', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.list.mock.calls.length;

        dobles.servicio.add.mockResolvedValueOnce({ ok: false, reason: 'duplicate' } as never);
        await result.current.add({ label: 'leche' });
        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas);

        dobles.servicio.add.mockResolvedValueOnce({ ok: true });
        await result.current.add({ label: 'pan' });
        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas + 1);
        expect(dobles.servicio.add).toHaveBeenLastCalledWith({ label: 'pan' });
    });

    it('addMany limpia, ignora vacios y refresca UNA vez si alguno entro', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.list.mock.calls.length;

        expect(await result.current.addMany(['  ', ''])).toEqual([]);
        expect(dobles.servicio.add).not.toHaveBeenCalled();

        dobles.servicio.add
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, reason: 'x' } as never)
            .mockResolvedValueOnce({ ok: true });
        const salida = await result.current.addMany([' leche ', 'pan', 'huevos']);

        expect(salida).toHaveLength(3);
        expect(dobles.servicio.add.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
            { label: 'leche' },
            { label: 'pan' },
            { label: 'huevos' },
        ]);
        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas + 1);
    });

    it('addMany sin ningun exito no refresca', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.list.mock.calls.length;
        dobles.servicio.add.mockResolvedValue({ ok: false, reason: 'x' } as never);

        await result.current.addMany(['leche']);

        expect(dobles.servicio.list.mock.calls.length).toBe(lecturas);
    });

    it('toggle, rename y remove refrescan solo si devolvieron algo', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const base = dobles.servicio.list.mock.calls.length;

        expect(await result.current.toggle('a')).toBeNull();
        expect(await result.current.rename('a', 'otro')).toBeNull();
        expect(await result.current.remove('a')).toBe(false);
        expect(dobles.servicio.list.mock.calls.length).toBe(base);

        dobles.servicio.toggle.mockResolvedValueOnce(ficha('a', true, 1));
        dobles.servicio.rename.mockResolvedValueOnce(ficha('a', false, 1, 'otro'));
        dobles.servicio.remove.mockResolvedValueOnce(true);
        await result.current.toggle('a');
        await result.current.rename('a', 'otro');
        await result.current.remove('a');

        expect(dobles.servicio.list.mock.calls.length).toBe(base + 3);
    });

    it('uncheckAll y clearChecked refrescan solo si tocaron algo', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const base = dobles.servicio.list.mock.calls.length;

        expect(await result.current.uncheckAll()).toBe(0);
        expect(await result.current.clearChecked()).toBe(0);
        expect(dobles.servicio.list.mock.calls.length).toBe(base);

        dobles.servicio.uncheckAll.mockResolvedValueOnce(3);
        dobles.servicio.clearChecked.mockResolvedValueOnce(2);
        expect(await result.current.uncheckAll()).toBe(3);
        expect(await result.current.clearChecked()).toBe(2);
        expect(dobles.servicio.list.mock.calls.length).toBe(base + 2);
    });

    it('refresh vuelve a leer y reordena', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.list.mockResolvedValue([ficha('a', true, 1), ficha('b', false, 2)]);
        dobles.servicio.list.mockClear();

        await result.current.refresh();

        expect(dobles.servicio.list).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(result.current.items.map((i) => i.id)).toEqual(['b', 'a']);
        });
        expect(result.current.remainingCount).toBe(1);
    });
});
