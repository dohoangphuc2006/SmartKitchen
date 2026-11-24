// Drive a real Chromium page through its local DevTools connection.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

const [browser, url, profile, evidence, imagePath] = process.argv.slice(2);

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
  await mkdir(evidence, { recursive: true });
  const chrome = spawn(browser, [
    '--headless', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--remote-debugging-port=0', '--disable-background-networking',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--window-size=1365,1050', '--user-data-dir=' + path.resolve(profile), 'about:blank',
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
        failedLoads.push({url: message.params.response.url, status: message.params.response.status});
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
    await waitFor('typeof appConfig !== "undefined" && appConfig?.image_detection_available === true', 'YOLO configuration');
    assert(await evalPage('!document.querySelector("#openUploadBtn").hidden && !document.querySelector("#openCameraBtn").hidden'));
    assert.match(await evalPage('document.querySelector("#visionDevelopmentNotice").textContent'), /Thử nghiệm/);
    await screenshot('vision-home.png');

    await click('#openUploadBtn');
    const dom = await send('DOM.getDocument');
    const input = await send('DOM.querySelector', {nodeId: dom.root.nodeId, selector: '#imageInput'});
    await send('DOM.setFileInputFiles', {nodeId: input.nodeId, files: [path.resolve(imagePath)]});
    await waitFor('selectedFile && !document.querySelector("#analyzeButton").disabled', 'uploaded image ready');
    await click('#analyzeButton');
    await waitFor('lastDetectionAudit && !isLoading', 'real YOLO image analysis');
    const imageAudit = await evalPage('({filename: analyzedFilename, boxes: lastDetectionAudit.boxes?.length || 0, candidates: reviewCandidates().length, pantry: pantry.length})');
    assert.equal(imageAudit.pantry, 0, 'Detection must wait for human ingredient review');
    await screenshot('vision-image.png');
    if (await evalPage('Boolean(document.querySelector("#guardReviewCandidates button"))')) {
      await click('#guardReviewCandidates button');
      assert(await evalPage('pantry.length > 0'));
      await click('.chip-remove');
    }
    await add('trứng, cà chua, hành lá');
    await waitFor('pantry.length === 3', 'manual correction');
    await click('#recommendButton');
    await waitFor('!isLoading && document.querySelectorAll(".recipe-detail-button").length > 0', 'confirmed recommendation');
    await click('.recipe-detail-button');
    await waitFor('!document.querySelector("#recipeDetailContent").hidden && Boolean(document.querySelector("#recipeStepText").textContent.trim())', 'recipe detail');
    await click('#closeRecipeModal');
    await click('#recipeShowEnglish');
    assert.match(await evalPage('document.querySelector("#visionDevelopmentNotice").textContent'), /Experimental/);
    await click('#recipeShowVietnamese');
    await screenshot('vision-recommendations.png');

    await click('#openCameraBtn');
    await waitFor('cameraController?.ready', 'fake webcam ready');
    await waitFor('lastLiveMetrics?.completed > 0', 'real YOLO live frame');
    const live = await evalPage('({completed: lastLiveMetrics.completed, inference_ms: lastLiveMetrics.inference_ms})');
    await screenshot('vision-webcam.png');
    await click('#captureCamera');
    await waitFor('!isLoading && analyzedFilename?.startsWith("camera-")', 'capture and actual YOLO analysis');
    assert(await evalPage('cameraController.state === "idle" && document.querySelector("#cameraVideo").srcObject === null'));
    assert(await evalPage('!document.querySelector("#uploadPanel").hidden'));
    await click('#openCameraBtn');
    await waitFor('cameraController?.ready', 'webcam restart');
    await click('#stopCamera');
    assert(await evalPage('cameraController.state === "idle" && document.querySelector("#cameraVideo").srcObject === null'));
    await click('#closeAiModal');

    // Exercise permission and absent-device failures without accessing a physical camera.
    for (const name of ['NotAllowedError', 'NotFoundError']) {
      await evalPage('cameraController.mediaDevices = {getUserMedia: async () => {throw new DOMException("test", '+JSON.stringify(name)+')}}');
      await click('#openCameraBtn');
      await waitFor('cameraController.state === "idle" && !document.querySelector("#cameraNotice").hidden', name);
      assert(await evalPage('Boolean(document.querySelector("#cameraNotice").textContent.trim())'));
      await click('#closeAiModal');
    }
    assert.deepEqual(exceptions, []);
    assert.deepEqual(failedLoads.filter(r => !(r.url.endsWith('/api/detect-frame') && r.status === 429)), []);
    const result = {
      status: 'PASS', camera: 'Chrome fake device; no physical webcam validation', real_yolo: true,
      image: imageAudit, live,
      checks: ['visible image and webcam buttons', 'development notice VI/EN', 'image upload and real YOLO',
        'review before pantry insertion', 'manual correction and confirmed recommendation', 'recipe detail',
        'fake webcam live inference', 'capture and analyze', 'stop and restart', 'permission denied', 'no camera'],
      exceptions, failedLoads,
    };
    await writeFile(path.join(evidence, 'vision-browser.json'), JSON.stringify(result, null, 2) + '\n');
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
