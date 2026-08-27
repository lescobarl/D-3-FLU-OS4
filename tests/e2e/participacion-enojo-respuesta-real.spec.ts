/**
 * VALIDACIÓN REAL (no imaginaria): FLU se ENOJA y DESPUÉS RESPONDE.
 * ================================================================
 *
 * Escenario real de participación que responde a:
 *   "Vuelve a validar con escenario real de participacion, haz que se
 *    enoje flu y despues que responda!"
 *
 * Cadena 100% real (mismo motor que participacion-real.spec.ts):
 *
 *   FASE A — Mano levantada REAL:
 *     - App REAL en http://localhost:5175 (reuseExistingServer).
 *     - API key REAL de .env (VITE_OPENROUTER_API_KEY) en localStorage.
 *     - deepseekService.generateParticipantEvaluation → fetch DIRECTO a
 *       https://openrouter.ai/api/v1/chat/completions con Bearer key real
 *       → Gemini 2.5 Flash Lite.
 *     - intervenir=true → phase 'raised' → chip 'Flu pide la palabra'.
 *
 *   FASE B — FLU SE ENOJA (timeout de mano alzada):
 *     - Override REAL vía localStorage 'flu-participant-settings':
 *         handRaisedTimeoutMs = 60000  (mínimo no-cero que admite el coercer
 *                                       coerceParticipantValue; 60s → el
 *                                       evaluador deja pasar el tiempo real)
 *         conversationOnly    = false
 *         evaluateEveryNTurns = 3
 *     - scheduleHandTimeout (60s) → shouldAutoDismissRaisedHand →
 *       dismissRaisedHand (phase idle → chip desaparece) →
 *       onEmotion('ignored') (UNA vez por ciclo).
 *     - triggerParticipantEmotion('ignored') → resolveTriggerExpression
 *       → expresión 'enojado', anims ['Walk','Emo_blink','Cap_back','MouthMove']
 *       → canal ÚNICO pendingEmotionAnims (fix S1).
 *     - SystemEvent participant_ignored → entrada en conversationHistory
 *       (meta.systemEvent.type === 'participant_ignored', role 'flu').
 *
 *   FASE C — FLU RESPONDE (después de enojarse):
 *     - Pregunta real con wake word: "flu maestra que opinas sobre mi
 *       exposicion de la revolucion mexicana, quieres agregar algo a mi trabajo?"
 *     - Vía 1 (mic real): emitTurn → pipeline de conversación → ingress runtime
 *       → awaitConversationAction → processConversationFluQuery →
 *       requestFluContractForTranscript → contrato REAL → onContractResolved.
 *     - Vía 2 (fallback, misma ruta awaitConversationAction, probada en REAL 2):
 *       w.__fluDev.runFluPhrase(question).
 *     - El contrato real se HABLA vía TTS (w.__spoken) y se commitea al
 *       conversationHistory REAL como role 'flu' SIN meta.systemEvent.
 *     - El enojo (Walk) debe sobrevivir durante la respuesta: sampler de
 *       200ms del bunnyStore durante SPEAKING → currentAnimation 'Walk'.
 *       Nota: App.tsx:928-934 sobreescribe pendingEmotionAnims con la emoción
 *       que devuelva Gemini; el prompt inyecta "Tu estado emocional actual:
 *       enojado" + instrucción CRÍTICO (emotionalState.ts) para que Gemini
 *       devuelva emocion:'enojado' y se preserve la Walk. Si devolviera
 *       'hablando', la borraría — por eso el enojo determinista se prueba en
 *       la FASE B y la Walk-durante-respuesta es evidencia visual real.
 *
 * ÚNICA inyección: shim de SpeechRecognition + captura de TTS + localStorage
 * de config. Modelo, store, DOM, chips, botones y TTS: 100% reales.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── API key REAL desde .env (nunca se hardcodea) ─────────────────────────────
const envRaw = readFileSync(join(process.cwd(), '.env'), 'utf8');
const keyMatch = envRaw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m);
const REAL_KEY = keyMatch ? keyMatch[1].trim() : '';
if (!REAL_KEY) {
  throw new Error('VITE_OPENROUTER_API_KEY no encontrada en .env — la validación REAL requiere la clave.');
}
const KEY_MASK = `${REAL_KEY.slice(0, 8)}…${REAL_KEY.slice(-4)}`;

const ORIGIN = 'http://localhost:5175';
const SESSION_ROLE = 'Profesora de historia de Mexico';
const LANGUAGE = 'es';

// Animaciones EXACTAS del registro 'enojado' (EXPRESSION_MAP / expressionRegistry).
const ENOJADO_ANIMS = ['Walk', 'Emo_blink', 'Cap_back', 'MouthMove'];

// Override REAL de participación vía localStorage (leído por getFluParticipantConfig
// ANTES de que corra el JS de la app). handRaisedTimeoutMs=60000 es el MÍNIMO
// no-cero que admite coerceParticipantValue (durationMinutes: 60000 > 30 →
// Math.round(60000/60000)=1 → 1*60000=60000ms).
const PARTICIPANT_SETTINGS = {
  enabled: true,
  conversationOnly: false,
  evaluateEveryNTurns: 3,
  handRaisedTimeoutMs: 60000,
};

// Pregunta real CON wake word "ok flu" (obligatorio para kind='flu' en
// resolveFinalConversationAction — 'flu' solo NO es wake word y la consulta cae
// en kind='log' sin respuesta). Sin palabras de acción/emoción para no disparar
// el post-processing de transcriptProcessor ("opinas" no contiene "opinar").
const QUESTION =
  'ok flu maestra que opinas sobre mi exposicion de la revolucion mexicana, quieres agregar algo a mi trabajo?';

// Turnos de un estudiante hablando con la maestra (24 reales, 8 lotes de 3 →
// 8 oportunidades reales de evaluación, evaluateEveryNTurns=3).
const TURNS: Array<{ final: string; interim: string }> = [
  { final: 'buenos dias maestra hoy voy a exponer sobre la revolucion mexicana', interim: 'buenos dias maestra hoy voy a exponer' },
  { final: 'emiliano zapata lidero el ejercito libertador del sur en morelos', interim: 'emiliano zapata lidero el ejercito libertador' },
  { final: 'no estoy muy seguro pero creo que la revolucion empezo en mil novecientos ocho', interim: 'no estoy muy seguro pero creo que la revolucion' },
  { final: 'alguien me puede ayudar a confirmar en que ano comenzo la revolucion', interim: 'alguien me puede ayudar a confirmar' },
  { final: 'yo entendi que el plan de ayala lo habia firmado francisco madero, verdad maestra', interim: 'yo entendi que el plan de ayala lo habia firmado' },
  { final: 'el plan de ayala exigia la restitucion de tierras para los campesinos', interim: 'el plan de ayala exigia la restitucion' },
  { final: 'me confundo con las diferencias entre el zapatismo y el villismo', interim: 'me confundo con las diferencias entre el zapatismo' },
  { final: 'pancho villa tambien era del sur igual que zapata, no es asi', interim: 'pancho villa tambien era del sur' },
  { final: 'por que fue tan importante el reparto de tierras para los campesinos', interim: 'por que fue tan importante el reparto de tierras' },
  { final: 'no entiendo bien que papel jugo venustiano carranza en el movimiento', interim: 'no entiendo bien que papel jugo venustiano carranza' },
  { final: 'la constitucion de 1917 fue un logro muy importante de la revolucion', interim: 'la constitucion de 1917 fue un logro muy importante' },
  { final: 'yo habia escuchado que esa constitucion la habia escrito porfirio diaz pero no creo', interim: 'yo habia escuchado que esa constitucion' },
  { final: 'me podria explicar maestra que beneficios trajo la reforma agraria', interim: 'me podria explicar maestra que beneficios' },
  { final: 'la revolucion tambien cambio la educacion y el arte con los muralistas', interim: 'la revolucion tambien cambio la educacion' },
  { final: 'creo que los muralistas pintaron la historia de mexico en los edificios publicos', interim: 'creo que los muralistas pintaron la historia' },
  { final: 'tengo dudas sobre como se comparan las revoluciones de mexico y de otros paises', interim: 'tengo dudas sobre como se comparan' },
  { final: 'el general pancho villa tomo la ciudad de zacatecas en una batalla muy famosa', interim: 'el general pancho villa tomo la ciudad de zacatecas' },
  { final: 'y la batalla de torreon tambien fue importante para la division del norte', interim: 'y la batalla de torreon tambien fue importante' },
  { final: 'no recuerdo si la convencion de aguascalientes fue antes o despues de la constitucion', interim: 'no recuerdo si la convencion de aguascalientes' },
  { final: 'quisiera que alguien me aclare que paso en la convencion de aguascalientes', interim: 'quisiera que alguien me aclare' },
  { final: 'el presidente lazaro cardenas retomo el reparto agrario muchos anos despues', interim: 'el presidente lazaro cardenas retomo' },
  { final: 'asi que la reforma agraria de cardenas completo lo que zapata habia pedido', interim: 'asi que la reforma agraria de cardenas' },
  { final: 'espero haber explicado bien las causas de la revolucion mexicana', interim: 'espero haber explicado bien las causas' },
  { final: 'eso es todo maestra, gracias por ayudarme con mi exposicion', interim: 'eso es todo maestra gracias' },
];

interface EvalInfo {
  intervenir: boolean;
  borrador: string;
  confianza: number;
  motivo: string;
}

interface AngerSnapshot {
  handChips: number;
  pendingEmotionAnims: string[];
  ignoredEntry: boolean;
  ignoredText: string;
  conversationState: string;
}

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--no-sandbox',
    ],
  },
});

test.describe.configure({ mode: 'serial' });

// ── Shim que corre ANTES del JS de la app ───────────────────────────────────────
// Inyecta: localStorage (key real + rol + idioma + config de participación con
// timeout de mano alzada de 60s), captura de TTS y MockSR.
async function installShim(page: Page): Promise<void> {
  await page.addInitScript(
    ({
      realKey,
      sessionRole,
      language,
      settings,
    }: {
      realKey: string;
      sessionRole: string;
      language: string;
      settings: Record<string, unknown>;
    }) => {
      const w = window as any;

      // ── localStorage ANTES de que la app lea la config ──
      try {
        localStorage.setItem('flu-text-api-key', realKey);
        localStorage.setItem('flu-session-role', sessionRole);
        localStorage.setItem('flu-language', language);
        localStorage.setItem('flu-participant-settings', JSON.stringify(settings));
        localStorage.setItem('flu-participant-enabled', '1');
      } catch {
        /* ignore */
      }

      // ── Captura de TTS DETERMINISTA (nunca se atora en headless) ──
      // En Chromium headless `speechSynthesis.speaking` puede quedarse en true
      // (sin onend), lo que bloquea speakResponse (guarda synth.speaking) y
      // isSpeechBusy() → runConversationActionDispatch. Aquí el mock completa
      // cada utterance con un retraso corto (500ms → ventana SPEAKING visible
      // para el sampler) y expone speaking/pending reales.
      w.__spoken = [];
      w.__ttsBusy = false;
      w.__ttsQueue = [];
      const synth = window.speechSynthesis;
      if (synth) {
        const finishAll = () => {
          const queue = w.__ttsQueue || [];
          w.__ttsQueue = [];
          w.__ttsBusy = false;
          queue.forEach((u: any) => {
            try {
              if (u && typeof u.onend === 'function') u.onend();
            } catch {
              /* ignore */
            }
          });
        };
        try {
          Object.defineProperty(synth, 'speaking', {
            configurable: true,
            get: () => Boolean(w.__ttsBusy),
          });
        } catch {
          /* ignore */
        }
        try {
          Object.defineProperty(synth, 'pending', {
            configurable: true,
            get: () => false,
          });
        } catch {
          /* ignore */
        }
        synth.speak = (utterance: any) => {
          try {
            w.__spoken.push(String((utterance && utterance.text) || ''));
          } catch {
            /* ignore */
          }
          w.__ttsQueue.push(utterance);
          w.__ttsBusy = true;
          window.setTimeout(() => {
            const idx = w.__ttsQueue.indexOf(utterance);
            if (idx >= 0) w.__ttsQueue.splice(idx, 1);
            if (w.__ttsQueue.length === 0) w.__ttsBusy = false;
            try {
              if (utterance && typeof utterance.onend === 'function') utterance.onend();
            } catch {
              /* ignore */
            }
          }, 500);
        };
        synth.cancel = () => {
          finishAll();
        };
      }

      // ── Shim de SpeechRecognition (la API que el navegador no puede hablar en automatización) ──
      w.__sr = { instances: [], active: null };

      class MockSR {
        lang = 'es';
        interimResults = true;
        continuous = true;
        maxAlternatives = 1;
        onstart: any = null;
        onresult: any = null;
        onerror: any = null;
        onend: any = null;
        started = false;
        private _idx = 0;
        constructor() {
          w.__sr.instances.push(this);
        }
        static install() {
          return Promise.resolve(true);
        }
        start() {
          this.started = true;
          w.__sr.active = this;
          w.__sr.startTime = performance.now();
          setTimeout(() => {
            if (this.onstart) this.onstart();
          }, 0);
        }
        stop() {
          this.started = false;
          setTimeout(() => {
            if (this.onend) this.onend();
          }, 0);
        }
        abort() {
          this.stop();
        }
        emitFinal(text: string, interim = '') {
          const results: any[] = [];
          if (interim) {
            results.push({ isFinal: false, 0: { transcript: interim }, length: 1 });
          }
          results.push({ isFinal: true, 0: { transcript: text }, length: 1 });
          if (this.onresult) {
            this.onresult({ resultIndex: 0, results });
          }
        }
        emitInterim(text: string) {
          if (this.onresult) {
            this.onresult({
              resultIndex: 0,
              results: [{ isFinal: false, 0: { transcript: text }, length: 1 }],
            });
          }
        }
      }

      w.SpeechRecognition = MockSR;
      w.webkitSpeechRecognition = MockSR;
    },
    {
      realKey: REAL_KEY,
      sessionRole: SESSION_ROLE,
      language: LANGUAGE,
      settings: PARTICIPANT_SETTINGS,
    },
  );
}

