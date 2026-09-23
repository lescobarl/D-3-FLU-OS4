/**
 * La puerta unica de almacenamiento — respaldo en memoria (sin navegador).
 *
 * Prueba lo que no puede fallar: que lo escrito se lee despues. Resolver el
 * almacenamiento EN CADA ACCESO devolvia un mapa nuevo, asi que escribir y leer
 * perdia el dato; este test fija que el mapa es de modulo.
 */
import { describe, expect, it } from 'vitest';
import {
  hasLocalStorage,
  localGet,
  localKeys,
  localRemove,
  localSet,
  localStorePort,
} from '../src/core/storage/localStore';

describe('localStore — respaldo en memoria (sin window)', () => {
  it('sin navegador, hasLocalStorage() es false', () => {
    expect(typeof window).toBe('undefined');
    expect(hasLocalStorage()).toBe(false);
  });

  it('lo escrito se lee despues: el almacen es uno, no uno por acceso', () => {
    localSet('p59-clave', 'valor');
    expect(localGet('p59-clave')).toBe('valor');
    expect(localStorePort()).toBe(localStorePort());
  });

  it('coerciona igual que la plataforma', () => {
    localSet('p59-num', 42);
    localSet('p59-bool', false);
    expect(localGet('p59-num')).toBe('42');
    expect(localGet('p59-bool')).toBe('false');
  });

  it('borra y lista claves', () => {
    localSet('p59-a', '1');
    localSet('p59-b', '2');
    expect(localKeys()).toEqual(expect.arrayContaining(['p59-a', 'p59-b']));
    localRemove('p59-a');
    expect(localGet('p59-a')).toBeNull();
    expect(localKeys()).not.toContain('p59-a');
  });

  it('una clave ausente es null, no undefined', () => {
    expect(localGet('p59-no-existe')).toBeNull();
  });

  it('resolveSafeStorage() comparte el respaldo con la puerta (un solo universo)', async () => {
    const { resolveSafeStorage } = await import('../src/store/storage');
    resolveSafeStorage().setItem('p59-zustand', 'v');
    expect(localGet('p59-zustand')).toBe('v');
    expect(localStorePort()).toBe(resolveSafeStorage());
  });
});
