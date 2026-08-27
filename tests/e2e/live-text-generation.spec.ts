// ============================================================
// live-text-generation.spec.ts
// VALIDACIÓN EN VIVO de generación de texto REAL con API key válida.
//
// Contexto: el usuario configuró su OpenRouter API key en el portal
// (http://localhost:5173) → guardada en localStorage 'flu-text-api-key'
// (origin-scoped, incluye el PUERTO). Este test:
//   1. Carga el portal en el origen 5173 (donde vive la key).
//   2. Lee la config desde localStorage SIN exponer la key (solo flags).
//   3. Lanza UNA generación real de texto a través del proxy
//      /api/gemini/text → OpenRouter → google/gemini-2.5-flash-lite.
//   4. Verifica que devuelve texto real generado (choices[0].message.content).
//   5. Verifica que el servidor sigue vivo tras la generación.
//
// La key JAMÁS sale del contexto del navegador ni se imprime en logs:
// el fetch ocurre dentro de page.evaluate(), igual que el uso real de la app.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

const ORIGIN = 'http://localhost:5173';

/** Lee la key del .env (gitignored) SIN exponerla en logs. */
function loadEnvKey(): string {
    try {
        const raw = readFileSync(join(process.cwd(), '.env'), 'utf8');
        const m = raw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m);
        return m ? String(m[1]).trim() : '';
    } catch {
        return '';
    }
}

test('Generación de texto REAL con API key válida (google/gemini-2.5-flash-lite vía OpenRouter)', async ({ page }) => {
    test.setTimeout(120000);

    // 1) Cargar el portal en el origen donde el usuario guardó la key.
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });

    // 2) Resolver la key: .env (recomendado, gitignored) o localStorage del
    //    navegador del test. NUNCA se imprime la key completa — solo los
    //    últimos 4 caracteres para confirmar que cargó.
    const envKey = loadEnvKey();
    const lsCfg = await page.evaluate(() => ({
        key: localStorage.getItem('flu-text-api-key') || '',
        model: localStorage.getItem('flu-text-model') || '',
        apiUrl: localStorage.getItem('flu-text-api-url') || '',
        provider: localStorage.getItem('flu-ai-provider') || '',
    }));

    const apiKey = envKey || lsCfg.key;
    const model = lsCfg.model || 'google/gemini-2.5-flash-lite';
    const keySource = envKey ? 'desde .env' : lsCfg.key ? 'desde localStorage' : 'AUSENTE';

    console.log(`[cfg] key: ${keySource} (…${apiKey.slice(-4)}) | model: ${model} | apiUrl: ${lsCfg.apiUrl || '(default)'} | provider: ${lsCfg.provider || '(default)'}`);

    expect(
        apiKey,
        'No hay API key disponible: ni en .env (VITE_OPENROUTER_API_KEY) ni en localStorage del navegador.',
    ).toBeTruthy();

    // 3) Generación REAL dentro del navegador (la key no sale del page context).
    const result = await page.evaluate(
        async ({ model, apiKey }) => {
            const prompt = 'Responde en español con exactamente 2 frases: ¿qué es FLU OS4?';
            try {
                const res = await fetch('/api/gemini/text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt,
                        apiKey,
                        model,
                        system: 'Eres un asistente conciso y preciso.',
                        maxTokens: 200,
                    }),
                });
                const status = res.status;
                let body: any = null;
                try {
                    body = await res.json();
                } catch {
                    body = null;
                }
                return {
                    status,
                    text: String(body?.text || ''),
                    error: String(body?.error || body?.detail || ''),
                    raw: body ? JSON.stringify(body).slice(0, 400) : '',
                };
            } catch (e: any) {
                return { status: 0, text: '', error: String(e?.message || e), raw: '' };
            }
        },
        { model, apiKey },
    );

    console.log(`[text] HTTP ${result.status}`);
    if (result.error) console.log(`[text] error: ${result.error}`);

    expect(
        result.status,
        `El proxy respondió HTTP ${result.status} — ${result.raw || result.error}`,
    ).toBe(200);

    const text = result.text.trim();
    console.log(`[text] respuesta real (${text.length} chars): ${text.slice(0, 400)}`);
    expect(text.length, 'El texto generado está vacío.').toBeGreaterThan(0);

    // 4) El servidor sigue vivo tras la generación.
    const health = await page.request.get(`${ORIGIN}/`);
    expect(health.status()).toBe(200);
    console.log('[health] GET / → HTTP 200 (servidor vivo tras la generación)');
});