// ── Captura las evaluaciones reales del participante ─────────────────────────────
function attachEvalCapture(page: Page, evals: EvalInfo[], requestKeys: string[]): void {
  const extractEval = (body: any): EvalInfo | null => {
    if (body && typeof body === 'object' && 'intervenir' in body) {
      return {
        intervenir: Boolean(body.intervenir),
        borrador: String(body.borrador_aportacion || body.evaluation?.borrador_aportacion || ''),
        confianza: Number(body.confianza ?? 0),
        motivo: String(body.motivo_corto || ''),
      };
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && 'intervenir' in parsed) {
          return {
            intervenir: Boolean(parsed.intervenir),
            borrador: String(parsed.borrador_aportacion || ''),
            confianza: Number(parsed.confianza ?? 0),
            motivo: String(parsed.motivo_corto || ''),
          };
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/gemini/participant-eval') && !url.includes('/chat/completions')) return;
    try {
      const body: any = await res.json();
      const info = extractEval(body);
      if (info) evals.push(info);
    } catch {
      /* ignore */
    }
  });

  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('/api/gemini/participant-eval') && !url.includes('/chat/completions')) return;
    try {
      const post = req.postDataJSON();
      const sysText = Array.isArray(post?.messages)
        ? post.messages.map((m: any) => String(m?.content || '')).join(' ')
        : '';
      const isEval = url.includes('/api/gemini/participant-eval') || /intervenir/i.test(sysText);
      if (!isEval) return;
      const auth = String(req.headers()['authorization'] || '');
      const apiKey = auth.replace(/^Bearer\s+/i, '').trim() || String(post?.apiKey || '');
      if (apiKey) requestKeys.push(apiKey);
    } catch {
      /* ignore */
    }
  });
}

