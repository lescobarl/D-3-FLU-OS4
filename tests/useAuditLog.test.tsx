// @vitest-environment jsdom
/**
 * useAuditLog - el log de auditoria persistente sobre Dexie (0%).
 *
 * POR QUE ESTE TEST: el hook es el unico consumidor del log de auditoria (Obligacion
 * #5). Se sustituyen las fronteras (los helpers de Dexie y el registro de excepciones,
 * ambos con test propio) y se comprueba su politica real: carga al montar con tope
 * 200, refresh que reemplaza la lista, fallo que se registra sin colgar loading,
 * logChange/logEvent que anteponen la entrada devuelta y clearAll que vacia estado.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    addAuditLog: vi.fn(),
    getAuditLogs: vi.fn(),
    clearAuditLogs: vi.fn(),
    logCaughtError: vi.fn(),
}));

vi.mock('../src/core/db/fluDatabase.js', () => ({
    addAuditLog: dobles.addAuditLog,
    getAuditLogs: dobles.getAuditLogs,
    clearAuditLogs: dobles.clearAuditLogs,
}));

vi.mock('../src/lib/caughtError.js', () => ({ logCaughtError: dobles.logCaughtError }));

import { useAuditLog } from '../src/hooks/useAuditLog.js';
import type { AuditLogEntry } from '../src/core/db/fluDatabase.js';

/** Entrada de auditoria minima; el hook solo la transporta. */
const entrada = (id: string, extra: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
    id,
    action: 'config:change',
    entity: 'config',
    entityId: 'c1',
    previousValue: null,
    newValue: null,
    context: '',
    timestamp: '2026-10-02T00:00:00.000Z',
    sync: { revision: 1, updated_at: '2026-10-02T00:00:00.000Z', deleted: false },
    ...extra,
});

const montar = () => renderHook(() => useAuditLog());

beforeEach(() => {
    dobles.addAuditLog.mockReset();
    dobles.getAuditLogs.mockReset();
    dobles.clearAuditLogs.mockReset();
    dobles.logCaughtError.mockReset();
    dobles.getAuditLogs.mockResolvedValue([]);
    dobles.clearAuditLogs.mockResolvedValue(undefined);
});

// ------------------------------------------------------------
// Bloque: carga inicial y refresh (lectura desde Dexie)
// ------------------------------------------------------------
describe('useAuditLog - carga', () => {
    it('carga los logs al montar con tope 200 y termina en loading=false', async () => {
        dobles.getAuditLogs.mockResolvedValue([entrada('a1')]);

        const { result } = montar();

        expect(result.current.loading).toBe(true);
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(dobles.getAuditLogs).toHaveBeenCalledWith(200);
        expect(result.current.logs).toEqual([entrada('a1')]);
    });

    it('refresh vuelve a consultar y reemplaza la lista', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        dobles.getAuditLogs.mockResolvedValue([entrada('b2')]);
        await act(async () => {
            await result.current.refresh();
        });

        expect(dobles.getAuditLogs).toHaveBeenCalledTimes(2);
        expect(result.current.logs).toEqual([entrada('b2')]);
    });

    it('un fallo de carga se registra, deja loading=false y no revienta', async () => {
        dobles.getAuditLogs.mockRejectedValue(new Error('dexie caido'));

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(dobles.logCaughtError).toHaveBeenCalled();
        expect(result.current.logs).toEqual([]);
    });
});

// ------------------------------------------------------------
// Bloque: registro de cambios y eventos (escritura)
// ------------------------------------------------------------
describe('useAuditLog - registro', () => {
    it('logChange registra el cambio, lo antepone y lo devuelve', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.addAuditLog.mockResolvedValue(entrada('x1'));

        let devuelto: AuditLogEntry | undefined;
        await act(async () => {
            devuelto = await result.current.logChange('config', 'c1', { a: 1 }, { a: 2 }, 'ctx');
        });

        expect(dobles.addAuditLog).toHaveBeenCalledWith('config:change', 'config', 'c1', { a: 1 }, { a: 2 }, 'ctx');
        expect(devuelto).toEqual(entrada('x1'));
        expect(result.current.logs[0]).toEqual(entrada('x1'));
    });

    it('logEvent usa previousValue null y el payload como newValue', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.addAuditLog.mockResolvedValue(entrada('e1', { action: 'participant:add' }));

        await act(async () => {
            await result.current.logEvent('participant:add', 'participant', 'p1', { name: 'Ana' }, 'alta');
        });

        expect(dobles.addAuditLog).toHaveBeenCalledWith(
            'participant:add',
            'participant',
            'p1',
            null,
            { name: 'Ana' },
            'alta',
        );
    });

    it('sin contexto explicito registra cadena vacia', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.addAuditLog.mockResolvedValue(entrada('c9'));

        await act(async () => {
            await result.current.logChange('config', 'c1', 1, 2);
        });

        expect(dobles.addAuditLog).toHaveBeenCalledWith('config:change', 'config', 'c1', 1, 2, '');
    });

    it('los registros nuevos se anteponen a los ya cargados', async () => {
        dobles.getAuditLogs.mockResolvedValue([entrada('viejo')]);
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        dobles.addAuditLog.mockResolvedValueOnce(entrada('n1'));
        dobles.addAuditLog.mockResolvedValueOnce(entrada('n2'));
        await act(async () => {
            await result.current.logChange('config', 'a', 1, 2);
        });
        await act(async () => {
            await result.current.logEvent('config:change', 'config', 'b', 3);
        });

        expect(result.current.logs.map((l) => l.id)).toEqual(['n2', 'n1', 'viejo']);
    });
});

// ------------------------------------------------------------
// Bloque: limpieza del log
// ------------------------------------------------------------
describe('useAuditLog - limpieza', () => {
    it('clearAll vacia el log persistido y el estado en memoria', async () => {
        dobles.getAuditLogs.mockResolvedValue([entrada('a1')]);
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.logs).toHaveLength(1);

        await act(async () => {
            await result.current.clearAll();
        });

        expect(dobles.clearAuditLogs).toHaveBeenCalledTimes(1);
        expect(result.current.logs).toEqual([]);
        expect(dobles.getAuditLogs).toHaveBeenCalledTimes(1);
    });
});
