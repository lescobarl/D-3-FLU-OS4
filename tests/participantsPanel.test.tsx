// @vitest-environment jsdom
/**
 * ParticipantsPanel - panel de participantes del hogar (0%).
 *
 * POR QUE ESTE TEST: 301 lineas presentacionales por las que pasa el alta/baja de
 * los participantes y el perfil de comunicacion manual (FASE P). Nadie las
 * ejecutaba. Se prueban las reglas que importan: etiquetas y ROLES de la config,
 * alta con recorte y con el formulario que SOLO se limpia si el registro fue bien,
 * el perfil ANONIMO sin boton de borrar, y los perfiles manuales (nivel/tono) con
 * su boton de restablecer que aparece solo cuando hay algo manual.
 */
import { fireEvent, render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ParticipantsPanel } from '../src/components/ParticipantsPanel.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import { TONE_OPTIONS } from '../src/core/personalization/communicationProfileService.js';

const multi = FLU_CONFIG.multiuser as unknown as Record<string, unknown>;
const ui = multi.ui as Record<string, string>;
const roles = multi.roles as string[];
const pui = (FLU_CONFIG.personalization as unknown as Record<string, unknown>).ui as Record<string, string>;
const ANONIMO = String((multi.skipDefaults as Record<string, unknown>).anonymousName);

const montar = (over: Partial<Record<string, unknown>> = {}) => {
    const onRegister = (over.onRegister as ReturnType<typeof vi.fn>) ?? vi.fn(async () => ({ ok: true }));
    const onRemove = (over.onRemove as ReturnType<typeof vi.fn>) ?? vi.fn(async () => {});
    render(
        <ParticipantsPanel
            items={(over.items as never) ?? ([] as never)}
            loading={(over.loading as boolean) ?? false}
            birthdayNear={(over.birthdayNear as never) ?? undefined}
            profiles={(over.profiles as never) ?? undefined}
            onRegister={onRegister as never}
            onRemove={onRemove as never}
            onSetManual={over.onSetManual as never}
            onResetPerson={over.onResetPerson as never}
        />,
    );
    return { onRegister, onRemove };
};

const escribir = (caja: string, valor: string) => fireEvent.change(screen.getByTestId(caja), { target: { value: valor } });
const enviar = () => fireEvent.submit(screen.getByTestId('participants-add-submit').closest('form')!);

