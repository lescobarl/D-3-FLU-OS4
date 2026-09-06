// ============================================================
// reminderIntentParser — intenciones de recordatorios y compras (B9/B10) — Fase 2
// ------------------------------------------------------------
// Parser determinista es/en. Regla #1: `now` y `defaultOffsetMs`
// inyectables; respuestas y datos se verifican de forma verbatim.
// ============================================================

import { describe, expect, it } from 'vitest';
import { parseReminderIntent } from '../src/core/reminders/reminderIntentParser';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

describe('reminderIntentParser — creación de recordatorios (es)', () => {
  it('"recuérdame comprar leche" con desfase por defecto fija dueAt', () => {
    expect(parseReminderIntent('recuérdame comprar leche', { now, defaultOffsetMs: 60000 })).toEqual({
      handled: true,
      action: 'reminder.add',
      reply: 'Listo, te lo recuerdo: "comprar leche".',
      data: { text: 'comprar leche', dueAt: NOW + 60000 },
    });
  });

  it('"recuérdame comprar leche mañana" resuelve la cláusula de cuándo', () => {
    const result = parseReminderIntent('recuérdame comprar leche mañana');
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.add');
    expect(result.data?.text).toBe('comprar leche');
    expect(typeof result.data?.dueAt).toBe('number');
    expect(result.reply).toMatch(/mañana a las \d{2}:\d{2}/);
  });

  it('"no olvides comprar pan" usa el trigger alterno y el desfase', () => {
    expect(parseReminderIntent('no olvides comprar pan', { now, defaultOffsetMs: 60000 })).toEqual({
      handled: true,
      action: 'reminder.add',
      reply: 'Listo, te lo recuerdo: "comprar pan".',
      data: { text: 'comprar pan', dueAt: NOW + 60000 },
    });
  });

  it('"recuérdame" sin texto pide aclaración', () => {
    expect(parseReminderIntent('recuérdame')).toEqual({
      handled: true,
      action: null,
      reply: '¿Qué quieres que te recuerde?',
    });
  });
});

describe('reminderIntentParser — creación de recordatorios (en)', () => {
  it('"remind me to buy milk" con desfase por defecto fija dueAt', () => {
    expect(parseReminderIntent('remind me to buy milk', { now, defaultOffsetMs: 60000 })).toEqual({
      handled: true,
      action: 'reminder.add',
      reply: 'Okay, I will remind you: "buy milk".',
      data: { text: 'buy milk', dueAt: NOW + 60000 },
    });
  });

  it("'don't forget to buy milk' usa el trigger alterno en inglés", () => {
    expect(parseReminderIntent("don't forget to buy milk", { now, defaultOffsetMs: 60000 })).toEqual({
      handled: true,
      action: 'reminder.add',
      reply: 'Okay, I will remind you: "buy milk".',
      data: { text: 'buy milk', dueAt: NOW + 60000 },
    });
  });

  it('"remind me" sin texto pide aclaración en inglés', () => {
    expect(parseReminderIntent('remind me')).toEqual({
      handled: true,
      action: null,
      reply: 'What would you like me to remind you about?',
    });
  });
});

describe('reminderIntentParser — persona destinataria', () => {
  it('"recuérdale a María que llame" captura a la persona (es)', () => {
    expect(parseReminderIntent('recuérdale a María que llame', { now, defaultOffsetMs: 0 })).toEqual({
      handled: true,
      action: 'reminder.add',
      reply: 'Listo, te lo recuerdo y se lo haré saber a María: "que llame".',
      data: { text: 'que llame', dueAt: NOW, personName: 'María' },
    });
  });

  it('"remind Mary to call" captura a la persona (en)', () => {
    expect(parseReminderIntent('remind Mary to call', { now, defaultOffsetMs: 0 })).toEqual({
      handled: true,
      action: 'reminder.add',
      reply: 'Okay, I will remind you and let Mary know: "to call".',
      data: { text: 'to call', dueAt: NOW, personName: 'Mary' },
    });
  });
});

