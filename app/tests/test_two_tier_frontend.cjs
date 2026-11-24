// Frontend tests for Two-Tier display + opt-in confirmed staples (all unchecked by default).
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

class Element {
  constructor(tag = 'div', attrs = {}) {
    this.tag = tag;
    this.children = [];
    this.events = {};
    this.textContent = '';
    this.style = {};
    this.value = attrs.value || '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.attributes = { ...attrs };
    this.className = '';
    this.title = '';
    this.parentElement = null;
    this.classList = {
      _set: new Set(),
      add: (...cls) => cls.forEach(c => this.classList._set.add(c)),
      remove: (...cls) => cls.forEach(c => this.classList._set.delete(c)),
      toggle: (cls, force) => {
        const shouldAdd = typeof force === 'boolean' ? force : !this.classList._set.has(cls);
        if (shouldAdd) this.classList._set.add(cls);
        else this.classList._set.delete(cls);
        return shouldAdd;
      },
      contains: c => this.classList._set.has(c),
    };
  }
  append(...items) {
    for (const item of items) {
      if (item && typeof item === 'object') item.parentElement = this;
      this.children.push(item);
    }
  }
  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  addEventListener(k, fn) { (this.events[k] ??= []).push(fn); }
  querySelector(sel) {
    if (sel === '.staple-check-label') return this.labelEl || null;
    return this.button ||= new Element('button');
  }
  querySelectorAll(sel) {
    if (sel === '.staple-checkbox') return this._checkboxes || [];
    return [];
  }
  focus() {}
}

const source = fs.readFileSync('frontend/app.js', 'utf8');
const catalogData = JSON.parse(fs.readFileSync('config/pantry_ingredient_catalog.json', 'utf8'));
const overrideData = JSON.parse(fs.readFileSync('config/pantry_alias_overrides_v1.json', 'utf8'));
const viIngredients = JSON.parse(fs.readFileSync('config/ingredient_display_vi.json', 'utf8'));

async function setup(captureRequests, mockTwoTierResponse) {
  const elements = new Map();
  const storage = {};

  // Build realistic confirmedStaplesList checkboxes (unchecked by default)
  const stapleListEl = new Element('div');
  const stapleSpecs = [
    ['water', 'Nước', 'Water'],
    ['salt', 'Muối', 'Salt'],
    ['pepper', 'Tiêu', 'Pepper'],
    ['vegetable oil', 'Dầu ăn', 'Cooking oil'],
    ['olive oil', 'Dầu ô liu', 'Olive oil'],
  ];
  stapleListEl._checkboxes = stapleSpecs.map(([val, vi, en]) => {
    const label = new Element('label');
    const cb = new Element('input', { 'data-vi': vi, 'data-en': en, value: val });
    const span = new Element('span');
    span.textContent = vi;
    label.labelEl = span;
    cb.parentElement = label;
    label.append(cb, span);
    return cb;
  });
  elements.set('confirmedStaplesList', stapleListEl);

  const sandbox = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    Event: class { constructor(type) { this.type = type; } },
    document: {
      activeElement: null,
      documentElement: new Element('html'),
      body: new Element('body'),
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
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
    window: { scrollY: 0, scrollTo() {}, addEventListener() {} },
    fetch: async (url, opts) => {
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
              ingredients: { ...viIngredients, ...catalogData.display_variants_en },
              recipe_titles: {},
              manual_aliases: { ...catalogData.pantry_aliases, ...overrideData.pantry_aliases },
              ambiguous_inputs: ['bột mì đa dụng', 'đường bột'],
              pantry_catalog: {
                version: catalogData.version,
                total_items: catalogData.total_items,
                categories: catalogData.categories,
                items: catalogData.items,
                ambiguous_concepts: catalogData.ambiguous_concepts,
              },
            },
          }),
        };
      }
      if (url === '/api/display-catalog') return { ok: false };
      if (url === '/api/recommend') {
        captureRequests.push(JSON.parse(opts.body));
        return { ok: true, json: async () => mockTwoTierResponse };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return { elements, sandbox, run: s => vm.runInContext(s, sandbox) };
}

