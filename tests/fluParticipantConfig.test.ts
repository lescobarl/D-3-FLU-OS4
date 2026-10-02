// @vitest-environment jsdom
/**
 * fluParticipantConfig - los ajustes de participacion proactiva de Flu (0%).
 *
 * POR QUE ESTE TEST: estas 194 lineas son la puerta entre lo que el usuario
 * configura en la pantalla y lo que el participante usa de verdad, y nadie las
 * ejecutaba. Se prueban las reglas que importan: los VALORES POR DEFECTO salen de
 * la config (y si falta una clave, se avisa por su nombre), los overrides del
 * almacen se COERCIONAN (booleanos de texto, numeros recortados a su minimo y
 * maximo, duraciones en minutos <-> ms), la clave heredada `flu-participant-enabled`
 * manda sobre el JSON, y el reinicio deja los defaults.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localGet, localRemove, localSet } from '../src/core/storage/localStore.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import {
    FLU_PARTICIPANT_CONFIG_KEYS,
    FLU_PARTICIPANT_EDITABLE_FIELDS,
    FLU_PARTICIPANT_STORAGE_KEY,
    configMinutesToMs,
    getFluParticipantConfig,
    getFluParticipantDefaults,
    isFluParticipantEnabled,
    listFluParticipantHardRules,
    msToConfigMinutes,
    resetFluParticipantOverrides,
    resolveFluParticipantFieldHint,
    resolveFluParticipantFieldLabel,
    setFluParticipantEnabled,
    setFluParticipantOverrides,
} from '../src/voice/lib/fluParticipantConfig.js';

const HEREDADA = 'flu-participant-enabled';
const DURACION = 'cooldownAfterInterventionMs'; // 0..60 minutos, paso 1

const configFalsa = (parcial: Record<string, unknown> = {}) =>
    ({ fluParticipant: { ...getFluParticipantDefaults(), ...parcial } }) as never;

beforeEach(() => {
    localRemove(FLU_PARTICIPANT_STORAGE_KEY);
    localRemove(HEREDADA);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fluParticipantConfig - defaults', () => {
    it('las claves declaradas son las que se leen de la config', () => {
        const defaults = getFluParticipantDefaults();

        expect(Object.keys(defaults).sort()).toEqual([...FLU_PARTICIPANT_CONFIG_KEYS].sort());
        expect(FLU_PARTICIPANT_CONFIG_KEYS).toHaveLength(15);
        expect(Object.isFrozen(FLU_PARTICIPANT_CONFIG_KEYS)).toBe(true);
        expect(Object.isFrozen(FLU_PARTICIPANT_EDITABLE_FIELDS)).toBe(true);
    });

    it('sin bloque de participante avisa; sin una clave, dice CUAL falta', () => {
        expect(() => getFluParticipantDefaults({} as never)).toThrow(/fluConfig.fluParticipant es obligatorio/);

        const { enabled, ...sinEnabled } = getFluParticipantDefaults();
        expect(() => getFluParticipantDefaults({ fluParticipant: sinEnabled } as never)).toThrow(
            /fluConfig.fluParticipant\.enabled es obligatorio/,
        );
        expect(enabled).toBeDefined();
    });

    it('los defaults son los de la config real (no una copia a mano)', () => {
        const defaults = getFluParticipantDefaults();

        expect(defaults.enabled).toBe(FLU_CONFIG.fluParticipant.enabled);
        expect(defaults.minConfidence).toBe(FLU_CONFIG.fluParticipant.minConfidence);
    });

    it('los campos editables declaran su rango y su tipo', () => {
        const porClave = new Map(FLU_PARTICIPANT_EDITABLE_FIELDS.map((f) => [f.key, f]));

        expect(porClave.get('enabled')!.type).toBe('boolean');
        expect(porClave.get(DURACION)!.type).toBe('durationMinutes');
        expect(porClave.get('minConfidence')!.min).toBe(0.5);
        expect(porClave.get(DURACION)!.max).toBe(60);
        // Toda clave editable tiene que existir tambien entre las leidas.
        for (const campo of FLU_PARTICIPANT_EDITABLE_FIELDS) {
            expect(FLU_PARTICIPANT_CONFIG_KEYS).toContain(campo.key);
        }
    });
});

describe('fluParticipantConfig - overrides del almacen', () => {
    it('sin nada guardado devuelve los defaults', () => {
        expect(getFluParticipantConfig()).toEqual(getFluParticipantDefaults());
    });

    it('los booleanos se aceptan como texto o numero', () => {
        for (const [guardado, esperado] of [['0', false], ['false', false], [0, false], ['1', true], ['true', true], [1, true], [true, true]]) {
            localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ enabled: guardado }));
            expect(getFluParticipantConfig().enabled).toBe(esperado);
        }
    });

    it('los numeros se recortan a su minimo y su maximo', () => {
        localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ minConfidence: 2, evaluateEveryNTurns: 0 }));

        const cfg = getFluParticipantConfig();

        expect(cfg.minConfidence).toBe(1);
        expect(cfg.evaluateEveryNTurns).toBe(1);
    });

    it('un valor que no es numero vuelve al default de esa clave', () => {
        const minDefecto = getFluParticipantDefaults().minConfidence;
        localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ minConfidence: 'vaya' }));

        expect(getFluParticipantConfig().minConfidence).toBe(minDefecto);
    });

    it('las duraciones se guardan en minutos y vuelven en ms', () => {
        localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ [DURACION]: 30 }));

        expect(getFluParticipantConfig()[DURACION]).toBe(30 * 60 * 1000);
    });

    it('una duracion ya en ms no se multiplica otra vez', () => {
        localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ [DURACION]: 5 * 60 * 1000 }));

        expect(getFluParticipantConfig()[DURACION]).toBe(5 * 60 * 1000);
    });

    it('una duracion negativa cae al minimo del campo', () => {
        localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ [DURACION]: -5 }));

        expect(getFluParticipantConfig()[DURACION]).toBe(0);
    });

    it('las claves sin campo editable no se recortan', () => {
        localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ maxDraftChars: 5000 }));

        expect(getFluParticipantConfig().maxDraftChars).toBe(5000);
    });

    it('las claves desconocidas del almacen se ignoran', () => {
        localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ inventada: 7 }));

        expect(Object.hasOwn(getFluParticipantConfig(), 'inventada')).toBe(false);
    });

    it('un almacen con basura o con algo que no es objeto no rompe', () => {
        localSet(FLU_PARTICIPANT_STORAGE_KEY, '{no-json');
        expect(getFluParticipantConfig()).toEqual(getFluParticipantDefaults());

        localSet(FLU_PARTICIPANT_STORAGE_KEY, '"texto"');
        expect(getFluParticipantConfig()).toEqual(getFluParticipantDefaults());
    });

    it('la clave HEREDADA manda sobre el JSON', () => {
        localSet(FLU_PARTICIPANT_STORAGE_KEY, JSON.stringify({ enabled: true }));
        localSet(HEREDADA, '0');
        expect(getFluParticipantConfig().enabled).toBe(false);

        localSet(HEREDADA, '1');
        expect(getFluParticipantConfig().enabled).toBe(true);
    });
});

describe('fluParticipantConfig - escritura y reinicio', () => {
    it('escribir un ajuste lo coercciona y devuelve la config ya aplicada', () => {
        const cfg = setFluParticipantOverrides({ minConfidence: 0.93, enabled: '0' });

        expect(cfg.minConfidence).toBe(0.93);
        expect(cfg.enabled).toBe(false);
        expect(JSON.parse(localGet(FLU_PARTICIPANT_STORAGE_KEY)!)).toEqual({ minConfidence: 0.93, enabled: false });
        expect(localGet(HEREDADA)).toBe('0');
    });

    it('escribir NO pisa lo que ya habia', () => {
        setFluParticipantOverrides({ minConfidence: 0.93 });
        setFluParticipantOverrides({ minDraftChars: 40 });

        const guardado = JSON.parse(localGet(FLU_PARTICIPANT_STORAGE_KEY)!);
        expect(guardado).toEqual({ minConfidence: 0.93, minDraftChars: 40 });
        expect(getFluParticipantConfig().minDraftChars).toBe(40);
    });

    it('las claves que no son del participante no se escriben', () => {
        setFluParticipantOverrides({ inventada: 7, minConfidence: 0.9 });

        expect(JSON.parse(localGet(FLU_PARTICIPANT_STORAGE_KEY)!)).toEqual({ minConfidence: 0.9 });
    });

    it('encender y apagar deja la clave heredada en 1 y en 0', () => {
        expect(isFluParticipantEnabled()).toBe(true);
        expect(setFluParticipantEnabled(false).enabled).toBe(false);
        expect(localGet(HEREDADA)).toBe('0');
        expect(isFluParticipantEnabled()).toBe(false);

        expect(setFluParticipantEnabled(true).enabled).toBe(true);
        expect(localGet(HEREDADA)).toBe('1');
        expect(isFluParticipantEnabled()).toBe(true);
    });

    it('el participante se considera activo salvo apagado explicito', () => {
        expect(isFluParticipantEnabled(configFalsa({ enabled: undefined as never }))).toBe(true);
        expect(isFluParticipantEnabled(configFalsa({ enabled: false }))).toBe(false);
    });

    it('el reinicio borra lo guardado (las dos claves) y vuelve a los defaults', () => {
        setFluParticipantOverrides({ minConfidence: 0.99 });

        const cfg = resetFluParticipantOverrides();

        expect(localGet(FLU_PARTICIPANT_STORAGE_KEY)).toBeNull();
        expect(localGet(HEREDADA)).toBeNull();
        expect(cfg).toEqual(getFluParticipantDefaults());
    });
});

describe('fluParticipantConfig - textos, unidades y reglas duras', () => {
    it('la etiqueta del campo busca su idioma, luego es, luego en, luego la clave', () => {
        const config = {
            fluParticipant: {
                ...getFluParticipantDefaults(),
                ui: {
                    fields: { enabled: { es: 'Activo', en: 'Enabled' }, soloIngles: { en: 'Only english' } },
                    fieldHints: { enabled: { es: 'Pista' } },
                },
            },
        } as never;

        expect(resolveFluParticipantFieldLabel('enabled', 'en', config)).toBe('Enabled');
        expect(resolveFluParticipantFieldLabel('enabled', 'es', config)).toBe('Activo');
        expect(resolveFluParticipantFieldLabel('soloIngles', 'es', config)).toBe('Only english');
        expect(resolveFluParticipantFieldLabel('sinTextos', 'es', config)).toBe('sinTextos');
    });

    it('la pista vacia para un campo sin textos', () => {
        expect(resolveFluParticipantFieldHint('enabled', 'es', configFalsa() as never)).toBe('');
    });

    it('minutos y ms van y vuelven', () => {
        expect(msToConfigMinutes(90_000)).toBe(2);
        expect(configMinutesToMs(2)).toBe(120_000);
        expect(msToConfigMinutes(configMinutesToMs(45))).toBe(45);
    });

    it('las reglas duras listan TODAS las claves con su valor vigente y su origen', () => {
        setFluParticipantOverrides({ minConfidence: 0.8 });

        const reglas = listFluParticipantHardRules();

        expect(reglas).toHaveLength(FLU_PARTICIPANT_CONFIG_KEYS.length);
        expect(reglas.map((r) => r.key)).toEqual([...FLU_PARTICIPANT_CONFIG_KEYS]);
        expect(reglas.find((r) => r.key === 'minConfidence')).toEqual({
            key: 'minConfidence',
            value: 0.8,
            source: 'fluConfig.fluParticipant',
        });
    });
});
