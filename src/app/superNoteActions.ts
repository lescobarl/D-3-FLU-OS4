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
    superNoteLabelItems,
    SUPER_TARGET_LABEL,
    type SuperNoteRow,
} from '../core/notes/superNoteTarget';

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
