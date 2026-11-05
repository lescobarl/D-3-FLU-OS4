// @vitest-environment jsdom
// ============================================================
// useAgendaScope — la agenda es POR USUARIO: sin usuario real no hay
// lectura ni disparo (nada en el onboarding).
// ------------------------------------------------------------
// Bug real: durante el onboarding (id centinela 'default') se filtraba a
// 'global' y aparecían/sonaban ítems de otro alcance.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgenda } from '../src/hooks/useAgenda';
import type { AgendaItem } from '../src/core/agenda/agendaModel';

function item(id: string, personId?: string): AgendaItem {
    return {
        id,
        kind: 'recordatorio',
        label: id,
        personId,
        status: 'pending',
        trigger: { type: 'absolute', at: Date.now() + 60_000 },
        sync: { revision: 1, updated_at: '', deleted: false },
    };
}

const AUDIO_STUB = { start: () => undefined, stop: () => undefined, isSupported: () => false } as never;

function makeService(items: AgendaItem[]) {
    return {
        list: vi.fn(async () => items),
        complete: vi.fn(async () => ({ ok: true })),
        create: vi.fn(),
        update: vi.fn(),
        cancel: vi.fn(),
        restore: vi.fn(),
    };
}

describe('useAgenda — alcance por usuario', () => {
    it('sin usuario real NO lee la agenda (lista vacía, sin disparos)', async () => {
        const service = makeService([item('a', 'default')]);
        const { result } = renderHook(() =>
            useAgenda({ service: service as never, personId: undefined, onFire: () => undefined, audio: AUDIO_STUB, now: () => Date.now() }),
        );
        await waitFor(() => expect(result.current.items).toEqual([]));
        expect(service.list).not.toHaveBeenCalled();
    });

    it('con usuario real lee su agenda', async () => {
        const service = makeService([item('a', 'user-a')]);
        const { result } = renderHook(() =>
            useAgenda({ service: service as never, personId: 'user-a', onFire: () => undefined, audio: AUDIO_STUB, now: () => Date.now() }),
        );
        await waitFor(() => expect(result.current.items).toHaveLength(1));
        expect(service.list).toHaveBeenCalled();
    });
});
