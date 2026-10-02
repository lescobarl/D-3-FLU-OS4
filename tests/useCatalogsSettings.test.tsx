// @vitest-environment jsdom
/**
 * useCatalogsSettings - el espejo React de los catalogos de Ajustes (0%).
 *
 * POR QUE ESTE TEST: estas 275 lineas son las que hacen que el panel de Ajustes
 * vea los ambientes/paletas BUILT-IN + los DINAMICOS, y las que REACTIVAN cuando
 * el activo se renombra. Nadie lo ejecutaba. Aqui se sustituye la FRONTERA (los
 * catalogos Dexie y el tema del ambiente) por dobles, y se ejercita la conducta:
 * que ids son dinamicos, que se hidrata al montar, cuando se reactiva
 * (renombre del activo) y cuando se resetea (borrado del activo), ademas del
 * orden de las acciones de temporada.
 *
 * HALLAZGO DECLARADO: la app arranca con `FLU_CONFIG.debug.micConsolePanel` al
 * margen; lo relevante aqui es que el efecto de montaje NO cancela el refresco si
 * el hook se desmonta antes de que la hidratacion termine (solo `active`), asi que
 * el estado se refresca igualmente (inofensivo, pero se deja escrito).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const est = vi.hoisted(() => ({
    ambientes: [] as { id: string }[],
    paletas: [] as { id: string }[],
    persistedId: null as string | null,
    hydrateAmbientes: vi.fn(async () => {}),
    hydratePalettes: vi.fn(async () => {}),
    registerAmbiente: vi.fn(async () => ({ ok: true as const, record: { data: { id: 'x' } } })),
    updateAmbiente: vi.fn(async () => ({ ok: true as const, record: { data: { id: 'x' } } })),
    removeAmbiente: vi.fn(async () => true),
    registerPaleta: vi.fn(async () => ({ ok: true as const, record: { data: { id: 'p' } } })),
    updatePaleta: vi.fn(async () => ({ ok: true as const, record: { data: { id: 'p' } } })),
    removePaleta: vi.fn(async () => true),
    applyEnvironment: vi.fn((id: string) => ({ id, bienvenida: { es: `hola-${id}`, en: `hi-${id}` } })),
    resetEnvironment: vi.fn(),
}));

vi.mock('../src/core/environments/environmentRegistry.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/core/environments/environmentRegistry.js')>();
    return { ...real, getAmbientes: () => est.ambientes };
});

vi.mock('../src/core/branding/seasonalPalettes.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/core/branding/seasonalPalettes.js')>();
    return { ...real, getAllPalettes: () => est.paletas };
});

vi.mock('../src/core/environments/ambientesCatalog.js', () => ({
    hydrateAmbientes: est.hydrateAmbientes,
    registerAmbiente: est.registerAmbiente,
    updateAmbiente: est.updateAmbiente,
    removeAmbiente: est.removeAmbiente,
}));

vi.mock('../src/core/branding/paletasCatalog.js', () => ({
    hydratePalettes: est.hydratePalettes,
    registerPaleta: est.registerPaleta,
    updatePaleta: est.updatePaleta,
    removePaleta: est.removePaleta,
}));

vi.mock('../src/core/environments/applyEnvironment.js', () => ({
    applyEnvironment: est.applyEnvironment,
    resetEnvironment: est.resetEnvironment,
}));

vi.mock('../src/store/environmentStore.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/store/environmentStore.js')>();
    return { ...real, readPersistedActiveAmbienteId: () => est.persistedId };
});

import { useCatalogsSettings } from '../src/hooks/useCatalogsSettings.js';
import { useEnvironmentStore } from '../src/store/environmentStore.js';
import { ENVIRONMENTS } from '../src/core/environments/environmentRegistry.js';
import { builtinPaletteEntries } from '../src/core/branding/seasonalPalettes.js';

const BUILTIN_AMBIENTE = 'chef';
const BUILTIN_PALETA = builtinPaletteEntries()[0].id;

const marca = () => ({
    config: { activeSeason: BUILTIN_PALETA },
    seasonalActions: {
        setMode: vi.fn(async () => {}),
        setActiveSeason: vi.fn(async () => {}),
    },
});

const montar = (over: { activeAmbienteId?: string; branding?: ReturnType<typeof marca> } = {}) => {
    const branding = over.branding ?? marca();
    const languageRef = { current: 'en' };
    const speakFluRef = { current: vi.fn(async () => {}) };
    const activo = over.activeAmbienteId ?? BUILTIN_AMBIENTE;
    useEnvironmentStore.setState({ activeAmbienteId: activo });
    const vista = renderHook(() =>
        useCatalogsSettings({ activeAmbienteId: activo, languageRef, speakFluRef, branding } as never),
    );
    return { ...vista, branding, languageRef, speakFluRef };
};

beforeEach(() => {
    est.ambientes = [{ id: BUILTIN_AMBIENTE }];
    est.paletas = [{ id: BUILTIN_PALETA }];
    est.persistedId = null;
    for (const espia of [
        est.hydrateAmbientes,
        est.hydratePalettes,
        est.registerAmbiente,
        est.updateAmbiente,
        est.removeAmbiente,
        est.registerPaleta,
        est.updatePaleta,
        est.removePaleta,
        est.applyEnvironment,
        est.resetEnvironment,
    ]) {
        espia.mockClear();
    }
    est.applyEnvironment.mockImplementation((id: string) => ({
        id,
        bienvenida: { es: `hola-${id}`, en: `hi-${id}` },
    }));
    est.updateAmbiente.mockImplementation(async () => ({ ok: true as const, record: { data: { id: 'x' } } }));
    est.updatePaleta.mockImplementation(async () => ({ ok: true as const, record: { data: { id: 'p' } } }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useCatalogsSettings - catalogo y ids dinamicos', () => {
    it('al montar devuelve los dos catalogos y hidrata una vez cada uno', async () => {
        const { result } = montar();

        expect(result.current.ambientes).toEqual([{ id: BUILTIN_AMBIENTE }]);
        expect(result.current.paletas).toEqual([{ id: BUILTIN_PALETA }]);
        await waitFor(() => {
            expect(est.hydrateAmbientes).toHaveBeenCalledTimes(1);
        });
        expect(est.hydratePalettes).toHaveBeenCalledTimes(1);
    });

    it('los ids dinamicos son los que NO son built-in (y aparecen al refrescar)', async () => {
        est.persistedId = null;
        const { result } = montar();

        expect(result.current.dynamicAmbienteIds.size).toBe(0);
        expect(result.current.dynamicPaletaIds.size).toBe(0);

        est.ambientes = [{ id: BUILTIN_AMBIENTE }, { id: 'mi-ambiente' }];
        est.paletas = [{ id: BUILTIN_PALETA }, { id: 'mi-paleta' }];

        await act(async () => {
            await result.current.handleRegisterAmbiente({ id: 'mi-ambiente' } as never);
        });
        await act(async () => {
            await result.current.handleRegisterPaleta({ id: 'mi-paleta' } as never);
        });

        expect([...result.current.dynamicAmbienteIds]).toEqual(['mi-ambiente']);
        expect([...result.current.dynamicPaletaIds]).toEqual(['mi-paleta']);
        expect(result.current.ambientes).toHaveLength(2);
    });

    it('la hidratacion del arranque refresca el catalogo ya en pantalla', async () => {
        est.hydrateAmbientes.mockImplementationOnce(async () => {
            est.ambientes = [{ id: BUILTIN_AMBIENTE }, { id: 'hidratado' }];
        });
        est.hydratePalettes.mockImplementationOnce(async () => {
            est.paletas = [{ id: BUILTIN_PALETA }, { id: 'paleta-hidratada' }];
        });

        const { result } = montar();

        // Antes de que la hidratacion termine, el espejo solo tiene los built-ins.
        expect(result.current.dynamicAmbienteIds.size).toBe(0);

        await waitFor(() => {
            expect(result.current.dynamicAmbienteIds.has('hidratado')).toBe(true);
        });
        expect(result.current.dynamicPaletaIds.has('paleta-hidratada')).toBe(true);
    });

    it('un built-in nunca cuenta como dinamico', async () => {
        est.ambientes = [...ENVIRONMENTS.map((e) => ({ id: e.id })), { id: 'solo-esto' }];
        const { result } = montar();

        expect([...result.current.dynamicAmbienteIds]).toEqual(['solo-esto']);
    });

    it('si la hidratacion falla, se registra y el hook sigue con los built-ins', async () => {
        est.hydrateAmbientes.mockRejectedValueOnce(new Error('dexie caido'));
        const { result } = montar();

        await waitFor(() => {
            expect(console.error).toHaveBeenCalled();
        });
        expect(result.current.ambientes).toEqual([{ id: BUILTIN_AMBIENTE }]);
    });
});

describe('useCatalogsSettings - ambiente activo', () => {
    it('el ambiente persistido se aplica al hidratar si difiere y es valido', async () => {
        est.persistedId = BUILTIN_AMBIENTE;
        montar({ activeAmbienteId: 'otro' });

        await waitFor(() => {
            expect(est.applyEnvironment).toHaveBeenCalledWith(BUILTIN_AMBIENTE);
        });
    });

    it('no se aplica si es el mismo o si no es un id de ambiente', async () => {
        est.persistedId = BUILTIN_AMBIENTE;
        const { unmount } = montar({ activeAmbienteId: BUILTIN_AMBIENTE });
        await waitFor(() => {
            expect(est.hydratePalettes).toHaveBeenCalled();
        });
        expect(est.applyEnvironment).not.toHaveBeenCalled();
        unmount();

        est.persistedId = 'no-existe';
        montar({ activeAmbienteId: 'otro' });
        await waitFor(() => {
            expect(est.hydratePalettes).toHaveBeenCalledTimes(2);
        });
        expect(est.applyEnvironment).not.toHaveBeenCalled();
    });

    it('activar habla la bienvenida en el idioma actual', async () => {
        const { result, speakFluRef, languageRef } = montar();
        languageRef.current = 'en';

        await act(async () => {
            await result.current.handleActivateAmbiente('chef');
        });

        expect(est.applyEnvironment).toHaveBeenCalledWith('chef');
        expect(speakFluRef.current).toHaveBeenCalledWith('hi-chef', 'en');
    });

    it('si activar revienta, se registra y no se propaga', async () => {
        est.applyEnvironment.mockImplementationOnce(() => {
            throw new Error('sin ambiente');
        });
        const { result } = montar();

        await act(async () => {
            await result.current.handleActivateAmbiente('chef');
        });

        expect(console.error).toHaveBeenCalled();
    });
});

describe('useCatalogsSettings - CRUD de ambientes', () => {
    it('registrar delega, refresca y devuelve el resultado', async () => {
        const { result } = montar();

        const salida = await act(async () => result.current.handleRegisterAmbiente({ id: 'nuevo' } as never));

        expect(est.registerAmbiente).toHaveBeenCalledWith({ id: 'nuevo' });
        expect(salida).toMatchObject({ ok: true });
    });

    it('renombrar el ambiente ACTIVO lo reactiva con el id nuevo', async () => {
        est.updateAmbiente.mockResolvedValueOnce({
            ok: true as const,
            record: { data: { id: 'renombrado' } },
        } as never);
        const { result } = montar({ activeAmbienteId: 'chef' });

        await act(async () => {
            await result.current.handleUpdateAmbiente('chef', { id: 'renombrado' } as never);
        });

        expect(est.applyEnvironment).toHaveBeenCalledWith('renombrado');
    });

    it('renombrar uno que NO es el activo (o sin cambiar el id) no reactiva nada', async () => {
        const { result } = montar({ activeAmbienteId: 'chef' });

        await act(async () => {
            await result.current.handleUpdateAmbiente('otro', { id: 'renombrado' } as never);
        });
        expect(est.applyEnvironment).not.toHaveBeenCalled();

        // El activo se edita pero su id canonico NO cambia: nada que reactivar.
        est.updateAmbiente.mockResolvedValueOnce({
            ok: true as const,
            record: { data: { id: 'chef' } },
        } as never);
        await act(async () => {
            await result.current.handleUpdateAmbiente('chef', { id: 'chef' } as never);
        });
        expect(est.applyEnvironment).not.toHaveBeenCalled();
    });

    it('borrar el ambiente ACTIVO resetea EL PRIMERO y luego borra', async () => {
        const orden: string[] = [];
        est.resetEnvironment.mockImplementation(() => {
            orden.push('reset');
        });
        est.removeAmbiente.mockImplementation(async () => {
            orden.push('remove');
            return true;
        });
        const { result } = montar({ activeAmbienteId: 'chef' });

        await act(async () => {
            await result.current.handleRemoveAmbiente('chef');
        });

        expect(orden).toEqual(['reset', 'remove']);
    });

    it('borrar uno que no esta activo no resetea', async () => {
        const { result } = montar({ activeAmbienteId: 'chef' });

        await act(async () => {
            await result.current.handleRemoveAmbiente('otro');
        });

        expect(est.removeAmbiente).toHaveBeenCalledWith('otro');
        expect(est.resetEnvironment).not.toHaveBeenCalled();
    });
});

describe('useCatalogsSettings - CRUD de paletas y temporada', () => {
    it('activar una temporada pone el modo manual y despues la temporada (en ese orden)', async () => {
        const { result, branding } = montar();

        await act(async () => {
            await result.current.handleActivatePaleta('navidad');
        });

        expect(branding.seasonalActions.setMode).toHaveBeenCalledWith('manual');
        expect(branding.seasonalActions.setActiveSeason).toHaveBeenCalledWith('navidad');
        const modo = branding.seasonalActions.setMode.mock.invocationCallOrder[0];
        const temporada = branding.seasonalActions.setActiveSeason.mock.invocationCallOrder[0];
        expect(modo).toBeLessThan(temporada);
    });

    it('renombrar la temporada ACTIVA la reactiva con el id nuevo', async () => {
        est.updatePaleta.mockResolvedValueOnce({
            ok: true as const,
            record: { data: { id: 'renombrada' } },
        } as never);
        const { result, branding } = montar();

        await act(async () => {
            await result.current.handleUpdatePaleta(BUILTIN_PALETA, { id: 'renombrada' } as never);
        });

        expect(branding.seasonalActions.setMode).toHaveBeenCalledWith('manual');
        expect(branding.seasonalActions.setActiveSeason).toHaveBeenCalledWith('renombrada');
    });

    it('renombrar una temporada que NO esta activa solo refresca', async () => {
        est.updatePaleta.mockResolvedValueOnce({
            ok: true as const,
            record: { data: { id: 'renombrada' } },
        } as never);
        const { result, branding } = montar();
        branding.config.activeSeason = 'otra-temporada';

        await act(async () => {
            await result.current.handleUpdatePaleta('una-tercera', { id: 'renombrada' } as never);
        });

        expect(branding.seasonalActions.setMode).not.toHaveBeenCalled();
        expect(est.updatePaleta).toHaveBeenCalledWith('una-tercera', { id: 'renombrada' });
    });

    it('registrar y borrar paletas delegan y refrescan', async () => {
        const { result } = montar();

        await act(async () => {
            await result.current.handleRegisterPaleta({ id: 'nueva' } as never);
        });
        await act(async () => {
            await result.current.handleRemovePaleta('nueva');
        });

        expect(est.registerPaleta).toHaveBeenCalledWith({ id: 'nueva' });
        expect(est.removePaleta).toHaveBeenCalledWith('nueva');
    });

    it('los handlers son estables entre renders (no se recrean)', async () => {
        const { result, rerender } = montar();
        const primero = result.current.handleActivatePaleta;

        rerender();

        expect(result.current.handleActivatePaleta).toBe(primero);
    });
});
