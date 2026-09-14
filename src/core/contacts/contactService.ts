// ============================================================
// Contact Service — Contactos (Fase 6, Módulo I)
// ------------------------------------------------------------
// Agenda de contactos con:
//   - alta, consulta, listado (ordenado por nombre), edición y borrado
//   - cumpleaños opcional por contacto (clave 'YYYY-MM-DD')
//   - vínculo opcional con participantes (participantId/participantName)
//   - cumpleaños próximos dentro de una ventana configurable (B9)
// Cumple:
//   - Obligación #6: UUIDv4 (id)
//   - Obligación #7: tupla Sync [revision, updated_at, deleted]
//   - Obligación #5: log de auditoría en cada mutación
//   - Regla #1: sin hardcode; límites y ventana desde config
// Inyección de dependencias: { db, config, now, newId }.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { addAuditLog, type ContactRecord } from '../db/fluDatabase';
import { buildSyncTuple } from '../db/syncTuple';
import { copyRecord } from '../db/recordCopy';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

// Los tipos de registro provienen de la capa de base de datos
// (fuente única de verdad — Regla de oro) y se re-exportan aquí.
export type { ContactRecord } from '../db/fluDatabase';

export interface ContactConfig {
  /** Tope de contactos de la agenda (opcional). */
  maxContacts?: number;
  /** Ventana en días para "cumpleaños próximos" (por defecto 7). */
  birthdayWindowDays?: number;
}

export interface ContactTableDb {
  add(record: ContactRecord): Promise<unknown>;
  put(record: ContactRecord): Promise<unknown>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<ContactRecord | undefined>;
  toArray(): Promise<ContactRecord[]>;
}

export interface ContactsDb {
  contacts: ContactTableDb;
}

export interface ContactServiceOptions {
  db: ContactsDb;
  config: ContactConfig;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Generador de id (por defecto: uuid v4). */
  newId?: () => string;
}

export interface ContactInput {
  name: string;
  phone?: string;
  email?: string;
  relationship?: string;
  /** Cumpleaños 'YYYY-MM-DD' (opcional). */
  birthday?: string;
  participantId?: string;
  participantName?: string;
  notes?: string;
  favorite?: boolean;
}

export interface ContactPatch {
  name?: string;
  phone?: string;
  email?: string;
  relationship?: string;
  birthday?: string;
  participantId?: string;
  participantName?: string;
  notes?: string;
  favorite?: boolean;
}

export interface AddContactResult {
  ok: boolean;
  record?: ContactRecord;
  reason?: 'invalid-input' | 'limit-reached';
}

export interface UpdateContactResult {
  ok: boolean;
  record?: ContactRecord;
  reason?: 'invalid-input' | 'contact-not-found';
}

export interface RemoveContactResult {
  ok: boolean;
  reason?: 'invalid-input' | 'contact-not-found';
}

export interface BirthdayContact {
  record: ContactRecord;
  /** Próxima fecha de cumpleaños 'YYYY-MM-DD'. */
  nextBirthday: string;
  /** Días hasta el próximo cumpleaños (0 = hoy). */
  daysUntil: number;
}

// ------------------------------------------------------------
// Helpers de fecha (día local 'YYYY-MM-DD')
// ------------------------------------------------------------

