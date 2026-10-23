/**
 * C2 - el regimen de normalizacion esta DECLARADO por modo (contrato, no sorpresa).
 *
 * Conversacion: `cleanForSpeech` (espacios) y el commit colapsa con `normalizeMicText`.
 * Escucha pasiva: `normalizeTranscriptText` (bloques repetidos >=24 chars y tartamudeo).
 * El dueno del switch es `normalizeTurnCapture`. Este test fija el contrato para que
 * unificar o cambiar el regimen sea una decision visible, no un efecto colateral.
 */
import { describe, expect, it } from 'vitest';
import { normalizeTranscriptText, normalizeTurnCapture } from '../src/voice/lib/turnTranscript';

const BLOQUE = 'esta es una frase larga que se repite';
const DOBLE = `${BLOQUE} ${BLOQUE}`;

describe('C2 - regimen de normalizacion por modo', () => {
    it('en conversacion NO se colapsa el bloque repetido (lo decide el commit)', () => {
        expect(normalizeTurnCapture(DOBLE, { conversationActive: true })).toBe(DOBLE);
    });

    it('en escucha pasiva SI se colapsa el bloque repetido', () => {
        expect(normalizeTurnCapture(DOBLE, { conversationActive: false })).toBe(BLOQUE);
        expect(normalizeTranscriptText(DOBLE)).toBe(BLOQUE);
    });
});
