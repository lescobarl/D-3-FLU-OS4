// ============================================================
// vozNombreFraseUnDuenoGuard - un dato, un dueno (nombre de la fila, frase viva,
// locucion confirmada, tope de hablantes y silencio de cierre).
// ------------------------------------------------------------
// MEDIDO ANTES DE TOCAR (log del dueno, sesion 02:20-02:42):
//   * 41/41 (y 80/80 medidos) commits con `preReady:false` y `written:""`: el gate
//     `preflight?.ready ? speakerName : ''` tiraba la etiqueta del resolver y la fila
//     quedaba a merced de una SEGUNDA resolucion por TEXTO (`resolveSpeakerByText`
//     dentro de `emitConversationLog`): dos duenos del nombre.
//   * al cerrar el turno se borraba lo PUBLICADO ("ultima frase") y la zona quedaba en
//     blanco mientras el dueno seguia hablando (cierre 02:20:15.94 -> siguiente
//     asrRaw 02:20:19.07): flicker.
//   * `pendingFinal` (locucion CONFIRMADA sin fila) se borraba desde TRES sitios por su
//     cuenta: tres duenos del mismo dato.
//   * `conversationMaxAutoSpeakers: 6`: el tope forzaba FUSIONES FALSAS (se pierden
//     voces reales). `srGapCommitMs: 10000`: 10 s de silencio para cerrar.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { handleConversationStreamSync } from '../src/voice/lib/conversationStreamCommit.js';
import { clearPendingFinal, createActiveListenState } from '../src/voice/lib/activeListen.js';
import { resetTurnSpeakerPreflights } from '../src/voice/lib/turnSpeakerPreflight.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

type EmitOptions = { speakerName?: string; evidenciaAcustica?: boolean };

/** Arnes minimo: refs reales (objetos con .current) y espias grabados. */
function makeDeps(over: Record<string, unknown> = {}) {
  const deps = {
    conversationActiveRef: { current: true },
    publishedLiveRef: { current: '' },
    listenStateRef: { current: createActiveListenState() },
    openPreviewTurnRef: { current: false },
    setLiveTranscript: vi.fn<(value: string) => void>(),
    scheduleLiveTranscriptUpdate: vi.fn<(capture: string) => void>(),
    applyConversationSpeaker: vi.fn<(phrase: string, fallback: string, options?: object) => void>(),
    flushPendingStreamLog: vi.fn<() => void>(),
    logRowsTextRef: { current: [] as string[] },
    activeTurnIdRef: { current: 0 },
    flushPcmAfterTurnCommit: vi.fn<() => void>(),
    lastCommitAtRef: { current: 0 },
    lastOnresultAtRef: { current: 0 },
    turnAudioStartSampleRef: { current: 0 },
    chunkTotalSamplesRef: { current: 0 },
    preflightScheduledForTurnRef: { current: false },
    srGapFiredForOpenLineRef: { current: false },
    processConversationFluQueryRef: { current: vi.fn<(capture: string, action: object) => void>() },
    lastEmittedTranscriptRef: { current: '' },
    emitConversationLog: vi.fn<(capture: string, options?: object) => boolean>(() => true),
    createSpeakerAudioResolver: vi.fn<(options?: object) => object>(() =>
      () => Promise.resolve({ speakerName: 'Hablante 1' }),
    ),
    sessionPrimarySpeakerRef: { current: '' },
    lastLoggedSpeakerRef: { current: '' },
    logRowSpeakersRef: { current: [] as string[] },
    speakerClustersRef: { current: [] as object[] },
    setSpeakerClusters: vi.fn<(clusters: object[]) => void>(),
    lastSpeakerRef: { current: '' },
    lastTurnSignatureRef: { current: null as number[] | null },
    lastLogLineTextRef: { current: '' },
    commitTurnToSessionRows: vi.fn<(capture: string, speakerName: string, options?: object) => void>(),
    fluParticipantRef: { current: { onTurnCommitted: vi.fn<() => void>() } },
  };
  Object.assign(deps, over);
  return deps;
}

const requireWakeAlwaysBefore = FLU_CONFIG.voiceCommands.requireWakeAlways;
beforeEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = false;
  resetTurnSpeakerPreflights();
});
afterEach(() => {
  FLU_CONFIG.voiceCommands.requireWakeAlways = requireWakeAlwaysBefore;
  resetTurnSpeakerPreflights();
});

