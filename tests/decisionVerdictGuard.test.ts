// ============================================================
// Veredictos: ninguna decision queda sin resolver por escrito.
// ============================================================
/**
 * El ledger tenia 6 entradas en estado 'decision' con evidencia narrativa pero SIN veredicto
 * formal: se leian como pendientes eternos. Una decision o esta tomada y escrita, o sigue
 * abierta; lo que no vale es dejarla 'decision' sin decir que se decidio ni por que.
 *
 * Regla: toda entrada en estado 'decision' DEBE llevar un 'VEREDICTO:' en su evidencia.
 * Las seis historicas se resolvieron con evidencia citada (lineas concretas), no con opinion.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LEDGER = 'plans/ledger.json';
const MARK = 'VEREDICTO:';
const RESOLVED = ['P4.11', 'P4.12', 'P4.14', 'P6.1', 'P6.5', 'P6.8', 'P1.8'];

interface Item { id: string; estado: string; evidencia?: string }

/** Entradas en 'decision' sin veredicto formal. */
export function decisionsWithoutVerdict(items: Item[]): string[] {
  return items.filter((i) => i.estado === 'decision' && !String(i.evidencia || '').includes(MARK)).map((i) => i.id);
}

describe('Veredictos del ledger', () => {
  it('ninguna decision queda sin VEREDICTO', () => {
    const items: Item[] = JSON.parse(readFileSync(LEDGER, 'utf8')).items;
    const bad = decisionsWithoutVerdict(items);
    expect(bad, 'decisiones sin veredicto (N=' + bad.length + '): ' + bad.join(', ')).toEqual([]);
  });

  it('las seis decisiones historicas quedaron cerradas con veredicto citado', () => {
    const items: Item[] = JSON.parse(readFileSync(LEDGER, 'utf8')).items;
    for (const id of RESOLVED) {
      const it = items.find((i) => i.id === id);
      expect(it, 'falta ' + id).toBeTruthy();
      expect(it!.estado, id + ' debe estar resuelto').toBe('done');
      expect(String(it!.evidencia), id + ' debe citar evidencia').toContain(MARK);
    }
  });
});

describe('Veredictos - el detector no es decorativo (7.7.d)', () => {
  it('detecta decision sin veredicto y respeta las que lo tienen', () => {
    const sin = [{ id: 'X', estado: 'decision', evidencia: 'algo' }];
    expect(decisionsWithoutVerdict(sin)).toEqual(['X']);
    expect(decisionsWithoutVerdict([{ id: 'Y', estado: 'decision', evidencia: 'VEREDICTO: no aplica' }])).toEqual([]);
    expect(decisionsWithoutVerdict([{ id: 'Z', estado: 'done' }])).toEqual([]);
  });
});
