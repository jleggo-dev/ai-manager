import puppeteer from 'puppeteer';

const url = process.argv[2] || 'https://www.appdirect.com';
const SHADOW_HOST = '#appdirect-ai-embedded-root';
const start = Date.now();
function elapsed() { return `${((Date.now() - start) / 1000).toFixed(1)}s`; }

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  console.log(`[${elapsed()}] Navigating...`);
  try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }); } catch {}
  await new Promise((r) => setTimeout(r, 3000));

  // Shadow root + launcher
  await page.evaluate((sel) => {
    document.querySelector(sel)?.shadowRoot?.querySelector('button[class*="Button"]')?.click();
  }, SHADOW_HOST);
  await new Promise((r) => setTimeout(r, 3000));

  // Iframe
  const iframeEl = await page.evaluateHandle((sel) => {
    return document.querySelector(sel)?.shadowRoot?.querySelector('iframe[class*="Iframe"]');
  }, SHADOW_HOST);
  const frame = await iframeEl.contentFrame();
  if (!frame) throw new Error('No frame');
  await new Promise((r) => setTimeout(r, 5000));

  // Count messages before
  const before = await frame.evaluate(() => document.querySelectorAll('.markdown-chat-message').length);
  console.log(`[${elapsed()}] Messages before: ${before}`);

  // Type + press Enter (instead of clicking send button)
  const input = await frame.$('#chat-input');
  if (!input) throw new Error('No input');
  await input.click();
  await input.type('Hello, can you help me?', { delay: 30 });
  console.log(`[${elapsed()}] Typed message`);

  // Try Enter key
  await input.press('Enter');
  console.log(`[${elapsed()}] Pressed Enter`);

  // Wait 2s then check if user message appeared
  await new Promise((r) => setTimeout(r, 3000));
  const afterSend = await frame.evaluate(() => document.querySelectorAll('.markdown-chat-message').length);
  console.log(`[${elapsed()}] Messages after Enter: ${afterSend}`);

  if (afterSend <= before) {
    // Enter didn't work, try clicking the send button
    console.log(`[${elapsed()}] Enter didn't send, trying button click...`);

    // Try frame.click on the button directly
    const sendBtnInfo = await frame.evaluate(() => {
      const wrapper = document.querySelector('div[class*="inputBackground"]');
      const btns = wrapper?.querySelectorAll('button');
      return {
        wrapperFound: !!wrapper,
        buttonCount: btns?.length ?? 0,
        buttons: btns ? Array.from(btns).map(b => ({
          class: b.className?.slice(0, 100),
          disabled: b.disabled,
          display: getComputedStyle(b).display,
        })) : [],
      };
    });
    console.log(`[${elapsed()}] Send area:`, JSON.stringify(sendBtnInfo, null, 2));

    // Click last button via evaluate
    const clicked = await frame.evaluate(() => {
      const wrapper = document.querySelector('div[class*="inputBackground"]');
      const btns = wrapper?.querySelectorAll('button');
      const last = btns?.[btns.length - 1];
      if (last) { last.click(); return 'clicked'; }
      return 'not found';
    });
    console.log(`[${elapsed()}] Button click result: ${clicked}`);

    await new Promise((r) => setTimeout(r, 3000));
    const afterClick = await frame.evaluate(() => document.querySelectorAll('.markdown-chat-message').length);
    console.log(`[${elapsed()}] Messages after button click: ${afterClick}`);

    if (afterClick <= before) {
      // Check if the text is still in the input
      const inputVal = await frame.evaluate(() => {
        const el = document.querySelector('#chat-input');
        return el?.value ?? el?.textContent ?? 'N/A';
      });
      console.log(`[${elapsed()}] Input still contains: "${inputVal}"`);

      // Try dispatching keyboard event
      console.log(`[${elapsed()}] Trying keyboard dispatch...`);
      await frame.evaluate(() => {
        const el = document.querySelector('#chat-input');
        if (el) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        }
      });
      await new Promise((r) => setTimeout(r, 5000));
      const afterDispatch = await frame.evaluate(() => document.querySelectorAll('.markdown-chat-message').length);
      console.log(`[${elapsed()}] Messages after dispatch: ${afterDispatch}`);
    }
  }

  // Final wait + check
  if (afterSend > before) {
    console.log(`[${elapsed()}] Message sent! Waiting for LLM response...`);
    await frame.waitForFunction(
      (prev) => document.querySelectorAll('.markdown-chat-message').length > prev + 1,
      { timeout: 60000 },
      before
    );

    let lastContent = '';
    let stable = 0;
    while (stable < 3) {
      await new Promise((r) => setTimeout(r, 500));
      const c = await frame.evaluate(() => {
        const msgs = document.querySelectorAll('.markdown-chat-message');
        return msgs[msgs.length - 1]?.textContent?.trim() || '';
      });
      if (c === lastContent && c.length > 0) stable++; else { stable = 0; lastContent = c; }
    }
    console.log(`\n✅ PASS [${elapsed()}]\nResponse: ${lastContent.slice(0, 200)}`);
  }
} catch (err) {
  console.log(`\n❌ FAIL [${elapsed()}]: ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
