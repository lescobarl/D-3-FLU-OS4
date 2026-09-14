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

/** Agrega una nota al final de la lista. */
export function addNote(items: readonly Note[], input: NewNoteInput): Note[] {
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label) return items.slice();
  const now = Date.now();
  const note: Note = {
    id: input.personId ? `${input.personId}-${now}` : `note-${now}`,
    label,
    done: false,
    personId: input.personId,
    personName: input.personName,
    createdAt: now,
    updatedAt: now,
  };
  return [...items, note];
}

/** Alterna el estado done de una nota. */
export function toggleNote(items: readonly Note[], id: string): Note[] {
  return items.map((note) =>
    note.id === id ? { ...note, done: !note.done, updatedAt: Date.now() } : note,
  );
}

/** Elimina una nota por id. */
export function removeNote(items: readonly Note[], id: string): Note[] {
  return items.filter((note) => note.id !== id);
}

/** Marca todas las notas como pendientes (no hechas). */
export function uncheckAll(items: readonly Note[]): Note[] {
  const now = Date.now();
  return items.map((note) => (note.done ? { ...note, done: false, updatedAt: now } : note));
}

/** Elimina todas las notas marcadas como hechas. */
export function clearDone(items: readonly Note[]): Note[] {
  return items.filter((note) => !note.done);
}

/** Renombra una nota. */
export function renameNote(items: readonly Note[], id: string, label: string): Note[] {
  const clean = typeof label === 'string' ? label.trim() : '';
  if (!clean) return items.slice();
  return items.map((note) => (note.id === id ? { ...note, label: clean, updatedAt: Date.now() } : note));
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

/** Notas asociadas a una persona (o todas si personId es undefined). */
export function notesForPerson(items: readonly Note[], personId?: string): Note[] {
  if (!personId) return items.slice();
  return items.filter((note) => note.personId === personId);
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
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
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
