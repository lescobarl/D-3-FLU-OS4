// @vitest-environment jsdom
/**
 * voice/lib/fluDebug — modo debug: contadores, invariantes y API dev (0% -> cubierto).
 *
 * POR QUE ESTE TEST: `src/voice/lib/fluDebug.js` (914 lineas) es el INSTRUMENTO
 * con el que el propio proyecto se vigila: contadores del hot path mic->UI,
 * `runFluDebugChecks()` (28 invariantes) y el informe que el dueno mira en
 * pantalla. Estaba al 0%: nadie ejecutaba los checks, asi que un check podia
 * quedar invertido o vacio sin que nada lo notara. Aqui se fijan POR CONDUCTA:
 * que cada contador siga a su evento, que los umbrales anti-vacuidad de los
 * checks existan, y que la API (`__fluDebug`) no exponga estado interno mutable.
 *
 * jsdom: `subscribeFluDebug`/`mountFluDebugDev` son contadores de ventana
 * (window.setInterval / window.__fluDebug), asi que el arnes necesita window.
 *
 * NOTA: el punto de entrada del hot path (`fluDebugHot`) solo existe en dev, y
 * esta suite corre SIEMPRE en dev (es el modo del proyecto). Por eso los dos
 * casos del hot path se afirman sin condicion: si algun dia corrieran en build
 * de produccion, el early-return haria caer la asercion, que es lo correcto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearFluDebug,
    debugRecordCommandDispatch,
    debugRecordCommitCapture,
    debugRecordHistoryError,
    debugRecordLogEmit,
    debugRecordMic,
    debugRecordMicFragments,
    debugRecordPromptBudget,
    debugRecordSpeakerNew,
    debugRecordSpeakerPrune,
    debugRecordSpeakerSticky,
    debugRecordSrGapCommit,
    debugRecordStreamEmit,
    debugRecordStreamSkip,
    debugRecordWorkspaceImage,
    debugUpdateContext,
    disableFluDebug,
    enableFluDebug,
    fluDebugHot,
    getFluDebugApi,
    getFluDebugReport,
    initFluDebug,
    isFluDebugEnabled,
    mountFluDebugDev,
    runFluDebugChecks,
    subscribeFluDebug,
} from '../src/voice/lib/fluDebug.js';

/** Check por id, con la comprobacion viva (no una copia de la regla). */
const check = (id: string) => runFluDebugChecks().find((c) => c.id === id);
const violationIds = () => getFluDebugReport().recentViolations.map((v) => v.checkId);

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    clearFluDebug();
    enableFluDebug();
});

afterEach(() => {
    disableFluDebug();
    vi.useRealTimers();
    Reflect.deleteProperty(window, '__fluDebug');
    vi.restoreAllMocks();
});

describe('fluDebug — encendido y apagado', () => {
    it('el flag manual manda sobre la config y el modo arranca encendido en dev', () => {
        expect(isFluDebugEnabled()).toBe(true);
        expect(initFluDebug()).toBe(true);

        disableFluDebug();
        expect(isFluDebugEnabled()).toBe(false);
        expect(initFluDebug()).toBe(false);

        enableFluDebug();
        expect(initFluDebug()).toBe(true);
    });
});

describe('fluDebug — contadores del informe', () => {
    it('cada evento mueve su contador y deja su ultimo valor', () => {
        debugRecordMic('hola que tal', '');
        debugRecordStreamEmit('hola que tal', true, false, false, 'hola que tal');
        debugRecordLogEmit('hola que tal', 'Hablante 1', false);
        debugUpdateContext('listening', true, 1);

        const report = getFluDebugReport();

        expect(report.counters.micEvents).toBe(1);
        expect(report.counters.streamSyncs).toBe(1);
        expect(report.counters.logEmits).toBe(1);
        expect(report.counters.rowOpens).toBe(1);
        expect(report.last.micInterim).toBe('hola que tal');
        expect(report.last.live).toBe('hola que tal');
        expect(report.last.log).toBe('hola que tal');
        expect(report.last.speaker).toBe('Hablante 1');
        expect(report.summary).toMatch(/^\d+\/\d+ OK$/);
        expect(report.checks.length).toBe(runFluDebugChecks().length);
        expect(report.recentViolations).toEqual([]);
    });

    it('clearFluDebug deja una sesion NUEVA: contadores, ultimo valor y contexto', () => {
        debugRecordHistoryError('fallo');
        debugRecordStreamSkip('empty-capture');
        debugRecordStreamEmit('hola', true, false, false, '');
        debugRecordLogEmit('hola', 'Hablante 1', false);
        debugUpdateContext('listening', true, 7);
        expect(getFluDebugReport().counters.violations).toBeGreaterThan(0);

        clearFluDebug();
        const report = getFluDebugReport();

        expect(report.counters.micEvents).toBe(0);
        expect(report.counters.streamSkips).toBe(0);
        expect(report.counters.logEmits).toBe(0);
        expect(report.counters.violations).toBe(0);
        expect(report.last.micInterim).toBe('');
        expect(report.last.log).toBe('');
        expect(report.last.speaker).toBe('');
        // El CONTEXTO no se hereda: la sesion anterior dejo 7 filas y "listening".
        expect(check('log-rows-tracked')?.detail).toBe('0 filas UI / 0 debug');
        expect(check('log-rows-tracked')?.pass).toBe(true);
        expect(check('recognition-alive')?.detail).toBe('idle');
    });
});

