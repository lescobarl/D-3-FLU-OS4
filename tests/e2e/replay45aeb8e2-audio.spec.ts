// ============================================================
// INYECCION DE AUDIO REAL — la grabacion 45aeb8e2 como microfono de la app.
// ------------------------------------------------------------
// El WAV de la sesion del dueno (142 s, 2 personas) entra por el MICROFONO
// FALSO de Chromium (`--use-file-for-fake-audio-capture`, config de replay):
// la app lo ESCUCHA por su tuberia real (getUserMedia -> PCM -> ASR -> ingress
// -> conversacion). No se inyecta texto ni se toca el pipeline.
//
// Dos modos (FLU_REPLAY_SR):
//   real  = Chrome SpeechRecognition REAL (produccion). Es el escenario completo.
//   mute  = SR mudo que arranca y nunca emite: reproduce la sesion 45aeb8e2
//           grabada (cero resultados de SR en 142 s con el micro con voz).
//
// La evidencia sale por consola Y por la grabacion de sesion que la propia app
// escribe en os.tmpdir()/flu-recordings (se enciende en la pagina).
// ============================================================
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autoSkipOnboarding, gotoClean, stubLocalSpeech } from './_helpers';

const REC_DIR = join(tmpdir(), 'flu-recordings', '45aeb8e2-ba60-4b54-ae6c-0afc3c50357a');
const SR_MODE = process.env.FLU_REPLAY_SR || 'real';
const hayGrabacion = existsSync(join(REC_DIR, 'turns.ndjson'));
const PADDED_WAV = join(tmpdir(), 'flu-replay', '45aeb8e2-padded.wav');
// URL sintetica: la sirve page.route desde disco (sin tocar el server de la app).
const WAV_URL = 'https://replay.local/45aeb8e2.wav';

/**
 * Microfono FALSO en pagina: sustituye getUserMedia para que la app reciba la
 * grabacion REAL por Web Audio (MediaStreamAudioDestinationNode). La tuberia
 * aguas abajo (worklet -> PCM -> VAD -> ASR -> ingress -> conversacion) es la
 * REAL de la app; solo el ORIGEN del audio se simula, igual que
 * stubSpeechRecognition simula el dispositivo de reconocimiento.
 * El WAV trae 90 s de silencio delante (cubre el arranque hasta LISTENING).
 */
function stubGrabacionMic() {
    return () => {
        let streamPromise: Promise<MediaStream> | null = null;
        const build = async () => {
            const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
            const ac = new Ctx();
            await ac.resume().catch(() => {});
            const res = await fetch('https://replay.local/45aeb8e2.wav');
            const buf = await res.arrayBuffer();
            const audio = await ac.decodeAudioData(buf);
            const src = ac.createBufferSource();
            src.buffer = audio;
            const dest = ac.createMediaStreamDestination();
            src.connect(dest);
            src.start();
            return dest.stream;
        };
        const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        (navigator.mediaDevices as any).getUserMedia = async (constraints: any) => {
            if (constraints && constraints.audio) {
                if (!streamPromise) streamPromise = build();
                return streamPromise;
            }
            return orig(constraints);
        };
    };
}

/** SR mudo: arranca y se queda vivo SIN emitir nada (reproduce 45aeb8e2). */
function stubMuteRecognition() {
    return () => {
        class MuteRecognition {
            lang = '';
            interimResults = true;
            continuous = true;
            maxAlternatives = 1;
            onstart: any = null;
            onresult: any = null;
            onerror: any = null;
            onend: any = null;
            start() {
                setTimeout(() => {
                    if (typeof this.onstart === 'function') this.onstart();
                }, 0);
            }
            stop() {}
            abort() {}
        }
        (window as any).SpeechRecognition = MuteRecognition;
        (window as any).webkitSpeechRecognition = MuteRecognition;
    };
}

/**
 * Contadores del CICLO DE VIDA del SR real (evidencia de que hace Chrome SR):
 * cuantas veces arranco y si emitio onstart/onresult/onerror/onend. Se
 * instalan en el PROTOTIPO (los handlers se asignan antes de start()).
 */
