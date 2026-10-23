/**
 * C4 - la etiqueta automatica se CONSTRUYE y se PARSEA con la misma plantilla.
 *
 * Antes el regex estaba fijo a "Hablante N": cambiar
 * `FLU_CONFIG.voiceIdentity.labels.template` dejaba de reconocer las etiquetas
 * automaticas (se trataban como nombres propios o se perdian en el parseo).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import { autoSpeakerLabel, isAutoSpeakerLabel, parseSpeakerIndex } from '../src/voice/lib/speakerCore';

const original = FLU_CONFIG.voiceIdentity.labels.template;

afterEach(() => {
    FLU_CONFIG.voiceIdentity.labels.template = original;
});

describe('C4 - plantilla unica para construir y parsear la etiqueta', () => {
    it('con la plantilla por defecto parsea "Hablante N"', () => {
        FLU_CONFIG.voiceIdentity.labels.template = original;
        expect(parseSpeakerIndex('Hablante 3')).toBe(3);
        expect(isAutoSpeakerLabel('Hablante 2')).toBe(true);
        expect(isAutoSpeakerLabel('Luis')).toBe(false);
    });

    it('si la plantilla cambia, construccion y parseo siguen casando', () => {
        FLU_CONFIG.voiceIdentity.labels.template = 'Voz {n}';
        expect(autoSpeakerLabel(4)).toBe('Voz 4');
        expect(parseSpeakerIndex('Voz 4')).toBe(4);
        expect(isAutoSpeakerLabel('Voz 4')).toBe(true);
        // La etiqueta vieja ya no es automatica con la plantilla nueva.
        expect(parseSpeakerIndex('Hablante 4')).toBeNull();
        expect(isAutoSpeakerLabel('Hablante 4')).toBe(false);
    });
});
