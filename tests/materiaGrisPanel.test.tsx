// @vitest-environment jsdom
// ============================================================
// MateriaGrisPanel - panel de gamificacion (materia gris).
// ------------------------------------------------------------
// Componente presentacional controlado: recibe participantes,
// leaderboard, historial y onAward por props. No toca stores ni red,
// por lo que NO se mockea nada; el catalogo FLU_CONFIG.materiaGris se
// usa real (Regla #1: etiquetas y tabla de acciones desde config).
//
//   Bloque A - formulario de entrega: opciones, habilitacion y onAward.
//   Bloque B - estado "en vuelo": bloqueo y rehabilitacion de campos.
//   Bloque C - leaderboard: carga, vacio y filas.
//   Bloque D - historial: oculto si vacio, filas y tope de 20.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MateriaGrisPanel, type MateriaGrisPanelProps } from '../src/components/MateriaGrisPanel';
import type { MateriaGrisRecord, ParticipantRecord } from '../src/core/db/fluDatabase';
import type { AwardInput, LeaderboardRow } from '../src/core/multiuser/materiaGrisService';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';

const SYNC = { revision: 1, updated_at: '', deleted: false };

function participant(id: string, name: string): ParticipantRecord {
    return { id, name, createdAt: 1, updatedAt: 1, sync: { ...SYNC } };
}

function record(over: Partial<MateriaGrisRecord> = {}): MateriaGrisRecord {
    return {
        id: 'r1',
        participantId: 'p1',
        participantName: 'Ana',
        action: 'tarea_hogar',
        points: 5,
        createdAt: 1,
        updatedAt: 1,
        sync: { ...SYNC },
        ...over,
    };
}

function row(over: Partial<LeaderboardRow> = {}): LeaderboardRow {
    return { participantId: 'p1', participantName: 'Ana', points: 12, actions: 3, ...over };
}

function panel(over: Partial<MateriaGrisPanelProps> = {}) {
    const props: MateriaGrisPanelProps = {
        participants: [participant('p1', 'Ana'), participant('p2', 'Beto')],
        leaderboard: [],
        history: [],
        loading: false,
        onAward: vi.fn(async (_input: AwardInput) => {}),
        ...over,
    };
    const utils = render(<MateriaGrisPanel {...props} />);
    return { ...utils, props };
}

function chooseParticipant(id: string) {
    fireEvent.change(screen.getByTestId('materiagris-award-participant'), { target: { value: id } });
}

function chooseAction(action: string) {
    fireEvent.change(screen.getByTestId('materiagris-award-action'), { target: { value: action } });
}

describe('MateriaGrisPanel - Bloque A: formulario de entrega', () => {
    it('el titulo del panel sale del catalogo', () => {
        panel();
        expect(screen.getByText(FLU_CONFIG.materiaGris.ui.panelTitle)).toBeTruthy();
        expect(FLU_CONFIG.materiaGris.ui.panelTitle).toBe('Materia gris');
    });

    it('el selector de participante ofrece el vacio y un item por participante', () => {
        panel();
        const select = screen.getByTestId('materiagris-award-participant') as HTMLSelectElement;
        const opts = Array.from(select.querySelectorAll('option'));
        expect(opts).toHaveLength(3);
        expect(opts[0].value).toBe('');
        expect(opts[1].textContent).toBe('Ana');
        expect(opts[2].textContent).toBe('Beto');
    });

    it('el selector de accion usa la tabla de config con etiqueta y puntos', () => {
        panel();
        const select = screen.getByTestId('materiagris-award-action') as HTMLSelectElement;
        const opts = Array.from(select.querySelectorAll('option'));
        const actionCount = Object.keys(FLU_CONFIG.materiaGris.actions).length;
        expect(opts).toHaveLength(actionCount + 1);
        // P9.86b: la clave se toma del CATALOGO real (Regla #1); 'tarea_hogar' salio de
        // FLU_CONFIG.materiaGris.actions y el test la hardcodeaba.
        const clave = 'cuento';
        expect(Object.keys(FLU_CONFIG.materiaGris.actions)).toContain(clave);
        const tarea = opts.find((o) => o.value === clave) as HTMLOptionElement;
        expect(tarea.textContent).toBe('Participar en un cuento (10 pts)');
    });

    it('otorgar esta deshabilitado hasta elegir participante y accion', () => {
        panel();
        const submit = screen.getByTestId('materiagris-award-submit') as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        chooseParticipant('p1');
        expect(submit.disabled).toBe(true);
        chooseAction('cuento');
        expect(submit.disabled).toBe(false);
    });

    it('el submit entrega id, nombre resuelto y accion', async () => {
        const { props } = panel();
        chooseParticipant('p2');
        chooseAction('cuento');
        fireEvent.click(screen.getByTestId('materiagris-award-submit'));
        await waitFor(() => {
            expect(props.onAward).toHaveBeenCalledWith({
                participantId: 'p2',
                participantName: 'Beto',
                action: 'cuento',
            });
        });
    });

    it('un submit sin seleccion no entrega nada', () => {
        const { props, container } = panel();
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);
        expect(props.onAward).not.toHaveBeenCalled();
    });
});

