import { test, expect } from '@playwright/test';

test('Header profile combo visual check', async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Take a full page screenshot
    await page.screenshot({ path: 'test-results/header-profile-full.png', fullPage: true });

    // Check the session-info section exists
    const sessionInfo = page.locator('.app-header-session-info');
    await expect(sessionInfo).toBeVisible();

    // Check there are 2 session-chip elements (idioma + perfil)
    const chips = page.locator('.app-header-session-info .session-chip');
    await expect(chips).toHaveCount(2);

    // Check the profile select exists
    const profileSelect = page.locator('.app-header-session-info .session-chip select').last();
    await expect(profileSelect).toBeVisible();

    // Get the options text
    const options = await profileSelect.evaluate((sel: HTMLSelectElement) => {
        return Array.from(sel.options).map(o => o.text);
    });
    console.log('Profile options:', options);
    expect(options).toContain('Administrativo');
    expect(options).toContain('Asistente del Maestro');
    expect(options).toContain('Estudiante');

    // Get current value
    const currentValue = await profileSelect.evaluate((sel: HTMLSelectElement) => sel.value);
    console.log('Current profile value:', currentValue);

    // Check the label says "Perfil"
    const label = page.locator('.app-header-session-info .session-chip .session-chip__label').last();
    await expect(label).toHaveText('Perfil');
});
