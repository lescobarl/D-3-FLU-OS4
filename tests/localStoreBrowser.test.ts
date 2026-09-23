// @vitest-environment jsdom
/**
 * La puerta unica de almacenamiento — camino del navegador (jsdom).
 *
 * Lo importante aqui no es "funciona", es que detras este el almacenamiento
 * REAL y no el respaldo en memoria: un doble silencioso que guardase en un
 * mapa no se notaria hasta que el usuario recargara y perdiera su config.
 */
import { describe, expect, it } from 'vitest';
import {
  hasLocalStorage,
  localGet,
  localKeys,
  localRemove,
  localSet,
} from '../src/core/storage/localStore';

describe('localStore — camino del navegador', () => {
  it('detras esta el almacenamiento real', () => {
    expect(hasLocalStorage()).toBe(true);
  });

  it('lo escrito se ve en window.localStorage (no en un mapa)', () => {
    localSet('p59-browser', 'v');
    expect(localGet('p59-browser')).toBe('v');
    expect(window.localStorage.getItem('p59-browser')).toBe('v');
    expect(localKeys()).toContain('p59-browser');
    localRemove('p59-browser');
    expect(window.localStorage.getItem('p59-browser')).toBeNull();
  });
});
