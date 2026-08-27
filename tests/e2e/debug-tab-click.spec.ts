// ============================================================
// Debug: Tab Click Behavior
// ============================================================
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('Debug Tab Click', () => {
    test('click conversation tab and check state', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Check initial state
        const workspaceTab = page.locator('#flu-tab-workspace');
        const conversationTab = page.locator('#flu-tab-conversation');
        const workspacePanel = page.locator('#flu-tabpanel-workspace');
        const conversationPanel = page.locator('#flu-tabpanel-conversation');

        console.log('=== Initial State ===');
        console.log('workspaceTab visible:', await workspaceTab.isVisible());
        console.log('conversationTab visible:', await conversationTab.isVisible());
        console.log('workspacePanel hidden attr:', await workspacePanel.getAttribute('hidden'));
        console.log('conversationPanel hidden attr:', await conversationPanel.getAttribute('hidden'));
        console.log('workspaceTab aria-selected:', await workspaceTab.getAttribute('aria-selected'));
        console.log('conversationTab aria-selected:', await conversationTab.getAttribute('aria-selected'));

        // Try clicking conversation tab
        console.log('\n=== Clicking conversation tab ===');
        await conversationTab.click();
        await page.waitForTimeout(500);

        console.log('workspaceTab aria-selected:', await workspaceTab.getAttribute('aria-selected'));
        console.log('conversationTab aria-selected:', await conversationTab.getAttribute('aria-selected'));
        console.log('workspacePanel hidden attr:', await workspacePanel.getAttribute('hidden'));
        console.log('conversationPanel hidden attr:', await conversationPanel.getAttribute('hidden'));

        // Try clicking with force
        console.log('\n=== Clicking conversation tab with force ===');
        await conversationTab.click({ force: true });
        await page.waitForTimeout(500);

        console.log('workspaceTab aria-selected:', await workspaceTab.getAttribute('aria-selected'));
        console.log('conversationTab aria-selected:', await conversationTab.getAttribute('aria-selected'));
        console.log('workspacePanel hidden attr:', await workspacePanel.getAttribute('hidden'));
        console.log('conversationPanel hidden attr:', await conversationPanel.getAttribute('hidden'));

        // Check for any console errors
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('CONSOLE ERROR:', msg.text());
            }
        });

        // Try dispatchEvent approach
        console.log('\n=== Using dispatchEvent ===');
        await page.evaluate(() => {
            const tab = document.getElementById('flu-tab-conversation');
            if (tab) {
                tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
        });
        await page.waitForTimeout(500);

        console.log('workspaceTab aria-selected:', await workspaceTab.getAttribute('aria-selected'));
        console.log('conversationTab aria-selected:', await conversationTab.getAttribute('aria-selected'));
        console.log('workspacePanel hidden attr:', await workspacePanel.getAttribute('hidden'));
        console.log('conversationPanel hidden attr:', await conversationPanel.getAttribute('hidden'));

        // Check if the tab has pointer-events or other CSS issues
        const pointerEvents = await conversationTab.evaluate(el => getComputedStyle(el).pointerEvents);
        const display = await conversationTab.evaluate(el => getComputedStyle(el).display);
        const visibility = await conversationTab.evaluate(el => getComputedStyle(el).visibility);
        const opacity = await conversationTab.evaluate(el => getComputedStyle(el).opacity);
        console.log('\n=== CSS Properties ===');
        console.log('pointer-events:', pointerEvents);
        console.log('display:', display);
        console.log('visibility:', visibility);
        console.log('opacity:', opacity);

        // Check bounding box
        const box = await conversationTab.boundingBox();
        console.log('boundingBox:', box);

        // Check if there's an overlay on top
        console.log('\n=== Element at click point ===');
        if (box) {
            const elemAtPoint = await page.evaluate(({ x, y }) => {
                const el = document.elementFromPoint(x + 5, y + 5);
                return el ? el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').join('.') : '') : 'null';
            }, box);
            console.log('element at click point:', elemAtPoint);
        }

        // Final check
        expect(true).toBe(true);
    });
});
