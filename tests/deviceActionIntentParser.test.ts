// ============================================================
// Device Action Intent Parser — Llamar, WhatsApp, SMS y correo
// ------------------------------------------------------------
// Pruebas del parser determinista es/en (Fase 7 — Etapa 1).
// El parser es puro: solo devuelve la intención (handled/action/
// reply/data); no abre ventanas ni consulta contactos.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseDeviceActionIntent } from '../src/core/deviceActions/deviceActionIntentParser';

function parse(text: string) {
  return parseDeviceActionIntent(text);
}

describe('parseDeviceActionIntent — llamada (call.start)', () => {
  it('llama a Monse → call.start con contactName Monse (es)', () => {
    const r = parse('llama a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.reply).toContain('marcador');
    expect(r.reply).toContain('Monse');
  });

  it('llámame a Monse → call.start (verbo con me)', () => {
    const r = parse('llámame a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('puedes llamar a Monse → call.start (infinitivo con puedes)', () => {
    const r = parse('puedes llamar a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('hazme una llamada a Monse → call.start', () => {
    const r = parse('hazme una llamada a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('comunícate con Monse → call.start (sin duplicar el conector)', () => {
    const r = parse('comunícate con Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('call Monse → call.start en inglés', () => {
    const r = parse('call Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.reply).toContain('dialer');
  });

  it('can you call up the doctor → call.start (en, call up the)', () => {
    const r = parse('can you call up the doctor');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('doctor');
  });

  it('marca a Monse por favor → call.start y limpia la cortesía', () => {
    const r = parse('marca a Monse por favor');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('llama a Monse! → call.start y limpia la puntuación final', () => {
    const r = parse('llama a Monse!');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('call.start');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('llama sin destinatario → handled true, action null y pide aclaración', () => {
    const r = parse('llama');
    expect(r.handled).toBe(true);
    expect(r.action).toBeNull();
    expect(r.reply).toContain('¿A quién');
  });

  it('call without target → handled true, action null (en)', () => {
    const r = parse('call');
    expect(r.handled).toBe(true);
    expect(r.action).toBeNull();
    expect(r.reply).toContain('Who would you like');
  });
});

describe('parseDeviceActionIntent — WhatsApp (whatsapp.send)', () => {
  it('envía un whatsapp a Monse → whatsapp.send', () => {
    const r = parse('envía un whatsapp a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.data?.message).toBeUndefined();
    expect(r.reply).toContain('WhatsApp');
  });

  it('envía un mensaje por whatsapp a Monse → whatsapp.send (barrido perezoso)', () => {
    const r = parse('envía un mensaje por whatsapp a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('hazme un whatsapp a Monse → whatsapp.send', () => {
    const r = parse('hazme un whatsapp a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('mándale un whatsapp a Monse → whatsapp.send (le + acento)', () => {
    const r = parse('mándale un whatsapp a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('puedes enviar un whatsapp a Monse → whatsapp.send (infinitivo)', () => {
    const r = parse('puedes enviar un whatsapp a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('envía un whatsapp a Monse dile que es mi vida → mensaje extraído', () => {
    const r = parse('envía un whatsapp a Monse dile que es mi vida');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.data?.message).toBe('es mi vida');
  });

  it('envía un whatsapp a Monse con el mensaje te veo luego → mensaje extraído', () => {
    const r = parse('envía un whatsapp a Monse con el mensaje te veo luego');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.data?.message).toBe('te veo luego');
  });

  it('send a whatsapp to Monse tell her that hi → whatsapp.send (en con mensaje)', () => {
    const r = parse('send a whatsapp to Monse tell her that hi');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.data?.message).toBe('hi');
    expect(r.reply).toContain('WhatsApp');
  });

  it('whatsapp to Monse → whatsapp.send (forma directa en)', () => {
    const r = parse('whatsapp to Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('whatsapp.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('envía un whatsapp sin destinatario → pide aclaración', () => {
    const r = parse('envía un whatsapp a');
    expect(r.handled).toBe(true);
    expect(r.action).toBeNull();
  });
});

describe('parseDeviceActionIntent — SMS (sms.send)', () => {
  it('manda un mensaje de texto a Monse → sms.send', () => {
    const r = parse('manda un mensaje de texto a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('sms.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.reply).toContain('mensajes');
  });

  it('envía un mensaje a Monse → sms.send (palabra corta)', () => {
    const r = parse('envía un mensaje a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('sms.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('manda un texto a Monse → sms.send', () => {
    const r = parse('manda un texto a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('sms.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('manda un sms a Monse diciéndole que llego tarde → mensaje extraído', () => {
    const r = parse('manda un sms a Monse diciéndole que llego tarde');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('sms.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.data?.message).toBe('llego tarde');
  });

  it('send a text message to Monse → sms.send (en)', () => {
    const r = parse('send a text message to Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('sms.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('envía un mensaje por whatsapp a Monse NO es SMS (el canal es whatsapp)', () => {
    const r = parse('envía un mensaje por whatsapp a Monse');
    expect(r.action).toBe('whatsapp.send');
  });
});

describe('parseDeviceActionIntent — correo (email.send)', () => {
  it('envía un correo a Monse → email.send', () => {
    const r = parse('envía un correo a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('email.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.reply).toContain('correo');
  });

  it('envía un correo electrónico a Monse → email.send (frase completa)', () => {
    const r = parse('envía un correo electrónico a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('email.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('manda un mail a Monse → email.send', () => {
    const r = parse('manda un mail a Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('email.send');
    expect(r.data?.contactName).toBe('Monse');
  });

  it('envía un correo a Monse con el mensaje revisa esto → mensaje extraído', () => {
    const r = parse('envía un correo a Monse con el mensaje revisa esto');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('email.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.data?.message).toBe('revisa esto');
  });

  it('send an email to Monse → email.send (en)', () => {
    const r = parse('send an email to Monse');
    expect(r.handled).toBe(true);
    expect(r.action).toBe('email.send');
    expect(r.data?.contactName).toBe('Monse');
    expect(r.reply).toContain('email');
  });
});

describe('parseDeviceActionIntent — no reconocido', () => {
  it('texto vacío → handled false', () => {
    const r = parse('');
    expect(r.handled).toBe(false);
    expect(r.action).toBeNull();
  });

  it('texto no relacionado → handled false', () => {
    const r = parse('cuéntame un chiste');
    expect(r.handled).toBe(false);
    expect(r.action).toBeNull();
  });

  it('texto de otra categoría → handled false', () => {
    const r = parse('pon una alarma a las 7');
    expect(r.handled).toBe(false);
  });
});
