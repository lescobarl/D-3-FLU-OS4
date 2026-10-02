import { stripDiacriticsLower } from '../../lib/textUtils';
// ============================================================
// Notes List — Listado de notas (Pizarrón consolidado)
// ------------------------------------------------------------
// Motor puro e inmutable del listado de notas.
// Regla #1: sin hardcode; aquí solo reglas deterministas.
// Cada operación devuelve un arreglo nuevo (sin mutación).
// Las notas pueden asociarse a una persona (multi-usuario).
// ============================================================

export interface Note {
  id: string;
  label: string;
  done: boolean;
  /** Persona que registró la nota (opcional). */
  personId?: string;
  personName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NewNoteInput {
  label: string;
  personId?: string;
  personName?: string;
}

export type NotesFilter = 'all' | 'pending' | 'done';

/** Marca todas las notas como pendientes (no hechas). */
export function uncheckAllNotes(items: readonly Note[]): Note[] {
  const now = Date.now();
  return items.map((note) => (note.done ? { ...note, done: false, updatedAt: now } : note));
}

/** Elimina todas las notas marcadas como hechas. */
export function clearDone(items: readonly Note[]): Note[] {
  return items.filter((note) => !note.done);
}

/** Cuenta notas pendientes. */
export function notesRemaining(items: readonly Note[]): number {
  return items.filter((note) => !note.done).length;
}

/** Filtra notas por estado (genérico: sirve para Note y variantes persistentes). */
export function filterNotes<T extends { done: boolean }>(
  items: readonly T[],
  filter: NotesFilter,
): T[] {
  switch (filter) {
    case 'pending':
      return items.filter((note) => !note.done);
    case 'done':
      return items.filter((note) => note.done);
    default:
      return items.slice();
  }
}

/**
 * Notas PENDIENTES cuyo label coincide con `target` (sin acentos, substring).
 * Fuente única del match para el borrado de nota por voz ("borra la nota X").
 */
export function matchNotesByTarget<T extends { label: string; done: boolean }>(
  items: readonly T[],
  target: string,
): T[] {
  const normalize = (value: string): string =>
    stripDiacriticsLower(value || '').trim();
  const needle = normalize(target);
  if (!needle) return [];
  return items.filter((note) => !note.done && normalize(note.label).includes(needle));
}

/**
 * Aísla notas por usuario: `scope = participantId || 'global'`; una nota sin
 * `personId` se considera del alcance 'global' (legacy). A no ve B.
 */
export function filterNotesByScope<T extends { personId?: string }>(
  items: readonly T[],
  participantId?: string,
): T[] {
  const scope = participantId || 'global';
  return items.filter((note) => (note.personId || 'global') === scope);
}
