// ============================================================
// recorderSink — DUEÑO ÚNICO del volcado a disco de la grabación de sesión (SOLO DEV).
// ------------------------------------------------------------
// Problema que resuelve (medido 2026-10-19): la grabación vivía SOLO en memoria del
// navegador y salía únicamente con `__fluDev.recorder.download()`; cualquier recarga
// (incluidas las que provoca HMR) la borraba. El agente no podía reconstruir el
// escenario con los timbres reales porque nunca quedaba un archivo.
//
// Este middleware recibe del cliente, en continuo:
//   • PCM crudo (16-bit mono, little-endian) → `audio.pcm` y, al finalizar, `audio.wav`.
//   • Eventos NDJSON (ASR crudo, trazas, logs) → `events.ndjson`.
//   • Instantáneas NDJSON de turno y de la base de participantes (vectores COMPLETOS)
//     → `turns.ndjson`.
//
// Todo vive en `os.tmpdir()/flu-recordings/<sessionId>/` (fuera del repo: no es basura
// del proyecto y el audio es sensible). El manifiesto declara conteos y tamaños para
// detectar una captura incompleta en vez de aparentar integridad.
//
// CONTROL (lo ejerce el agente, no el dueño): `control.json` dentro de la raíz:
//   { "capture": true, "command": "prepare-validation" }
// `GET /status` lo entrega y CONSUME `command` (one-shot): el cliente ejecuta el
// comando una sola vez y no entra en bucle de recarga. `capture` permanece.
// ============================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { sendJson, type MiddlewareHost } from './httpJson.ts';
import { parseRequestUrl } from './requestUrl.ts';
import { logCaughtError } from '../lib/caughtError.ts';
import { DEFAULT_SAMPLE_RATE } from '../voice/lib/audioConstants.js';

/** Control one-shot leído por el cliente en cada arranque. */
export interface RecorderControl {
    capture?: boolean;
    command?: string;
}

/** Resumen medido al finalizar una sesión. */
export interface RecorderFinalizeResult {
    dir: string;
    wav: string | null;
    samples: number;
    seconds: number;
    sampleRate: number;
    events: number;
    turns: number;
    audioBytes: number;
}

/** API del almacén; se exporta para probarlo con un directorio temporal. */
export interface RecorderStore {
    rootDir: string;
    readControl(): RecorderControl;
    writeControl(control: RecorderControl): RecorderControl;
    start(sessionId: string, meta: Record<string, unknown>): { dir: string };
    appendEvents(sessionId: string, body: string): number;
    appendTurns(sessionId: string, body: string): number;
    appendAudio(sessionId: string, chunk: Buffer): number;
    finalize(sessionId: string, options?: { sampleRate?: number }): RecorderFinalizeResult;
}

const CONTROL_FILE = 'control.json';
const META_FILE = 'meta.json';
const EVENTS_FILE = 'events.ndjson';
const TURNS_FILE = 'turns.ndjson';
const AUDIO_FILE = 'audio.pcm';
const WAV_FILE = 'audio.wav';
const MANIFEST_FILE = 'manifest.json';
/** Tope de audio por sesión en el server: 2 GB ≈ 6 h de PCM 48 kHz mono 16-bit.
 * El cliente ya no corta el volcado en `maxMinutes` (memoria acotada, disco completo). */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/**
 * Valida el id de sesión como nombre de carpeta: sin separadores ni puntos.
 * @param raw id recibido del cliente
 * @returns id seguro; lanza si no es válido
 */
export function safeSessionId(raw: unknown): string {
    const id = String(raw ?? '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
        throw new Error('sessionId invalido');
    }
    return id;
}

