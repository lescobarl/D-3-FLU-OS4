// ============================================================
// #2 — SENSIBILIDAD DE ESCUCHA (guard de CONDUCTA)
// ------------------------------------------------------------
// Defectos medidos por lectura del codigo (sesion del dueno, 2026-10-05):
//   1) `voiceIdentity.capture.maxSensitivity` (fluConfig) NO lo leia NADIE: era
//      config muerta (el comentario prometia "max sensibilidad tambien antes de
//      Iniciar conversacion" y no se ejecutaba).
//   2) `captureGain` SOLO se aplicaba con la conversacion activa; en escucha
//      pasiva quedaba en 1 (sin refuerzo).
//   3) Fuera de la conversacion el micro usaba AGC/NS/EC del navegador
//      (true/true/true), que ATENUAN las voces lejanas del aula -> "se pierde
//      conversacion".
// Invariante: con `maxSensitivity` la captura es CRUDA (sin procesado del
// navegador) y lleva la ganancia configurada, dentro y fuera de la conversacion.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveCaptureAudioConstraints, resolveCaptureGain } from '../src/voice/lib/micCapture.js';

const AUDIO = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    captureGain: 30,
    silenceThresholdDb: -45,
    voiceHoldMs: 1200,
    analyserSmoothing: 0.1,
    processEvery: 1,
};

/** Marca de infraccion: maxSensitivity activo pero el navegador sigue procesando. */
export function sensitivityLeakOffenders(
    constraints: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean },
    { maxSensitivity }: { maxSensitivity: boolean },
): string[] {
    if (!maxSensitivity) return [];
    return constraints.echoCancellation || constraints.noiseSuppression || constraints.autoGainControl
        ? ['maxSensitivity activo pero el navegador procesa el audio (atenua voces lejanas)']
        : [];
}

describe('#2 — maxSensitivity se aplica tambien fuera de la conversacion', () => {
    it('conversacion activa + sala: captura cruda', () => {
        const c = resolveCaptureAudioConstraints({
            conversationActive: true,
            roomCapture: true,
            maxSensitivity: true,
            audio: AUDIO,
        });
        expect(c).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
        expect(sensitivityLeakOffenders(c, { maxSensitivity: true })).toEqual([]);
    });

    it('pasiva con maxSensitivity: captura cruda (antes: AGC/NS/EC del navegador)', () => {
        const c = resolveCaptureAudioConstraints({
            conversationActive: false,
            roomCapture: false,
            maxSensitivity: true,
            audio: AUDIO,
        });
        expect(c).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
        expect(sensitivityLeakOffenders(c, { maxSensitivity: true })).toEqual([]);
    });

    it('pasiva sin maxSensitivity: procesado del navegador', () => {
        const c = resolveCaptureAudioConstraints({
            conversationActive: false,
            roomCapture: false,
            maxSensitivity: false,
            audio: AUDIO,
        });
        expect(c).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    });

    it('ganancia: se aplica fuera de la conversacion cuando maxSensitivity', () => {
        expect(resolveCaptureGain({ conversationActive: false, maxSensitivity: true, audio: AUDIO })).toBe(30);
        expect(resolveCaptureGain({ conversationActive: false, maxSensitivity: false, audio: AUDIO })).toBe(1);
        expect(resolveCaptureGain({ conversationActive: true, maxSensitivity: false, audio: AUDIO })).toBe(30);
    });
});

// Prueba de detector (P2.4): el MISMO criterio marca la captura procesada con
// maxSensitivity y no marca la cruda; sin esto el guard seria teatro.
describe('#2 — el detector no es decorativo', () => {
    it('marca el procesado del navegador con maxSensitivity y no marca el crudo', () => {
        const procesado = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        const crudo = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        expect(sensitivityLeakOffenders(procesado, { maxSensitivity: true })).toHaveLength(1);
        expect(sensitivityLeakOffenders(crudo, { maxSensitivity: true })).toEqual([]);
        expect(sensitivityLeakOffenders(procesado, { maxSensitivity: false })).toEqual([]);
    });
});
