// @vitest-environment jsdom
/**
 * useParticipants - el registro de participantes sobre Dexie (0%).
 *
 * POR QUE ESTE TEST: 200 lineas que gobiernan quien existe en la casa: siembra el
 * perfil ANONIMO al arrancar, registra/actualiza/borra y —lo mas delicado— al
 * borrar limpia el estado huerfano (onboarding per-user + ACTIVE_USER) para que un
 * usuario eliminado no reaparezca. Se sustituyen las fronteras (tablas Dexie, el
 * registro y el gateway de onboarding) y se comprueba esa politica.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
    crearRegistro: vi.fn(),
    crearOnboarding: vi.fn(),
    registro: {
        list: vi.fn(async () => [] as unknown[]),
        seedAnonymous: vi.fn(async () => undefined as unknown),
        findAnonymous: vi.fn(async () => undefined as unknown),
        register: vi.fn(async () => ({ ok: true })),
        upsert: vi.fn(async () => ({ ok: true })),
        remove: vi.fn(async () => true),
        resolveParticipantBySpeakerLabel: vi.fn(async () => undefined as unknown),
        participantsWithBirthdayNear: vi.fn(async () => [] as unknown[]),
        resolveTtsVoice: vi.fn(() => ({ voice: 'base' })),
    },
    onboarding: { reset: vi.fn(async () => {}) },
    argumentos: null as unknown,
}));

vi.mock('../src/core/db/fluDatabase.js', () => ({
    fluDb: { participants: { nombre: 'tabla-participantes' }, onboardingStates: { nombre: 'tabla-onboarding' } },
}));

vi.mock('../src/core/multiuser/participantRegistry.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/multiuser/participantRegistry.js')>();
    return {
        // Misma constante que el modulo real (una sola fuente del nombre del canal).
        PARTICIPANTS_CHANGED_CHANNEL: actual.PARTICIPANTS_CHANGED_CHANNEL,
        createParticipantRegistry: (opciones: unknown) => {
            dobles.argumentos = opciones;
            dobles.crearRegistro(opciones);
            return dobles.registro;
        },
        resolveKindRole: () => 'Estudiante',
    };
});

vi.mock('../src/core/onboarding/onboardingService.js', () => ({
    createOnboardingService: (opciones: unknown) => {
        dobles.crearOnboarding(opciones);
        return dobles.onboarding;
    },
}));

import { useParticipants } from '../src/hooks/useParticipants.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import { localGet, localSet } from '../src/core/storage/localStore.js';
import { STORAGE_KEYS } from '../src/core/config/appConfig.js';

const multi = FLU_CONFIG.multiuser as unknown as Record<string, unknown>;

const montar = () => renderHook(() => useParticipants());

beforeEach(() => {
    dobles.crearRegistro.mockClear();
    dobles.crearOnboarding.mockClear();
    for (const fn of Object.values(dobles.registro)) fn.mockClear();
    dobles.onboarding.reset.mockClear();
    dobles.registro.list.mockResolvedValue([]);
    dobles.registro.seedAnonymous.mockResolvedValue(undefined);
    dobles.registro.register.mockResolvedValue({ ok: true });
    dobles.registro.upsert.mockResolvedValue({ ok: true });
    dobles.registro.remove.mockResolvedValue(true);
    localSet(STORAGE_KEYS.ACTIVE_USER, '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useParticipants - arranque y siembra', () => {
    it('crea el registro con la tabla y la config (roles, voz, anonimo)', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(dobles.crearRegistro).toHaveBeenCalledTimes(1);
        const opciones = dobles.argumentos as { db: unknown; config: Record<string, unknown> };
        expect(opciones.db).toEqual({ nombre: 'tabla-participantes' });
        expect(opciones.config.roles).toEqual(multi.roles);
        expect(opciones.config.birthdayAdvanceDays).toBe(Number(multi.birthdayAdvanceDays) || 7);
        expect((opciones.config.anonymous as { name: string }).name).toBe(
            String((multi.skipDefaults as Record<string, unknown>).anonymousName),
        );
        expect(result.current.service).toBe(dobles.registro);
    });

    it('al arrancar siembra el anonimo y DESPUES refresca', async () => {
        const orden: string[] = [];
        dobles.registro.seedAnonymous.mockImplementation(async () => {
            orden.push('seed');
            return undefined;
        });
        dobles.registro.list.mockImplementation(async () => {
            orden.push('list');
            return [];
        });

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(orden).toEqual(['seed', 'list']);
    });

    it('si la siembra falla, el listado se carga igual y se registra el fallo', async () => {
        dobles.registro.seedAnonymous.mockRejectedValue(new Error('dexie caido'));
        dobles.registro.list.mockResolvedValue([{ id: 'p1', name: 'Luis' }]);

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(console.error).toHaveBeenCalled();
        expect(result.current.participants).toEqual([{ id: 'p1', name: 'Luis' }]);
    });

    it('un fallo de listado no deja loading colgado', async () => {
        dobles.registro.list.mockRejectedValue(new Error('dexie caido'));

        const { result } = montar();

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.participants).toEqual([]);
    });

    it('seedAnonymous devuelve el perfil y refresca solo si sembro algo', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.registro.list.mockClear();

        dobles.registro.seedAnonymous.mockResolvedValueOnce(undefined);
        await result.current.seedAnonymous();
        expect(dobles.registro.list).not.toHaveBeenCalled();

        dobles.registro.seedAnonymous.mockResolvedValueOnce({ id: 'anon' });
        const sembrado = await result.current.seedAnonymous();
        expect(sembrado).toEqual({ id: 'anon' });
        expect(dobles.registro.list).toHaveBeenCalledTimes(1);
    });
});

describe('useParticipants - mutaciones', () => {
    it('registrar refresca solo si fue bien', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.registro.list.mock.calls.length;

        dobles.registro.register.mockResolvedValueOnce({ ok: false, reason: 'duplicate' } as never);
        await result.current.register({ name: 'Luis' });
        expect(dobles.registro.list.mock.calls.length).toBe(lecturas);

        dobles.registro.register.mockResolvedValueOnce({ ok: true });
        await result.current.register({ name: 'Luis' });
        expect(dobles.registro.list.mock.calls.length).toBe(lecturas + 1);
    });

    it('upsert sigue la misma regla', async () => {
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.registro.list.mock.calls.length;

        await result.current.upsert('p1', { role: 'Padre' });

        expect(dobles.registro.upsert).toHaveBeenCalledWith('p1', { role: 'Padre' });
        expect(dobles.registro.list.mock.calls.length).toBe(lecturas + 1);
    });

    it('borrar limpia el onboarding del usuario y el ACTIVE_USER si era el activo', async () => {
        localSet(STORAGE_KEYS.ACTIVE_USER, 'p1');
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const { removed: borrado, wasActive } = await result.current.remove('p1');

        expect(borrado).toBe(true);
        expect(wasActive).toBe(true);
        expect(dobles.onboarding.reset).toHaveBeenCalledWith('p1');
        expect(localGet(STORAGE_KEYS.ACTIVE_USER)).not.toBe('p1');
        expect(dobles.registro.list).toHaveBeenCalled();
    });

    it('borrar NO toca el ACTIVE_USER de otra persona', async () => {
        localSet(STORAGE_KEYS.ACTIVE_USER, 'p2');
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const { wasActive } = await result.current.remove('p1');

        expect(wasActive).toBe(false);
        expect(localGet(STORAGE_KEYS.ACTIVE_USER)).toBe('p2');
    });

    it('si el borrado falla no limpia nada ni refresca', async () => {
        dobles.registro.remove.mockResolvedValueOnce(false);
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        const lecturas = dobles.registro.list.mock.calls.length;

        const { removed: borrado } = await result.current.remove('p1');

        expect(borrado).toBe(false);
        expect(dobles.onboarding.reset).not.toHaveBeenCalled();
        expect(dobles.registro.list.mock.calls.length).toBe(lecturas);
    });

    it('un fallo al limpiar el onboarding no impide borrar el participante', async () => {
        dobles.onboarding.reset.mockRejectedValueOnce(new Error('gateway roto'));
        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const { removed: borrado } = await result.current.remove('p1');

        expect(borrado).toBe(true);
        expect(console.error).toHaveBeenCalled();
    });
});

describe('useParticipants - consultas', () => {
    it('pasan directas al registro (hablante, cumpleaños, voz, anonimo)', async () => {
        dobles.registro.resolveParticipantBySpeakerLabel.mockResolvedValue({ id: 'p1' });
        dobles.registro.participantsWithBirthdayNear.mockResolvedValue([{ id: 'p1' }]);
        dobles.registro.findAnonymous.mockResolvedValue({ id: 'anon' });
        dobles.registro.resolveTtsVoice.mockReturnValue({ voice: 'ana' });

        const { result } = montar();
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        dobles.registro.participantsWithBirthdayNear.mockClear();

        expect(await result.current.resolveParticipantBySpeakerLabel('Hablante_1')).toEqual({ id: 'p1' });
        await result.current.participantsWithBirthdayNear(1000);
        expect(await result.current.findAnonymous()).toEqual({ id: 'anon' });
        expect(result.current.resolveTtsVoice()).toEqual({ voice: 'ana' });

        expect(dobles.registro.participantsWithBirthdayNear).toHaveBeenCalledWith(1000);
        expect(dobles.registro.resolveParticipantBySpeakerLabel).toHaveBeenCalledWith('Hablante_1');
    });
});
