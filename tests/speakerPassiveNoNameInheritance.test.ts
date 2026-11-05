// ============================================================
// speakerPassiveNoNameInheritance - Guard de diarizacion pasiva
// ------------------------------------------------------------
// Regla (fluConfig.voiceIdentity.capture.roomCapture.requireWakeWordForSpeakerName):
// SIN wake + comando, la etiqueta NO puede ser un nombre propio heredado por
// texto ("Luis"): el habla pasiva de la sala/TV se etiqueta generica
// (Hablante N). El nombre propio solo entra por wake ("ok flu soy Ana") o por
// diarizacion de AUDIO.
//
// CORTE 2026-10-26: el dueno viejo (`activeListen.resolveSpeakerByText`, isla de
// la tuberia retirada) se sustituye por los duenos vivos:
//   - `speakerPolicy.resolveSpeakerNameFromUtterance`: el TEXTO solo da nombre
//     propio con wake (o si la config lo permite); sin wake devuelve ''.
//   - `fila.resolverEtiqueta`: la etiqueta de la fila sale de la EVIDENCIA
//     (nombre confirmado / medida / continuidad acustica / semilla): la semilla
//     y la etiqueta anonima nunca son un nombre propio.
// ============================================================
import { describe, expect, it } from 'vitest';
import { getRoomCaptureCfg, resolveSpeakerNameFromUtterance } from '../src/voice/lib/speakerPolicy.js';
import { resolverEtiqueta } from '../src/voice/conversation/fila.ts';
import type { EntradaEtiqueta } from '../src/voice/conversation/fila.ts';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const GENERIC = FLU_CONFIG.voiceIdentity.labels.fallbackSpeaker;
const TV_PHRASE = 'estan dando una pelicula muy buena en la television';
const WAKES = FLU_CONFIG.voiceCommands?.wakeWords || [];

/** Etiqueta de fila con la evidencia por encima (datos del test). */
const etiqueta = (sobre: Partial<EntradaEtiqueta> = {}): EntradaEtiqueta => ({
    voz: { nombre: '', nombreConfirmado: false, hablante: '', continuidad: false },
    anterior: null,
    semilla: GENERIC,
    esEtiquetaAnonima: (e) => e.startsWith('Hablante'),
    ...sobre,
});

describe('etiqueta por texto en modo pasivo: sin wake no se hereda el nombre propio', () => {
    it('una frase de TV no se etiqueta con el nombre propio del ultimo orador', () => {
        // El texto solo da nombre con wake: sin wake el camino de texto es ''.
        expect(resolveSpeakerNameFromUtterance(TV_PHRASE, { wakeWords: WAKES })).toBe('');
    });

    it('el nombre propio solo entra por wake ("ok flu soy Ana")', () => {
        expect(resolveSpeakerNameFromUtterance('ok flu soy Ana', { wakeWords: WAKES })).toBe('Ana');
    });

    it('una etiqueta automatica previa se conserva (no es nombre propio)', () => {
        // Continuidad acustica con la etiqueta anonima anterior: se conserva
        // «Hablante 2»; nunca se reemplaza por un nombre propio sin evidencia.
        const r = resolverEtiqueta(
            etiqueta({ voz: { nombre: '', nombreConfirmado: false, hablante: '', continuidad: true }, anterior: 'Hablante 2' }),
        );
        expect(r.etiqueta).toBe('Hablante 2');
    });

    it('sin ultimo orador cae al label configurado', () => {
        const r = resolverEtiqueta(etiqueta());
        expect(r.etiqueta).toBe(GENERIC);
    });

    it('PRUEBA DE DETECTOR: la puerta del nombre por texto la decide la CONFIG', () => {
        // Con la puerta cerrada (sala), «soy Luis» sin wake NO da nombre...
        expect(
            resolveSpeakerNameFromUtterance('soy Luis', {
                wakeWords: WAKES,
                roomCfg: { ...getRoomCaptureCfg(), requireWakeWordForSpeakerName: true },
            }),
        ).toBe('');
        // ...y solo la config la abre (roomCapture.requireWakeWordForSpeakerName).
        expect(
            resolveSpeakerNameFromUtterance('soy Luis', {
                wakeWords: WAKES,
                roomCfg: { ...getRoomCaptureCfg(), requireWakeWordForSpeakerName: false },
            }),
        ).toBe('Luis');
    });
});
