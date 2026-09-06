// ============================================================
// cita-agenda.spec.ts — Bug #7: "ok flu crea una cita para
// mañana a las 10" debe AGENDARSE (recordatorio persistido con
// dueAt = mañana 10:00, texto limpio "cita") y VERSE de inmediato
// en el panel lateral Hoy (sección "Próximas citas").
//
// La spec conduce la frase por el pipeline REAL de voz
// (__fluOnContractResolved → gate determinista → despacho al
// manejador de recordatorios), lee la persistencia REAL en
// IndexedDB y verifica la VISIBILIDAD real en el DOM del HoyPanel.
// ============================================================

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoClean, stubLocalSpeech, readStore, clearStore, captureScreenshot } from './_helpers';

const SHOTS_DIR = path.join(process.cwd(), 'reports', 'cita-agenda');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

test.describe('Bug #7 — cita para mañana a las 10 agendada y visible', () => {
    test.describe.configure({ mode: 'serial' });

    test('la frase real persiste la cita (mañana 10:00) y la muestra en el panel Hoy', async ({ page }) => {
        stubLocalSpeech(page);
        await gotoClean(page);
        await clearStore(page, 'reminders');

        // Inserta la frase por el MISMO pipeline del voz (gate determinista).
        const reply = await page.evaluate(() => {
            const fn = (window as any).__fluOnContractResolved;
            if (typeof fn !== 'function') throw new Error('__fluOnContractResolved no disponible');
            return fn({ contract: {}, transcript: 'ok flu crea una cita para mañana a las 10' }).then(
                (r: any) => r || '',
            );
        });
        await page.waitForTimeout(800);

        // 1) El ack confirma la agenda de forma clara.
        expect(reply).toMatch(/cita/i);

        // 2) Persistió como recordatorio con texto limpio y dueAt mañana 10:00.
        const records = await readStore(page, 'reminders');
        const cita = records.find((r) => r.text === 'cita');
        expect(cita, 'debe existir el recordatorio "cita"').toBeTruthy();
        expect(cita.status).toBe('pending');
        const due = new Date(cita.dueAt);
        const browserDate = await page.evaluate(() => {
            const now = new Date();
            const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0, 0);
            return { year: tomorrow.getFullYear(), month: tomorrow.getMonth(), day: tomorrow.getDate(), hour: tomorrow.getHours() };
        });
        expect(due.getFullYear()).toBe(browserDate.year);
        expect(due.getMonth()).toBe(browserDate.month);
        expect(due.getDate()).toBe(browserDate.day);
        expect(due.getHours()).toBe(10);
        expect(due.getMinutes()).toBe(0);

        // 3) La cita es visible en el panel lateral Hoy (sección "Próximas citas").
        const agendaSection = page.locator('[data-testid="hoy-agenda"]');
        await agendaSection.waitFor({ state: 'visible', timeout: 10000 });
        const agendaItem = agendaSection.locator('[data-testid="hoy-agenda-item"]', { hasText: 'cita' });
        await expect(agendaItem).toBeVisible();
        const when = await agendaItem.locator('.hoy-panel__clase-meta').textContent();
        expect(when).toMatch(/mañana/);
        expect(when).toContain('10:00');

        await captureScreenshot(page, SHOTS_DIR, 'cita-visible-en-hoy.png');
    });
});
