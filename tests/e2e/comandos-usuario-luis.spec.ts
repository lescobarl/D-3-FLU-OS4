// ============================================================
// comandos-usuario-luis.spec.ts — Comandos productivos de FLU
// ejecutados como el usuario "Luis" y validados VISUALMENTE en el
// panel lateral (HoyPanel tipo Outlook) + persistencia por usuario.
//
// Flujo REAL por comando:
//   1) completar el onboarding registrando/activando a "Luis",
//   2) inyectar la frase por __fluOnContractResolved (mismo punto de
//      entrada de la voz, App.tsx), atribuida al hablante "Luis",
//   3) verificar en el DOM del HoyPanel que el ítem es visible,
//   4) leer IndexedDB y afirmar que quedó con personName "Luis".
// Cada comando parte de stores limpios y captura screenshot.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoClean, stubLocalSpeech, readStore, clearStore, captureScreenshot } from './_helpers';

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'comandos-usuario-luis');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

async function completeOnboardingLuis(page: Page): Promise<string> {
  await page.waitForSelector('[data-testid="onboarding-input"]', { timeout: 15000 });
  await page.fill('[data-testid="onboarding-input"]', 'Luis');
  await page.click('[data-testid="onboarding-submit"]');
  // Si ya existía "luis" como sugerencia el paso de rol se omite; si aparece,
  // se selecciona un rol válido.
  const kind = page.locator('[data-testid="onboarding-options"]');
  if (await kind.count()) {
    await kind.waitFor({ state: 'visible', timeout: 10000 });
    await kind.selectOption({ index: 0 });
    await page.click('[data-testid="onboarding-submit"]');
  }
  await page.waitForSelector('.flu-onboarding', { state: 'hidden', timeout: 15000 });

  // Seleccionar EXPLÍCITAMENTE la opción "luis" en el picker real del header.
  const picker = page.locator('[data-testid="user-picker-select"]');
  await picker.waitFor({ state: 'visible', timeout: 10000 });
  const luisOption = picker.locator('option').filter({ hasText: /luis/i }).first();
  await luisOption.waitFor({ state: 'attached', timeout: 10000 });
  const id = await luisOption.getAttribute('value');
  expect(id, 'la opción luis debe tener id').toBeTruthy();
  await picker.selectOption(id as string);
  await expect.poll(async () => picker.inputValue(), { timeout: 15000 }).toBe(id as string);
  return id as string;
}

/** Inyecta una frase como Luis por el pipeline real (gate determinista). */
async function driveAsLuis(page: Page, transcript: string): Promise<string> {
  const reply = await page.evaluate(
    ({ t }) => {
      const fn = (window as any).__fluOnContractResolved;
      if (typeof fn !== 'function') throw new Error('__fluOnContractResolved no disponible');
      return fn({
        contract: {},
        transcript: t,
        speakerName: 'Luis',
      }).then((r: any) => r || '');
    },
    { t: transcript },
  );
  await page.waitForTimeout(1200);
  return reply || '';
}

/** Limpia varios stores de IndexedDB. */
async function clearStores(page: Page, stores: string[]): Promise<void> {
  for (const store of stores) await clearStore(page, store);
}

async function luisParticipantId(page: Page): Promise<string> {
  const records = await readStore(page, 'participants');
  const luis = records.find((r) => String(r.name || '').toLowerCase() === 'luis');
  expect(luis, 'Luis debe estar registrado en IndexedDB').toBeTruthy();
  return luis.id;
}

