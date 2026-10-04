/**
 * Rutas dobles de DECISION: el MISMO dueño no puede responder dos veces la misma
 * pregunta con criterios distintos. Nace ROJO (enumera los duplicados como
 * archivo:linea) y pasa cuando queda UN dueño por pregunta.
 *
 * POR QUE EXISTE (medido 2026-10-04, censo de dueños de decisión): el defecto de
 * la sesion anterior (dos filas con una respuesta) fue una pregunta con DOS
 * dueños —la ejecucion y la fila decididian "es la misma peticion" con memorias y
 * ventanas distintas—. Este guard cierra las otras cuatro preguntas que el censo
 * encontro con N>1:
 *
 *   D1 "¿FLU esta hablando?"  -> las puertas de VOZ preguntaban con
 *      `isSpeechBusy()` (incluye el flag GLOBAL `speechSynthesis.speaking`, del que
 *      el propio codigo dice que "quedaba pegado y silenciaba la escucha") mientras
 *      la supresion de eco preguntaba con `isFluSpeaking()` (la promesa propia,
 *      acotada por watchdog). Dos criterios para la misma pregunta en el mismo
 *      fichero: con el flag pegado, el eco se filtra bien pero el despacho devuelve
 *      false y el turno se pierde en silencio.
 *   D2 "¿es la MISMA locucion?" -> en conversationStreamCommit habia DOS criterios:
 *      `mismaLocucionViva` (estado de la UI + emision) y `sameRequestAsLastDispatch`
 *      (memoria del despacho + ventana compartida). Se queda UNO.
 *   D3 "programar en idle"      -> `scheduleIdle` estaba definido en DOS modulos de
 *      voz (uno void y otro Promise) con el mismo algoritmo.
 *   D4 "plegar acentos"         -> `noteIntentParser` re-implementaba a mano el
 *      plegado que ya vive en `src/lib/textUtils.ts` (stripDiacritics).
 *   D5 "resolver la key de texto" -> `services/deepseek.ts` re-implementaba el
 *      resolver central que `services/gemini.ts` ya usaba.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkFiles } from './_helpers';

const ROOT = process.cwd();
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');

// ---------------------------------------------------------------- D1
/** Marcas de la pregunta "¿esta hablando FLU?" respondida con el flag GLOBAL. */
export function findGlobalSpeechGateOffenders(content: string, file = 'src/sintetico.js'): string[] {
    const out: string[] = [];
    content.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/\bisSpeechBusy\s*\(/.test(line)) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`);
    });
    return out;
}

// ---------------------------------------------------------------- D2
/** Marcas del criterio de UI (`sameLiveEmission`) para "misma locucion". */
export function findUiLocutionCriteria(content: string, file = 'src/sintetico.js'): string[] {
    const out: string[] = [];
    content.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/\bsameLiveEmission\s*\(/.test(line)) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`);
    });
    return out;
}

// ---------------------------------------------------------------- D3
/** Definiciones propias de `scheduleIdle` (debe haber UNA, la del dueno compartido). */
export function countScheduleIdleDefs(
    files: Array<{ rel: string; content: string }>,
    owner = 'src/voice/lib/idleSchedule.js',
): string[] {
    return files
        .filter((f) => f.rel !== owner && /function\s+scheduleIdle\s*\(/.test(f.content))
        .map((f) => `${f.rel}:function scheduleIdle`);
}

// ---------------------------------------------------------------- D4
/** Ficheros que pliegan acentos a mano (must be 0 outside the shared textUtils). */
export function findAccentFoldOffenders(files: Array<{ rel: string; content: string }>): string[] {
    const owner = 'src/lib/textUtils.ts';
    // Dos formas del mismo plegado propio: el NFD + marcas combinantes, y las
    // tablas de reemplazo por vocal ('a','e','i','o','u','n').
    const nfd = /\\u0300|\u0300-\u036f/;
    const tabla = /replace\(\s*\/\[[^\]]{1,60}\]\/[a-z]*\s*,\s*'[aeioun]'\s*\)/;
    return files
        .filter((f) => f.rel !== owner && !f.rel.startsWith('src/dev/'))
        .filter((f) => nfd.test(f.content) || tabla.test(f.content))
        .map((f) => `${f.rel}:plegado-propio-de-acentos`);
}

