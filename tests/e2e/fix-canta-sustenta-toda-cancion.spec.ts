// ============================================================
// fix-canta-sustenta-toda-cancion.spec.ts
// VERIFICACIÓN DEL FIX (red→green) del escenario REAL reportado:
//   "el avatar solo canto 8 segundos y la musica continuo por 30"
//
// PRUEBA ROJA (sin el fix): al despachar un contrato play_music
// mientras existe un leftover en pendingEmotionAnims (sustainMode=null),
// el guard `hasActivePendingEmotion` de App.tsx:954 se SALTA
// setPendingEmotionAnims con sustainMode='song' → el store sigue con
// ['Wave']/null → la canción NUNCA recibe modo 'song' → el avatar
// cantará SOLO 8s (fixed) aunque la música siga 30s.
//
// PRUEBA VERDE (con el fix: `(musica?.accion === 'play_music' || !hasActivePendingEmotion)`):
//   - FASE 3: el store queda sustainMode='song', pending=[Dance] (reemplaza al Wave).
//   - FASE 4: el relay POST contiene "[Emotion] ... sustainMode='song' ... emotionLabel=\"Dance\"".
//   - FASE 3.5 (gap REAL): la música NO suena al despachar y arranca ~4.5s
//     DESPUÉS (playSong() async — log real 01:58:04.315 → 01:58:08.772).
//     El checkSong de +1s ve silencio; el sustain solo sobrevive gracias a
//     SONG_START_GRACE_MS (useAvatarVoiceSync.ts).
//   - FASE 5: pasados >9s el avatar SIGUE con Dance en el blendQueue mientras
//     isMusicPlaying()===true → el canto dura TODA la canción (opuesto al bug).
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

// Payload del contrato REAL que Gemini devolvería para "canta las mananitas":
// play_music + animacion Dance + respuesta_voz (pasa el gate App.tsx:784).
const CONTRACT_PAYLOAD = {
  transcript: 'pon música por favor',
  contract: {
    musica: { accion: 'play_music', cancion: 'las mananitas' },
    animacion: 'Dance',
    respuesta_voz: 'Claro, aquí va la música.',
  },
};

