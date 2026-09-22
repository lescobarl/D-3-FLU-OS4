// ============================================================
// Device Action Service — Llamar, WhatsApp, SMS y correo
// ------------------------------------------------------------
// Resuelve el contacto y lanza esquemas de URL estándar de una
// PWA (tel:, wa.me, sms:, mailto:). Sin hardcode: el
// prefijo de país (`countryDial`) y el lanzador son inyectables.
//   - Resuelve el destinatario por nombre (contactos del usuario).
//   - call     → `tel:+<país><número>`            (abre el marcador)
//   - whatsapp → `wa.me/<número>?text=`           (pre-escrito)
//   - sms      → `sms:+<país><número>?body=`      (pre-escrito)
//   - email    → `mailto:<correo>?body=`          (pre-escrito)
// Honestidad de PWA: no hace llamadas VoIP automáticas ni envía
// WhatsApp sin la confirmación del usuario; solo abre el app.
// Regla de oro: las helpers de URI son puras y exportadas; el
// servicio solo orquesta resolución + lanzamiento.
// ============================================================

import type { ContactRecord } from '../db/fluDatabase';
import { DEVICE_ACTIONS_CONFIG } from '../config/appConfig';
import { logCaughtError } from '../../lib/caughtError';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export type DeviceActionKind = 'call' | 'whatsapp' | 'sms' | 'email';

export interface DeviceActionInput {
  /** Canal solicitado. */
  kind: DeviceActionKind;
  /** Nombre del destinatario tal como se escuchó. */
  contactName: string;
  /** Mensaje opcional a pre-rellenar (whatsapp / sms / email). */
  message?: string;
}

export type DeviceActionResultReason =
  | 'contact-not-found'
  | 'missing-phone'
  | 'missing-email';

export interface DeviceActionResult {
  /** true si se lanzó el URI. */
  ok: boolean;
  input: DeviceActionInput;
  /** URI lanzado (solo cuando ok). */
  uri?: string;
  /** Canal técnico: teléfono o correo. */
  channel?: 'phone' | 'email';
  /** Motivo del fallo (solo cuando !ok). */
  reason?: DeviceActionResultReason;
}

export interface DeviceActionServiceOptions {
  /** Resuelve un ContactRecord por nombre (puede leer Dexie). */
  resolveContact: (
    name: string
  ) => Promise<ContactRecord | undefined> | ContactRecord | undefined;
  /** Abre el URI (p. ej. window.open en una PWA). */
  launch: (uri: string) => void;
  /** Prefijo de país por defecto (sin '+'), p. ej. '52' para México. */
  countryDial?: string;
}

// ------------------------------------------------------------
// Helpers puras de URI — Regla #1 (sin hardcode disperso)
// ------------------------------------------------------------

/**
 * Normaliza un teléfono a forma internacional: conserva '+' si ya
 * viene con código de país; si es local, quita ceros iniciales y
 * antepone el prefijo de país.
 */
export function normalizePhone(raw: string, countryDial = ''): string {
  const cleaned = String(raw ?? '').replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  const digits = cleaned.replace(/^0+/, '');
  if (!countryDial) return digits;
  return `+${countryDial}${digits}`;
}

/** URI `tel:` — abre el marcador del sistema. */
export function buildTelUri(phone: string, countryDial = ''): string {
  return `tel:${normalizePhone(phone, countryDial)}`;
}

/**
 * URI `wa.me/<número>` — abre WhatsApp pre-escrito.
 * La base (dominio wa.me) vive en `DEVICE_ACTIONS_CONFIG` (Regla #1).
 */
export function buildWhatsAppUri(
  phone: string,
  countryDial = '',
  message?: string,
  base: string = DEVICE_ACTIONS_CONFIG.WHATSAPP_WEB_BASE
): string {
  const digits = normalizePhone(phone, countryDial).replace(/^\+/, '');
  const uri = `${base}/${digits}`;
  return message ? `${uri}?text=${encodeURIComponent(message)}` : uri;
}

/** URI `sms:` — abre el app de mensajes pre-escrito. */
export function buildSmsUri(
  phone: string,
  countryDial = '',
  message?: string
): string {
  const normalized = normalizePhone(phone, countryDial);
  return message
    ? `sms:${normalized}?body=${encodeURIComponent(message)}`
    : `sms:${normalized}`;
}

/** URI `mailto:` — abre el cliente de correo pre-escrito. */
export function buildMailtoUri(email: string, message?: string): string {
  return message
    ? `mailto:${email}?body=${encodeURIComponent(message)}`
    : `mailto:${email}`;
}

/**
 * Busca un contacto por nombre: coincide exacto y, si no, por
 * inclusión bidireccional (un solo lado contiene al otro).
 */
export function matchContactName(
  contacts: ContactRecord[],
  rawName: string
): ContactRecord | undefined {
  const norm = (value: string): string =>
    String(value ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  const target = norm(rawName);
  if (!target) return undefined;
  return contacts.find((contact) => {
    const name = norm(contact.name);
    return (
      name === target ||
      (name.includes(target) && target.length > 1) ||
      (target.includes(name) && name.length > 1)
    );
  });
}

// ------------------------------------------------------------
// Fábrica del servicio
// ------------------------------------------------------------

export function createDeviceActionService({
  resolveContact,
  launch,
  countryDial = '',
}: DeviceActionServiceOptions) {
  /** Resuelve el contacto tolerando fallos del inyector. */
  const resolve = async (name: string): Promise<ContactRecord | undefined> => {
    try {
      return await resolveContact(name);
    } catch {
        logCaughtError('[catch] src/core/deviceActions/deviceActionService.ts');
      return undefined;
    }
  };

  /**
   * Ejecuta la acción: resuelve contacto, valida el dato necesario
   * (teléfono o correo) y lanza el URI correspondiente.
   */
  const execute = async (input: DeviceActionInput): Promise<DeviceActionResult> => {
    const base = { input };
    const contact = await resolve(input.contactName);
    if (!contact) {
      return { ...base, ok: false, reason: 'contact-not-found' as const };
    }
    switch (input.kind) {
      case 'call': {
        if (!contact.phone) {
          return { ...base, ok: false, reason: 'missing-phone' as const };
        }
        const uri = buildTelUri(contact.phone, countryDial);
        launch(uri);
        return { ...base, ok: true, uri, channel: 'phone' as const };
      }
      case 'whatsapp': {
        if (!contact.phone) {
          return { ...base, ok: false, reason: 'missing-phone' as const };
        }
        const uri = buildWhatsAppUri(contact.phone, countryDial, input.message);
        launch(uri);
        return { ...base, ok: true, uri, channel: 'phone' as const };
      }
      case 'sms': {
        if (!contact.phone) {
          return { ...base, ok: false, reason: 'missing-phone' as const };
        }
        const uri = buildSmsUri(contact.phone, countryDial, input.message);
        launch(uri);
        return { ...base, ok: true, uri, channel: 'phone' as const };
      }
      case 'email': {
        if (!contact.email) {
          return { ...base, ok: false, reason: 'missing-email' as const };
        }
        const uri = buildMailtoUri(contact.email, input.message);
        launch(uri);
        return { ...base, ok: true, uri, channel: 'email' as const };
      }
      default:
        return { ...base, ok: false, reason: 'contact-not-found' as const };
    }
  };

  return { execute };
}

export type DeviceActionService = ReturnType<typeof createDeviceActionService>;
