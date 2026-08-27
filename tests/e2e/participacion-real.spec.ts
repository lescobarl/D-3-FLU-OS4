/**
 * VALIDACIÓN REAL (no imaginaria) de la PARTICIPACIÓN de FLU en OS4.
 *
 * Responde a: "validaste dializacion, transcripcion, participacion, intervencion
 * REAL? o solo imaginario?" — aquí NO se inyecta el store ni se mockean los resultados
 * del modelo. Flujo REAL completo:
 *
 *   1. App REAL en http://localhost:5175 (servidor dev de Terminal 1, reuseExistingServer).
 *   2. Micrófono simulado SOLO para la API de STT del navegador (la única parte que el
 *      navegador no puede hablar de verdad en automatización). El resto es 100% real.
 *   3. API key REAL leída de .env (VITE_OPENROUTER_API_KEY) e inyectada en localStorage
 *      (flu-text-api-key) ANTES de que cargue el JS de la app.
 *   4. El participante evalúa de verdad: deepseekService.generateParticipantEvaluation →
 *      fetch DIRECTO a https://openrouter.ai/api/v1/chat/completions (Authorization: Bearer key real)
 *      → Google Gemini 2.5 Flash Lite.
 *   5. Se espera la mano levantada REAL (chip 'Flu pide la palabra' + botón listo).
 *   6. Intervención REAL por las DOS vías complementarias:
 *        - Test 1 (botón): cede la palabra → FLU HABLA el borrador real (TTS capturado).
 *        - Test 2 (comando voz): 'ok flu adelante' → el borrador real se COMMITEA al
 *          conversationHistory REAL del store como role 'flu' / speakerName 'FLU'.
 *
 * ÚNICA inyección: shim de window.SpeechRecognition + captura de TTS (utterance.text).
 * Resultados del modelo, store, DOM, botones y chip: todos reales.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── API key REAL desde .env (nunca se hardcodea en el archivo) ────────────────
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

// Turnos de un estudiante hablando con la maestra. 24 turnos reales repartidos en
// 8 lotes de 3: cada lote dispara UNA evaluación real (evaluateEveryNTurns=3) en los
// commits 3, 6, 9, 12, 15, 18, 21 y 24, dando al modelo 8 oportunidades de levantar
// la mano. El escenario incluye duda genuina, preguntas y un par de errores leves:
// el modelo declina con frecuencia cuando el estudiante "está proporcionando
// información correcta" (ver corrida anterior), así que estos turnos le dan a FLU
// aperturas reales para aportar valor.
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
// Inyecta: localStorage (key real + rol + idioma), captura de TTS y MockSR.
async function installShim(page: Page): Promise<void> {
  await page.addInitScript(
    ({ realKey, sessionRole, language }: { realKey: string; sessionRole: string; language: string }) => {
      const w = window as any;

      // ── localStorage ANTES de que la app lea la config ──
      try {
        localStorage.setItem('flu-text-api-key', realKey);
        localStorage.setItem('flu-session-role', sessionRole);
        localStorage.setItem('flu-language', language);
      } catch {
        /* ignore */
      }

      // ── Captura de TTS: registra utterance.text en w.__spoken ──
      w.__spoken = [];
      const synth = window.speechSynthesis;
      if (synth && typeof synth.speak === 'function') {
        const origSpeak = synth.speak.bind(synth);
        synth.speak = (utterance: any) => {
          try {
            w.__spoken.push(String((utterance && utterance.text) || ''));
          } catch {
            /* ignore */
          }
          return origSpeak(utterance);
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
    { realKey: REAL_KEY, sessionRole: SESSION_ROLE, language: LANGUAGE },
  );
}