describe('MateriaGrisPanel - Bloque B: estado en vuelo', () => {
    it('mientras onAward esta pendiente se bloquean los campos y luego se rehabilitan', async () => {
        let resolveAward: () => void = () => {};
        const pending = new Promise<void>((resolve) => {
            resolveAward = resolve;
        });
        const onAward = vi.fn(() => pending);
        panel({ onAward });

        chooseParticipant('p1');
        chooseAction('cuento');
        fireEvent.click(screen.getByTestId('materiagris-award-submit'));

        const select = screen.getByTestId('materiagris-award-participant') as HTMLSelectElement;
        const submit = screen.getByTestId('materiagris-award-submit') as HTMLButtonElement;
        expect(select.disabled).toBe(true);
        expect(submit.disabled).toBe(true);

        resolveAward();
        await waitFor(() => {
            expect(submit.disabled).toBe(false);
        });
        expect((screen.getByTestId('materiagris-award-participant') as HTMLSelectElement).disabled).toBe(false);
    });
});

describe('MateriaGrisPanel - Bloque C: leaderboard', () => {
    it('en carga muestra el indicador y no la lista', () => {
        const { container } = panel({ loading: true });
        expect(screen.queryByTestId('materiagris-leaderboard')).toBeNull();
        expect(container.querySelector('.flu-settings-image-config__hint')?.textContent).toBeTruthy();
    });

    it('sin filas muestra el estado vacio del catalogo', () => {
        panel({ loading: false, leaderboard: [] });
        expect(screen.getByText(/puntos otorgados/)).toBeTruthy();
        expect(screen.queryByTestId('materiagris-leaderboard')).toBeNull();
    });

    it('lista nombre, puntos y numero de acciones; cae al id si falta el nombre', () => {
        panel({
            leaderboard: [
                row({ participantId: 'p1', participantName: 'Ana', points: 12, actions: 3 }),
                row({ participantId: 'p9', participantName: undefined, points: 4, actions: 1 }),
            ],
        });
        const list = screen.getByTestId('materiagris-leaderboard');
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('Ana');
        expect(items[0].textContent).toContain('12 pts');
        expect(items[0].textContent).toContain('3 acciones');
        expect(items[1].textContent).toContain('p9');
    });
});

describe('MateriaGrisPanel - Bloque D: historial', () => {
    it('el historial se oculta cuando esta vacio y aparece con entradas', () => {
        const empty = panel({ history: [] });
        expect(screen.queryByTestId('materiagris-history')).toBeNull();
        empty.unmount();

        panel({ history: [record({ id: 'h1' })] });
        expect(screen.getByTestId('materiagris-history')).toBeTruthy();
    });

    it('cada fila muestra participante, accion y puntos con signo + y se cortan a 20', () => {
        const history = Array.from({ length: 25 }, (_, i) =>
            record({ id: `h${i}`, participantName: `P${i}`, action: 'tarea_hogar', points: 5 }),
        );
        panel({ history });
        const list = screen.getByTestId('materiagris-history');
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(20);
        expect(items[0].textContent).toContain('P0');
        expect(items[0].textContent).toContain('tarea_hogar');
        expect(items[0].textContent).toContain('+5 pts');
    });
});