const toDateKey = (value: number): string => {
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const daysBetween = (fromKey: string, toKey: string): number => {
  const from = parseDateKey(fromKey).getTime();
  const to = parseDateKey(toKey).getTime();
  return Math.round((to - from) / 86_400_000);
};

/** Próxima ocurrencia del cumpleaños (este año o el siguiente). */
const nextBirthdayKey = (birthday: string, reference: number): string => {
  const refKey = toDateKey(reference);
  const refYear = Number(refKey.slice(0, 4));
  const md = birthday.slice(5); // 'MM-DD'
  const candidate = `${refYear}-${md}`;
  return candidate >= refKey ? candidate : `${refYear + 1}-${md}`;
};

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export function createContactService({
  db,
  config,
  now = () => Date.now(),
  newId = uuidv4,
}: ContactServiceOptions) {
  const timestamp = (): number => now();

  const addContact = async (input: ContactInput): Promise<AddContactResult> => {
    if (!input || !input.name || !input.name.trim()) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (input.birthday !== undefined && input.birthday !== '' && !DATE_KEY_RE.test(input.birthday)) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (config.maxContacts !== undefined) {
      const all = await db.contacts.toArray();
      if (all.length >= config.maxContacts) {
        return { ok: false, reason: 'limit-reached' };
      }
    }

    const id = newId();
    const t = timestamp();
    const record: ContactRecord = {
      id,
      name: input.name.trim(),
      phone: input.phone,
      email: input.email,
      relationship: input.relationship,
      birthday: input.birthday || undefined,
      participantId: input.participantId,
      participantName: input.participantName,
      notes: input.notes,
      favorite: input.favorite,
      createdAt: t,
      updatedAt: t,
      sync: buildSyncTuple(undefined, timestamp()),
    };
    await db.contacts.add(record);
    await addAuditLog(
      'contact.add',
      'contacts',
      id,
      null,
      { name: record.name, birthday: record.birthday },
      'contactService',
    );
    return { ok: true, record: copyRecord(record) };
  };

  const updateContact = async (id: string, patch: ContactPatch): Promise<UpdateContactResult> => {
    if (!id) return { ok: false, reason: 'invalid-input' };
    if (patch.name !== undefined && !patch.name.trim()) {
      return { ok: false, reason: 'invalid-input' };
    }
    if (patch.birthday !== undefined && patch.birthday !== '' && !DATE_KEY_RE.test(patch.birthday)) {
      return { ok: false, reason: 'invalid-input' };
    }
    const existing = await db.contacts.get(id);
    if (!existing) return { ok: false, reason: 'contact-not-found' };

    const previous = { name: existing.name, birthday: existing.birthday };
    const updated: ContactRecord = {
      ...existing,
      name: patch.name !== undefined ? patch.name.trim() : existing.name,
      phone: patch.phone !== undefined ? patch.phone : existing.phone,
      email: patch.email !== undefined ? patch.email : existing.email,
      relationship: patch.relationship !== undefined ? patch.relationship : existing.relationship,
      birthday: patch.birthday !== undefined ? patch.birthday || undefined : existing.birthday,
      participantId: patch.participantId !== undefined ? patch.participantId : existing.participantId,
      participantName: patch.participantName !== undefined ? patch.participantName : existing.participantName,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      favorite: patch.favorite !== undefined ? patch.favorite : existing.favorite,
      updatedAt: timestamp(),
      sync: buildSyncTuple(existing.sync, timestamp()),
    };
    await db.contacts.put(updated);
    await addAuditLog(
      'contact.update',
      'contacts',
      id,
      previous,
      { name: updated.name, birthday: updated.birthday },
      'contactService',
    );
    return { ok: true, record: copyRecord(updated) };
  };

  const getContact = async (id: string): Promise<ContactRecord | undefined> => {
    if (!id) return undefined;
    const row = await db.contacts.get(id);
    return row ? copyRecord(row) : undefined;
  };

  const listContacts = async (): Promise<ContactRecord[]> => {
    const all = await db.contacts.toArray();
    return all
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map(copyRecord);
  };

  const removeContact = async (id: string): Promise<RemoveContactResult> => {
    if (!id) return { ok: false, reason: 'invalid-input' };
    const contact = await db.contacts.get(id);
    if (!contact) return { ok: false, reason: 'contact-not-found' };
    await db.contacts.delete(id);
    await addAuditLog(
      'contact.remove',
      'contacts',
      id,
      { name: contact.name, birthday: contact.birthday },
      null,
      'contactService',
    );
    return { ok: true };
  };

  const contactsWithBirthdayNear = async (reference?: number): Promise<BirthdayContact[]> => {
    const ref = reference ?? timestamp();
    const windowDays =
      typeof config.birthdayWindowDays === 'number' ? config.birthdayWindowDays : 7;
    const refKey = toDateKey(ref);
    const all = await db.contacts.toArray();
    return all
      .filter((c) => c.birthday !== undefined && DATE_KEY_RE.test(c.birthday!))
      .map((c) => {
        const nextBirthday = nextBirthdayKey(c.birthday!, ref);
        return {
          record: copyRecord(c),
          nextBirthday,
          daysUntil: daysBetween(refKey, nextBirthday),
        };
      })
      .filter((b) => b.daysUntil >= 0 && b.daysUntil <= windowDays)
      .sort(
        (a, b) =>
          a.daysUntil - b.daysUntil || a.record.name.localeCompare(b.record.name, 'es'),
      );
  };

  return {
    addContact,
    updateContact,
    getContact,
    listContacts,
    removeContact,
    contactsWithBirthdayNear,
  };
}

export type ContactService = ReturnType<typeof createContactService>;