// ── Captura las evaluaciones reales del participante ─────────────────────────────
// La ruta REAL de participación es:
//   useFluParticipant.runEvaluation → aiService.generateParticipantEvaluation
//   → deepseekService.generateParticipantEvaluation (deepseek.ts:322) → fetch DIRECTO
//   a https://openrouter.ai/api/v1/chat/completions con Authorization: Bearer <key real>.
// (El proxy /api/gemini/participant-eval existe pero NO es el que usa el hook.)
// Se identifica la llamada de evaluación por el system prompt "debe intervenir" y se
// extrae el borrador de choices[0].message.content (JSON).
function attachEvalCapture(page: Page, evals: EvalInfo[], requestKeys: string[]): void {
  const extractEval = (body: any): EvalInfo | null => {
    // Forma A — proxy /api/gemini/participant-eval (aplanada): { intervenir, ... }
    if (body && typeof body === 'object' && 'intervenir' in body) {
      return {
        intervenir: Boolean(body.intervenir),
        borrador: String(body.borrador_aportacion || body.evaluation?.borrador_aportacion || ''),
        confianza: Number(body.confianza ?? 0),
        motivo: String(body.motivo_corto || ''),
      };
    }
    // Forma B — OpenRouter directo: { choices: [{ message: { content: '<json>' } }] }
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

  // Sanidad: el chip del participante debe montarse en la UI real
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
// evaluateEveryNTurns=3 → cada lote de 3 turnos dispara UNA evaluación real en el
// commit 3/6/9/12/15/18/21/24. Si el modelo devuelve intervenir=false en una ronda
// (NO es determinista: una corrida levantó la mano y otra declinó las 5 rondas), se
// continúa con más turnos: hasta 8 lotes = 24 turnos = 8 oportunidades reales.
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
async function waitForSpeechIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as any;
    const s = w.speechSynthesis;
    return !(s && (s.speaking || s.pending));
  }, undefined, { timeout: 20_000 });
}

// ── Cede la palabra con reintentos hasta que el borrador real se HABLE vía TTS ──
// speakResponse (fluSpeech.js) ignora la petición si synth.speaking || synth.pending,
// y el guard del hook (shouldIgnoreDuplicateFloorGrant) ahora también respeta
// `pending` → un click prematuro se ignora dejando la mano levantada, así que se
// reintenta hasta que el borrador aparece en w.__spoken (captura real del TTS).
async function clickUntilSpoken(page: Page, draft: string): Promise<void> {
  // El app TRUNCA el borrador a maxDraftChars (420) antes de hablarlo, mientras que la
  // captura de la evaluación guarda el borrador SIN truncar (JSON crudo de Gemini).
  // Los chunks TTS se hablan en orden y desde el inicio, así que el PREFIJO normalizado
  // del borrador siempre está presente en w.__spoken aunque el final esté truncado.
  const norm = (s: string) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const draftNeed = norm(draft).slice(0, 120);

  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    // Esperar TTS totalmente idle antes de intentar la concesión
    try {
      await page.waitForFunction(
        () => {
          const s = (window as any).speechSynthesis;
          return !(s && (s.speaking || s.pending));
        },
        undefined,
        { timeout: 4_000 },
      );
    } catch {
      /* sigue ocupado: reintentar */
    }

    await page
      .locator('.flu-btn--participant')
      .click({ timeout: 3_000 })
      .catch(() => {});

    try {
      await page.waitForFunction(
        (need) => {
          const w = window as any;
          const norm = (s: string) =>
            String(s || '')
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9ñ\s]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          const joined = norm((w.__spoken || []).join(' '));
          return joined.includes(need);
        },
        draftNeed,
        { timeout: 8_000 },
      );
      return; // el borrador real se habló vía TTS
    } catch {
      /* no se habló aún → reintentar (si el click se ignoró, la mano sigue arriba) */
    }
  }
  const spoken = await page.evaluate(() => (window as any).__spoken || []);
  throw new Error(
    `El borrador real no se habló vía TTS tras reintentos (50s). w.__spoken=${JSON.stringify(spoken)}`,
  );
}

function buildReport(title: string, evals: EvalInfo[], requestKeys: string[], extra: string): string {
  const mask = (k: string) => `${k.slice(0, 8)}…${k.slice(-4)}`;
  const evalLines = evals.length
    ? evals
        .map((e, i) => `   [${i + 1}] intervenir=${e.intervenir} confianza=${e.confianza} motivo="${e.motivo}"\n       borrador="${e.borrador}"`)
        .join('\n')
    : '   (ninguna)';
  return `
═══════════════════════════════════════════════════════════════
  ${title}
═══════════════════════════════════════════════════════════════
  API key real usada        = ${mask(requestKeys[0] || '')} (esperada ${KEY_MASK})
  ¿request llevó la key?    = ${requestKeys.length > 0}
  Evaluaciones reales       = ${evals.length}
${evalLines}
  ── ${extra} ──
═══════════════════════════════════════════════════════════════`;
}

