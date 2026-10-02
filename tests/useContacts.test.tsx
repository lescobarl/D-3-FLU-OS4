// @vitest-environment jsdom
/**
 * useContacts - la agenda de contactos sobre Dexie (0%).
 *
 * POR QUE ESTE TEST: 163 lineas que son el unico camino de la app hacia la agenda
 * (alta, edicion, baja y cumpleaños proximos). Se sustituyen las DOS fronteras
 * (la tabla Dexie y el servicio, que ya tiene test propio) y se comprueba la
 * politica del hook: carga inicial, refresco SOLO cuando la mutacion fue bien,
 * paso directo de las consultas y que un fallo de lectura no deja `loading` colgado.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crearServicio: vi.fn(),
    servicio: {
        listContacts: vi.fn(async () => [] as unknown[]),
        contactsWithBirthdayNear: vi.fn(async () => [] as unknown[]),
        addContact: vi.fn(async () => ({ ok: true })),
        updateContact: vi.fn(async () => ({ ok: true })),
        getContact: vi.fn(async () => undefined),
        removeContact: vi.fn(async () => ({ ok: true })),
    },
    argumentos: null as unknown,
}));

vi.mock('../src/core/db/fluDatabase.js', () => ({ fluDb: { contacts: { nombre: 'tabla-contactos' } } }));

vi.mock('../src/core/contacts/contactService.js', () => ({
    createContactService: (opciones: unknown) => {
        dobles.argumentos = opciones;
        dobles.crearServicio(opciones);
        return dobles.servicio;
    },
}));

import { useContacts } from '../src/hooks/useContacts.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

type Opciones = {
    now?: () => number;
};

const montar = (opciones: Opciones = {}) => renderHook(() => useContacts(opciones));

beforeEach(() => {
    dobles.crearServicio.mockClear();
    for (const fn of Object.values(dobles.servicio)) fn.mockClear();
    dobles.servicio.listContacts.mockResolvedValue([]);
    dobles.servicio.contactsWithBirthdayNear.mockResolvedValue([]);
    dobles.servicio.addContact.mockResolvedValue({ ok: true });
    dobles.servicio.updateContact.mockResolvedValue({ ok: true });
    dobles.servicio.removeContact.mockResolvedValue({ ok: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useContacts - arranque', () => {
    it('crea el servicio UNA vez con la tabla y los limites de la config', async () => {
        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(dobles.crearServicio).toHaveBeenCalledTimes(1);
        const opciones = dobles.argumentos as { db: unknown; config: Record<string, unknown> };
        expect(opciones.db).toEqual({ contacts: { nombre: 'tabla-contactos' } });
        expect(opciones.config.maxContacts).toBe((FLU_CONFIG.contacts as Record<string, unknown>).maxContacts);
        expect(opciones.config.birthdayWindowDays).toBe(
            (FLU_CONFIG.contacts as Record<string, unknown>).birthdayWindowDays,
        );
    });

    it('la carga inicial pide agenda y cumpleaños y termina en loading=false', async () => {
        dobles.servicio.listContacts.mockResolvedValue([{ id: 'c1', name: 'Luis' }]);
        dobles.servicio.contactsWithBirthdayNear.mockResolvedValue([{ record: { id: 'c1' }, daysUntil: 2 }]);

        const { result } = montar();

        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.contacts).toEqual([{ id: 'c1', name: 'Luis' }]);
        expect(result.current.birthdayNear).toEqual([{ record: { id: 'c1' }, daysUntil: 2 }]);
    });

    it('el reloj se inyecta (por defecto Date.now) y el servicio se expone', async () => {
        const ahora = () => 1234;
        const { result } = montar({ now: ahora });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const opciones = dobles.argumentos as { now: () => number };
        expect(opciones.now()).toBe(1234);
        expect(result.current.service).toBe(dobles.servicio);
    });

    it('un fallo de lectura se registra y NO deja loading colgado', async () => {
        dobles.servicio.listContacts.mockRejectedValue(new Error('dexie caido'));

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(console.error).toHaveBeenCalled();
        expect(result.current.contacts).toEqual([]);
    });
});

describe('useContacts - mutaciones', () => {
    it('un alta correcta refresca la agenda', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.listContacts.mock.calls.length;

        await result.current.addContact({ name: 'Luis' });

        expect(dobles.servicio.addContact).toHaveBeenCalledWith({ name: 'Luis' });
        expect(dobles.servicio.listContacts.mock.calls.length).toBe(lecturas + 1);
    });

    it('un alta fallida NO refresca nada', async () => {
        dobles.servicio.addContact.mockResolvedValue({ ok: false, reason: 'limit' } as never);
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.listContacts.mock.calls.length;

        const salida = await result.current.addContact({ name: 'Luis' });

        expect(salida).toEqual({ ok: false, reason: 'limit' });
        expect(dobles.servicio.listContacts.mock.calls.length).toBe(lecturas);
    });

    it('editar y borrar siguen la misma regla (refrescan solo si ok)', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.servicio.listContacts.mock.calls.length;

        await result.current.updateContact('c1', { phone: '600' });
        expect(dobles.servicio.listContacts.mock.calls.length).toBe(lecturas + 1);

        dobles.servicio.removeContact.mockResolvedValueOnce({ ok: false, reason: 'not-found' } as never);
        const salida = await result.current.removeContact('c1');

        expect(salida).toEqual({ ok: false, reason: 'not-found' });
        expect(dobles.servicio.listContacts.mock.calls.length).toBe(lecturas + 1);
    });

    it('las consultas pasan directas al servicio', async () => {
        dobles.servicio.getContact.mockResolvedValue({ id: 'c1', name: 'Luis' } as never);
        dobles.servicio.contactsWithBirthdayNear.mockResolvedValue([{ record: { id: 'c1' }, daysUntil: 1 }]);
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.contactsWithBirthdayNear.mockClear();

        expect(await result.current.getContact('c1')).toEqual({ id: 'c1', name: 'Luis' });
        await result.current.contactsWithBirthdayNear(999);

        expect(dobles.servicio.contactsWithBirthdayNear).toHaveBeenCalledWith(999);
    });

    it('refresh vuelve a leer las dos fuentes', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.listContacts.mockClear();
        dobles.servicio.contactsWithBirthdayNear.mockClear();

        await result.current.refresh();

        expect(dobles.servicio.listContacts).toHaveBeenCalledTimes(1);
        expect(dobles.servicio.contactsWithBirthdayNear).toHaveBeenCalledTimes(1);
    });
});
