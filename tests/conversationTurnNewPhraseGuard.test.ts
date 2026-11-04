/**
 * conversationTurnNewPhraseGuard — una frase NUEVA del mismo turno no se pierde.
 *
 * Hallazgo 2026-11-01: la puerta `turnoYaEscrito` descartaba cualquier locucion
 * con el mismo turnId y sin voz distinta, aunque el texto fuera una frase nueva.
 * Regla vigente: solo se descarta la REENTREGA del mismo tramo
 * (`tramoYaCommiteado`) y la comparacion de texto es `continuaLaFrase`; una
 * frase nueva escribe su fila. `filaDelTurno`/`esReentregaDeTurno` se retiraron
 * con la ruta doble.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { continuaLaFrase } from '../src/voice/core/locucion.js';

describe('turnoYaEscrito — solo reentrega', () => {
  it('texto igual o revision del mismo enunciado es reentrega', () => {
    expect(continuaLaFrase('hola', 'hola')).toBe(true);
    expect(
      continuaLaFrase('con el doctor a las tres', 'con el doctor a las tres de la tarde'),
    ).toBe(true);
  });

  it('una frase NUEVA del mismo turno NO es reentrega', () => {
    expect(continuaLaFrase('hola', 'otra cosa distinta')).toBe(false);
    expect(continuaLaFrase('', 'hola')).toBe(false);
    expect(continuaLaFrase('hola', '')).toBe(false);
  });

  it('la puerta de cierre es por TRAMO, no por turno ni por prefijo de texto', () => {
    const cierre = readFileSync(join(process.cwd(), 'src/voice/conversation/cierre.ts'), 'utf8');
    const texto = readFileSync(join(process.cwd(), 'src/voice/conversation/texto.ts'), 'utf8');
    const ingesta = readFileSync(join(process.cwd(), 'src/voice/conversation/ingesta.ts'), 'utf8');
    expect(cierre).toContain('tramoYaCommiteado');
    // La reentrega se decide en la INGESTA (dueño del ASR): un tramo commiteado
    // solo descarta si el texto continúa/repite la fila; una frase nueva abre.
    expect(ingesta).toContain('estado.filas.has(tramoId)');
    expect(texto).not.toContain('tramoYaCommiteado');
    expect(cierre).not.toContain('filaDelTurno(');
    // El descarte por texto-prefijo se retiró: una frase nueva del mismo turno
    // no puede perderse. Solo se descarta la reentrega que CONTINÚA la frase.
    expect(ingesta).toContain('continuaLaFrase(previa.texto, textoEntrante)');
    expect(ingesta).not.toContain('previo.includes(nuevo)');
  });
});
