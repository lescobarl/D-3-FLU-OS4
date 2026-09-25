// ============================================================
// voiceCommandAnalysis.test.ts — comandos de voz F1–F4 (JS voice)
// ============================================================
// Cubre el nuevo conjunto de comandos de navegación (ANALIZAR_
// DOCUMENTO / ANALIZAR_APP / GENERAR_DOCUMENTO / GENERAR_VIDEO):
// catálogo, reconocimiento por frase (match exacto tras
// normalización), resolución desde textos ASR y speech de la UI.
// ============================================================

import { describe, test, expect } from 'vitest';
import {
    NAVIGATION_COMMAND_IDS,
    isKnownNavigationCommand,
    resolveNavigationCommandFromTexts,
    userRequestedNavigationCommand,
    getCommandSpeech,
    resolveVoiceConversationAction,
} from '../src/voice/lib/voiceCommands.js';

describe('voiceCommands — NAVIGATION_COMMAND_IDS', () => {
    test('incluye los 4 comandos nuevos F1–F4', () => {
        expect(NAVIGATION_COMMAND_IDS).toContain('ANALIZAR_DOCUMENTO');
        expect(NAVIGATION_COMMAND_IDS).toContain('ANALIZAR_APP');
        expect(NAVIGATION_COMMAND_IDS).toContain('GENERAR_DOCUMENTO');
        expect(NAVIGATION_COMMAND_IDS).toContain('GENERAR_VIDEO');
    });

    test('isKnownNavigationCommand reconoce solo comandos conocidos', () => {
        expect(isKnownNavigationCommand('ANALIZAR_DOCUMENTO')).toBe(true);
        expect(isKnownNavigationCommand('ANALIZAR_APP')).toBe(true);
        expect(isKnownNavigationCommand('GENERAR_DOCUMENTO')).toBe(true);
        expect(isKnownNavigationCommand('GENERAR_VIDEO')).toBe(true);
        expect(isKnownNavigationCommand('INICIAR_CONVERSACION')).toBe(true);
        expect(isKnownNavigationCommand('COMANDO_DESCONOCIDO')).toBe(false);
        expect(isKnownNavigationCommand('')).toBe(false);
        expect(isKnownNavigationCommand()).toBe(false);
    });
});

describe('voiceCommands — resolveNavigationCommandFromTexts', () => {
    test('resuelve ANALIZAR_DOCUMENTO por frase exacta', () => {
        expect(resolveNavigationCommandFromTexts(['analiza este documento'])).toBe('ANALIZAR_DOCUMENTO');
    });

    test('resuelve ANALIZAR_APP por frase exacta', () => {
        expect(resolveNavigationCommandFromTexts(['analizar la app'])).toBe('ANALIZAR_APP');
    });

    test('resuelve GENERAR_DOCUMENTO por frase exacta', () => {
        expect(resolveNavigationCommandFromTexts(['generar documento'])).toBe('GENERAR_DOCUMENTO');
    });

    test('resuelve GENERAR_VIDEO por frase exacta', () => {
        expect(resolveNavigationCommandFromTexts(['genera un video'])).toBe('GENERAR_VIDEO');
    });

    test('prueba varios fragmentos ASR en orden', () => {
        expect(resolveNavigationCommandFromTexts(['hola flu', 'analiza el archivo'])).toBe(
            'ANALIZAR_DOCUMENTO'
        );
    });

    test('frases sin comando devuelven null', () => {
        expect(resolveNavigationCommandFromTexts(['hola que tal'])).toBeNull();
        expect(resolveNavigationCommandFromTexts([])).toBeNull();
    });
});

describe('voiceCommands — userRequestedNavigationCommand', () => {
    test('confirma cuando el transcript pide el comando', () => {
        expect(userRequestedNavigationCommand('analiza este documento', 'ANALIZAR_DOCUMENTO')).toBe(true);
    });

    test('rechaza cuando el transcript no pide el comando', () => {
        expect(userRequestedNavigationCommand('continúa con la conversación', 'ANALIZAR_DOCUMENTO')).toBe(false);
    });
});

describe('voiceCommands — getCommandSpeech', () => {
    test('devuelve el speech de UI en español para los 4 comandos', () => {
        expect(getCommandSpeech('ANALIZAR_DOCUMENTO', 'es')).toContain('Analizando el documento');
        expect(getCommandSpeech('ANALIZAR_APP', 'es')).toContain('Analizando la app');
        expect(getCommandSpeech('GENERAR_DOCUMENTO', 'es')).toContain('Generando el documento');
        expect(getCommandSpeech('GENERAR_VIDEO', 'es')).toContain('Preparando el video');
    });

    test('devuelve el speech en inglés', () => {
        expect(getCommandSpeech('ANALIZAR_DOCUMENTO', 'en')).toContain('Analyzing the document');
        expect(getCommandSpeech('GENERAR_VIDEO', 'en')).toContain('Preparing the video');
    });

    test('comando desconocido devuelve cadena vacía', () => {
        expect(getCommandSpeech('COMANDO_DESCONOCIDO', 'es')).toBe('');
    });
});

describe('voiceCommands — generación de contenido sin truncar (regresión video)', () => {
    test('gatillo pelado "generame un video" → wait (NO dispara de inmediato)', () => {
        const action = resolveVoiceConversationAction('Okay Flow generame un video');
        expect(action.kind).toBe('wait');
    });

    test('gatillo pelado "genera un documento" → wait', () => {
        const action = resolveVoiceConversationAction('Okay Flow genera un documento');
        expect(action.kind).toBe('wait');
    });

    test('gatillo con contenido "generame un video sobre la historia de México" → flu (IA)', () => {
        const action = resolveVoiceConversationAction('Okay Flow generame un video sobre la historia de México');
        expect(action.kind).toBe('flu');
        expect(action.question).toContain('video sobre la historia');
    });

    test('gatillo con contenido "genera un documento de la minuta" → flu (IA)', () => {
        const action = resolveVoiceConversationAction('Okay Flow genera un documento de la minuta');
        expect(action.kind).toBe('flu');
    });

    test('gatillo pelado sin wake word también espera (nunca dispara de inmediato)', () => {
        const action = resolveVoiceConversationAction('generame un video');
        // Aunque no haya wake word, el gatillo pelado nunca debe disparar la
        // generación al instante → wait (sigue escuchando la descripción).
        expect(action.kind).toBe('wait');
    });
});
