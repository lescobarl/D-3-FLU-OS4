// ============================================================
// speakerClusterAccumulation.test.ts — la ventana del turno no se ensancha
// ------------------------------------------------------------
// Corte 2026-10-26 (feature/conversacion-modulo-nuevo): la tuberia vieja de
// identidad se retiro (commit 365eeef5). Este archivo simulaba la cola de
// preflight por turno con duenos MUERTOS: turnIdentityPipeline.js (BORRADO),
// turnSpeakerPreflight.js (huerfano), resolveConversationSpeaker de
// speakerDiarization.js (BORRADA) y findClusterByLabel (huerfano); esas
// secciones se retiraron. Queda VIVO el contrato de `flattenChunksWindow`
// (src/voice/lib/speakerClusters.js), consumido por src/voice/core/tramo.js,
// useFluVoiceAssistant.js y voiceIdentity.js: la captura impone un minimo de
// audio y NUNCA ensancha la ventana mas alla del inicio del turno.
//
// MEDIDO en la app: la captura del turno salio de ~8 ms (`TurnAudio snap=384`)
// y el preflight respondia `no-vector` -> sin firma, sin cluster. Por eso la
// captura impone un MINIMO (`minSamplesMs`); el primitivo que lo aplica es
// `flattenChunksWindow`.
// ============================================================
import { describe, expect, it } from 'vitest'
import { flattenChunksWindow } from '../src/voice/lib/speakerClusters.js'

describe('la captura del turno impone un minimo de audio (no ventanas casi vacias)', () => {
  it('R1: minSamples NO ensancha la ventana mas alla del inicio del turno', () => {
    const chunks = [new Float32Array(48000)] // 1 s @48k
    const w = flattenChunksWindow(chunks, {
      totalSamples: 48000,
      sinceSample: 47616, // el limite de turno acaba de marcar el inicio (384 muestras)
      maxSamples: 86400,
      minSamples: 43200, // minimo exigido (0.9 s @48k)
    })
    // R1: la ventana NO puede empezar antes del turno (antes se ensanchaba a 43200 y
    // metia audio PRE-turno: la voz de FLU, medido 67-83%). Una ventana SIN voz no trae
    // medida (`no-vector`) y NO abre etiqueta (el reuso sin evidencia se retiro el
    // 2026-10-18: voz distinta = etiqueta distinta).
    expect(w.length, 'R1: se queda en el turno, no en el minimo').toBe(384)
  })

  it('R1: marca de turno en el sello (turnSpan<=0) => ventana VACIA, no la cola del buffer', () => {
    const chunks = [new Float32Array(48000)] // 1 s @48k
    const w = flattenChunksWindow(chunks, {
      totalSamples: 48000,
      sinceSample: 48000, // la marca cae en el sello: 0 muestras de turno
      maxSamples: 86400,
      minSamples: 43200,
    })
    expect(w.length, 'sin turno no hay ventana: no se mide la cola del buffer').toBe(0)
  })
})