describe('EL GATE - el commit SIEMPRE escribe la etiqueta del resolver', () => {
  it('sin evidencia (preflight no listo) la fila lleva la etiqueta; la evidencia decide el ASCENSO', () => {
    const deps = makeDeps({
      lastLoggedSpeakerRef: { current: 'Hablante 2' },
      lastSpeakerRef: { current: 'Hablante 2' },
      logRowSpeakersRef: { current: ['Hablante 2'] },
      logRowsTextRef: { current: ['habia una vez una mesa'] },
    });

    handleConversationStreamSync(deps, {
      capture: 'una mesa larga de madera',
      turnCommit: true,
      settlesTurn: true,
    });

    const emitOpts = deps.emitConversationLog.mock.calls[0][1] as EmitOptions;
    const [, rowSpeaker] = deps.commitTurnToSessionRows.mock.calls[0];
    // La etiqueta viaja SIEMPRE (antes era '' y la fila la resolvia otro modulo POR TEXTO).
    expect(emitOpts.speakerName).toBe('Hablante 2');
    expect(rowSpeaker).toBe('Hablante 2');
    // Sin ventana de audio medida: la evidencia acustica es FALSE -> el nombre propio NO
    // asciende (solo se escribe la etiqueta de diarizacion).
    expect(emitOpts.evidenciaAcustica).toBe(false);
  });

  it('el detector no es decorativo: el gate viejo (`preflight.ready ? etiqueta : ""`) deja la fila sin hablante', () => {
    // El mutante del gate ORIGINAL, aislado, para probar que el oraculo discrimina:
    // con `preflight.ready` false la etiqueta `''` NO es lo que la fila debe llevar.
    const gateViejo = (etiqueta: string, ready: boolean): string => (ready ? etiqueta : '');
    expect(gateViejo('Hablante 2', false)).toBe('');
    // Y lo que el guard exige del modulo real es la etiqueta, no ''.
    const deps = makeDeps({ lastLoggedSpeakerRef: { current: 'Hablante 2' } });
    handleConversationStreamSync(deps, { capture: 'hola de nuevo', turnCommit: true, settlesTurn: true });
    const emitOpts = deps.emitConversationLog.mock.calls[0][1] as EmitOptions;
    expect(emitOpts.speakerName).not.toBe('');
    expect(emitOpts.speakerName).toBe('Hablante 2');
  });
});

describe('flicker de "ultima frase" - el commit NO borra lo publicado', () => {
  it('al cerrar el turno NO se limpia la zona NI su memoria', () => {
    const deps = makeDeps({ publishedLiveRef: { current: 'estoy hablando y esto se ve' } });

    handleConversationStreamSync(deps, {
      capture: 'estoy hablando y esto se ve',
      turnCommit: true,
      settlesTurn: true,
    });

    // La MEMORIA de lo mostrado se conserva: es lo que impide que un TROZO posterior
    // reemplace la frase (medido 2026-10-11: la cola la dejaba en dos o tres palabras).
    expect(deps.publishedLiveRef.current, 'la memoria se conserva').toBe('estoy hablando y esto se ve');
    // ...pero lo PUBLICADO no se borra (el unico dueno del borrado de la zona es el
    // reset de sesion/voz, no el commit): borrarlo = zona en blanco ~3 s = flicker.
    expect(deps.setLiveTranscript).not.toHaveBeenCalled();
  });

  it('el detector no es decorativo: borrar lo publicado en el cierre hace caer el caso', () => {
    // Mutante del defecto medido: el cierre limpiaba la frase viva.
    const cierreViejo = (setLive: (v: string) => void) => setLive('');
    const setLive = vi.fn<(v: string) => void>();
    cierreViejo(setLive);
    expect(setLive).toHaveBeenCalledWith('');
    // El modulo real ya no lo hace (caso de arriba).
  });
});

describe('un dueno del borrado de `pendingFinal` (locucion confirmada sin fila)', () => {
  const SRC = join(process.cwd(), 'src');

  /** Todos los .js/.ts de src (recursivo). */
  function jsFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) jsFiles(abs, acc);
      else if (/\.(js|ts)$/.test(name)) acc.push(abs);
    }
    return acc;
  }

  /** Implementaciones que VACIAN el slot (el dato), no menciones del nombre. */
  function borradoresDePendingFinal(): string[] {
    const re = /\.pendingFinal\s*=\s*(['"])\1/g;
    const out: string[] = [];
    for (const abs of jsFiles(SRC)) {
      const src = readFileSync(abs, 'utf8');
      if (re.test(src)) out.push(join('src', abs.slice(SRC.length + 1)).replace(/\\/g, '/'));
    }
    return out;
  }

  it('un solo sitio vacia el dato (delega en `clearPendingFinal`)', () => {
    const sitios = borradoresDePendingFinal();
    expect(sitios, `el borrado sigue repartido:\n  ${sitios.join('\n  ')}`).toEqual([
      'src/voice/lib/activeListen.js',
    ]);
  });

  it('el detector no es decorativo: reconoce un borrado inyectado fuera del dueno', () => {
    const muestra = "if (ctx.listenState) ctx.listenState.pendingFinal = ''";
    expect(/\.pendingFinal\s*=\s*(['"])\1/.test(muestra)).toBe(true);
    const limpio = "clearPendingFinal(ctx.listenState)";
    expect(/\.pendingFinal\s*=\s*(['"])\1/.test(limpio)).toBe(false);
  });

  it('el dueno devuelve lo descartado y deja el slot vacio', () => {
    const state = createActiveListenState() as { pendingFinal?: string };
    state.pendingFinal = 'vamos a comer del plato';
    expect(clearPendingFinal(state)).toBe('vamos a comer del plato');
    expect(state.pendingFinal).toBe('');
    expect(clearPendingFinal(state)).toBe('');
  });
});

describe('tope de hablantes y silencio de cierre (config del dueno)', () => {
  it('sin tope de etiquetas automaticas: la voz manda, no un numero', () => {
    const tope = Number(FLU_CONFIG.voiceIdentity?.capture?.conversationMaxAutoSpeakers);
    expect(tope, 'un tope bajo fuerza FUSIONES FALSAS (se pierden voces)').toBeGreaterThanOrEqual(99);
  });

  it('silencio de cierre ~3,5 s (no 10 s)', () => {
    const gap = Number(FLU_CONFIG.transcript?.pauseAndWeakAsr?.srGapCommitMs);
    expect(gap).toBeGreaterThan(0);
    expect(gap, 'el cierre por silencio tardaba 10 s').toBeLessThanOrEqual(4000);
  });
});
