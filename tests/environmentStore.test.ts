// @vitest-environment jsdom
// ============================================================
// environmentStore.test.ts — Store del AMBIENTE activo (zustand persist)
// ============================================================
// B7 (Q11 — Sistema de Ambientes): valida el store persistente
// `useEnvironmentStore` (`src/store/environmentStore.ts`):
//   - estado inicial = ambiente por defecto (`asistente`)
//   - setActiveAmbienteId: activa ids válidos, rechaza ids fuera del
//     catálogo (fallback seguro a `asistente`)
//   - resetAmbiente: regresa al ambiente por defecto
//   - persistencia: solo `activeAmbienteId` sobrevive en localStorage
//   - restauración (rehydrate) y blindaje del merge ante ids inválidos
// Mismo patrón que documentGenerationStore.test.ts (localStorage + reset
// en beforeEach). Sin hardcode: usa DEFAULT_AMBIENTE_ID del catálogo.
// ============================================================
import { describe, test, expect, beforeEach } from 'vitest';
import { useEnvironmentStore } from '../src/store/environmentStore';
import { DEFAULT_AMBIENTE_ID } from '../src/core/environments/environmentRegistry';

const STORE_KEY = 'flu-environment-store';

function resetStore(): void {
    useEnvironmentStore.setState({ activeAmbienteId: DEFAULT_AMBIENTE_ID });
}

/** Lee el estado persistido en localStorage (formato zustand persist). */
function readPersisted(): { activeAmbienteId: string } {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
    const persisted = raw.state || raw;
    return persisted as { activeAmbienteId: string };
}

describe('environmentStore', () => {
    beforeEach(() => {
        window.localStorage.removeItem(STORE_KEY);
        resetStore();
    });

    test('el estado inicial es el ambiente por defecto', () => {
        expect(useEnvironmentStore.getState().activeAmbienteId).toBe(DEFAULT_AMBIENTE_ID);
    });

    test('setActiveAmbienteId activa un ambiente válido del catálogo', () => {
        useEnvironmentStore.getState().setActiveAmbienteId('chef');
        expect(useEnvironmentStore.getState().activeAmbienteId).toBe('chef');
    });

    test('setActiveAmbienteId rechaza ids fuera del catálogo (fallback a por defecto)', () => {
        useEnvironmentStore.getState().setActiveAmbienteId('no-existe');
        expect(useEnvironmentStore.getState().activeAmbienteId).toBe(DEFAULT_AMBIENTE_ID);
    });

    test('resetAmbiente regresa al ambiente por defecto', () => {
        useEnvironmentStore.getState().setActiveAmbienteId('bienestar');
        useEnvironmentStore.getState().resetAmbiente();
        expect(useEnvironmentStore.getState().activeAmbienteId).toBe(DEFAULT_AMBIENTE_ID);
    });

    test('persiste el ambiente activo en localStorage (partialize)', () => {
        useEnvironmentStore.getState().setActiveAmbienteId('jardinero');
        expect(readPersisted().activeAmbienteId).toBe('jardinero');
    });

    test('solo activeAmbienteId se persiste (partialize no guarda acciones)', () => {
        useEnvironmentStore.getState().setActiveAmbienteId('chef');
        expect(Object.keys(readPersisted())).toEqual(['activeAmbienteId']);
    });

    test('rehydrate restaura el ambiente persistido', async () => {
        window.localStorage.setItem(
            STORE_KEY,
            JSON.stringify({ state: { activeAmbienteId: 'bricolaje' }, version: 1 }),
        );
        await useEnvironmentStore.persist.rehydrate();
        expect(useEnvironmentStore.getState().activeAmbienteId).toBe('bricolaje');
    });

    test('el merge preserva un id persistido válido', async () => {
        window.localStorage.setItem(
            STORE_KEY,
            JSON.stringify({ state: { activeAmbienteId: 'bienestar' }, version: 1 }),
        );
        await useEnvironmentStore.persist.rehydrate();
        expect(useEnvironmentStore.getState().activeAmbienteId).toBe('bienestar');
    });

    test('el merge corrige un id persistido inválido a por defecto', async () => {
        window.localStorage.setItem(
            STORE_KEY,
            JSON.stringify({ state: { activeAmbienteId: 'no-existe' }, version: 1 }),
        );
        await useEnvironmentStore.persist.rehydrate();
        expect(useEnvironmentStore.getState().activeAmbienteId).toBe(DEFAULT_AMBIENTE_ID);
    });
});
