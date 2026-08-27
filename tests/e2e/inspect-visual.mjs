// Quick visual inspection script
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5178', { waitUntil: 'networkidle' });
await page.waitForSelector('.app-header', { timeout: 15000 });

// Take screenshot
await page.screenshot({ path: 'test-results/visual-inspection.png', fullPage: true });

// Find Fluppy/avatar
const avatar = page.locator('.flu-bridge-avatar-area, .flu-avatar, [class*="avatar"], [class*="Avatar"]');
const avatarCount = await avatar.count();
console.log(`[INSPECT] Found ${avatarCount} avatar elements`);
for (let i = 0; i < avatarCount; i++) {
    const box = await avatar.nth(i).boundingBox();
    const tag = await avatar.nth(i).evaluate(el => el.tagName + '.' + (el.className || ''));
    console.log(`[INSPECT] Avatar ${i}: <${tag}> position: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
}

// Find the toggle button and get its computed color
const toggleBtn = page.locator('.voice-bar__button--toggle-idle');
const toggleCount = await toggleBtn.count();
console.log(`[INSPECT] Found ${toggleCount} toggle-idle buttons`);
if (toggleCount > 0) {
    const box = await toggleBtn.boundingBox();
    const color = await toggleBtn.evaluate(el => getComputedStyle(el).color);
    const bg = await toggleBtn.evaluate(el => getComputedStyle(el).background);
    console.log(`[INSPECT] Toggle button: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
    console.log(`[INSPECT] Toggle button color: ${color}`);
    console.log(`[INSPECT] Toggle button background: ${bg}`);
}

// Find the ghost button for comparison
const ghostBtn = page.locator('.voice-bar__button--ghost');
const ghostCount = await ghostBtn.count();
if (ghostCount > 0) {
    const color = await ghostBtn.evaluate(el => getComputedStyle(el).color);
    const bg = await ghostBtn.evaluate(el => getComputedStyle(el).background);
    console.log(`[INSPECT] Ghost button color: ${color}`);
    console.log(`[INSPECT] Ghost button background: ${bg}`);
}

// Find the voice bar
const voiceBar = page.locator('.voice-bar');
const barBox = await voiceBar.boundingBox();
console.log(`[INSPECT] VoiceBar: x=${barBox?.x}, y=${barBox?.y}, w=${barBox?.width}, h=${barBox?.height}`);

// Find the session cluster
const cluster = page.locator('.voice-bar__cluster--session');
const clusterBox = await cluster.boundingBox();
console.log(`[INSPECT] Session cluster: x=${clusterBox?.x}, y=${clusterBox?.y}, w=${clusterBox?.width}, h=${clusterBox?.height}`);

// Find the main content area
const main = page.locator('.app-main');
const mainBox = await main.boundingBox();
console.log(`[INSPECT] App main: x=${mainBox?.x}, y=${mainBox?.y}, w=${mainBox?.width}, h=${mainBox?.height}`);

// Find avatar column
const avatarCol = page.locator('.app-avatar-column');
const colCount = await avatarCol.count();
if (colCount > 0) {
    const box = await avatarCol.boundingBox();
    console.log(`[INSPECT] Avatar column: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
}

// Find panels column
const panelsCol = page.locator('.app-panels-column');
if (await panelsCol.count() > 0) {
    const box = await panelsCol.boundingBox();
    console.log(`[INSPECT] Panels column: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
}

// Find the workspace tab panel (Pizarron)
const wsPanel = page.locator('.flu-tab-panel--workspace.is-active');
if (await wsPanel.count() > 0) {
    const box = await wsPanel.boundingBox();
    const bg = await wsPanel.evaluate(el => getComputedStyle(el).background);
    console.log(`[INSPECT] Workspace panel (Pizarron): x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
    console.log(`[INSPECT] Workspace panel background: ${bg}`);
}

// Find the FluAvatarVoiceBridge area
const fluArea = page.locator('.flu-bridge-avatar-area');
if (await fluArea.count() > 0) {
    const box = await fluArea.boundingBox();
    console.log(`[INSPECT] Flu bridge avatar area: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
}

// Find the header
const header = page.locator('.app-header');
if (await header.count() > 0) {
    const box = await header.boundingBox();
    console.log(`[INSPECT] Header: x=${box?.x}, y=${box?.y}, w=${box?.width}, h=${box?.height}`);
}

// Find chips
const chips = page.locator('.app-header-chips .voice-state-chip');
const chipCount = await chips.count();
console.log(`[INSPECT] Found ${chipCount} chips in header`);
for (let i = 0; i < chipCount; i++) {
    const text = await chips.nth(i).textContent();
    const box = await chips.nth(i).boundingBox();
    console.log(`[INSPECT] Chip ${i}: "${text?.trim()}" x=${box?.x}, y=${box?.y}`);
}

await browser.close();