function countLines(file: string): number {
    if (!existsSync(file)) return 0;
    const text = readFileSync(file, 'utf8');
    if (!text) return 0;
    return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

/**
 * Construye el WAV (RIFF/WAVE PCM mono 16-bit) a partir del PCM crudo.
 * @param pcm PCM little-endian de 16 bits
 * @param sampleRate tasa real del micrófono
 * @returns buffer WAV completo
 */
function buildWav(pcm: Buffer, sampleRate: number): Buffer {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

/**
 * Crea el almacén en disco. La raíz se fija al construirlo: las pruebas usan un
 * directorio temporal y el dev-server usa `os.tmpdir()/flu-recordings`.
 * @param rootDir raíz de las sesiones
 */
export function createRecorderStore(rootDir: string): RecorderStore {
    const root = resolve(rootDir);
    mkdirSync(root, { recursive: true });

    const controlPath = join(root, CONTROL_FILE);

    const dirFor = (sessionId: string): string => {
        const id = safeSessionId(sessionId);
        const dir = resolve(root, id);
        // Aunque el id ya está validado, se comprueba la contención: una raíz con
        // enlaces o un id futuro no pueden escribir fuera del directorio de capturas.
        if (dir !== root && !dir.startsWith(root + sep)) {
            throw new Error('sessionId fuera de la raiz');
        }
        return dir;
    };

    const ensureDir = (sessionId: string): string => {
        const dir = dirFor(sessionId);
        mkdirSync(dir, { recursive: true });
        return dir;
    };

    const readMeta = (dir: string): Record<string, unknown> => {
        const metaPath = join(dir, META_FILE);
        if (!existsSync(metaPath)) return {};
        try {
            return JSON.parse(readFileSync(metaPath, 'utf8'));
        } catch (error) {
            logCaughtError('recorderSink.readMeta', error, { dir });
            return {};
        }
    };

    return {
        rootDir: root,
        readControl() {
            let control: RecorderControl = {};
            try {
                if (existsSync(controlPath)) control = JSON.parse(readFileSync(controlPath, 'utf8'));
            } catch (error) {
                logCaughtError('recorderSink.readControl', error);
                control = {};
            }
            if (control.command) {
                // ONE-SHOT: se entrega una vez y se borra del control.
                const { command: _consumed, ...rest } = control;
                try {
                    writeFileSync(controlPath, JSON.stringify(rest, null, 2));
                } catch (error) {
                    logCaughtError('recorderSink.consumeCommand', error);
                }
            }
            return control;
        },
        writeControl(control: RecorderControl) {
            const clean: RecorderControl = {};
            // `false` es una orden explícita de apagado; ausente = sin instrucción.
            if (typeof control?.capture === 'boolean') clean.capture = control.capture;
            if (typeof control?.command === 'string' && control.command) clean.command = control.command;
            writeFileSync(controlPath, JSON.stringify(clean, null, 2));
            return clean;
        },
        start(sessionId, meta) {
            const dir = ensureDir(sessionId);
            const metaPath = join(dir, META_FILE);
            const prior = existsSync(metaPath) ? readMeta(dir) : {};
            writeFileSync(metaPath, JSON.stringify({ ...prior, ...meta, sessionId, updatedAt: new Date().toISOString() }, null, 2));
            for (const file of [EVENTS_FILE, TURNS_FILE]) {
                const path = join(dir, file);
                if (!existsSync(path)) appendFileSync(path, '');
            }
            if (!existsSync(join(dir, AUDIO_FILE))) appendFileSync(join(dir, AUDIO_FILE), '');
            return { dir };
        },
        appendEvents(sessionId, body) {
            const dir = ensureDir(sessionId);
            const text = String(body || '');
            if (!text) return 0;
            appendFileSync(join(dir, EVENTS_FILE), text);
            return Buffer.byteLength(text);
        },
        appendTurns(sessionId, body) {
            const dir = ensureDir(sessionId);
            const text = String(body || '');
            if (!text) return 0;
            appendFileSync(join(dir, TURNS_FILE), text);
            return Buffer.byteLength(text);
        },
        appendAudio(sessionId, chunk) {
            const dir = ensureDir(sessionId);
            const audioPath = join(dir, AUDIO_FILE);
            const prior = existsSync(audioPath) ? statSync(audioPath).size : 0;
            if (prior + chunk.length > MAX_AUDIO_BYTES) {
                throw new Error('audio cap reached');
            }
            appendFileSync(audioPath, chunk);
            return prior + chunk.length;
        },
        finalize(sessionId, options = {}) {
            // Puede finalizarse una sesión sin audio (solo eventos): el directorio
            // se asegura y el manifiesto declara lo que realmente existe.
            const dir = ensureDir(sessionId);
            const meta = readMeta(dir);
            const overrideRate = Number(options?.sampleRate);
            const hasOverride = Number.isFinite(overrideRate) && overrideRate > 0;
            const metaSampleRate = Number(meta.sampleRate);
            const sampleRate = hasOverride
                ? Math.round(overrideRate)
                : Number.isFinite(metaSampleRate) && metaSampleRate > 0 ? Math.round(metaSampleRate) : DEFAULT_SAMPLE_RATE;
            if (hasOverride && sampleRate !== metaSampleRate) {
                // La actualización de tasa viaja en un `start` encolado que puede no
                // llegar antes de cerrar la pestaña; el cierre es la ÚLTIMA verdad
                // del PCM (el cliente envía la tasa a la que realmente grabó), así
                // que el WAV no se construye con una tasa supuesta.
                meta.sampleRate = sampleRate;
                meta.updatedAt = new Date().toISOString();
                writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2));
            }
            const audioPath = join(dir, AUDIO_FILE);
            const pcm = existsSync(audioPath) ? readFileSync(audioPath) : Buffer.alloc(0);
            const samples = Math.floor(pcm.length / 2);
            let wav: string | null = null;
            if (pcm.length > 0) {
                const wavPath = join(dir, WAV_FILE);
                writeFileSync(wavPath, buildWav(pcm, sampleRate));
                wav = wavPath;
            }
            const result: RecorderFinalizeResult = {
                dir,
                wav,
                samples,
                seconds: Math.round((samples / sampleRate) * 1e6) / 1e6,
                sampleRate,
                events: countLines(join(dir, EVENTS_FILE)),
                turns: countLines(join(dir, TURNS_FILE)),
                audioBytes: pcm.length,
            };
            writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({ ...result, meta, finalizedAt: new Date().toISOString() }, null, 2));
            return result;
        },
    };
}

