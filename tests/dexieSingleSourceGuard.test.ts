// ============================================================
// P1.4 - El esquema Dexie es la FUENTE UNICA de la lista de tablas.
// ============================================================
/**
 * La lista de tablas estaba escrita TRES veces: los campos tipados de la clase,
 * las llamadas `this.table('...')` una por tabla, y el esquema de versiones. Las
 * tres podian divergir en silencio, y la peor es la segunda: olvidar un
 * `this.table()` deja `fluDb.<tabla>` a undefined en runtime y TypeScript no dice
 * nada, porque los campos van declarados con `!`.
 *
 * Ahora el esquema (`DEXIE_VERSIONS`) es la fuente unica: de el salen la cadena de
 * versiones y los handles. Este guard contrasta el resultado contra Dexie de verdad
 * (abre la base y compara con `db.tables`), no solo contra el fuente: un test que
 * se creyera su propio parseo seria decorativo (AGENTS.md 7.7.d).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { FluDatabase, schemaTableNames } from '../src/core/db/fluDatabase';
const ROOT = process.cwd();
const DB_FILE = 'src/core/db/fluDatabase.ts';
/** Campos tipados de la clase (`nombre!: EntityTable<...>`). */
export function typedTableFields(src: string): string[] {
  return [...src.matchAll(/^\s*(\w+)!: EntityTable</gm)].map((m) => m[1]);
}
/** Llamadas `this.table('literal')`: la lista a mano que habia que eliminar. */
export function handWrittenTableCalls(src: string): string[] {
  return [...src.matchAll(/this\.table\('([^']+)'\)/g)].map((m) => m[1]);
}
describe('P1.4 Dexie - una sola fuente de la lista de tablas', () => {
  const src = readFileSync(join(ROOT, DB_FILE), 'utf8');
  const schema = schemaTableNames();
  it('la lista de tablas no se escribe a mano tabla por tabla', () => {
    const calls = handWrittenTableCalls(src);
    expect(calls, 'vuelven las llamadas this.table(...) a mano (N=' + calls.length + ')').toEqual([]);
  });
  it('los campos tipados de la clase coinciden con el esquema', () => {
    const fields = typedTableFields(src).sort();
    expect(fields.length).toBeGreaterThan(20); // anti-vacuidad
    expect(fields).toEqual([...schema].sort());
  });
  it('Dexie resuelve EXACTAMENTE las tablas del esquema', async () => {
    const db = new FluDatabase();
    await db.open();
    try {
      expect(db.tables.map((t) => t.name).sort()).toEqual([...schema].sort());
    } finally {
      db.close();
    }
  });
  it('cada tabla del esquema tiene handle en runtime', () => {
    const handles = new FluDatabase() as unknown as Record<string, unknown>;
    expect(schema.length).toBeGreaterThan(20); // anti-vacuidad
    for (const name of schema) {
      const table = handles[name] as { toArray?: unknown } | undefined;
      expect(table, name + ' sin handle').toBeTruthy();
      expect(typeof table?.toArray, name + ' no es una Table').toBe('function');
    }
  });
});
describe('P1.4 - el detector no es decorativo (7.7.d)', () => {
  it('respeta altas, bajas y realtas del esquema', () => {
    const versions: Array<{ stores: Record<string, string | null> }> = [
      { stores: { a: 'id', b: 'id' } },
      { stores: { c: 'id' } },
      { stores: { b: null } }, // baja
      { stores: { b: 'id, x' } }, // realta
    ];
    expect(schemaTableNames(versions)).toEqual(['a', 'c', 'b']);
  });
  it('lee las llamadas a mano y no confunde otros usos de table()', () => {
    expect(handWrittenTableCalls("this.table('notes');")).toEqual(['notes']);
    expect(handWrittenTableCalls('this.table(name);')).toEqual([]);
    expect(typedTableFields('    notes!: EntityTable<NoteRecord, ' + String.fromCharCode(39) + 'id' + String.fromCharCode(39) + '>;')).toEqual(['notes']);
  });
});