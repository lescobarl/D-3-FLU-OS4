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

describe('recorte de turnos previos del interino — fuente única', () => {
  it('existe un solo bucle de recorte en el módulo (ignorando comentarios)', () => {
    const body = fs
      .readFileSync(SRC, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const matches = body.match(/while \(chunk !== prev && passes < 12\)/g) || [];
    expect(matches.length).toBe(1);
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
