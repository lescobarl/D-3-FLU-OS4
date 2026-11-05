/**
 * conversationRecordedSessionGuard — barrera medida con la sesión real
 * 6b471291 (dos personas: hombre y mujer).
 *
 * Datos: 17 commits del grabador, 12 con firma. Antes: 7 etiquetas y filas
 * duplicadas. La barrera exige:
 *  1. con el minimo de 12 s, SOLO las dos voces largas (20,6 s y 36,3 s) pueden
 *     acunar hablante; los turnos cortos quedan pendientes (no suman),
 *  2. los duplicados y continuaciones se fusionan en la fila anterior.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decidirIdentidad } from '../src/voice/conversation/identidad';
// `decidirFusion` se retiró con la ruta doble: la fusión de duplicados y
// continuaciones vive en `continuaLaFrase` + `unirRevision` (dueños únicos).
import { continuaLaFrase } from '../src/voice/core/locucion.js';
import { unirRevision } from '../src/voice/conversation/revision';
import type { Fila, FilaNueva } from '../src/voice/conversation/ports';

interface Row {
  locutionId: string;
  turnId: string;
  text: string;
  speaker: string;
  audioStartSample: number;
  audioEndSample: number;
  sampleRate: number;
  signature: number[] | null;
}
interface SessionFixture {
  rows: Row[];
}

const fixture: SessionFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/session6b471291.json'), 'utf8'),
);

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function simularIdentidad(rows: Row[], minNuevaVozMs = 8_000) {
  const plantillas: Array<{ vozId: string; vector: number[]; etiqueta: string }> = [];
  let next = 1;
  let pendientes = 0;
  for (const row of rows) {
    if (!Array.isArray(row.signature) || row.signature.length === 0) {
      pendientes += 1;
      continue;
    }
    const duracionMs =
      ((row.audioEndSample - row.audioStartSample) / Math.max(1, row.sampleRate)) * 1000;
    const identidad = decidirIdentidad({
      vector: row.signature,
      plantillas,
      umbral: 0.72,
      duracionMs,
      minNuevaVozMs: minNuevaVozMs,
      palabras: row.text.trim().split(/\s+/).filter(Boolean).length,
      minNuevaVozPalabras: 8,
      umbralExistente: 0.64,
      etiquetaNueva: () => `Hablante ${next}`,
      comparar: cosine,
      id: () => `v${next}`,
    });
    if (!identidad.vozId) {
      pendientes += 1;
      continue;
    }
    if (!identidad.continuidad) {
      plantillas.push({ vozId: identidad.vozId, vector: row.signature, etiqueta: identidad.hablante });
      next += 1;
    }
  }
  return { speakers: plantillas.length, pendientes };
}

function fila(row: Row, index: number): Fila {
  return {
    locutionId: row.locutionId,
    sessionId: 'sesion',
    turnId: row.turnId,
    texto: row.text,
    tramo: { inicio: row.audioStartSample, fin: row.audioEndSample, sampleRate: row.sampleRate },
    etiqueta: row.speaker,
    evidencia: Array.isArray(row.signature) && row.signature.length ? 'medida' : 'pendiente',
    firma: row.signature,
    idioma: 'es',
    overlap: false,
    provisional: false,
    reason: 'system',
    revision: 1,
    updated_at: index,
    deleted: false,
  };
}

function simularFusion(rows: Row[]) {
  const merged: Fila[] = [fila(rows[0]!, 0)];
  for (let index = 1; index < rows.length; index += 1) {
    const nueva: FilaNueva = fila(rows[index]!, index);
    const anterior = merged[merged.length - 1]!;
    if (!continuaLaFrase(anterior.texto, nueva.texto)) {
      merged.push(fila(rows[index]!, index));
      continue;
    }
    const union = unirRevision(anterior.texto, nueva.texto);
    merged[merged.length - 1] = {
      ...anterior,
      texto: union.texto,
      tramo: {
        ...anterior.tramo,
        fin: Math.max(anterior.tramo.fin, nueva.tramo.fin),
      },
      revision: anterior.revision + 1,
      updated_at: index,
      deleted: false,
    };
  }
  return merged;
}

describe('sesión real 6b471291 — dos voces y sin duplicados', () => {
  it('solo las dos voces largas pueden acunar hablante; los turnos cortos no', () => {
    const { speakers } = simularIdentidad(fixture.rows, 8_000);
    expect(fixture.rows).toHaveLength(17);
    expect(speakers).toBe(2);
  });

  it('un turno corto con voz nueva queda pendiente (no crea hablante)', () => {
    const corto = fixture.rows.filter(
      (row) => (row.audioEndSample - row.audioStartSample) / row.sampleRate < 12,
    );
    expect(corto.length).toBeGreaterThan(0);
    const { speakers } = simularIdentidad(corto, 8_000);
    expect(speakers).toBe(0);
  });

  it('duplicados y continuaciones se funden; no quedan filas adyacentes iguales', () => {
    const merged = simularFusion(fixture.rows);
    expect(merged.length).toBeLessThan(fixture.rows.length);
    const normalized = merged.map((row) =>
      row.texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(),
    );
    for (let i = 1; i < normalized.length; i += 1) {
      expect(normalized[i], `fila ${i} repite la anterior`).not.toBe(normalized[i - 1]);
    }
    // La frase larga de la mujer (36,3 s) conserva su texto completo.
    expect(merged.some((row) => row.texto.includes('dulces que se llaman'))).toBe(true);
  });
});
