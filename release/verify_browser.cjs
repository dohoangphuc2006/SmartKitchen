// Drive a real Chromium page through its local DevTools connection.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

const [browser, url, profile, evidence] = process.argv.slice(2);

async function until(read, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await sleep(200);
  }
  throw new Error('Timed out waiting for ' + label);
}

async function verify() {
  await mkdir(profile, { recursive: true });
  const chrome = spawn(browser, [
    '--headless', '--remote-debugging-port=0', '--disable-background-networking',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--window-size=1365,1050', '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });
  const browserExit = new Promise(resolve => chrome.once('exit', resolve));
  let launchError;
  chrome.on('error', error => { launchError = error; });
  let ws;
  try {
    const [port] = await until(async () => {
      if (launchError) throw launchError;
      if (chrome.exitCode !== null) throw new Error('Browser exited: ' + chrome.exitCode);
      const data = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
      return data && data.split('\n');
    }, 'Chromium DevTools');
    const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
    ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const pending = new Map();
    const exceptions = [];
    const externalRequests = [];
    const failedLoads = [];
    const methods = [];
    let nextId = 0;
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const waiting = pending.get(message.id);
      if (waiting) {
        pending.delete(message.id);
        if (message.error) waiting.reject(new Error(message.error.message));
        else waiting.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        exceptions.push(message.params.args.map(arg => arg.description || arg.value));
      }
      if (message.method === 'Network.requestWillBeSent') {
        const request = message.params.request;
        if (request.url.startsWith('http') && !request.url.startsWith(url)) externalRequests.push(request.url);
        if (request.url === url + 'api/recommend' && request.postData) {
          methods.push(JSON.parse(request.postData).ranking_method);
        }
      }
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
        failedLoads.push(message.params.response.url);
      }
    });
    function send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(method + ' timed out'));
        }, 15_000);
        pending.set(id, {
          resolve: result => { clearTimeout(timer); resolve(result); },
          reject: error => { clearTimeout(timer); reject(error); },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evalPage(expression) {
      const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
      return reply.result.value;
    }
    const click = selector => evalPage('document.querySelector(' + JSON.stringify(selector) + ').click()');
    const waitFor = (expression, label) => until(() => evalPage(expression), label);
    const add = ingredients => evalPage(
      'document.querySelector("#ingredientInput").value = ' + JSON.stringify(ingredients)
      + '; document.querySelector("#addIngredientForm").requestSubmit()');
    const screenshot = async name => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(evidence, name), Buffer.from(shot.data, 'base64'));
    };

    await Promise.all(['Page', 'Runtime', 'Network'].map(domain => send(domain + '.enable')));
    await send('Page.navigate', { url });
    await waitFor('document.querySelector("#ingredientWorkspace")?.classList.contains("recipe-only")',
      'Recipe configuration');
    assert(await evalPage('document.querySelector("#openUploadBtn").hidden && document.querySelector("#openCameraBtn").hidden'));
    assert(await evalPage('Array.from(document.styleSheets).some(sheet => sheet.href?.includes("/static/style.css"))'));
    assert(!(await evalPage('document.querySelector(".workspace-subtitle").textContent')).includes('Camera'));

    await add('2 quả trứng, cà chua, hành lá');
    await waitFor('document.querySelectorAll(".ingredient-chip").length === 3', 'three pantry items');
    assert.match(await evalPage('document.querySelector(".chip-label").textContent'), /2/);
    await click('.chip-remove');
    await waitFor('document.querySelectorAll(".ingredient-chip").length === 2', 'pantry removal');
    await add('2 quả trứng');
    await waitFor('document.querySelectorAll(".ingredient-chip").length === 3', 'pantry re-add');

    for (const method of ['final', 'ml_tfidf', 'ml_lsa']) {
      await click('input[name=rankingMethodRadio][value=' + method + ']');
      await click('#recommendButton');
      await waitFor('document.querySelector(".tier-a-header") && document.querySelector(".tier-b-header") '
        + '&& document.querySelectorAll(".recipe-detail-button").length > 2 '
        + '&& !document.querySelector("#recommendButton").disabled', 'two-tier results for ' + method);
    }
    assert.deepEqual(methods, ['final', 'ml_tfidf', 'ml_lsa']);
    assert(!(await evalPage('document.querySelector("#results").textContent')).includes('Cần mua thêm 0 nguyên liệu'));
    await screenshot('browser-results.png');

    const detail = await evalPage('document.querySelector(".recipe-detail-button").closest("[data-recipe-id]").dataset.recipeId');
    await click('.recipe-detail-button');
    await waitFor('!document.querySelector("#recipeModal").hidden && !document.querySelector("#recipeDetailContent").hidden'
      + ' && Boolean(document.querySelector("#recipeStepText").textContent.trim())', 'recipe detail');
    const fields = '["#recipeDetailTitle","#recipeIngredientList","#recipeStepText","#recipeIngredientsTitle"]'
      + '.map(selector => document.querySelector(selector).textContent.trim())';
    const vi = await evalPage(fields);
    assert(vi.every(Boolean));
    await screenshot('browser-recipe-vi.png');
    await click('#modalShowEnglish');
    await waitFor('document.querySelector("#modalShowEnglish").getAttribute("aria-pressed") === "true"', 'English recipe');
    const en = await evalPage(fields);
    assert(en.every(Boolean));
    for (let i = 0; i < vi.length; i++) assert.notEqual(vi[i], en[i]);
    await screenshot('browser-recipe-en.png');
    await click('#modalShowVietnamese');
    assert.deepEqual(await evalPage(fields), vi);
    await click('#closeRecipeModal');
    await waitFor('Object.keys(displayCatalog.recipes).length > 0', 'translation coverage data');
    const fallback = await evalPage('Array.from(document.querySelectorAll("#results [data-recipe-id]"))'
      + '.find(card => !displayCatalog.recipes[card.dataset.recipeId]?.instructions_available)?.dataset.recipeId');
    assert(fallback, 'Expected at least one result with English instruction fallback');
    await click('[data-recipe-id="' + fallback + '"] .recipe-detail-button');
    await waitFor('!document.querySelector("#recipeDetailContent").hidden'
      + ' && !document.querySelector("#recipeInstructionFallbackNote").hidden', 'English fallback in VI');
    assert.equal(await evalPage('document.querySelector("#recipeLanguageBadge").textContent'), 'EN');
    const fallbackStep = await evalPage('document.querySelector("#recipeStepText").textContent');
    await click('#modalShowEnglish');
    assert.equal(await evalPage('document.querySelector("#recipeStepText").textContent'), fallbackStep);
    await click('#modalShowVietnamese');
    await screenshot('browser-recipe-fallback.png');
    await click('#closeRecipeModal');
    await click('#clearPantryButton');
    await click('#confirmClearPantry');
    await add('phieu12');
    await waitFor('document.querySelector(".chip-unrecognized") !== null', 'unrecognized pantry item');
    await click('#recommendButton');
    await waitFor('!document.querySelector("#recommendButton").disabled && '
      + 'document.querySelectorAll(".recipe-detail-button").length === 0 && '
      + '/chưa|không/i.test(document.querySelector("#results").textContent)', 'empty recommendation');
    assert.deepEqual(methods, ['final', 'ml_tfidf', 'ml_lsa', 'ml_lsa']);
    assert.deepEqual(exceptions, []);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(failedLoads, []);
    const result = {
      status: 'PASS', browser: await evalPage('navigator.userAgent'), methods, recipe_id: Number(detail),
      fallback_recipe_id: Number(fallback),
      language_checks: ['title', 'ingredients', 'instructions', 'labels'],
      pantry_checks: ['quantity', 'add', 'remove', 'unresolved', 'empty_result'],
      exceptions, externalRequests, failedLoads,
    };
    await writeFile(path.join(evidence, 'browser.json'), JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: 0, method: 'Browser.close' }));
      await Promise.race([browserExit, sleep(3000)]);
    }
    ws?.close();
    if (chrome.exitCode === null && !launchError) chrome.kill();
  }
}

verify().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
