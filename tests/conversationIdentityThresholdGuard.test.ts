/**
 * conversationIdentityThresholdGuard — el piso del modulo conversacion.
 *
 * Hallazgo 2026-11-01: el modulo comparaba contra `cosineContinuity` (0.80).
 * Las mediciones del repo dicen MISMA voz 0.69-0.74 y DISTINTA 0.58: 0.80
 * dejaba fuera a la misma voz y creaba un `Hablante N` por turno. El piso
 * propio del modulo es 0.66; este guard lo congela y prueba la decision.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decidirIdentidad } from '../src/voice/conversation/identidad';
import { VOICE_DIARIZATION_DEFAULTS } from '../src/core/config/sharedConfig';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('identidad — piso de continuidad del modulo', () => {
  it('el piso es 0.72 (WAV real: 0.66 une, 0.72 separa) y el adaptador lo usa', () => {
    expect(VOICE_DIARIZATION_DEFAULTS.cosineConversationContinuity).toBe(0.72);
    expect(source('src/core/config/sharedConfig.ts')).toContain('cosineConversationContinuity: 0.72');
    expect(source('src/voice/conversation/adapters.ts')).toContain('cosineConversationContinuityThreshold');
  });

  it('0.78 es continuidad; 0.70 y 0.58 no alcanzan el piso 0.72', () => {
    const plantilla = { vozId: 'v1', vector: [1, 0], etiqueta: 'Hablante 1' };
    const misma = decidirIdentidad({
      vector: [1, 0],
      plantillas: [plantilla],
      umbral: 0.72,
      etiquetaNueva: () => 'Hablante 2',
      comparar: () => 0.78,
      id: () => 'v2',
    });
    expect(misma).toEqual({ vozId: 'v1', continuidad: true, hablante: 'Hablante 1' });

    const distinta = decidirIdentidad({
      vector: [1, 0],
      plantillas: [plantilla],
      umbral: 0.72,
      etiquetaNueva: () => 'Hablante 2',
      comparar: () => 0.70,
      id: () => 'v2',
    });
    expect(distinta).toEqual({ vozId: 'v2', continuidad: false, hablante: 'Hablante 2' });
  });
});