function stubSrLifecycle() {
    return () => {
        (window as any).__srLifecycle = { start: 0, onstart: 0, onresult: 0, onerror: 0, onend: 0 };
        const C = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!C) return;
        const origStart = C.prototype.start;
        C.prototype.start = function (...args: any[]) {
            (window as any).__srLifecycle.start += 1;
            return origStart.apply(this, args);
        };
        for (const ev of ['onstart', 'onresult', 'onerror', 'onend']) {
            Object.defineProperty(C.prototype, ev, {
                configurable: true,
                get(this: any) { return this[`__cb_${ev}`] || null; },
                set(this: any, fn: any) {
                    this[`__cb_${ev}`] = typeof fn === 'function'
                        ? function (this: any, e: any) {
                            (window as any).__srLifecycle[ev] += 1;
                            return fn.call(this, e);
                        }
                        : fn;
                },
            });
        }
    };
}

/** Participantes REALES de la sesion (base snapshot con el vector de luis). */
function leerParticipantes() {
    const lines = readFileSync(join(REC_DIR, 'turns.ndjson'), 'utf8').trim().split('\n');
    const base = lines.map((l) => JSON.parse(l)).find((t) => t?.kind === 'base');
    return (base?.participants || []).map((p: any) => ({
        id: String(p.id),
        name: String(p.name),
        role: String(p.role || ''),
        speakerLabel: String(p.speakerLabel || ''),
        voiceVectorModel: String(p.voiceVectorModel || ''),
        voiceAnchorVerified: p.voiceAnchorVerified === true,
        voiceVector: Array.isArray(p.voiceVector) ? p.voiceVector : null,
    }));
}

async function seedParticipants(page: any, participants: any[]) {
    await page.evaluate(
        async ({ db, parts }: { db: string; parts: any[] }) => {
            const now = Date.now();
            const sync = { revision: 1, updated_at: new Date(now).toISOString(), deleted: false };
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.open(db);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const database = request.result;
                    const tx = database.transaction(['participants', 'onboardingStates'], 'readwrite');
                    for (const p of parts) {
                        tx.objectStore('participants').put({
                            ...p, createdAt: now, updatedAt: now, sync,
                        });
                        tx.objectStore('onboardingStates').put({
                            id: p.id, stepIndex: 99, completed: true,
                            captured: { name: p.name }, startedAt: now, updatedAt: now,
                        });
                    }
                    tx.oncomplete = () => { database.close(); resolve(); };
                    tx.onerror = () => { database.close(); reject(tx.error); };
                };
            });
        },
        { db: 'flu-os3', parts: participants },
    );
}

/** Activa un usuario desde el picker del header (ruta REAL de la app). */
async function activarUsuario(page: any, id: string) {
    const picker = page.locator('[data-testid="user-picker-select"]');
    await picker.waitFor({ state: 'attached', timeout: 30000 });
    await picker.selectOption(id);
    await page.waitForFunction((uid: string) => localStorage.getItem('flu-active-user') === uid, id, {
        timeout: 15000,
    });
}

