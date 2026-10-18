/**
 * P8.40 / P9.48 — EL NOMBRE LO INTRODUCE LA VOZ (mandato del dueño 2026-10-13).
 *
 * CAMBIO DE PREMISA (declarado): este guard afirmaba antes "la VOZ NO introduce el nombre;
 * la única vía es wake + comando". El dueño invirtió esa regla: el nombre de una voz sale SOLO
 * de su VOZ (su vector/medida) y se resuelve AL MOSTRAR; la fila guarda LA VOZ, no el nombre.
 *
 * AMEND (freeze 2026-10-17, mandato del dueño): la premisa "la fila NO guarda el nombre y
 * ninguna mutación la toca" se invierte otra vez. El nombre se CONGELA EN LA FILA al identificar
 * su VOZ (freeze): la fila guarda su VOZ (`speakerId`) y su etiqueta CONGELADA (`speakerName`),
 * y NUNCA se re-resuelve desde el directorio. Motivo medido (log del dueño 2026-10-17): con el
 * repintado por directorio, la clave reutilizada `speaker_1` hacía que la mujer saliera "Luis".
 *
 * INVARIANTE NUEVO (freeze):
 *   (a) la fila guarda su VOZ (`speakerId`) y su etiqueta CONGELADA (`speakerName`);
 *   (b) la etiqueta VISIBLE se resuelve con `resolveRowSpeakerLabel` DESDE LA FILA (congelada);
 *   (c) una VOZ CON nombre registrado (medida) lo CONGELA en sus filas (la fila cambia UNA vez);
 *   (d) una VOZ DISTINTA nunca hereda el nombre de otra.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { resolveRegisteredSpeakerName } from '../src/voice/lib/speakerLabels.js';
import { useIntegrationStore } from '../src/store/integrationStore';
import { commitUserTurnRow, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow';
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow';
import { registerVoiceName, resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js';

const LUIS = { registeredLabel: 'Hablante 1', registeredName: 'Luis' };

describe('P8.40 - el vínculo etiqueta->persona del panel sigue existiendo como DATO', () => {
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
  });
});

describe('P8.40b/P9.48 - el nombre vive en la VOZ y se resuelve AL MOSTRAR', () => {
  const filas = () => useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user');
  const ultima = () => resolveRowSpeakerLabel(filas().at(-1) || {});

  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory();
    resetVoiceDirectory();
  });

  it('la fila guarda su VOZ y CONGELA la etiqueta de esa VOZ (freeze 2026-10-17)', () => {
    commitUserTurnRow({ text: 'hola hola como estan', speakerName: 'Hablante 1', turnId: 1 });
    const row = filas()[0];
    expect(String((row as { speakerId?: string })?.speakerId || ''), 'la fila lleva la VOZ').toBe('speaker_1');
    expect((row as { speakerName?: string })?.speakerName, 'y la etiqueta CONGELADA de su VOZ').toBe('Hablante 1');
  });

  it('sin nombre de esa VOZ no se adivina: etiqueta provisional', () => {
    commitUserTurnRow({
      text: 'eso fue la chica y le puso como hablante a Luis',
      speakerName: 'Hablante 1',
      registeredSpeaker: LUIS,
      evidenciaAcustica: false,
      turnId: 30,
    });
    expect(ultima()).toBe('Hablante 1');
  });

  it('la MISMA voz CON su nombre registrado (medida) lo CONGELA en la fila (freeze)', () => {
    const { id } = commitUserTurnRow({ text: 'hola hola como estan', speakerName: 'Hablante 1', turnId: 1 });
    // La medida tardía CONGELA el nombre de ESA VOZ EN SU fila (freeze 2026-10-17): la fila
    // cambia UNA vez y deja de depender del directorio.
    expect(updateTurnRowSpeaker(1, 'Luis', { evidenciaAcustica: true })).toBe(true);
    const despues = filas().find((e) => e.id === id);
    expect((despues as { speakerName?: string })?.speakerName, 'el nombre queda CONGELADO en la fila').toBe('Luis');
    expect(resolveRowSpeakerLabel(despues || {}), 'y se VE con el nombre de su voz').toBe('Luis');
  });

  it('una VOZ DISTINTA nunca hereda el nombre', () => {
    registerVoiceName('speaker_1', 'Luis');
    commitUserTurnRow({ text: 'yo soy otra persona', speakerName: 'Hablante 2', turnId: 2 });
    expect(ultima(), 'la voz 2 conserva su etiqueta').toBe('Hablante 2');
  });

  it('nombre propio introducido por el texto no se bloquea (soy luis)', () => {
    commitUserTurnRow({ text: 'okay flu soy luis', speakerName: 'Luis', evidenciaAcustica: false, turnId: 2 });
    expect(ultima()).toBe('Luis');
  });

  it('PRUEBA DE DETECTOR: sin el nombre de esa VOZ la etiqueta no cambia; con él, sí', () => {
    commitUserTurnRow({ text: 'a', speakerName: 'Hablante 1', turnId: 1 });
    const sin = resolveRowSpeakerLabel(filas()[0] || {});
    const { id } = commitUserTurnRow({ text: 'b', speakerName: 'Hablante 1', turnId: 2 });
    updateTurnRowSpeaker(2, 'Luis', { evidenciaAcustica: true });
    const con = resolveRowSpeakerLabel(filas().find((e) => e.id === id) || {});
    expect(sin, 'sin nombre de voz: etiqueta').toBe('Hablante 1');
    expect(con, 'con nombre de voz: nombre').toBe('Luis');
  });
});
