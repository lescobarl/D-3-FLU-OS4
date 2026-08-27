// ============================================================
// streamStt — resolución de proveedor STT streaming (FIX #1)
// Contrato: FLU_STT_PROVIDER=mock|deepgram
//  - 'deepgram' solo es seleccionable con DEEPGRAM_API_KEY presente.
//  - Cualquier otro valor (o ausencia) → 'mock' (modo 100% local).
// La función pura vive en streamSttResolver.js (sin dependencia 'ws').
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveStreamSttProviderName } from '../src/server/streamSttResolver.js';

describe('streamStt — resolveStreamSttProviderName', () => {
    it('sin configuración → mock (modo 100% local)', () => {
        expect(resolveStreamSttProviderName({})).toBe('mock');
    });

    it('FLU_STT_PROVIDER=mock → mock', () => {
        expect(resolveStreamSttProviderName({ FLU_STT_PROVIDER: 'mock' })).toBe('mock');
    });

    it('FLU_STT_PROVIDER=deepgram sin API key → mock (degradación segura)', () => {
        expect(resolveStreamSttProviderName({ FLU_STT_PROVIDER: 'deepgram' })).toBe('mock');
    });

    it('FLU_STT_PROVIDER=deepgram con DEEPGRAM_API_KEY → deepgram', () => {
        expect(
            resolveStreamSttProviderName({ FLU_STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'x' }),
        ).toBe('deepgram');
    });

    it('es insensible a mayúsculas en el proveedor', () => {
        expect(
            resolveStreamSttProviderName({ FLU_STT_PROVIDER: 'DEEPGRAM', DEEPGRAM_API_KEY: 'x' }),
        ).toBe('deepgram');
    });

    it('valor desconocido → mock (sin fallbacks en código)', () => {
        expect(resolveStreamSttProviderName({ FLU_STT_PROVIDER: 'bogus' })).toBe('mock');
    });
});
