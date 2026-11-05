/**
 * sessionResetCommandSingleOwnerGuard — el id de la orden de arranque tiene un dueno.
 *
 * Auditoria de codigo 2026-10-02: el id `'INICIAR_CONVERSACION'` estaba escrito como
 * literal en 8 sitios que COMPARAN o DEVUELVEN el id (audioMath, voiceCommands x2,
 * gemini, useFluVoiceAssistant x3, useNavigationCommands), cuando el valor ya tiene
 * dueno declarado (`FLU_CONFIG.navigation.sessionResetCommand`). Un cambio de ese valor dejaria
 * media app hablando de otro id.
 *
 * Se DEJAN como literal, a proposito y declarado:
 *   - las CLAVES del catalogo de locuciones (`FLU_CONFIG.ui.commandSpeech`, leidas en
 *     App.tsx y FluAvatarVoiceBridge): ahi el literal es una clave de diccionario, no
 *     el id de la orden;
 *   - los comentarios y los textos de log.
 *
 * El guard pregunta DOS cosas: que esos ficheros no vuelvan a escribir el id (texto) y
 * que el valor del dueno siga siendo el mismo (conducta: el refactor no cambio la orden).
 *
 * Prueba de DETECTOR real (0.24): se alimenta una entrada con el literal y el detector
 * la marca; si no la marcara, el guard seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

/** Ficheros que COMPARAN o DEVUELVEN el id de la orden de arranque. */
export const COMMAND_ID_FILES = [
    'src/voice/lib/audioMath.js',
    'src/voice/lib/voiceCommands.js',
    'src/voice/lib/gemini.js',
    'src/voice/hooks/useFluVoiceAssistant.js',
    'src/hooks/useNavigationCommands.ts',
] as const;

/** `archivo:linea` donde se escribe el id como literal. */
export function findLiteralCommandIds(sources: ReadonlyArray<{ file: string; source: string }>): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            const code = line.replace(/\/\/.*$/, '');
            if (/['"]INICIAR_CONVERSACION['"]/.test(code)) hits.push(`${file}:${index + 1}`);
        });
    }
    return hits;
}

function commandIdSources(): Array<{ file: string; source: string }> {
    return COMMAND_ID_FILES.map((file) => ({ file, source: readFileSync(join(process.cwd(), file), 'utf8') }));
}

describe('sessionResetCommandSingleOwnerGuard — un dueno del id de arranque', () => {
    it('ningun consumidor escribe el id como literal', () => {
        const bad = findLiteralCommandIds(commandIdSources());
        expect(bad, `Id escrito como literal (archivo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: el literal se marca (y una clave de catalogo tambien, por eso se excluye del alcance)', () => {
        const synthetic = [
            { file: 'src/voice/lib/audioMath.js', source: "  return 'INICIAR_CONVERSACION'" },
            { file: 'src/voice/lib/otro.js', source: "  const x = FLU_CONFIG.navigation.sessionResetCommand" },
        ];
        expect(findLiteralCommandIds(synthetic)).toEqual(['src/voice/lib/audioMath.js:1']);
    });

    it('el codigo limpio no se marca', () => {
        const clean = [
            { file: 'src/voice/lib/audioMath.js', source: '  return FLU_CONFIG.navigation.sessionResetCommand' },
        ];
        expect(findLiteralCommandIds(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: el valor del dueno no cambio con el refactor', () => {
        // El id sigue siendo el mismo: el cambio es de fuente, no de orden.
        expect(FLU_CONFIG.navigation.sessionResetCommand).toBe('INICIAR_CONVERSACION');
        // Y se lee desde la config en cada consumidor (no una constante nueva paralela).
        for (const { file, source } of commandIdSources()) {
            expect(source, `${file} debe leer el dueno`).toContain('FLU_CONFIG.navigation.sessionResetCommand');
        }
    });
});
