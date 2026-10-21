// ============================================================
// DEMO VIVA — el PORTAL REAL escucha la grabacion 45aeb8e2.
// ------------------------------------------------------------
// Ventana de Chrome VISIBLE sobre el dev server real. El microfono es el
// DISPOSITIVO FALSO de Chrome (`--use-file-for-fake-audio-capture`, ver
// playwright.live.config.ts): NO hay stub de getUserMedia ni de
// SpeechRecognition en la pagina. La app usa su tuberia real (worklet -> PCM
// -> VAD -> ASR -> ingress -> conversacion -> hablantes).
//
// El WAV trae 10 s de silencio delante: al pulsar Iniciar empieza a sonar la
// grabacion. La evidencia queda ademas en os.tmpdir()/flu-recordings.
// ============================================================
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autoSkipOnboarding, gotoClean } from './_helpers';

const REC_DIR = join(tmpdir(), 'flu-recordings', '45aeb8e2-ba60-4b54-ae6c-0afc3c50357a');

/** Participantes REALES de la sesion (base snapshot con el vector de luis). */
function leerParticipantes() {
    const lines = readFileSync(join(REC_DIR, 'turns.ndjson'), 'utf8').trim().split('\n');
    const base = lines.map((l) => JSON.parse(l)).find((t: any) => t?.kind === 'base');
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

/**
 * Escenario de CARRERA reproducido en el portal REAL: getUserMedia tarda 2 s
 * (permiso lento) y la escucha se abre DOS veces mientras el primero espera
 * (boton Iniciar + comando `start-listening` del puente del avatar, ambos
 * caminos reales). Sin candado de arranque unico se montan DOS pipelines y el
 * PCM grabado avanza al DOBLE de tiempo real; con el candado, 1x.
 */
test('DEMO VIVA: doble arranque simultaneo no duplica el PCM', async ({ page }) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await autoSkipOnboarding(page);
    await gotoClean(page);

    const participantes = leerParticipantes();
    await seedParticipants(page, participantes);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 45000 });
    const luis = participantes.find((p: any) => p.voiceAnchorVerified);
    const uid = luis ? luis.id : participantes[0].id;
    const picker = page.locator('[data-testid="user-picker-select"]');
    await picker.waitFor({ state: 'attached', timeout: 30000 });
    await picker.selectOption(uid);
    await page.waitForFunction((id: string) => localStorage.getItem('flu-active-user') === id, uid, { timeout: 15000 });

    await page.evaluate(async () => {
        try {
            const MOD = '/src/voice/lib/asr/whisperWasmTranscriber.js';
            const t = await import(/* @vite-ignore */ MOD);
            const tr = (t as any).createWhisperWasmTranscriber();
            await tr.preload().catch(() => {});
            tr.dispose();
        } catch { /* modelo opcional */ }
    });

    // Permiso LENTO + contador real de capturas de microfono.
    await page.evaluate(() => {
        const md = navigator.mediaDevices as any;
        const orig = md.getUserMedia.bind(md);
        (window as any).__gmCalls = 0;
        md.getUserMedia = async (constraints: any) => {
            (window as any).__gmCalls += 1;
            await new Promise((r) => setTimeout(r, 2000));
            return orig(constraints);
        };
    });

    await page.evaluate(() => (window as any).__fluDev?.recorder?.enable?.());
    const boton = page.getByRole('button', { name: /iniciar/i }).first();
    await boton.click({ timeout: 20000 });
    await page.waitForTimeout(300);
    // Segundo arranque REAL mientras el primero sigue esperando el permiso.
    await page.evaluate(() => (window as any).__fluStore?.getState?.().sendVoiceCommand?.('start-listening'));
    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 60000 },
    );
    await page.waitForTimeout(3000);

    const s1 = await page.evaluate(() => (window as any).__fluDev.recorder.snapshot());
    const t1 = Date.now();
    await page.waitForTimeout(30_000);
    const s2 = await page.evaluate(() => (window as any).__fluDev.recorder.snapshot());
    const t2 = Date.now();

    const dAudio = s2.audio.seconds - s1.audio.seconds;
    const dWall = (t2 - t1) / 1000;
    const factor = dAudio / dWall;
    const gmCalls = await page.evaluate(() => (window as any).__gmCalls);
    console.log(`[RACE] audio=${dAudio.toFixed(2)}s pared=${dWall.toFixed(2)}s factor=${factor.toFixed(2)}x (1x correcto, 2x duplicado) getUserMedia=${gmCalls}`);
    const filas = await page.evaluate(() => ((window as any).__fluStore?.getState?.().conversationHistory || []).map((r: any) => `${r.role} | ${r.speakerName || r.speaker || ''} | ${r.text || ''}`));
    filas.forEach((f: string, i: number) => console.log(`[RACE-FILA-${i}] ${f}`));
    if (errors.length) console.log(`[RACE] pageerrors=${JSON.stringify(errors)}`);

    expect(factor, 'el PCM avanza a tiempo real (1x), sin captura duplicada').toBeLessThan(1.35);
});