describe('fluDebug — invariantes de paridad y retroceso', () => {
    it('una locucion de mic distinta a la ultima frase rompe la paridad', () => {
        debugRecordStreamEmit('estamos en clase de matematicas', false, false, false, '');
        debugRecordMic('el perro come huesos', '');

        expect(check('mic-live-parity')?.pass).toBe(false);
        expect(violationIds()).toContain('mic-live-parity');
        expect(check('no-recent-violations')?.pass).toBe(false);
    });

    it('la ultima frase y el log no pueden retroceder', () => {
        debugRecordStreamEmit('hola como estas en clase', false, false, false, '');
        debugRecordStreamEmit('hola como', false, false, false, '');
        expect(check('no-live-shrink')?.pass).toBe(false);

        debugRecordLogEmit('hola como estas en clase', 'Hablante 1', false);
        debugRecordLogEmit('hola como', 'Hablante 1', true);
        expect(check('no-log-shrink')?.pass).toBe(false);
    });

    it('una fila nueva no puede empezar con el texto completo de la anterior', () => {
        debugRecordLogEmit('hola como estas', 'Hablante 1', false);
        debugRecordLogEmit('hola como estas en clase', 'Hablante 1', false);

        expect(check('log-no-prefix-dup')?.pass).toBe(false);
        expect(violationIds()).toContain('log-row-prefix-dup');
    });

    it('el final no puede acortar el preview mostrado (TV)', () => {
        debugRecordCommitCapture({
            final: 'hola como',
            capture: 'hola como',
            preview: 'hola como estas en clase',
        });

        expect(check('final-preview-preserve')?.pass).toBe(false);
        expect(violationIds()).toContain('final-shorter-than-preview');
    });

    it('la diarizacion en limite de turno se marca', () => {
        debugRecordSpeakerSticky('Hablante 2', 'hola');

        expect(check('speaker-turn-boundary')?.pass).toBe(false);
    });

    it('fragmentos ASR: interino truncado, final perdido y final mas corto que el interino', () => {
        debugRecordMicFragments(
            ['hola como estas en la clase de hoy', 'otra cosa'],
            [],
            'texto distinto',
        );
        expect(violationIds()).toContain('interim-truncated');

        // El motor se queda con el fragmento MAS LARGO y pierde el "juro" corto.
        debugRecordMicFragments([], ['juro', 'la bandera de mi patria'], 'juro la bandera de mi patria');
        expect(violationIds()).toContain('final-fragment-lost');

        debugRecordMicFragments([], ['el juramento'], 'el juramento a la bandera');
        expect(check('final-preview-preserve')?.detail).toContain('final<interim');
    });
});