describe('ParticipantsPanel - etiquetas, roles y lista', () => {
    it('etiquetas y roles vienen de la config (nada hardcodeado)', () => {
        montar();

        expect(screen.getByText(ui.panelTitle)).toBeTruthy();
        expect(screen.getByTestId('participants-add-submit').textContent).toBe(ui.addLabel);
        const opciones = screen.getByTestId('participants-add-role') as HTMLSelectElement;
        expect([...opciones.options].map((o) => o.value)).toEqual(['', ...roles]);
    });

    it('cargando: puntos suspensivos; vacio: mensaje de la config', () => {
        const { unmount } = render(<ParticipantsPanel items={[]} loading onRegister={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.queryByTestId('participants-list')).toBeNull();
        expect(screen.getByText('…')).toBeTruthy();
        unmount();

        montar();
        expect(screen.getByText(ui.emptyState)).toBeTruthy();
    });

    it('la fila une rol, etiqueta de hablante y cumpleaños', () => {
        montar({ items: [{ id: 'p1', name: 'Luis', role: 'Padre', speakerLabel: 'Hablante_1', birthday: '1980-01-01' }] });

        const fila = screen.getByText('Luis').closest('li')!;

        expect(fila.textContent).toContain('Padre · Hablante_1 · 1980-01-01');
    });

    it('el perfil anonimo NO se puede borrar; los demas si', () => {
        montar({
            items: [
                { id: 'anon', name: ANONIMO },
                { id: 'p1', name: 'Luis' },
            ],
        });

        expect(screen.queryByTestId('participants-remove-anon')).toBeNull();
        expect(screen.getByTestId('participants-remove-p1')).toBeTruthy();
    });

    it('borrar manda el id', () => {
        const { onRemove } = montar({ items: [{ id: 'p1', name: 'Luis' }] });

        fireEvent.click(screen.getByTestId('participants-remove-p1'));

        expect(onRemove).toHaveBeenCalledWith('p1');
    });

    it('los cumpleaños proximos solo salen si hay alguno', () => {
        const { unmount } = render(<ParticipantsPanel items={[]} loading={false} onRegister={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.queryByTestId('participants-birthday-near')).toBeNull();
        unmount();

        montar({ birthdayNear: [{ id: 'p1', name: 'Luis', birthday: '1980-01-01' }] });
        expect(screen.getByTestId('participants-birthday-near').textContent).toContain('Luis');
    });
});

describe('ParticipantsPanel - alta', () => {
    it('el boton espera a un nombre de verdad', () => {
        montar();
        const boton = screen.getByTestId('participants-add-submit') as HTMLButtonElement;

        expect(boton.disabled).toBe(true);
        escribir('participants-add-name', '  ');
        expect(boton.disabled).toBe(true);

        escribir('participants-add-name', 'Ana');
        expect(boton.disabled).toBe(false);
    });

    it('registra con los campos recortados y undefined en los vacios', () => {
        const { onRegister } = montar();
        escribir('participants-add-name', '  Ana ');
        escribir('participants-add-speaker', '  ');

        enviar();

        expect(onRegister).toHaveBeenCalledWith({
            name: 'Ana',
            role: undefined,
            birthday: undefined,
            speakerLabel: undefined,
        });
    });

    it('el formulario se limpia SOLO si el registro fue bien', async () => {
        let responder: (valor: unknown) => void = () => {};
        const onRegister = vi.fn(() => new Promise((listo) => {
            responder = listo;
        }));
        montar({ onRegister });
        escribir('participants-add-name', 'Ana');
        const campo = () => screen.getByTestId('participants-add-name') as HTMLInputElement;

        enviar();
        // Mientras el registro esta en vuelo, un segundo envio no hace nada.
        enviar();
        expect(onRegister).toHaveBeenCalledTimes(1);

        await act(async () => {
            responder({ ok: false, reason: 'duplicate' });
        });
        expect(campo().value).toBe('Ana');

        enviar();
        await act(async () => {
            responder({ ok: true });
        });
        expect(campo().value).toBe('');
    });

    it('sin nombre no se llama al registro', () => {
        const { onRegister } = montar();

        enviar();

        expect(onRegister).not.toHaveBeenCalled();
    });

    it('mientras guarda, los campos quedan bloqueados', () => {
        montar({ onRegister: vi.fn(() => new Promise(() => {})) });
        escribir('participants-add-name', 'Ana');

        enviar();

        expect((screen.getByTestId('participants-add-name') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId('participants-add-role') as HTMLSelectElement).disabled).toBe(true);
    });
});

describe('ParticipantsPanel - perfil de comunicacion (FASE P)', () => {
    const conPerfil = (over: Partial<Record<string, unknown>> = {}) =>
        montar({
            items: [{ id: 'p1', name: 'Luis' }],
            onSetManual: vi.fn(async () => ({})),
            ...over,
        });

    it('sin onSetManual no se pinta el bloque de perfil', () => {
        montar({ items: [{ id: 'p1', name: 'Luis' }] });

        expect(screen.queryByTestId('participants-profile-p1')).toBeNull();
    });

    it('con onSetManual el bloque ofrece nivel y tono desde la config', () => {
        conPerfil();

        const nivel = screen.getByTestId('participants-profile-level-p1') as HTMLSelectElement;
        const tono = screen.getByTestId('participants-profile-tone-p1') as HTMLSelectElement;

        expect(screen.getByText(pui.panelTitle)).toBeTruthy();
        expect(nivel.options[0].textContent).toBe(pui.autoPlaceholder);
        expect(tono.options[0].value).toBe('');
        expect(nivel.options.length).toBeGreaterThan(1);
        expect(tono.options.length).toBeGreaterThan(1);
    });

    it('el perfil guardado de la persona es el que se muestra', () => {
        conPerfil({
            profiles: [{ participantId: 'p1', manualExplanationLevel: 'simple', manualTone: TONE_OPTIONS[0] }],
        });

        expect((screen.getByTestId('participants-profile-level-p1') as HTMLSelectElement).value).toBe('simple');
        expect((screen.getByTestId('participants-profile-tone-p1') as HTMLSelectElement).value).toBe(TONE_OPTIONS[0]);
    });

    it('elegir un nivel llama a onSetManual con el nombre de la persona', () => {
        const onSetManual = vi.fn(async () => ({}));
        conPerfil({ onSetManual });

        fireEvent.change(screen.getByTestId('participants-profile-level-p1'), { target: { value: 'simple' } });

        expect(onSetManual).toHaveBeenCalledWith('p1', { explanationLevel: 'simple' }, 'Luis');
    });

    it('volver a Auto (cadena vacia) no guarda nada', () => {
        const onSetManual = vi.fn(async () => ({}));
        conPerfil({ onSetManual });

        fireEvent.change(screen.getByTestId('participants-profile-level-p1'), { target: { value: '' } });
        fireEvent.change(screen.getByTestId('participants-profile-tone-p1'), { target: { value: '' } });

        expect(onSetManual).not.toHaveBeenCalled();
    });

    it('un fallo al guardar el perfil se registra y no rompe el panel', async () => {
        const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onSetManual = vi.fn(async () => {
            throw new Error('sin perfil');
        });
        conPerfil({ onSetManual });

        fireEvent.change(screen.getByTestId('participants-profile-tone-p1'), { target: { value: TONE_OPTIONS[0] } });

        await vi.waitFor(() => {
            expect(consola).toHaveBeenCalled();
        });
        consola.mockRestore();
    });

    it('el boton de restablecer solo aparece si hay algo manual', () => {
        const { unmount } = render(
            <ParticipantsPanel
                items={[{ id: 'p1', name: 'Luis' } as never]}
                loading={false}
                onRegister={vi.fn()}
                onRemove={vi.fn()}
                onSetManual={vi.fn()}
                onResetPerson={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('participants-profile-reset-p1')).toBeNull();
        unmount();

        const onResetPerson = vi.fn(async () => true);
        conPerfil({ onResetPerson, profiles: [{ participantId: 'p1', manualTone: TONE_OPTIONS[0] }] });

        fireEvent.click(screen.getByTestId('participants-profile-reset-p1'));

        expect(onResetPerson).toHaveBeenCalledWith('p1');
    });
});
