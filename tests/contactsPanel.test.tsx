// @vitest-environment jsdom
/**
 * ContactsPanel — contactos compactos dentro del panel HOY.
 *
 * Navegación como Notas: fila, título, detalle al expandir y acción.
 * Se prueban consulta, alta/baja, cumpleaños y etiquetas de config.
 * No usa demo (MODE=test): los ejemplos solo existen en desarrollo.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    createdAt: 2,
  },
  {
    id: 'c2',
    name: 'Beto',
    relationship: 'amigo',
    phone: '700',
    email: 'beto@ejemplo.org',
    favorite: false,
    createdAt: 1,
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

describe('ContactsPanel — consulta compacta', () => {
  it('muestra contador, búsqueda y filas', () => {
    montar({ contacts: CONTACTOS });

    expect(screen.getByText('2/2')).toBeTruthy();
    expect(screen.getByTestId('contacts-search').getAttribute('placeholder')).toBe(ui.searchPlaceholder);
    expect(screen.getAllByTestId(/contacts-item-/)).toHaveLength(2);
  });

  it('busca por nombre, teléfono o correo', () => {
    montar({ contacts: CONTACTOS });

    escribir('contacts-search', '700');
    expect(screen.getByTestId('contacts-item-c2')).toBeTruthy();
    expect(screen.queryByTestId('contacts-item-c1')).toBeNull();

    escribir('contacts-search', 'luis@ejemplo');
    expect(screen.getByTestId('contacts-item-c1')).toBeTruthy();
    expect(screen.queryByTestId('contacts-item-c2')).toBeNull();
  });

  it('filtra por relación y ordena por nombre', () => {
    montar({ contacts: CONTACTOS });

    fireEvent.change(screen.getByTestId('contacts-filter-relationship'), { target: { value: 'amigo' } });
    expect(screen.getByTestId('contacts-item-c2')).toBeTruthy();
    expect(screen.queryByTestId('contacts-item-c1')).toBeNull();

    fireEvent.change(screen.getByTestId('contacts-filter-relationship'), { target: { value: 'all' } });
    const filas = screen.getAllByTestId(/contacts-item-/).map((fila) => fila.textContent);
    expect(filas[0]).toContain('Beto');
    expect(filas[1]).toContain('Luis');
  });

  it('sin coincidencias y sin contactos muestra el mensaje de la config', () => {
    montar({ contacts: CONTACTOS });
    escribir('contacts-search', 'zzz');
    expect(screen.getByText(ui.noResults)).toBeTruthy();
  });

  it('sin contactos muestra el vacío de la config', () => {
    montar();
    expect(screen.getByText(ui.emptyState)).toBeTruthy();
  });

  it('cargando no pinta filas ni cumpleaños', () => {
    montar({ loading: true });
    expect(screen.queryByTestId('contacts-list')).toBeNull();
    expect(screen.queryByTestId('contacts-birthday-near')).toBeNull();
  });
});

describe('ContactsPanel — alta', () => {
  it('el alta nace colapsada', () => {
    montar();
    const details = screen.getByText(ui.addLabel).closest('details');
    expect(details?.open).toBe(false);
  });

  it('el botón está deshabilitado hasta que hay nombre', () => {
    montar();
    const boton = screen.getByTestId('contacts-add-submit') as HTMLButtonElement;

    expect(boton.textContent).toBe(ui.saveContactLabel);
    expect(boton.disabled).toBe(true);
    escribir('contacts-add-name', '   ');
    expect(boton.disabled).toBe(true);
    escribir('contacts-add-name', 'Ana');
    expect(boton.disabled).toBe(false);
  });

  it('no hay campo de notas', () => {
    montar();
    expect(screen.queryByTestId('contacts-add-notes')).toBeNull();
  });

  it('manda los campos recortados y resuelve el participante', async () => {
    const { onAdd } = montar();
    escribir('contacts-add-name', '  Luis  ');
    escribir('contacts-add-phone', ' 600 ');
    escribir('contacts-add-email', '   ');
    escribir('contacts-add-relationship', ' hermano ');
    escribir('contacts-add-birthday', '1990-01-02');
    fireEvent.change(screen.getByTestId('contacts-add-participant'), { target: { value: 'p1' } });

    await act(async () => {
      enviar();
    });

    expect(onAdd).toHaveBeenCalledWith({
      name: 'Luis',
      phone: '600',
      email: undefined,
      relationship: 'hermano',
      birthday: '1990-01-02',
      participantId: 'p1',
      participantName: 'Ana',
    });
  });

  it('tras el alta el formulario se limpia', async () => {
    const { onAdd } = montar();
    escribir('contacts-add-name', 'Luis');

    await act(async () => {
      enviar();
    });

    await vi.waitFor(() => {
      expect((screen.getByTestId('contacts-add-name') as HTMLInputElement).value).toBe('');
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('sin nombre no envía y un doble submit guarda una vez', async () => {
    let resolver: () => void = () => {};
    const onAdd = vi.fn(
      () =>
        new Promise<void>((listo) => {
          resolver = listo;
        }),
    );
    montar({ onAdd });

    enviar();
    expect(onAdd).not.toHaveBeenCalled();

    escribir('contacts-add-name', 'Luis');
    await act(async () => {
      enviar();
      enviar();
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolver();
    });
  });
});

describe('ContactsPanel — fila, detalle, cumpleaños y baja', () => {
  it('la fila muestra nombre y meta; expandir muestra el detalle', () => {
    montar({ contacts: CONTACTOS });
    const fila = screen.getByTestId('contacts-item-c1');

    expect(within(fila).getByRole('button', { name: /Luis/ })).toBeTruthy();
    expect(fila.textContent).toContain('hermano · 600');

    fireEvent.click(within(fila).getByRole('button', { name: /Luis/ }));
    expect(fila.textContent).toContain('luis@ejemplo.org');
    expect(fila.textContent).toContain('1980-05-05');
    expect(fila.textContent).toContain('Ana');
  });

  it('borrar manda el id y no se repite mientras está ocupado', () => {
    const onRemove = vi.fn(() => new Promise<void>(() => {}));
    montar({ contacts: [{ id: 'c1', name: 'Luis', favorite: false }], onRemove });

    const boton = screen.getByTestId('contacts-remove-c1') as HTMLButtonElement;
    fireEvent.click(boton);
    fireEvent.click(boton);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('c1');
  });

  it('la marca de cumpleaños distingue hoy, mañana y N días', () => {
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
  });
});
