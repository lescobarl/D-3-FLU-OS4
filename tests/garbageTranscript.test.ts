import { describe, expect, it } from 'vitest';
import { looksLikeGarbageTranscript } from '../src/voice/lib/garbageTranscript.js';

describe('garbageTranscript — guard anti-alucinación ASR', () => {
  it('descarta basura con repetición adyacente ("se se")', () => {
    expect(looksLikeGarbageTranscript('¿Y se se? ¿Bon la ofes ahí?')).toBe(true);
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