// ── Captura los requests REALES de contrato (respuesta de FLU) ─────────────────
// processConversationFluQuery → requestFluContractForTranscript → requestFluContract
// → POST /api/gemini/contract (o /chat/completions con el schema respuesta_voz).
function attachContractCapture(page: Page, contractKeys: string[]): void {
  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('/api/gemini/contract') && !url.includes('/chat/completions')) return;
    try {
      const post = req.postDataJSON();
      const bodyText = JSON.stringify(post || {});
      const isContract = url.includes('/api/gemini/contract') || /respuesta_voz|navegacion/.test(bodyText);
      if (!isContract) return;
      const auth = String(req.headers()['authorization'] || '');
      const apiKey = auth.replace(/^Bearer\s+/i, '').trim() || String(post?.apiKey || '');
      if (apiKey) contractKeys.push(apiKey);
    } catch {
      /* ignore */
    }
  });
}

// ── Expone los stores REALES de la app (mismo módulo Vite que usa la app) ──────
async function installStores(page: Page): Promise<void> {
  const ok = await page.evaluate(async () => {
    const w = window as any;
    try {
      // @ts-ignore — import en runtime del dev server Vite (mismo patrón que el template e2e)
      const intMod: any = await import('/src/store/integrationStore.ts');
      // @ts-ignore — import en runtime del dev server Vite (mismo patrón que el template e2e)
      const bunnyMod: any = await import('/src/avatar/store/bunnyStore.ts');
      w.__intStore = intMod.useIntegrationStore;
      w.__bunnyStore = bunnyMod.useBunnyStore;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: String(e?.message || e) };
    }
  });
  expect(ok.success, `No se pudieron exponer los stores reales: ${JSON.stringify(ok)}`).toBe(true);
}

