import { describe, expect, it } from 'vitest';
import { looksLikeGarbageTranscript } from '../src/voice/lib/garbageTranscript.js';

describe('garbageTranscript — guard anti-alucinación ASR', () => {
  it('descarta basura con repetición adyacente ("se se")', () => {
    expect(looksLikeGarbageTranscript('¿Y se se? ¿Bon la ofes ahí?')).toBe(true);
  });

  // Una persona repite "hola hola" a proposito: el guard solo debe descartar
  // el tartamudeo de palabra corta del ASR, no la repeticion deliberada.
  it('conserva la repeticion deliberada de palabra larga ("hola hola")', () => {
    expect(looksLikeGarbageTranscript('hola hola')).toBe(false);
    expect(looksLikeGarbageTranscript('hola hola soy luis')).toBe(false);
  });

  it('descarta ruido incoherente sin vocales', () => {
    expect(looksLikeGarbageTranscript('hmm mmm nnn')).toBe(true);
  });

  it('conserva habla real en español', () => {
    expect(looksLikeGarbageTranscript('okay flu borra todas las notas')).toBe(false);
    expect(looksLikeGarbageTranscript('bor borra todas las notas')).toBe(false);
    expect(looksLikeGarbageTranscript('qué hay para hoy')).toBe(false);
    expect(looksLikeGarbageTranscript('crea una junta mañana a las once')).toBe(false);
  });

  it('conserva habla real en inglés', () => {
    expect(looksLikeGarbageTranscript('what is on my schedule today')).toBe(false);
  });

  it('descarta vacío', () => {
    expect(looksLikeGarbageTranscript('')).toBe(true);
    expect(looksLikeGarbageTranscript('   ')).toBe(true);
  });
});
