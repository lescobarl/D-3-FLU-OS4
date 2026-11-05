// ============================================================
// recorderSink — EL VOLCADO A DISCO DE LA GRABACIÓN (dev-server)
// ------------------------------------------------------------
// Cubre el defecto de proceso medido 2026-10-19: la grabación vivía SOLO en
// memoria y una recarga la borraba; nunca quedaba PCM ni vector en disco. Aquí se
// prueba el almacén REAL (sistema de archivos de un directorio temporal):
//   • el WAV se construye con la tasa que declaró el cliente;
//   • los NDJSON conservan los VECTORES COMPLETOS (512 dimensiones, no 50);
//   • `control.json` entrega el comando UNA sola vez (no hay bucle de recarga);
//   • un id de sesión con separadores no puede escribir fuera de la raíz.
// ============================================================
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRecorderStore, safeSessionId } from '../src/server/recorderSink.ts';

let root = '';
let store: ReturnType<typeof createRecorderStore>;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'flu-recorder-test-'));
    store = createRecorderStore(root);
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

const SESSION = '123e4567-e89b-42d3-a456-426614174000';

describe('recorderSink — audio a WAV', () => {
    it('acumula el PCM, construye un WAV con la tasa declarada y mide el manifiesto', () => {
        store.start(SESSION, { sampleRate: 8000, userAgent: 'test' });
        // Dos muestras: 0x0100 y 0x0002 (little-endian).
        store.appendAudio(SESSION, Buffer.from([0x00, 0x01, 0x02, 0x00]));

        const result = store.finalize(SESSION);
        expect(result.samples).toBe(2);
        expect(result.sampleRate).toBe(8000);
        expect(result.seconds).toBe(0.00025);
        expect(result.audioBytes).toBe(4);
        expect(result.wav).toBeTruthy();

        const wav = readFileSync(result.wav as string);
        expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
        expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
        expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
        expect(wav.readUInt16LE(20)).toBe(1); // PCM
        expect(wav.readUInt16LE(22)).toBe(1); // mono
        expect(wav.readUInt32LE(24)).toBe(8000);
        expect(wav.readUInt16LE(34)).toBe(16); // bits
        expect(wav.readUInt32LE(40)).toBe(4); // data size
        expect(wav.length).toBe(44 + 4);

        const manifest = JSON.parse(readFileSync(join(root, SESSION, 'manifest.json'), 'utf8'));
        expect(manifest.samples).toBe(2);
        expect(manifest.audioBytes).toBe(4);
        expect(manifest.meta.userAgent).toBe('test');
    });

    it('sin sesión iniciada, finalize no inventa un WAV', () => {
        const result = store.finalize(SESSION);
        expect(result.samples).toBe(0);
        expect(result.wav).toBeNull();
    });

    it('el cierre impone la tasa REAL del PCM aunque el start con la tasa no haya llegado', () => {
        // Defecto medido 2026-10-19: primer bloque PCM (16 kHz) y cierre inmediato
        // → el start con 16000 seguía encolado, meta quedó en 0 y el WAV se
        // construyó a 48000 (reproducción ~3× lenta). El cierre ES la última verdad.
        store.start(SESSION, { sampleRate: 0, userAgent: 'test' });
        store.appendAudio(SESSION, Buffer.alloc(32000));

        const result = store.finalize(SESSION, { sampleRate: 16000 });
        expect(result.sampleRate).toBe(16000);
        expect(result.seconds).toBe(1);

        const wav = readFileSync(result.wav as string);
        expect(wav.readUInt32LE(24)).toBe(16000);

        // meta.json queda corregido: no se deja una tasa 0 que contradiga al WAV.
        const meta = JSON.parse(readFileSync(join(root, SESSION, 'meta.json'), 'utf8'));
        expect(meta.sampleRate).toBe(16000);
        expect(meta.userAgent).toBe('test');
        const manifest = JSON.parse(readFileSync(join(root, SESSION, 'manifest.json'), 'utf8'));
        expect(manifest.sampleRate).toBe(16000);
        expect(manifest.meta.sampleRate).toBe(16000);
    });
});

describe('recorderSink — NDJSON conserva los vectores COMPLETOS', () => {
    it('un vector de 512 dimensiones llega entero al turno y a la base', () => {
        const vector = Array.from({ length: 512 }, (_, i) => Math.round((i / 512) * 1000) / 1000);
        store.start(SESSION, { sampleRate: 48000 });
        store.appendTurns(SESSION, `${JSON.stringify({ kind: 'turn', signature: vector })}\n`);
        store.appendTurns(SESSION, `${JSON.stringify({
            kind: 'base',
            participants: [{ id: 'p1', name: 'Luis', voiceVector: vector }],
        })}\n`);
        store.appendEvents(SESSION, `${JSON.stringify({ seq: 1, category: 'listen', event: 'final' })}\n`);

        const lines = readFileSync(join(root, SESSION, 'turns.ndjson'), 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        const turn = JSON.parse(lines[0]);
        expect(turn.signature).toHaveLength(512);
        expect(turn.signature[511]).toBe(vector[511]);
        const base = JSON.parse(lines[1]);
        expect(base.participants[0].voiceVector).toHaveLength(512);
        expect(base.participants[0].name).toBe('Luis');

        const result = store.finalize(SESSION);
        expect(result.turns).toBe(2);
        expect(result.events).toBe(1);
    });
});

describe('recorderSink — control del agente', () => {
    it('el comando se entrega UNA vez; la bandera de captura permanece', () => {
        store.writeControl({ capture: true, command: 'prepare-validation' });

        const first = store.readControl();
        expect(first.capture).toBe(true);
        expect(first.command).toBe('prepare-validation');

        // One-shot: la segunda lectura ya no repite el comando (no hay bucle).
        const second = store.readControl();
        expect(second.capture).toBe(true);
        expect(second.command).toBeUndefined();
    });

    it('una orden explícita de apagado se conserva', () => {
        store.writeControl({ capture: false });
        expect(store.readControl().capture).toBe(false);
    });
});

describe('recorderSink — contención de rutas', () => {
    it('rechaza ids con separadores o puntos', () => {
        expect(() => safeSessionId('../../evil')).toThrow();
        expect(() => safeSessionId('a/b')).toThrow();
        expect(() => safeSessionId('')).toThrow();
        expect(() => store.appendEvents('../evil', 'x\n')).toThrow();
        expect(() => store.start('..', {})).toThrow();
        expect(existsSync(join(root, '..', 'evil'))).toBe(false);
    });
});