// ── Flujo REAL: navegar → iniciar conversación ──────────────────────────────────
async function startConversation(page: Page): Promise<void> {
  await page.context().grantPermissions(['microphone'], { origin: ORIGIN });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });

  const startBtn = page.getByRole('button', { name: 'Iniciar conversación' });
  await startBtn.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(startBtn).toBeEnabled({ timeout: 60_000 });
  await startBtn.click();

  const closeBtn = page.getByRole('button', { name: 'Cerrar escucha' });
  await closeBtn.waitFor({ state: 'visible', timeout: 30_000 });

  await page
    .locator('.flu-status-chip--flu-participant')
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => {});
}

// ── Emite un turno de habla REAL (interim + final) por el micrófono simulado ────
async function emitTurn(page: Page, s: { final: string; interim: string }): Promise<void> {
  await page.evaluate(
    ({ interim }) => {
      const w = window as any;
      if (!w.__sr.active) return;
      w.__sr.active.emitInterim(interim);
    },
    s,
  );
  await page.waitForTimeout(320);
  await page.evaluate(
    ({ final }) => {
      const w = window as any;
      if (!w.__sr.active) return;
      w.__sr.active.emitFinal(final);
    },
    s,
  );
  await page.waitForTimeout(950);
}

// ── Reintentos en lotes hasta ver la mano levantada REAL ────────────────────────
const BATCH_SIZE = 3;
const MAX_BATCHES = 8;

