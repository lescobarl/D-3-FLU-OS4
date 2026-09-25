// ============================================================
// deviceActionService — Acciones de dispositivo (Fase 7, Módulo I+)
// ------------------------------------------------------------
// Cubre las helpers puras de URI (tel:, wa.me, sms:, mailto:),
// la resolución por nombre (matchContactName) y el flujo de
// ejecución con DI (resolveContact/launch inyectables).
// Regla #1: sin hardcode — el prefijo de país es inyectable y por
// defecto vacío en las helpers puras; el servicio lo recibe por
// opciones. Honestidad de PWA: solo se lanza el URI, nunca se
// envía sin el usuario.
// ============================================================

import { describe, expect, it, vi } from 'vitest';
import type { ContactRecord } from '../src/core/db/fluDatabase';
import {
  buildMailtoUri,
  buildSmsUri,
  buildTelUri,
  buildWhatsAppUri,
  createDeviceActionService,
  matchContactName,
  normalizePhone,
} from '../src/core/deviceActions/deviceActionService';

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

function makeContact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    id: 'contact-1',
    name: 'Monse',
    phone: '555-0102',
    email: 'monse@example.com',
    relationship: 'Familiar',
    birthday: '1992-03-14',
    participantId: 'p1',
    participantName: 'Monse',
    notes: 'Mi vida',
    favorite: true,
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

// ------------------------------------------------------------
// normalizePhone
// ------------------------------------------------------------
describe('normalizePhone — forma internacional sin hardcode', () => {
  it('local con prefijo de país → +<país><dígitos>', () => {
    expect(normalizePhone('555-0102', '52')).toBe('+525550102');
  });

  it('número con código de país conserva su +', () => {
    expect(normalizePhone('+52 55 5010 102')).toBe('+52555010102');
  });

  it('quita ceros iniciales de un número local', () => {
    expect(normalizePhone('05550102', '52')).toBe('+525550102');
  });

  it('sin prefijo de país devuelve solo los dígitos', () => {
    expect(normalizePhone('5550102')).toBe('5550102');
  });

  it('entrada vacía no revienta', () => {
    expect(normalizePhone('', '52')).toBe('+52');
  });
});

// ------------------------------------------------------------
// Builders de URI
// ------------------------------------------------------------
describe('builders de URI — tel:, wa.me, sms: y mailto:', () => {
  it('buildTelUri abre el marcador con número internacional', () => {
    expect(buildTelUri('555-0102', '52')).toBe('tel:+525550102');
    expect(buildTelUri('+1 555 0102')).toBe('tel:+15550102');
  });

  it('buildWhatsAppUri sin mensaje → wa.me plano', () => {
    expect(buildWhatsAppUri('555-0102', '52')).toBe('https://wa.me/525550102');
  });

  it('buildWhatsAppUri con mensaje → pre-escrito codificado', () => {
    expect(buildWhatsAppUri('555-0102', '52', 'Hola Monse, te quiero!')).toBe(
      'https://wa.me/525550102?text=Hola%20Monse%2C%20te%20quiero!',
    );
  });

  it('buildSmsUri sin mensaje → sms: internacional', () => {
    expect(buildSmsUri('555-0102', '52')).toBe('sms:+525550102');
  });

  it('buildSmsUri con mensaje → body codificado', () => {
    expect(buildSmsUri('555-0102', '52', 'llego tarde')).toBe(
      'sms:+525550102?body=llego%20tarde',
    );
  });

  it('buildMailtoUri sin mensaje → mailto plano', () => {
    expect(buildMailtoUri('monse@example.com')).toBe('mailto:monse@example.com');
  });

  it('buildMailtoUri con mensaje → body codificado', () => {
    expect(buildMailtoUri('monse@example.com', 'Hola')).toBe(
      'mailto:monse@example.com?body=Hola',
    );
  });
});

