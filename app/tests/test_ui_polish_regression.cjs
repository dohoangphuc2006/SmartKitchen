// DOM/VM regression tests for Tasks A-E (Final UI/UX Polish). No live server or model inference.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.events = {};
    this.textContent = '';
    this.style = {};
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.attributes = {};
    this.className = '';
    this.title = '';
    this.classList = {
      _set: new Set(),
      add: (...cls) => cls.forEach(c => this.classList._set.add(c)),
      remove: (...cls) => cls.forEach(c => this.classList._set.delete(c)),
      contains: c => this.classList._set.has(c),
    };
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  addEventListener(k, fn) { (this.events[k] ??= []).push(fn); }
  dispatchEvent(ev) {
    for (const fn of (this.events[ev.type] || [])) fn(ev);
  }
  querySelector() { return this.button ||= new Element('button'); }
  querySelectorAll() { return []; }
  focus() { this.focused = true; }
}

const source = fs.readFileSync('frontend/app.js', 'utf8');
const viIngredients = JSON.parse(fs.readFileSync('config/ingredient_display_vi.json', 'utf8'));

async function setup({ recommendHandler, seedStorage = {} } = {}) {
  const elements = new Map();
  const hiddenByDefault = new Set([
    'recipeModal', 'aiModal', 'quickQuantityPopover', 'uploadPanel',
    'methodInfoPanel', 'clearPantryPrompt', 'clearHistoryPrompt', 'resultStatusBanner', 'quantityScopeHint',
  ]);
  const storage = { ...seedStorage };
  const requests = [];
  const documentEvents = {};
  const sandbox = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    Event: class { constructor(type) { this.type = type; } },
    document: {
      activeElement: null,
      getElementById(id) {
        if (!elements.has(id)) {
          const el = new Element();
          if (hiddenByDefault.has(id)) el.hidden = true;
          elements.set(id, el);
        }
        return elements.get(id);
      },
      createElement: t => new Element(t),
      addEventListener(k, fn) { (documentEvents[k] ??= []).push(fn); },
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; },
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    FormData: class { append() {} },
    window: { addEventListener() {} },
    fetch: async (url, opts) => {
      requests.push({ url, opts });
      if (url === '/api/config') {
        return {
          ok: true,
          json: async () => ({
            top_n: 5,
            max_upload_mb: 10,
            allowed_extensions: ['jpg'],
            recipe_first: true,
            ranking_method: 'final',
            localization: {
              display_policy: 'reviewed_or_source_english',
              ingredients: viIngredients,
              recipe_titles: {},
              manual_aliases: { 'cà chua': 'tomato', 'tỏi': 'garlic', 'hành lá': 'green onion' },
              ambiguous_inputs: [],
            },
          }),
        };
      }
      if (url === '/api/display-catalog') {
        return { ok: false };
      }
      if (url.startsWith('/api/recommend') && recommendHandler) {
        return recommendHandler(opts);
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          recipe_id: 99,
          recipe_name: 'Mock Garlic Pasta',
          ingredients: ['2 cloves garlic', '1 pinch kosher salt', 'parmesan cheese'],
          instructions: 'Step 1\nStep 2',
          instruction_steps: ['Step 1', 'Step 2'],
          language: 'en',
          translations: {
            vi: {
              recipe_name: 'Mì Ý tỏi dịch máy',
              recipe_name_review_status: 'auto_unreviewed',
              recipe_name_display_eligible: true,
              ingredients: ['2 tép tỏi dịch máy', '1 nhúm muối kosher', 'phô mai parmesan'],
              ingredients_review_status: 'auto_unreviewed',
              instructions: null,
              instruction_steps: [],
              instructions_review_status: 'untranslated',
            },
          },
          source: {
            dataset_name: 'Fixture',
            publisher: 'Pub',
            original_content_source: 'Src',
            dataset_url: 'https://example.test',
            license: 'CC',
            license_url: 'https://example.test/lic',
            revision: '1',
            source_level: 'dataset',
          },
        }),
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return { elements, storage, requests, documentEvents, run: s => vm.runInContext(s, sandbox), sandbox };
}