describe('reminderIntentParser — compras (es)', () => {
  it('"agrega leche a la lista de compras" → shopping.add', () => {
    expect(parseReminderIntent('agrega leche a la lista de compras')).toEqual({
      handled: true,
      action: 'shopping.add',
      reply: 'Listo, agregué "leche" a la lista de compras.',
      data: { label: 'leche' },
    });
  });

  it('"agrega leche y pan a la lista de compras" conserva la etiqueta completa', () => {
    expect(parseReminderIntent('agrega leche y pan a la lista de compras')).toEqual({
      handled: true,
      action: 'shopping.add',
      reply: 'Listo, agregué "leche y pan" a la lista de compras.',
      data: { label: 'leche y pan' },
    });
  });

  it('"tacha leche de la lista" → shopping.toggle', () => {
    expect(parseReminderIntent('tacha leche de la lista')).toEqual({
      handled: true,
      action: 'shopping.toggle',
      reply: 'Listo, marqué "leche" en la lista de compras.',
      data: { label: 'leche' },
    });
  });

  it('"quita leche de la lista de compras" → shopping.remove', () => {
    expect(parseReminderIntent('quita leche de la lista de compras')).toEqual({
      handled: true,
      action: 'shopping.remove',
      reply: 'Listo, quité "leche" de la lista de compras.',
      data: { label: 'leche' },
    });
  });

  it('"muéstrame la lista de compras" → shopping.list', () => {
    expect(parseReminderIntent('muéstrame la lista de compras')).toEqual({
      handled: true,
      action: 'shopping.list',
      reply: 'Aquí tienes tu lista de compras.',
    });
  });
});

describe('reminderIntentParser — compras (en)', () => {
  it('"add milk to the shopping list" → shopping.add', () => {
    expect(parseReminderIntent('add milk to the shopping list')).toEqual({
      handled: true,
      action: 'shopping.add',
      reply: 'Done, I added "milk" to the shopping list.',
      data: { label: 'milk' },
    });
  });

  it('"check off milk from the shopping list" → shopping.toggle', () => {
    expect(parseReminderIntent('check off milk from the shopping list')).toEqual({
      handled: true,
      action: 'shopping.toggle',
      reply: 'Done, I marked "milk" on the shopping list.',
      data: { label: 'milk' },
    });
  });

  it('"remove milk from the list" → shopping.remove', () => {
    expect(parseReminderIntent('remove milk from the list')).toEqual({
      handled: true,
      action: 'shopping.remove',
      reply: 'Done, I removed "milk" from the shopping list.',
      data: { label: 'milk' },
    });
  });

  it('"show me the shopping list" → shopping.list', () => {
    expect(parseReminderIntent('show me the shopping list')).toEqual({
      handled: true,
      action: 'shopping.list',
      reply: 'Here is your shopping list.',
    });
  });
});

describe('reminderIntentParser — listas de recordatorios', () => {
  it('"qué tengo pendientes" → reminder.list (es)', () => {
    expect(parseReminderIntent('qué tengo pendientes')).toEqual({
      handled: true,
      action: 'reminder.list',
      reply: 'Aquí tienes tus recordatorios pendientes.',
    });
  });

  it('"dime mis pendientes" → reminder.list (es)', () => {
    const result = parseReminderIntent('dime mis pendientes');
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.list');
    expect(result.reply).toBe('Aquí tienes tus recordatorios pendientes.');
  });

  it('"what is pending" → reminder.list (en)', () => {
    expect(parseReminderIntent('what is pending')).toEqual({
      handled: true,
      action: 'reminder.list',
      reply: 'Here are your pending reminders.',
    });
  });
});

describe('reminderIntentParser — citas (agenda)', () => {
  it('"crea una cita con el doctor el lunes a las 3" → reminder.add con persona y cuándo', () => {
    const result = parseReminderIntent('crea una cita con el doctor el lunes a las 3', { now });
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.add');
    expect(result.data?.text).toBe('cita con doctor');
    expect(result.data?.personName).toBe('doctor');
    expect(typeof result.data?.dueAt).toBe('number');
    expect(result.reply).toMatch(/^Listo, agendé tu cita con doctor/);
  });

  it('"agenda una cita con la doctora mañana" → reminder.add', () => {
    const result = parseReminderIntent('agenda una cita con la doctora mañana', { now });
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.add');
    expect(result.data?.text).toBe('cita con doctora');
    expect(result.data?.personName).toBe('doctora');
    expect(typeof result.data?.dueAt).toBe('number');
  });

  it('"programa una cita" sin cuándo usa el desfase por defecto', () => {
    expect(parseReminderIntent('programa una cita', { now, defaultOffsetMs: 60000 })).toEqual({
      handled: true,
      action: 'reminder.add',
      reply: 'Listo, agendé tu cita: "cita".',
      data: { text: 'cita', dueAt: NOW + 60000 },
    });
  });

  it('"schedule an appointment with the doctor tomorrow" → reminder.add (en)', () => {
    const result = parseReminderIntent('schedule an appointment with the doctor tomorrow', { now });
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.add');
    expect(result.data?.text).toBe('appointment with doctor');
    expect(result.data?.personName).toBe('doctor');
    expect(typeof result.data?.dueAt).toBe('number');
    expect(result.reply).toMatch(/^Done, I scheduled your appointment with doctor/);
  });

  it('"create an appointment" sin cuándo usa el desfase por defecto (en)', () => {
    expect(parseReminderIntent('create an appointment', { now, defaultOffsetMs: 60000 })).toEqual({
      handled: true,
      action: 'reminder.add',
      reply: 'Done, I scheduled your appointment: "appointment".',
      data: { text: 'appointment', dueAt: NOW + 60000 },
    });
  });
});