describe('fluDebug — invariantes de dominio', () => {
    it('presupuesto de KB de minutas: por encima del tope, el check cae', () => {
        const top = 24;
        debugRecordPromptBudget({
            kind: 'minute-knowledge-sync',
            rows: 30,
            promptRows: top,
            promptChars: 1_200,
        });
        expect(check('minute-knowledge-budget')?.pass).toBe(true);

        debugRecordPromptBudget({
            kind: 'minute-knowledge-sync',
            rows: 30,
            promptRows: 30,
            promptChars: 1_500,
        });
        expect(check('minute-knowledge-budget')?.pass).toBe(false);
        expect(getFluDebugReport().counters.minuteKnowledgePromptRows).toBe(30);
    });

    it('flujo de imagen del workspace: un fallo deja el check en rojo y sin peticion no cuenta', () => {
        debugRecordWorkspaceImage({ requested: false, source: 'ni-se-cuenta' });
        expect(getFluDebugReport().counters.workspaceImageRequests).toBe(0);

        debugRecordWorkspaceImage({ requested: true, success: true, source: 'imageGeneration' });
        expect(check('workspace-image-flow')?.pass).toBe(true);

        debugRecordWorkspaceImage({ requested: true, success: false, source: 'imageGeneration' });
        expect(check('workspace-image-flow')?.pass).toBe(false);
        expect(getFluDebugReport().counters.workspaceImageFail).toBe(1);
    });

    it('indices de Hablante sin saltos y poda de clusters fantasma', () => {
        debugRecordSpeakerPrune([], ['Hablante 1', 'Hablante 3']);
        expect(check('speaker-index-gaps')?.pass).toBe(false);

        debugRecordSpeakerPrune(['Hablante 5'], ['Hablante 1', 'Hablante 2']);
        expect(check('speaker-index-gaps')?.pass).toBe(true);
        expect(check('speaker-ghost-prune')?.pass).toBe(false);

        debugRecordSpeakerNew('Hablante 1', 'Hablante 2', true);
        expect(getFluDebugReport().counters.speakerNews).toBe(1);
    });

    it('comandos: solo el despacho canonico cuenta; lo demas es violacion', () => {
        debugRecordCommandDispatch({ plan: 'dispatch', command: 'ABRIR_MINUTA', source: 'voz' });
        expect(check('command-dispatch')?.pass).toBe(true);

        debugRecordCommandDispatch({ plan: 'dispatch', command: 'abrir la minuta', source: 'voz' });
        expect(check('command-dispatch')?.pass).toBe(false);
        expect(violationIds()).toContain('unknown-navigation-command');

        debugRecordCommandDispatch({ plan: 'skip', command: '', reason: 'wait', interim: true });
        expect(getFluDebugReport().counters.streamSkips).toBe(0);
        expect(violationIds()).toContain('command-interim-wait');
    });

    it('el SR con hueco tambien se registra (captura + tiempo)', () => {
        debugRecordSrGapCommit({ capture: 'hola', sinceLastResultMs: 12_000, reason: 'sr-gap' });

        expect(violationIds()).toContain('sr-gap-segment-commit');
    });

    it('vivo tolerado: el check de reconocimiento solo se enciende con stall real', () => {
        vi.useFakeTimers();
        clearFluDebug();
        debugUpdateContext('listening', true, 1);
        expect(check('recognition-alive')?.pass).toBe(true);

        vi.advanceTimersByTime(52_000 * 1.6);
        expect(check('recognition-alive')?.pass).toBe(false);
    });

    it('los checks anti-vacuidad tienen umbral: 10 syncs sin filas dejan el log en rojo', () => {
        // Sin fijar el contexto a mano: esto mide que clearFluDebug (en el beforeEach)
        // SI deja la sesion en cero. Si volviera a heredar logRowCount, este caso cae.
        for (let i = 0; i < 10; i += 1) {
            debugRecordStreamEmit(`vuelta ${i}`, false, false, false, '');
        }
        for (let i = 0; i < 90; i += 1) {
            debugRecordStreamSkip('empty-capture');
        }

        expect(check('stream-throughput')?.pass).toBe(false);
        expect(check('stream-throughput')?.detail).toBe('10 sync / 90 skip');
        expect(check('log-rows-tracked')?.pass).toBe(false);

        debugUpdateContext('idle', false, 2);
        expect(check('log-rows-tracked')?.pass).toBe(true);
    });

    it('el informe del dueno trae los invariantes de configuracion de producto', () => {
        // TV: la tolerancia de pausa del SR no puede bajar del umbral de producto.
        expect(check('tv-stall-tolerance')?.pass).toBe(true);
        expect(check('tv-stall-tolerance')?.detail).toMatch(/^stallMs=\d+$/);
        // Cambio de hablante: no se vacia el preview en el limite de turno.
        expect(check('speaker-change-preserve')?.pass).toBe(true);
    });
});

describe('fluDebug — ring de violaciones y crasheo del hot path', () => {
    it('el ring de violaciones esta acotado (no crece sin limite)', () => {
        for (let i = 0; i < 45; i += 1) {
            debugRecordHistoryError(`error ${i}`);
        }

        expect(getFluDebugReport().counters.violations).toBe(40);
        expect(check('no-history-errors')?.pass).toBe(false);
    });

    it('fluDebugHot nunca lanza: si el registro falla, lo deja como violacion', () => {
        const bomba = new Proxy({}, { get() { throw new Error('boom'); } });

        expect(() => fluDebugHot('mic-fragments', { rawInterims: bomba })).not.toThrow();
        expect(violationIds()).toContain('debug-hot-crash');
    });

    it('fluDebugHot enruta las acciones conocidas del hot path', () => {
        fluDebugHot('stream-skip', { reason: 'empty-capture' });
        fluDebugHot('log-emit', { text: 'hola', speaker: 'Hablante 1', replaceLast: false });
        fluDebugHot('accion-desconocida', {});

        const report = getFluDebugReport();

        expect(report.counters.streamSkips).toBe(1);
        expect(report.counters.logEmits).toBe(1);
        expect(report.last.log).toBe('hola');
    });
});

describe('fluDebug — API dev (__fluDebug)', () => {
    it('violations() devuelve copia: el estado interno no se puede mutar desde fuera', () => {
        debugRecordHistoryError('fallo');
        const api = getFluDebugApi();

        const copia = api.violations();
        copia.push({ t: 0, checkId: 'inyectado', detail: null });

        expect(api.violations().map((v) => v.checkId)).not.toContain('inyectado');
        expect(api.enabled()).toBe(true);

        api.clear();
        expect(api.violations()).toEqual([]);
    });

    it('mountFluDebugDev publica la API en window y subscribeFluDebug avisa por refresco', () => {
        mountFluDebugDev();
        const publicada = (window as unknown as { __fluDebug?: { report: () => unknown } }).__fluDebug;
        expect(typeof publicada?.report).toBe('function');

        vi.useFakeTimers();
        const listener = vi.fn();
        const unsubscribe = subscribeFluDebug(listener);

        expect(listener).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1_500);
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        vi.advanceTimersByTime(6_000);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
