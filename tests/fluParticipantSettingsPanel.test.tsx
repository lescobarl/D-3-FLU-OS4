// @vitest-environment jsdom
// ============================================================
// fluParticipantSettingsPanel.test.tsx - Config de FLU
// ------------------------------------------------------------
// Panel con borrador local. Se sustituyen SOLO las fronteras:
// el store de integracion (voz), el registro de guardado global
// y el servicio TTS (speakResponse). El resto (fluParticipantConfig,
// participantFloor, audioMath) es REAL, con localStorage de jsdom.
// Se prueban: campos editables derivados de config, conversion de
// ms a minutos, checkbox booleano, min/max/step, selector de voz ->
// store, preview TTS por idioma y los caminos commit/reset globales.
// ============================================================
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const settings = vi.hoisted(() => {
    const reg: {
        id: string | null;
        handlers: { commit?: () => void; reset?: () => void } | null;
        calls: number;
    } = { id: null, handlers: null, calls: 0 };
    const useSettingsSaveRegistration = (
        id: string,
        handlers: { commit?: () => void; reset?: () => void },
    ) => {
        reg.id = id;
        reg.handlers = handlers;
        reg.calls += 1;
    };
    return { reg, useSettingsSaveRegistration };
});

const store = vi.hoisted(() => {
    const state = {
        voiceConfig: { voiceURI: '', voiceName: '' },
        setVoiceConfig: vi.fn(),
    };
    const useIntegrationStore = () => state;
    return { state, useIntegrationStore };
});

const speech = vi.hoisted(() => ({ speakResponse: vi.fn(() => Promise.resolve()) }));

vi.mock('../src/components/SettingsSaveContext', () => ({
    useSettingsSaveRegistration: settings.useSettingsSaveRegistration,
}));
vi.mock('../src/store/integrationStore', () => ({
    useIntegrationStore: store.useIntegrationStore,
}));
vi.mock('../src/voice/lib/fluSpeech.js', () => ({
    speakResponse: speech.speakResponse,
}));

import FluParticipantSettingsPanel from '../src/voice/components/FluParticipantSettingsPanel.jsx';
import {
    FLU_PARTICIPANT_EDITABLE_FIELDS,
    FLU_PARTICIPANT_STORAGE_KEY,
    resolveFluParticipantFieldLabel,
} from '../src/voice/lib/fluParticipantConfig.js';
import { resolveParticipantFloorLabel } from '../src/voice/lib/participantFloor.js';

const LEGACY_ENABLED_KEY = 'flu-participant-enabled';

const numericFields = FLU_PARTICIPANT_EDITABLE_FIELDS.filter((f) => f.type !== 'boolean');

const VOICES = [
    { voiceURI: 'v1', name: 'Uno', lang: 'es-ES' },
    { voiceURI: 'v2', name: 'Dos', lang: 'en-US' },
];

beforeEach(() => {
    localStorage.removeItem(FLU_PARTICIPANT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_ENABLED_KEY);
    settings.reg.id = null;
    settings.reg.handlers = null;
    settings.reg.calls = 0;
    store.state.voiceConfig = { voiceURI: '', voiceName: '' };
    store.state.setVoiceConfig.mockClear();
    speech.speakResponse.mockClear();
});

const renderPanel = (props: Record<string, unknown> = {}) =>
    render(<FluParticipantSettingsPanel voices={VOICES} onConfigChange={vi.fn()} {...props} />);

const inputByKey = (container: HTMLElement, key: string) =>
    container.querySelector(`#flu-participant-${key}`) as HTMLInputElement;

const select = (container: HTMLElement) =>
    container.querySelector('select') as HTMLSelectElement;

// ------------------------------------------------------------
// Bloque A: estructura y campos derivados de config
// ------------------------------------------------------------
describe('FluParticipantSettingsPanel - estructura', () => {
    it('es un <details> con el titulo tomado de la config', () => {
        const { container } = renderPanel();

        expect(container.querySelector('details.flu-settings-image-config')).toBeTruthy();
        expect(screen.getByText(resolveParticipantFloorLabel('panelTitle', 'es'))).toBeTruthy();
    });

    it('renderiza un control por campo editable (8 numeros + 1 checkbox)', () => {
        const { container } = renderPanel();

        expect(FLU_PARTICIPANT_EDITABLE_FIELDS).toHaveLength(9);
        for (const field of FLU_PARTICIPANT_EDITABLE_FIELDS) {
            expect(container.querySelector(`#flu-participant-${field.key}`)).toBeTruthy();
        }
        expect(container.querySelectorAll('input[type="number"]')).toHaveLength(8);
        expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    });

    it('cada campo numerico lleva min/max/step de su definicion', () => {
        const { container } = renderPanel();

        for (const field of numericFields) {
            const input = inputByKey(container, field.key);
            expect(input.min).toBe(String(field.min));
            expect(input.max).toBe(String(field.max));
            expect(input.step).toBe(String(field.step));
        }
    });

    it('las etiquetas vienen de la config y cambian con el idioma', () => {
        const es = renderPanel();
        expect(screen.getByText(resolveFluParticipantFieldLabel('minConfidence', 'es'))).toBeTruthy();
        es.unmount();

        renderPanel({ language: 'en' });
        expect(screen.getByText(resolveFluParticipantFieldLabel('minConfidence', 'en'))).toBeTruthy();
    });
});

