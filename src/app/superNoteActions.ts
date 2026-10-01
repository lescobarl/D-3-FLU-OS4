/**
 * Escritura de la lista del súper.
 *
 * Las decisiones (qué fila, qué contenido, qué duplicados) viven en
 * `superNoteTarget`; aquí solo se aplican a la tabla de notas. Existe como
 * módulo propio para que el handler de notas de App.tsx sea una llamada y no
 * una secuencia de escrituras (el trinquete de tamaño de los god-files).
 */
import {
    planSuperNoteWrite,
    removeSuperNoteItems,
    superNoteLabelItems,
    SUPER_TARGET_LABEL,
    type SuperNoteRow,
} from '../core/notes/superNoteTarget';

import { pickText } from '../lib/uiStrings';
/** Operaciones de notas que la escritura necesita (las de `useNotes`). */
export interface SuperNoteStore {
    add: (input: {
        label: string;
        body?: string;
        personId?: string;
        personName?: string;
    }) => Promise<{ ok: boolean }>;
    rename: (id: string, label: string) => Promise<unknown>;
    setBody: (id: string, body: string) => Promise<unknown>;
    softRemove: (id: string) => Promise<unknown>;
}

export interface SuperNoteWriteResult {
    ok: boolean;
    /** Fila viva resultante, o null si la escritura no se aplicó. */
    id: string | null;
    body: string;
}

/**
 * Suma ítems a la lista del súper: renombra el destino a su forma canónica,
 * guarda los ítems en el contenido y retira los duplicados del mismo destino.
 * Si no hay lista viva, la crea. Devuelve si la escritura se aplicó.
 */
export async function writeSuperNoteList(
    store: SuperNoteStore,
    rows: readonly SuperNoteRow[],
    incoming: readonly unknown[],
    person: { personId?: string; personName?: string } = {},
): Promise<SuperNoteWriteResult> {
    const plan = planSuperNoteWrite(rows, incoming);
    const target = plan.target;
    if (target && target.id !== undefined) {
        if (target.label !== SUPER_TARGET_LABEL) {
            await store.rename(target.id, SUPER_TARGET_LABEL);
        }
        const saved = await store.setBody(target.id, plan.body);
        if (!saved) return { ok: false, id: null, body: plan.body };
        for (const duplicate of plan.absorbed) {
            if (duplicate.id !== undefined) await store.softRemove(duplicate.id);
        }
        return { ok: true, id: target.id, body: plan.body };
    }
    const created = await store.add({
        label: SUPER_TARGET_LABEL,
        body: plan.body || undefined,
        personId: person.personId,
        personName: person.personName,
    });
    return { ok: created.ok, id: null, body: plan.body };
}

/** Extrae los ítems dictados de un intent de nota (`{label, body}`). */
export function superNoteIncoming(label: unknown, body: unknown): string[] {
    return [superNoteLabelItems(label), body].map((part) => String(part ?? '').trim());
}

export interface SuperNoteRemoveResult {
    ok: boolean;
    /** true solo si el ítem estaba en la lista y se quitó de verdad. */
    removed: boolean;
    body: string;
}

/**
 * Quita UN ítem de la lista del súper ("borra el cloro de la nota del súper").
 * Reutiliza el MISMO plan de escritura (misma fila viva, mismos ítems heredados
 * absorbidos) y solo cambia el contenido por el que ya no trae ese ítem. Si el
 * ítem no está, NO toca la nota: el handler puede decir que no lo encontró.
 */
export async function removeSuperNoteItem(
    store: SuperNoteStore,
    rows: readonly SuperNoteRow[],
    item: unknown,
): Promise<SuperNoteRemoveResult> {
    const plan = planSuperNoteWrite(rows, []);
    const target = plan.target;
    if (!target || target.id === undefined) return { ok: false, removed: false, body: '' };
    const body = removeSuperNoteItems(plan.body, [item]);
    if (body === plan.body) return { ok: true, removed: false, body: plan.body };
    if (target.label !== SUPER_TARGET_LABEL) {
        await store.rename(target.id, SUPER_TARGET_LABEL);
    }
    const saved = await store.setBody(target.id, body);
    if (!saved) return { ok: false, removed: false, body };
    for (const duplicate of plan.absorbed) {
        if (duplicate.id !== undefined) await store.softRemove(duplicate.id);
    }
    return { ok: true, removed: true, body };
}

/** Respuesta hablada del quitado de ítem (fuente unica ES/EN). */
export function superNoteItemRemovedReply(
    item: string,
    result: SuperNoteRemoveResult,
    lang: 'es' | 'en',
): string {
    if (!result.ok) return pickText(lang, 'no_pude_actualizar_la_nota');
    if (!result.removed) {
        return pickText(lang, 'no_encontre_item_en_la_lista', { item });
    }
    return pickText(lang, 'listo_quite_item_de_la_lista', { item });
}
