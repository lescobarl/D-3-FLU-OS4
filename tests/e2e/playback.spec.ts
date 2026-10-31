// ============================================================
// FLU Playback - spec de soporte
// ------------------------------------------------------------
// Se ejecuta SOLO por `npm run playback`. Reproduce el WAV de una sesión
// como micrófono virtual, espera LISTENING, deja correr la app y escribe
// artefactos. No siembra el estado final: clean-room crea solo el usuario
// activo mínimo; restore-start exige un snapshot base-start.
// ============================================================
import { expect, test } from '@playwright/test';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScriptedFinals, loadSession } from '../../scripts/playback/session.mjs';
import { autoSkipOnboarding, gotoClean, seedActiveUser, stubLocalSpeech } from './_helpers';
import {
    enablePlaybackRecorder,
    finalizePlaybackRecorder,
    readPlaybackRows,
    seedBaseStartParticipants,
    startUiObserver,
    stopUiObserver,
    stubMuteRecognition,
    stubScriptedRecognition,
    stubWavMicrophone,
} from './playbackHelpers';

const SESSION_PATH = process.env.FLU_PLAYBACK_SESSION || '';
const OUT_DIR = process.env.FLU_PLAYBACK_OUT || '';
const MODE = process.env.FLU_PLAYBACK_MODE || 'clean-room';
const SR = process.env.FLU_PLAYBACK_SR || 'mute';
const LEAD_IN_MS = Number(process.env.FLU_PLAYBACK_LEAD_IN_MS || 0);
const TAIL_MS = Number(process.env.FLU_PLAYBACK_TAIL_MS || 5000);
const TIMEOUT_MS = Number(process.env.FLU_PLAYBACK_TIMEOUT_MS || 600000);
const NO_CAPTURE = process.env.FLU_PLAYBACK_NO_CAPTURE === '1';
const REAL_WAV = process.env.FLU_PLAYBACK_REAL_WAV || '';
const REAL_LEAD_IN_MS = Number(process.env.FLU_PLAYBACK_REAL_LEAD_IN_MS || 0);
const WAV_URL = 'https://playback.local/session.wav';

test.skip(!SESSION_PATH, 'FLU Playback se ejecuta con npm run playback');
test.setTimeout(TIMEOUT_MS);
test.use(
    SR === 'real'
        ? {
              headless: false,
              channel: 'chrome',
              permissions: ['microphone'],
              launchOptions: {
                  args: [
                      '--use-fake-ui-for-media-stream',
                      '--use-fake-device-for-media-stream',
                      `--use-file-for-fake-audio-capture=${REAL_WAV}`,
                      '--autoplay-policy=no-user-gesture-required',
                  ],
              },
          }
        : { headless: process.env.FLU_PLAYBACK_HEADED !== '1' },
);

const session: any = SESSION_PATH ? loadSession(SESSION_PATH) : null;

