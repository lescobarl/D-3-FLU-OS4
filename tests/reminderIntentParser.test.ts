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