test.describe('replay 45aeb8e2 - inyeccion del audio real', () => {
    test.beforeEach(async ({ page }) => {
        await autoSkipOnboarding(page);
        await stubLocalSpeech(page);
        await page.route(WAV_URL, (route) => route.fulfill({ path: PADDED_WAV, contentType: 'audio/wav' }));
        await page.addInitScript(stubGrabacionMic());
        await page.addInitScript(stubSrLifecycle());
        if (SR_MODE === 'mute') {
            await page.addInitScript(stubMuteRecognition());
        }
    });

    test(`escenario completo con la grabacion (SR=${SR_MODE})`, async ({ page }) => {
            test.skip(!hayGrabacion || !existsSync(PADDED_WAV), 'no hay grabacion 45aeb8e2 ni pad en esta maquina');
            test.setTimeout(560000);
            const errors: string[] = [];
            page.on('pageerror', (err) => errors.push(err.message));

            await gotoClean(page);
            const participantes = leerParticipantes();
            expect(participantes.length, 'la base de la sesion trae 2 participantes').toBeGreaterThanOrEqual(2);
            await seedParticipants(page, participantes);
            await page.reload({ waitUntil: 'load' });
            await page.waitForSelector('.flu-shell', { timeout: 45000 });
            // El titular de la sesion es el usuario activo.
            const luis = participantes.find((p: any) => p.voiceAnchorVerified);
            await activarUsuario(page, luis ? luis.id : participantes[0].id);

            // Pre-calentar el transcriptor local (descarga de whisper-tiny en el
            // cache del origen) DURANTE el pad de silencio, con el MODULO REAL
            // de la app: al degradar, el motor arranca ya con el modelo listo y
            // no pierde habla por descarga. El worker se desecha al terminar.
            await page.evaluate(async () => {
                try {
                    const MOD = '/src/voice/lib/asr/whisperWasmTranscriber.js';
                    const t = await import(/* @vite-ignore */ MOD);
                    const tr = (t as any).createWhisperWasmTranscriber();
                    await tr.preload().catch(() => {});
                    tr.dispose();
                    return 'ok';
                } catch (e) {
                    return `fallo: ${String(e)}`;
                }
            });

            // Grabacion de evidencia: la propia app vuelca sesion + turnos a disco.
            await page.evaluate(() => (window as any).__fluDev?.recorder?.enable?.());

            // Abrir la conversacion (mismo flujo real de la app).
            await page.waitForSelector('.flu-shell', { timeout: 45000 });
            const clicked = await page.evaluate(() => {
                const nodes = Array.from(document.querySelectorAll('button,[role="button"]'));
                const btn = nodes.find((node) => /iniciar/i.test(String(node.getAttribute('aria-label') || node.textContent || '')));
                if (!btn) return false;
                (btn as HTMLElement).click();
                return true;
            });
            expect(clicked, 'boton iniciar encontrado').toBe(true);

            // Escucha viva (store) — el micro ya captura el archivo.
            await page.waitForFunction(
                () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
                null,
                { timeout: 60000 },
            );
            const inicio = Date.now();

            // Ventana de audio: 90 s de silencio + 141.9 s de habla + cierres.
            // El archivo puede arrancar al abrir la captura o al lanzar el navegador;
            // el pad frontal de 90 s cubre el arranque en ambos casos.
            await page.waitForTimeout(90_000 + 142_000 + 30_000);
            console.log(`[REPLAY] ventana de escucha cerrada en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);

            // EVIDENCIA: filas de la conversacion + eventos de la grabacion de sesion.
            const filas = await page.evaluate(() => {
                const state = (window as any).__fluStore?.getState?.() || {};
                const rows = state.conversationHistory || [];
                const snap = (window as any).__fluDev?.recorder?.snapshot?.() || { status: {}, events: [] };
                const events = snap.events || [];
                const chromeRaw = events.filter((e: any) => e.event === 'chrome-raw');
                const asrRaw = events.filter((e: any) => String(e.event || '').includes('asrRaw') || String(e.data?.message || '').includes('asrRaw'));
                const degrade = events.filter((e: any) => /\[REC\] degrade/.test(String(e.data?.message || '')));
                const micPcm = events.filter((e: any) => /MicPcm/i.test(String(e.event || '')));
                return {
                    filas: rows.map((r: any) => ({
                        role: String(r.role || ''),
                        speaker: String(r.speakerName || r.speaker || ''),
                        text: String(r.text || ''),
                    })),
                    status: snap.status,
                    events: events.length,
                    chromeRaw: chromeRaw.length,
                    asrRaw: asrRaw.length,
                    degrade: degrade.length,
                    degradeLogs: degrade.slice(0, 5).map((e: any) => String(e.data?.message || '')),
                    micPcm: micPcm.length,
                    srLifecycle: (window as any).__srLifecycle || null,
                };
            });

            console.log(`[REPLAY] === CONVERSACION (${filas.filas.length} filas) ===`);
            filas.filas.forEach((f: any, i: number) => console.log(`[FILA-${i}] ${f.role} | ${f.speaker} | ${f.text}`));
            console.log(`[REPLAY] eventos=${filas.events} chromeRaw=${filas.chromeRaw} asrRaw=${filas.asrRaw} degrade=${filas.degrade} micPcm=${filas.micPcm}`);
            console.log(`[REPLAY] srLifecycle=${JSON.stringify(filas.srLifecycle)}`);
            filas.degradeLogs.forEach((d: string) => console.log(`[DEGRADE] ${d}`));
            if (errors.length) console.log(`[REPLAY] pageerrors=${JSON.stringify(errors)}`);

            // Regla del escenario: con SR mudo y voz en el micro, la app DEBE
            // degradar al motor local y transcribir (la sesion 45aeb8e2 real
            // perdio 142 s de habla por no hacerlo).
            expect(filas.degrade, 'la app degrada al motor local (SR mudo + voz en PCM)').toBeGreaterThan(0);
            expect(filas.asrRaw, 'el motor local produce transcripcion (asrRaw)').toBeGreaterThan(0);

            // Artefacto para analisis posterior (fuera del repo).
            writeFileSync(
                join(tmpdir(), 'flu-replay', `45aeb8e2-${SR_MODE}-${Date.now()}.json`),
                JSON.stringify({ filas, errors }, null, 2),
            );
        },
    );
});
