/**
 * turnSnapshotFromFilaGuard — el grabador usa el tramo/firma CANONICOS.
 *
 * Hallazgo 2026-11-01: el hook grababa con su buffer circular; pasado el tope,
 * los turnos salian `audioStartSample == audioEndSample`, `tramoValido:false`
 * y `signature:null`. `snapshotDeTurno` toma `fila.tramo`/`fila.firma`; el
 * buffer solo es respaldo. La medida tardia emite `revision:true` para que el
 * snapshot final tenga la firma.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotDeTurno } from '../src/voice/conversation/turnSnapshot';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('grabador — tramo y firma canonicos de la fila', () => {
  it('usa fila.tramo/fila.firma y no el buffer', () => {
    const snapshot = snapshotDeTurno(
      { tramo: { inicio: 1440000, fin: 1500000, sampleRate: 48000 }, firma: [1, 0, 0] },
      { audioStartSample: 0, audioEndSample: 0, tramoValido: false, signature: null, sampleRate: 16000 },
    );
    expect(snapshot).toEqual({
      audioStartSample: 1440000,
      audioEndSample: 1500000,
      tramoValido: true,
      sampleRate: 48000,
      signature: [1, 0, 0],
    });
  });

  it('sin tramo valido cae al respaldo, pero la firma de la fila gana', () => {
    const sinTramo = snapshotDeTurno(
      { firma: [2, 3] },
      { audioStartSample: 10, audioEndSample: 20, tramoValido: true, signature: [9], sampleRate: 16000 },
    );
    expect(sinTramo.audioStartSample).toBe(10);
    expect(sinTramo.signature).toEqual([2, 3]);

    const invalido = snapshotDeTurno(
      { tramo: { inicio: 100, fin: 100, sampleRate: 48000 } },
      { audioStartSample: 1, audioEndSample: 2, tramoValido: true, signature: [9], sampleRate: 16000 },
    );
    expect(invalido.tramoValido).toBe(true);
    expect(invalido.audioStartSample).toBe(1);
    expect(invalido.signature).toEqual([9]);
  });

  it('el hook, el cierre y el motor estan cableados', () => {
    const hook = source('src/voice/hooks/useFluVoiceAssistant.js');
    expect(hook).toContain('grabarSnapshotDeTurno(fila');
    expect(hook).toContain('sessionLocutionsRecordedRef');
    const cierre = source('src/voice/conversation/cierre.ts');
    expect(cierre).toContain('fila: actualizada');
    expect(cierre).toContain('revision: true');
    const motor = source('src/voice/compose/conversationMotorProducto.js');
    expect(motor).toContain('grabarRevisionDeFila');
    expect(motor).toContain('evento.fila.revision');
  });

  it('el detector no es decorativo', () => {
    const vacio = snapshotDeTurno(null, {});
    expect(vacio.tramoValido).toBe(false);
    expect(vacio.audioEndSample).toBe(0);
  });
});
