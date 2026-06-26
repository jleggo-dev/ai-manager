import puppeteer from 'puppeteer';

const url = 'https://www.appdirect.com';
const SHADOW_HOST = '#appdirect-ai-embedded-root';

const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
await new Promise((r) => setTimeout(r, 8000));

await page.evaluate((sel) => {
  const sr = document.querySelector(sel)?.shadowRoot;
  (sr?.querySelector('button[class*="Button"]') || sr?.querySelector('button'))?.click();
}, SHADOW_HOST);
await new Promise((r) => setTimeout(r, 4000));

const iframeHandle = await page.evaluateHandle((sel) => {
  const sr = document.querySelector(sel)?.shadowRoot;
  return sr?.querySelector('iframe[class*="Iframe"]') || sr?.querySelector('iframe');
}, SHADOW_HOST);

const frame = await iframeHandle.contentFrame();
if (frame) {
  await new Promise((r) => setTimeout(r, 4000));

  const buttons = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map((btn, i) => ({
      index: i,
      type: btn.getAttribute('type'),
      className: btn.className?.slice(0, 200),
      ariaLabel: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      innerHTML: btn.innerHTML?.slice(0, 300),
      parentClass: btn.parentElement?.className?.slice(0, 150),
      grandparentClass: btn.parentElement?.parentElement?.className?.slice(0, 150),
      svgPath: btn.querySelector('svg path')?.getAttribute('d')?.slice(0, 50),
      visible: btn.offsetParent !== null || btn.getClientRects().length > 0,
      rect: btn.getBoundingClientRect(),
    }));
  });
  console.log('\n--- All buttons in iframe ---');
  console.log(JSON.stringify(buttons, null, 2));

  // Also check for the input area's sibling/parent buttons
  const inputContext = await frame.evaluate(() => {
    const input = document.querySelector('#chat-input');
    if (!input) return null;
    const wrapper = input.closest('div[class*="input"], div[class*="flex"]');
    const nearbyBtns = wrapper ? Array.from(wrapper.querySelectorAll('button')).map((b) => ({
      className: b.className?.slice(0, 200),
      ariaLabel: b.getAttribute('aria-label'),
      innerHTML: b.innerHTML?.slice(0, 200),
    })) : [];
    return {
      inputParentClass: input.parentElement?.className?.slice(0, 200),
      wrapperClass: wrapper?.className?.slice(0, 200),
      nearbyButtons: nearbyBtns,
    };
  });
  console.log('\n--- Buttons near #chat-input ---');
  console.log(JSON.stringify(inputContext, null, 2));
}

await browser.close();