// ⛔ DESHABILITADO (2026-09-09): este spec inyecta el contrato directamente en
// `__fluOnContractResolved` con contract vacío, lo que fuerza el camino OFFLINE
// determinista y NUNCA toca a Gemini. Por eso reportaba "SÍ visible" aunque el
// flujo real (voz → STT → Gemini → acciones → dispatch) NO crea el ítem.
// No valida el comportamiento real; su ejecución es engañosa. No re-habilitar
// hasta que valide el flujo completo con Gemini REAL (no con contrato inyectado).
test.describe.skip('Comandos productivos como usuario Luis — DESHABILITADO (falso positivo)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120000);

  test('1. "ok flu crea una cita para mañana a las 10" → visible en Próximas citas', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStores(page, ['reminders']);
    const id = await luisParticipantId(page);

    const reply = await driveAsLuis(page, 'ok flu crea una cita para mañana a las 10');
    expect(reply).toMatch(/cita/i);

    const item = page.locator('[data-testid="hoy-agenda"] [data-testid="hoy-agenda-item"]', {
      hasText: 'cita',
    });
    await expect(item).toBeVisible({ timeout: 10000 });

    const records = await readStore(page, 'reminders');
    const cita = records.find((r) => r.text === 'cita');
    expect(cita, 'debe persistir el recordatorio "cita"').toBeTruthy();
    expect(cita.status).toBe('pending');
    expect(cita.personName?.toLowerCase()).toBe('luis');

    await captureScreenshot(page, SHOTS_DIR, '1-cita-luis.png');
  });

  test('2. "ok flu pon una alarma a las 11:23" → visible en Alarmas', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStore(page, 'temporalItems');

    const reply = await driveAsLuis(page, 'ok flu pon una alarma a las 11:23');
    expect(reply).toMatch(/alarma/i);

    const section = page.locator('[data-testid="hoy-temporales"]');
    await section.waitFor({ state: 'visible', timeout: 10000 });
    await expect.poll(
      async () => (await section.innerText()).toLowerCase().includes('11:23'),
      { timeout: 10000 },
    ).toBe(true);

    const records = await readStore(page, 'temporalItems');
    const alarm = records.find((r) => r.kind === 'alarm' && r.trigger?.timeOfDay === '11:23');
    expect(alarm, 'debe existir la alarma 11:23').toBeTruthy();

    await captureScreenshot(page, SHOTS_DIR, '2-alarma-luis.png');
  });

  test('3. "ok flu crea una nota para el super" → visible en Notas', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStore(page, 'notes');

    const reply = await driveAsLuis(page, 'ok flu crea una nota para el super');
    expect(reply).toMatch(/nota|super/i);

    const notas = page.locator('[data-testid="notas-pendientes"]');
    await notas.waitFor({ state: 'visible', timeout: 10000 });
    await expect
      .poll(
        async () => (await notas.innerText()).toLowerCase().includes('super'),
        { timeout: 10000 },
      )
      .toBe(true);

    const records = await readStore(page, 'notes');
    expect(records.length, 'debe existir al menos una nota').toBeGreaterThan(0);

    await captureScreenshot(page, SHOTS_DIR, '3-nota-luis.png');
  });

  test('4. "ok flu recuérdame tomar el medicamento a las 12" → visible en citas hoy', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStore(page, 'reminders');

    const reply = await driveAsLuis(page, 'ok flu recuérdame tomar el medicamento a las 12');
    expect(reply).toMatch(/recordatorio/i);

    const item = page.locator('[data-testid="hoy-agenda"] [data-testid="hoy-agenda-item"]', {
      hasText: 'medicamento',
    });
    await expect(item).toBeVisible({ timeout: 10000 });

    const records = await readStore(page, 'reminders');
    const rec = records.find((r) => r.text.toLowerCase().includes('medicamento'));
    expect(rec, 'debe persistir el recordatorio del medicamento').toBeTruthy();
    expect(rec.personName?.toLowerCase()).toBe('luis');

    await captureScreenshot(page, SHOTS_DIR, '4-medicamento-luis.png');
  });

  test('5. "ok flu recuérdame comprar leche mañana a las 9" → visible en citas', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStore(page, 'reminders');

    const reply = await driveAsLuis(page, 'ok flu recuérdame comprar leche mañana a las 9');
    expect(reply).toMatch(/recordatorio|leche/i);

    const item = page.locator('[data-testid="hoy-agenda"] [data-testid="hoy-agenda-item"]', {
      hasText: 'leche',
    });
    await expect(item).toBeVisible({ timeout: 10000 });

    const records = await readStore(page, 'reminders');
    const rec = records.find((r) => r.text.toLowerCase().includes('leche'));
    expect(rec, 'debe persistir el recordatorio de la leche').toBeTruthy();

    await captureScreenshot(page, SHOTS_DIR, '5-leche-luis.png');
  });

  test('6. "ok flu agrega pan a la lista de compras" → persiste en shopping', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStore(page, 'shopping');

    const reply = await driveAsLuis(page, 'ok flu agrega pan a la lista de compras');
    expect(reply).toMatch(/compras|pan/i);

    const records = await readStore(page, 'shopping');
    const pan = records.find((r) => String(r.label || '').toLowerCase() === 'pan');
    expect(pan, 'debe persistir "pan" en la lista de compras').toBeTruthy();

    await captureScreenshot(page, SHOTS_DIR, '6-compras-luis.png');
  });

  test('7. "ok flu pon una alarma a las 7 de la mañana" → visible en Alarmas', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStore(page, 'temporalItems');

    const reply = await driveAsLuis(page, 'ok flu pon una alarma a las 7 de la mañana');
    expect(reply).toMatch(/alarma/i);

    const section = page.locator('[data-testid="hoy-temporales"]');
    await section.waitFor({ state: 'visible', timeout: 10000 });
    await expect
      .poll(
        async () => (await section.innerText()).toLowerCase().includes('07:00') || (await section.innerText()).toLowerCase().includes('7:00'),
        { timeout: 10000 },
      )
      .toBe(true);

    await captureScreenshot(page, SHOTS_DIR, '7-alarma-manana-luis.png');
  });

  test('8. "ok flu apunta que tengo que llamar al dentista" → visible en Notas', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStore(page, 'notes');

    const reply = await driveAsLuis(page, 'ok flu apunta que tengo que llamar al dentista');
    expect(reply).toMatch(/nota|dentista/i);

    const notas = page.locator('[data-testid="notas-pendientes"]');
    await notas.waitFor({ state: 'visible', timeout: 10000 });
    await expect
      .poll(
        async () => (await notas.innerText()).toLowerCase().includes('dentista'),
        { timeout: 10000 },
      )
      .toBe(true);

    await captureScreenshot(page, SHOTS_DIR, '8-dentista-luis.png');
  });

  test('9. "ok flu agrega matemáticas el lunes a las 8 al horario" → visible en horario', async ({ page }) => {
    stubLocalSpeech(page);
    await gotoClean(page);
    await clearParticipants(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.flu-shell', { timeout: 15000 });
    await completeOnboardingLuis(page);
    await clearStore(page, 'horario');

    const reply = await driveAsLuis(page, 'ok flu agrega matemáticas el lunes a las 8 al horario');
    expect(reply).toMatch(/matem|horario|listo/i);

    const records = await readStore(page, 'horario');
    const clase = records.find((r) => String(r.materia || '').toLowerCase().includes('matem'));
    expect(clase, 'debe persistir la clase de matemáticas').toBeTruthy();

    await captureScreenshot(page, SHOTS_DIR, '9-horario-luis.png');
  });
});

/** Limpia participantes + onboarding per-user para que Luis se registre fresco. */
async function clearParticipants(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const request = indexedDB.open('flu-os3');
      request.onsuccess = (event: any) => {
        const database = event.target.result as IDBDatabase;
        const names = ['participants', 'onboardingStates'];
        const tx = database.transaction(names, 'readwrite');
        names.forEach((name) => {
          if (database.objectStoreNames.contains(name)) tx.objectStore(name).clear();
        });
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => {
          database.close();
          resolve();
        };
      };
      request.onerror = () => resolve();
    });
  });
}
