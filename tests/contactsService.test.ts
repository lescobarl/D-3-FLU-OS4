// ============================================================
// contactService — Contactos (Fase 6, Módulo I)
// ------------------------------------------------------------
// Cubre el servicio de agenda de contactos con una base en
// memoria (misma interfaz ContactsDb), reloj y newId inyectables.
// Regla #1: sin hardcode; tope y ventana desde config. Cubre:
// alta, listado (orden por nombre), cumpleaños próximos (B9),
// edición y borrado con auditoría.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type ContactRecord } from '../src/core/db/fluDatabase';
import {
  createContactService,
  type ContactConfig,
  type ContactsDb,
} from '../src/core/contacts/contactService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const CONFIG: ContactConfig = {
  maxContacts: 500,
  birthdayWindowDays: 7,
};

// 'YYYY-MM-DD' locales alrededor de la referencia (2026-01-15).
const YESTERDAY = '2026-01-14';
const TODAY = '2026-01-15';
const TOMORROW = '2026-01-16';

let idCounter = 0;

function makeContact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    id: 'seed-contact',
    name: 'Ana',
    phone: '555-0101',
    email: 'ana@example.com',
    relationship: 'Familiar',
    birthday: '1990-05-20',
    participantId: 'p1',
    participantName: 'Ana',
    notes: 'Mejor amiga',
    favorite: true,
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

