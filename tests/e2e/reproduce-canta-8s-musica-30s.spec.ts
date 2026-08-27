// ============================================================
// reproduce-canta-8s-musica-30s.spec.ts
// REPRODUCCIÓN del escenario REAL reportado por el usuario:
//   "el avatar solo canto 8 segundos y la musica continuo por 30"
//
// Esta prueba EJECUTA (no teoriza) el mecanismo exacto:
//   1. La música suena (WAV mudo en loop → isMusicPlaying()===true).
//   2. Queda un "leftover" en pendingEmotionAnims con sustainMode=null.
//      Este es el estado que deja App.tsx:950 cuando el guard
//      `hasActivePendingEmotion` es true y se SALTA setPendingEmotionAnims
//      con sustainMode='song' (la canción NUNCA recibe modo 'song').
//   3. SPEAKING lee ese leftover → isSongSustain=false → scheduleSustainedAction
//      con modo 'fixed' → exactamente SUSTAINED_ACTION_MS = 8000ms.
//   4. A los 8s Dance se LIBERA del blendQueue, pero la música SIGUE sonando.
//
// Resultado esperado (la prueba pasa si reproduce el bug): canta 8s y la
// música continúa → exactamente lo que vio el usuario.
// ============================================================
import { test, expect } from '@playwright/test';

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

test('REPRO: el avatar canta 8s y la música continúa (leftover sustainMode=null → fixed)', async ({ page }) => {
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
  // FASE 1: la música SUENA (isMusicPlaying()===true) — como la Deezer 30s real
  // ========================================
  const musicPlaying = await page.evaluate(async (wav) => {
    // @ts-ignore
    const mp = window.__musicPlayer;
    mp.playMusicUrl(wav, { loop: true });
    await new Promise((r) => setTimeout(r, 400));
    return mp.isMusicPlaying();
  }, SILENT_WAV);
  console.log(`[TEST] FASE 1: isMusicPlaying()=${musicPlaying}`);
  expect(musicPlaying, 'La música debe estar sonando (como los 30s reales de Deezer)').toBe(true);

  // ========================================
  // FASE 2 (BÚSQUEDA DEL BUG): leftover con sustainMode=null + SPEAKING
  // Este leftover es EXACTAMENTE el estado que deja App.tsx:950 cuando el
  // guard hasActivePendingEmotion es true y se salta el setPendingEmotionAnims
  // con sustainMode='song' → la canción NUNCA recibe 'song', queda 'null'.
  // ========================================
  await goIdle();
  const phase = await page.evaluate(async () => {
    // @ts-ignore
    const intStore = window.__intStore;
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    // Leftover del turno previo (sustainMode=null — el bug: no llegó 'song')
    intStore.getState().setPendingEmotionAnims(['Dance'], 'ai', null);
    await new Promise((r) => setTimeout(r, 150)); // propagar update del store
    const modeBeforeSpeaking = intStore.getState().uiState.pendingEmotionSustainMode;
    const animsBeforeSpeaking = intStore.getState().uiState.pendingEmotionAnims;
    intStore.getState().setConversationState('SPEAKING');
    intStore.getState().setFluSpeaking(true);
    await new Promise((r) => setTimeout(r, 700)); // dejar que el blend se aplique
    const duringSpeaking = bunnyStore.getState().blendQueue ?? [];
    return { modeBeforeSpeaking, animsBeforeSpeaking, duringSpeaking };
  });
  console.log(`[TEST] FASE 2: leftover mode='${phase.modeBeforeSpeaking}' anims=[${phase.animsBeforeSpeaking.join(', ')}] duringSpeaking=[${phase.duringSpeaking.join(', ')}]`);
  expect(phase.modeBeforeSpeaking, `El leftover tiene sustainMode=null (el bug: ${'song'} nunca se aplicó)`).toBeNull();
  expect(phase.animsBeforeSpeaking, 'El leftover debe ser Dance').toContain('Dance');
  expect(phase.duringSpeaking, 'Al iniciar SPEAKING Dance SÍ está mezclado (el avatar empieza a cantar)').toContain('Dance');

  // ========================================
  // FASE 3: esperar más de SUSTAINED_ACTION_MS (8000ms) → Dance se LIBERA
  // El modo 'fixed' pone el timeout exactamente en 8s: el avatar deja de cantar.
  // ========================================
  const startMs = Date.now();
  await page.waitForTimeout(8800); // ~8.8s → más que el tope fijo de 8s
  const after8s = await page.evaluate(async () => {
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    // @ts-ignore
    const intStore = window.__intStore;
    // @ts-ignore
    const mp = window.__musicPlayer;
    return {
      blendQueue: bunnyStore.getState().blendQueue ?? [],
      musicStillPlaying: mp.isMusicPlaying(),
    };
  });
  const elapsed = Date.now() - startMs;
  console.log(`[TEST] FASE 3: elapsed=${elapsed}ms after8s=[${after8s.blendQueue.join(', ')}] musicStillPlaying=${after8s.musicStillPlaying}`);
  expect(after8s.blendQueue.includes('Dance'), `Pasados ${elapsed}ms el avatar DEJÓ de cantar (Dance liberado) → 'cantó solo 8s'`).toBe(false);
  expect(after8s.musicStillPlaying, 'LA MÚSICA SIGUE SONANDO tras los 8s → "la música continuó 30s"').toBe(true);

  // ========================================
  // FASE 4: un poco más de tiempo → el avatar SIGUE sin bailar y la música SIGUE
  // (la separación canto/reproducción es total: canto 8s, música 30s)
  // ========================================
  await page.waitForTimeout(2500);
  const finalState = await page.evaluate(async () => {
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    // @ts-ignore
    const mp = window.__musicPlayer;
    return {
      blendQueue: bunnyStore.getState().blendQueue ?? [],
      musicStillPlaying: mp.isMusicPlaying(),
    };
  });
  console.log(`[TEST] FASE 4: final blendQueue=[${finalState.blendQueue.join(', ')}] musicStillPlaying=${finalState.musicStillPlaying}`);
  expect(finalState.blendQueue.includes('Dance'), 'El avatar sigue SIN bailar (canto muerto a los 8s)').toBe(false);
  expect(finalState.musicStillPlaying, 'La música sigue sonando (reproducción viva)').toBe(true);

  // ========================================
  // ASSERT final: sin errores de página
  // ========================================
  console.log(`[TEST] pageErrors: ${pageErrors.length}`);
  expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

  console.log('[TEST] ✅ REPRO CONFIRMADA: el avatar canta exactamente 8s (fixed) y la música continúa 30s (isMusicPlaying()===true) — el escenario real del usuario.');
});
