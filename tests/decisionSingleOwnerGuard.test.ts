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
import type { ConfigPort } from '../src/voice/conversation/ports';

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
/**
 * Definiciones de `scheduleIdle` (debe haber 0): se RETIRA (corte 2026-10-26).
 * Programaba la diarizacion en idle (voiceIdentityQueue / el resolutor idle de
 * voiceIdWorkerClient), borrada con la tuberia vieja. Sin consumidores, el
 * modulo compartido `idleSchedule.js` se elimina; una definicion propia que
 * volviera seria basura o una ruta doble sin dueno vivo.
 */
export function countScheduleIdleDefs(files: Array<{ rel: string; content: string }>): string[] {
    return files
        .filter((f) => /function\s+scheduleIdle\s*\(/.test(f.content))
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
/** Lecturas propias de la key de texto en el cliente de voz (must be 0: resolver central). */
export function findTextKeyOwnerOffenders(content: string, file = 'src/sintetico.ts'): string[] {
    const out: string[] = [];
    content.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/localGet\(\s*STORAGE_KEYS\.TEXT_API_KEY/.test(line)) {
            out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`);
        }
    });
    return out;
}

// ---------------------------------------------------------------- D6
/** Escritores del provider de IA fuera de su dueno (must be 0). */
export function findProviderWriterOffenders(files: Array<{ rel: string; content: string }>): string[] {
    const owner = 'src/services/aiServiceFactory.ts';
    const out: string[] = [];
    for (const f of files) {
        if (f.rel === owner) continue;
        f.content.split(/\r?\n/).forEach((line, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
            if (/localSet\(\s*(STORAGE_KEYS\.AI_PROVIDER|AI_PROVIDER_KEY)/.test(line)) {
                out.push(`${f.rel}:${i + 1}:${line.trim().slice(0, 110)}`);
            }
        });
    }
    return out;
}

describe('D6 - un solo escritor del provider de IA', () => {
    it('la clave del provider solo la escribe su dueno (aiServiceFactory)', () => {
        const offenders = findProviderWriterOffenders(srcFiles());
        expect(
            offenders,
            `Escritores del provider fuera de su dueno (N=${offenders.length}); usa ` +
                `setPreferredAIProvider():\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
    it('el detector no es decorativo: marca la escritura directa y perdona la delegacion', () => {
        expect(
            findProviderWriterOffenders([
                { rel: 'src/core/autonomy/decisionEngine.ts', content: 'localSet(STORAGE_KEYS.AI_PROVIDER, p)' },
            ]),
        ).toHaveLength(1);
        expect(
            findProviderWriterOffenders([
                { rel: 'src/core/autonomy/decisionEngine.ts', content: 'setPreferredAIProvider(p)' },
                { rel: 'src/services/aiServiceFactory.ts', content: 'localSet(AI_PROVIDER_KEY, p)' },
            ]),
        ).toEqual([]);
    });
});

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const voiceLibFiles = (): Array<{ rel: string; content: string }> =>
    readdirSync(join(ROOT, 'src', 'voice', 'lib'))
        .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts'))
        .map((f) => ({ rel: `src/voice/lib/${f}`, content: read(`src/voice/lib/${f}`) }));
const srcFiles = (): Array<{ rel: string; content: string }> =>
    walkFiles(join(ROOT, 'src'), /\.(ts|tsx|js|jsx|mjs)$/).map((f) => ({
        rel: rel(f),
        content: readFileSync(f, 'utf8'),
    }));

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

// ---------------------------------------------------------------- D14
/** La supresion de eco del DESPACHO no puede volver a decidirse por TIEMPO.
 *
 * DEFECTO MEDIDO (2026-10-18, tests/e2e/musica-en-partida.spec.ts): con partida
 * activa, "Okay Flow pon musica relajante" llegaba al despacho con `speaking=true`
 * y el guard `if (isFluSpeaking()) return false` descartaba el turno en silencio
 * (fila de usuario escrita, sin accion). El eco ya se filtra por CONTENIDO en
 * `onresult` (78a0126); la misma pregunta en el despacho tiene que usar el mismo
 * comparador (`isAssistantVoiceEcho`), no el reloj.
 */
export function findTimeOnlyDispatchEchoGate(content: string, file = 'src/sintetico.js'): string[] {
    const out: string[] = [];
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
        if (!/\bisFluSpeaking\(\)/.test(line)) return;
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // La puerta puede escribir la condicion en varias lineas: se mira el bloque.
        const block = lines.slice(Math.max(0, i - 2), i + 8).join('\n');
        if (!/\bif\s*\(/.test(block)) return;
        if (!/\breturn\s+false\b/.test(block)) return;
        if (/isAssistantVoiceEcho/.test(block)) return;
        out.push(`${file}:${i + 1}:${line.trim().slice(0, 110)}`);
    });
    return out;
}

describe('D14 - el eco del DESPACHO se filtra por CONTENIDO, no por tiempo', () => {
    it('la puerta de eco del despacho (el modulo) compara por CONTENIDO, no por tiempo', () => {
        // Corte 2026-10-26: la puerta se movio del hook al MODULO (texto.ts filtra el
        // ASR con esEcoDeTts ANTES de que el texto llegue al despacho). Mismo guard:
        // sin puerta por TIEMPO y el comparador de contenido presente (anti-vacuidad).
        const texto = read('src/voice/conversation/texto.ts');
        const offenders = findTimeOnlyDispatchEchoGate(texto, 'src/voice/conversation/texto.ts');
        expect(
            offenders,
            `Puertas de despacho que descartan por TIEMPO (N=${offenders.length}); usa ` +
                `esEcoDeTts:\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
        // Anti-vacuidad: la puerta EXISTE y de verdad consulta el comparador.
        expect(texto).toContain('esEcoDeTts(');
    });
    it('el detector no es decorativo: marca el gate por tiempo y perdona el de contenido', () => {
        expect(findTimeOnlyDispatchEchoGate('if (isFluSpeaking()) {\n  return false\n}')).toHaveLength(1);
        expect(findTimeOnlyDispatchEchoGate('if (\n  isFluSpeaking()\n) {\n  return false\n}')).toHaveLength(1);
        expect(
            findTimeOnlyDispatchEchoGate(
                'if (isFluSpeaking() && isAssistantVoiceEcho(phrase, assistantText)) {\n  return false\n}',
            ),
        ).toHaveLength(0);
    });
});

describe('D2 - "es la MISMA locucion" tiene UNA memoria (el tramoId del modulo)', () => {
    it('el modulo no decide por el estado de la UI (un solo criterio: el tramoId)', () => {
        // Corte 2026-10-26: conversationStreamCommit (con su criterio de UI
        // `mismaLocucionViva`) se retira con la tuberia vieja. El dueno vivo de "es la
        // MISMA locucion" es el MODULO por tramoId (revision.ts: abierto.id !== tramoId)
        // y la memoria del despacho (audioMath.planConversationDispatch). Ninguna fuente
        // del modulo re-introduce un criterio de UI.
        const fuentes = ['texto.ts', 'tramos.ts', 'revision.ts', 'frontera.ts', 'cierre.ts', 'ingesta.ts', 'fila.ts', 'motor.ts', 'pasivo.ts', 'sesion.ts'];
        for (const f of fuentes) {
            const offenders = findUiLocutionCriteria(read('src/voice/conversation/' + f), 'src/voice/conversation/' + f);
            expect(
                offenders,
                `Segundo criterio de "misma locucion" en ${f} (N=${offenders.length}); el dueno es ` +
                    `el tramoId:\n  ${offenders.join('\n  ')}`,
            ).toEqual([]);
        }
        expect(read('src/voice/conversation/revision.ts'), 'el criterio vivo es el tramoId').toContain('abierto.id !== tramoId');
    });
    it('el detector no es decorativo: marca el criterio de UI y perdona el del despacho', () => {
        expect(findUiLocutionCriteria('const mismaLocucionViva = sameLiveEmission(prev, capture)')).toHaveLength(1);
        expect(findUiLocutionCriteria('const x = sameRequestAsLastDispatch(capture)')).toHaveLength(0);
    });
});

describe('D3 - "programar en idle" se retira sin dueño vivo', () => {
    it('ningun modulo de voz define scheduleIdle (el dueno se retiro)', () => {
        const offenders = countScheduleIdleDefs(voiceLibFiles());
        expect(
            offenders,
            `Definiciones de scheduleIdle (N=${offenders.length}); el programador de idle se ` +
                `retiro con la diarizacion en idle (sin consumidores):\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
    it('el detector no es decorativo: marca una definicion y perdona el consumo', () => {
        expect(
            countScheduleIdleDefs([{ rel: 'src/voice/lib/otro.js', content: 'function scheduleIdle(fn) {}' }]),
        ).toHaveLength(1);
        expect(
            countScheduleIdleDefs([{ rel: 'src/voice/lib/consumidor.js', content: "import { scheduleIdle } from './idleSchedule.js'" }]),
        ).toEqual([]);
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

// ---------------------------------------------------------------- D8
/** Campos del payload de sesion (Dexie) que DUPLICAN un ajuste con registro en localStorage. */
export function findSessionPayloadDuplicates(content: string, file: string): string[] {
    const duplicados = ['language', 'sessionRole'];
    const out: string[] = [];
    const m = content.match(/interface SessionState \{([\s\S]*?)\}/);
    if (!m) {
        out.push(file + ':sin-interface-SessionState');
        return out;
    }
    for (const linea of m[1].split(/\r?\n/)) {
        const campo = linea.trim().split(/[?:\s]/)[0];
        if (duplicados.includes(campo)) out.push(file + ':SessionState.' + campo);
    }
    return out;
}

describe('D8 - un valor, un almacen (idioma y rol no viajan en la sesion Dexie)', () => {
    it('el payload de sesion no repite ajustes cuyo registro es localStorage', () => {
        const offenders = findSessionPayloadDuplicates(
            read('src/hooks/useSessionPersistence.ts'),
            'src/hooks/useSessionPersistence.ts',
        );
        expect(
            offenders,
            'Valores con DOS almacenes (N=' + offenders.length + '); language/sessionRole tienen su ' +
                'registro en localStorage:\n  ' + offenders.join('\n  '),
        ).toEqual([]);
    });
    it('la llamada de App tampoco los pasa al almacen de sesion', () => {
        const app = read('src/App.tsx');
        const i = app.indexOf('useSessionPersistence({');
        const region = app.slice(i, app.indexOf('});', i));
        expect(/^\s*language,\s*$/m.test(region), 'App pasa language al almacen de sesion').toBe(false);
        expect(/^\s*sessionRole,\s*$/m.test(region), 'App pasa sessionRole al almacen de sesion').toBe(false);
    });
    it('el detector no es decorativo: marca el payload con el campo duplicado y perdona el saneado', () => {
        expect(
            findSessionPayloadDuplicates('export interface SessionState {\n    language: string;\n}', 'x.ts'),
        ).toHaveLength(1);
        expect(
            findSessionPayloadDuplicates('export interface SessionState {\n    activeTab: string;\n}', 'x.ts'),
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------- D9
describe('D9 - la revision del ASR la decide el planificador (un solo dueno)', () => {
    it('el hook no decide revisiones del ASR por su cuenta', () => {
        const hook = read('src/voice/hooks/useFluVoiceAssistant.js');
        expect(hook.includes('isAsrRevision'), 'el hook volvio a decidir la revision del ASR').toBe(false);
        expect(hook).toContain('lastPhrase: lastConversationActionRef.current.text');
    });
    it('el planificador la decide con la ventana de config (conducta)', async () => {
        const { planConversationDispatch } = await import('../src/voice/lib/audioMath.js');
        const { FLU_CONFIG } = await import('../src/voice/lib/fluConfig.js');
        const crece = 'Okay Flow platicame de los volcanes de islandia';
        const previa = 'Okay Flow platicame de los volcanes de islan';
        const base = { lastSignature: '', lastAt: Date.now(), lastPhrase: previa };
        expect(
            planConversationDispatch(crece, FLU_CONFIG.voiceCommands, base).plan,
            'la revision que CRECE dentro de la ventana debe deduplicarse',
        ).toBe('dedup');
        expect(
            planConversationDispatch(crece, FLU_CONFIG.voiceCommands, { ...base, lastPhrase: 'Okay Flow pon musica' }).plan,
            'una frase DISTINTA no es una revision',
        ).not.toBe('dedup');
        expect(
            planConversationDispatch(crece, FLU_CONFIG.voiceCommands, {
                ...base,
                lastAt: Date.now() - 60000,
            }).plan,
            'la misma revision FUERA de la ventana es una peticion nueva',
        ).not.toBe('dedup');
    });
    it('el detector no es decorativo: la ventana vive en config, no en el hook', async () => {
        const { FLU_CONFIG } = await import('../src/voice/lib/fluConfig.js');
        expect(Number(FLU_CONFIG.transcript.fluQuery.asrRevisionWindowMs)).toBeGreaterThan(0);
        expect(read('src/voice/lib/fluConfig.js')).toContain('asrRevisionWindowMs');
    });
});

// ---------------------------------------------------------------- D11
/** El escape que hace NO danino el par "log dedup" / "duplicate turn commit".
 *
 * CLASIFICACION MEDIDA (censo 2026-10-04): los CUATRO predicados de "¿esta emision es
 * una re-emision de la linea cerrada?" NO son la misma pregunta:
 *   - turnStream.isDuplicateTurnCommit  -> reloj del ASR (determinista, sin ventana)
 *   - activeListen.isRedundantFinal    -> estado del PREVIEW abierto + ventana de eco
 *   - conversationStream.isCommittedInterimEcho -> eco de commit en el INTERINO
 *     (su doc declara que NO duplica el comparador de revision de audioMath)
 *   - conversationSession.isDuplicateLogPhrase  -> la linea de LOG ya emitida
 * Cada uno decide en un punto distinto del pipeline y su modulo declara por que no es el
 * otro (AGENTS anexo B.14 + transcriptionDedupLoss.test.ts registran que colapsarlos rompio
 * turnos legitimos). Lo que SI es carga estructural: la repeticion tras una PAUSA tiene que
 * escapar del dedup del log, o el usuario repite la frase y su fila desaparece del historial.
 */
export function logDedupRespectsPause(src: string): boolean {
    return /!replaceLastRawLog\s*&&[\s\S]{0,120}isDuplicateLogPhrase\(/.test(src);
}

describe('D11 - la repeticion tras pausa conserva su fila (clasificacion, no unificacion)', () => {
    it('el dedup del log crudo se retiro y el MODULO nunca deduplica por texto entre turnos', async () => {
        // Corte 2026-10-26: el dedup del LOG crudo (isDuplicateLogPhrase) vivia en
        // conversationSession.js (borrado con la tuberia vieja) y su escape
        // `!replaceLastRawLog &&` murio con el. La regla viva es del MODULO: una fila
        // por turno, sin dedupe por texto — la repeticion tras pausa conserva su fila
        // por construccion. Se mide con la API real y se blinda que el dedup viejo no
        // vuelva al hook.
        const hook = read('src/voice/hooks/useFluVoiceAssistant.js');
        expect(hook.includes('isDuplicateLogPhrase'), 'el dedup del log crudo volvio al hook').toBe(false);

        const { crearConversacion } = await import('../src/voice/conversation/index');
        const { crearAlmacenMemoria, crearIdUuid, crearMedidorTramo, crearPartidorWake } = await import('../src/voice/conversation/adapters');
        const { isAutoSpeakerLabel } = await import('../src/voice/lib/speakerCore.js');
        const reloj = { ahora: () => 1_700_000_000_000 };
        const config: ConfigPort = {
            wakeWords: () => ['ok flu'],
            semillaEtiqueta: () => 'Hablante 1',
            esEtiquetaAnonima: isAutoSpeakerLabel,
            umbralContinuidadVoz: () => 0.8,
            etiquetaAnonima: (indice) => `Hablante ${indice}`,
            echoMinPalabrasCola: () => 4,
        };
        const api = crearConversacion({
            reloj,
            id: crearIdUuid(),
            registro: { registrar: () => undefined },
            almacen: crearAlmacenMemoria({ reloj }),
            config,
            partidor: crearPartidorWake(config),
            medidor: crearMedidorTramo(),
            ultimoTextoDicho: () => '',
        });
        await api.start();
        const bloque = (inicio: number, fin: number, medida: { hayVoz: boolean; silencioMs: number }) => ({
            muestras: new Float32Array(fin - inicio),
            sampleRate: 16000,
            inicio,
            fin,
            medida,
        });
        const voz = () => ({ hayVoz: true, silencioMs: 0 });
        // Turno 1: "hola", final.
        const tramoUno = await api.ingestAudio(bloque(0, 16000, voz()));
        const idUno = tramoUno.locucionAbierta?.locutionId;
        if (!idUno) throw new Error('el audio con voz no abrio locucion');
        // Caso 7+6: el final marca, no cierra; el corte de la pausa (candidato
        // negativo => finHabla = finPrevio) cierra el tramo POR CONTENIDO.
        await api.ingestAsr({ tramoId: idUno, texto: 'hola', final: true });
        // PAUSA (silencio >= 900) y turno 2 con la MISMA frase: su fila NO desaparece.
        const trasPausa = await api.ingestAudio(bloque(16000, 16000 + 4000, { hayVoz: false, silencioMs: 4000 }));
        expect(trasPausa.filas.map((fila) => fila.texto)).toEqual(['hola']);
        const tramoDos = await api.ingestAudio(bloque(20000, 36000, voz()));
        const idDos = tramoDos.locucionAbierta?.locutionId;
        if (!idDos) throw new Error('el segundo tramo no abrio locucion');
        await api.ingestAsr({ tramoId: idDos, texto: 'hola', final: true });
        // Corte de 900 ms que arranca en el fin del tramo: cierra por contenido.
        const cierreDos = await api.ingestAudio(bloque(36000, 36000 + 14400, { hayVoz: false, silencioMs: 900 }));
        expect(cierreDos.filas.map((fila) => fila.texto), 'la repeticion tras pausa conserva su fila').toEqual(['hola', 'hola']);
    });
    // RETIRADO (corte 2026-10-26) el test del censo "los cuatro predicados siguen
    // existiendo en su modulo": turnStream.isDuplicateTurnCommit, activeListen.
    // isRedundantFinal y conversationStream.isCommittedInterimEcho viven en islas de la
    // tuberia vieja (sin consumidores en src, se retiran en este corte); isDuplicateLogPhrase
    // ya se borro con conversationSession.js el 2026-10-25. La clasificacion "no
    // colapsarlos en uno" queda registrada en AGENTS.md Anexo B.14 y cubierta por
    // spokenUtteranceRevision.test.ts y transcriptionDedupLoss.test.ts.
    it('el detector no es decorativo: marca el dedup sin escape y perdona el que lo tiene', () => {
        expect(logDedupRespectsPause('if (isDuplicateLogPhrase(capture, prev)) return false')).toBe(false);
        expect(
            logDedupRespectsPause('if (!replaceLastRawLog && isDuplicateLogPhrase(capture, prev)) return false'),
        ).toBe(true);
    });
});

// ---------------------------------------------------------------- D12
/** D12 (P8.47) — El RESPALDO no puede declarar lo que no hizo.
 *
 * HALLAZGO medido por el spec e2e de P8.47 (tests/e2e/autonomia-respaldo.spec.ts), que
 * existe porque la autonomia era un hueco declarado: createEmergencyBackup ->
 * createManualBackup(['all']) -> createBackup guardaba 'all' SIN EXPANDIR, asi que el bucle
 * de extraccion recorria 'all' (extractComponent('all') del caso individual no extrae nada)
 * y la metadata declaraba ['all']; y restoreBackup filtraba metadata.components.filter(c =>
 * c !== 'all') -> lista VACIA -> 0 restaurados y `success: true`. Medido en el navegador:
 * success=true con restoredComponents=[] y el valor cambiado NO volvia (7.7.c).
 */
export function findFakeBackupSuccess(src: string): string[] {
    const out: string[] = [];
    if (!/failedComponents\.length === 0 && restoredComponents\.length > 0/.test(src)) {
        out.push('backupSystem:success-sin-restaurar-nada');
    }
    return out;
}
export function findUnexpandedAll(src: string): string[] {
    const out: string[] = [];
    if (!/resolveBackupComponents\(components\)/.test(src)) out.push('backupSystem:extractor-sin-expandir');
    if (!/components: capturados/.test(src)) out.push('backupSystem:metadata-con-la-lista-pedida');
    if (!/NOT_RESTORABLE_COMPONENTS/.test(src)) out.push('backupSystem:no-declara-lo-no-restaurable');
    return out;
}

describe('D12 - el respaldo declara lo que TIENE y no declara exito sin restaurar', () => {
    it('la copia expande "all", declara lo capturado y no miente con el exito', () => {
        const src = read('src/core/autonomy/backupSystem.ts');
        const offenders = [...findUnexpandedAll(src), ...findFakeBackupSuccess(src)];
        expect(offenders, 'Defectos de respaldo (N=' + offenders.length + '):\\n  ' + offenders.join('\\n  ')).toEqual([]);
    });
    it('el detector no es decorativo: marca el exito vacio y la metadata sin expandir', () => {
        expect(findFakeBackupSuccess('const success = failedComponents.length === 0;')).toHaveLength(1);
        expect(
            findFakeBackupSuccess(
                'const success = failedComponents.length === 0 && restoredComponents.length > 0;',
            ),
        ).toEqual([]);
        expect(findUnexpandedAll('for (const c of components) {}')).toHaveLength(3);
        expect(
            findUnexpandedAll(
                'resolveBackupComponents(components) components: capturados NOT_RESTORABLE_COMPONENTS',
            ),
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------- D13
/** Marcas de una reimplementacion de "hace falta wake word?" fuera de su dueno. */
export function countWakeRequirementDefs(
    files: Array<{ rel: string; content: string }>,
    owner = 'src/voice/lib/wakeTurnCommit.js',
): string[] {
    return files
        .filter((f) => f.rel !== owner && /requireWakeAlways\s*!==\s*false/.test(f.content))
        .map((f) => `${f.rel}:requireWakeAlways !== false`);
}

// ---------------------------------------------------------------- D15
/** Marcas de un gate BOOLEANO sobre el despacho ASINCRONO de conversacion.
 *
 * DEFECTO MEDIDO (2026-10-19): `buildConversationIngressCtx` construia
 * `tryDispatch: (t, o) => bindings.tryDispatchConversationAction?.(t, o) === true`.
 * El despacho real es `async` (devuelve Promise), asi que `Promise === true` era
 * SIEMPRE falso: las ramas que esperaban `dispatched: true` / `handled: true`
 * quedaron como codigo muerto y el rechazo viajaba como promesa suelta. El contrato
 * es fire-and-forget: el resultado NO decide nada; el commit de la fila lo gobierna
 * su escritor unico. Un `await` SI resuelve el valor y por eso no se marca.
 */
export function findPromiseBooleanGates(
    files: Array<{ rel: string; content: string }>,
): string[] {
    const out: string[] = [];
    for (const f of files) {
        f.content.split(/\r?\n/).forEach((line, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
            if (!/\btryDispatch(?:ConversationAction)?\b/.test(line)) return;
            if (/\bawait\b/.test(line)) return;
            const gates =
                /\b(?:if|while)\s*\(/.test(line) ||
                /[=!]==?\s*true\b/.test(line) ||
                /(?:&&|\|\|)/.test(line);
            if (!gates) return;
            out.push(`${f.rel}:${i + 1}:${line.trim().slice(0, 110)}`);
        });
    }
    return out;
}

describe('D15 - el despacho asincrono no se decide convirtiendo la Promise en booleano', () => {
    it('ningun consumidor gatea con el valor del despacho asincrono', () => {
        const offenders = findPromiseBooleanGates(srcFiles());
        expect(
            offenders,
            `Gates booleanos sobre el despacho asincrono (N=${offenders.length}):\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
        // Anti-vacuidad: el despacho EXISTE, es asincrono y su rechazo se registra
        // (el unico llamador que lo ignora es `onFraseCanonica` del motor).
        const hook = read('src/voice/hooks/useFluVoiceAssistant.js');
        expect(/const tryDispatchConversationAction = useCallback\(/.test(hook)).toBe(true);
        expect(/Promise\.resolve\(pending\)\.catch\(/.test(hook)).toBe(true);
        expect(/logCaughtError\('useFluVoiceAssistant\.tryDispatchConversationAction'/.test(hook)).toBe(true);
    });

    it('el detector no es decorativo: marca el gate booleano y perdona la llamada directa y el await', () => {
        expect(
            findPromiseBooleanGates([
                {
                    rel: 'src/voice/lib/x.js',
                    content:
                        'tryDispatch: (t, o) => bindings.tryDispatchConversationAction?.(t, o) === true',
                },
            ]),
        ).toHaveLength(1);
        expect(
            findPromiseBooleanGates([
                { rel: 'src/voice/lib/x.js', content: 'if (ctx.tryDispatch?.(capture, opts)) {' },
            ]),
        ).toHaveLength(1);
        expect(
            findPromiseBooleanGates([
                { rel: 'src/voice/lib/x.js', content: 'ctx.tryDispatch?.(capture, opts)' },
            ]),
        ).toEqual([]);
        expect(
            findPromiseBooleanGates([
                { rel: 'src/voice/lib/x.js', content: 'const ok = (await tryDispatchConversationAction(t)) === true' },
            ]),
        ).toEqual([]);
    });
});

describe('D13 - un solo dueno de "hace falta wake word?" (requireWakeAlways)', () => {
    it('la decision solo la implementa wakeTurnCommit; los consumidores la llaman', () => {
        const files = srcFiles();
        // Anti-vacuidad: el dueno EXISTE y contiene de verdad la decision.
        const owner = files.find((f) => f.rel === 'src/voice/lib/wakeTurnCommit.js');
        expect(owner, 'el dueno no aparece en el escaneo').toBeTruthy();
        expect(/requireWakeAlways\s*!==\s*false/.test(owner?.content || '')).toBe(true);
        // N>1 = ruta doble: antes estaba en 3 sitios (2 en el hook + 1 en el commit).
        expect(countWakeRequirementDefs(files)).toEqual([]);
    });

    it('el detector no es decorativo: marca la reimplementacion y perdona la llamada al dueno', () => {
        expect(
            countWakeRequirementDefs([
                {
                    rel: 'src/voice/hooks/x.js',
                    content: `const r = FLU_CONFIG.voiceCommands.requireWakeAlways !== false || !active`,
                },
            ]),
        ).toHaveLength(1);
        expect(
            countWakeRequirementDefs([{ rel: 'src/voice/hooks/x.js', content: `const r = requiresWakeWord(active)` }]),
        ).toEqual([]);
        // El dueno no se marca a si mismo.
        expect(
            countWakeRequirementDefs([
                {
                    rel: 'src/voice/lib/wakeTurnCommit.js',
                    content: `return config.voiceCommands?.requireWakeAlways !== false || !conversationActive`,
                },
            ]),
        ).toEqual([]);
    });
});
