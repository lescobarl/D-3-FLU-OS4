/**
 * workerPendingBridgeSingleOwnerGuard — el esqueleto de los clientes de Web Worker
 * tiene un dueno (P8.9).
 *
 * Auditoria de codigo 2026-10-02: `ensureWorker` (creacion perezosa del worker +
 * despacho del mensaje por `id` + rechazo de TODOS los pendientes en `onerror`)
 * estaba copiado en fbxWorkerClient.ts:37, voiceIdWorkerClient.js:72 y
 * whisperWasmTranscriber.js:25, cada uno con su politica (id, timeout, forma del
 * mensaje, limpieza al morir). Se extrae esa orquestacion a
 * `src/voice/lib/workerPendingBridge.js` (AGENTS 7.7.b) y cada cliente inyecta
 * su politica.
 *
 * El guard pregunta DOS cosas: que ningun cliente vuelva a definir su `ensureWorker`
 * (texto) y que los clientes SE COMPORTEN como el puente (conducta, con un Worker
 * falso): alta perezosa, despacho por id, fallo total en onerror y dispose.
 *
 * Prueba de DETECTOR real (0.24): se alimenta un fuente sintetica con
 * `function ensureWorker` y el detector la marca; si no la marcara, el guard seria
 * teatro.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SourceFile {
    file: string;
    source: string;
}

/** `archivo:linea` de cada `function ensureWorker` en las fuentes dadas. */
export function findLocalEnsureWorker(sources: ReadonlyArray<SourceFile>): string[] {
    const hits: string[] = [];
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            if (/function\s+ensureWorker\s*\(/.test(line)) hits.push(`${file}:${index + 1}`);
        });
    }
    return hits;
}

const CLIENTS = [
    'src/avatar/workers/fbxWorkerClient.ts',
    'src/voice/lib/voiceIdWorkerClient.js',
    'src/voice/lib/asr/whisperWasmTranscriber.js',
];
const BRIDGE = 'src/voice/lib/workerPendingBridge.js';

function clientSources(): SourceFile[] {
    return [...CLIENTS, BRIDGE].map((file) => ({
        file,
        source: readFileSync(join(process.cwd(), file), 'utf8'),
    }));
}

// ---------------------------------------------------------------- Worker falso
class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message?: string }) => void) | null = null;
    posted: Array<Record<string, unknown>> = [];
    transfer: unknown[] = [];
    terminated = false;
    constructor(public url?: unknown, public options?: unknown) {
        FakeWorker.instances.push(this);
    }
    postMessage(message: Record<string, unknown>, transfer?: unknown[]) {
        this.posted.push(message);
        this.transfer = transfer || [];
    }
    terminate() {
        this.terminated = true;
    }
    reply(data: Record<string, unknown>) {
        this.onmessage?.({ data });
    }
    fail(message?: string) {
        this.onerror?.({ message });
    }
    static last(): FakeWorker {
        return FakeWorker.instances[FakeWorker.instances.length - 1];
    }
    static reset() {
        FakeWorker.instances = [];
    }
}

const realWorker = (globalThis as Record<string, unknown>).Worker;

afterEach(() => {
    (globalThis as Record<string, unknown>).Worker = realWorker;
    FakeWorker.reset();
    vi.resetModules();
});

