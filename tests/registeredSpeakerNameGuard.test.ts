/**
 * P8.40 - La etiqueta de diarizacion registrada estampa el NOMBRE de la persona.
 *
 * MEDIDO (prueba de escritorio con micro falso + participante "Luis" registrado y
 * activo con speakerLabel 'Hablante 1'): la fila del turno salia "Hablante 1". El
 * vinculo etiqueta->persona YA existia como dato (panel de participantes, A3) y solo
 * lo consumia el camino de JUEGOS (App: resolveParticipantBySpeakerLabel), no la
 * fila. El criterio ahora vive en UN solo sitio (speakerLabels) y lo consume la
 * puerta unica de la fila.
 *
 * INVARIANTE: (a) una etiqueta AUTOMATICA que coincide con la registrada -> NOMBRE;
 * (b) un nombre propio ya resuelto NUNCA se pisa; (c) una etiqueta no registrada
 * (los ninos del aula) queda como esta; (d) sin registro, '' (no inventa identidad).
 */
import { describe, expect, it } from 'vitest';
import { resolveRegisteredSpeakerName } from '../src/voice/lib/speakerLabels.js';

const LUIS = { registeredLabel: 'Hablante 1', registeredName: 'Luis' };

describe('P8.40 - etiqueta de diarizacion registrada -> nombre de la persona', () => {
  it('la etiqueta automatica registrada estampa el nombre (el caso medido)', () => {
    expect(resolveRegisteredSpeakerName('Hablante 1', LUIS)).toBe('Luis');
  });

  it('otra etiqueta automatica (otro hablante del aula) NO se renombra', () => {
    expect(resolveRegisteredSpeakerName('Hablante 2', LUIS)).toBe('');
    expect(resolveRegisteredSpeakerName('Hablante 3', LUIS)).toBe('');
  });

  it('un nombre propio ya resuelto nunca se pisa', () => {
    expect(resolveRegisteredSpeakerName('Ana', { registeredLabel: 'Hablante 1', registeredName: 'Luis' })).toBe('');
    expect(resolveRegisteredSpeakerName('Luis', LUIS)).toBe('');
  });

  it('sin registro o sin match, cadena vacia (no inventa identidad)', () => {
    expect(resolveRegisteredSpeakerName('Hablante 1', {})).toBe('');
    expect(resolveRegisteredSpeakerName('', LUIS)).toBe('');
    expect(resolveRegisteredSpeakerName('Hablante 1', { registeredLabel: 'Hablante 2', registeredName: 'Luis' })).toBe('');
  });
});

// P2.4 - prueba de detector: el mismo par cambia de veredicto segun el registro.
describe('P8.40 - el detector no es decorativo', () => {
  it('con el vinculo registrado renombra; sin el, no', () => {
    expect(resolveRegisteredSpeakerName('Hablante 1', LUIS)).toBe('Luis');
    expect(resolveRegisteredSpeakerName('Hablante 1', { registeredLabel: 'Hablante 9', registeredName: 'Luis' })).toBe('');
    expect(resolveRegisteredSpeakerName('Hablante 1', { registeredLabel: 'Hablante 1', registeredName: '' })).toBe('');
  });
});
