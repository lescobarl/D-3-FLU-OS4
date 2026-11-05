// @vitest-environment jsdom
/**
 * AmbienteEditorForm - crear/editar/clonar un ambiente (0%).
 *
 * POR QUE ESTE TEST: 253 lineas que construyen el payload COMPLETO de un ambiente
 * (heredando bienvenida/voz/contenido/capVisible de la plantilla) y que son la
 * unica puerta de alta/edicion de ambientes. Se prueba lo que importa: el slug en
 * vivo desde el nombre, la validacion de nombre obligatorio (no llama a onSubmit),
 * el payload que llega al guardar (campos editables + variables + pestañas), el
 * error devuelto por el padre pintado en el formulario, y que los campos se
 * bloquean mientras guarda.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AmbienteEditorForm } from '../src/components/AmbienteEditorForm.js';
import {
    ENVIRONMENT_CSS_VAR_KEYS,
    ENVIRONMENT_DECORATIONS,
    ENVIRONMENT_TAB_IDS,
    getAmbiente,
} from '../src/core/environments/environmentRegistry.js';
import { slugifyAmbiente, type EditableAmbienteFields } from '../src/core/environments/ambienteFactory.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const ui = (FLU_CONFIG.ui as unknown as Record<string, unknown>).ambientes as Record<string, string>;
const PLANTILLA = getAmbiente('chef')!;
const TAB_LABELS: Record<string, string> = {
    [ENVIRONMENT_TAB_IDS[0]]: 'Primera',
    [ENVIRONMENT_TAB_IDS[1]]: 'Segunda',
};

const SEED: EditableAmbienteFields = {
    nombre: 'Modo Selva',
    tagline: 'selva',
    icono: '🌴',
    frasesEs: 'activa selva',
    frasesEn: 'activate jungle',
    vars: { 'flu-bg': '#111111' },
    decoracion: null,
    tabs: [...ENVIRONMENT_TAB_IDS].slice(0, 2),
} as EditableAmbienteFields;

const montar = (over: Partial<Record<string, unknown>> = {}) => {
    const onSubmit = (over.onSubmit as ReturnType<typeof vi.fn>) ?? vi.fn(async () => null);
    const onCancel = (over.onCancel as ReturnType<typeof vi.fn>) ?? vi.fn();
    render(
        <AmbienteEditorForm
            template={(over.template as never) ?? (PLANTILLA as never)}
            seed={(over.seed as never) ?? (SEED as never)}
            tabLabels={(over.tabLabels as never) ?? TAB_LABELS}
            submitLabel={(over.submitLabel as string) ?? 'Guardar'}
            cancelLabel={(over.cancelLabel as string) ?? 'Cancelar'}
            onCancel={onCancel as never}
            onSubmit={onSubmit as never}
        />,
    );
    return { onSubmit, onCancel };
};

const caja = (testid: string) => screen.getByTestId(testid) as HTMLInputElement;
const guardar = () => fireEvent.submit(screen.getByTestId('ambiente-editor-form'));

describe('AmbienteEditorForm - campos y slug', () => {
    it('las etiquetas salen de la config y los campos arrancan con el seed', () => {
        montar();

        expect(screen.getByText(ui.nombreLabel)).toBeTruthy();
        expect(caja('ambiente-editor-nombre').value).toBe('Modo Selva');
        expect(caja('ambiente-editor-tagline').value).toBe('selva');
        expect(caja('ambiente-editor-frases-es').value).toBe('activa selva');
        expect(screen.getByTestId('ambiente-editor-submit').textContent).toBe('Guardar');
        expect(screen.getByTestId('ambiente-editor-cancel').textContent).toBe('Cancelar');
    });

    it('el identificador se ve en vivo segun el nombre', () => {
        const { } = montar();

        expect(screen.getByText(slugifyAmbiente('Modo Selva'))).toBeTruthy();

        fireEvent.change(caja('ambiente-editor-nombre'), { target: { value: 'Modo  Noche Azul!' } });

        expect(screen.getByText(slugifyAmbiente('Modo  Noche Azul!'))).toBeTruthy();
        expect(slugifyAmbiente('Modo  Noche Azul!')).not.toBe(slugifyAmbiente('Modo Selva'));
    });

    it('las variables CSS y las decoraciones vienen del registro', () => {
        montar();

        for (const clave of ENVIRONMENT_CSS_VAR_KEYS) {
            expect(screen.getByTestId(`ambiente-editor-var-${clave}`)).toBeTruthy();
        }
        const decoracion = screen.getByTestId('ambiente-editor-decoracion') as HTMLSelectElement;
        expect([...decoracion.options].map((o) => o.value)).toEqual(['', ...ENVIRONMENT_DECORATIONS]);
        expect(caja(`ambiente-editor-var-flu-bg`).value).toBe('#111111');
    });

    it('las pestañas se marcan segun el seed y usan las etiquetas del padre', () => {
        montar();

        expect(caja(`ambiente-editor-tab-${ENVIRONMENT_TAB_IDS[0]}`).checked).toBe(true);
        expect(caja(`ambiente-editor-tab-${ENVIRONMENT_TAB_IDS[2]}`).checked).toBe(false);
        expect(screen.getByText('Primera')).toBeTruthy();
    });
});

describe('AmbienteEditorForm - guardar', () => {
    it('el boton espera a un nombre de verdad', () => {
        montar();
        const boton = screen.getByTestId('ambiente-editor-submit') as HTMLButtonElement;

        fireEvent.change(caja('ambiente-editor-nombre'), { target: { value: '  ' } });
        expect(boton.disabled).toBe(true);

        fireEvent.change(caja('ambiente-editor-nombre'), { target: { value: 'Selva' } });
        expect(boton.disabled).toBe(false);
    });

    it('sin nombre valido no llama al padre y avisa con el mensaje de la config', () => {
        const { onSubmit } = montar();
        fireEvent.change(caja('ambiente-editor-nombre'), { target: { value: '!!!' } });

        guardar();

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByTestId('ambiente-editor-error').textContent).toBe(ui.requiredError);
    });

    it('guarda el payload COMPLETO: edita los campos y hereda el resto de la plantilla', async () => {
        const { onSubmit } = montar();
        fireEvent.change(caja('ambiente-editor-nombre'), { target: { value: 'Modo Noche' } });
        fireEvent.change(caja('ambiente-editor-tagline'), { target: { value: 'noche' } });
        fireEvent.change(caja('ambiente-editor-var-flu-bg'), { target: { value: '#000000' } });

        guardar();

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalled();
        });
        const payload = onSubmit.mock.calls[0][0] as {
            id: string;
            nombre: string;
            tagline: string;
            tema: { vars: Record<string, string> };
            pestanas: { mostrar: string[] };
            frasesActivacion: { es: string[] };
            bienvenida: unknown;
        };
        expect(payload.id).toBe(slugifyAmbiente('Modo Noche'));
        expect(payload.nombre).toBe('Modo Noche');
        expect(payload.tema.vars['flu-bg']).toBe('#000000');
        // Heredado de la plantilla (no se edita en el formulario).
        expect(payload.bienvenida).toEqual(PLANTILLA.bienvenida);
        expect(payload.pestanas.mostrar.length).toBeGreaterThan(0);
        // Los campos editables van recortados y las frases partidas por linea.
        expect(payload.tagline).toBe('noche');
        expect(payload.frasesActivacion.es).toEqual(['activa selva']);
    });

    it('al marcar/desmarcar pestañas el payload lleva la lista nueva', async () => {
        const { onSubmit } = montar();
        const nueva = ENVIRONMENT_TAB_IDS[2];

        fireEvent.click(caja(`ambiente-editor-tab-${nueva}`));
        guardar();

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalled();
        });
        expect((onSubmit.mock.calls[0][0] as { pestanas: { mostrar: string[] } }).pestanas.mostrar).toContain(nueva);

        fireEvent.click(caja(`ambiente-editor-tab-${nueva}`));
        guardar();

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(2);
        });
        expect((onSubmit.mock.calls[1][0] as { pestanas: { mostrar: string[] } }).pestanas.mostrar).not.toContain(nueva);
    });

    it('el mensaje de error del padre se pinta y NO se queda pegado si luego va bien', async () => {
        const onSubmit = vi.fn(async () => 'Ese identificador ya existe');
        montar({ onSubmit });

        guardar();
        await waitFor(() => {
            expect(screen.getByTestId('ambiente-editor-error').textContent).toBe('Ese identificador ya existe');
        });

        onSubmit.mockResolvedValue(null as never);
        guardar();

        await waitFor(() => {
            expect(screen.queryByTestId('ambiente-editor-error')).toBeNull();
        });
    });

    it('mientras guarda, los campos y los botones quedan bloqueados', () => {
        montar({ onSubmit: vi.fn(() => new Promise(() => {})) });

        guardar();

        expect(caja('ambiente-editor-nombre').disabled).toBe(true);
        expect((screen.getByTestId('ambiente-editor-submit') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('ambiente-editor-cancel') as HTMLButtonElement).disabled).toBe(true);
    });

    it('cancelar llama al padre sin guardar nada', () => {
        const { onSubmit, onCancel } = montar();

        fireEvent.click(screen.getByTestId('ambiente-editor-cancel'));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
