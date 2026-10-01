/**
 * services/gemini — diagnostico de respuesta.
 *
 * POR QUE ESTE TEST: `src/services/gemini.ts` esta al ~20.8% (313 sentencias sin
 * cubrir). `buildDiagnostics` fija de donde sale el modelo reportado
 * (parametro explicito > modelo guardado > config) y el proveedor.
 */
import { describe, expect, it } from 'vitest';
import { buildDiagnostics } from '../src/services/gemini';

describe('gemini — buildDiagnostics', () => {
    it('reporta el proveedor google-gemini y el apiKeySource recibido', () => {
        const d = buildDiagnostics('localStorage');
        expect(d.provider).toBe('google-gemini');
        expect(d.apiKeySource).toBe('localStorage');
    });

    it('el modelo explicito gana sobre el guardado y el de config', () => {
        expect(buildDiagnostics('param', 'modelo-x').model).toBe('modelo-x');
    });

    it('sin modelo explicito cae al modelo de config (o al guardado)', () => {
        const d = buildDiagnostics('env');
        expect(d.model).toBeTruthy();
        expect(typeof d.model).toBe('string');
    });
});
