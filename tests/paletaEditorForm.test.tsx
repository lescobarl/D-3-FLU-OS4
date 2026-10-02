// @vitest-environment jsdom
/**
 * PaletaEditorForm - crear/editar/clonar una paleta/temporada (0%).
 *
 * POR QUE ESTE TEST: es la unica puerta de alta/edicion de paletas dinamicas.
 * Construye el payload COMPLETO (las 13 claves CSS) a partir de una plantilla y
 * los campos editables. Se prueba lo que de verdad rompe producto: el slug de id
 * en vivo, la validacion de nombre obligatorio, el payload exacto que llega al
 * padre (colores recortados, decoration/cssClass opcionales que se borran si van
 * vacios), el error del padre pintado y limpiado, y el bloqueo mientras guarda.
 *
 * Presentacional puro: la frontera (onSubmit/onCancel) son props; NO se mockea
 * nada (ni el modulo bajo prueba ni sus dependencias puras de branding).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaletaEditorForm } from '../src/components/PaletaEditorForm.js';
import { configChild, configTextMap } from '../src/components/configText.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import {
    PALETTE_COLOR_KEYS,
    getAllPalettes,
    type PaletteDefinition,
} from '../src/core/branding/seasonalPalettes.js';
import {
    slugifyPalette,
    type EditablePaletteFields,
    type PaletteColorKey,
} from '../src/core/branding/paletaFactory.js';

// Etiquetas: igual que el componente, de FLU_CONFIG.ui.paletas con fallback.
const UI = configTextMap(configChild(FLU_CONFIG.ui, 'paletas'));
const FALLBACK = {
    nombreLabel: 'Nombre',
    idLabel: 'Identificador',
    colorsLabel: 'Colores de la paleta',
    decorationLabel: 'Decoraci\u00f3n',
    cssClassLabel: 'Clase CSS',
    requiredError: 'El nombre es obligatorio para generar el identificador.',
};
const label = (key: keyof typeof FALLBACK): string => UI[key] || FALLBACK[key];

const PLANTILLA = getAllPalettes()[0] as PaletteDefinition;

const COLORES = Object.fromEntries(
    PALETTE_COLOR_KEYS.map((key, i) => [key, `#0000${(10 + i).toString(16).padStart(2, '0')}`]),
) as Record<PaletteColorKey, string>;

const SEED: EditablePaletteFields = {
    name: 'Modo Selva',
    colors: { ...COLORES },
    decoration: 'santa-hat',
    cssClass: 'seasonal-fall',
};

const montar = (over: Record<string, unknown> = {}) => {
    const onSubmit = (over.onSubmit as ReturnType<typeof vi.fn>) ?? vi.fn(async () => null);
    const onCancel = (over.onCancel as ReturnType<typeof vi.fn>) ?? vi.fn();
    render(
        <PaletaEditorForm
            template={(over.template as PaletteDefinition) ?? PLANTILLA}
            seed={(over.seed as EditablePaletteFields) ?? SEED}
            submitLabel={(over.submitLabel as string) ?? 'Guardar'}
            cancelLabel={(over.cancelLabel as string) ?? 'Cancelar'}
            onCancel={onCancel}
            onSubmit={onSubmit}
        />,
    );
    return { onSubmit, onCancel };
};

const caja = (testid: string) => screen.getByTestId(testid) as HTMLInputElement;
const colorTestId = (key: string) => `paleta-editor-color-${key.replace(/^--/, '')}`;
const guardar = () => fireEvent.submit(screen.getByTestId('paleta-editor-form'));

describe('PaletaEditorForm - campos, slug y colores', () => {
    it('usa las etiquetas de la config y arranca con los valores del seed', () => {
        montar();

        expect(screen.getByText(label('nombreLabel'))).toBeTruthy();
        expect(screen.getByText(label('colorsLabel'))).toBeTruthy();
        expect(screen.getByText(label('decorationLabel'))).toBeTruthy();
        expect(screen.getByText(label('cssClassLabel'))).toBeTruthy();
        expect(caja('paleta-editor-name').value).toBe('Modo Selva');
        expect(caja('paleta-editor-decoration').value).toBe('santa-hat');
        expect(caja('paleta-editor-css-class').value).toBe('seasonal-fall');
        expect(screen.getByTestId('paleta-editor-submit').textContent).toBe('Guardar');
        expect(screen.getByTestId('paleta-editor-cancel').textContent).toBe('Cancelar');
    });

    it('muestra el identificador en vivo segun el nombre (y guion cuando no hay slug)', () => {
        montar();
        expect(screen.getByText(slugifyPalette('Modo Selva'))).toBeTruthy();

        fireEvent.change(caja('paleta-editor-name'), { target: { value: 'Modo  Noche Azul!' } });
        expect(screen.getByText(slugifyPalette('Modo  Noche Azul!'))).toBeTruthy();
        expect(slugifyPalette('Modo  Noche Azul!')).not.toBe(slugifyPalette('Modo Selva'));

        fireEvent.change(caja('paleta-editor-name'), { target: { value: '!!!' } });
        expect(screen.getByText('\u2014')).toBeTruthy();
    });

    it('pinta un input de color por cada clave CSS y con el color del seed', () => {
        montar();

        expect(PALETTE_COLOR_KEYS.length).toBe(13);
        for (const key of PALETTE_COLOR_KEYS) {
            const input = caja(colorTestId(key));
            expect(input.type).toBe('color');
            expect(input.value).toBe(COLORES[key]);
        }
    });
});

describe('PaletaEditorForm - validacion y guardado', () => {
    it('el boton espera a un nombre de verdad', () => {
        montar();
        const boton = screen.getByTestId('paleta-editor-submit') as HTMLButtonElement;

        fireEvent.change(caja('paleta-editor-name'), { target: { value: '   ' } });
        expect(boton.disabled).toBe(true);

        fireEvent.change(caja('paleta-editor-name'), { target: { value: 'Selva' } });
        expect(boton.disabled).toBe(false);
    });

    it('sin slug posible no llama al padre y avisa con el mensaje de la config', () => {
        const { onSubmit } = montar();
        fireEvent.change(caja('paleta-editor-name'), { target: { value: '!!!' } });

        guardar();

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByTestId('paleta-editor-error').textContent).toBe(label('requiredError'));
    });

    it('guarda el payload COMPLETO con el color editado y sin mutar la plantilla', async () => {
        const { onSubmit } = montar();
        const originalPlantilla = PLANTILLA.colors[PALETTE_COLOR_KEYS[0]];
        fireEvent.change(caja('paleta-editor-name'), { target: { value: 'Modo Noche' } });
        fireEvent.change(caja(colorTestId(PALETTE_COLOR_KEYS[0])), { target: { value: '#123456' } });

        guardar();

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        const payload = onSubmit.mock.calls[0][0] as PaletteDefinition;
        expect(payload.id).toBe(slugifyPalette('Modo Noche'));
        expect(payload.name).toBe('Modo Noche');
        expect(payload.colors).toEqual({ ...COLORES, [PALETTE_COLOR_KEYS[0]]: '#123456' });
        expect(Object.keys(payload.colors).length).toBe(13);
        expect(payload.decoration).toBe('santa-hat');
        expect(payload.cssClass).toBe('seasonal-fall');
        // structuredClone interno: la plantilla original no cambia.
        expect(PLANTILLA.colors[PALETTE_COLOR_KEYS[0]]).toBe(originalPlantilla);
    });

    it('recorta name/decoration y borra decoration/cssClass si quedan vacios', async () => {
        const { onSubmit } = montar({
            seed: { ...SEED, name: '  Selva  ', decoration: '   ', cssClass: '' },
        });

        guardar();

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        const payload = onSubmit.mock.calls[0][0] as PaletteDefinition;
        expect(payload.name).toBe('Selva');
        expect(payload.id).toBe('selva');
        expect('decoration' in payload).toBe(false);
        expect('cssClass' in payload).toBe(false);
    });

    it('completa las 13 claves de color aunque el seed no traiga ninguna', async () => {
        const { onSubmit } = montar({
            seed: { name: 'Solo Nombre', colors: {}, decoration: '', cssClass: '' },
        });

        guardar();

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        const payload = onSubmit.mock.calls[0][0] as PaletteDefinition;
        expect(Object.keys(payload.colors).sort()).toEqual([...PALETTE_COLOR_KEYS].sort());
        expect(payload.colors[PALETTE_COLOR_KEYS[0]]).toBe('');
    });

    it('pinta el error que devuelve el padre y lo limpia en el siguiente guardado correcto', async () => {
        const onSubmit = vi.fn(async () => 'Ese identificador ya existe');
        montar({ onSubmit });

        guardar();
        await waitFor(() => {
            expect(screen.getByTestId('paleta-editor-error').textContent).toBe(
                'Ese identificador ya existe',
            );
        });

        onSubmit.mockResolvedValue(null as never);
        guardar();

        await waitFor(() => {
            expect(screen.queryByTestId('paleta-editor-error')).toBeNull();
        });
    });

    it('mientras guarda, campos y botones quedan bloqueados', () => {
        montar({ onSubmit: vi.fn(() => new Promise(() => {})) });

        guardar();

        expect(caja('paleta-editor-name').disabled).toBe(true);
        expect(caja('paleta-editor-decoration').disabled).toBe(true);
        expect(caja(colorTestId(PALETTE_COLOR_KEYS[0])).disabled).toBe(true);
        expect((screen.getByTestId('paleta-editor-submit') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('paleta-editor-cancel') as HTMLButtonElement).disabled).toBe(true);
    });

    it('cancelar llama al padre sin guardar nada', () => {
        const { onSubmit, onCancel } = montar();

        fireEvent.click(screen.getByTestId('paleta-editor-cancel'));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
