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
import { describe, expect, it, beforeEach } from 'vitest';
import { resolveRegisteredSpeakerName } from '../src/voice/lib/speakerLabels.js';
import { useIntegrationStore } from '../src/store/integrationStore';
import { commitUserTurnRow, resetSpeakerAliases, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow';

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

/**
 * P8.40b — REGLA DEL DUENO (2026-10-08): el NOMBRE pertenece a la VOZ.
 *
 * `resolveRegisteredSpeakerName` mapea etiqueta->persona, pero CUANDO se estampa lo
 * decide el escritor unico de la fila (`commitUserTurnRow`). Una etiqueta AUTOMATICA
 * (o su nombre registrado/alias) SOLO entra con EVIDENCIA acustica: sin ella la fila
 * queda SIN hablante (la completa la resolucion tardia por identidad de turno). Asi
 * una voz distinta NO hereda el nombre de otra (el defecto "mujer x con Luis", ruta
 * doble del nombre medida: se mapeaba en App.tsx Y en conversationStreamCommit.js).
 * Un nombre propio INTRODUCIDO por el texto ("soy Luis") no es automatico y pasa.
 */
const LUIS_REG = { registeredLabel: 'Hablante 1', registeredName: 'Luis' };
const lastRowSpeaker = () => {
  const rows = useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user');
  return String(rows.at(-1)?.speakerName ?? '');
};

describe('P8.40b - el nombre se estampa CON evidencia (dueno unico de la fila)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory();
    resetSpeakerAliases();
  });

  it('etiqueta registrada SIN evidencia -> fila sin hablante (no hereda el nombre)', () => {
    commitUserTurnRow({
      text: 'eso fue la chica y le puso como hablante a Luis',
      speakerName: 'Hablante 1',
      registeredSpeaker: LUIS_REG,
      evidenciaAcustica: false,
      turnId: 30,
    });
    expect(lastRowSpeaker()).toBe('');
  });

  it('la MISMA etiqueta CON evidencia -> nombre de la persona', () => {
    commitUserTurnRow({
      text: 'hola hola como estan',
      speakerName: 'Hablante 1',
      registeredSpeaker: LUIS_REG,
      evidenciaAcustica: true,
      turnId: 1,
    });
    expect(lastRowSpeaker()).toBe('Luis');
  });

  it('nombre propio introducido por el texto no se bloquea (soy luis)', () => {
    commitUserTurnRow({ text: 'okay flu soy luis', speakerName: 'Luis', evidenciaAcustica: false, turnId: 2 });
    expect(lastRowSpeaker()).toBe('Luis');
  });

  it('PRUEBA DE DETECTOR: la misma etiqueta cambia de veredicto solo por la evidencia', () => {
    useIntegrationStore.getState().resetConversationHistory();
    commitUserTurnRow({ text: 'a', speakerName: 'Hablante 1', registeredSpeaker: LUIS_REG, evidenciaAcustica: false, turnId: 1 });
    const sin = lastRowSpeaker();
    commitUserTurnRow({ text: 'b', speakerName: 'Hablante 1', registeredSpeaker: LUIS_REG, evidenciaAcustica: true, turnId: 2 });
    const con = lastRowSpeaker();
    expect(con).not.toBe(sin);
    expect(sin).toBe('');
    expect(con).toBe('Luis');
  });
});

// P9.48 - la RESOLUCION TARDIA (`updateTurnRowSpeaker`) usa el MISMO dueno que el
// commit (`resolveRowSpeakerName`): tambien mapea etiqueta->nombre registrado. Antes
// usaba `resolveSpeakerAlias` a secas (ruta doble del nombre), asi que la fila que
// rellenaba esa via salia "Hablante N" aunque la persona estuviera registrada.
describe('P9.48 - la resolucion tardia aplica el nombre registrado (un solo dueno)', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined });
    resetSpeakerAliases();
  });

  it('updateTurnRowSpeaker mapea la etiqueta registrada al NOMBRE', () => {
    const { id } = commitUserTurnRow({ text: 'hola soy luis', turnId: 11 });
    updateTurnRowSpeaker(11, 'Hablante 1', { evidenciaAcustica: true, registeredSpeaker: LUIS });
    const row = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id);
    expect(row?.speakerName).toBe('Luis');
  });

  it('sin evidencia acustica NO inventa el nombre (etiqueta automatica)', () => {
    const { id } = commitUserTurnRow({ text: 'hola', turnId: 12 });
    updateTurnRowSpeaker(12, 'Hablante 1', { evidenciaAcustica: false, registeredSpeaker: LUIS });
    const row = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id);
    expect(String(row?.speakerName || '')).toBe('');
  });

  it('PRUEBA DE DETECTOR: con el vinculo renombra; con otro registro, no', () => {
    const { id } = commitUserTurnRow({ text: 'x', turnId: 13 });
    updateTurnRowSpeaker(13, 'Hablante 1', { evidenciaAcustica: true, registeredSpeaker: { registeredLabel: 'Hablante 9', registeredName: 'Luis' } });
    const row = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id);
    expect(row?.speakerName).not.toBe('Luis');
  });
});
