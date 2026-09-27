/**
 * Despacho ÚNICO de los comandos de BORRADO de notas por voz: vaciar todas,
 * borrar por destino y quitar un ítem concreto.
 *
 * Vive fuera de App.tsx porque el handler de notas ya era una secuencia de
 * ramas y el trinquete de tamaño de los god-files lo exige. El mapeo
 * intent -> escritura -> respuesta hablada queda en un solo sitio, con los
 * mensajes inyectados (la config de voz sigue siendo la fuente del texto).
 */
import { removeSuperNoteItem, superNoteItemRemovedReply } from './superNoteActions';
import type { SuperNoteRow } from '../core/notes/superNoteTarget';

/** Operaciones de notas que el despacho de borrado necesita (las de `useNotes`). */
export interface NoteRemovalStore {
    add: (input: {
        label: string;
        body?: string;
        personId?: string;
        personName?: string;
    }) => Promise<{ ok: boolean }>;
    rename: (id: string, label: string) => Promise<unknown>;
    setBody: (id: string, body: string) => Promise<unknown>;
    softRemove: (id: string) => Promise<unknown>;
    removeByTarget: (target: string) => Promise<number>;
    clearAll: (opts?: { personId?: string }) => Promise<number>;
}

export interface NoteRemovalIntent {
    action?: string;
    data?: { target?: unknown; item?: unknown };
}

export interface NoteRemovalMessages {
    cleared: string;
    clearedEmpty: string;
    removed: string;
    notFound: string;
}

export interface NoteRemovalOutcome {
    /** true si el comando NO logró su efecto (nada que borrar / no encontrado). */
    failed: boolean;
    /** Respuesta hablada de autoridad (reemplaza la del LLM). */
    text: string;
}

/**
 * Ejecuta el comando de borrado descrito por `intent`. Devuelve `null` si el
 * intent no es de borrado (o le falta el dato), para que el handler siga con el
 * alta normal.
 */
export async function runNoteRemovalIntent(
    intent: NoteRemovalIntent | null,
    store: NoteRemovalStore,
    rows: readonly SuperNoteRow[],
    lang: 'es' | 'en',
    messages: NoteRemovalMessages,
): Promise<NoteRemovalOutcome | null> {
    const action = intent?.action;

    // Vaciar TODAS las notas ("borra todas las notas"). 0 llamadas a IA.
    if (action === 'notes.clear') {
        const count = await store.clearAll();
        return { failed: count === 0, text: count === 0 ? messages.clearedEmpty : messages.cleared };
    }

    // Quitar UN ítem del CONTENIDO de la lista, no la nota entera.
    if (action === 'notes.removeItem') {
        const item = intent?.data?.item ? String(intent.data.item).trim() : '';
        if (!item) return null;
        const result = await removeSuperNoteItem(store, rows, item);
        return {
            failed: !result.ok || !result.removed,
            text: superNoteItemRemovedReply(item, result, lang),
        };
    }

    // Borrar la nota por destino ("borra la nota del súper"). 0 llamadas a IA.
    if (action === 'notes.remove') {
        const target = intent?.data?.target ? String(intent.data.target).trim() : '';
        if (!target) return null;
        const count = await store.removeByTarget(target);
        return { failed: count === 0, text: count === 0 ? messages.notFound : messages.removed };
    }

    return null;
}