test('REAL 1 · Intervención por BOTÓN: FLU habla el borrador real vía TTS', async ({ page }) => {
  test.setTimeout(300_000);

  const evals: EvalInfo[] = [];
  const requestKeys: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  attachEvalCapture(page, evals, requestKeys);

  await installShim(page);

  const draft = await feedUntilRaised(page, evals);

  // La evaluación real viajó con la API key REAL (no fallback ni mock)
  expect(requestKeys.length, 'no hubo ningún request real a /api/gemini/participant-eval').toBeGreaterThan(0);
  expect(
    requestKeys.every((k) => k === REAL_KEY),
    'la API key enviada no coincide con la real de .env',
  ).toBe(true);

  await waitForSpeechIdle(page);

  // Cede la palabra: click REAL en el botón del participante, con reintentos hasta
  // que el borrador real se HABLE vía TTS (capturado en w.__spoken).
  await clickUntilSpoken(page, draft);

  // La mano dejó de estar levantada (consumida → cooldown)
  await expect(page.locator('.flu-status-chip--flu-hand-raised')).toHaveCount(0, { timeout: 20_000 });

  console.log(
    buildReport(
      'REAL 1 · BOTÓN → TTS',
      evals,
      requestKeys,
      `Borrador real aceptado: "${draft}"\n  TTS hablado: ${JSON.stringify(await page.evaluate(() => (window as any).__spoken))}\n  pageErrors=${pageErrors.length}`,
    ),
  );

  expect(pageErrors).toEqual([]);
});

test('REAL 2 · Intervención por COMANDO DE VOZ: borrador real commitado al log', async ({ page }) => {
  test.setTimeout(300_000);

  const evals: EvalInfo[] = [];
  const requestKeys: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  attachEvalCapture(page, evals, requestKeys);

  await installShim(page);

  const draft = await feedUntilRaised(page, evals);

  expect(requestKeys.length, 'no hubo ningún request real a /api/gemini/participant-eval').toBeGreaterThan(0);
  expect(
    requestKeys.every((k) => k === REAL_KEY),
    'la API key enviada no coincide con la real de .env',
  ).toBe(true);

  await waitForSpeechIdle(page);

  // Dispara el comando de voz REAL vía el driver de desarrollo (misma ruta que un
  // usuario diciendo "ok flu adelante")
  const invoked = await page.evaluate(() => {
    const w = window as any;
    if (typeof w.__fluDev?.runFluPhrase !== 'function') return { status: 'missing' };
    return w.__fluDev
      .runFluPhrase('ok flu adelante')
      .then(() => ({ status: 'ok' }))
      .catch((e: any) => ({ status: 'error', error: String(e) }));
  });
  expect(invoked.status, `runFluPhrase falló: ${JSON.stringify(invoked)}`).toBe('ok');

  // El borrador real debe quedar COMMITADO en el conversationHistory REAL
  // como entrada role 'flu' / speakerName 'FLU' (vía addFluMessage).
  // El log guarda el borrador TRUNCADO a maxDraftChars (420): basta con que un
  // PREFIJO significativo (primeras 8 palabras ≥4 chars) del borrador crudo aparezca.
  await page.waitForFunction(
    (d) => {
      const norm = (s: string) =>
        String(s || '')
          .toLowerCase()
          .replace(/[^a-z0-9áéíóúüñ\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      const words = norm(d).split(' ').filter((x) => x.length >= 4).slice(0, 8);
      // @ts-ignore — import en runtime del dev server Vite (mismo patrón que el template e2e)
      return import('/src/store/integrationStore.ts').then((mod: any) => {
        const store = mod.useIntegrationStore.getState();
        return store.conversationHistory.some((e: any) => {
          const role = String(e.role || '').toLowerCase();
          const speaker = String(e.speakerName || e.speaker || '').toLowerCase();
          if (!(role === 'flu' || speaker === 'flu')) return false;
          const text = norm(String(e.text || e.transcript || ''));
          return words.every((word) => text.includes(word));
        });
      });
    },
    draft,
    { timeout: 45_000 },
  );

  const history = await page.evaluate(async () => {
    // @ts-ignore — import en runtime del dev server Vite
    const mod: any = await import('/src/store/integrationStore.ts');
    const store = mod.useIntegrationStore.getState();
    return store.conversationHistory.map((e: any) => ({
      role: e.role,
      speaker: e.speakerName || e.speaker || '',
      text: String(e.text || e.transcript || ''),
    }));
  });
  const fluRows = history.filter((e: any) => e.role === 'flu' || e.speaker === 'FLU');

  console.log(
    buildReport(
      'REAL 2 · COMANDO VOZ → COMMIT AL STORE',
      evals,
      requestKeys,
      `Filas role='flu' en el log REAL: ${fluRows.length}\n${fluRows.map((r: any) => `   [${r.role}/${r.speaker}] ${r.text}`).join('\n')}\n  pageErrors=${pageErrors.length}`,
    ),
  );

  expect(fluRows.length, 'no se commiteó ninguna entrada de FLU al log real').toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
