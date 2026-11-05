/**
 * hardcodeModelDetectorGuard — el detector de modelos no es decorativo.
 *
 * Hallazgo 2026-11-01: el detector solo reconocía `google|anthropic|openai`;
 * un `fal-ai/...` literal en un placeholder de UI pasaba invisible. Ahora
 * reconoce los proveedores del catálogo y el self-test de la auditoría cubre
 * el caso positivo y el negativo (config).
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hardcodedOutsideConfig, runSelfTest } from '../scripts/auditoria-codigo.mjs';

describe('hardcodes — detector de modelos', () => {
  it('el self-test de las 6 señales pasa', () => {
    expect(runSelfTest()).toEqual([]);
  });

  it('marca un modelo fal-ai fuera de config y no marca el declarado en config', () => {
    const source = "const m = 'fal-ai/wan-25-preview/text-to-video';";
    expect(hardcodedOutsideConfig([{ file: 'src/components/X.tsx', source }], () => false)).toHaveLength(1);
    expect(hardcodedOutsideConfig([{ file: 'src/core/config/a.ts', source }], () => true)).toHaveLength(0);
  });
});
