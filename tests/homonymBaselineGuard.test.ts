/**
 * homonymBaselineGuard — congela los homónimos legítimos y falla con uno nuevo.
 *
 * La auditoría de código reportó 8 funciones con el mismo nombre en ficheros
 * distintos. Se leyeron todas: 2 tenían contrato distinto y se renombraron
 * (`pickLabel` de selfKnowledge y `cleanLabel` de shopping/deviceActions);
 * `downloadBlob` se unificó en su dueño. Quedan 5 homónimos de dominios
 * distintos, que NO se unifican (AGENTS 6.6: similitud de forma).
 *
 * El test es un trinquete: si aparece un nombre nuevo se ve aquí; si una
 * entrada de la lista desaparece, también falla para que se recorte la base.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { homonymFunctions } from '../scripts/auditoria-codigo.mjs';
import { readSources } from '../scripts/fsScan.mjs';

/** Homónimos revisados: mismo nombre en dominios distintos, contratos distintos. */
export const ALLOWED_HOMONYMS = new Set([
  'runMainThreadFallback',
  'sourceLabel',
  'toUI',
  'flush',
  'resetTurn',
]);

export function unexpectedHomonyms(sources: Parameters<typeof homonymFunctions>[0]): {
  unexpected: string[];
  stale: string[];
} {
  const names = homonymFunctions(sources).map((entry) => entry.name);
  return {
    unexpected: names.filter((name) => !ALLOWED_HOMONYMS.has(name)),
    stale: [...ALLOWED_HOMONYMS].filter((name) => !names.includes(name)),
  };
}

describe('homónimos — base congelada y sin casos nuevos', () => {
  it('no hay homónimos nuevos ni entradas muertas en la base', () => {
    const { unexpected, stale } = unexpectedHomonyms(readSources('src'));
    expect(unexpected, 'homónimos nuevos (revisar contrato): ' + unexpected.join(', ')).toEqual([]);
    expect(stale, 'homónimos de la base que ya no existen: ' + stale.join(', ')).toEqual([]);
  });

  it('el detector no es decorativo', () => {
    const synthetic = [
      { file: 'src/a.ts', source: 'function probe() {}\n' },
      { file: 'src/b.ts', source: 'function probe() {}\n' },
    ];
    expect(unexpectedHomonyms(synthetic).unexpected).toEqual(['probe']);
  });
});
