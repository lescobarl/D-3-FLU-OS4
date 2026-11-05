/**
 * relabelLateSingleWriterGuard — el reetiquetado tardio NO se persiste dos veces.
 *
 * Hallazgo 2026-11-01: el modulo escribia la fila completa (meta/evidencia/
 * timestamp) y el hook de persistencia la reescribia desde la vista parcial del
 * store (solo speakerName), dejando evidencia='pendiente'. Ahora el store marca
 * `persistSpeakerName=false` para el evento del modulo y el hook no reescribe.
 * El renombre externo sigue persistiendo.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { debePersistirEntrada } from '../src/hooks/useConversationPersistence';

const ROW_MODULO = { meta: { origin: 'conversation-module' } };

describe('reetiquetado tardio — un solo escritor', () => {
  it('el hook no persiste la vista parcial del modulo', () => {
    expect(debePersistirEntrada({ role: 'user', persistSpeakerName: false }, ROW_MODULO)).toBe(false);
  });

  it('el renombre externo y las filas ajenas al modulo si persisten', () => {
    expect(debePersistirEntrada({ role: 'user', persistSpeakerName: true }, ROW_MODULO)).toBe(true);
    expect(debePersistirEntrada({ role: 'user' }, ROW_MODULO)).toBe(true);
    expect(debePersistirEntrada({ role: 'user', persistSpeakerName: false }, { meta: { origin: 'import' } })).toBe(true);
    expect(debePersistirEntrada({ role: 'user', persistSpeakerName: false }, null)).toBe(true);
  });

  it('el emisor del modulo marca persist:false y el hook usa la compuerta', () => {
    const motor = readFileSync(join(process.cwd(), 'src/voice/compose/conversationMotorProducto.js'), 'utf8');
    const hook = readFileSync(join(process.cwd(), 'src/hooks/useConversationPersistence.ts'), 'utf8');
    expect(motor).toContain('{ resolved: true, persist: false }');
    expect(hook).toContain('debePersistirEntrada(entry, existente)');
  });
});
