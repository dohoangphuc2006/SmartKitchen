// Frontend VM test for in-modal VI/EN recipe language switch, fallback notices, and zero VI/EN mix.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

class Element {
  constructor(tag = 'div', id = '') {
    this.tag = tag;
    this.id = id;
    this.children = [];
    this.childNodes = [];
    this.events = {};
    this._textContent = '';
    this.style = {};
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.attributes = {};
    this.className = '';
    this.title = '';
    this.nodeType = 1;
    this.classList = {
      _set: new Set(),
      add: (...cls) => cls.forEach(c => this.classList._set.add(c)),
      remove: (...cls) => cls.forEach(c => this.classList._set.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._set.has(c)) this.classList._set.delete(c); else this.classList._set.add(c);
        } else if (force) this.classList._set.add(c); else this.classList._set.delete(c);
      },
      contains: c => this.classList._set.has(c),
    };
  }
  get textContent() { return this._textContent; }
  set textContent(v) {
    this._textContent = String(v ?? '');
    this.childNodes = this._textContent ? [{ nodeType: 3, nodeValue: this._textContent, parentElement: this }] : [];
  }
  append(...items) {
    for (const item of items) {
      if (typeof item === 'string') {
        const tn = { nodeType: 3, nodeValue: item, parentElement: this };
        this.childNodes.push(tn);
        this._textContent += item;
      } else {
        this.children.push(item);
        this.childNodes.push(item);
      }
    }
  }
  replaceChildren(...items) { this.children = []; this.childNodes = []; this._textContent = ''; this.append(...items); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  addEventListener(k, fn) { (this.events[k] ??= []).push(fn); }
  dispatchEvent(ev) { for (const fn of (this.events[ev.type] || [])) fn(ev); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() { this.focused = true; }
}

const i18nSource = fs.readFileSync('frontend/i18n.js', 'utf8');
const appSource = fs.readFileSync('frontend/app.js', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');

async function setup(detailPayload) {
  const elements = new Map();
  const hiddenByDefault = new Set([
    'recipeModal', 'aiModal', 'quickQuantityPopover', 'uploadPanel',
    'methodInfoPanel', 'clearPantryPrompt', 'clearHistoryPrompt', 'resultStatusBanner', 'quantityScopeHint',
  ]);
  const storage = {};
  const sandbox = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: fn => fn(),
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} },
    Event: class { constructor(type) { this.type = type; } },
    document: {
      activeElement: null,
      documentElement: new Element('html', 'html'),
      title: 'Smart Kitchen — Gợi ý món từ ảnh tủ lạnh',
      body: new Element('body', 'body'),
      createTreeWalker: () => ({ nextNode: () => null }),
      getElementById(id) {
        if (!elements.has(id)) {
          const el = new Element('div', id);
          if (hiddenByDefault.has(id)) el.hidden = true;
          elements.set(id, el);
        }
        return elements.get(id);
      },
      createElement: t => new Element(t),
      addEventListener() {},
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
    fetch: async (url) => {
      if (url === '/api/config') {
        return {
          ok: true,
          json: async () => ({
            top_n: 5, max_upload_mb: 10, allowed_extensions: ['jpg'], recipe_first: true,
            ranking_method: 'final',
            localization: { display_policy: 'reviewed_or_source_english', ingredients: {}, recipe_titles: {}, manual_aliases: {}, ambiguous_inputs: [] },
          }),
        };
      }
      if (url === '/api/display-catalog') {
        return { ok: true, json: async () => ({ recipes: {}, coverage: { total_records: 13489, fully_localized_vi: 61, not_fully_localized_vi: 13428 } }) };
      }
      return { ok: true, json: async () => detailPayload };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(i18nSource, sandbox);
  vm.runInContext(appSource, sandbox);
  await new Promise(setImmediate);
  return { elements, sandbox, run: s => vm.runInContext(s, sandbox) };
}

(async () => {
  // Verify HTML contracts for in-modal switcher and simplified UI.
  assert(html.includes('id="modalShowVietnamese"'));
  assert(html.includes('id="modalShowEnglish"'));
  assert(html.includes('id="recipeIngredientFallbackNote"'));
  assert(html.includes('id="recipeInstructionFallbackNote"'));
  assert(!html.includes('id="staplePolicyNote"'));
  assert(!html.includes('EXPERIMENTAL ML'));

  const translatedDetail = {
    success: true,
    recipe_id: 417,
    recipe_name: 'Tomato-and-Egg Stir-Fry',
    ingredients: ['4 large eggs', '1 tablespoon oil'],
    instructions: 'Beat eggs.\nCook tomatoes.',
    instruction_steps: ['Beat eggs.', 'Cook tomatoes.'],
    language: 'en',
    translations: {
      vi: {
        recipe_name: 'Trứng xào cà chua',
        recipe_name_review_status: 'auto_unreviewed',
        recipe_name_display_eligible: true,
        ingredients: ['4 quả trứng cỡ lớn', '1 muỗng canh dầu ăn'],
        ingredients_review_status: 'auto_unreviewed',
        instructions: 'Đánh tan trứng.\nXào cà chua.',
        instruction_steps: ['Đánh tan trứng.', 'Xào cà chua.'],
        instructions_review_status: 'auto_unreviewed',
      },
    },
    source: { dataset_name: 'Epicurious', original_content_source: 'dataset', license: 'CC', dataset_url: 'https://example.com' },
  };

  const s = await setup(translatedDetail);
  await s.run('openRecipeDetail({ recipe_id: 417 }, null)');

  // Default VI mode shows Vietnamese title, ingredients, and instructions.
  assert.equal(s.elements.get('recipeDetailTitle').textContent, 'Trứng xào cà chua');
  assert.equal(s.elements.get('recipeIngredientsTitle').textContent, 'Nguyên liệu tiếng Việt');
  assert.equal(s.elements.get('recipeIngredientList').children[0].textContent, '4 quả trứng cỡ lớn');
  assert.equal(s.elements.get('recipeInstructionsTitle').textContent, 'Hướng dẫn tiếng Việt');
  assert.equal(s.elements.get('recipeStepText').textContent, 'Đánh tan trứng.');
  assert.equal(s.elements.get('recipeStepIndicator').textContent, 'Bước 1/2');
  assert.equal(s.elements.get('recipeIngredientFallbackNote').hidden, true);
  assert.equal(s.elements.get('recipeInstructionFallbackNote').hidden, true);
  assert.equal(s.elements.get('modalShowVietnamese').getAttribute('aria-pressed'), 'true');
  assert.equal(s.elements.get('modalShowEnglish').getAttribute('aria-pressed'), 'false');

  // Switch inside modal to English -> clean original English without VI remnants.
  s.elements.get('modalShowEnglish').events.click[0]();
  assert.equal(s.elements.get('recipeDetailTitle').textContent, 'Tomato-and-Egg Stir-Fry');
  assert.equal(s.elements.get('recipeOriginalTitle').hidden, true);
  assert.equal(s.elements.get('recipeTranslationNote').hidden, true);
  assert.equal(s.elements.get('recipeIngredientsTitle').textContent, 'Ingredients');
  assert.equal(s.elements.get('recipeIngredientList').children[0].textContent, '4 large eggs');
  assert.equal(s.elements.get('recipeInstructionsTitle').textContent, 'Instructions');
  assert.equal(s.elements.get('recipeStepText').textContent, 'Beat eggs.');
  assert.equal(s.elements.get('recipeStepIndicator').textContent, 'Step 1/2');
  assert.equal(s.elements.get('recipeLanguageBadge').textContent, 'EN');
  assert.equal(s.elements.get('modalShowVietnamese').getAttribute('aria-pressed'), 'false');
  assert.equal(s.elements.get('modalShowEnglish').getAttribute('aria-pressed'), 'true');

  // Switch back inside modal to Vietnamese.
  s.elements.get('modalShowVietnamese').events.click[0]();
  assert.equal(s.elements.get('recipeDetailTitle').textContent, 'Trứng xào cà chua');
  assert.equal(s.elements.get('recipeStepIndicator').textContent, 'Bước 1/2');

  // Untranslated recipe in VI mode keeps English fallback with clear fallback notice while leaving #recipeInstructionStatus clean.
  const untranslatedDetail = {
    success: true,
    recipe_id: 9999,
    recipe_name: 'Simple Broth',
    ingredients: ['1 cup water'],
    instructions: 'Boil water.',
    instruction_steps: ['Boil water.'],
    language: 'en',
    translations: {
      vi: {
        recipe_name: null,
        recipe_name_review_status: 'untranslated',
        recipe_name_display_eligible: false,
        ingredients: null,
        ingredients_review_status: 'untranslated',
        instructions: null,
        instruction_steps: [],
        instructions_review_status: 'untranslated',
      },
    },
    source: { dataset_name: 'Epicurious', original_content_source: 'dataset', license: 'CC', dataset_url: 'https://example.com' },
  };
  const s2 = await setup(untranslatedDetail);
  await s2.run('openRecipeDetail({ recipe_id: 9999 }, null)');
  assert.equal(s2.elements.get('recipeIngredientFallbackNote').hidden, false);
  assert.match(s2.elements.get('recipeIngredientFallbackNote').textContent, /Chưa có bản dịch tiếng Việt/);
  assert.equal(s2.elements.get('recipeInstructionFallbackNote').hidden, false);
  assert.match(s2.elements.get('recipeInstructionFallbackNote').textContent, /Chưa có bản dịch tiếng Việt/);
  assert.equal(s2.elements.get('recipeInstructionStatus').hidden, true);
  assert.equal(s2.elements.get('recipeInstructionsTitle').textContent, 'Hướng dẫn gốc (English)');

  console.log('PASS in-modal recipe language switch VI/EN, fallback notices, and UI consistency');
})().catch(error => { console.error(error); process.exitCode = 1; });