function createMapDb(initialContacts: ContactRecord[] = []): ContactsDb {
  const contacts = new Map<string, ContactRecord>();
  for (const r of initialContacts) contacts.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    contacts: {
      async add(record: ContactRecord): Promise<unknown> {
        contacts.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async put(record: ContactRecord): Promise<unknown> {
        contacts.set(record.id, { ...record, sync: { ...record.sync } });
        return undefined;
      },
      async delete(id: string): Promise<void> {
        contacts.delete(id);
      },
      async get(id: string): Promise<ContactRecord | undefined> {
        const row = contacts.get(id);
        return row ? { ...row, sync: { ...row.sync } } : undefined;
      },
      async toArray(): Promise<ContactRecord[]> {
        return Array.from(contacts.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
      },
    },
  };
}

function createService(db: ContactsDb, config: ContactConfig = CONFIG) {
  return createContactService({
    db,
    config,
    now,
    newId: () => `contact-${++idCounter}`,
  });
}

let db: ContactsDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('contactService — alta de contactos', () => {
  it('addContact crea un registro completo, lo persiste y audita', async () => {
    const svc = createService(db);
    const result = await svc.addContact({
      name: '  Ana Pérez  ',
      phone: '555-0101',
      email: 'ana@example.com',
      relationship: 'Familiar',
      birthday: '1990-05-20',
      participantId: 'p1',
      participantName: 'Ana',
      notes: 'Mejor amiga',
      favorite: true,
    });

    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({
      id: 'contact-1',
      name: 'Ana Pérez',
      phone: '555-0101',
      email: 'ana@example.com',
      relationship: 'Familiar',
      birthday: '1990-05-20',
      participantId: 'p1',
      participantName: 'Ana',
      notes: 'Mejor amiga',
      favorite: true,
    });
    expect(result.record?.createdAt).toBe(NOW);
    expect(result.record?.updatedAt).toBe(NOW);
    expect(result.record?.sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });

    // Persistencia en la tabla.
    const rows = await db.contacts.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(result.record);

    // Auditoría: un único log de alta.
    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'contact.add',
      'contacts',
      'contact-1',
      null,
      expect.objectContaining({ name: 'Ana Pérez', birthday: '1990-05-20' }),
      'contactService',
    );
  });

  it('addContact permite solo el nombre obligatorio (campos opcionales vacíos)', async () => {
    const svc = createService(db);
    const result = await svc.addContact({ name: 'Solo nombre' });

    expect(result.ok).toBe(true);
    expect(result.record?.name).toBe('Solo nombre');
    expect(result.record?.phone).toBeUndefined();
    expect(result.record?.email).toBeUndefined();
    expect(result.record?.relationship).toBeUndefined();
    expect(result.record?.birthday).toBeUndefined();
    expect(result.record?.participantId).toBeUndefined();
    expect(result.record?.participantName).toBeUndefined();
    expect(result.record?.notes).toBeUndefined();
    expect(result.record?.favorite).toBeUndefined();
  });

  it('addContact rechaza entrada inválida sin auditar', async () => {
    const svc = createService(db);

    expect(await svc.addContact({ name: '' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.addContact({ name: '   ' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.addContact({ name: 'X', birthday: '15/01/2026' })).toEqual({ ok: false, reason: 'invalid-input' });

    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('addContact respeta el tope de contactos (maxContacts)', async () => {
    const svc = createService(db, { ...CONFIG, maxContacts: 2 });

    await svc.addContact({ name: 'Ana' });
    await svc.addContact({ name: 'Luis' });
    const result = await svc.addContact({ name: 'Zoe' });

    expect(result).toEqual({ ok: false, reason: 'limit-reached' });
    expect(await db.contacts.toArray()).toHaveLength(2);

    // Solo las 2 altas exitosas auditan.
    expect(addAuditLog).toHaveBeenCalledTimes(2);
  });
});

describe('contactService — listado y consultas', () => {
  it('listContacts ordena por nombre con locale es y devuelve copias', async () => {
    const seeded = createMapDb([
      makeContact({ id: 'seed-1', name: 'Zoe' }),
      makeContact({ id: 'seed-2', name: 'Luis' }),
      makeContact({ id: 'seed-3', name: 'Ana' }),
    ]);
    const svc = createService(seeded);

    const rows = await svc.listContacts();
    expect(rows.map((r) => r.name)).toEqual(['Ana', 'Luis', 'Zoe']);

    // Copias: mutar el resultado no afecta el mapa interno.
    rows[0].name = 'ZZZ';
    const again = await svc.listContacts();
    expect(again[0].name).toBe('Ana');
  });

  it('getContact devuelve una copia y undefined para ids inexistentes o vacíos', async () => {
    const seeded = createMapDb([
      makeContact({ id: 'seed-1', name: 'Ana' }),
    ]);
    const svc = createService(seeded);

    const row = await svc.getContact('seed-1');
    expect(row?.name).toBe('Ana');
    row!.name = 'Cambiada';
    const again = await svc.getContact('seed-1');
    expect(again?.name).toBe('Ana');

    expect(await svc.getContact('no-existe')).toBeUndefined();
    expect(await svc.getContact('')).toBeUndefined();
  });
});

describe('contactService — cumpleaños próximos (B9)', () => {
  it('filtra por ventana, calcula días y ordena por daysUntil y luego nombre', async () => {
    const seeded = createMapDb([
      // Dentro de la ventana (7 días desde 2026-01-15).
      makeContact({ id: 'seed-3', name: 'Luis', birthday: TODAY }), // 0 días (hoy)
      makeContact({ id: 'seed-2', name: 'Ana', birthday: TOMORROW }), // 1 día
      makeContact({ id: 'seed-1', name: 'Zoe', birthday: '2026-01-20' }), // 5 días
      makeContact({ id: 'seed-7', name: 'Beta', birthday: '2026-01-20' }), // 5 días → desempate por nombre
      // Fuera de la ventana o sin fecha válida.
      makeContact({ id: 'seed-4', name: 'Fuera', birthday: '2026-01-23' }), // 8 días
      makeContact({ id: 'seed-5', name: 'Sin fecha' }),
      makeContact({ id: 'seed-6', name: 'Mal', birthday: '15/01/2026' }),
    ]);
    const svc = createService(seeded);

    const near = await svc.contactsWithBirthdayNear();

    expect(near.map((b) => b.record.name)).toEqual(['Luis', 'Ana', 'Beta', 'Zoe']);
    expect(near.map((b) => b.daysUntil)).toEqual([0, 1, 5, 5]);
    expect(near[0].nextBirthday).toBe(TODAY);
    expect(near[1].nextBirthday).toBe(TOMORROW);
    expect(near[2].nextBirthday).toBe('2026-01-20');
  });

  it('respeta la ventana configurable (birthdayWindowDays)', async () => {
    const seeded = createMapDb([
      makeContact({ id: 'seed-1', name: 'Hoy', birthday: TODAY }),
      makeContact({ id: 'seed-2', name: 'Mañana', birthday: TOMORROW }),
      makeContact({ id: 'seed-3', name: 'Pasado', birthday: '2026-01-17' }), // 2 días
    ]);
    const svc = createService(seeded, { ...CONFIG, birthdayWindowDays: 1 });

    const near = await svc.contactsWithBirthdayNear();

    expect(near.map((b) => b.record.name)).toEqual(['Hoy', 'Mañana']);
  });

  it('salta al próximo año cuando el cumpleaños ya pasó (referencia explícita)', async () => {
    // Referencia: 30 de diciembre de 2026 → 2026-12-30.
    const reference = new Date(2026, 11, 30, 10, 0, 0, 0).getTime();
    const seeded = createMapDb([
      makeContact({ id: 'seed-1', name: 'Ani', birthday: '1990-01-02' }), // → 2027-01-02 (3 días)
      makeContact({ id: 'seed-2', name: 'Xmas', birthday: '2026-12-31' }), // → 2026-12-31 (1 día)
    ]);
    const svc = createService(seeded);

    const near = await svc.contactsWithBirthdayNear(reference);

    expect(near.map((b) => b.record.name)).toEqual(['Xmas', 'Ani']);
    expect(near[0].nextBirthday).toBe('2026-12-31');
    expect(near[0].daysUntil).toBe(1);
    expect(near[1].nextBirthday).toBe('2027-01-02');
    expect(near[1].daysUntil).toBe(3);
  });
});

describe('contactService — edición y borrado', () => {
  it('updateContact cambia campos, audita update y sube la revisión', async () => {
    const seeded = createMapDb([
      makeContact({ id: 'seed-1', name: 'Ana', birthday: '1990-05-20' }),
    ]);
    const svc = createService(seeded);

    const result = await svc.updateContact('seed-1', {
      name: 'Ana G.',
      phone: '555-9999',
      birthday: '1991-06-01',
    });

    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({
      id: 'seed-1',
      name: 'Ana G.',
      phone: '555-9999',
      birthday: '1991-06-01',
    });
    expect(result.record?.sync.revision).toBe(2);

    // Auditoría: un único log de update con el estado previo.
    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'contact.update',
      'contacts',
      'seed-1',
      { name: 'Ana', birthday: '1990-05-20' },
      expect.objectContaining({ name: 'Ana G.', birthday: '1991-06-01' }),
      'contactService',
    );
  });

  it('updateContact rechaza entradas inválidas o contactos inexistentes sin auditar', async () => {
    const seeded = createMapDb([
      makeContact({ id: 'seed-1', name: 'Ana' }),
    ]);
    const svc = createService(seeded);

    expect(await svc.updateContact('', { name: 'X' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.updateContact('seed-1', { name: '   ' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.updateContact('seed-1', { birthday: '15/01/2026' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await svc.updateContact('no-existe', { name: 'X' })).toEqual({ ok: false, reason: 'contact-not-found' });

    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it('removeContact borra, audita con el registro previo y devuelve ok', async () => {
    const seeded = createMapDb([
      makeContact({ id: 'seed-1', name: 'Ana', birthday: '1990-05-20' }),
    ]);
    const svc = createService(seeded);

    const result = await svc.removeContact('seed-1');
    expect(result).toEqual({ ok: true });
    expect(await seeded.contacts.toArray()).toHaveLength(0);

    expect(addAuditLog).toHaveBeenCalledTimes(1);
    expect(addAuditLog).toHaveBeenCalledWith(
      'contact.remove',
      'contacts',
      'seed-1',
      { name: 'Ana', birthday: '1990-05-20' },
      null,
      'contactService',
    );
  });

  it('removeContact de un contacto inexistente devuelve contact-not-found sin auditar', async () => {
    const svc = createService(db);

    expect(await svc.removeContact('no-existe')).toEqual({ ok: false, reason: 'contact-not-found' });
    expect(await svc.removeContact('')).toEqual({ ok: false, reason: 'invalid-input' });

    expect(addAuditLog).not.toHaveBeenCalled();
  });
});
