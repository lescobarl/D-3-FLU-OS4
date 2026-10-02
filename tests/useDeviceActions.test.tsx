// @vitest-environment jsdom
/**
 * useDeviceActions - acciones de dispositivo sobre la agenda (0%).
 *
 * POR QUE ESTE TEST: es la unica frontera entre la UI de contactos y los esquemas
 * de URL del sistema (llamar, WhatsApp, SMS, correo). Se sustituyen las fronteras
 * (el servicio de acciones y el registro de excepciones, ambos con test propio) y
 * se comprueba su politica real: un servicio memoizado con el prefijo de pais
 * (prop > config > 52), resolucion de contacto por datos frescos de IndexedDB con
 * respaldo en memoria si falla o viene vacio, lanzador en pestana segura y
 * reconstruccion solo cuando cambian las dependencias.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crear: vi.fn(),
    opciones: null as unknown,
    servicio: { marca: 'device-actions' },
    matchContactName: vi.fn(),
    logCaughtError: vi.fn(),
}));

vi.mock('../src/core/deviceActions/deviceActionService.js', () => ({
    createDeviceActionService: (opciones: unknown) => {
        dobles.opciones = opciones;
        dobles.crear(opciones);
        return dobles.servicio;
    },
    matchContactName: dobles.matchContactName,
}));

vi.mock('../src/lib/caughtError.js', () => ({ logCaughtError: dobles.logCaughtError }));

import { useDeviceActions } from '../src/hooks/useDeviceActions.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import type { ContactRecord } from '../src/core/db/fluDatabase.js';

/** ContactRecord minimo; el hook solo lo transporta al matcher. */
const contacto = (id: string, name = 'Ana'): ContactRecord =>
    ({
        id,
        name,
        createdAt: 1,
        updatedAt: 1,
        sync: { revision: 1, updated_at: '2026-10-02T00:00:00.000Z', deleted: false },
    }) as unknown as ContactRecord;

interface OpcionesCapturadas {
    countryDial: string;
    resolveContact: (name: string) => Promise<unknown>;
    launch: (uri: string) => void;
}

const opciones = () => dobles.opciones as OpcionesCapturadas;

/** Doble de ContactService: solo se usa listContacts. */
const contactService = () => ({ listContacts: vi.fn() }) as unknown as never;

beforeEach(() => {
    dobles.crear.mockClear();
    dobles.opciones = null;
    dobles.matchContactName.mockReset();
    dobles.matchContactName.mockReturnValue(null);
    dobles.logCaughtError.mockReset();
    vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Bloque: creacion y prefijo de pais
// ------------------------------------------------------------
describe('useDeviceActions - creacion', () => {
    it('crea el servicio una vez y lo devuelve', () => {
        const service = contactService();
        const { result } = renderHook(() => useDeviceActions({ service }));

        expect(dobles.crear).toHaveBeenCalledTimes(1);
        expect(result.current.service).toBe(dobles.servicio);
    });

    it('sin countryDial usa el prefijo de la config', () => {
        const service = contactService();
        renderHook(() => useDeviceActions({ service }));

        expect(opciones().countryDial).toBe(
            (FLU_CONFIG.deviceActions as unknown as { countryDial: string }).countryDial,
        );
    });

    it('el countryDial explicito tiene prioridad sobre la config', () => {
        const service = contactService();
        renderHook(() => useDeviceActions({ service, countryDial: '34' }));

        expect(opciones().countryDial).toBe('34');
    });
});

// ------------------------------------------------------------
// Bloque: resolucion de contacto (frescura y respaldo)
// ------------------------------------------------------------
describe('useDeviceActions - resolucion de contacto', () => {
    it('usa los datos frescos de IndexedDB cuando hay contactos', async () => {
        const fresh = [contacto('c1')];
        const service = { listContacts: vi.fn(async () => fresh) } as unknown as never;
        dobles.matchContactName.mockReturnValue({ id: 'c1' });

        renderHook(() => useDeviceActions({ service, contacts: [contacto('memoria')] as never }));

        const resuelto = await opciones().resolveContact('Ana');

        expect(dobles.matchContactName).toHaveBeenCalledWith(fresh, 'Ana');
        expect(resuelto).toEqual({ id: 'c1' });
    });

    it('cae a la copia en memoria si IndexedDB lanza (y lo registra)', async () => {
        const memoria = [contacto('memoria')];
        const service = {
            listContacts: vi.fn(async () => {
                throw new Error('dexie caido');
            }),
        } as unknown as never;

        renderHook(() => useDeviceActions({ service, contacts: memoria }));

        await opciones().resolveContact('Ana');

        expect(dobles.logCaughtError).toHaveBeenCalledWith(
            '[useDeviceActions] listContacts error',
            expect.any(Error),
        );
        expect(dobles.matchContactName).toHaveBeenCalledWith(memoria, 'Ana');
    });

    it('cae a la copia en memoria si IndexedDB viene vacio', async () => {
        const memoria = [contacto('memoria')];
        const service = { listContacts: vi.fn(async () => []) } as unknown as never;

        renderHook(() => useDeviceActions({ service, contacts: memoria }));

        await opciones().resolveContact('Ana');

        expect(dobles.logCaughtError).not.toHaveBeenCalled();
        expect(dobles.matchContactName).toHaveBeenCalledWith(memoria, 'Ana');
    });
});

// ------------------------------------------------------------
// Bloque: lanzador en pestana segura
// ------------------------------------------------------------
describe('useDeviceActions - lanzador', () => {
    it('launch abre el esquema en pestana nueva sin opener', () => {
        const service = contactService();
        renderHook(() => useDeviceActions({ service }));

        opciones().launch('tel:+521234567890');

        expect(window.open).toHaveBeenCalledWith('tel:+521234567890', '_blank', 'noopener,noreferrer');
    });
});

// ------------------------------------------------------------
// Bloque: memoizacion (reconstruye solo si cambian las deps)
// ------------------------------------------------------------
describe('useDeviceActions - memoizacion', () => {
    it('no reconstruye el servicio entre renders equivalentes', () => {
        const service = contactService();
        const contacts = [contacto('c1')];
        const { rerender } = renderHook(
            (p: { service: never; contacts: never }) => useDeviceActions(p),
            { initialProps: { service, contacts: contacts as never } },
        );
        rerender({ service, contacts: contacts as never });

        expect(dobles.crear).toHaveBeenCalledTimes(1);
    });

    it('reconstruye el servicio cuando cambian los contactos', () => {
        const service = contactService();
        const { rerender } = renderHook(
            (p: { service: never; contacts: never }) => useDeviceActions(p),
            { initialProps: { service, contacts: [contacto('c1')] as never } },
        );
        rerender({ service, contacts: [contacto('c2')] as never });

        expect(dobles.crear).toHaveBeenCalledTimes(2);
    });

    it('reconstruye el servicio cuando cambia el countryDial', () => {
        const service = contactService();
        const { rerender } = renderHook(
            (p: { service: never; countryDial: string }) => useDeviceActions(p),
            { initialProps: { service, countryDial: '52' } },
        );
        rerender({ service, countryDial: '34' });

        expect(dobles.crear).toHaveBeenCalledTimes(2);
    });

    it('reconstruye el servicio cuando cambia el ContactService', () => {
        const { rerender } = renderHook(
            (p: { service: never }) => useDeviceActions(p),
            { initialProps: { service: contactService() } },
        );
        rerender({ service: contactService() });

        expect(dobles.crear).toHaveBeenCalledTimes(2);
    });
});
