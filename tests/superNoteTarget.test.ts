// ============================================================
// superNoteTarget.test.ts — Guard de la forma canónica del destino "Super"
// ------------------------------------------------------------
// La lista del súper es UNA nota llamada 'Super' con los ÍTEMS en el contenido,
// uno por línea (misma forma que la nota de demo). El caso que falsifica este
// guard es el defecto medido: el ítem dentro del NOMBRE ("Super: el cloro"), con
// el título comiéndose la lista — cualquiera de estos casos falla si vuelve.
// ============================================================
import { describe, expect, it } from 'vitest';
import {
    appendSuperNoteItems,
    isSuperNoteLabel,
    planSuperNoteWrite,
    superNoteItems,
    superNoteLabelItems,
} from '../src/core/notes/superNoteTarget';

const note = (id: string, label: string, body?: string, createdAt = 1) => ({
    id,
    label,
    body,
    done: false,
    createdAt,
    updatedAt: createdAt,
});

describe('destino "Super": los ítems viven en el contenido', () => {
    it('reconoce el destino en la forma canónica y en la heredada "Super: X"', () => {
        expect(isSuperNoteLabel('Super')).toBe(true);
        expect(isSuperNoteLabel('Super: cloro')).toBe(true);
        expect(isSuperNoteLabel('Supermercado')).toBe(false);
        expect(superNoteLabelItems('Super: cloro')).toBe('cloro');
        expect(superNoteLabelItems('Super')).toBe('');
    });

    it('el ítem nuevo va al contenido, no al nombre', () => {
        const plan = planSuperNoteWrite([note('n1', 'Super', 'huevo\npan')], ['jamon huevo y pollo']);
        expect(plan.target?.id).toBe('n1');
        expect(superNoteItems(plan.body)).toEqual(['huevo', 'pan', 'jamon huevo y pollo']);
    });

    it('no repite un ítem que ya está en la lista (ni con otro artículo)', () => {
        const plan = planSuperNoteWrite([note('n1', 'Super', 'huevo\npan\ncloro')], ['el cloro']);
        expect(superNoteItems(plan.body)).toEqual(['huevo', 'pan', 'cloro']);
    });

    it('una etiqueta heredada "Super: X" deja el nombre libre y su ítem dentro', () => {
        const plan = planSuperNoteWrite([note('n1', 'Super: cloro')], ['pan']);
        expect(superNoteLabelItems(plan.target!.label)).toBe('cloro');
        expect(superNoteItems(plan.body)).toEqual(['cloro', 'pan']);
    });

    it('absorbe los duplicados del mismo destino: la lista vuelve a ser una sola', () => {
        const plan = planSuperNoteWrite(
            [note('n1', 'Super', 'huevo', 1), note('n2', 'Super: pan', undefined, 2)],
            ['leche'],
        );
        expect(plan.target?.id).toBe('n1');
        expect(plan.absorbed.map((r) => r.id)).toEqual(['n2']);
        expect(superNoteItems(plan.body)).toEqual(['huevo', 'pan', 'leche']);
    });

    it('sin nota viva no hay destino, y el contenido llega listo para crear', () => {
        const plan = planSuperNoteWrite([], ['cloro']);
        expect(plan.target).toBeNull();
        expect(superNoteItems(plan.body)).toEqual(['cloro']);
    });

    it('la unión de ítems acepta separadores de lista y descarta vacíos', () => {
        expect(superNoteItems(appendSuperNoteItems('pan, huevo; cloro', ['', '  ', 'leche']))).toEqual([
            'pan',
            'huevo',
            'cloro',
            'leche',
        ]);
    });
});
