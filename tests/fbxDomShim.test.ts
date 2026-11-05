// ============================================================
// fbxDomShim - conducta del shim mínimo de `document` para THREE
// dentro de un Web Worker.
// ------------------------------------------------------------
// Entorno node (sin DOM): así se prueba de verdad la rama que instala el
// shim. Se sustituye SOLO la frontera de navegador (globalThis.document),
// que aquí simplemente no existe. El módulo bajo prueba NO se mockea.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installDomShim } from '../src/avatar/lib/fbxDomShim';

interface FakeEl {
    tagName: string;
    style: Record<string, unknown>;
    complete: boolean;
    width: number;
    height: number;
    naturalWidth: number;
    naturalHeight: number;
    crossOrigin: string;
    src: string;
    _listeners: Record<string, Array<(...args: unknown[]) => void>>;
    setAttribute(k: string, v: unknown): void;
    getAttribute(k: string): unknown;
    addEventListener(type: string, cb: (...args: unknown[]) => void): void;
    removeEventListener(type: string, cb: (...args: unknown[]) => void): void;
    dispatchEvent(ev?: unknown): boolean;
}

interface FakeDoc {
    createElement(tag?: string): FakeEl;
    createElementNS(ns?: string, tag?: string): FakeEl;
    createCanvas(): FakeEl;
}

const g = globalThis as unknown as { document?: FakeDoc };

const doc = () => g.document as FakeDoc;

beforeEach(() => {
    delete g.document;
});

afterEach(() => {
    delete g.document;
});

describe('installDomShim - instalación', () => {
    it('instala document con las tres fábricas cuando no existe y devuelve true', () => {
        expect(installDomShim()).toBe(true);

        expect(typeof doc().createElement).toBe('function');
        expect(typeof doc().createElementNS).toBe('function');
        expect(typeof doc().createCanvas).toBe('function');
    });

    it('es idempotente: la segunda llamada no reinstala y devuelve false', () => {
        installDomShim();
        const primero = g.document;

        expect(installDomShim()).toBe(false);
        expect(g.document).toBe(primero);
    });

    it('si document ya existe no lo pisa', () => {
        const existente = { marca: 'preexistente' } as unknown as FakeDoc;
        g.document = existente;

        expect(installDomShim()).toBe(false);
        expect(g.document).toBe(existente);
    });
});

describe('installDomShim - elemento falso de imagen', () => {
    it('devuelve un IMG falso con los campos base esperados', () => {
        installDomShim();

        const el = doc().createElement('img');

        expect(el.tagName).toBe('IMG');
        expect(el.style).toEqual({});
        expect(el.complete).toBe(false);
        expect(el.width).toBe(0);
        expect(el.height).toBe(0);
        expect(el.naturalWidth).toBe(0);
        expect(el.naturalHeight).toBe(0);
        expect(el.crossOrigin).toBe('');
    });

    it('createElementNS y createCanvas devuelven el mismo tipo de elemento', () => {
        installDomShim();

        const porNs = doc().createElementNS('http://www.w3.org/1999/xhtml', 'img');
        const canvas = doc().createCanvas();

        expect(porNs.tagName).toBe('IMG');
        expect(canvas.tagName).toBe('IMG');
    });

    it('src arranca vacío y guarda lo asignado sin recargar nada', () => {
        installDomShim();
        const el = doc().createElement('img');

        expect(el.src).toBe('');
        el.src = '/textures/Bunny_Body_1_D.png';
        expect(el.src).toBe('/textures/Bunny_Body_1_D.png');
    });

    it('setAttribute y getAttribute guardan y leen por clave', () => {
        installDomShim();
        const el = doc().createElement('img');

        el.setAttribute('alt', 'bunny');

        expect(el.getAttribute('alt')).toBe('bunny');
    });

    it('registra y elimina listeners, y dispatchEvent responde true', () => {
        installDomShim();
        const el = doc().createElement('img');
        const cb = vi.fn();

        el.addEventListener('load', cb);
        expect(el._listeners.load).toContain(cb);

        el.removeEventListener('load', cb);
        expect(el._listeners.load ?? []).not.toContain(cb);

        expect(el.dispatchEvent()).toBe(true);
    });

    it('cada elemento tiene su propio style (no comparten referencia)', () => {
        installDomShim();

        const a = doc().createElement('img');
        const b = doc().createElement('img');

        expect(a.style).not.toBe(b.style);
    });

    it('devuelve un elemento nuevo en cada llamada', () => {
        installDomShim();

        expect(doc().createElement('img')).not.toBe(doc().createElement('img'));
    });
});
