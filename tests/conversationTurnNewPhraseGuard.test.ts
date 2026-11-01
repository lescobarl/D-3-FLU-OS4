/**
 * conversationTurnNewPhraseGuard — una frase NUEVA del mismo turno no se pierde.
 *
 * Hallazgo 2026-11-01: la puerta `turnoYaEscrito` descartaba cualquier locucion
 * con el mismo turnId y sin voz distinta, aunque el texto fuera una frase nueva.
 * Ahora solo descarta reentrega: texto igual o revision/continuacion
 * (`continuaLaFrase`). Una frase nueva escribe su fila.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { esReentregaDeTurno } from '../src/voice/conversation/cierre';

describe('turnoYaEscrito — solo reentrega', () => {
  it('texto igual o revision del mismo enunciado es reentrega', () => {
    expect(esReentregaDeTurno('hola', 'hola')).toBe(true);
    expect(
      esReentregaDeTurno('con el doctor a las tres', 'con el doctor a las tres de la tarde'),
    ).toBe(true);
  });

  it('una frase NUEVA del mismo turno NO es reentrega', () => {
    expect(esReentregaDeTurno('hola', 'otra cosa distinta')).toBe(false);
    expect(esReentregaDeTurno('', 'hola')).toBe(false);
    expect(esReentregaDeTurno('hola', '')).toBe(false);
  });

  it('la puerta de cierre exige reentrega ademas de la voz', () => {
    const src = readFileSync(join(process.cwd(), 'src/voice/conversation/cierre.ts'), 'utf8');
    expect(src).toContain('esReentregaDeTurno(previaDelTurno.texto, cierre.texto)');
    expect(src).toContain('if (previaDelTurno && !vozDistintaMedida && esReentrega)');
  });
});
