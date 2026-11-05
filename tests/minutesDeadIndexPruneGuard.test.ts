// ============================================================
// P1.6 - minutes: sin indice muerto, con migracion PROBADA.
// ============================================================
/**
 * El esquema declaraba `minutes: 'id, timestamp, sequence'` desde v3 y NINGUNA
 * consulta usa ese indice: la unica real es orderBy('sequence')
 * (src/hooks/useMinuteKnowledge.ts). Un indice que nadie consulta ocupa espacio y
 * hace creer que hay consultas por fecha.
 *
 * Se elimina con la version 23 de Dexie. La duda legitima de quitar un indice es si
 * la migracion rompe los datos; por eso este guard NO se conforma con mirar el
 * fuente: monta una base en el esquema VIEJO (v22, con el indice), mete una fila,
 * y reabre con el esquema NUEVO para comprobar que la fila sobrevive y el indice
 * desaparece. Eso es lo que no podia verificar un test estatico (AGENTS.md 7.7.d).
 *
 * Se lee la ULTIMA declaracion (la efectiva): las versiones historicas son
 * inmutables y pueden seguir mencionando el indice.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { FluDatabase } from '../src/core/db/fluDatabase';

const ROOT = process.cwd();
const DB_FILE = 'src/core/db/fluDatabase.ts';
const DB_NAME = 'flu-os3';

/** Indices de cada declaracion de `minutes` (en orden de aparicion). */
export function minutesDeclarations(src: string): string[][] {
  return [...src.matchAll(/minutes:\s*['"]([^'"]*)['"]/g)].map((m) =>
    m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Indices del esquema EFECTIVO (la ultima declaracion). */
export function effectiveMinutesIndexes(src: string): string[] {
  const all = minutesDeclarations(src);
  return all.length ? all[all.length - 1] : [];
}

describe('P1.6 minutes - sin indice muerto', () => {
  it('el esquema efectivo no declara el indice timestamp', () => {
    const idx = effectiveMinutesIndexes(readFileSync(join(ROOT, DB_FILE), 'utf8'));
    expect(idx).not.toContain('timestamp');
    expect(idx).toContain('sequence');
  });

  it('la migracion borra el indice y CONSERVA las filas', async () => {
    // 1) Sembrar el esquema VIEJO (v22 con el indice muerto) y meter una minuta.
    const legacy = new Dexie(DB_NAME);
    legacy.version(22).stores({ minutes: 'id, timestamp, sequence' });
    await legacy.open();
    await legacy.table('minutes').add({
      id: 'm-migracion',
      timestamp: 1700000000000,
      sequence: 7,
      minuteKey: 'k',
      description: 'sobrevive',
      profileId: '',
      userId: '',
      historyCode: '250922-07',
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      summarySnapshot: { titulo: 'sobrevive' },
      sync: { revision: 1, updated_at: '2026-09-22T00:00:00.000Z', deleted: false },
    });
    expect(legacy.table('minutes').schema.indexes.map((i) => i.name)).toContain('timestamp');
    legacy.close();

    // 2) Reabrir con el esquema NUEVO (FluDatabase ya declara v23).
    const db = new FluDatabase();
    await db.open();
    const names = db.table('minutes').schema.indexes.map((i) => i.name);
    expect(names).not.toContain('timestamp');
    expect(names).toContain('sequence');
    const rows = await db.table('minutes').toArray();
    expect(rows.map((r) => r.id)).toEqual(['m-migracion']);
    expect(rows[0].summarySnapshot.titulo).toBe('sobrevive');
    db.close();
  });
});

describe('P1.6 - el detector no es decorativo (7.7.d)', () => {
  it('lee la ULTIMA declaracion y no confunde el historico con el efectivo', () => {
    const src = [
      "minutes: 'id, timestamp, sequence',",
      "minutes: 'id, sequence',",
    ].join(String.fromCharCode(10));
    expect(minutesDeclarations(src)).toEqual([
      ['id', 'timestamp', 'sequence'],
      ['id', 'sequence'],
    ]);
    expect(effectiveMinutesIndexes(src)).toEqual(['id', 'sequence']);
  });
  it('detecta el indice muerto cuando es el efectivo', () => {
    expect(effectiveMinutesIndexes("minutes: 'id, timestamp, sequence',")).toContain('timestamp');
  });
})
