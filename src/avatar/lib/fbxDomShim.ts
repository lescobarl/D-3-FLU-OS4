/**
 * Shim mínimo de `document` para THREE dentro de un Web Worker.
 *
 * Solo se necesita cuando un FBX referencia TEXTURAS: ImageLoader hace
 * `createElementNS('img')`, registra listeners y asigna `image.src` (carga
 * ASÍNCRONA fire-and-forget; parse() no espera). Con el shim, `texture.image`
 * queda undefined -> no-op.
 *
 * BunnyViewer re-materializa los materiales en el hilo principal (repairFBXMaterials),
 * así que las texturas del FBX no se necesitan en el worker.
 *
 * Idempotente: si `document` ya existe (main thread o entorno con DOM), no
 * instala nada y devuelve false.
 *
 * @returns true si instaló el shim; false si `document` ya existía.
 */
/** Elemento falso mínimo que emula un `<img>` para ImageLoader de THREE. */
interface FakeImageElement {
  tagName: string;
  style: Record<string, unknown>;
  complete: boolean;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  crossOrigin: string;
  _listeners: Record<string, Array<(...args: unknown[]) => void>>;
  _src?: unknown;
  [key: string]: unknown;
}

export function installDomShim(): boolean {
  if ((globalThis as { document?: unknown }).document) return false;

  const fakeImage = (): FakeImageElement => {
    const el: FakeImageElement = {
      tagName: 'IMG',
      style: {},
      complete: false,
      width: 0,
      height: 0,
      naturalWidth: 0,
      naturalHeight: 0,
      crossOrigin: '',
      _listeners: {},
      setAttribute(k: string, v: unknown) {
        this[k] = v;
      },
      getAttribute(k: string) {
        return this[k];
      },
      addEventListener(type: string, cb: (...args: unknown[]) => void) {
        (this._listeners[type] = this._listeners[type] || []).push(cb);
      },
      removeEventListener(type: string, cb: (...args: unknown[]) => void) {
        const arr = this._listeners[type] || [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatchEvent() {
        return true;
      },
    };
    Object.defineProperty(el, 'src', {
      set(v: unknown) {
        this._src = v;
      },
      get() {
        return this._src || '';
      },
    });
    return el;
  };

  (globalThis as { document?: unknown }).document = {
    createElement() {
      return fakeImage();
    },
    createElementNS() {
      return fakeImage();
    },
    createCanvas() {
      return fakeImage();
    },
  };
  return true;
}