// ------------------------------------------------------------
// matchContactName
// ------------------------------------------------------------
describe('matchContactName — resolución por nombre', () => {
  it('coincidencia exacta encuentra el contacto', () => {
    expect(matchContactName([makeContact()], 'Monse')?.id).toBe('contact-1');
  });

  it('ignora mayúsculas/minúsculas', () => {
    expect(matchContactName([makeContact()], 'monse')?.id).toBe('contact-1');
  });

  it('inclusión por un lado (apellidos en el contacto)', () => {
    const c = makeContact({ name: 'Monse López' });
    expect(matchContactName([c], 'Monse')?.id).toBe('contact-1');
  });

  it('inclusión por el otro lado (nombre escuchado más completo)', () => {
    const c = makeContact({ name: 'Monse' });
    expect(matchContactName([c], 'Monse López')?.id).toBe('contact-1');
  });

  it('un solo carácter no cuenta como coincidencia', () => {
    expect(matchContactName([makeContact({ name: 'Monse' })], 'M')).toBeUndefined();
  });

  it('nombre vacío → undefined', () => {
    expect(matchContactName([makeContact()], '   ')).toBeUndefined();
  });

  it('sin coincidencia → undefined', () => {
    expect(matchContactName([makeContact()], 'Nadie')).toBeUndefined();
  });
});

// ------------------------------------------------------------
// createDeviceActionService — ejecución con DI
// ------------------------------------------------------------
describe('createDeviceActionService — ejecución (DI)', () => {
  function makeService(contact?: ContactRecord) {
    const launch = vi.fn();
    const service = createDeviceActionService({
      countryDial: '52',
      resolveContact: async () => contact,
      launch,
    });
    return { service, launch };
  }

  it('call: resuelve y lanza tel:+52…', async () => {
    const { service, launch } = makeService(makeContact());
    const result = await service.execute({ kind: 'call', contactName: 'Monse' });
    expect(result.ok).toBe(true);
    expect(result.uri).toBe('tel:+525550102');
    expect(result.channel).toBe('phone');
    expect(launch).toHaveBeenCalledWith('tel:+525550102');
  });

  it('whatsapp: lanza wa.me pre-escrito con mensaje', async () => {
    const { service, launch } = makeService(makeContact());
    const result = await service.execute({
      kind: 'whatsapp',
      contactName: 'Monse',
      message: 'Hola',
    });
    expect(result.ok).toBe(true);
    expect(result.uri).toBe('https://wa.me/525550102?text=Hola');
    expect(launch).toHaveBeenCalledWith('https://wa.me/525550102?text=Hola');
  });

  it('sms: lanza sms:+52… con body', async () => {
    const { service, launch } = makeService(makeContact());
    const result = await service.execute({
      kind: 'sms',
      contactName: 'Monse',
      message: 'llego tarde',
    });
    expect(result.ok).toBe(true);
    expect(result.uri).toBe('sms:+525550102?body=llego%20tarde');
    expect(launch).toHaveBeenCalledWith('sms:+525550102?body=llego%20tarde');
  });

  it('email: lanza mailto con body', async () => {
    const { service, launch } = makeService(makeContact());
    const result = await service.execute({
      kind: 'email',
      contactName: 'Monse',
      message: 'Hola',
    });
    expect(result.ok).toBe(true);
    expect(result.uri).toBe('mailto:monse@example.com?body=Hola');
    expect(result.channel).toBe('email');
    expect(launch).toHaveBeenCalledWith('mailto:monse@example.com?body=Hola');
  });

  it('contacto no encontrado → contact-not-found sin lanzar', async () => {
    const { service, launch } = makeService(undefined);
    const result = await service.execute({ kind: 'call', contactName: 'Nadie' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contact-not-found');
    expect(launch).not.toHaveBeenCalled();
  });

  it('contacto sin teléfono → missing-phone', async () => {
    const { service, launch } = makeService(makeContact({ phone: undefined }));
    const result = await service.execute({ kind: 'whatsapp', contactName: 'Monse' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-phone');
    expect(launch).not.toHaveBeenCalled();
  });

  it('contacto sin correo → missing-email', async () => {
    const { service, launch } = makeService(makeContact({ email: undefined }));
    const result = await service.execute({ kind: 'email', contactName: 'Monse' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-email');
    expect(launch).not.toHaveBeenCalled();
  });

  it('resolver que lanza excepción → contact-not-found tolerante', async () => {
    const launch = vi.fn();
    const service = createDeviceActionService({
      countryDial: '52',
      resolveContact: async () => {
        throw new Error('db down');
      },
      launch,
    });
    const result = await service.execute({ kind: 'call', contactName: 'Monse' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contact-not-found');
    expect(launch).not.toHaveBeenCalled();
  });
});