(async () => {
  const results = [];
  async function runCase(name, fn) {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS', name);
  }

  await runCase('Task A: removed redundant EN instruction notice & auto_unreviewed stays explicitly labeled', async () => {
    const s = await setup();
    await s.run('openRecipeDetail({recipe_id:99}, null)');
    assert.equal(s.elements.get('recipeInstructionsTitle').textContent, 'Hướng dẫn gốc (English)');
    assert.equal(s.elements.get('recipeLanguageBadge').textContent, 'EN');
    assert.equal(s.elements.get('recipeInstructionStatus').hidden, true);
    assert.equal(s.elements.get('recipeInstructionStatus').textContent, '');
    assert.equal(s.elements.get('recipeIngredientStatus').textContent, 'Dịch tự động');
    assert.equal(s.elements.get('recipeIngredientStatus').hidden, false);
    assert.match(s.elements.get('recipeTranslationNote').textContent, /Dịch tự động/);
    assert(!source.includes('Chưa có bản dịch hướng dẫn đáng tin cậy; đang hiển thị nguyên bản tiếng Anh.'));
  });

  await runCase('Task B & C: match bar clarifies ingredient types, quantity kept in pantry & excluded from API body', async () => {
    let postedBody = null;
    const s = await setup({
      recommendHandler: async opts => {
        postedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            success: true,
            ranking_method: 'ml_tfidf',
            recommendations: [{
              recipe_id: 10,
              recipe_name: 'Tomato Garlic Soup',
              match_ratio: 0.4,
              matched_ingredients: ['tomato', 'garlic'],
              missing_ingredients: ['black pepper', 'parmesan cheese', 'daikon'],
              quantity_status: 'not_checked',
            }],
            warnings: [],
            timing_ms: { request: 12 },
          }),
        };
      },
    });
    s.elements.get('ingredientInput').value = '3 quả cà chua, 3 tép tỏi, 2 nhánh hành lá';
    await Promise.all(s.elements.get('addIngredientForm').events.submit.map(fn => fn({ preventDefault() {} })));
    assert.equal(s.run('pantry.length'), 3);
    assert.equal(s.run('pantry[0].quantity'), '3 quả');
    assert.equal(s.run('pantry[1].quantity'), '3 tép');
    assert.equal(s.run('pantry[2].quantity'), '2 nhánh');
    assert.equal(s.elements.get('quantityScopeHint').hidden, false);
    await Promise.all(s.elements.get('recommendButton').events.click.map(fn => fn()));
    assert.deepEqual(postedBody.ingredients, ['tomato', 'garlic', 'green onion']);
    assert.equal('quantity' in postedBody, false);
    const card = s.elements.get('recipeList').children[0];
    assert.equal(card.children[1].children[0].textContent, 'Khớp loại nguyên liệu: 2/5');
    assert.equal(card.children[1].children[1].textContent, '40%');
    // Missing untranslated items stay tagged [EN: ...]
    const missingText = card.children[3].children[1].children[1].textContent;
    assert(missingText.includes('[EN: black pepper]'));
    assert(missingText.includes('[EN: parmesan cheese]'));
  });

  await runCase('Task C.5: History saves & restores quantities on empty pantry, and asks before overwriting non-empty pantry', async () => {
    const s = await setup({
      recommendHandler: async () => ({
        ok: true,
        json: async () => ({
          success: true,
          ranking_method: 'final',
          recommendations: [{ recipe_id: 1, recipe_name: 'Test Dish', match_ratio: 0.5, matched_ingredients: ['tomato'], missing_ingredients: ['onion'] }],
          warnings: [],
          timing_ms: { request: 5 },
        }),
      }),
    });
    s.elements.get('ingredientInput').value = '3 quả cà chua, 3 tép tỏi';
    s.elements.get('addIngredientForm').events.submit.forEach(fn => fn({ preventDefault() {} }));
    await Promise.all(s.elements.get('recommendButton').events.click.map(fn => fn()));

    const savedHist = JSON.parse(s.storage.smart_kitchen_history);
    assert.equal(savedHist.length, 1);
    assert.equal(savedHist[0].pantry_items[0].quantity, '3 quả');
    assert.equal(savedHist[0].pantry_items[1].quantity, '3 tép');

    // Clear pantry then restore from history -> preserves quantity cleanly
    s.run('pantry = []; renderPantry()');
    const histCard = s.elements.get('historyList').children[0];
    const restoreBtn = histCard.children[5];
    restoreBtn.events.click.forEach(fn => fn());
    assert.equal(s.run('pantry.length'), 2);
    assert.equal(s.run('pantry[0].quantity'), '3 quả');
    assert.equal(s.run('pantry[1].quantity'), '3 tép');

    // Add an extra item to pantry so pantry is non-empty; restore button must NOT silently overwrite
    s.elements.get('ingredientInput').value = '2 nhánh hành lá';
    s.elements.get('addIngredientForm').events.submit.forEach(fn => fn({ preventDefault() {} }));
    assert.equal(s.run('pantry.length'), 3);
    const updatedCard = s.elements.get('historyList').children[0];
    const updatedRestoreBtn = updatedCard.children[5];
    const restorePrompt = updatedCard.children[6];
    updatedRestoreBtn.events.click.forEach(fn => fn());
    assert.equal(restorePrompt.hidden, false);
    assert.equal(s.run('pantry.length'), 3); // Not overwritten!
  });

  await runCase('Task E: recommend loading/error banner inside #recipesSection & keyboard chip edit + Escape', async () => {
    const s = await setup({
      recommendHandler: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ success: false, message: 'Server error' }),
      }),
    });
    s.elements.get('ingredientInput').value = '3 quả cà chua';
    s.elements.get('addIngredientForm').events.submit.forEach(fn => fn({ preventDefault() {} }));
    const chipLabel = s.elements.get('ingredientList').children[0].children[0];
    assert.equal(chipLabel.getAttribute('tabindex'), '0');
    assert.equal(chipLabel.getAttribute('role'), 'button');

    // Recommend fails -> banner shows error while pantry stays preserved
    await Promise.all(s.elements.get('recommendButton').events.click.map(fn => fn()));
    assert.equal(s.elements.get('resultStatusBanner').hidden, false);
    assert.equal(s.elements.get('resultStatusBanner').getAttribute('data-kind'), 'error');
    assert.match(s.elements.get('resultStatusBanner').textContent, /Chưa cập nhật gợi ý/);
    assert.equal(s.run('pantry.length'), 1);

    // Keyboard Enter on chip pops it into input cleanly
    chipLabel.events.keydown.forEach(fn => fn({ key: 'Enter', preventDefault() {} }));
    assert.equal(s.run('pantry.length'), 0);
    assert.equal(s.elements.get('ingredientInput').value, '3 quả cà chua');

    // Opening uploadPanel then pressing Escape closes it cleanly
    s.run('toggleInlineImagePanel(true)');
    assert.equal(s.elements.get('uploadPanel').hidden, false);
    s.documentEvents.keydown.forEach(fn => fn({ key: 'Escape' }));
    assert.equal(s.elements.get('uploadPanel').hidden, true);
  });

  fs.mkdirSync('reports/ui_polish_20261113', { recursive: true });
  fs.writeFileSync('reports/ui_polish_20261113/ui_polish_regression.json', JSON.stringify({ total: results.length, passed: results.length, results }, null, 2));
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
