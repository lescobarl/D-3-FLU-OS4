// ============================================================
// shoppingIntentParser - gramatica REAL de la lista de compras
// ------------------------------------------------------------
// Modulo PURO: se importa el parser real y se ejercen sus frases
// (ES/EN) y sus rechazos. Sin mocks: no hay frontera que sustituir.
// ============================================================
import { describe, expect, it } from 'vitest';
import { parseShoppingIntent } from '../src/core/reminders/shoppingIntentParser';

// ------------------------------------------------------------
// Bloque: alta (shopping.add) en espanol e ingles
// ------------------------------------------------------------
describe('shoppingIntentParser - add', () => {
    it('reconoce las variantes espanolas de alta con lista explicita', () => {
        expect(parseShoppingIntent('agrega leche a la lista de compras')).toEqual({
            handled: true,
            action: 'shopping.add',
            reply: '',
            data: { label: 'leche' },
        });
        expect(parseShoppingIntent('anade pan a la lista')).toEqual({
            handled: true,
            action: 'shopping.add',
            reply: '',
            data: { label: 'pan' },
        });
        expect(parseShoppingIntent('apunta manzanas a las compras')).toEqual({
            handled: true,
            action: 'shopping.add',
            reply: '',
            data: { label: 'manzanas' },
        });
    });

    it('reconoce el alta en ingles', () => {
        expect(parseShoppingIntent('add milk to the shopping list')).toEqual({
            handled: true,
            action: 'shopping.add',
            reply: '',
            data: { label: 'milk' },
        });
    });
});

// ------------------------------------------------------------
// Bloque: marcar/desmarcar (shopping.toggle)
// ------------------------------------------------------------
describe('shoppingIntentParser - toggle', () => {
    it('reconoce tachar/marcar en espanol', () => {
        expect(parseShoppingIntent('tacha leche de la lista de compras')).toEqual({
            handled: true,
            action: 'shopping.toggle',
            reply: '',
            data: { label: 'leche' },
        });
        expect(parseShoppingIntent('marca pan como comprado de la lista')).toEqual({
            handled: true,
            action: 'shopping.toggle',
            reply: '',
            data: { label: 'pan' },
        });
    });

    it('reconoce "check off" en ingles', () => {
        expect(parseShoppingIntent('check off bread from the list')).toEqual({
            handled: true,
            action: 'shopping.toggle',
            reply: '',
            data: { label: 'bread' },
        });
    });
});

// ------------------------------------------------------------
// Bloque: quitar (shopping.remove)
// ------------------------------------------------------------
describe('shoppingIntentParser - remove', () => {
    it('reconoce quitar/borrar en espanol', () => {
        expect(parseShoppingIntent('quita huevos de la lista')).toEqual({
            handled: true,
            action: 'shopping.remove',
            reply: '',
            data: { label: 'huevos' },
        });
        expect(parseShoppingIntent('elimina el arroz de la lista de compras')).toEqual({
            handled: true,
            action: 'shopping.remove',
            reply: '',
            data: { label: 'el arroz' },
        });
    });

    it('reconoce "remove/delete ... from the list" en ingles', () => {
        expect(parseShoppingIntent('remove eggs from the list')).toEqual({
            handled: true,
            action: 'shopping.remove',
            reply: '',
            data: { label: 'eggs' },
        });
    });
});

// ------------------------------------------------------------
// Bloque: mostrar la lista (shopping.list)
// ------------------------------------------------------------
describe('shoppingIntentParser - list', () => {
    it('reconoce las formulas espanolas de mostrar la lista', () => {
        for (const frase of ['muestra la lista de compras', 'dime la lista', 'ver compras', 'lista de compras']) {
            expect(parseShoppingIntent(frase)).toEqual({ handled: true, action: 'shopping.list', reply: '' });
        }
    });

    it('reconoce las formulas inglesas de mostrar la lista', () => {
        for (const frase of ['show me the list', 'open list', 'list']) {
            expect(parseShoppingIntent(frase)).toEqual({ handled: true, action: 'shopping.list', reply: '' });
        }
    });
});

// ------------------------------------------------------------
// Bloque: normalizacion del label
// ------------------------------------------------------------
describe('shoppingIntentParser - normalizacion', () => {
    it('colapsa espacios y recorta el label del articulo', () => {
        expect(parseShoppingIntent('agrega    leche   entera   a la lista')).toEqual({
            handled: true,
            action: 'shopping.add',
            reply: '',
            data: { label: 'leche entera' },
        });
    });
});

// ------------------------------------------------------------
// Bloque: rechazos (no ensucia otros dominios)
// ------------------------------------------------------------
describe('shoppingIntentParser - rechazos', () => {
    it('rechaza altas sin frase de lista', () => {
        expect(parseShoppingIntent('agrega leche')).toEqual({ handled: false, action: null, reply: '' });
        expect(parseShoppingIntent('anota pan')).toEqual({ handled: false, action: null, reply: '' });
        expect(parseShoppingIntent('add milk')).toEqual({ handled: false, action: null, reply: '' });
    });

    it('rechaza quitar/marcar sin frase de lista', () => {
        expect(parseShoppingIntent('quita')).toEqual({ handled: false, action: null, reply: '' });
        expect(parseShoppingIntent('elimina el arroz')).toEqual({ handled: false, action: null, reply: '' });
        expect(parseShoppingIntent('remove eggs')).toEqual({ handled: false, action: null, reply: '' });
    });

    it('rechaza entradas vacias o frases ajenas a compras', () => {
        expect(parseShoppingIntent('')).toEqual({ handled: false, action: null, reply: '' });
        expect(parseShoppingIntent('   ')).toEqual({ handled: false, action: null, reply: '' });
        expect(parseShoppingIntent('hola')).toEqual({ handled: false, action: null, reply: '' });
        expect(parseShoppingIntent('pon la mesa')).toEqual({ handled: false, action: null, reply: '' });
    });
});
