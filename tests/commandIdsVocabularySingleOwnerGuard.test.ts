/**
 * commandIdsVocabularySingleOwnerGuard — el vocabulario de ids de comando tiene un dueno.
 *
 * Auditoria de codigo 2026-10-02 (P8.21): el MISMO id se escribia como literal
 * entrecomillado en 10 ficheros (arbitro audioMath, filtro gemini, listas de
 * voiceCommands, rutas useNavigationCommands, catas de useFluVoiceAssistant, claves
 * del catalogo de locuciones fluConfig.ui.commandSpeech, App, useMinuteHandlers,
 * participantFloor, turnArtifactKind). AGENTS 4 ("una etiqueta, un sitio"): el
 * conjunto que debe coincidir entre subsistemas se declara UNA vez.
 *
 * El dueno es `src/voice/lib/commandIds.js` (modulo HOJA: no importa nada, para que
 * audioMath y fluConfig puedan importarlo sin ciclo). El id de arranque conserva su
 * dueno de CONFIG (`FLU_CONFIG.navigation.sessionResetCommand`), que DERIVA de
 * COMMAND_IDS -> la etiqueta sigue declarada una sola vez.
 *
 * El guard pregunta DOS cosas: que no quede ningun id entrecomillado fuera del dueno
 * (texto) y que la config derive del vocabulario sin deriva (conducta).
 *
 * Prueba de DETECTOR real (0.24): se alimenta una copia sintetica con el literal fuera
 * del dueno y se comprueba que el detector la marca; si el guard siguiera verde sin
 * marcarla, seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { COMMAND_IDS } from '../src/voice/lib/commandIds.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';
import { NAVIGATION_COMMAND_IDS, GEMINI_INFERABLE_COMMAND_IDS } from '../src/voice/lib/voiceCommands.js';

const OWNER = 'src/voice/lib/commandIds.js';
const IDS = Object.values(COMMAND_IDS) as string[];
const QUOTED_ID = new RegExp(`['"](${IDS.join('|')})['"]`);

export interface SourceFile {
    file: string;
    source: string;
}

/** `archivo:linea` de cada id entrecomillado FUERA del dueno. */
export function findQuotedCommandIds(
    sources: ReadonlyArray<SourceFile>,
    owner: string = OWNER,
): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        if (file === owner) continue;
        source.split('\n').forEach((line, index) => {
            if (QUOTED_ID.test(line)) hits.push(`${file}:${index + 1}`);
        });
    }
    return hits;
}

function srcSources(): SourceFile[] {
    const walk = (dir: string, acc: string[] = []): string[] => {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) walk(p, acc);
            else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
                acc.push(relative(process.cwd(), p).replace(/\\/g, '/'));
            }
        }
        return acc;
    };
    return walk(join(process.cwd(), 'src')).map((file) => ({
        file,
        source: readFileSync(join(process.cwd(), file), 'utf8'),
    }));
}

describe('commandIdsVocabularySingleOwnerGuard — el vocabulario de ids tiene un dueno', () => {
    it('ningun id de comando se escribe entrecomillado fuera de commandIds.js', () => {
        const bad = findQuotedCommandIds(srcSources());
        expect(bad, `Ids entrecomillados fuera del dueno (archivo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: el literal fuera del dueno se marca, y el dueno no', () => {
        const synthetic: SourceFile[] = [
            { file: OWNER, source: "  FLU_WAKE: 'FLU_WAKE'," },
            { file: 'src/voice/lib/otro.js', source: "  return 'FLU_WAKE'" },
            { file: 'src/voice/lib/limpio.js', source: '  return COMMAND_IDS.FLU_WAKE' },
        ];
        expect(findQuotedCommandIds(synthetic)).toEqual(['src/voice/lib/otro.js:1']);
    });

    it('COMPORTAMIENTO: el vocabulario es un mapa congelado clave=valor', () => {
        expect(Object.isFrozen(COMMAND_IDS)).toBe(true);
        for (const [key, value] of Object.entries(COMMAND_IDS)) {
            expect(value, `${key} no coincide con su valor`).toBe(key);
        }
    });

    it('COMPORTAMIENTO: el config deriva del vocabulario (id de arranque y catalogo)', () => {
        expect(FLU_CONFIG.navigation.sessionResetCommand).toBe(COMMAND_IDS.INICIAR_CONVERSACION);
        const values = new Set(IDS);
        for (const key of Object.keys(FLU_CONFIG.ui.commandSpeech)) {
            expect(values.has(key), `commandSpeech.${key} no esta en COMMAND_IDS`).toBe(true);
        }
    });

    it('COMPORTAMIENTO: las listas de comandos solo usan ids declarados', () => {
        const values = new Set(IDS);
        for (const id of [...NAVIGATION_COMMAND_IDS, ...GEMINI_INFERABLE_COMMAND_IDS]) {
            expect(values.has(id), `${id} no esta en COMMAND_IDS`).toBe(true);
        }
    });
});
