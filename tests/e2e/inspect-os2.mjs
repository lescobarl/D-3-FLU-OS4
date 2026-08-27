// Quick script to inspect OS2 DOM
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  const result = await page.evaluate(() => {
    const info = {};
    
    // All top-level classes in body
    info.bodyClasses = document.body.className;
    
    // All root divs
    info.rootDivs = Array.from(document.querySelectorAll('body > div')).map(d => ({
      id: d.id,
      className: d.className,
      childCount: d.children.length
    }));
    
    // Look for tabs
    const tabs = document.querySelectorAll('[role="tab"]');
    info.tabs = Array.from(tabs).map(t => ({
      id: t.id,
      text: t.textContent?.trim(),
      className: t.className
    }));
    
    // Look for any element with "header" in class
    info.headerElements = Array.from(document.querySelectorAll('[class*="header"], [class*="Header"]')).map(el => ({
      tag: el.tagName,
      className: el.className,
      text: el.textContent?.trim().substring(0, 100)
    }));
    
    // Look for any element with "voice" or "Voice" in class
    info.voiceElements = Array.from(document.querySelectorAll('[class*="voice"], [class*="Voice"], [class*="assistant"], [class*="Assistant"]')).map(el => ({
      tag: el.tagName,
      className: el.className,
      text: el.textContent?.trim().substring(0, 100)
    }));
    
    // Look for any element with "badge" or "state" in class
    info.badgeElements = Array.from(document.querySelectorAll('[class*="badge"], [class*="state"], [class*="State"]')).map(el => ({
      tag: el.tagName,
      className: el.className,
      text: el.textContent?.trim().substring(0, 100)
    }));
    
    // Look for panel-frame
    info.panelFrames = Array.from(document.querySelectorAll('[class*="panel"], [class*="Panel"]')).map(el => ({
      tag: el.tagName,
      className: el.className,
      text: el.textContent?.trim().substring(0, 80)
    }));
    
    // Look for avatar
    info.avatarElements = Array.from(document.querySelectorAll('[class*="avatar"], [class*="Avatar"], canvas')).map(el => ({
      tag: el.tagName,
      className: el.className,
      id: el.id
    }));
    
    // Look for settings
    info.settingsElements = Array.from(document.querySelectorAll('[class*="setting"], [class*="Setting"], select')).map(el => ({
      tag: el.tagName,
      className: el.className,
      id: el.id,
      value: el.value
    }));
    
    return info;
  });
  
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
