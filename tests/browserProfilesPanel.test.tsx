// @vitest-environment jsdom
/**
 * BrowserProfilesPanel - editor del navegador curado por persona (0%).
 *
 * POR QUE ESTE TEST: 282 lineas presentacionales del Punto 2 (navegador curado) que
 * nadie ejecutaba. Reglas que se prueban: el catalogo de categorias y las etiquetas
 * salen de la CONFIG, los valores EFECTIVOS son manual > rol > default (y un array
 * vacio guardado NO borra los defaults del rol), la allowlist se normaliza al salir
 * del campo y solo se guarda si CAMBIO, y el boton de restablecer solo existe si hay
 * perfil guardado.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserProfilesPanel } from '../src/components/BrowserProfilesPanel.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const config = FLU_CONFIG.browser as unknown as Record<string, any>;
const ui = config.ui as Record<string, string>;
const CATEGORIAS = Object.keys(config.categories as Record<string, string>);
const ROLES_CON_DEFAULT = Object.keys((config.defaultsByRole || {}) as Record<string, unknown>);

const PARTICIPANTE = { id: 'p1', name: 'Ana', role: ROLES_CON_DEFAULT[0] };

const montar = (over: Partial<Record<string, unknown>> = {}) => {
    const onUpdate = (over.onUpdate as ReturnType<typeof vi.fn>) ?? vi.fn(async () => ({}));
    const onReset = (over.onReset as ReturnType<typeof vi.fn>) ?? vi.fn(async () => true);
    render(
        <BrowserProfilesPanel
            items={(over.items as never) ?? ([PARTICIPANTE] as never)}
            loading={(over.loading as boolean) ?? false}
            profiles={(over.profiles as never) ?? undefined}
            onUpdate={over.onUpdate === null ? undefined : (onUpdate as never)}
            onReset={over.onReset === null ? undefined : (onReset as never)}
        />,
    );
    return { onUpdate, onReset };
};

const chip = (categoria: string) => screen.getByTestId(`browser-profile-category-${categoria}-p1`) as HTMLInputElement;
const allowlist = () => screen.getByTestId('browser-profile-allowlist-p1') as HTMLInputElement;

describe('BrowserProfilesPanel - catalogo y valores efectivos', () => {
    it('etiquetas y categorias salen de la config', () => {
        montar();

        expect(screen.getByText(ui.panelTitle)).toBeTruthy();
        // La config puede no declarar subtitulo: manda el texto de reserva.
        expect(screen.getByText(ui.subtitleLabel || 'Perfil de navegador por participante')).toBeTruthy();
        for (const categoria of CATEGORIAS) {
            expect(screen.getByTestId(`browser-profile-category-${categoria}-p1`)).toBeTruthy();
            expect(screen.getByText(config.categories[categoria])).toBeTruthy();
        }
    });

    it('sin perfil guardado se ven los defaults del ROL', () => {
        montar();

        const delRol = config.defaultsByRole[PARTICIPANTE.role] as { categories: string[]; allowlist: string[] };

        for (const categoria of delRol.categories) {
            expect(chip(categoria).checked).toBe(true);
        }
        for (const noDelRol of CATEGORIAS.filter((c) => !delRol.categories.includes(c))) {
            expect(chip(noDelRol).checked).toBe(false);
        }
        expect(allowlist().value).toBe(delRol.allowlist.join(', '));
        expect((screen.getByTestId('browser-profile-level-p1') as HTMLSelectElement).value).toBe(
            (config.defaultsByRole[PARTICIPANTE.role] as { readingLevel: string }).readingLevel,
        );
    });

    it('el perfil guardado GANA al rol, y un array vacio no se lo come', () => {
        const delRol = config.defaultsByRole[PARTICIPANTE.role] as { categories: string[] };
        const otra = CATEGORIAS.find((c) => !delRol.categories.includes(c))!;
        const { unmount } = render(
            <BrowserProfilesPanel
                items={[PARTICIPANTE as never]}
                loading={false}
                profiles={[{ participantId: 'p1', categories: [otra] } as never]}
            />,
        );
        expect(chip(otra).checked).toBe(true);
        unmount();

        // Perfil guardado con categorias VACIAS: la vista cae a los defaults del rol.
        montar({ profiles: [{ participantId: 'p1', categories: [] }] });
        for (const categoria of delRol.categories) {
            expect(chip(categoria).checked).toBe(true);
        }
    });

    it('cargando y sin participantes', () => {
        const { unmount } = render(<BrowserProfilesPanel items={[]} loading />);
        expect(screen.queryByTestId('browser-profiles-list')).toBeNull();
        unmount();

        render(<BrowserProfilesPanel items={[]} loading={false} />);
        expect(screen.getByText(ui.emptyState)).toBeTruthy();
    });
});

describe('BrowserProfilesPanel - edicion', () => {
    it('marcar/desmarcar una categoria guarda el conjunto nuevo con nombre y rol', () => {
        const { onUpdate } = montar();
        const delRol = config.defaultsByRole[PARTICIPANTE.role] as { categories: string[] };
        const nueva = CATEGORIAS.find((c) => !delRol.categories.includes(c))!;

        fireEvent.click(chip(nueva));

        expect(onUpdate).toHaveBeenCalledWith(
            'p1',
            { categories: [...delRol.categories, nueva] },
            'Ana',
            PARTICIPANTE.role,
        );
    });

    it('quitar una categoria del rol la saca del conjunto', () => {
        const { onUpdate } = montar();
        const delRol = config.defaultsByRole[PARTICIPANTE.role] as { categories: string[] };
        const quitada = delRol.categories[0];

        fireEvent.click(chip(quitada));

        expect(onUpdate).toHaveBeenCalledWith(
            'p1',
            { categories: delRol.categories.filter((c) => c !== quitada) },
            'Ana',
            PARTICIPANTE.role,
        );
    });

    it('la allowlist se normaliza al salir del campo', () => {
        const { onUpdate } = montar();

        fireEvent.change(allowlist(), { target: { value: ' Wikipedia.ORG ,  educ.ar , nueva.org ,' } });
        fireEvent.blur(allowlist());

        expect(onUpdate).toHaveBeenCalledWith(
            'p1',
            { allowlist: ['wikipedia.org', 'educ.ar', 'nueva.org'] },
            'Ana',
            PARTICIPANTE.role,
        );
    });

    it('salir del campo sin haber cambiado nada NO guarda', () => {
        const { onUpdate } = montar();

        fireEvent.blur(allowlist());

        expect(onUpdate).not.toHaveBeenCalled();
    });

    it('escribir en la allowlist no guarda hasta salir del campo', () => {
        const { onUpdate } = montar();

        fireEvent.change(allowlist(), { target: { value: 'otra.org' } });

        expect(onUpdate).not.toHaveBeenCalled();
        expect(allowlist().value).toBe('otra.org');
    });

    it('nivel e idioma guardan solo cuando cambian de verdad', () => {
        const { onUpdate } = montar();
        const nivel = screen.getByTestId('browser-profile-level-p1') as HTMLSelectElement;
        const idioma = screen.getByTestId('browser-profile-language-p1') as HTMLSelectElement;
        const actual = nivel.value;
        const otroNivel = config.readingLevels.find((l: string) => l !== actual) as string;
        const otroIdioma = config.languages.find((l: string) => l !== idioma.value) as string;

        fireEvent.change(nivel, { target: { value: actual } });
        expect(onUpdate).not.toHaveBeenCalled();

        fireEvent.change(nivel, { target: { value: otroNivel } });
        expect(onUpdate).toHaveBeenCalledWith('p1', { readingLevel: otroNivel }, 'Ana', PARTICIPANTE.role);

        fireEvent.change(idioma, { target: { value: otroIdioma } });
        expect(onUpdate).toHaveBeenCalledWith('p1', { language: otroIdioma }, 'Ana', PARTICIPANTE.role);
    });

    it('sin onUpdate el editor no revienta ni guarda', () => {
        montar({ onUpdate: null });

        fireEvent.click(chip(CATEGORIAS[0]));
        fireEvent.change(allowlist(), { target: { value: 'x.org' } });
        fireEvent.blur(allowlist());

        expect(screen.getByTestId('browser-profile-p1')).toBeTruthy();
    });

    it('un fallo al guardar se registra y no rompe el panel', async () => {
        const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onUpdate = vi.fn(async () => {
            throw new Error('sin perfil');
        });
        montar({ onUpdate });

        fireEvent.click(chip(CATEGORIAS[0]));

        await vi.waitFor(() => {
            expect(consola).toHaveBeenCalled();
        });
        consola.mockRestore();
    });
});

describe('BrowserProfilesPanel - restablecer', () => {
    it('el boton solo existe si hay perfil guardado y onReset', () => {
        const { unmount } = render(<BrowserProfilesPanel items={[PARTICIPANTE as never]} loading={false} onReset={vi.fn()} />);
        expect(screen.queryByTestId('browser-profile-reset-p1')).toBeNull();
        unmount();

        const { unmount: segundo } = render(
            <BrowserProfilesPanel
                items={[PARTICIPANTE as never]}
                loading={false}
                profiles={[{ participantId: 'p1' } as never]}
            />,
        );
        expect(screen.queryByTestId('browser-profile-reset-p1')).toBeNull();
        segundo();
    });

    it('con perfil y onReset, pulsar restablece', () => {
        const { onReset } = montar({ profiles: [{ participantId: 'p1' }] });

        fireEvent.click(screen.getByTestId('browser-profile-reset-p1'));

        expect(onReset).toHaveBeenCalledWith('p1');
    });
});
