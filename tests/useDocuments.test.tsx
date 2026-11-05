// @vitest-environment jsdom
/**
 * useDocuments - historial de documentos aislado por usuario (0%).
 *
 * POR QUE ESTE TEST: el hook es el unico camino del historial de documentos en la
 * UI. Se sustituyen las fronteras (la tabla Dexie y el servicio, que tiene test
 * propio) y se comprueba su politica real: un unico servicio con la tabla y el
 * reloj, SIN usuario no se lee nada (el pizarron es por usuario), con usuario se
 * lista su alcance, add sella personId con el alcance salvo que venga explicito,
 * remove/add refrescan SOLO si la mutacion fue bien y cambiar de usuario re-lista.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crear: vi.fn(),
    opciones: null as unknown,
    servicio: {
        add: vi.fn(),
        list: vi.fn(),
        remove: vi.fn(),
    },
    logCaughtError: vi.fn(),
}));

vi.mock('../src/core/db/fluDatabase.js', () => ({ fluDb: { documents: { tabla: 'documents' } } }));

vi.mock('../src/core/documents/documentsService.js', () => ({
    createDocumentsService: (opciones: unknown) => {
        dobles.opciones = opciones;
        dobles.crear(opciones);
        return dobles.servicio;
    },
}));

vi.mock('../src/lib/caughtError.js', () => ({ logCaughtError: dobles.logCaughtError }));

import { useDocuments } from '../src/hooks/useDocuments.js';
import type { DocumentRecord } from '../src/core/db/fluDatabase.js';

/** DocumentRecord minimo; solo importan los campos que el hook transporta. */
const doc = (extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
    id: 'd1',
    kind: 'generated',
    formato: 'pdf',
    titulo: 'Carta',
    nombre: 'Carta.pdf',
    createdAt: 5,
    updatedAt: 5,
    sync: { revision: 1, updated_at: '2026-10-02T00:00:00.000Z', deleted: false },
    ...extra,
});

const montar = (props: { participantId?: string } = {}) =>
    renderHook((p: { participantId?: string }) => useDocuments(p), { initialProps: props });

beforeEach(() => {
    dobles.crear.mockClear();
    dobles.opciones = null;
    dobles.servicio.add.mockReset();
    dobles.servicio.list.mockReset();
    dobles.servicio.remove.mockReset();
    dobles.logCaughtError.mockReset();
    dobles.servicio.add.mockResolvedValue(null);
    dobles.servicio.list.mockResolvedValue([]);
    dobles.servicio.remove.mockResolvedValue(false);
});

// ------------------------------------------------------------
// Bloque: arranque y alcance por usuario
// ------------------------------------------------------------
describe('useDocuments - arranque', () => {
    it('crea un unico servicio con la tabla de documentos y el reloj', async () => {
        const { result } = montar({ participantId: 'p1' });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(dobles.crear).toHaveBeenCalledTimes(1);
        const opciones = dobles.opciones as { db: unknown; now: () => number };
        expect(opciones.db).toEqual({ tabla: 'documents' });
        expect(typeof opciones.now()).toBe('number');
        expect(result.current.service).toBe(dobles.servicio);
    });

    it('sin participante NO lee el historial y queda vacio', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(dobles.servicio.list).not.toHaveBeenCalled();
        expect(result.current.documents).toEqual([]);
    });

    it('con participante lista su alcance y termina en loading=false', async () => {
        dobles.servicio.list.mockResolvedValue([doc()]);

        const { result } = montar({ participantId: 'p1' });

        expect(result.current.loading).toBe(true);
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(dobles.servicio.list).toHaveBeenCalledWith('p1');
        expect(result.current.documents).toEqual([doc()]);
    });

    it('un fallo de lectura se registra y no deja loading colgado', async () => {
        dobles.servicio.list.mockRejectedValue(new Error('dexie caido'));

        const { result } = montar({ participantId: 'p1' });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(dobles.logCaughtError).toHaveBeenCalled();
        expect(result.current.documents).toEqual([]);
    });

    it('cambiar de participante vuelve a listar con el nuevo alcance', async () => {
        const { result, rerender } = montar({ participantId: 'p1' });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.list.mockClear();

        rerender({ participantId: 'p2' });

        await waitFor(() => {
            expect(dobles.servicio.list).toHaveBeenCalledWith('p2');
        });
    });

    it('el servicio se crea una sola vez aunque cambie el participante', async () => {
        const { rerender } = montar({ participantId: 'p1' });
        await waitFor(() => {
            expect(dobles.crear).toHaveBeenCalledTimes(1);
        });

        rerender({ participantId: 'p2' });

        await waitFor(() => {
            expect(dobles.servicio.list).toHaveBeenCalledWith('p2');
        });
        expect(dobles.crear).toHaveBeenCalledTimes(1);
    });
});

// ------------------------------------------------------------
// Bloque: alta y sellado de personId
// ------------------------------------------------------------
describe('useDocuments - alta', () => {
    it('add sella personId con el alcance y refresca', async () => {
        const { result } = montar({ participantId: 'p1' });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.list.mockClear();
        dobles.servicio.add.mockResolvedValue(doc({ personId: 'p1' }));

        let record: DocumentRecord | null = null;
        await act(async () => {
            record = await result.current.add({ kind: 'generated', formato: 'pdf', titulo: 'Carta' } as never);
        });

        expect(record).toEqual(doc({ personId: 'p1' }));
        expect(dobles.servicio.add).toHaveBeenCalledWith({
            kind: 'generated',
            formato: 'pdf',
            titulo: 'Carta',
            personId: 'p1',
        });
        expect(dobles.servicio.list).toHaveBeenCalledTimes(1);
    });

    it('add respeta un personId explicito y NO refresca si devuelve null', async () => {
        const { result } = montar({ participantId: 'p1' });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.list.mockClear();
        dobles.servicio.add.mockResolvedValue(null);

        let record: DocumentRecord | null = doc();
        await act(async () => {
            record = await result.current.add({
                kind: 'uploaded',
                formato: 'txt',
                titulo: 'Notas',
                personId: 'otro',
            } as never);
        });

        expect(record).toBeNull();
        expect(dobles.servicio.add).toHaveBeenCalledWith({
            kind: 'uploaded',
            formato: 'txt',
            titulo: 'Notas',
            personId: 'otro',
        });
        expect(dobles.servicio.list).not.toHaveBeenCalled();
    });

    it('sin participante el alta queda en el alcance global (personId indefinido)', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            await result.current.add({ kind: 'generated', formato: 'pdf', titulo: 'Carta' } as never);
        });

        expect(dobles.servicio.add).toHaveBeenCalledWith({
            kind: 'generated',
            formato: 'pdf',
            titulo: 'Carta',
            personId: undefined,
        });
    });
});

// ------------------------------------------------------------
// Bloque: baja (refresh solo si borro de verdad)
// ------------------------------------------------------------
describe('useDocuments - baja', () => {
    it('remove refresca solo cuando el borrado fue real', async () => {
        const { result } = montar({ participantId: 'p1' });
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.servicio.list.mockClear();

        dobles.servicio.remove.mockResolvedValue(false);
        let fallo = true;
        await act(async () => {
            fallo = await result.current.remove('d1');
        });
        expect(fallo).toBe(false);
        expect(dobles.servicio.list).not.toHaveBeenCalled();

        dobles.servicio.remove.mockResolvedValue(true);
        let ok = false;
        await act(async () => {
            ok = await result.current.remove('d2');
        });
        expect(ok).toBe(true);
        expect(dobles.servicio.list).toHaveBeenCalledTimes(1);
    });
});
