// @vitest-environment jsdom
// ============================================================
// VoiceProfilesPanel - listado y renombrado de participantes (0%).
// ------------------------------------------------------------
// Se sustituye la frontera de configuracion (FLU_CONFIG) por vi.hoisted.
// El modulo bajo prueba (jsx) NO se mockea. Se cubren: estado vacio,
// una fila por participante con fallback de clave/etiqueta, botones por
// fila, eliminacion (con y sin handler) y el flujo completo de renombrado
// (abrir, Escape, Enter con/sin perfil, nombre sin cambios y onBlur).
// ============================================================
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const cfg = vi.hoisted(() => ({ participantsEmpty: 'Sin participantes en la sesion' }));

vi.mock('../src/voice/lib/fluConfig.js', () => ({
    FLU_CONFIG: { ui: { workspace: { participantsEmpty: cfg.participantsEmpty } } },
}));

import { VoiceProfilesPanel } from '../src/voice/components/VoiceProfilesPanel';
import type { VoiceProfileRow } from '../src/voice/components/VoiceProfilesPanel';

const participants: VoiceProfileRow[] = [
    { key: 'p1', label: 'Ana', profileId: 'prof-1' },
    { key: 'p2', label: 'Beto', profileId: '' },
    { key: 'p3', label: 'Caro', profileId: 'prof-3' },
];

const renderPanel = (props: {
    participants?: readonly VoiceProfileRow[];
    onRenameProfile?: (id: string, name: string) => void;
    onRenameSessionSpeaker?: (label: string, name: string) => void;
    onRemoveParticipant?: (row: VoiceProfileRow) => void;
} = {}) => render(<VoiceProfilesPanel participants={participants} {...props} />);

const items = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.voice-profiles__item')) as HTMLElement[];

const buttonsOf = (item: HTMLElement) =>
    Array.from(item.querySelectorAll('button')) as HTMLButtonElement[];

const openRename = (container: HTMLElement, index: number) => {
    fireEvent.click(buttonsOf(items(container)[index])[0]);
    return container.querySelector('.voice-profiles__input') as HTMLInputElement;
};

// ------------------------------------------------------------
// Bloque A: estado vacio
// ------------------------------------------------------------
describe('VoiceProfilesPanel - estado vacio', () => {
    it('sin participantes por defecto muestra el mensaje de configuracion', () => {
        render(<VoiceProfilesPanel />);

        expect(screen.getByText(cfg.participantsEmpty)).toBeTruthy();
    });

    it('con lista vacia muestra el mismo mensaje', () => {
        render(<VoiceProfilesPanel participants={[]} />);

        expect(screen.getByText(cfg.participantsEmpty)).toBeTruthy();
    });
});

// ------------------------------------------------------------
// Bloque B: filas de participantes
// ------------------------------------------------------------
describe('VoiceProfilesPanel - filas', () => {
    it('pinta una fila por participante con su etiqueta', () => {
        const { container } = renderPanel();

        expect(items(container)).toHaveLength(3);
        expect(screen.getByText('Ana')).toBeTruthy();
        expect(screen.getByText('Beto')).toBeTruthy();
        expect(screen.getByText('Caro')).toBeTruthy();
    });

    it('cada fila expone los botones Renombrar y Eliminar', () => {
        const { container } = renderPanel();

        for (const item of items(container)) {
            const btns = buttonsOf(item);
            expect(btns).toHaveLength(2);
            expect(btns[0].textContent).toContain('Renombrar');
            expect(btns[1].textContent).toContain('Eliminar');
        }
    });

    it('edge: cae a label o key cuando falta el otro campo', () => {
        renderPanel({
            participants: [{ label: 'Solo' }, { key: 'k2' } as unknown as VoiceProfileRow],
        });

        expect(screen.getByText('Solo')).toBeTruthy();
        expect(screen.getByText('k2')).toBeTruthy();
    });

    it('Eliminar entrega la fila exacta del participante pulsado', () => {
        const onRemoveParticipant = vi.fn();
        const { container } = renderPanel({ onRemoveParticipant });

        fireEvent.click(buttonsOf(items(container)[1])[1]);

        expect(onRemoveParticipant).toHaveBeenCalledWith({ key: 'p2', label: 'Beto', profileId: '' });
    });

    it('sin handler de eliminacion el clic no lanza', () => {
        const { container } = renderPanel();

        expect(() => fireEvent.click(buttonsOf(items(container)[0])[1])).not.toThrow();
    });
});

// ------------------------------------------------------------
// Bloque C: renombrado
// ------------------------------------------------------------
describe('VoiceProfilesPanel - renombrado', () => {
    it('Renombrar abre un input con la etiqueta actual y Escape cancela', () => {
        const onRenameProfile = vi.fn();
        const onRenameSessionSpeaker = vi.fn();
        const { container } = renderPanel({ onRenameProfile, onRenameSessionSpeaker });

        const input = openRename(container, 0);
        expect(input.value).toBe('Ana');

        fireEvent.change(input, { target: { value: 'Ana Maria' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(container.querySelector('.voice-profiles__input')).toBeNull();
        expect(onRenameProfile).not.toHaveBeenCalled();
        expect(onRenameSessionSpeaker).not.toHaveBeenCalled();
    });

    it('Enter con profileId renombra el perfil y no la sesion', async () => {
        const onRenameProfile = vi.fn();
        const onRenameSessionSpeaker = vi.fn();
        const { container } = renderPanel({ onRenameProfile, onRenameSessionSpeaker });

        const input = openRename(container, 0);
        fireEvent.change(input, { target: { value: 'Ana Maria' } });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        expect(onRenameProfile).toHaveBeenCalledWith('prof-1', 'Ana Maria');
        expect(onRenameSessionSpeaker).not.toHaveBeenCalled();
    });

    it('Enter sin profileId renombra al hablante de la sesion', async () => {
        const onRenameProfile = vi.fn();
        const onRenameSessionSpeaker = vi.fn();
        const { container } = renderPanel({ onRenameProfile, onRenameSessionSpeaker });

        const input = openRename(container, 1);
        expect(input.value).toBe('Beto');
        fireEvent.change(input, { target: { value: 'Beto Dos' } });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        expect(onRenameSessionSpeaker).toHaveBeenCalledWith('Beto', 'Beto Dos');
        expect(onRenameProfile).not.toHaveBeenCalled();
    });

    it('edge: nombre sin cambios o solo espacios no renombra y cierra el input', async () => {
        const onRenameProfile = vi.fn();
        const onRenameSessionSpeaker = vi.fn();
        const { container } = renderPanel({ onRenameProfile, onRenameSessionSpeaker });

        const same = openRename(container, 0);
        fireEvent.change(same, { target: { value: 'Ana' } });
        await act(async () => {
            fireEvent.keyDown(same, { key: 'Enter' });
        });
        expect(container.querySelector('.voice-profiles__input')).toBeNull();

        const blank = openRename(container, 0);
        fireEvent.change(blank, { target: { value: '   ' } });
        await act(async () => {
            fireEvent.keyDown(blank, { key: 'Enter' });
        });

        expect(onRenameProfile).not.toHaveBeenCalled();
        expect(onRenameSessionSpeaker).not.toHaveBeenCalled();
    });

    it('onBlur confirma el renombrado', async () => {
        const onRenameProfile = vi.fn();
        const { container } = renderPanel({ onRenameProfile });

        const input = openRename(container, 2);
        fireEvent.change(input, { target: { value: 'Carolina' } });
        await act(async () => {
            fireEvent.blur(input);
        });

        expect(onRenameProfile).toHaveBeenCalledWith('prof-3', 'Carolina');
    });
});