test('FIX: play_music con leftover pendiente → la emoción recibe sustainMode="song" y el canto dura TODA la canción (>8s)', async ({ page }) => {
  test.setTimeout(120000);

  const browserLogs: string[] = [];
  const pageErrors: string[] = [];
  const relayPosts: string[] = [];

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
  // relayLog NO hace console.log: hace POST a /__flu_client_log tras flush de 200ms.
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/__flu_client_log')) {
      const body = req.postData() || '';
      relayPosts.push(body);
    }
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
  // FASE 1 (REAL): la música AÚN NO suena al despachar — playSong() es async
  // (App.tsx:773) y tarda ~4.5s en arrancar (sonda catálogo / búsqueda Deezer).
  // Este es el gap que mataba el baile: checkSong de +1s veía silencio y
  // cancelaba el sustain → Dance moría antes de que sonara la canción.
  // ========================================
  const musicPlaying = await page.evaluate(async () => {
    // @ts-ignore
    const mp = window.__musicPlayer;
    return mp.isMusicPlaying();
  });
  console.log(`[TEST] FASE 1: isMusicPlaying() al despachar=${musicPlaying}`);
  expect(musicPlaying, 'Al despachar play_music la música NO debe sonar todavía (playSong async — el gap real)').toBe(false);

  // ========================================
  // FASE 2: leftover pendiente con sustainMode=null (el estado que deja el bug)
  // Este es EXACTAMENTE el escenario reportado: hay una emoción previa colgada
  // (p.ej. un Wave/enojo del participante) cuando llega el play_music.
  // ========================================
  await goIdle();
  const phase2 = await page.evaluate(async () => {
    // @ts-ignore
    const intStore = window.__intStore;
    // Leftover del turno previo (sustainMode=null)
    intStore.getState().setPendingEmotionAnims(['Wave'], 'ai', null);
    await new Promise((r) => setTimeout(r, 150)); // propagar update del store
    return {
      pendingMode: intStore.getState().uiState.pendingEmotionSustainMode,
      pendingAnims: intStore.getState().uiState.pendingEmotionAnims,
    };
  });
  console.log(`[TEST] FASE 2: leftover mode='${phase2.pendingMode}' anims=[${phase2.pendingAnims.join(', ')}]`);
  expect(phase2.pendingMode, 'El leftover tiene sustainMode=null (condición del bug)').toBeNull();
  expect(phase2.pendingAnims, 'El leftover es Wave').toContain('Wave');

  // ========================================
  // FASE 3 (NÚCLEO red/green): despachar el contrato play_music y leer el store
  // SÍNCRONAMENTE (sin await) — la guardia de App.tsx:958 corre antes del primer
  // await del dispatch (App.tsx:1020), así que el estado ya está escrito.
  //   ROJO (sin fix): store sigue ['Wave']/null (el guard se salta por leftover).
  //   VERDE (con fix): store pasa a ['Dance']/song (play_music SIEMPRE gana).
  // ========================================
  const dispatchStartMs = Date.now();
  const phase3 = await page.evaluate((payload) => {
    // @ts-ignore
    const intStore = window.__intStore;
    let hookReady = false;
    let dispatchError = '';
    try {
      const fn = (window as any).__fluOnContractResolved;
      if (typeof fn !== 'function') {
        return { hookReady, dispatchError: 'hook __fluOnContractResolved no disponible', pendingMode: null, pendingAnims: [] };
      }
      hookReady = true;
      const p = fn(payload);
      if (p && typeof p.then === 'function') {
        p.catch((e: any) => console.warn('[TEST] dispatch catch:', e));
      }
      // LECTURA SÍNCRONA (sin await): la guardia App.tsx:958 ya corrió.
      const s = intStore.getState().uiState;
      return { hookReady, dispatchError, pendingMode: s.pendingEmotionSustainMode, pendingAnims: s.pendingEmotionAnims };
    } catch (e: any) {
      return { hookReady, dispatchError: e.message, pendingMode: null, pendingAnims: [] };
    }
  }, CONTRACT_PAYLOAD);
  console.log(`[TEST] FASE 3: hookReady=${phase3.hookReady} err='${phase3.dispatchError}' mode='${phase3.pendingMode}' anims=[${phase3.pendingAnims.join(', ')}]`);
  expect(phase3.hookReady, 'El hook __fluOnContractResolved debe estar disponible').toBe(true);
  expect(phase3.dispatchError, `El dispatch no debe lanzar: ${phase3.dispatchError}`).toBe('');
  expect(phase3.pendingMode, `play_music SIEMPRE recibe sustainMode='song' aunque haya leftover (FIX). ROJO: quedó null → canción 'fixed' → canta 8s`).toBe('song');
  expect(phase3.pendingAnims, 'La emoción del play_music es Dance (reemplaza al leftover Wave)').toContain('Dance');
  expect(phase3.pendingAnims, 'El leftover Wave ya NO debe seguir pendiente').not.toContain('Wave');

  // ========================================
  // FASE 3.5 (gap REAL): la música arranca ~4.5s DESPUÉS del contrato, como el
  // playSong() async real (log: SPEAKING 01:58:04.315 → música 01:58:08.772).
  // El checkSong de +1s ya vio silencio; el sustain SOLO sobrevive gracias a
  // SONG_START_GRACE_MS (useAvatarVoiceSync.ts). Sin ese fix, Dance moriría aquí.
  // ========================================
  await page.waitForTimeout(4500);
  const musicStarted = await page.evaluate(async (wav) => {
    // @ts-ignore
    const mp = window.__musicPlayer;
    mp.playMusicUrl(wav, { loop: true });
    await new Promise((r) => setTimeout(r, 400));
    return mp.isMusicPlaying();
  }, SILENT_WAV);
  console.log(`[TEST] FASE 3.5: música arrancó a +4.5s → isMusicPlaying()=${musicStarted}`);
  expect(musicStarted, 'La música debe arrancar al +4.5s (simula el playSong async real)').toBe(true);

  // ========================================
  // FASE 4: el relay POST (relayLog → /__flu_client_log) debe registrar la guardia
  // con sustainMode='song' y emotionLabel="Dance".
  // ========================================
  await page.waitForTimeout(900); // flush de 200ms + margen
  const relayJoined = relayPosts.join('\n');
  console.log(`[TEST] FASE 4: relayPosts=${relayPosts.length} bodies=${relayJoined.length} chars`);
  expect(relayJoined, 'El relay debe registrar la guardia [Emotion] pendingEmotionAnims').toContain('[Emotion] pendingEmotionAnims');
  expect(relayJoined, 'La guardia debe escribir sustainMode=\'song\'').toContain("sustainMode='song'");
  // El body del POST es JSON: las comillas internas del mensaje llegan escapadas (\"Dance\").
  expect(relayJoined, 'La guardia debe registrar emotionLabel="Dance"').toContain('emotionLabel=\\"Dance\\"');

  // ========================================
  // FASE 5 (end-to-end, IDLE-corrected): el canto se sostiene TODA la canción.
  // Tras el dispatch real: SPEAKING consume pending y agenda la acción sostenida
  // 'song'; luego vuelve a IDLE (conversationActiveRef=false). Esperamos el
  // asentamiento, pasamos a LISTENING (re-aplica la acción sostenida viva,
  // useAvatarVoiceSync.ts:259-284) y verificamos que Dance SIGUE pasados >9s
  // mientras isMusicPlaying()===true → opuesto al bug (canta 8s, música 30s).
  // ========================================
  const settled = await page.evaluate(async () => {
    // @ts-ignore
    const intStore = window.__intStore;
    const deadline = Date.now() + 3000;
    let cs = intStore.getState().conversationState;
    while (Date.now() < deadline && cs !== 'IDLE') {
      await new Promise((r) => setTimeout(r, 200));
      cs = intStore.getState().conversationState;
    }
    return { state: cs, pending: intStore.getState().uiState.pendingEmotionAnims };
  });
  console.log(`[TEST] FASE 5: estado asentado='${settled.state}' pending=[${settled.pending.join(', ')}]`);

  // Si el dispatch no consumió la emoción (p.ej. habla colgada), forzar SPEAKING
  // para que el efecto consuma pending y agende la acción sostenida 'song'.
  if (settled.pending.length > 0) {
    await page.evaluate(async () => {
      // @ts-ignore
      const intStore = window.__intStore;
      intStore.getState().setConversationState('SPEAKING');
      intStore.getState().setFluSpeaking(true);
      await new Promise((r) => setTimeout(r, 700));
    });
  }

  // LISTENING re-aplica la acción sostenida (song) → Dance vuelve al blendQueue.
  await page.evaluate(async () => {
    // @ts-ignore
    const intStore = window.__intStore;
    intStore.getState().setConversationState('LISTENING');
    intStore.getState().setFluSpeaking(false);
    await new Promise((r) => setTimeout(r, 700));
  });
  const danceAfterListen = await page.evaluate(async () => {
    // @ts-ignore
    const bunnyStore = window.__bunnyStore;
    return bunnyStore.getState().blendQueue ?? [];
  });
  console.log(`[TEST] FASE 5: tras LISTENING blendQueue=[${danceAfterListen.join(', ')}]`);
  expect(danceAfterListen.includes('Dance'), 'Al pasar a LISTENING el canto (Dance) se re-aplica (acción sostenida \'song\' viva)').toBe(true);

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
  console.log(`[TEST] FASE 5: elapsed=${totalElapsed}ms blendQueue=[${past9s.blendQueue.join(', ')}] musicStillPlaying=${past9s.musicStillPlaying}`);
  expect(past9s.blendQueue.includes('Dance'), `Pasados ${totalElapsed}ms (>8s) el avatar SIGUE cantando (Dance) → el canto dura TODA la canción (FIX). ROJO: Dance liberado a los 8s`).toBe(true);
  expect(past9s.musicStillPlaying, 'La música sigue sonando (isMusicPlaying()===true) — separación canto/reproducción').toBe(true);

  // ========================================
  // ASSERT final: sin errores de página
  // ========================================
  console.log(`[TEST] pageErrors: ${pageErrors.length}`);
  expect(pageErrors, `No debe haber errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

  console.log('[TEST] ✅ FIX VERIFICADO: play_music con leftover pendiente → sustainMode="song" y el avatar canta TODA la canción (>8s) mientras la música suena.');
});
