/**
 * conversationRealVoiceThresholdGuard — el piso se mide con el WAV real.
 *
 * Sesión 6c71d867 (174,7 s, 48 kHz): 71 ventanas de 4 s con voz, modelo
 * Xenova/wavlm-base-plus-sv. A 0.66 las dos voces forman UN cluster (se
 * mezclan hombre/mujer); a 0.72 se separan en DOS. El fixture guarda cuatro
 * vectores reales (dos de cada voz) con un puente de 0.708.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Fixture {
  vectors: number[][];
  expected: { mergedAt: number; splitAt: number };
}

const fixture: Fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/realVoiceVectors.json'), 'utf8'),
);

function cosine(a: number[], b: number[]): number | null {
  if (a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : null;
}

function clusterCount(vectors: number[][], threshold: number): number {
  const parent = vectors.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const c = cosine(vectors[i]!, vectors[j]!);
      if (c !== null && c >= threshold) union(i, j);
    }
  }
  return new Set(vectors.map((_, i) => find(i))).size;
}

describe('voces reales del WAV — el piso 0.72 separa, 0.66 mezcla', () => {
  it('el fixture tiene 4 vectores reales y reproduce los dos lados', () => {
    expect(fixture.vectors).toHaveLength(4);
    expect(clusterCount(fixture.vectors, fixture.expected.mergedAt)).toBe(1);
    expect(clusterCount(fixture.vectors, fixture.expected.splitAt)).toBe(2);
  });

  it('el detector no es decorativo: un umbral imposible deja 4', () => {
    expect(clusterCount(fixture.vectors, 0.99)).toBe(4);
  });
});
