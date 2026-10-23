// @vitest-environment jsdom
/**
 * transcriptEventConsumer - el consumidor de la cola de transcripcion (0%).
 *
 * POR QUE ESTE TEST: 127 lineas que son el UNICO enrutador de la cola de eventos
 * de voz hacia el ingress. Se sustituye SOLO la frontera (el modulo transcriptIngress
 * con sus tres funciones de flush) y se prueba el comportamiento real del consumidor:
 * como consume cada tipo de evento (sr-gap, recognition-end, interim, final), que hace
 * con un kind desconocido, que no revienta con payload incompleto, y la semantica de
 * drenado (drainOne / drainAll / scheduleDrain / waitForDrain) con la conversacion
 * activa o inactiva y con force.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ingresos = vi.hoisted(() => ({
  mic: vi.fn(),
  srGap: vi.fn(),
  recEnd: vi.fn(),
}));

vi.mock('../src/voice/lib/transcriptIngress.js', () => ({
  processMicConversationIngress: ingresos.mic,
  flushSrGapSegmentThroughIngress: ingresos.srGap,
  flushRecognitionEndThroughIngress: ingresos.recEnd,
}));

import { createTranscriptConsumer } from '../src/voice/lib/transcriptEventConsumer.js';

type Cola = {
  readonly length: number;
  peek: () => unknown;
  shift: () => unknown;
};

/** Cola minima con la superficie que usa el consumidor (peek/shift/length). */
function cola(eventos: unknown[]): Cola {
  const items = [...eventos];
  return {
    get length() {
      return items.length;
    },
    peek: () => items[0],
    shift: () => items.shift(),
  };
}

const activo = () => ({ conversationActive: true });

beforeEach(() => {
  ingresos.mic.mockReset();
  ingresos.srGap.mockReset();
  ingresos.recEnd.mockReset();
  ingresos.mic.mockReturnValue({ handled: true, via: 'mic' });
  ingresos.srGap.mockReturnValue({ flushed: true, via: 'sr-gap' });
  ingresos.recEnd.mockReturnValue({ flushed: true, via: 'recognition-end' });
});

describe('transcriptEventConsumer - processEvent: eventos nulos o inactivos', () => {
  it('un evento nulo o indefinido no se procesa ni toca el ingress', () => {
    const consumer = createTranscriptConsumer({ getCtx: activo });

    expect(consumer.processEvent(null)).toEqual({ handled: false });
    expect(consumer.processEvent(undefined)).toEqual({ handled: false });

    expect(ingresos.mic).not.toHaveBeenCalled();
    expect(ingresos.srGap).not.toHaveBeenCalled();
    expect(ingresos.recEnd).not.toHaveBeenCalled();
  });

  it('conversacion inactiva o sin getCtx: se salta sin llamar al ingress', () => {
    const inactivo = createTranscriptConsumer({ getCtx: () => ({ conversationActive: false }) });
    expect(inactivo.processEvent({ kind: 'interim', text: 'hola' })).toEqual({
      handled: false,
      skipped: true,
    });

    const sinCtx = createTranscriptConsumer({});
    expect(sinCtx.processEvent({ kind: 'final', text: 'hola' })).toEqual({
      handled: false,
      skipped: true,
    });

    expect(ingresos.mic).not.toHaveBeenCalled();
  });

  it('force procesa el evento aunque la conversacion este inactiva', () => {
    const ctx = { conversationActive: false };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    const resultado = consumer.processEvent({ kind: 'interim', text: 'hola' }, { force: true });

    expect(resultado).toEqual({ handled: true, via: 'mic' });
    expect(ingresos.mic).toHaveBeenCalledWith({ interimChunks: ['hola'], finalChunks: [], ctx });
  });
});

describe('transcriptEventConsumer - processEvent: enrutado por tipo', () => {
  it('sr-gap enruta al flush de hueco con sinceLastResultMs y el ctx', () => {
    const ctx = { conversationActive: true, marca: 'sr' };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    const resultado = consumer.processEvent({ kind: 'sr-gap', sinceLastResultMs: 1500 });

    // El MOTIVO viaja con el evento (contrato 2026-10-22): el cierre por cambio de hablante
    // no puede perderse. Sin motivo, el evento llega con reason vacio.
    expect(ingresos.srGap).toHaveBeenCalledWith(ctx, { sinceLastResultMs: 1500, reason: '' });
    expect(ingresos.mic).not.toHaveBeenCalled();
    expect(ingresos.recEnd).not.toHaveBeenCalled();
    expect(resultado).toEqual({ flushed: true, via: 'sr-gap' });
  });

  it('recognition-end enruta al flush de fin de reconocimiento', () => {
    const ctx = { conversationActive: true, marca: 'end' };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    const resultado = consumer.processEvent({ kind: 'recognition-end' });

    expect(ingresos.recEnd).toHaveBeenCalledWith(ctx);
    expect(ingresos.mic).not.toHaveBeenCalled();
    expect(resultado).toEqual({ flushed: true, via: 'recognition-end' });
  });

  it('kind interim con text: el texto viaja como interimChunks al ingress', () => {
    const ctx = { conversationActive: true };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    consumer.processEvent({ kind: 'interim', text: 'casa' });

    expect(ingresos.mic).toHaveBeenCalledWith({ interimChunks: ['casa'], finalChunks: [], ctx });
  });

  it('kind final con text: el texto viaja como finalChunks al ingress', () => {
    const ctx = { conversationActive: true };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    consumer.processEvent({ kind: 'final', text: 'casa' });

    expect(ingresos.mic).toHaveBeenCalledWith({ interimChunks: [], finalChunks: ['casa'], ctx });
  });

  it('los chunks explicitos mandan sobre kind y text', () => {
    const ctx = { conversationActive: true };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    consumer.processEvent({ kind: 'final', text: 'x', interimChunks: ['i'], finalChunks: ['f'] });

    expect(ingresos.mic).toHaveBeenCalledWith({ interimChunks: ['i'], finalChunks: ['f'], ctx });
  });
});