/**
 * Lee el cuerpo del request con un tope duro (no deja crecer la memoria del server).
 * @param req request entrante
 * @param maxBytes tope del cuerpo
 * @returns cuerpo completo
 */
function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer> {
    return new Promise((resolveBody, rejectBody) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
                rejectBody(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolveBody(Buffer.concat(chunks)));
        req.on('error', rejectBody);
    });
}

/**
 * Enruta `/__flu/recorder/*`. El montaje de connect recorta el prefijo, pero se
 * aceptan ambas formas (`/status` y `/__flu/recorder/status`) para no depender de eso.
 * @param store almacén de la sesión
 * @param req request
 * @param res response
 * @param next continúa al siguiente middleware
 */
async function handleRecorderRequest(store: RecorderStore, req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    const url = parseRequestUrl(req, res, '[recorderSink]');
    if (!url) return;
    const route = url.pathname.replace(/^\/__flu\/recorder/, '') || '/';
    const sessionId = url.searchParams.get('session') || '';

    try {
        if (route === '/status' && req.method === 'GET') {
            sendJson(res, 200, { ok: true, ...store.readControl(), root: store.rootDir }, '[recorderSink] sendJson failed:');
            return;
        }
        if (route === '/control' && req.method === 'POST') {
            const body = await readBody(req, 64 * 1024);
            const parsed = JSON.parse(body.toString('utf8') || '{}');
            sendJson(res, 200, { ok: true, ...store.writeControl(parsed) }, '[recorderSink] sendJson failed:');
            return;
        }
        if (route === '/start' && req.method === 'POST') {
            const body = await readBody(req, 256 * 1024);
            const parsed = JSON.parse(body.toString('utf8') || '{}');
            const id = safeSessionId(parsed.sessionId);
            const meta = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
            sendJson(res, 200, { ok: true, ...store.start(id, meta) }, '[recorderSink] sendJson failed:');
            return;
        }
        if (route === '/audio' && req.method === 'POST') {
            const chunk = await readBody(req);
            const bytes = store.appendAudio(safeSessionId(sessionId), chunk);
            sendJson(res, 200, { ok: true, bytes }, '[recorderSink] sendJson failed:');
            return;
        }
        if (route === '/events' && req.method === 'POST') {
            const body = await readBody(req);
            const bytes = store.appendEvents(safeSessionId(sessionId), body.toString('utf8'));
            sendJson(res, 200, { ok: true, bytes }, '[recorderSink] sendJson failed:');
            return;
        }
        if (route === '/turns' && req.method === 'POST') {
            const body = await readBody(req);
            const bytes = store.appendTurns(safeSessionId(sessionId), body.toString('utf8'));
            sendJson(res, 200, { ok: true, bytes }, '[recorderSink] sendJson failed:');
            return;
        }
        if (route === '/finalize' && req.method === 'POST') {
            const body = await readBody(req);
            const parsed = body.length ? JSON.parse(body.toString('utf8') || '{}') : {};
            const sampleRate = Number(parsed.sampleRate) || 0;
            sendJson(res, 200, { ok: true, ...store.finalize(safeSessionId(sessionId), { sampleRate }) }, '[recorderSink] sendJson failed:');
            return;
        }
        next();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logCaughtError('[recorderSink] request', error, { route, method: req.method });
        sendJson(res, 400, { ok: false, reason: 'invalid_request', detail: message }, '[recorderSink] sendJson failed:');
    }
}

/**
 * Plugin de Vite: registra el sumidero en el dev-server. Nunca se incluye en el
 * bundle de producción (los plugins solo existen en desarrollo).
 */
export function createRecorderSink() {
    const store = createRecorderStore(join(tmpdir(), 'flu-recordings'));
    return {
        name: 'flu-recorder-sink',
        configureServer(server: MiddlewareHost) {
            server.middlewares.use('/__flu/recorder', (req, res, next) => {
                void handleRecorderRequest(store, req, res, next);
            });
        },
    };
}
