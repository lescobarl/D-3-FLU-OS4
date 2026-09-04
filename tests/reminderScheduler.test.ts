// ============================================================
// Fase 2 — Recordatorios (B3): scheduler de vencimientos
// Lógica pura y determinista: isDue / collectDue / nextDueIn / collectDueOrdered.
// ============================================================
import { describe, expect, it } from 'vitest';

import {
  collectDue,
  collectDueOrdered,
  isDue,
  nextDueIn,
  type DueCandidate,
} from '../src/core/reminders/reminderScheduler';

const items: DueCandidate[] = [
  { id: 'a', dueAt: 300, status: 'pending' },
  { id: 'b', dueAt: 100, status: 'pending' },
  { id: 'c', dueAt: 200, status: 'done' },
  { id: 'd', dueAt: 150, status: 'dismissed' },
];

const ids = (list: DueCandidate[]): string[] => list.map((i) => i.id);

describe('reminderScheduler — isDue', () => {
  it('vencido cuando dueAt <= now', () => {
    expect(isDue(100, 100)).toBe(true);
    expect(isDue(101, 100)).toBe(false);
  });

  it('respeta la ventana de gracia graceMs', () => {
    expect(isDue(105, 100, 5)).toBe(true);
    expect(isDue(106, 100, 5)).toBe(false);
  });
});

describe('reminderScheduler — collectDue', () => {
  it('recoge solo los vencidos pendientes en orden estable', () => {
    expect(ids(collectDue(items, 300))).toEqual(['a', 'b']);
  });

  it('respeta el límite de vencimiento exacto', () => {
    expect(ids(collectDue(items, 100))).toEqual(['b']);
  });

  it('filtra por estados personalizados', () => {
    expect(ids(collectDue(items, 300, ['done', 'dismissed']))).toEqual(['c', 'd']);
    expect(ids(collectDue(items, 300, ['done']))).toEqual(['c']);
    expect(ids(collectDue(items, 300, ['missing']))).toEqual([]);
  });

  it('aplica la gracia en la recolección', () => {
    expect(ids(collectDue(items, 305, ['pending'], 5))).toEqual(['a', 'b']);
  });

  it('devuelve [] para entrada vacía', () => {
    expect(collectDue([], 300)).toEqual([]);
  });

  it('no muta el arreglo de entrada', () => {
    const snapshot = ids(items);
    collectDue(items, 300);
    expect(ids(items)).toEqual(snapshot);
  });
});

describe('reminderScheduler — collectDueOrdered', () => {
  it('ordena los vencidos por dueAt ascendente', () => {
    expect(ids(collectDueOrdered(items, 300))).toEqual(['b', 'a']);
  });

  it('respeta el límite de lote', () => {
    expect(ids(collectDueOrdered(items, 300, ['pending'], 1))).toEqual(['b']);
  });

  it('un límite <= 0 devuelve []', () => {
    expect(ids(collectDueOrdered(items, 300, ['pending'], 0))).toEqual([]);
    expect(ids(collectDueOrdered(items, 300, ['pending'], -1))).toEqual([]);
  });

  it('ordena también estados combinados', () => {
    expect(ids(collectDueOrdered(items, 300, ['done', 'dismissed']))).toEqual(['d', 'c']);
  });

  it('no muta el arreglo de entrada', () => {
    const snapshot = ids(items);
    collectDueOrdered(items, 300);
    expect(ids(items)).toEqual(snapshot);
  });
});

describe('reminderScheduler — nextDueIn', () => {
  it('calcula ms hasta el vencimiento pendiente más cercano', () => {
    expect(nextDueIn(items, 50)).toBe(50);
    expect(nextDueIn(items, 100)).toBe(0);
  });

  it('devuelve null si ningún estado coincide', () => {
    expect(nextDueIn(items, 100, ['missing'])).toBeNull();
  });

  it('considera estados personalizados y permite valores negativos (atrasado)', () => {
    expect(nextDueIn(items, 200, ['done'])).toBe(0);
    expect(nextDueIn(items, 100, ['dismissed'])).toBe(50);
    expect(nextDueIn(items, 200, ['dismissed'])).toBe(-50);
  });

  it('devuelve null para entrada vacía', () => {
    expect(nextDueIn([], 100)).toBeNull();
  });
});