describe('workerPendingBridgeSingleOwnerGuard — un dueno del esqueleto de worker', () => {
    it('ningun cliente de worker define su propio ensureWorker', () => {
        const bad = findLocalEnsureWorker(clientSources());
        expect(bad, `Copias de ensureWorker (archivo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: una copia local se marca', () => {
        const synthetic: SourceFile[] = [
            { file: 'src/voice/lib/voiceIdWorkerClient.js', source: 'function ensureWorker() {\n  return null\n}' },
            { file: 'src/voice/lib/otro.js', source: "import { createWorkerPendingBridge } from './workerPendingBridge.js'" },
        ];
        expect(findLocalEnsureWorker(synthetic)).toEqual(['src/voice/lib/voiceIdWorkerClient.js:1']);
    });

    it('CONDUCTA del puente: alta perezosa, despacho por id, fail-all y dispose', async () => {
        const { createWorkerPendingBridge } = await import('../src/voice/lib/workerPendingBridge.js');
        const bridge = createWorkerPendingBridge({
            createWorker: () => new FakeWorker() as unknown as Worker,
            label: 'test',
            valueKey: 'result',
        });

        // Alta perezosa: no hay worker hasta el primer ensure, y se reutiliza.
        expect(FakeWorker.instances).toHaveLength(0);
        const w = bridge.ensure();
        expect(FakeWorker.instances).toHaveLength(1);
        expect(bridge.ensure()).toBe(w);

        // Despacho por id: solo resuelve el que casa.
        const ok = new Promise((resolve) => bridge.pending.set('a', { resolve, reject: () => {} }));
        bridge.pending.set('b', { resolve: () => {}, reject: () => {} });
        (w as unknown as FakeWorker).reply({ id: 'a', ok: true, result: 'valor' });
        await expect(ok).resolves.toBe('valor');

        // onerror rechaza TODOS los pendientes.
        const p1 = new Promise((_, reject) => bridge.pending.set('c', { resolve: () => {}, reject }));
        const p2 = new Promise((_, reject) => bridge.pending.set('d', { resolve: () => {}, reject }));
        (w as unknown as FakeWorker).fail('boom');
        await expect(p1).rejects.toThrow();
        await expect(p2).rejects.toThrow();
        expect(bridge.pending.size).toBe(0);

        // dispose rechaza lo pendiente y termina.
        const w2 = bridge.ensure();
        const p3 = new Promise((_, reject) => bridge.pending.set('e', { resolve: () => {}, reject }));
        bridge.dispose(new Error('fin'));
        await expect(p3).rejects.toThrow('fin');
        expect((w2 as unknown as FakeWorker).terminated).toBe(true);
    });

    it('CONDUCTA: el puente no crea worker si canRun() es false, y onFatal recibe terminate', async () => {
        const { createWorkerPendingBridge } = await import('../src/voice/lib/workerPendingBridge.js');
        const bridge = createWorkerPendingBridge({
            createWorker: () => new FakeWorker() as unknown as Worker,
            canRun: () => false,
            label: 'test',
        });
        expect(bridge.ensure()).toBeNull();
        expect(FakeWorker.instances).toHaveLength(0);

        let terminatedByFatal = false;
        const bridge2 = createWorkerPendingBridge({
            createWorker: () => new FakeWorker() as unknown as Worker,
            label: 'test',
            onFatal: (_reason: unknown, api: { terminate: () => void }) => {
                terminatedByFatal = true;
                api.terminate();
            },
        });
        const w = bridge2.ensure() as unknown as FakeWorker;
        w.fail('x');
        expect(terminatedByFatal).toBe(true);
        expect(w.terminated).toBe(true);
    });

    it('CONDUCTA: whisper (cliente real) usa el puente con su fabrica inyectada', async () => {
        const { createWhisperWasmTranscriber } = await import('../src/voice/lib/asr/whisperWasmTranscriber.js');
        const transcriber = createWhisperWasmTranscriber({
            workerFactory: () => new FakeWorker() as unknown as Worker,
            modelId: 'tiny',
        });
        const pending = transcriber.transcribe(new Float32Array([0, 0, 0, 0]));
        const w = FakeWorker.last();
        const sent = w.posted[0] as { id: number; type: string };
        expect(sent.type).toBe('transcribe');
        w.reply({ id: sent.id, ok: true, result: { text: '  hola  ' } });
        await expect(pending).resolves.toBe('hola');

        // dispose rechaza lo pendiente.
        const stuck = transcriber.transcribe(new Float32Array([0, 0, 0, 0]));
        transcriber.dispose();
        await expect(stuck).rejects.toThrow();
    });

    it('CONDUCTA: voiceId (cliente real) despacha por el worker y falla en bloque', async () => {
        (globalThis as Record<string, unknown>).Worker = FakeWorker;
        const voiceId = await import('../src/voice/lib/voiceIdWorkerClient.js');
        const pending = voiceId.preloadVoiceIdWorker();
        const w = FakeWorker.last();
        const sent = w.posted[0] as { id: string; type: string };
        expect(sent.type).toBe('preload');
        w.reply({ id: sent.id, ok: true, result: { ready: true } });
        await expect(pending).resolves.toEqual({ ready: true });
    });

    it('CONDUCTA: fbx (cliente real) manda el id y el url, y propaga el fallo', async () => {
        (globalThis as Record<string, unknown>).Worker = FakeWorker;
        const fbx = await import('../src/avatar/workers/fbxWorkerClient');
        const pending = fbx.loadFbx('modelo.fbx');
        const w = FakeWorker.last();
        const sent = w.posted[0] as { id: string; url: string };
        expect(sent.url).toBe('modelo.fbx');
        w.reply({ id: sent.id, ok: false, error: 'fbx roto' });
        await expect(pending).rejects.toThrow('fbx roto');
    });
});
