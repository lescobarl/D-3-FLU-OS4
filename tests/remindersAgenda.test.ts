// ============================================================
// remindersAgenda — fusiona recordatorios en la agenda (B5) — Fase 2
// ------------------------------------------------------------
// Determinista: usa fechas lejanas (2099) para que
// formatReminderWhen siempre caiga en la rama 'el DD/MM/YYYY a las HH:MM'.
// ============================================================

import { describe, expect, it } from 'vitest';
import type { ReminderRecord } from '../src/core/db/fluDatabase';
import {
  countPendingItems,
  DEFAULT_AGENDA_CONFIG,
  formatAgendaForPrompt,
  mergeRemindersIntoAgenda,
  type DailyAgendaItem,
} from '../src/lib/dailyAgenda';

const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

/** Fecha fija muy en el futuro para evitar las ramas 'hoy'/'mañana' del reloj real. */
function T(h: number, m: number): number {
  return new Date(2099, 0, 15, h, m, 0, 0).getTime();
}

function makeReminder(overrides: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    id: 'r1',
    text: 'comprar leche',
    dueAt: T(10, 30),
    category: 'general',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
    ...overrides,
  };
}

function makeItem(overrides: Partial<DailyAgendaItem> = {}): DailyAgendaItem {
  return {
    minuteId: 'm1',
    title: 'Reunión',
    pendingItems: ['revisar docs'],
    nextSteps: [],
    sourceDate: '',
    ...overrides,
  };
}

describe('mergeRemindersIntoAgenda — casos sin fusión', () => {
  it('devuelve la misma referencia con reminders vacíos o no-array', () => {
    const items = [makeItem()];
    expect(mergeRemindersIntoAgenda(items, [])).toBe(items);
    expect(mergeRemindersIntoAgenda(items, null as unknown as ReadonlyArray<ReminderRecord>)).toBe(items);
  });

  it('devuelve la misma referencia si no hay pendientes (solo done/dismissed)', () => {
    const items = [makeItem()];
    expect(mergeRemindersIntoAgenda(items, [makeReminder({ status: 'done' })])).toBe(items);
    expect(mergeRemindersIntoAgenda(items, [makeReminder({ status: 'dismissed' })])).toBe(items);
  });
});

describe('mergeRemindersIntoAgenda — fusión y orden', () => {
  it('agrega un item sintético con los pendientes ordenados ascendente', () => {
    const result = mergeRemindersIntoAgenda(
      [],
      [
        makeReminder({ id: 'a', text: 'revisar correo', dueAt: T(11, 0) }),
        makeReminder({ id: 'b', text: 'llamar al banco', dueAt: T(9, 0) }),
        makeReminder({ id: 'c', text: 'comprar leche', dueAt: T(10, 30) }),
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Recordatorios pendientes');
    expect(result[0].reminders).toEqual([
      'el 15/01/2099 a las 09:00 — llamar al banco',
      'el 15/01/2099 a las 10:30 — comprar leche',
      'el 15/01/2099 a las 11:00 — revisar correo',
    ]);
  });

  it('maxReminders recorta la cantidad de líneas fusionadas', () => {
    const result = mergeRemindersIntoAgenda(
      [],
      [
        makeReminder({ id: 'a', dueAt: T(11, 0) }),
        makeReminder({ id: 'b', dueAt: T(9, 0) }),
        makeReminder({ id: 'c', dueAt: T(10, 30) }),
      ],
      { maxReminders: 2 },
    );

    expect(result[0].reminders).toHaveLength(2);
    expect(result[0].reminders?.[0]).toBe('el 15/01/2099 a las 09:00 — comprar leche');
  });

  it('se agrega al final sin mutar el array original', () => {
    const items = [makeItem({ pendingItems: ['x'], reminders: ['y'] })];
    const original = JSON.stringify(items);

    const result = mergeRemindersIntoAgenda(items, [makeReminder()]);

    expect(JSON.stringify(items)).toBe(original);
    expect(result).toHaveLength(2);
    expect(result[0].minuteId).toBe('m1');
    expect(result[1].title).toBe('Recordatorios pendientes');
  });

  it('en inglés usa "Pending reminders" y el formato on YYYY-MM-DD at HH:MM', () => {
    const result = mergeRemindersIntoAgenda(
      [],
      [makeReminder({ text: 'buy milk', dueAt: T(10, 30) })],
      {},
      'en',
    );
    expect(result[0].title).toBe('Pending reminders');
    expect(result[0].reminders).toEqual(['on 2099-01-15 at 10:30 — buy milk']);
  });

  it('con texto vacío la línea es solo el vencimiento (sin guion)', () => {
    const result = mergeRemindersIntoAgenda([], [makeReminder({ text: '   ' })]);
    expect(result[0].reminders).toEqual(['el 15/01/2099 a las 10:30']);
  });
});

describe('formatAgendaForPrompt', () => {
  it('formatea el item de recordatorios con su cabecera (es)', () => {
    const items = mergeRemindersIntoAgenda([], [makeReminder()]);
    expect(formatAgendaForPrompt(items)).toBe(
      '\nPendientes de sesiones anteriores (más reciente primero):\n' +
        '1. Recordatorios pendientes\n' +
        '   Recordatorios: el 15/01/2099 a las 10:30 — comprar leche',
    );
  });

  it('devuelve string vacío sin items', () => {
    expect(formatAgendaForPrompt([])).toBe('');
  });
});

describe('countPendingItems', () => {
  it('suma pendientes, siguientes pasos y recordatorios', () => {
    const items: DailyAgendaItem[] = [
      makeItem({ pendingItems: ['a', 'b'], nextSteps: ['c'] }),
      mergeRemindersIntoAgenda([], [makeReminder()])[0],
    ];
    expect(countPendingItems(items)).toBe(4);
  });

  it('devuelve 0 para entrada no-array', () => {
    expect(countPendingItems(null as unknown as DailyAgendaItem[])).toBe(0);
  });
});

describe('DEFAULT_AGENDA_CONFIG — Fase 2 (B5)', () => {
  it('incluye maxReminders con valor por defecto 5', () => {
    expect(DEFAULT_AGENDA_CONFIG.maxReminders).toBe(5);
  });
});
