import { describe, expect, it } from 'vitest';
import { looksLikeGarbageTranscript } from '../src/voice/lib/garbageTranscript.js';

describe('garbageTranscript — guard anti-alucinación ASR', () => {
  it('la repeticion adyacente con palabras reales NO es alucinacion clara (B3)', () => {
    // B3: la frase tiene PALABRAS REALES (el tartamudeo es un motivo, no alucinacion clara).
    expect(looksLikeGarbageTranscript('¿Y se se? ¿Bon la ofes ahí?')).toBe(false);
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

  it('conserva el dictado de SOLO números (contenido, no jerga)', () => {
    expect(looksLikeGarbageTranscript('25 58')).toBe(false);
    expect(looksLikeGarbageTranscript('1 2690')).toBe(false);
  });

  it('descarta vacío', () => {
    expect(looksLikeGarbageTranscript('')).toBe(true);
    expect(looksLikeGarbageTranscript('   ')).toBe(true);
  });
});

// Prueba de DETECTOR del propio guard (no es decorativo): alimenta una entrada
// infractora (jerga sin vocales) y una legítima (cifras) y exige que la marca
// discrimine. Si el detector fuera sordo (todo basura o todo legítimo), cae.
describe('el detector no es decorativo (prueba de mutación)', () => {
  it('marca la jerga sin vocales y NO el dictado de cifras', () => {
    expect(looksLikeGarbageTranscript('hmm mmm nnn'), 'jerga = basura').toBe(true);
    expect(looksLikeGarbageTranscript('25 58'), 'cifras = contenido').toBe(false);
  });
});