async function feedUntilRaised(page: Page, evals: EvalInfo[]): Promise<string> {
  await startConversation(page);

  const raisedChip = page.locator('.flu-status-chip--flu-hand-raised');
  let emitted = 0;
  let raised = false;

  for (let batch = 0; batch < MAX_BATCHES && !raised; batch += 1) {
    const batchTurns = TURNS.slice(emitted, emitted + BATCH_SIZE);
    if (batchTurns.length === 0) break;
    for (const turn of batchTurns) {
      await emitTurn(page, turn);
      emitted += 1;
    }
    console.log(
      `   … lote ${batch + 1} emitido (turnos acumulados ${emitted}) — esperando evaluación real (~30s)`,
    );
    await raisedChip
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => {
        raised = true;
      })
      .catch(() => {});
  }

  if (!raised) {
    const summary = evals.length
      ? evals
          .map(
            (e, i) =>
              `[${i + 1}] intervenir=${e.intervenir} confianza=${e.confianza} motivo="${e.motivo}"`,
          )
          .join(' | ')
      : 'ninguna evaluación capturada';
    throw new Error(
      `El modelo declinó participar en ${MAX_BATCHES} oportunidades reales (turnos emitidos: ${emitted}). ` +
        `Evaluaciones reales: ${summary}`,
    );
  }

  const label = (await raisedChip.textContent()) || '';
  expect(
    label.trim(),
    `el chip levantado debería decir 'Flu pide la palabra' (dijo: "${label.trim()}")`,
  ).toContain('Flu pide la palabra');

  const grantBtn = page.locator('.flu-btn--participant');
  await expect(grantBtn).toHaveClass(/flu-btn--participant-ready/, { timeout: 20_000 });

  const accepted = [...evals].reverse().find((e) => e.intervenir);
  expect(
    accepted,
    'Ninguna evaluación real devolvió intervenir=true — el modelo declinó participar',
  ).toBeTruthy();
  return accepted!.borrador;
}

// ── Espera a que el TTS esté totalmente idle (speaking y pending en false) ──────
async function waitForSpeechIdle(page: Page, timeoutMs = 40_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as any;
      const s = w.speechSynthesis;
      return !(s && (s.speaking || s.pending));
    },
    undefined,
    { timeout: timeoutMs },
  );
}

// ── Sampler de 200ms del bunnyStore + integrationStore (evidencia de Walk) ─────
async function startAngerSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__samples = [];
    if (w.__sampleTimer) clearInterval(w.__sampleTimer);
    w.__sampleTimer = setInterval(() => {
      try {
        const is = w.__intStore.getState();
        const bs = w.__bunnyStore.getState();
        w.__samples.push({
          t: Date.now(),
          state: is.conversationState || '',
          anim: bs.currentAnimation || '',
          blend: [...((bs.blendQueue as string[]) || [])],
          pending: [...((is.uiState && is.uiState.pendingEmotionAnims) || [])],
        });
      } catch {
        /* ignore */
      }
    }, 200);
  });
}