// ------------------------------------------------------------
// Bloque B: valores del borrador (defaults, ms->min, booleano)
// ------------------------------------------------------------
describe('FluParticipantSettingsPanel - valores del borrador', () => {
    it('muestra los defaults de config sin overrides', () => {
        const { container } = renderPanel();

        expect(inputByKey(container, 'evaluateEveryNTurns').value).toBe('3');
        expect(inputByKey(container, 'minConfidence').value).toBe('0.65');
    });

    it('un duracion en ms se muestra en minutos (900000ms -> 15)', () => {
        localStorage.setItem(
            FLU_PARTICIPANT_STORAGE_KEY,
            JSON.stringify({ cooldownAfterInterventionMs: 900000 }),
        );

        const { container } = renderPanel();

        expect(inputByKey(container, 'cooldownAfterInterventionMs').value).toBe('15');
    });

    it('respeta overrides de storage en el borrador inicial', () => {
        localStorage.setItem(
            FLU_PARTICIPANT_STORAGE_KEY,
            JSON.stringify({ evaluateEveryNTurns: 7 }),
        );

        const { container } = renderPanel();

        expect(inputByKey(container, 'evaluateEveryNTurns').value).toBe('7');
    });

    it('el checkbox enabled arranca APAGADO (P9.84) y la clave legacy "1" lo enciende', () => {
        // Decision del dueno (P9.84): el participante va apagado por defecto.
        const off = renderPanel();
        expect((inputByKey(off.container, 'enabled') as HTMLInputElement).checked).toBe(false);
        off.unmount();

        localStorage.setItem(LEGACY_ENABLED_KEY, '1');
        const on = renderPanel();
        expect((inputByKey(on.container, 'enabled') as HTMLInputElement).checked).toBe(true);
    });
});

// ------------------------------------------------------------
// Bloque C: selector de voz e integracion con el store
// ------------------------------------------------------------
describe('FluParticipantSettingsPanel - selector de voz', () => {
    it('las opciones son el placeholder mas una por voz', () => {
        const { container } = renderPanel();

        const options = Array.from(select(container).options);
        expect(options).toHaveLength(3);
        expect(options[0].value).toBe('');
        expect(options[1].value).toBe('v1');
        expect(options[1].textContent).toBe('Uno (es-ES)');
        expect(options[2].textContent).toBe('Dos (en-US)');
    });

    it('preselecciona la voz del store', () => {
        store.state.voiceConfig = { voiceURI: 'v2', voiceName: 'Dos' };

        const { container } = renderPanel();

        expect(select(container).value).toBe('v2');
    });

    it('elegir una voz guarda uri+nombre; elegir el placeholder no hace nada', () => {
        const { container } = renderPanel();

        fireEvent.change(select(container), { target: { value: 'v2' } });
        expect(store.state.setVoiceConfig).toHaveBeenCalledWith({ voiceURI: 'v2', voiceName: 'Dos' });

        store.state.setVoiceConfig.mockClear();
        fireEvent.change(select(container), { target: { value: '' } });
        expect(store.state.setVoiceConfig).not.toHaveBeenCalled();
    });

    it('el boton Probar usa speakResponse con el idioma del panel', () => {
        const es = renderPanel();
        fireEvent.click(screen.getByRole('button', { name: /Probar/ }));
        expect(speech.speakResponse).toHaveBeenCalledWith('Hola, soy FLU. Esta es mi voz.', 'es');
        es.unmount();

        speech.speakResponse.mockClear();
        renderPanel({ language: 'en' });
        fireEvent.click(screen.getByRole('button', { name: /Probar/ }));
        expect(speech.speakResponse).toHaveBeenCalledWith(
            'Hello, I am FLU. This is my voice.',
            'en',
        );
    });
});

// ------------------------------------------------------------
// Bloque D: registro global Guardar/Restablecer
// ------------------------------------------------------------
describe('FluParticipantSettingsPanel - guardado global', () => {
    it('commit (registrado como "flu-participant") persiste el borrador y avisa onConfigChange', () => {
        const onConfigChange = vi.fn();
        const { container } = renderPanel({ onConfigChange });

        expect(settings.reg.id).toBe('flu-participant');
        expect(settings.reg.calls).toBeGreaterThan(0);
        expect(typeof settings.reg.handlers!.commit).toBe('function');
        expect(typeof settings.reg.handlers!.reset).toBe('function');

        fireEvent.change(inputByKey(container, 'evaluateEveryNTurns'), { target: { value: '7' } });
        act(() => {
            settings.reg.handlers!.commit!();
        });

        const saved = JSON.parse(localStorage.getItem(FLU_PARTICIPANT_STORAGE_KEY) as string);
        expect(saved.evaluateEveryNTurns).toBe(7);
        expect(onConfigChange).toHaveBeenCalledTimes(1);
        expect(onConfigChange.mock.calls[0][0].evaluateEveryNTurns).toBe(7);
    });

    it('reset borra los overrides y vuelve a los defaults', () => {
        localStorage.setItem(
            FLU_PARTICIPANT_STORAGE_KEY,
            JSON.stringify({ evaluateEveryNTurns: 7 }),
        );
        const onConfigChange = vi.fn();
        renderPanel({ onConfigChange });

        act(() => {
            settings.reg.handlers!.reset!();
        });

        expect(localStorage.getItem(FLU_PARTICIPANT_STORAGE_KEY)).toBeNull();
        expect(onConfigChange).toHaveBeenCalledTimes(1);
        expect(onConfigChange.mock.calls[0][0].evaluateEveryNTurns).toBe(3);
    });
});
