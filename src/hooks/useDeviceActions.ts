// ============================================================
// useDeviceActions — Acciones de dispositivo (Fase 7, Módulo I+)
// ------------------------------------------------------------
// Hook que construye el servicio de acciones de dispositivo
// (llamar, WhatsApp, SMS y correo) sobre la agenda de contactos
// ya cargada por useContacts. Reutiliza la misma instancia de
// `ContactService` de la app para no duplicar lecturas y mantiene
// frescura de IndexedDB en cada resolución (listContacts).
//
// Cumple:
//   - Regla #1: NO HARDCODE — prefijo de país, etiquetas y canal de
//     apertura viven en FLU_CONFIG.deviceActions (inyectable aquí).
//   - DI: `service` (ContactService) y `contacts` (ContactRecord[])
//     son props; la app pasa los del useContacts ya montado.
//   - Honestidad de PWA: solo abre esquemas de URL estándar
//     (tel:, wa.me, sms:, mailto:) — nunca envía sin el usuario.
// ============================================================
import { useMemo } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { ContactRecord } from '../core/db/fluDatabase';
import type { ContactService } from '../core/contacts/contactService';
import { logCaughtError } from '../lib/caughtError';
import {
  createDeviceActionService,
  matchContactName,
  type DeviceActionService,
} from '../core/deviceActions/deviceActionService';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export interface UseDeviceActionsOptions {
  /** ContactService ya montado por useContacts (fuente Dexie). */
  service: ContactService;
  /** Copia en memoria de contactos (respaldo si Dexie falla). */
  contacts?: ContactRecord[];
  /** Prefijo de país por defecto (sin '+'). Vacío → usa FLU_CONFIG. */
  countryDial?: string;
}

export interface UseDeviceActionsResult {
  service: DeviceActionService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useDeviceActions({
  service,
  contacts = [],
  countryDial,
}: UseDeviceActionsOptions): UseDeviceActionsResult {
  const deviceActionsConfig = FLU_CONFIG.deviceActions || {};

  // El servicio se reconstruye solo cuando cambian las dependencias
  // de resolución (el ContactService o la copia en memoria).
  const deviceActions = useMemo(
    () =>
      createDeviceActionService({
        // Prefijo de país: prop explícita > FLU_CONFIG > '52' (México).
        countryDial:
          countryDial ??
          (typeof deviceActionsConfig.countryDial === 'string'
            ? deviceActionsConfig.countryDial
            : '52'),
        // Resolución por nombre: primero datos frescos de IndexedDB
        // (importante para el E2E que siembra Dexie) y, si la lectura
        // falla o viene vacía, se usa la copia en memoria.
        resolveContact: async (name) => {
          try {
            const fresh = await service.listContacts();
            if (fresh.length > 0) return matchContactName(fresh, name);
          } catch (err) {
            logCaughtError('[useDeviceActions] listContacts error', err);
          }
          return matchContactName(contacts, name);
        },
        // Lanzador: nueva pestaña segura (sin opener), estándar PWA.
        launch: (uri) => {
          window.open(uri, '_blank', 'noopener,noreferrer');
        },
      }),
    [service, contacts, countryDial, deviceActionsConfig.countryDial],
  );

  return { service: deviceActions };
}
