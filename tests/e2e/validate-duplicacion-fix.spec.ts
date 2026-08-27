/**
 * VALIDACIÓN POR INYECCIÓN — FIX DE DUPLICACIÓN DEL LOG DE CONVERSACIÓN
 * ====================================================================
 * Reproduce EXACTAMENTE el escenario reportado por el usuario:
 *   "el texto de FLU aparece ARRIBA y ABAJO de 'Okay flu adelante',
 *    incluso ANTES de que FLU hable"
 *
 * Causa raíz (confirmada): addFluMessage (integrationStore.ts:436-470)
 * hace DOBLE escritura:
 *   1) adjunta `response`/`meta.response` al último turno del usuario
 *      (integrationStore.ts:452-456)
 *   2) ADEMÁS agrega una entrada independiente role:'flu' con el mismo
 *      texto (integrationStore.ts:461)
 *
 * ConversationLog.jsx pintaba ambas (entrada independiente arriba por
 * iteración reversa + respuesta adjunta en la fila del usuario abajo).
 * El fix (ConversationLog.jsx:22-35) suprime la respuesta adjunta cuando
 * ya existe una fila FLU independiente con el mismo texto.
 *
 * La inyección vía addFluMessage reproduce el momento EXACTO en que se
 * agrega la entrada FLU (al resolver el contrato, ANTES del TTS) → el
 * "incluso antes de que hable" queda cubierto: aquí nunca hay TTS.
 *
 * Este test:
 *   - inyecta el historial REAL vía window.__fluStore (mismo patrón de
 *     productive-injection.spec.ts)
 *   - verifica que el STORE conserva la doble escritura intacta
 *     (la necesitan Gemini/persistencia/exportación)
 *   - verifica que el LOG RENDERIZADO muestra el texto de FLU UNA sola vez
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5175';

// Texto del borrador de FLU (la intervención del participante que se concede).
const FLU_DRAFT =
  'Entiendo, te cedo la palabra para que compartas tu punto sobre la revolucion mexicana.';

async function gotoClean(page: any) {
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('.flu-shell', { timeout: 15000 });
  await page.evaluate(() => localStorage.clear());
  await page.locator('nav[role="tablist"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function switchTab(page: any, tabId: string) {
  await page.evaluate((id: string) => {
    const fn = (window as any).__fluSetActiveTab;
    if (fn) {
      fn(id);
    } else {
      const el = document.getElementById(`flu-tab-${id}`);
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }, tabId);
  await page.waitForTimeout(800);
}

test.describe('💉 FIX duplicación del log (inyección real del store)', () => {
  test('el texto de FLU se renderiza UNA sola vez aunque el store tenga la doble escritura', async ({ page }) => {
    await gotoClean(page);

    // ── Inyectar el escenario EXACTO: turno de usuario "Okay flu adelante"
    //    + addFluMessage (doble escritura: response adjunta + entrada role:'flu').
    await page.evaluate((draft: string) => {
      const store = (window as any).__fluStore;
      if (!store) throw new Error('__fluStore no expuesto globalmente');
      store.getState().addUserMessage('Okay flu adelante', 'Hablante 1');
      store.getState().addFluMessage(draft);
    }, FLU_DRAFT);

    await page.waitForTimeout(500);

    // ── Verificación 1: el STORE conserva la doble escritura intacta.
    const storeShape = await page.evaluate(() => {
      const store = (window as any).__fluStore;
      const history = store.getState().conversationHistory || [];
      const lastUser = history.find((e: any) => e.role === 'user');
      const fluEntries = history.filter((e: any) => e.role === 'flu');
      return {
        length: history.length,
        userResponse: lastUser?.response || '',
        userMetaResponse: lastUser?.meta?.response || '',
        fluEntryText: fluEntries[0]?.text || '',
        fluEntryCount: fluEntries.length,
      };
    });
    expect(storeShape.length).toBe(2);
    expect(storeShape.userResponse).toBe(FLU_DRAFT);
    expect(storeShape.userMetaResponse).toBe(FLU_DRAFT);
    expect(storeShape.fluEntryCount).toBe(1);
    expect(storeShape.fluEntryText).toBe(FLU_DRAFT);

    // ── Verificación 2: el LOG RENDERIZADO muestra el texto UNA vez.
    await switchTab(page, 'conversation');
    const panel = page.locator('#flu-tabpanel-conversation');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Contar elementos cuyo texto contiene el borrador de FLU.
    const occurrences = await panel.evaluate((root: HTMLElement, draft: string) => {
      const matches = Array.from(root.querySelectorAll('.audit-item')).filter((el) =>
        el.textContent?.includes(draft),
      );
      return {
        count: matches.length,
        rows: matches.map((el) => ({
          speaker: el.querySelector('.audit-item__speaker')?.textContent || '',
          text: (el.querySelector('p')?.textContent || '').slice(0, 40),
        })),
      };
    }, FLU_DRAFT);

    // ANTES del fix: 2 (fila FLU independiente ARRIBA + response adjunta
    // en la fila del usuario ABAJO). DESPUÉS del fix: 1.
    expect(occurrences.count).toBe(1);
    expect(occurrences.rows[0]?.speaker).toContain('FLU');

    // ── Verificación 3: el turno del usuario "Okay flu adelante" sigue
    //    visible SIN la respuesta adjunta repetida.
    const grantRows = await panel.evaluate((root: HTMLElement) => {
      return Array.from(root.querySelectorAll('.audit-item'))
        .filter((el) => el.textContent?.includes('Okay flu adelante'))
        .map((el) => el.textContent || '');
    });
    expect(grantRows.length).toBe(1);
    expect(grantRows[0]).not.toContain(FLU_DRAFT);
  });
});
