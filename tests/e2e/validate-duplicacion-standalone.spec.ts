/**
 * VALIDACIÓN POR INYECCIÓN — DOS RENGLONES IDÉNTICOS EN EL PIZARRÓN
 * ====================================================================
 * Reproduce el reporte del usuario:
 *   "en el pizarron hay 2 renglones con lo mismo:
 *    Reproduciendo 'Las Mañanitas' con Cepillín por 15 segundos.
 *    Reproduciendo 'Las Mañanitas' con Cepillín por 15 segundos."
 *
 * Hallazgo (confirmado por log + lectura de código):
 *   - ConversationLog.jsx solo colapsa la DUPLICACIÓN INTRA-TURNO
 *     (response adjunta al turno del usuario vs. fila independiente role:'flu'
 *     con el mismo texto). Ese caso renderiza UNA vez (validate-duplicacion-fix).
 *   - NO colapsa DOS filas independientes role:'flu' con el mismo texto que
 *     provienen de DOS turnos distintos. El origen real del segundo renglón es
 *     la persistencia cross-sesión: useConversationPersistence restaura hasta
 *     180 filas de IndexedDB al montar; una sesión anterior que hizo la MISMA
 *     petición produjo el MISMO texto determinista → renglón duplicado.
 *
 * Este test documenta ambos casos de forma controlada:
 *   - caso A (control): UN turno con un addFluMessage → el texto se ve UNA vez.
 *   - caso B (el reportado): DOS turnos con el MISMO addFluMessage (simulando
 *     la persistencia de una sesión anterior) → el texto se ve DOS veces
 *     (comportamiento actual: cada fila standalone es genuina).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5175';

// Texto determinista de FLU (mismo estilo que el reportado).
const FLU_TEXT = "Reproduciendo 'Las Mañanitas' con Cepillín por 15 segundos.";

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

async function injectTurn(page: any, userText: string, fluText: string) {
  await page.evaluate(
    ({ userText, fluText }: { userText: string; fluText: string }) => {
      const store = (window as any).__fluStore;
      if (!store) throw new Error('__fluStore no expuesto globalmente');
      store.getState().addUserMessage(userText, 'Hablante 1');
      store.getState().addFluMessage(fluText);
    },
    { userText, fluText },
  );
  await page.waitForTimeout(300);
}

async function countAuditOccurrences(page: any, needle: string) {
  await switchTab(page, 'conversation');
  const panel = page.locator('#flu-tabpanel-conversation');
  await expect(panel).toBeVisible({ timeout: 5000 });
  return panel.evaluate((root: HTMLElement, draft: string) => {
    const matches = Array.from(root.querySelectorAll('.audit-item')).filter((el) =>
      el.textContent?.includes(draft),
    );
    return {
      count: matches.length,
      rows: matches.map((el) => ({
        speaker: el.querySelector('.audit-item__speaker')?.textContent || '',
        text: (el.querySelector('p')?.textContent || '').slice(0, 50),
      })),
    };
  }, needle);
}

test.describe('🖥️ Pizarrón — dos renglones idénticos (diagnóstico standalone)', () => {
  test('caso A (control): UN turno con el mismo texto → se ve UNA vez', async ({ page }) => {
    await gotoClean(page);
    await injectTurn(page, 'reproduce las mananitas con cepillin 15 segundos', FLU_TEXT);

    const storeShape = await page.evaluate(() => {
      const store = (window as any).__fluStore;
      const history = store.getState().conversationHistory || [];
      return {
        length: history.length,
        fluEntries: history.filter((e: any) => e.role === 'flu').length,
      };
    });
    expect(storeShape.length).toBe(2); // user + flu
    expect(storeShape.fluEntries).toBe(1);

    const occurrences = await countAuditOccurrences(page, FLU_TEXT);
    // Dedup intra-turno colapsa la response adjunta → solo la fila standalone.
    expect(occurrences.count).toBe(1);
    expect(occurrences.rows[0]?.speaker).toContain('FLU');
  });

  test('caso B (el reportado): DOS turnos con el MISMO texto → se ve DOS veces', async ({ page }) => {
    await gotoClean(page);

    // Turno 1 (simula una sesión anterior restaurada desde IndexedDB).
    await injectTurn(page, 'reproduce las mananitas con cepillin 15 segundos', FLU_TEXT);

    // Turno 2 (esta sesión: la petición real que produjo el renglón nuevo).
    await injectTurn(page, 'reproduce las mananitas con cepillin 15 segundos', FLU_TEXT);

    const storeShape = await page.evaluate(() => {
      const store = (window as any).__fluStore;
      const history = store.getState().conversationHistory || [];
      return {
        length: history.length,
        fluEntries: history.filter((e: any) => e.role === 'flu').length,
      };
    });
    // 4 entradas: user1, flu1, user2, flu2 — dos filas standalone genuinas.
    expect(storeShape.length).toBe(4);
    expect(storeShape.fluEntries).toBe(2);

    const occurrences = await countAuditOccurrences(page, FLU_TEXT);
    // El dedup intra-turno quita SOLO la response adjunta (2 filas independientes
    // del mismo texto son genuinas y se muestran ambas).
    expect(occurrences.count).toBe(2);
    for (const row of occurrences.rows) {
      expect(row.speaker).toContain('FLU');
    }
  });
});
