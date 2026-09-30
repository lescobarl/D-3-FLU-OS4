/**
 * Guard + comportamiento del recorte de turnos previos del interino (C8).
 * Fuente única: `stripRecentClosedTurnsFromInterim` contiene el bucle;
 * `stripPriorTurnsFromInterim` y `stripLastClosedTurnFromInterim` delegan.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  stripPriorTurnsFromInterim,
  stripRecentClosedTurnsFromInterim,
  stripLastClosedTurnFromInterim,
} from '../src/voice/lib/conversationStream.js';

const SRC = path.resolve(__dirname, '../src/voice/lib/conversationStream.js');

/** Bucles de recorte en un fuente, ignorando comentarios (mismo criterio del guard). */
export function stripLoopCount(src: string): number {
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return (body.match(/while \(chunk !== prev && passes < 12\)/g) || []).length;
}

describe('recorte de turnos previos del interino — fuente única', () => {
  it('existe un solo bucle de recorte en el módulo (ignorando comentarios)', () => {
    expect(stripLoopCount(fs.readFileSync(SRC, 'utf-8'))).toBe(1);
  });

  it('stripPriorTurnsFromInterim equivale a recortar con todos los turnos', () => {
    const priors = ['hola que tal', 'buenos dias', 'hola que tal como estas'];
    const interim = 'hola que tal buenos dias hola que tal como estas algo nuevo';
    expect(stripPriorTurnsFromInterim(interim, priors)).toBe(
      stripRecentClosedTurnsFromInterim(interim, priors, priors.length),
    );
  });

  it('stripLastClosedTurnFromInterim usa solo el último turno cerrado', () => {
    expect(stripLastClosedTurnFromInterim('eco anterior resto', ['eco anterior'])).toBe('resto');
  });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('recorte de turnos previos - el detector no es decorativo', () => {
  it('marca el bucle real y no el comentado', () => {
    expect(stripLoopCount('while (chunk !== prev && passes < 12) {}')).toBe(1)
    expect(stripLoopCount('// while (chunk !== prev && passes < 12) {}')).toBe(0)
    expect(stripLoopCount('const a = 1')).toBe(0)
  })
})