// ---------------------------------------------------------------- D5
/** Resoluciones propias de la key de texto (must be 0: se usa el resolver central). */
export function findTextKeyOwnerOffenders(content: string, file = 'src/sintetico.ts'): string[] {
    const out: string[] = [];
    content.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/STORAGE_KEYS\.TEXT_API_KEY/.test(line)) out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`);
    });
    return out;
}

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const voiceLibFiles = (): Array<{ rel: string; content: string }> =>
    readdirSync(join(ROOT, 'src', 'voice', 'lib'))
        .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts'))
        .map((f) => ({ rel: `src/voice/lib/${f}`, content: read(`src/voice/lib/${f}`) }));

describe('D1 - las puertas de VOZ preguntan "¿habla FLU?" con UN solo criterio', () => {
    it('el hook no usa el flag global (isSpeechBusy) en sus puertas de voz', () => {
        const offenders = findGlobalSpeechGateOffenders(read('src/voice/hooks/useFluVoiceAssistant.js'));
        expect(
            offenders,
            `Criterios con el flag GLOBAL de TTS (N=${offenders.length}); usa isFluSpeaking() ` +
                `(la promesa propia, con watchdog):\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
    it('el detector no es decorativo: marca la puerta con el flag global y perdona la propia', () => {
        expect(findGlobalSpeechGateOffenders('  if (isSpeechBusy()) return false')).toHaveLength(1);
        expect(findGlobalSpeechGateOffenders('  if (isFluSpeaking()) return false')).toHaveLength(0);
    });
});

describe('D2 - "es la MISMA locucion" tiene UNA memoria (la del despacho)', () => {
    it('conversationStreamCommit no decide por el estado de la UI', () => {
        const offenders = findUiLocutionCriteria(read('src/voice/lib/conversationStreamCommit.js'));
        expect(
            offenders,
            `Segundo criterio de "misma locucion" (N=${offenders.length}); el dueno es ` +
                `sameRequestAsLastDispatch:\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
    it('el detector no es decorativo: marca el criterio de UI y perdona el del despacho', () => {
        expect(findUiLocutionCriteria('const mismaLocucionViva = sameLiveEmission(prev, capture)')).toHaveLength(1);
        expect(findUiLocutionCriteria('const x = sameRequestAsLastDispatch(capture)')).toHaveLength(0);
    });
});

describe('D3 - un solo dueno de "programar en idle"', () => {
    it('solo el modulo compartido define scheduleIdle', () => {
        const offenders = countScheduleIdleDefs(voiceLibFiles());
        expect(
            offenders,
            `Definiciones propias de scheduleIdle (N=${offenders.length}); importa el dueno ` +
                `compartido:\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
    it('el detector no es decorativo: marca una definicion fuera del dueno', () => {
        expect(
            countScheduleIdleDefs([{ rel: 'src/voice/lib/otro.js', content: 'function scheduleIdle(fn) {}' }]),
        ).toHaveLength(1);
        expect(
            countScheduleIdleDefs([
                { rel: 'src/voice/lib/idleSchedule.js', content: 'export function scheduleIdle(fn) {}' },
            ]),
        ).toHaveLength(0);
    });
});

describe('D4 - un solo plegado de acentos (src/lib/textUtils.ts)', () => {
    it('ningun modulo de src pliega acentos a mano', () => {
        const files = walkFiles(join(ROOT, 'src'), /\.(ts|tsx|js|jsx|mjs)$/).map((f) => ({
            rel: rel(f),
            content: readFileSync(f, 'utf8'),
        }));
        const offenders = findAccentFoldOffenders(files);
        expect(
            offenders,
            `Plegado de acentos re-implementado (N=${offenders.length}); usa stripDiacritics:\n  ` +
                offenders.join('\n  '),
        ).toEqual([]);
    });
    it('el detector no es decorativo: marca el plegado a mano y perdona el import del dueno', () => {
        expect(
            findAccentFoldOffenders([{ rel: 'src/x.js', content: `s.replace(/[\u0300-\u036f]/g, '')` }]),
        ).toHaveLength(1);
        expect(
            findAccentFoldOffenders([{ rel: 'src/x.js', content: `s.replace(/[áéíóú]/g, 'a')` }]),
        ).toHaveLength(1);
        expect(
            findAccentFoldOffenders([{ rel: 'src/x.js', content: `import { stripDiacritics } from '../lib/textUtils'` }]),
        ).toHaveLength(0);
    });
});

describe('D5 - una sola resolucion de la key de texto', () => {
    it('deepseek delega en el resolver central (no lee la clave por su cuenta)', () => {
        const content = read('src/services/deepseek.ts');
        const offenders = findTextKeyOwnerOffenders(content, 'src/services/deepseek.ts');
        expect(
            offenders,
            `Lecturas propias de la key de texto (N=${offenders.length}); usa resolveApiKey(apiKey, ` +
                `resolveTextApiKey):\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
        expect(content).toContain('resolveApiKey(');
    });
    it('el detector no es decorativo: marca la lectura propia y perdona la delegacion', () => {
        expect(findTextKeyOwnerOffenders(`const k = localGet(STORAGE_KEYS.TEXT_API_KEY)`)).toHaveLength(1);
        expect(findTextKeyOwnerOffenders(`const k = resolveTextApiKey()`)).toHaveLength(0);
    });
});
