/**
 * captureDedup - la MISMA emision reentregada por el ASR no es un turno nuevo.
 *
 * GUARD DE CONDUCTA (AGENTS 0.12): se EJECUTA el criterio real que usa
 * `processCapture` (`shouldSkipCapture`), no un conteo por nombre.
 *
 * DEFECTO MEDIDO (2026-10-03, prueba de escritorio con micro falso por el mismo
 * camino que Chrome): una locucion + su reentrega 500 ms despues -> 3 filas de
 * usuario y 2 ejecuciones, porque el dedup por captura identica se desactivaba
 * ENTERO mientras habia un turno en curso (`correctionInFlight`), que es justo
 * cuando llega la reentrega.
 *
 * INVARIANTE: identica dentro de la ventana de "misma peticion" -> se descarta
 * (siempre, haya turno en curso o no); la correccion viva (superconjunto) sigue
 * sin descartarse; una repeticion FUERA de la ventana es turno nuevo.
 */
import { describe, expect, it } from 'vitest';
import { shouldSkipCapture } from '../src/voice/lib/captureDedup.js';
import { sameRequestWindowMs } from '../src/voice/lib/audioMath.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const FRASE = 'Okay Flow dame una imagen';

describe('captureDedup - la reentrega identica no es un turno nuevo', () => {
  it('identica dentro de la ventana CON un turno en curso: se descarta (el defecto medido)', () => {
    expect(
      shouldSkipCapture({
        prevText: FRASE,
        prevAt: 1000,
        nextText: FRASE,
        nowMs: 1500,
        correctionInFlight: true,
      }),
    ).toBe('duplicate');
  });

  it('identica dentro de la ventana sin turno en curso: se descarta igual', () => {
    expect(
      shouldSkipCapture({
        prevText: FRASE,
        prevAt: 1000,
        nextText: FRASE,
        nowMs: 1500,
        correctionInFlight: false,
      }),
    ).toBe('duplicate');
  });

  it('identica FUERA de la ventana: turno nuevo (el usuario repite)', () => {
    const fuera = sameRequestWindowMs() + 1000;
    expect(
      shouldSkipCapture({
        prevText: FRASE,
        prevAt: 1000,
        nextText: FRASE,
        nowMs: 1000 + fuera,
        correctionInFlight: false,
      }),
    ).toBe(null);
  });

  it('correccion viva (crece) sin turno en curso: tampoco se descarta por superconjunto', () => {
    expect(
      shouldSkipCapture({
        prevText: 'hola como estas',
        prevAt: 1000,
        nextText: 'hola como estas hoy',
        nowMs: 1500,
        correctionInFlight: false,
      }),
    ).toBe(null);
  });

  it('acumulacion con turno ya cerrado (misma locucion + audio pegado): se descarta', () => {
    expect(
      shouldSkipCapture({
        prevText: 'hoy quiero una receta de pan',
        prevAt: 1000,
        nextText: 'hoy quiero una receta de pan y de tortas',
        nowMs: 1500,
        correctionInFlight: false,
      }),
    ).toBe('superset');
  });

  it('textos vacios: nada que decidir', () => {
    expect(shouldSkipCapture({ prevText: '', nextText: FRASE, nowMs: 2000, prevAt: 1000 })).toBe(null);
    expect(shouldSkipCapture({ prevText: FRASE, nextText: '', nowMs: 2000, prevAt: 1000 })).toBe(null);
  });
});

describe('captureDedup - la ventana es UN solo valor (despacho y fila)', () => {
  it('la ventana sale de la config y es la misma para los dos consumidores', () => {
    expect(Number(FLU_CONFIG.transcript?.fluQuery?.requestDedupMs)).toBeGreaterThan(0);
    expect(sameRequestWindowMs()).toBe(Number(FLU_CONFIG.transcript.fluQuery.requestDedupMs));
  });

  it('sin config, la ventana tiene un respaldo positivo (no desactiva el dedup)', () => {
    const guardado = FLU_CONFIG.transcript.fluQuery.requestDedupMs;
    FLU_CONFIG.transcript.fluQuery.requestDedupMs = 0;
    expect(sameRequestWindowMs()).toBeGreaterThan(0);
    FLU_CONFIG.transcript.fluQuery.requestDedupMs = guardado;
  });
});

// P2.4 - prueba de detector: alimentado el infractor, la marca discrimina.
describe('captureDedup - el detector no es decorativo', () => {
  it('el mismo par de textos cambia de veredicto segun la ventana y el estado del turno', () => {
    const base = { prevText: FRASE, prevAt: 1000, nextText: FRASE, nowMs: 1500 };
    // lo que fallaba: con turno en curso y captura identica debia descartarse
    expect(shouldSkipCapture({ ...base, correctionInFlight: true })).toBe('duplicate');
    // y el mismo input fuera de la ventana NO se descarta
    expect(
      shouldSkipCapture({ ...base, nowMs: 1000 + sameRequestWindowMs() + 1, correctionInFlight: true }),
    ).toBe(null);
    // una correccion (crece) con turno en curso no se descarta
    expect(
      shouldSkipCapture({
        prevText: FRASE,
        prevAt: 1000,
        nextText: `${FRASE} por favor`,
        nowMs: 1500,
        correctionInFlight: true,
      }),
    ).toBe(null);
  });
});