describe('reminderIntentParser — no reconocido', () => {
  it.each(['hola', '', '   ', 'qué pendientes tengo', 'agrega leche'])(
    'devuelve handled:false para "%s"',
    (input) => {
      expect(parseReminderIntent(input)).toEqual({ handled: false, action: null, reply: '' });
    },
  );

  it('devuelve handled:false para entradas no string', () => {
    expect(parseReminderIntent(null as unknown as string)).toEqual({ handled: false, action: null, reply: '' });
    expect(parseReminderIntent(undefined as unknown as string)).toEqual({ handled: false, action: null, reply: '' });
  });
});

describe('reminderIntentParser — cancelación/negación (Point E)', () => {
  it('"quita el recordatorio de comprar leche" → reminder.remove', () => {
    expect(parseReminderIntent('quita el recordatorio de comprar leche')).toEqual({
      handled: true,
      action: 'reminder.remove',
      reply: 'Listo, quité el recordatorio "comprar leche".',
      data: { text: 'comprar leche' },
    });
  });

  it('"cancela el recordatorio de la cita" → reminder.remove', () => {
    const result = parseReminderIntent('cancela el recordatorio de la cita');
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.remove');
    expect(result.data?.text).toBe('la cita');
  });

  it('"elimina ese recordatorio de pagar la renta" → reminder.remove', () => {
    const result = parseReminderIntent('elimina ese recordatorio de pagar la renta');
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.remove');
    expect(result.data?.text).toBe('pagar la renta');
  });

  it('"ya no quiero el recordatorio de comprar pan" → reminder.remove', () => {
    const result = parseReminderIntent('ya no quiero el recordatorio de comprar pan');
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.remove');
    expect(result.data?.text).toBe('comprar pan');
  });

  it('"no nada más ese recordatorio de la junta" → reminder.remove', () => {
    const result = parseReminderIntent('no nada más ese recordatorio de la junta');
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.remove');
    expect(result.data?.text).toBe('la junta');
  });

  it('"remove the reminder to buy milk" → reminder.remove (en)', () => {
    const result = parseReminderIntent('remove the reminder to buy milk');
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.remove');
    expect(result.data?.text).toBe('buy milk');
  });

  it('"i don\'t want the reminder for the meeting" → reminder.remove (en)', () => {
    const result = parseReminderIntent("i don't want the reminder for the meeting");
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.remove');
    expect(result.data?.text).toBe('the meeting');
  });

  it('"quita el recordatorio" sin texto pide aclaración', () => {
    expect(parseReminderIntent('quita el recordatorio')).toEqual({
      handled: true,
      action: null,
      reply: '¿Qué quieres que te recuerde?',
    });
  });
});

describe('reminderIntentParser — frases realistas con ruido (Point G)', () => {
  it('"sí, recuérdame comprar leche por favor" tolera el relleno inicial', () => {
    const result = parseReminderIntent('sí, recuérdame comprar leche por favor', {
      now,
      defaultOffsetMs: 60000,
    });
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.add');
    expect(result.data?.text).toBe('comprar leche');
    expect(result.data?.dueAt).toBe(NOW + 60000);
  });

  it('"oye pon un recordatorio de comprar leche" tolera el relleno inicial', () => {
    const result = parseReminderIntent('oye pon un recordatorio de comprar leche', {
      now,
      defaultOffsetMs: 60000,
    });
    expect(result.handled).toBe(true);
    expect(result.action).toBe('reminder.add');
    expect(result.data?.text).toBe('comprar leche');
    expect(result.data?.dueAt).toBe(NOW + 60000);
  });

  it('"no nada más ese recordatorio" (sin texto tras el objeto) pide aclaración', () => {
    const result = parseReminderIntent('no nada más ese recordatorio');
    expect(result.handled).toBe(true);
    expect(result.action).toBeNull();
  });
});
