// ============================================================
// validate-real-online-cancion.spec.ts
// VALIDACIÓN REAL (sin WAV, sin inyección) de los 2 fixes:
//
// Bug 1 "canta 8s → idle": el baile debe SOSTENERSE TODA la
//   canción real (supera el gap async de playSong gracias a
//   SONG_START_GRACE_MS en useAvatarVoiceSync.ts).
// Bug 2 "la música nunca termina": la preview online de Deezer
//   (~30s, loop=false en musicPlayer.ts:270) debe TERMINAR SOLA,
//   y el baile debe terminar junto con ella.
//
// DIFERENCIA vs fix-canta-sustenta-toda-cancion.spec.ts: ahí se
// inyectaba un WAV mudo a +4.5s para garantizar isMusicPlaying().
// Aquí NO se inyecta NADA: se usa la música ONLINE REAL (canción
// NO catálogo → busca Deezer → preview real) y se espera su
// arranque y su FIN natural. Depende de red (como la app real).
//
// Flujo real validado:
//   contrato play_music 'despacito' (no catálogo → Deezer online)
//   → playSong() async arranca la preview real (~30s)
//   → checkSong de +1s ve silencio → SOLO sobrevive por la gracia
//   → el avatar baila (Dance) TODA la canción (>9s)
//   → la preview real TERMINA sola → isMusicPlaying()=false
//   → checkSong cancela → "canción terminó" → el baile termina.
// ============================================================
import { test, expect } from '@playwright/test';

// Permite reproducir audio headless sin gesto de usuario y en silencio.
test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
});

// Canción NO catálogo → fuerza la búsqueda ONLINE (Deezer, preview ~30s),
// que es exactamente el path donde estaba el bug del loop infinito.
const CONTRACT_PAYLOAD = {
  transcript: 'pon despacito por favor',
  contract: {
    musica: { accion: 'play_music', cancion: 'despacito' },
    animacion: 'Dance',
    respuesta_voz: 'Claro, aquí va la canción.',
  },
};

