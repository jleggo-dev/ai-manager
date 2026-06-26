import puppeteer from 'puppeteer';

const url = 'https://www.appdirect.com';
const SHADOW_HOST = '#appdirect-ai-embedded-root';

const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
await new Promise((r) => setTimeout(r, 8000));

// Click launcher
await page.evaluate((sel) => {
  const sr = document.querySelector(sel)?.shadowRoot;
  (sr?.querySelector('button[class*="Button"]'))?.click();
}, SHADOW_HOST);
await new Promise((r) => setTimeout(r, 4000));

// Get iframe
const iframeHandle = await page.evaluateHandle((sel) => {
  const sr = document.querySelector(sel)?.shadowRoot;
  return sr?.querySelector('iframe[class*="Iframe"]');
}, SHADOW_HOST);

const frame = await iframeHandle.contentFrame();
if (!frame) { console.log('No frame'); await browser.close(); process.exit(1); }
await new Promise((r) => setTimeout(r, 4000));

// Type message
const input = await frame.$('#chat-input');
if (!input) { console.log('No input'); await browser.close(); process.exit(1); }
await input.click();
await input.type('Hello', { delay: 30 });
await new Promise((r) => setTimeout(r, 500));

// Click send (last button in input wrapper)
const sent = await frame.evaluate(() => {
  const wrapper = document.querySelector('div[class*="inputBackground"]');
  const buttons = wrapper?.querySelectorAll('button');
  const sendBtn = buttons?.[buttons.length - 1];
  if (sendBtn) { sendBtn.click(); return true; }
  return false;
});
console.log('Clicked send:', sent);

// Wait for response
console.log('Waiting for response (30s)...');
await new Promise((r) => setTimeout(r, 30000));

// Inspect message elements
const messages = await frame.evaluate(() => {
  const candidates = [
    '[class*="ChatBubble"]', '[class*="chatBubble"]',
    '[class*="message"]', '[class*="Message"]',
    '[class*="bubble"]', '[class*="Bubble"]',
    '[class*="chat-message"]', '[class*="assistant"]',
    '[class*="response"]', '[class*="prose"]',
    '.markdown', '[class*="markdown"]',
    '[data-role]', '[data-message]',
  ];
  const results = {};
  for (const sel of candidates) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      results[sel] = Array.from(els).map((el) => ({
        tag: el.tagName.toLowerCase(),
        className: el.className?.toString()?.slice(0, 200),
        text: el.textContent?.trim()?.slice(0, 100),
        childCount: el.children.length,
      }));
    }
  }

  // Also dump the chat area
  const chatArea = document.querySelector('.overflow-y-auto');
  if (chatArea) {
    results['_chatArea_children'] = Array.from(chatArea.children).map((el) => ({
      tag: el.tagName.toLowerCase(),
      className: el.className?.toString()?.slice(0, 200),
      text: el.textContent?.trim()?.slice(0, 100),
      childCount: el.children.length,
    }));
  }

  return results;
});
console.log('\n--- Message elements ---');
console.log(JSON.stringify(messages, null, 2));

await browser.close();
