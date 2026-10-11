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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRegisteredSpeakerName } from '../src/voice/lib/speakerLabels.js';
import { useIntegrationStore } from '../src/store/integrationStore';
import { commitUserTurnRow, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow';

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

describe('P8.40b - UNA via de introduccion del nombre: wake + comando (la VOZ no lo introduce)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory();
  });

  it('etiqueta registrada SIN evidencia -> respaldo (no hereda el nombre)', () => {
    commitUserTurnRow({
      text: 'eso fue la chica y le puso como hablante a Luis',
      speakerName: 'Hablante 1',
      registeredSpeaker: LUIS_REG,
      evidenciaAcustica: false,
      turnId: 30,
    });
    // A5: sin evidencia NO se inventa el nombre (no sale 'Luis'), pero la fila nunca queda vacia.
    expect(lastRowSpeaker()).toBe('Hablante 1');
  });

  it('la MISMA etiqueta CON evidencia SIGUE siendo la etiqueta (la voz no introduce el nombre)', () => {
    // SPEC DEL DUENO (2026-10-11): la evidencia de VOZ solo CONFIRMA un nombre ya introducido
    // (wake + comando); nunca lo introduce. Antes esto ascendia 'Hablante 1' -> 'Luis'.
    commitUserTurnRow({
      text: 'hola hola como estan',
      speakerName: 'Hablante 1',
      registeredSpeaker: LUIS_REG,
      evidenciaAcustica: true,
      turnId: 1,
    });
    expect(lastRowSpeaker()).toBe('Hablante 1');
  });

  it('nombre propio introducido por el texto no se bloquea (soy luis)', () => {
    commitUserTurnRow({ text: 'okay flu soy luis', speakerName: 'Luis', evidenciaAcustica: false, turnId: 2 });
    expect(lastRowSpeaker()).toBe('Luis');
  });

  it('PRUEBA DE DETECTOR: la etiqueta NO cambia por la evidencia (no hay ascenso por voz)', () => {
    useIntegrationStore.getState().resetConversationHistory();
    commitUserTurnRow({ text: 'a', speakerName: 'Hablante 1', registeredSpeaker: LUIS_REG, evidenciaAcustica: false, turnId: 1 });
    const sin = lastRowSpeaker();
    commitUserTurnRow({ text: 'b', speakerName: 'Hablante 1', registeredSpeaker: LUIS_REG, evidenciaAcustica: true, turnId: 2 });
    const con = lastRowSpeaker();
    expect(con, 'la evidencia no asciende').toBe(sin);
    expect(sin).toBe('Hablante 1');
    expect(con).toBe('Hablante 1');
  });
});

// P9.48 - la RESOLUCION TARDIA (`updateTurnRowSpeaker`) usa el MISMO dueno que el
// commit (`resolveRowSpeakerName`): tambien mapea etiqueta->nombre registrado. Antes
// usaba `resolveSpeakerAlias` a secas (ruta doble del nombre), asi que la fila que
// rellenaba esa via salia "Hablante N" aunque la persona estuviera registrada.
describe('P9.48 - la resolucion tardia NO introduce el nombre (la via es el comando)', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined });
  });

  it('updateTurnRowSpeaker CON evidencia deja la etiqueta (no asciende al nombre)', () => {
    const { id } = commitUserTurnRow({ text: 'hola soy luis', turnId: 11 });
    updateTurnRowSpeaker(11, 'Hablante 1', { evidenciaAcustica: true, registeredSpeaker: LUIS });
    const row = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id);
    // La via del nombre es el TEXTO del comando, que la aporta el stream como `speakerName`;
    // esta capa NO lo inventa: la etiqueta se queda.
    expect(row?.speakerName).toBe('Hablante 1');
    // Y una fila sin introduccion tampoco asciende con evidencia.
    const otra = commitUserTurnRow({ text: 'hola a todos', speakerName: 'Hablante 1', turnId: 14 });
    updateTurnRowSpeaker(14, 'Hablante 1', { evidenciaAcustica: true, registeredSpeaker: LUIS });
    const row2 = useIntegrationStore.getState().conversationHistory.find((e) => e.id === otra.id);
    expect(row2?.speakerName).toBe('Hablante 1');
  });

  it('sin evidencia acustica NO inventa el nombre (etiqueta automatica)', () => {
    const { id } = commitUserTurnRow({ text: 'hola', turnId: 12 });
    updateTurnRowSpeaker(12, 'Hablante 1', { evidenciaAcustica: false, registeredSpeaker: LUIS });
    const row = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id);
    expect(String(row?.speakerName || '')).toBe('Hablante 1');
  });

  it('PRUEBA DE DETECTOR: el vinculo del panel no renombra por si solo', () => {
    const { id } = commitUserTurnRow({ text: 'x', turnId: 13 });
    updateTurnRowSpeaker(13, 'Hablante 1', { evidenciaAcustica: true, registeredSpeaker: { registeredLabel: 'Hablante 9', registeredName: 'Luis' } });
    const row = useIntegrationStore.getState().conversationHistory.find((e) => e.id === id);
    expect(row?.speakerName).not.toBe('Luis');
  });
});

// P9.48b - el HOOK cablea el vinculo del participante a la via tardia: `applyResolvedSpeaker`
// pasa `registeredSpeaker` a `updateTurnRowSpeaker` (antes NO lo pasaba -> la via tardia no
// podia mapear la etiqueta registrada al nombre). Guard de TEXTO sobre el unico escritor del hook.
describe('P9.48b - el hook cablea el vinculo del participante a la via tardia', () => {
  const hookSrc = () => readFileSync(join(process.cwd(), 'src', 'voice', 'hooks', 'useFluVoiceAssistant.js'), 'utf8');

  it('applyResolvedSpeaker pasa registeredSpeaker a updateTurnRowSpeaker', () => {
    expect(hookSrc()).toMatch(/updateTurnRowSpeaker\(turnId, speakerName, \{[^}]*registeredSpeaker: participantSpeakerRef\.current/);
  });

  it('PRUEBA DE DETECTOR: sin el vinculo, la marca no casa', () => {
    const sinVinculo =
      'updateTurnRowSpeaker(turnId, speakerName, { evidenciaAcustica: Boolean(workingClusters?.length) })';
    expect(/registeredSpeaker: participantSpeakerRef\.current/.test(sinVinculo)).toBe(false);
    expect(/registeredSpeaker: participantSpeakerRef\.current/.test('registeredSpeaker: participantSpeakerRef.current')).toBe(true);
  });
});