test('REAL: play_music ONLINE → la música real arranca, el baile sostiene TODA la canción (>9s) y la música TERMINA sola → el baile termina con ella', async ({ page }) => {
  test.setTimeout(180000);

  const browserLogs: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[AvatarVoiceSync]') || text.includes('[musicPlayer]') || text.includes('[TEST]')) {
      browserLogs.push(text);
      console.log(`[BROWSER] ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.log(`[PAGEERROR] ${err.message}`);
  });

  // ========================================
  // Cargar app + canvas 3D + exponer stores y musicPlayer
  // ========================================
  await page.goto('/');
  await page.waitForSelector('.flu-bridge-container canvas', { timeout: 30000 });
  console.log('[TEST] Canvas 3D visible');
  await page.waitForTimeout(5000); // cargar modelo FBX (SwiftShader es lento)

  const storeSetup = await page.evaluate(async () => {
    try {
      // @ts-ignore - rutas válidas en runtime
      const bunnyModule = await import('/src/avatar/store/bunnyStore.ts');
      // @ts-ignore
      const intModule = await import('/src/store/integrationStore.ts');
      // @ts-ignore
      const musicModule = await import('/src/services/musicPlayer.ts');
      // @ts-ignore
      window.__bunnyStore = bunnyModule.useBunnyStore;
      // @ts-ignore
      window.__intStore = intModule.useIntegrationStore;
      // @ts-ignore
      window.__musicPlayer = musicModule;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  if (!storeSetup.success) throw new Error(`No se pudieron inyectar módulos: ${JSON.stringify(storeSetup)}`);

  const goIdle = () =>
    page.evaluate(async () => {
      // @ts-ignore
      const intStore = window.__intStore;
      intStore.getState().setConversationState('IDLE');
      intStore.getState().setFluSpeaking(false);
      await new Promise((r) => setTimeout(r, 400));
    });

  // ========================================
  // FASE 1: la música NO suena antes de despachar
  // ========================================
  const before = await page.evaluate(async () => {
    // @ts-ignore
    const mp = window.__musicPlayer;
    return mp.isMusicPlaying();
  });
  console.log(`[TEST] FASE 1: isMusicPlaying() antes de despachar=${before}`);
  expect(before, 'Antes del contrato la música NO debe sonar').toBe(false);

  // ========================================
  // FASE 2: despachar el contrato REAL play_music (canción online)
  // ========================================
  await goIdle();
  const dispatchStartMs = Date.now();
  const dispatched = await page.evaluate((payload) => {
    // @ts-ignore
    const intStore = window.__intStore;
    let hookReady = false;
    let dispatchError = '';
    try {
      const fn = (window as any).__fluOnContractResolved;
      if (typeof fn !== 'function') {
        return { hookReady, dispatchError: 'hook __fluOnContractResolved no disponible' };
      }
      hookReady = true;
      const p = fn(payload);
      if (p && typeof p.then === 'function') {
        p.catch((e: any) => console.warn('[TEST] dispatch catch:', e));
      }
      return { hookReady, dispatchError };
    } catch (e: any) {
      return { hookReady, dispatchError: e.message };
    }
  }, CONTRACT_PAYLOAD);
  console.log(`[TEST] FASE 2: hookReady=${dispatched.hookReady} err='${dispatched.dispatchError}'`);
  expect(dispatched.hookReady, 'El hook __fluOnContractResolved debe estar disponible').toBe(true);
  expect(dispatched.dispatchError, `El dispatch no debe lanzar: ${dispatched.dispatchError}`).toBe('');

  // ========================================
  // FASE 3 (REAL): esperar a que la música ONLINE REAL arranque.
  // NO se inyecta nada: playSong() hace la sonda + búsqueda Deezer
  // y arranca la preview real. Polling hasta ~25s (el gap async real).
  // ========================================
  let musicStarted = false;
  let musicStartElapsed = -1;
  const startPollDeadline = Date.now() + 25000;
  while (Date.now() < startPollDeadline) {
    musicStarted = await page.evaluate(async () => {
      // @ts-ignore
      const mp = window.__musicPlayer;
      return mp.isMusicPlaying();
    });
    if (musicStarted) break;
    await page.waitForTimeout(1000);
  }
  musicStartElapsed = Date.now() - dispatchStartMs;
  console.log(`[TEST] FASE 3: música ONLINE REAL arrancó=${musicStarted} a +${musicStartElapsed}ms del contrato (gap async real de playSong)`);
  expect(musicStarted, `La música ONLINE REAL debe arrancar (playSong async). Si falla: ¿red/Deezer inaccesible? elapsed=${musicStartElapsed}ms`).toBe(true);

  // ========================================
  // FASE 4 (Bug 1 REAL): el baile (Dance) se sostiene pasados >9s
  // mientras la música real suena (el checkSong de +1s vio silencio;
  // sobrevivió solo por SONG_START_GRACE_MS).
  // ========================================
  // Dejar que el ciclo SPEAKING → (habla/respuesta) → LISTENING se asiente.
  const settled = await page.evaluate(async () => {
    // @ts-ignore
    const intStore = window.__intStore;
    const deadline = Date.now() + 4000;
    let cs = intStore.getState().conversationState;
    while (Date.now() < deadline && cs !== 'IDLE') {
      await new Promise((r) => setTimeout(r, 200));
      cs = intStore.getState().conversationState;
    }
    return { state: cs, pending: intStore.getState().uiState.pendingEmotionAnims };
  });
  console.log(`[TEST] FASE 4: estado asentado='${settled.state}' pending=[${settled.pending.join(', ')}]`);

  if (settled.pending.length > 0) {
    // Si la emoción no se consumió, forzar SPEAKING para que el efecto la consuma.
    await page.evaluate(async () => {
      // @ts-ignore
      const intStore = window.__intStore;
      intStore.getState().setConversationState('SPEAKING');
      intStore.getState().setFluSpeaking(true);
      await new Promise((r) => setTimeout(r, 700));
    });
  }
  // LISTENING re-aplica la acción sostenida 'song' → Dance vuelve al blendQueue.
  await page.evaluate(async () => {
    // @ts-ignore
    const intStore = window.__intStore;
    intStore.getState().setConversationState('LISTENING');
    intStore.getState().setFluSpeaking(false);
    await new Promise((r) => setTimeout(r, 700));
  });

  // Esperar a que pasen >9s desde el dispatch (más que el tope fijo de 8s).
  const elapsedBeforeWait = Date.now() - dispatchStartMs;
  const remaining = 9000 - elapsedBeforeWait;
  if (remaining > 0) {
    await page.waitForTimeout(remaining + 300);
  }
  const past9s = await page.evaluate(async () => {
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    // @ts-ignore
    const mp = window.__musicPlayer;
    return {
      blendQueue: bunnyStore.getState().blendQueue ?? [],
      musicStillPlaying: mp.isMusicPlaying(),
    };
  });
  const totalElapsed = Date.now() - dispatchStartMs;
  console.log(`[TEST] FASE 4: elapsed=${totalElapsed}ms blendQueue=[${past9s.blendQueue.join(', ')}] musicStillPlaying=${past9s.musicStillPlaying}`);
  expect(past9s.blendQueue.includes('Dance'), `Pasados ${totalElapsed}ms (>8s) el avatar SIGUE bailando (Dance) con la música REAL → Bug 1 ARREGLADO`).toBe(true);
  expect(past9s.musicStillPlaying, 'La música real sigue sonando a los >9s').toBe(true);

  // ========================================
  // FASE 5 (Bug 2 REAL — el definitivo): la preview online REAL
  // (~30s, loop=false) debe TERMINAR SOLA. NO se llama a stopMusic:
  // es el fin natural del audio. Polling hasta ~70s.
  // ========================================
  const logSliceStart = browserLogs.length;
  let musicEnded = false;
  const endDeadline = Date.now() + 70000;
  while (Date.now() < endDeadline) {
    musicEnded = await page.evaluate(async () => {
      // @ts-ignore
      const mp = window.__musicPlayer;
      return !mp.isMusicPlaying();
    });
    if (musicEnded) break;
    await page.waitForTimeout(1000);
  }
  const endElapsed = Date.now() - dispatchStartMs;
  const endedLog = browserLogs.slice(logSliceStart).find((l) => l.includes('canción terminó'));
  console.log(`[TEST] FASE 5: la música REAL terminó SOLA=${musicEnded} a +${endElapsed}ms del contrato → log='${endedLog ?? '(sin log)'}'`);
  expect(musicEnded, `La música ONLINE REAL debe TERMINAR sola (loop=false → Bug 2 ARREGLADO). Si no: el loop infinito sigue o el stream no terminó (red). elapsed=${endElapsed}ms`).toBe(true);
  expect(endedLog, 'El poller de sustain debe registrar "canción terminó" al acabar la música real').toBeTruthy();

  // ========================================
  // FASE 6: con la música terminada, el baile (Dance) se libera.
  // ========================================
  await page.waitForTimeout(1500); // dejar que checkSong (1s) procese el fin
  const afterEnd = await page.evaluate(async () => {
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    return bunnyStore.getState().blendQueue ?? [];
  });
  console.log(`[TEST] FASE 6: tras terminar la música blendQueue=[${afterEnd.join(', ')}]`);
  expect(afterEnd.includes('Dance'), 'Con la música REAL terminada, el baile (Dance) debe liberarse (ambos terminan juntos)').toBe(false);

  // ========================================
  // ASSERT final: sin errores de página
  // ========================================
  console.log(`[TEST] pageErrors: ${pageErrors.length}`);
  expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

  console.log('[TEST] ✅ VALIDACIÓN REAL COMPLETA: música online arranca → baile sostiene TODA la canción (>9s) → la música TERMINA sola → el baile termina con ella.');
});
