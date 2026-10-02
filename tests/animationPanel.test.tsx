// @vitest-environment jsdom
/**
 * AnimationPanel - botonera de animaciones del avatar (0%).
 *
 * POR QUE ESTE TEST: 126 lineas que son la unica UI que dispara las animaciones del
 * personaje. Se sustituye SOLO la frontera del store (zustand) y se comprueba el
 * contrato que ve el usuario: la cabecera, el boton de detener condicionado a
 * isPlaying, el catalogo agrupado por categoria con su color, el estado active/disabled
 * y que cada clic entrega el id EXACTO de la animacion al store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const store = vi.hoisted(() => {
  const state = {
    currentAnimation: 'Idle_2' as string | null,
    isPlaying: true,
    playAnimation: vi.fn(),
    stopAnimation: vi.fn(),
  };
  return { state };
});

vi.mock('../src/avatar/store/bunnyStore', () => ({
  useBunnyStore: (selector: (s: typeof store.state) => unknown) => selector(store.state),
}));

import AnimationPanel from '../src/avatar/components/AnimationPanel';

const botonAnim = (id: string) =>
  document.querySelector(`[data-animation="${id}"]`) as HTMLButtonElement;

beforeEach(() => {
  store.state.currentAnimation = 'Idle_2';
  store.state.isPlaying = true;
  store.state.playAnimation.mockClear();
  store.state.stopAnimation.mockClear();
});

describe('AnimationPanel - cabecera', () => {
  it('pinta el titulo del panel', () => {
    render(<AnimationPanel />);

    expect(screen.getByText('ANIMACIONES')).toBeTruthy();
  });

  it('con isPlaying muestra DETENER y el clic llama a stopAnimation', () => {
    store.state.isPlaying = true;
    render(<AnimationPanel />);

    const detener = screen.getByRole('button', { name: /DETENER/ });
    fireEvent.click(detener);

    expect(store.state.stopAnimation).toHaveBeenCalledTimes(1);
  });

  it('sin isPlaying NO aparece el boton DETENER', () => {
    store.state.isPlaying = false;
    render(<AnimationPanel />);

    expect(screen.queryByRole('button', { name: /DETENER/ })).toBeNull();
  });
});

describe('AnimationPanel - catalogo por categorias', () => {
  it('pinta las 15 animaciones como botones con su data-animation', () => {
    render(<AnimationPanel />);

    expect(document.querySelectorAll('[data-animation]').length).toBe(15);
    expect(botonAnim('Idle_1')).toBeTruthy();
    expect(botonAnim('Walk_sneaky')).toBeTruthy();
    expect(botonAnim('Dance')).toBeTruthy();
  });

  it('agrupa en las 5 categorias en el orden definido', () => {
    render(<AnimationPanel />);

    const etiquetas = Array.from(document.querySelectorAll('.category-label')).map(
      (el) => el.textContent,
    );
    expect(etiquetas).toEqual([
      'Reposo',
      'Locomoci\u00f3n',
      'Faciales',
      'Acciones',
      'Celebraci\u00f3n',
    ]);
  });

  it('el color de cada categoria sale del mapa (Reposo = #555)', () => {
    render(<AnimationPanel />);

    const reposo = document.querySelector('.category-label') as HTMLElement;
    expect(reposo.style.color).toBe('rgb(85, 85, 85)');
  });
});

describe('AnimationPanel - botones de animacion', () => {
  it('el clic entrega el id EXACTO de la animacion al store', () => {
    // Con isPlaying=true los botones no activos estan disabled (el clic no dispara);
    // para probar ENTREGA de id se parte del estado detenido, donde todos son clicables.
    store.state.isPlaying = false;
    render(<AnimationPanel />);

    fireEvent.click(botonAnim('Walk_sneaky'));
    fireEvent.click(botonAnim('Dance'));

    expect(store.state.playAnimation.mock.calls.map((c) => c[0])).toEqual([
      'Walk_sneaky',
      'Dance',
    ]);
  });

  it('el boton de la animacion activa se marca active y no se deshabilita', () => {
    store.state.currentAnimation = 'Dance';
    store.state.isPlaying = true;
    render(<AnimationPanel />);

    expect(botonAnim('Dance').className).toContain('active');
    expect(botonAnim('Dance').disabled).toBe(false);
  });

  it('con isPlaying los demas botones quedan deshabilitados', () => {
    store.state.currentAnimation = 'Dance';
    store.state.isPlaying = true;
    render(<AnimationPanel />);

    expect(botonAnim('Walk').disabled).toBe(true);
    expect(botonAnim('Idle_2').disabled).toBe(true);
  });

  it('con isPlaying, el clic en un boton deshabilitado NO dispara playAnimation', () => {
    store.state.currentAnimation = 'Dance';
    store.state.isPlaying = true;
    render(<AnimationPanel />);

    fireEvent.click(botonAnim('Walk'));

    expect(store.state.playAnimation).not.toHaveBeenCalled();
  });

  it('sin isPlaying ningun boton se deshabilita', () => {
    store.state.isPlaying = false;
    render(<AnimationPanel />);

    const deshabilitados = Array.from(document.querySelectorAll('[data-animation]')).filter(
      (b) => (b as HTMLButtonElement).disabled,
    );
    expect(deshabilitados.length).toBe(0);
  });

  it('el title de cada boton es la descripcion de la animacion', () => {
    render(<AnimationPanel />);

    expect(botonAnim('Bind-pose').getAttribute('title')).toBe('Pose base de referencia');
    expect(botonAnim('Run').getAttribute('title')).toBe('Correr');
  });
});
