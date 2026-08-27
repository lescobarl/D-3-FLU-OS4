// ============================================================
// validate-regla3-cancion.spec.ts
// VALIDACIÓN REGLA 3: "ok flu canta la canción X" → la emoción de
// cantar se sostiene MIENTRAS suene la canción (no solo 8s), y se
// libera cuando la música termina.
//
// Mecanismo validado (data-driven, sin hardcode):
//   App.tsx (play_music) → setPendingEmotionAnims(anims, 'ai', 'song')
//   → integrationStore.pendingEmotionSustainMode = 'song'
//   → SPEAKING: NO aplica reset de 7s y scheduleSustainedAction(anims,'song')
//   → poller 1s sobre isMusicPlaying(): sostiene mientras suene la canción
//   → al terminar la música: "Acción sostenida terminada (canción terminó)"
//     y restaura el blend del estado actual.
//
// Para reproducir audio headless de forma DETERMINISTA (sin red) se usa un
// WAV mudo en data: URL con loop=true: isMusicPlaying()===true mientras no
// se llame a stopMusic().
// ============================================================
import { test, expect } from '@playwright/test';

// Permite reproducir audio headless sin gesto de usuario y en silencio.
test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
});

/** Genera un WAV mono 8-bit MUDO en data: URL (100% offline). */
function silentWavDataUrl(seconds: number): string {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds; // 8-bit → 1 byte por muestra
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // audioFormat = PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28); // byteRate
  buffer.writeUInt16LE(1, 32); // blockAlign
  buffer.writeUInt16LE(8, 34); // bitsPerSample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  buffer.fill(0x80, 44); // silencio (8-bit sin signo)
  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

const SILENT_WAV = silentWavDataUrl(1); // 1s, loop=true → nunca termina solo

test('REGLA 3: canta → la emoción se sostiene MIENTRAS suene la canción y se libera al parar la música', async ({ page }) => {
  test.setTimeout(120000);

  const browserLogs: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[AvatarVoiceSync]') || text.includes('[DIAG]') || text.includes('[TEST]')) {
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
  // FASE 1: iniciar "música" (WAV mudo en loop → isMusicPlaying()===true)
  // ========================================
  const musicPlaying = await page.evaluate(async (wav) => {
    // @ts-ignore
    const mp = window.__musicPlayer;
    mp.playMusicUrl(wav, { loop: true });
    await new Promise((r) => setTimeout(r, 400));
    return mp.isMusicPlaying();
  }, SILENT_WAV);
  console.log(`[TEST] FASE 1: isMusicPlaying()=${musicPlaying}`);
  expect(musicPlaying, 'La música debe estar sonando (isMusicPlaying()===true) para validar la Regla 3').toBe(true);

  // ========================================
  // FASE 2: ciclo de canción → SPEAKING con sustainMode='song'
  // ========================================
  await goIdle();
  const phase = await page.evaluate(async () => {
    // @ts-ignore
    const intStore = window.__intStore;
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    intStore.getState().setPendingEmotionAnims(['Dance'], 'ai', 'song');
    await new Promise((r) => setTimeout(r, 150)); // propagar update del store
    const modeBeforeSpeaking = intStore.getState().uiState.pendingEmotionSustainMode;
    const animsBeforeSpeaking = intStore.getState().uiState.pendingEmotionAnims;
    intStore.getState().setConversationState('SPEAKING');
    intStore.getState().setFluSpeaking(true);
    await new Promise((r) => setTimeout(r, 700)); // dejar que el blend se aplique
    const duringSpeaking = bunnyStore.getState().blendQueue ?? [];
    return { modeBeforeSpeaking, animsBeforeSpeaking, duringSpeaking };
  });
  console.log(`[TEST] FASE 2: mode='${phase.modeBeforeSpeaking}' anims=[${phase.animsBeforeSpeaking.join(', ')}] duringSpeaking=[${phase.duringSpeaking.join(', ')}]`);
  expect(phase.modeBeforeSpeaking, 'El store debe propagar pendingEmotionSustainMode="song" (data-driven)').toBe('song');
  expect(phase.animsBeforeSpeaking, 'La emoción pendiente debe ser Dance (cantar → Dance)').toContain('Dance');
  expect(phase.duringSpeaking, 'Durante SPEAKING el blend debe contener Dance').toContain('Dance');

  // ========================================
  // FASE 3: el reset de 7s NO debe aparecer (Regla 3 lo omite)
  // ========================================
  const startMs = Date.now();
  const logSliceStart = browserLogs.length;
  await page.waitForTimeout(7800); // más que los 7s del reset normal
  const resetLog = browserLogs.slice(logSliceStart).find((l) => l.includes('7s emoción terminada →'));
  console.log(`[TEST] FASE 3: reset7s='${resetLog ?? '(NO APARECIÓ ✅)'}' elapsed=${Date.now() - startMs}ms`);
  expect(resetLog, 'Regla 3: NO debe aplicarse el reset de 7s mientras suena la canción').toBeUndefined();

  // ========================================
  // FASE 4: SPEAKING→LISTENING → Dance se SOSTIENE (no muere a los ~2s)
  // ========================================
  const duringListening = await page.evaluate(async () => {
    // @ts-ignore
    const intStore = window.__intStore;
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    intStore.getState().setConversationState('LISTENING');
    intStore.getState().setFluSpeaking(false);
    await new Promise((r) => setTimeout(r, 600));
    return bunnyStore.getState().blendQueue ?? [];
  });
  console.log(`[TEST] FASE 4: duringListening=[${duringListening.join(', ')}]`);
  expect(duringListening, 'Tras SPEAKING→LISTENING Dance debe SOSTENERSE mientras suene la canción').toContain('Dance');

  // ========================================
  // FASE 5: pasados los 8s (tope del modo fijo) Dance SIGUE vivo
  // ========================================
  await page.waitForTimeout(2000); // total ~10s desde FASE 2 → más allá de 8s fijos
  const duringLongSong = await page.evaluate(async () => {
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    return bunnyStore.getState().blendQueue ?? [];
  });
  console.log(`[TEST] FASE 5: duringLongSong (~10s, más allá del tope fijo de 8s)=[${duringLongSong.join(', ')}]`);
  expect(duringLongSong, 'Regla 3: Dance debe SOSTENERSE más allá de los 8s fijos mientras la canción siga sonando').toContain('Dance');

  // ========================================
  // FASE 6: parar la música → el poller libera la emoción
  // ========================================
  const logStopStart = browserLogs.length;
  const stopped = await page.evaluate(async () => {
    // @ts-ignore
    const mp = window.__musicPlayer;
    mp.stopMusic();
    await new Promise((r) => setTimeout(r, 300));
    return mp.isMusicPlaying();
  });
  console.log(`[TEST] FASE 6: isMusicPlaying() tras stopMusic()=${stopped}`);
  expect(stopped, 'stopMusic() debe apagar la música (isMusicPlaying()===false)').toBe(false);

  const stopDeadline = Date.now() + 4000;
  let songOverLog: string | undefined;
  while (Date.now() < stopDeadline) {
    songOverLog = browserLogs.slice(logStopStart).find((l) => l.includes('canción terminó'));
    if (songOverLog) break;
    await page.waitForTimeout(200);
  }
  console.log(`[TEST] FASE 6: songOverLog='${songOverLog ?? '(NO APARECIÓ)'}'`);
  expect(songOverLog, 'Al terminar la música debe aparecer "Acción sostenida terminada (canción terminó)"').toBeTruthy();

  const afterStop = await page.evaluate(async () => {
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    return bunnyStore.getState().blendQueue ?? [];
  });
  console.log(`[TEST] FASE 7: afterStop=[${afterStop.join(', ')}]`);
  expect(afterStop.includes('Dance'), 'Al terminar la canción Dance debe liberarse (restaurar el flujo normal)').toBe(false);

  // ========================================
  // ASSERT final: sin errores de página
  // ========================================
  console.log(`[TEST] pageErrors: ${pageErrors.length}`);
  expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

  console.log('[TEST] ✅ REGLA 3 VALIDADA: cantar se sostiene durante toda la canción y se libera al parar la música.');
});
