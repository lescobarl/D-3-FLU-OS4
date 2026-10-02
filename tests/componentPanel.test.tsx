// @vitest-environment jsdom
/**
 * ComponentPanel - botonera de partes del modelo 3D (0%).
 *
 * POR QUE ESTE TEST: 126 lineas que son la unica UI que muestra/oculta partes del
 * Bunny. Se sustituye SOLO la frontera del store (zustand) y se prueba el contrato
 * visible: el catalogo de 8 componentes, el estado ON/OFF leido del store, la clase
 * active segun visibilidad, la clase "disabled" que SOLO llevan los componentes sin
 * grupo del FBX (y que es cosmetica, no un atributo HTML), y que el clic entrega el
 * id EXACTO al store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const store = vi.hoisted(() => {
  const state = {
    components: {} as Record<string, boolean>,
    toggleComponent: vi.fn(),
  };
  return { state };
});

vi.mock('../src/avatar/store/bunnyStore', () => ({
  useBunnyStore: (selector: (s: typeof store.state) => unknown) => selector(store.state),
}));

import ComponentPanel from '../src/avatar/components/ComponentPanel';

const boton = (id: string) =>
  document.querySelector(`[data-component="${id}"]`) as HTMLButtonElement;

beforeEach(() => {
  store.state.components = {
    Bunny_full: true,
    Bunny_body: true,
    Bunny_cap: true,
    Bunny_pants: true,
    Bunny_face: true,
    Bunny_eyes: true,
    Bunny_glasses: false,
    Bunny_ears: true,
  };
  store.state.toggleComponent.mockClear();
});

describe('ComponentPanel - cabecera y catalogo', () => {
  it('pinta el titulo del panel', () => {
    render(<ComponentPanel />);

    expect(screen.getByText('COMPONENTES')).toBeTruthy();
  });

  it('pinta los 8 componentes con data-component, etiqueta y estado', () => {
    render(<ComponentPanel />);

    expect(document.querySelectorAll('[data-component]').length).toBe(8);
    expect(boton('Bunny_eyes').textContent).toContain('Eyes');
    expect(boton('Bunny_eyes').textContent).toContain('ON');
  });
});

describe('ComponentPanel - estado ON/OFF', () => {
  it('la visibilidad del store decide ON/OFF y la clase active', () => {
    store.state.components = { ...store.state.components, Bunny_body: false, Bunny_cap: true };
    render(<ComponentPanel />);

    expect(boton('Bunny_body').textContent).toContain('OFF');
    expect(boton('Bunny_body').className).not.toContain('active');
    expect(boton('Bunny_cap').textContent).toContain('ON');
    expect(boton('Bunny_cap').className).toContain('active');
  });

  it('con todos los componentes ocultos los 8 botones quedan en OFF', () => {
    store.state.components = Object.fromEntries(
      Object.keys(store.state.components).map((clave) => [clave, false]),
    );
    render(<ComponentPanel />);

    expect(screen.getAllByText('OFF').length).toBe(8);
    expect(screen.queryByText('ON')).toBeNull();
  });
});

describe('ComponentPanel - grupos y clic', () => {
  it('solo los componentes sin grupo llevan la clase disabled', () => {
    render(<ComponentPanel />);

    const conClase = Array.from(document.querySelectorAll('[data-component]'))
      .filter((b) => b.className.includes('disabled'))
      .map((b) => b.getAttribute('data-component'))
      .sort();

    expect(conClase).toEqual(['Bunny_ears', 'Bunny_full', 'Bunny_glasses']);
  });

  it('los componentes con grupo NO llevan disabled', () => {
    render(<ComponentPanel />);

    expect(boton('Bunny_body').className).not.toContain('disabled');
    expect(boton('Bunny_face').className).not.toContain('disabled');
    expect(boton('Bunny_pants').className).not.toContain('disabled');
  });

  it('el clic entrega el id EXACTO del componente al store', () => {
    render(<ComponentPanel />);

    fireEvent.click(boton('Bunny_cap'));
    fireEvent.click(boton('Bunny_face'));

    expect(store.state.toggleComponent.mock.calls.map((c) => c[0])).toEqual([
      'Bunny_cap',
      'Bunny_face',
    ]);
  });

  it('los botones "disabled" son solo cosmeticos: el clic igual llega al store', () => {
    render(<ComponentPanel />);

    fireEvent.click(boton('Bunny_glasses'));

    expect(store.state.toggleComponent).toHaveBeenCalledWith('Bunny_glasses');
    expect(boton('Bunny_glasses').disabled).toBe(false);
  });

  it('el title de cada boton es la descripcion del componente', () => {
    render(<ComponentPanel />);

    expect(boton('Bunny_eyes').getAttribute('title')).toContain('Eye_R');
    expect(boton('Bunny_pants').getAttribute('title')).toBe(
      'Pantalones y cinturones (grupo Pants)',
    );
  });
});
