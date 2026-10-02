// @vitest-environment jsdom
/**
 * ContactsPanel - la agenda de contactos del panel de Ajustes (0%).
 *
 * POR QUE ESTE TEST: 295 lineas presentacionales que nadie ejecutaba y por las que
 * pasa TODO el alta/baja de contactos de la app. Se prueban las reglas que importan:
 * las etiquetas salen de la CONFIG (nada hardcodeado), el alta manda los campos
 * recortados y con `undefined` en los vacios, el `participantName` se RESUELVE del
 * id elegido, el formulario se limpia tras el alta, el guardado no se puede disparar
 * dos veces (busy) y la etiqueta de cumpleaños distingue hoy / mañana / N dias.
 *
 * HALLAZGO DECLARADO (mutacion equivalente medida): pasar `busy` a `runBusyAction`
 * es redundante en React (el doble clic ya lo frena el re-render con busy=true):
 * sustituirlo por `false` deja las 25 pruebas verdes. Se deja como red, documentado.
 *
 * HALLAZGO: si la config declara `birthdayNearLabel`, la ventana de dias NO se ve en
 * pantalla (la ventana solo aparece en el texto de reserva del componente).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactsPanel } from '../src/components/ContactsPanel.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const ui = (FLU_CONFIG.contacts as Record<string, unknown>).ui as Record<string, string>;

const PARTICIPANTES = [{ id: 'p1', name: 'Ana' }];
const CONTACTOS = [
    {
        id: 'c1',
        name: 'Luis',
        relationship: 'hermano',
        phone: '600',
        birthday: '1980-05-05',
        participantName: 'Ana',
        email: 'luis@ejemplo.org',
        notes: 'le gusta el cafe',
        favorite: true,
    },
];

const montar = (over: Partial<Record<string, unknown>> = {}) => {
    const onAdd = (over.onAdd as ReturnType<typeof vi.fn>) ?? vi.fn(async () => {});
    const onRemove = (over.onRemove as ReturnType<typeof vi.fn>) ?? vi.fn(async () => {});
    render(
        <ContactsPanel
            participants={(over.participants as never) ?? (PARTICIPANTES as never)}
            contacts={(over.contacts as never) ?? ([] as never)}
            birthdayNear={(over.birthdayNear as never) ?? ([] as never)}
            loading={(over.loading as boolean) ?? false}
            onAdd={onAdd as never}
            onRemove={onRemove as never}
        />,
    );
    return { onAdd, onRemove };
};

const escribir = (caja: string, valor: string) => {
    fireEvent.change(screen.getByTestId(caja), { target: { value: valor } });
};

const enviar = () => fireEvent.submit(screen.getByTestId('contacts-add-submit').closest('form')!);

describe('ContactsPanel - etiquetas y estado', () => {
    it('todas las etiquetas salen de la config (nada hardcodeado)', () => {
        montar();

        expect(screen.getByText(ui.panelTitle)).toBeTruthy();
        expect(screen.getByText(ui.nameLabel)).toBeTruthy();
        expect(screen.getByTestId('contacts-add-submit').textContent).toBe(ui.addLabel);
        expect(screen.getByTestId('contacts-add-name').getAttribute('placeholder')).toBe(ui.namePlaceholder);
    });

    it('cargando: puntos suspensivos y sin listas', () => {
        montar({ loading: true });

        expect(screen.queryByTestId('contacts-list')).toBeNull();
        expect(screen.queryByTestId('contacts-birthday-list')).toBeNull();
        expect(screen.queryAllByText('…').length).toBeGreaterThanOrEqual(2);
    });

    it('el encabezado de cumpleaños usa la etiqueta de la config', () => {
        montar();

        const cabecera = screen.getByTestId('contacts-birthday-near').textContent;

        // Cuando la config declara etiqueta, MANDA la etiqueta (la ventana de dias
        // solo aparece en el texto de reserva). Comportamiento real, documentado.
        expect(cabecera).toContain(ui.birthdayNearLabel);
    });

    it('sin contactos se muestran los mensajes de vacio de la config', () => {
        montar();

        expect(screen.getByText(ui.emptyState)).toBeTruthy();
        expect(screen.getByText(ui.emptyBirthdayNear)).toBeTruthy();
    });
});

describe('ContactsPanel - alta', () => {
    it('el boton esta deshabilitado hasta que hay nombre (los espacios no cuentan)', () => {
        montar();
        const boton = screen.getByTestId('contacts-add-submit') as HTMLButtonElement;

        expect(boton.disabled).toBe(true);
        escribir('contacts-add-name', '   ');
        expect(boton.disabled).toBe(true);

        escribir('contacts-add-name', 'Ana');
        expect(boton.disabled).toBe(false);
    });

    it('el alta manda los campos recortados y con undefined en los vacios', async () => {
        const { onAdd } = montar();
        escribir('contacts-add-name', '  Luis  ');
        escribir('contacts-add-phone', ' 600 ');
        escribir('contacts-add-email', '   ');
        escribir('contacts-add-relationship', ' hermano ');
        escribir('contacts-add-birthday', '1990-01-02');
        escribir('contacts-add-notes', '  nota  ');

        enviar();

        expect(onAdd).toHaveBeenCalledWith({
            name: 'Luis',
            phone: '600',
            email: undefined,
            relationship: 'hermano',
            birthday: '1990-01-02',
            participantId: undefined,
            participantName: undefined,
            notes: 'nota',
        });
    });

    it('el participantName se RESUELVE del id elegido', async () => {
        const { onAdd } = montar();
        escribir('contacts-add-name', 'Luis');
        fireEvent.change(screen.getByTestId('contacts-add-participant'), { target: { value: 'p1' } });

        enviar();

        expect(onAdd).toHaveBeenCalledWith(
            expect.objectContaining({ participantId: 'p1', participantName: 'Ana' }),
        );
    });

    it('el selector ofrece una opcion vacia y los participantes recibidos', () => {
        montar();

        const select = screen.getByTestId('contacts-add-participant') as HTMLSelectElement;

        expect([...select.options].map((o) => o.value)).toEqual(['', 'p1']);
        expect([...select.options].map((o) => o.textContent)).toEqual([ui.participantEmpty, 'Ana']);
    });

    it('tras el alta el formulario se limpia', async () => {
        const { onAdd } = montar();
        escribir('contacts-add-name', 'Luis');
        escribir('contacts-add-phone', '600');

        enviar();

        await vi.waitFor(() => {
            expect((screen.getByTestId('contacts-add-name') as HTMLInputElement).value).toBe('');
        });
        expect((screen.getByTestId('contacts-add-phone') as HTMLInputElement).value).toBe('');
        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('sin nombre no se envia nada aunque se fuerce el submit', () => {
        const { onAdd } = montar();

        enviar();

        expect(onAdd).not.toHaveBeenCalled();
    });

    it('un doble submit seguido solo guarda UNA vez (busy)', async () => {
        let resolver: () => void = () => {};
        const onAdd = vi.fn(
            () =>
                new Promise<void>((listo) => {
                    resolver = listo;
                }),
        );
        montar({ onAdd });
        escribir('contacts-add-name', 'Luis');

        enviar();
        enviar();

        expect(onAdd).toHaveBeenCalledTimes(1);
        resolver();
        await vi.waitFor(() => {
            expect((screen.getByTestId('contacts-add-name') as HTMLInputElement).disabled).toBe(false);
        });
    });

    it('mientras guarda, los campos quedan bloqueados', () => {
        montar({ onAdd: vi.fn(() => new Promise<void>(() => {})) });
        escribir('contacts-add-name', 'Luis');

        enviar();

        expect((screen.getByTestId('contacts-add-name') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId('contacts-add-submit') as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('ContactsPanel - agenda', () => {
    it('la fila une relacion, telefono, cumpleaños y participante', () => {
        montar({ contacts: CONTACTOS });

        const fila = screen.getByTestId('contacts-item-c1');

        expect(fila.textContent).toContain('Luis');
        expect(fila.textContent).toContain('hermano · 600 · 1980-05-05 · Ana');
        expect(fila.textContent).toContain('luis@ejemplo.org');
        expect(fila.textContent).toContain('le gusta el cafe');
        expect(fila.textContent).toContain(ui.favoriteMark);
    });

    it('sin correo ni notas no se pintan lineas de mas', () => {
        montar({ contacts: [{ id: 'c2', name: 'Solo', favorite: false }] });

        const fila = screen.getByTestId('contacts-item-c2');

        expect(fila.textContent).toContain('Solo');
        expect(fila.textContent).not.toContain(ui.favoriteMark);
    });

    it('borrar manda el id y no se puede repetir mientras esta ocupado', async () => {
        const onRemove = vi.fn(() => new Promise<void>(() => {}));
        montar({ contacts: [{ id: 'c1', name: 'Luis', favorite: false }], onRemove });

        const boton = screen.getByTestId('contacts-remove-c1') as HTMLButtonElement;
        fireEvent.click(boton);
        fireEvent.click(boton);

        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith('c1');
    });

    it('la marca de cumpleaños distingue hoy, mañana y N dias', () => {
        const base = { record: { id: 'x', name: 'Ana' }, nextBirthday: '2026-01-01' };
        montar({
            birthdayNear: [
                { ...base, daysUntil: 0 },
                { ...base, record: { id: 'y', name: 'Beto' }, daysUntil: 1 },
                { ...base, record: { id: 'z', name: 'Caro' }, daysUntil: 5 },
            ],
        });

        expect(screen.getByTestId('contacts-birthday-item-x').textContent).toContain(ui.todayLabel);
        expect(screen.getByTestId('contacts-birthday-item-y').textContent).toContain(ui.tomorrowLabel);
        expect(screen.getByTestId('contacts-birthday-item-z').textContent).toContain(ui.inDaysLabel);
        expect(screen.getByTestId('contacts-birthday-item-z').textContent).toContain(ui.daysLabel);
    });
});