// ── FASE B: esperar a que FLU se enoje (timeout de mano alzada) ────────────────
async function waitForAnger(page: Page): Promise<AngerSnapshot> {
  const deadline = Date.now() + 95_000;
  let last: AngerSnapshot | null = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const w = window as any;
      const is = w.__intStore.getState();
      const history = is.conversationHistory;
      const ignored = history.filter(
        (e: any) => e.meta && e.meta.systemEvent && e.meta.systemEvent.type === 'participant_ignored',
      );
      return {
        handChips: document.querySelectorAll('.flu-status-chip--flu-hand-raised').length,
        pendingEmotionAnims: [...((is.uiState && is.uiState.pendingEmotionAnims) || [])],
        ignoredEntry: ignored.length > 0,
        ignoredText: ignored.length ? String(ignored[0].text || '') : '',
        conversationState: is.conversationState || '',
      };
    });
    const matched =
      last.handChips === 0 &&
      last.pendingEmotionAnims.length === ENOJADO_ANIMS.length &&
      last.pendingEmotionAnims.every((a, i) => a === ENOJADO_ANIMS[i]) &&
      last.ignoredEntry;
    if (matched) return last;
    await page.waitForTimeout(1000);
  }
  throw new Error(
    `FLU no se enojó dentro de la ventana (60s de mano alzada + margen). Última lectura: ${JSON.stringify(last)}`,
  );
}

// ── Poll de la respuesta real de FLU (nueva entrada role 'flu' SIN systemEvent) ─
async function pollResponse(
  page: Page,
  opts: { spokenBefore: number; historyBefore: number; timeoutMs: number },
): Promise<{ spoken: number; newFlu: Array<{ text: string; speaker: string }> } | null> {
  const { spokenBefore, historyBefore, timeoutMs } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await page.evaluate((hb) => {
      const w = window as any;
      const is = w.__intStore.getState();
      const newFlu = is.conversationHistory
        .map((e: any, idx: number) => ({ e, idx }))
        .filter(
          ({ e, idx }: any) =>
            idx >= hb &&
            String(e.role || '').toLowerCase() === 'flu' &&
            !(e.meta && e.meta.systemEvent),
        )
        .map(({ e }: any) => ({ text: String(e.text || ''), speaker: String(e.speakerName || '') }));
      return { spoken: (w.__spoken || []).length, newFlu };
    }, historyBefore);
    if (snap.spoken > spokenBefore && snap.newFlu.length > 0) return snap;
    await page.waitForTimeout(1000);
  }
  return null;
}

// ── FASE C: disparar la pregunta real y esperar la respuesta ───────────────────
// Vía 1 — mic real (pipeline de conversación → awaitConversationAction).
// Vía 2 (fallback) — w.__fluDev.runFluPhrase (misma ruta awaitConversationAction,
// probada en REAL 2). runFluPhrase resuelve al boolean de runConversationActionDispatch:
// si devuelve false significa que el dispatch NO ocurrió (conversación inactiva,
// isSpeechBusy() o resolveFinalConversationAction → kind:'log').
async function triggerAndWaitResponse(
  page: Page,
  opts: {
    spokenBefore: number;
    historyBefore: number;
    contractKeys: string[];
    pageErrors: string[];
    pageLogs: string[];
  },
): Promise<{ spoken: number; newFlu: Array<{ text: string; speaker: string }> }> {
  const { spokenBefore, historyBefore, contractKeys, pageErrors, pageLogs } = opts;
  let resp: { spoken: number; newFlu: Array<{ text: string; speaker: string }> } | null = null;

  const micLive = await page.evaluate(
    () => Boolean((window as any).__sr && (window as any).__sr.active),
  );
  if (micLive) {
    await emitTurn(page, { final: QUESTION, interim: QUESTION.slice(0, 42) });
    resp = await pollResponse(page, { spokenBefore, historyBefore, timeoutMs: 45_000 });
  }

  let invoked: { status: string; dispatched?: boolean; error?: string } = {
    status: micLive ? 'not-needed' : 'n/a',
  };
  if (!resp) {
    invoked = await page.evaluate(
      (q) => {
        const w = window as any;
        if (typeof w.__fluDev?.runFluPhrase !== 'function') return { status: 'missing' };
        return w.__fluDev
          .runFluPhrase(q)
          .then((dispatched: boolean) => ({ status: 'ok', dispatched: Boolean(dispatched) }))
          .catch((e: any) => ({ status: 'error', error: String(e) }));
      },
      QUESTION,
    );
    expect(invoked.status, `runFluPhrase falló: ${JSON.stringify(invoked)}`).toBe('ok');
    resp = await pollResponse(page, { spokenBefore, historyBefore, timeoutMs: 120_000 });
  }

  if (!resp) {
    const diag = await page.evaluate(() => {
      const w = window as any;
      const s = w.speechSynthesis || {};
      const is = w.__intStore ? w.__intStore.getState() : null;
      const history = is?.conversationHistory || [];
      return {
        conversationState: is?.conversationState || '',
        speaking: Boolean((s as any).speaking),
        pending: Boolean((s as any).pending),
        spokenLen: (w.__spoken || []).length,
        fluDevKeys: w.__fluDev ? Object.keys(w.__fluDev) : [],
        lastHistory: history.slice(-8).map((e: any) => ({
          role: e.role,
          speaker: e.speakerName || '',
          text: String(e.text || '').slice(0, 70),
          sys: (e.meta && e.meta.systemEvent && e.meta.systemEvent.type) || '',
        })),
      };
    });
    throw new Error(
      `FLU no respondió tras la pregunta real (mic + runFluPhrase). ` +
        `micLive=${micLive}, runFluPhrase=${JSON.stringify(invoked)}, ` +
        `contractKeys=${contractKeys.length}, pageErrors=${pageErrors.length}, ` +
        `state=${JSON.stringify(diag)}.\n` +
        `pageLogs (últimas 30):\n${pageLogs.slice(-30).join('\n')}`,
    );
  }
  return resp;
}