test('DEMO VIVA: la grabacion alimenta el microfono del portal', async ({ page }) => {
    test.setTimeout(560000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await autoSkipOnboarding(page);

    await gotoClean(page);
    console.log('[LIVE] portal real abierto en la ventana de Chrome (http://localhost:5173)');

    const participantes = leerParticipantes();
    expect(participantes.length, 'la base de la sesion trae 2 participantes').toBeGreaterThanOrEqual(2);
    await seedParticipants(page, participantes);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 45000 });

    // El titular de la sesion es el usuario activo (mismo picker real de la app).
    const luis = participantes.find((p: any) => p.voiceAnchorVerified);
    const uid = luis ? luis.id : participantes[0].id;
    const picker = page.locator('[data-testid="user-picker-select"]');
    await picker.waitFor({ state: 'attached', timeout: 30000 });
    await picker.selectOption(uid);
    await page.waitForFunction((id: string) => localStorage.getItem('flu-active-user') === id, uid, { timeout: 15000 });

    // Modelo Whisper al cache del perfil ANTES de escuchar (el motor local lo
    // precalienta la propia app al abrir la escucha).
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

    // Click REAL (gesto de usuario) en Iniciar: abre la conversacion.
    const boton = page.getByRole('button', { name: /iniciar/i }).first();
    await boton.click({ timeout: 20000 });
    await page.waitForFunction(
        () => (window as any).__fluStore?.getState?.().conversationState === 'LISTENING',
        null,
        { timeout: 60000 },
    );
    const inicio = Date.now();
    console.log('[LIVE] ESCUCHANDO: la grabacion entra por el microfono (10 s de silencio + 142 s de voces)');

    // Ventana: 10 s de pad + 142 s de habla + 18 s de cierres.
    await page.waitForTimeout(170_000);
    console.log(`[LIVE] ventana cerrada en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);

    const filas = await page.evaluate(() => {
        const state = (window as any).__fluStore?.getState?.() || {};
        const rows = state.conversationHistory || [];
        const snap = (window as any).__fluDev?.recorder?.snapshot?.() || { status: {}, events: [] };
        const events = snap.events || [];
        const degrade = events.filter((e: any) => /\[REC\] degrade/.test(String(e.data?.message || '')));
        const asrRaw = events.filter((e: any) => String(e.event || '').includes('asrRaw') || String(e.data?.message || '').includes('asrRaw'));
        return {
            filas: rows.map((r: any) => ({
                role: String(r.role || ''),
                speaker: String(r.speakerName || r.speaker || ''),
                text: String(r.text || ''),
            })),
            events: events.length,
            degrade: degrade.length,
            degradeLogs: degrade.slice(0, 3).map((e: any) => String(e.data?.message || '')),
            asrRaw: asrRaw.length,
        };
    });

    console.log(`[LIVE] === CONVERSACION (${filas.filas.length} filas) ===`);
    filas.filas.forEach((f: any, i: number) => console.log(`[FILA-${i}] ${f.role} | ${f.speaker} | ${f.text}`));
    console.log(`[LIVE] eventos=${filas.events} degrade=${filas.degrade} asrRaw=${filas.asrRaw}`);
    filas.degradeLogs.forEach((d: string) => console.log(`[DEGRADE] ${d}`));
    if (errors.length) console.log(`[LIVE] pageerrors=${JSON.stringify(errors)}`);

    expect(filas.filas.length, 'la conversacion tiene filas').toBeGreaterThan(0);
});
