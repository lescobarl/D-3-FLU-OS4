// ============================================================
// sessionRecorder + sumidero — la grabación SALE de la pestaña
// ------------------------------------------------------------
// El dueño lo exigió así: la persistencia de la evidencia es del lado del
// agente, no suya. Aquí se prueba la costura REAL con un sumidero inyectado
// (interfaz, sin red):
//   • con la bandera apagada NO se envía nada;
//   • el PCM se vuelca al mismo caudal en que se guarda en memoria;
//   • los turnos viajan con el vector COMPLETO (512), sin el recorte de `safeData`;
//   • finalize cierra la sesión con el WAV y el manifiesto del lado servidor.
// ============================================================
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    clearSessionRecording,
    configureSessionSink,
    disableSessionRecorder,
    enableSessionRecorder,
    finalizeSessionRecording,
    getSessionRecordingStatus,
    pushSessionAudio,
    recordSessionEvent,
    recordSessionTurn,
} from '../src/voice/lib/sessionRecorder.js';

interface SinkCall {
    method: 'start' | 'audio' | 'events' | 'turns' | 'finalize';
    sessionId: string;
    payload: unknown;
}

let calls: SinkCall[] = [];

function installFakeSink(): void {
    calls = [];
    configureSessionSink({
        start: (sessionId, meta) => { calls.push({ method: 'start', sessionId, payload: meta }); },
        audio: (sessionId, chunk) => { calls.push({ method: 'audio', sessionId, payload: chunk }); },
        events: (sessionId, lines) => { calls.push({ method: 'events', sessionId, payload: lines }); },
        turns: (sessionId, lines) => { calls.push({ method: 'turns', sessionId, payload: lines }); },
        finalize: (sessionId, info) => { calls.push({ method: 'finalize', sessionId, payload: info }); },
    });
}

const of = (method: SinkCall['method']) => calls.filter((call) => call.method === method);

beforeEach(() => {
    disableSessionRecorder();
    clearSessionRecording();
    installFakeSink();
});

afterEach(async () => {
    await finalizeSessionRecording();
    configureSessionSink(null);
    disableSessionRecorder();
    clearSessionRecording();
});

describe('sessionRecorder + sumidero — bandera', () => {
    it('apagada: ni audio, ni eventos, ni turnos salen de la pestaña', async () => {
        expect(pushSessionAudio(new Float32Array(8).fill(0.5), 48000)).toBe(false);
        expect(recordSessionEvent('listen', 'final', { text: 'hola' })).toBe(false);
        expect(recordSessionTurn({ signature: [1, 0, 0] })).toBe(false);
        await finalizeSessionRecording();
        expect(calls).toEqual([]);
    });
});

describe('sessionRecorder + sumidero — captura completa', () => {
    it('vuelca audio, eventos y el turno con el vector de 512 dimensiones', async () => {
        expect(enableSessionRecorder()).toBe(true);
        const vector = Array.from({ length: 512 }, (_, i) => i / 512);
        pushSessionAudio(new Float32Array(4).fill(0.25), 48000);
        recordSessionEvent('listen', 'chrome-raw', { text: 'hola' });
        recordSessionTurn({
            kind: 'commit',
            text: 'hola a todos',
            speaker: 'Luis',
            signature: vector,
            clusters: [{ label: 'Luis', signature: vector }],
        });
        await finalizeSessionRecording();

        const sessionId = getSessionRecordingStatus().sessionId; // ya cerrada: ''
        expect(sessionId).toBe('');
        const [opened] = of('start');
        const id = opened.sessionId;
        expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        // La tasa real del micrófono se declara al servidor (segundo start) y,
        // como garantía, viaja también en el cierre.
        expect(of('start').map((call) => (call.payload as { sampleRate: number }).sampleRate)).toContain(48000);

        const audio = of('audio');
        expect(audio).toHaveLength(1);
        expect((audio[0].payload as Uint8Array).byteLength).toBe(8); // 4 muestras × 2 bytes

        const events = of('events');
        expect(events).toHaveLength(1);
        const eventRow = JSON.parse(String(events[0].payload).trim());
        expect(eventRow.category).toBe('listen');
        expect(eventRow.event).toBe('chrome-raw');

        const turns = of('turns');
        const turnRows = turns.flatMap((call) => String(call.payload).trim().split('\n')).map((line) => JSON.parse(line));
        const commit = turnRows.find((row) => row.kind === 'commit');
        expect(commit).toBeTruthy();
        expect(commit.signature).toHaveLength(512);
        expect(commit.signature[511]).toBe(vector[511]);
        expect(commit.clusters[0].signature).toHaveLength(512);
        expect(commit.speaker).toBe('Luis');

        expect(of('finalize')).toHaveLength(1);
        // El cierre declara la tasa REAL del PCM: si el start con la tasa quedó
        // encolado al morir la pestaña, el servidor no debe suponer 48000.
        expect(of('finalize')[0].payload).toEqual({ sampleRate: 48000 });
    });

    it('el evento sí queda acotado (safeData) mientras el turno conserva el vector entero', async () => {
        enableSessionRecorder();
        const vector = Array.from({ length: 512 }, () => 0.5);
        recordSessionEvent('trace', 'identity', { signature: vector });
        recordSessionTurn({ kind: 'base', directory: [{ voiceId: 'v1', vector }] });
        await finalizeSessionRecording();

        const eventRow = JSON.parse(String(of('events')[0].payload).trim());
        // Diagnóstico acotado: el canal de eventos no es el de los vectores.
        expect((eventRow.data as { signature: number[] }).signature).toHaveLength(50);
        const turnRow = JSON.parse(String(of('turns')[0].payload).trim());
        expect((turnRow.directory as Array<{ vector: number[] }>)[0].vector).toHaveLength(512);
    });
});