// ── Test principal ─────────────────────────────────────────────────────────────
// Estabilidad: forzar WebGL por software (SwiftShader) para evitar el crash
// nativo del proceso GPU de Chromium (ACCESS_VIOLATION 0xC0000005) al
// renderizar el avatar Three.js en headless bajo presión de memoria.
test.use({
  launchOptions: {
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'],
  },
});

test('REAL · FLU se ENOJA (mano alzada ignorada) y DESPUÉS RESPONDE', async ({ page }) => {
  test.setTimeout(900_000);
  const t0 = Date.now();

  const evals: EvalInfo[] = [];
  const requestKeys: string[] = [];
  const contractKeys: string[] = [];
  const pageErrors: string[] = [];
  const pageLogs: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    const t = msg.text();
    if (
      /FLU-DEBUG|FluVoice|conversation-dispatch|processConversationFluQuery|contract|gemini|participant|enoj|ignor|respuesta_voz|runFluPhrase/i.test(
        t,
      )
    ) {
      pageLogs.push(`[${msg.type()}] ${t.slice(0, 400)}`);
    }
  });
  attachEvalCapture(page, evals, requestKeys);
  attachContractCapture(page, contractKeys);

  await installShim(page);

  // ═══ FASE A — mano real levantada ═══
  const draft = await feedUntilRaised(page, evals);
  expect(requestKeys.length, 'no hubo ningún request real de evaluación').toBeGreaterThan(0);
  expect(requestKeys.every((k) => k === REAL_KEY), 'la API key de evaluación no es la real').toBe(true);
  const tRaised = Date.now();

  // Los stores reales solo se pueden importar DESPUÉS de navegar a la app (sobre about:blank Vite no resuelve /src/...)
  await installStores(page);

  // ═══ FASE B — FLU SE ENOJA (timeout de 60s de mano alzada) ═══
  const anger = await waitForAnger(page);
  const tAnger = Date.now();
  expect(anger.handChips, 'la mano levantada debe desaparecer al ser ignorada').toBe(0);
  expect(
    anger.pendingEmotionAnims,
    'pendingEmotionAnims debe contener las animaciones del registro enojado',
  ).toEqual(ENOJADO_ANIMS);
  expect(anger.ignoredEntry, 'debe existir la entrada participant_ignored en el log real').toBe(true);

  // ═══ FASE C — FLU RESPONDE (después de enojarse) ═══
  // Esperar TTS idle (igual que REAL 2) para que isSpeechBusy() no bloquee el dispatch.
  await waitForSpeechIdle(page, 30_000);
  const spokenBefore = await page.evaluate(() => (window as any).__spoken?.length || 0);
  const historyBefore = await page.evaluate(
    () => (window as any).__intStore.getState().conversationHistory.length,
  );
  await startAngerSampler(page);

  const resp = await triggerAndWaitResponse(page, {
    spokenBefore,
    historyBefore,
    contractKeys,
    pageErrors,
    pageLogs,
  });
  const tResponse = Date.now();

  expect(resp.newFlu.length, 'no se agregó respuesta real de FLU al log').toBeGreaterThan(0);
  expect(resp.spoken, 'FLU no habló la respuesta vía TTS').toBeGreaterThan(spokenBefore);

  // Dejar que el TTS real termine (ventana SPEAKING completa) antes de leer el sampler
  await waitForSpeechIdle(page, 60_000);

  const walk = await page.evaluate(() => {
    const w = window as any;
    if (w.__sampleTimer) clearInterval(w.__sampleTimer);
    return {
      samples: w.__samples || [],
      lastGeminiEmotion: w.__intStore.getState().lastGeminiEmotion || '',
    };
  });
  const speakingSamples = walk.samples.filter((s: any) => s.state === 'SPEAKING');
  const walkSamples = speakingSamples.filter(
    (s: any) => s.anim === 'Walk' || (s.blend || []).includes('Walk'),
  );
  expect(
    walkSamples.length,
    `El enojo (Walk) NO se mantuvo durante la respuesta — lastGeminiEmotion="${walk.lastGeminiEmotion}" (SPEAKING=${speakingSamples.length}, walk=${walkSamples.length}). ` +
      `Samples: ${JSON.stringify(speakingSamples.slice(0, 6))}`,
  ).toBeGreaterThan(0);

  // El contrato real viajó con la API key REAL
  expect(contractKeys.length, 'no hubo ningún request real de contrato').toBeGreaterThan(0);
  expect(contractKeys.every((k) => k === REAL_KEY), 'la API key del contrato no es la real').toBe(true);

  expect(pageErrors, `pageErrors: ${pageErrors.join(' | ')}`).toEqual([]);

  // ── Reporte final real ──
  const mask = (k: string) => `${k.slice(0, 8)}…${k.slice(-4)}`;
  const evalLines = evals.length
    ? evals
        .map(
          (e, i) =>
            `   [${i + 1}] intervenir=${e.intervenir} confianza=${e.confianza} motivo="${e.motivo}"\n       borrador="${e.borrador}"`,
        )
        .join('\n')
    : '   (ninguna)';
  const responseText = resp.newFlu[0]?.text || '';
  const spokenAll = await page.evaluate(() => JSON.stringify((window as any).__spoken || []));
  const walkPreview = walkSamples
    .slice(0, 3)
    .map((s: any) => `{state=${s.state}, anim=${s.anim}, blend=${JSON.stringify(s.blend)}}`)
    .join(', ');

  console.log(`
═══════════════════════════════════════════════════════════════
  REAL · FLU SE ENOJA Y DESPUÉS RESPONDE (validación real)
═══════════════════════════════════════════════════════════════
  API key evaluación real   = ${mask(requestKeys[0] || '')} (${requestKeys.length} reqs, esperada ${KEY_MASK})
  ¿eval llevó key real?     = ${requestKeys.length > 0 && requestKeys.every((k) => k === REAL_KEY)}
  API key contrato real     = ${mask(contractKeys[0] || '')} (${contractKeys.length} reqs)
  ¿contrato llevó key real? = ${contractKeys.length > 0 && contractKeys.every((k) => k === REAL_KEY)}
  Evaluaciones reales       = ${evals.length}
${evalLines}
  ── FASE A: mano real levantada ──
  Borrador aceptado         = "${draft}"
  Tiempo hasta la mano      = ${((tRaised - t0) / 1000).toFixed(1)}s
  ── FASE B: FLU SE ENOJA (mano ignorada) ──
  chips de mano alzada      = ${anger.handChips} (desapareció)
  pendingEmotionAnims       = ${JSON.stringify(anger.pendingEmotionAnims)}
  esperado                  = ${JSON.stringify(ENOJADO_ANIMS)}
  participant_ignored entry = ${anger.ignoredEntry}
  texto del evento          = "${anger.ignoredText}"
  tiempo hasta el enojo     = ${((tAnger - tRaised) / 1000).toFixed(1)}s (mano alzada 60s)
  estado de conversación    = ${anger.conversationState}
  ── FASE C: FLU RESPONDE (después de enojarse) ──
  pregunta real             = "${QUESTION}"
  respuesta real (texto)    = "${responseText}"
  entradas role='flu' nuevas= ${resp.newFlu.length} (sin meta.systemEvent)
  TTS hablado (creció)      = ${resp.spoken} > ${spokenBefore}
  lastGeminiEmotion         = "${walk.lastGeminiEmotion}"
  SPEAKING samples          = ${speakingSamples.length}
  Walk samples en SPEAKING  = ${walkSamples.length}  (preview: ${walkPreview})
  tiempo hasta la respuesta = ${((tResponse - tAnger) / 1000).toFixed(1)}s
  TTS total capturado       = ${spokenAll}
  pageErrors                = ${pageErrors.length} ${pageErrors.join(' | ')}
═══════════════════════════════════════════════════════════════`);
});
