// ============================================================
// Expression Map — Fuente canónica de expresiones → animaciones
// ============================================================
// Extraído de src/avatar/index.ts para romper la dependencia
// circular entre el barrel del avatar (index.ts) y bunnyStore.ts:
//
//   index.ts ──export──▶ bunnyStore.ts
//      ▲                      │
//      └──── import ◀─────────┘   (ciclo)
//
// Al mover EXPRESSION_MAP a su propio módulo, tanto index.ts como
// bunnyStore.ts importan la misma fuente sin ciclo.
//
// NOTA: El bunnyStore real NO posee EXPRESSION_MAP. OS3
// (useAvatarVoiceSync.ts) lo importa desde 'flu-avatar'; este mapa
// es la equivalencia canónica alineada con expressionRegistry.ts.
// ============================================================
import type { BunnyAnimation } from './types/bunny';

/**
 * Mapa de expresiones → animaciones corporales.
 * Usado por useAvatarVoiceSync para sincronizar el avatar con el estado de voz.
 * Este mapa reemplaza el EXPRESSION_MAP que OS3 esperaba de flu-avatar.
 */
/**
 * Mapa de expresiones → animaciones corporales.
 * ALINEADO con expressionRegistry.ts como fuente de verdad.
 *
 * Corrección 2026-07-21:
 *   - atencion: ['Idle_1','Emo_neutral'] → ['Idle_2'] (LISTENING)
 *   - atencion2: ['Idle_2','Emo_neutral'] → ['Idle_3'] (LISTENING alternancia)
 *   - Pensando: ['Idle_3','Emo_neutral'] → ['Idle_1'] (THINKING)
 *   - hablando: ['MouthMove','Palabra'] → ['Idle_2','MouthMove'] (SPEAKING)
 *   - hablando2: ['Palabra','MouthMove'] → ['Idle_3','MouthMove'] (SPEAKING alternancia)
 */
export const EXPRESSION_MAP: Record<string, BunnyAnimation[]> = {
    // ALINEADO con expressionRegistry (happy → feliz ['Jump_while_run','Idle_2'],
    // CELEBRATING → feliz ['Jump_while_run']). 'Dance' no pertenece a 'feliz' en el registry.
    'feliz': ['Jump_while_run', 'Idle_2'],
    'triste': ['Emo_neutral', 'Cap_front'],
    'enojado': ['Walk', 'Emo_blink', 'Cap_back', 'MouthMove'],
    'sorprendido': ['Emo_neutral', 'Cap_back'],
    // LISTENING: alineado con expressionRegistry (atencion→Idle_2, atencion2→Idle_3)
    'atencion': ['Idle_2'],
    'atencion2': ['Idle_3'],
    // THINKING: alineado con expressionRegistry (Pensando→Idle_1)
    'Pensando': ['Idle_1'],
    // SPEAKING: alineado con expressionRegistry (hablando→Idle_2+MouthMove, hablando2→Idle_3+MouthMove)
    'hablando': ['Idle_2', 'MouthMove'],
    'hablando2': ['Idle_3', 'MouthMove'],
    // FIX 2026-08-13 (Punto 2: mano arriba al hablar): sin 'Palabra' (clip
    // sintético de mano alzada) para que al intervenir la mano NO quede arriba.
    'intervencion': ['Idle_2'],
    'yes!': ['Jump_in_place'],
    'serio': ['Emo_neutral'],
    'baila': ['Dance'],
    'canta': ['Dance'],
    'se_me_chispotio': ['Emo_blink', 'MouthMove'],
    'llorando': ['Emo_blink', 'Cap_back', 'MouthMove'],
    'corre': ['Run'],
    'escapa': ['Walk_sneaky'],
    'congelado': ['Bind-pose'],
    'Yupi': ['Jump_in_place', 'Palabra'],
    'chispas': ['Cap_front'],
    'palabra': ['Idle_1', 'Palabra'],
    'Palabra2': ['Jump_in_place', 'Palabra'],
    // OS3 parity: greeting/wave/alert/sleep animations
    'saludo': ['Dance', 'Jump_in_place'],
    'wave': ['Jump_in_place', 'Dance'],
    'alerta': ['Run', 'Emo_blink'],
    'sleep': ['Bind-pose', 'Emo_neutral'],
};