describe('transcriptEventConsumer - processEvent: casos degenerados', () => {
  it('un kind desconocido cae al ingress de mic con listas vacias', () => {
    const ctx = { conversationActive: true };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    consumer.processEvent({ kind: 'raro' });

    expect(ingresos.mic).toHaveBeenCalledWith({ interimChunks: [], finalChunks: [], ctx });
    expect(ingresos.srGap).not.toHaveBeenCalled();
    expect(ingresos.recEnd).not.toHaveBeenCalled();
  });

  it('payload incompleto no revienta: objeto vacio e interim sin texto', () => {
    const ctx = { conversationActive: true };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    expect(() => consumer.processEvent({})).not.toThrow();
    expect(() => consumer.processEvent({ kind: 'interim' })).not.toThrow();

    expect(ingresos.mic).toHaveBeenNthCalledWith(1, {
      interimChunks: [],
      finalChunks: [],
      ctx,
    });
    expect(ingresos.mic).toHaveBeenNthCalledWith(2, {
      interimChunks: [],
      finalChunks: [],
      ctx,
    });
  });
});

describe('transcriptEventConsumer - drenado de la cola', () => {
  it('drainOne: vacia devuelve false; inactivo no saca nada; activo procesa y avisa', () => {
    const onAfterEvent = vi.fn();
    const ctx = { conversationActive: true };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx, onAfterEvent });

    expect(consumer.drainOne(cola([]))).toBe(false);
    expect(ingresos.mic).not.toHaveBeenCalled();

    const inactivo = createTranscriptConsumer({ getCtx: () => ({ conversationActive: false }) });
    const colaInactiva = cola([{ kind: 'interim', text: 'hola' }]);
    expect(inactivo.drainOne(colaInactiva)).toBe(false);
    expect(colaInactiva.length).toBe(1);
    expect(ingresos.mic).not.toHaveBeenCalled();

    const evento = { kind: 'interim', text: 'hola' };
    const colaActiva = cola([evento]);
    expect(consumer.drainOne(colaActiva)).toBe(true);
    expect(colaActiva.length).toBe(0);
    expect(onAfterEvent).toHaveBeenCalledWith(evento, { handled: true, via: 'mic' });
  });

  it('drainAll vacia la cola activa y cuenta; con inactiva no consume nada', () => {
    const ctx = { conversationActive: true };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });
    const llena = cola([
      { kind: 'interim', text: 'a' },
      { kind: 'final', text: 'b' },
    ]);

    expect(consumer.drainAll(llena)).toBe(2);
    expect(llena.length).toBe(0);
    expect(ingresos.mic).toHaveBeenCalledTimes(2);

    const inactivo = createTranscriptConsumer({ getCtx: () => ({ conversationActive: false }) });
    const intacta = cola([{ kind: 'interim', text: 'a' }]);
    expect(inactivo.drainAll(intacta)).toBe(0);
    expect(intacta.length).toBe(1);
    expect(ingresos.mic).toHaveBeenCalledTimes(2);
  });

  it('scheduleDrain vacia por microtareas y devuelve isDraining a false', async () => {
    const ctx = { conversationActive: true };
    const consumer = createTranscriptConsumer({ getCtx: () => ctx });

    consumer.scheduleDrain(cola([]));
    expect(consumer.isDraining).toBe(false);

    const pendiente = cola([
      { kind: 'interim', text: 'a' },
      { kind: 'final', text: 'b' },
    ]);
    consumer.scheduleDrain(pendiente);
    expect(consumer.isDraining).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pendiente.length).toBe(0);
    expect(consumer.isDraining).toBe(false);
    expect(ingresos.mic).toHaveBeenCalledTimes(2);
  });

  it('waitForDrain drena y devuelve 0; con cola atascada fuerza el ultimo pase', async () => {
    const ctx = { conversationActive: true };
    const activoConsumer = createTranscriptConsumer({ getCtx: () => ctx });
    const normal = cola([{ kind: 'interim', text: 'a' }]);

    await expect(activoConsumer.waitForDrain(normal)).resolves.toBe(0);
    expect(normal.length).toBe(0);

    const inactivo = createTranscriptConsumer({ getCtx: () => ({ conversationActive: false }) });
    const atascada = cola([{ kind: 'interim', text: 'a' }]);

    await expect(inactivo.waitForDrain(atascada, { timeoutMs: 1 })).resolves.toBe(0);
    expect(atascada.length).toBe(0);
    expect(ingresos.mic).toHaveBeenCalledWith({
      interimChunks: ['a'],
      finalChunks: [],
      ctx: { conversationActive: false },
    });
  });
});