function ndjson(rows: any[]): string {
    return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

test(`FLU Playback (${MODE}, SR=${SR})`, async ({ page }) => {
    if (!session) throw new Error('Falta FLU_PLAYBACK_SESSION');
    if (!OUT_DIR) throw new Error('Falta FLU_PLAYBACK_OUT');
    const trace = (stage: string, extra: any = {}) =>
        console.log(`[playback-spec] ${stage} ${JSON.stringify(extra)}`);
    trace('start', { mode: MODE, sr: SR, seconds: session.audio.seconds, out: OUT_DIR });
    if (!session.audioPath.toLowerCase().endsWith('.wav')) {
        throw new Error('Fase 1 de FLU Playback solo reproduce audio.wav');
    }
    mkdirSync(OUT_DIR, { recursive: true });

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    if (SR === 'real' && !REAL_WAV) {
        throw new Error('--sr real exige FLU_PLAYBACK_REAL_WAV (WAV con pad)');
    }
    await autoSkipOnboarding(page);
    await stubLocalSpeech(page);
    if (SR !== 'real') {
        await page.route(WAV_URL, (route) =>
            route.fulfill({
                path: session.audioPath,
                contentType: 'audio/wav',
                headers: { 'Access-Control-Allow-Origin': '*' },
            }),
        );
        await page.addInitScript(stubWavMicrophone(), WAV_URL);
    }
    if (SR === 'mute') await page.addInitScript(stubMuteRecognition());
    if (SR === 'script') {
        const finals = buildScriptedFinals(session);
        await page.addInitScript(stubScriptedRecognition(), finals);
        trace('script-installed', { finals: finals.length });
    }

    await gotoClean(page);
    trace('clean');
    if (MODE === 'restore-start') {
        await seedBaseStartParticipants(page, session.baseStartParticipants);
        trace('seed-restore-start', { count: session.baseStartParticipants.length });
    } else {
        await seedActiveUser(page, 'Usuario Playback');
        trace('seed-clean-room');
    }

    if (!NO_CAPTURE) await enablePlaybackRecorder(page);
    trace('recorder-enabled', { capture: !NO_CAPTURE });

    await page.waitForSelector('.flu-shell', { timeout: 45000 });
    trace('shell-ready');
    if (MODE === 'restore-start') {
        // El reload de la base puede dejar el auto-start en LISTENING antes de crear
        // SpeechRecognition: deja el estado en IDLE para que el click cree el motor.
        await page.evaluate(() => {
            const store = (window as any).__fluStore?.getState?.();
            if (store?.conversationState === 'LISTENING' && typeof store.setConversationState === 'function') {
                store.setConversationState('IDLE');
            }
        });
        trace('restore-start-reset-idle');
    }
    const clicked = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('button,[role="button"]'));
        const button = nodes.find((node) =>
            /iniciar/i.test(String(node.getAttribute('aria-label') || node.textContent || '')),
        );
        if (!button) return false;
        (button as HTMLElement).click();
        return true;
    });
    if (!clicked) throw new Error('No se encontró el botón Iniciar');
    trace('start-clicked');

    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 60000 },
    );
    trace('listening');
    await startUiObserver(page);
    if (SR !== 'real' && LEAD_IN_MS > 0) await page.waitForTimeout(LEAD_IN_MS);

    if (SR !== 'real') {
        // DECISIÓN TOMADA (2026-10-27): el micrófono virtual se instala al pedir el
        // micrófono y `ready` llega tras decodificar el WAV; se espera con condición
        // y timeout explícitos (sin tocar las aserciones de producto).
        await page.waitForFunction(
            () => (window as any).__fluPlayback?.status?.()?.ready === true,
            null,
            { timeout: 60000 },
        );
        const playbackBefore = await page.evaluate(() => (window as any).__fluPlayback?.status?.());
        if (!playbackBefore?.ready) {
            throw new Error(`Micrófono virtual no listo: ${JSON.stringify(playbackBefore)}`);
        }
        await page.evaluate(async () => {
            await (window as any).__fluPlayback?.start?.();
        });
    }

    const listenMs =
        Math.ceil(session.audio.seconds * 1000) +
        TAIL_MS +
        (SR === 'real' ? REAL_LEAD_IN_MS : 0);
    trace('playback-wait-start', { listenMs });
    if (SR === 'real') {
        await page.waitForTimeout(listenMs);
    } else {
        // Válido solo si el WAV se consumió hasta el final. El guion va anclado
        // al reloj de AUDIO (posición), no al de pared: si el AudioContext se
        // estrangula, esperar por pared mediría un escenario que no ocurrió.
        await page.waitForFunction(
            () => {
                const status = (window as any).__fluPlayback?.status?.();
                if (!status) return false;
                if (status.ended) return true;
                return (
                    Number(status.duration) > 0 &&
                    Number(status.position) >= Number(status.duration) - 0.25
                );
            },
            null,
            { timeout: Math.min(TIMEOUT_MS - 60000, Math.max(listenMs * 4, 120000)) },
        );
        await page.waitForTimeout(TAIL_MS);
    }
    trace('playback-wait-done');

    const ui = await stopUiObserver(page);
    const rows = await readPlaybackRows(page);
    const script =
        SR === 'script'
            ? await page.evaluate(() => (window as any).__fluScript || null)
            : null;
    trace('script-emitted', script ? { planned: script.planned, emitted: script.emitted?.length || 0, errors: script.errors?.length || 0 } : {});
    const playback =
        SR === 'real'
            ? {
                  ready: true,
                  started: true,
                  ended: true,
                  duration: session.audio.seconds,
                  elapsed: listenMs,
                  mode: 'fake-device',
              }
            : await page.evaluate(() => (window as any).__fluPlayback?.status?.());
    const snapshot = NO_CAPTURE
        ? null
        : await page.evaluate(() => (window as any).__fluDev?.recorder?.snapshot?.() || null);
    const recorderStatus = NO_CAPTURE
        ? null
        : await page.evaluate(() => (window as any).__fluDev?.recorder?.status?.() || null);

    trace('snapshot', { rows: rows.length, ui: ui.length, events: snapshot?.events?.length || 0, captured: snapshot?.audio?.seconds || 0 });
    if (!NO_CAPTURE) await finalizePlaybackRecorder(page);
    trace('recorder-finalized');
    await page.evaluate(() => (window as any).__fluPlayback?.stop?.());

    writeFileSync(join(OUT_DIR, 'rows.ndjson'), ndjson(rows))
    writeFileSync(join(OUT_DIR, 'ui.ndjson'), ndjson(ui))
    if (snapshot?.events) writeFileSync(join(OUT_DIR, 'events.ndjson'), ndjson(snapshot.events))
    writeFileSync(
        join(OUT_DIR, 'audio.json'),
        JSON.stringify({ source: session.audio, playback, recorder: snapshot?.audio || null }, null, 2),
    )

    if (recorderStatus?.sessionId) {
        const recordedDir = join(tmpdir(), 'flu-recordings', String(recorderStatus.sessionId));
        if (existsSync(recordedDir)) {
            cpSync(recordedDir, join(OUT_DIR, 'recorder'), { recursive: true });
        }
    }

    const captured = NO_CAPTURE || Number(snapshot?.audio?.seconds || 0) > 0;
    const rowsOk = SR === 'real' ? rows.length > 0 : true;
    // Invariante del HARNESS (no del producto): el audio debe haberse consumido
    // hasta el final. Con el AudioContext estrangulado, la corrida mide otro
    // escenario (finales adelantados) y no puede darse por válida.
    const audioOk =
        SR === 'real' ||
        Boolean(playback?.ended) ||
        Number(playback?.position || 0) >= Number(playback?.duration || 0) - 0.25;
    // Invariante del HARNESS (no del producto): si el guion no se emitió completo,
    // la corrida no mide lo que dice medir y no puede darse por válida.
    const scriptOk =
        SR !== 'script' ||
        (Boolean(script) &&
            script.planned === script.emitted.length &&
            script.errors.length === 0);
    const result = {
        schemaVersion: 1,
        ok:
            errors.length === 0 &&
            Boolean(playback?.ready) &&
            Boolean(playback?.started) &&
            captured &&
            audioOk &&
            rowsOk &&
            scriptOk,
        mode: MODE,
        sr: SR,
        realWav: REAL_WAV || null,
        session: {
            id: session.sessionId,
            dir: session.dir,
            schemaVersion: session.schemaVersion,
            audioSeconds: session.audio.seconds,
            sampleRate: session.audio.sampleRate,
            sourceRows: session.sourceRows.length,
            hasBaseStart: session.hasBaseStart,
            fidelity: session.fidelity,
        },
        playback,
        recorder: recorderStatus,
        script,
        rows,
        ui,
        errors,
        artifacts: {
            rows: 'rows.ndjson',
            ui: 'ui.ndjson',
            events: snapshot?.events ? 'events.ndjson' : null,
            audio: 'audio.json',
            recorder: recorderStatus?.sessionId ? 'recorder/' : null,
        },
    };
    writeFileSync(join(OUT_DIR, 'result.json'), JSON.stringify(result, null, 2));

    expect(errors, `pageerrors: ${errors.join(' | ')}`).toEqual([]);
    expect(result.ok, JSON.stringify({ playback, captured: snapshot?.audio || null })).toBe(true);
});
