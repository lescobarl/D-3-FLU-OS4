// ============================================================
// eventQueue - cola FIFO inmutable de eventos de mic/STT
// ------------------------------------------------------------
// Modulo puro y autocontenido (no importa nada): se prueba el comportamiento
// REAL pasandole datos. Casos borde cubiertos: cola vacia, tope de tamano
// alcanzado, tope 1, compactacion tras consumir, congelado (Object.freeze) del
// evento encolado, orden FIFO, snapshot no consumidor, clear, ids globales
// monotonos y tope por defecto (4096). Date.now se fija con fake timers para
// que enqueuedAt sea deterministico.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventQueue } from '../src/voice/lib/eventQueue.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- push: encolado con id monotono, sello temporal y congelado ----
describe('eventQueue - push', () => {
  it('devuelve el evento congelado con id monotono y enqueuedAt del reloj', () => {
    const q = createEventQueue();
    const a = q.push({ kind: 'interim', text: 'hola' });
    const b = q.push({ kind: 'final', text: 'adios' });

    expect(a.kind).toBe('interim');
    expect(a.text).toBe('hola');
    expect(a.enqueuedAt).toBe(Date.now());
    expect(b.id).toBe(a.id + 1);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
    expect(q.length).toBe(2);
  });

  it('congelar el evento impide mutarlo (falla en modo estricto)', () => {
    const q = createEventQueue();
    const evt = q.push({ kind: 'interim' }) as { kind: string };

    expect(() => {
      evt.kind = 'otro';
    }).toThrow();
    expect(evt.kind).toBe('interim');
  });
});

// ---- shift / peek: orden FIFO y consumo ----
describe('eventQueue - shift y peek', () => {
  it('shift entrega en orden FIFO y devuelve null cuando queda vacia', () => {
    const q = createEventQueue();
    const a = q.push({ n: 1 });
    const b = q.push({ n: 2 });

    expect(q.peek().id).toBe(a.id);
    expect(q.shift().id).toBe(a.id);
    expect(q.peek().id).toBe(b.id);
    expect(q.shift().id).toBe(b.id);
    expect(q.shift()).toBeNull();
    expect(q.length).toBe(0);
  });

  it('peek no consume y devuelve null en cola vacia', () => {
    const q = createEventQueue();
    expect(q.peek()).toBeNull();

    q.push({ n: 1 });
    expect(q.peek()).not.toBeNull();
    expect(q.peek()).not.toBeNull();
    expect(q.length).toBe(1);
  });
});

// ---- snapshot / clear ----
describe('eventQueue - snapshot y clear', () => {
  it('snapshot devuelve copia congelada sin consumir la cola', () => {
    const q = createEventQueue();
    const a = q.push({ n: 1 });
    const b = q.push({ n: 2 });

    const snap = q.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap.map((e: { id: number }) => e.id)).toEqual([a.id, b.id]);
    expect(q.length).toBe(2);
  });

  it('clear vacia la cola y libera el estado', () => {
    const q = createEventQueue();
    q.push({ n: 1 });
    q.push({ n: 2 });
    q.clear();

    expect(q.length).toBe(0);
    expect(q.peek()).toBeNull();
    expect(q.shift()).toBeNull();
  });
});

// ---- tope de tamano: se descarta el mas antiguo ----
describe('eventQueue - tope de tamano', () => {
  it('al alcanzar maxSize descarta el evento mas antiguo y mantiene el tope', () => {
    const q = createEventQueue({ maxSize: 2 });
    const a = q.push({ n: 1 });
    const b = q.push({ n: 2 });
    const c = q.push({ n: 3 });

    expect(q.length).toBe(2);
    expect(q.peek().id).toBe(b.id);
    expect(q.snapshot().map((e: { id: number }) => e.id)).toEqual([b.id, c.id]);
    expect(a.n).toBe(1);
  });

  it('con maxSize 1 solo conserva el ultimo evento encolado', () => {
    const q = createEventQueue({ maxSize: 1 });
    q.push({ n: 1 });
    const b = q.push({ n: 2 });

    expect(q.length).toBe(1);
    expect(q.peek().id).toBe(b.id);
  });

  it('tras consumir parcialmente, el tope sigue descartando el mas antiguo sin romper el orden', () => {
    const q = createEventQueue({ maxSize: 3 });
    const a = q.push({ n: 1 });
    const b = q.push({ n: 2 });
    const c = q.push({ n: 3 });
    expect(q.shift().id).toBe(a.id);

    const d = q.push({ n: 4 });
    const e = q.push({ n: 5 });

    expect(q.length).toBe(3);
    expect(q.snapshot().map((ev: { id: number }) => ev.id)).toEqual([c.id, d.id, e.id]);
    expect(b.n).toBe(2);
  });

  it('usa el tope por defecto de 4096 eventos', () => {
    const q = createEventQueue();
    const pushed: { id: number }[] = [];
    for (let i = 0; i < 4100; i += 1) pushed.push(q.push({ n: i }));

    expect(q.length).toBe(4096);
    expect(q.peek().id).toBe(pushed[4].id);
    expect(q.snapshot()[0].id).toBe(pushed[4].id);
  });
});

// ---- ids globales: monotonos entre colas distintas ----
describe('eventQueue - ids globales', () => {
  it('los ids avanzan entre instancias distintas (secuencia global)', () => {
    const q1 = createEventQueue();
    const q2 = createEventQueue();
    const a = q1.push({ n: 1 });
    const b = q2.push({ n: 2 });

    expect(b.id).toBeGreaterThan(a.id);
    expect(new Set([a.id, b.id]).size).toBe(2);
  });
});