(async () => {
  const requests = [];
  const mockResponse = {
    success: true,
    ranking_method: 'ml_tfidf',
    model_version: 'recipe_tfidf_lsa_v1',
    artifact_sha256: '3'.repeat(64),
    two_tier: true,
    ingredients: ['ground pork', 'salt'],
    confirmed_staples: ['salt'],
    recommendations: [],
    tier_a_recommendations: [],
    tier_b_recommendations: [
      {
        recipe_id: 6236,
        recipe_name: 'Homemade Fresh Chorizo',
        score: 0.45,
        match_ratio: 0.2,
        matched_ingredients: ['ground pork'],
        missing_ingredients: ['garlic', 'oregano', 'paprika', 'vinegar'],
        matched_count: 1,
        missing_count: 4,
        missing_required_count: 4,
        matched_core_count: 1,
        passes_baseline_25pct: false,
        readiness_status: 'NEEDS_ADDITIONAL_INGREDIENTS',
        suggestion_status: 'needs_ingredients',
        missing_core_ingredients: [],
        quantity_status: 'not_checked',
      },
    ],
    tier_summary: {
      basis_status: 'PARTIAL_UNRESOLVED_INPUT',
      basis_notice_vi: 'Lưu ý phạm vi: các nguyên liệu chưa có trong từ điển (cá lóc) không tạo bằng chứng khớp giả.',
    },
    warnings: [],
    timing_ms: { request: 12 },
  };

  const s = await setup(requests, mockResponse);
  const cbs = s.elements.get('confirmedStaplesList')._checkboxes;

  // 1. All 5 staple checkboxes start UNCHECKED and pantry is NOT mutated
  assert.equal(cbs.every(cb => cb.checked === false), true);
  assert.deepEqual(Array.from(s.run('getConfirmedStaples()')), []);
  assert.equal(s.run('pantry.length'), 0);

  // 2. Add ground pork & check Salt + Water without mutating pantry array
  const input = s.elements.get('ingredientInput');
  const form = s.elements.get('addIngredientForm');
  input.value = 'thịt heo xay';
  form.events.submit.forEach(fn => fn({ preventDefault() {} }));
  assert.equal(s.run('pantry.length'), 1);

  cbs[0].checked = true; // water
  cbs[0].events.change.forEach(fn => fn());
  cbs[1].checked = true; // salt
  cbs[1].events.change.forEach(fn => fn());

  assert.equal(s.run('pantry.length'), 1); // User's manual pantry stays untouched!
  assert.deepEqual(Array.from(s.run('getConfirmedStaples()')), ['salt', 'water']);
  assert.equal(s.elements.get('confirmedStaplesCount').textContent, 'Đã chọn 2');

  // 3. Click recommend -> sends two_tier: true & confirmed_staples
  await s.elements.get('recommendButton').events.click[0]();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].two_tier, true);
  assert.deepEqual(requests[0].ingredients, ['ground pork']);
  assert.deepEqual(requests[0].confirmed_staples, ['salt', 'water']);

  // 4. Two-Tier DOM renders Tier A + Tier B headers & <25% badge cleanly
  const listChildren = s.elements.get('recipeList').children;
  const allTexts = listChildren.flatMap(el => [el.textContent, ...(el.children || []).flatMap(c => [c.textContent, ...(c.children || []).map(x => x.textContent)])]);
  assert(allTexts.some(t => t.includes('Tầng A · Có thể nấu ngay (CAN_COOK_NOW)')));
  assert(allTexts.some(t => t.includes('Tầng B · Cần bổ sung nguyên liệu')));
  assert(allTexts.some(t => t.includes('Cần mua thêm 4 nguyên liệu')));
  assert(allTexts.some(t => t.includes('Khớp < 25% · Gợi ý mở rộng')));
  assert(allTexts.some(t => t.includes('Khớp nguyên liệu chính')));
  assert(allTexts.some(t => t.includes('Lưu ý phạm vi: các nguyên liệu chưa có trong từ điển (cá lóc)')));

  // An equipment requirement alone must not render a zero-ingredient shopping prompt.
  s.sandbox.equipmentOnly = {
    ...mockResponse.tier_b_recommendations[0],
    missing_ingredients: [],
    missing_required_count: 0,
    required_equipment: ['steamer basket'],
  };
  const equipmentCard = s.run('_buildRecipeCard(equipmentOnly, 0, false, "B", true)');
  const descendants = element => [element.textContent, ...element.children.flatMap(descendants)];
  const equipmentTexts = descendants(equipmentCard);
  assert(equipmentTexts.some(text => text.includes('Kiểm tra dụng cụ: steamer basket')));
  assert(!equipmentTexts.some(text => text.includes('Cần mua thêm 0') || text === 'Cần bổ sung nguyên liệu'));

  // 5. Clear pantry resets confirmedStaples too
  s.elements.get('confirmClearPantry').events.click.forEach(fn => fn());
  assert.deepEqual(Array.from(s.run('getConfirmedStaples()')), []);
  assert.equal(cbs.every(cb => cb.checked === false), true);

  console.log('PASS all 5 Two-Tier & Confirmed-Staples UI tests');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
