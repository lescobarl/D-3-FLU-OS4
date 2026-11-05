// ============================================================
// useContacts — Contactos (Fase 6, Módulo I)
// ------------------------------------------------------------
// Hook que gestiona la agenda de contactos sobre Dexie
// (fluDb.contacts) vía contactService.
//
// Cumple:
//   - Regla #1: NO HARDCODE — límites y ventana desde FLU_CONFIG.contacts
//   - Obligación #5: auditoría (la hace contactService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace contactService)
//   - Módulo I: agenda con cumpleaños y vínculo a participantes
//   - DI: now inyectable para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { refreshOnOk } from './refreshOnOk';
import { useServiceRef } from './useServiceRef';
import { FLU_CONFIG } from '../voice/api/config';
import { fluDb, type ContactRecord } from '../core/db/fluDatabase';
import { logCaughtError } from '../lib/caughtError';
import {
  createContactService,
  type AddContactResult,
  type BirthdayContact,
  type ContactInput,
  type ContactPatch,
  type ContactService,
  type RemoveContactResult,
  type UpdateContactResult,
} from '../core/contacts/contactService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseContactsOptions {
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
}

export interface ContactsState {
  contacts: ContactRecord[];
  birthdayNear: BirthdayContact[];
  loading: boolean;
}

export interface ContactsActions {
  refresh: () => Promise<void>;
  addContact: (input: ContactInput) => Promise<AddContactResult>;
  updateContact: (id: string, patch: ContactPatch) => Promise<UpdateContactResult>;
  getContact: (id: string) => Promise<ContactRecord | undefined>;
  removeContact: (id: string) => Promise<RemoveContactResult>;
  contactsWithBirthdayNear: (reference?: number) => Promise<BirthdayContact[]>;
}

export interface UseContactsResult extends ContactsState, ContactsActions {
  service: ContactService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useContacts({ now }: UseContactsOptions = {}): UseContactsResult {
  const config = FLU_CONFIG.contacts || {};
  const maxContacts =
    typeof config.maxContacts === 'number' ? config.maxContacts : undefined;
  const birthdayWindowDays =
    typeof config.birthdayWindowDays === 'number' ? config.birthdayWindowDays : 7;

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const service = useServiceRef<ContactService>(() => createContactService({ db: { contacts: fluDb.contacts }, config: { maxContacts, birthdayWindowDays }, now: now || (() => Date.now()), }));

  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [birthdayNear, setBirthdayNear] = useState<BirthdayContact[]>([]);
  const [loading, setLoading] = useState(true);

  /** Recarga la agenda y los cumpleaños próximos desde IndexedDB. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [contactRows, birthdayRows] = await Promise.all([
        service.listContacts(),
        service.contactsWithBirthdayNear(),
      ]);
      setContacts(contactRows);
      setBirthdayNear(birthdayRows);
    } catch (err) {
      logCaughtError('[useContacts] refresh error', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch((e) => logCaughtError('src/hooks/useContacts.ts: refresh', e));
  }, [refresh]);

  /** Añade un contacto; refresca si fue exitoso. */
  const addContact = useCallback(
    async (input: ContactInput): Promise<AddContactResult> => {
      return refreshOnOk(() => service.addContact(input), refresh);
    },
    [service, refresh],
  );

  /** Actualiza un contacto; refresca si fue exitoso. */
  const updateContact = useCallback(
    async (id: string, patch: ContactPatch): Promise<UpdateContactResult> => {
      return refreshOnOk(() => service.updateContact(id, patch), refresh);
    },
    [service, refresh],
  );

  /** Consulta un contacto por id. */
  const getContact = useCallback(
    async (id: string): Promise<ContactRecord | undefined> => service.getContact(id),
    [service],
  );

  /** Elimina un contacto; refresca si fue exitoso. */
  const removeContact = useCallback(
    async (id: string): Promise<RemoveContactResult> => {
      return refreshOnOk(() => service.removeContact(id), refresh);
    },
    [service, refresh],
  );

  /** Cumpleaños próximos dentro de la ventana configurada. */
  const contactsWithBirthdayNear = useCallback(
    async (reference?: number): Promise<BirthdayContact[]> =>
      service.contactsWithBirthdayNear(reference),
    [service],
  );

  return {
    service,
    contacts,
    birthdayNear,
    loading,
    refresh,
    addContact,
    updateContact,
    getContact,
    removeContact,
    contactsWithBirthdayNear,
  };
}
