// Regression tests for frontend audit fixes: autocomplete catalog resolution,
// comma-safe English alias preservation, readiness labels, and empty-state explanation.
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
      toggle: (cls, force) => {
        const shouldAdd = typeof force === 'boolean' ? force : !this.classList._set.has(cls);
        if (shouldAdd) this.classList._set.add(cls);
        else this.classList._set.delete(cls);
        return shouldAdd;
      },
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
  querySelector() { return this.button ||= new Element('button'); }
  querySelectorAll() { return []; }
  focus() {}
}

const source = fs.readFileSync('frontend/app.js', 'utf8');
const catalogData = JSON.parse(fs.readFileSync('config/pantry_ingredient_catalog.json', 'utf8'));
const overrideData = JSON.parse(fs.readFileSync('config/pantry_alias_overrides_v1.json', 'utf8'));
const viIngredients = JSON.parse(fs.readFileSync('config/ingredient_display_vi.json', 'utf8'));

async function setup(mockRecommendResponse = null) {
  const elements = new Map();
  const storage = {};
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
    fetch: async (url) => {
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
      if (url === '/api/recommend' && mockRecommendResponse) {
        return { ok: true, json: async () => mockRecommendResponse };
      }
      return {
        ok: true,
        json: async () => ({ success: true, ranking_method: 'final', recommendations: [], warnings: [], timing_ms: { request: 5 } }),
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return { elements, sandbox, run: s => vm.runInContext(s, sandbox) };
}

(async () => {
  // 1. Autocomplete resolves bột mì đa dụng & đường bột via canonical_name without being blocked
  {
    const s = await setup();
    const input = s.elements.get('ingredientInput');
    const dropdown = s.elements.get('ingredientAutocomplete');
    input.value = 'đường bột';
    input.events.input.forEach(fn => fn());
    assert.equal(dropdown.hidden, false);
    const opt = dropdown.children.find(c => c.getAttribute('data-canonical') === 'powdered sugar');
    assert(opt, 'Expected powdered sugar in autocomplete');
    opt.events.click.forEach(fn => fn());
    assert.equal(s.run('pantry.length'), 1);
    assert.equal(s.run('pantry[0].name'), 'powdered sugar');
  }

  // 2. Comma-containing known English ingredient is not split into fragments
  {
    const s = await setup();
    const input = s.elements.get('ingredientInput');
    const form = s.elements.get('addIngredientForm');
    input.value = 'shrimp, peeled, deveined';
    form.events.submit.forEach(fn => fn({ preventDefault() {} }));
    assert.equal(s.run('pantry.length'), 1);
    assert.equal(s.run('pantry[0].name'), 'shrimp peeled deveined');
  }

  // 3. tôm bóc vỏ maps to shrimp peeled deveined
  {
    const s = await setup();
    const parsed = s.run('parseManualInputSegment("tôm bóc vỏ")');
    assert.equal(parsed.name, 'shrimp peeled deveined');
    assert.equal(parsed.unrecognized, false);
  }

  // 4. Empty state uses empty_detail explanation from API instead of static generic message
  {
    const s = await setup({
      success: true,
      ranking_method: 'ml_tfidf',
      ingredients: ['chicken breast'],
      recommendations: [],
      warnings: ['Không có công thức đạt điều kiện lọc chung (số nguyên liệu khớp / tỉ lệ khớp).'],
      empty_reason: 'NO_CANDIDATE_PASSED_ELIGIBILITY',
      empty_detail: {
        candidate_count: 2,
        qualified_count: 0,
        pantry_group_count: 1,
        unresolved_count: 0,
        explanation_vi: 'Giải thích cụ thể: tìm thấy 2 công thức nhưng đều thiếu nhiều nguyên liệu chính.',
        explanation_en: 'Specific explanation: found 2 recipes missing other core ingredients.',
      },
      timing_ms: { request: 4 },
    });
    const input = s.elements.get('ingredientInput');
    const form = s.elements.get('addIngredientForm');
    input.value = 'ức gà';
    form.events.submit.forEach(fn => fn({ preventDefault() {} }));
    await s.elements.get('recommendButton').events.click[0]();
    const emptyCard = s.elements.get('recipeList').children[0];
    const texts = emptyCard.children.map(c => c.textContent);
    assert(texts.some(t => t.includes('Giải thích cụ thể: tìm thấy 2 công thức')));
  }

  // 5. Readiness badges differentiate CAN_COOK_NOW vs NEEDS_ADDITIONAL_INGREDIENTS
  {
    const s = await setup({
      success: true,
      ranking_method: 'final',
      ingredients: ['egg', 'chicken breast'],
      recommendations: [
        {
          recipe_id: 767,
          recipe_name: 'Big-Batch Hard-Boiled Eggs',
          score: 0.9,
          match_ratio: 1.0,
          matched_ingredients: ['egg'],
          missing_ingredients: [],
          matched_count: 1,
          missing_count: 0,
          suggestion_status: 'pantry_match',
          readiness_status: 'CAN_COOK_NOW',
          missing_core_ingredients: [],
          quantity_status: 'not_checked',
        },
        {
          recipe_id: 7085,
          recipe_name: 'Perfect Pan-Roasted Chicken Thighs',
          score: 0.4,
          match_ratio: 0.25,
          matched_ingredients: ['bone-in skin-on chicken thigh'],
          missing_ingredients: ['kosher salt'],
          matched_count: 1,
          missing_count: 1,
          suggestion_status: 'needs_ingredients',
          readiness_status: 'NEEDS_ADDITIONAL_INGREDIENTS',
          missing_core_ingredients: [],
          quantity_status: 'not_checked',
        },
      ],
      warnings: [],
      timing_ms: { request: 5 },
    });
    const input = s.elements.get('ingredientInput');
    const form = s.elements.get('addIngredientForm');
    input.value = 'trứng';
    form.events.submit.forEach(fn => fn({ preventDefault() {} }));
    await s.elements.get('recommendButton').events.click[0]();
    const cards = s.elements.get('recipeList').children;
    assert.equal(cards.length, 2);
    assert(cards[0].children.some(c => c.textContent.includes('Có thể nấu với nguyên liệu đã liệt kê')));
    assert(cards[1].children.some(c => c.textContent.includes('Cần bổ sung nguyên liệu')));
    assert.equal(fs.readFileSync('frontend/index.html', 'utf8').includes('staplePolicyNote'), false);
    assert.equal(s.elements.has('staplePolicyNote'), false);
  }

  // 6. Yellow experimental ML badge and technical jargon are removed from HTML/JS/CSS without breaking rankingBasis or radio values
  {
    const htmlSource = fs.readFileSync('frontend/index.html', 'utf8');
    const cssSource = fs.readFileSync('frontend/style.css', 'utf8');
    const i18nSource = fs.readFileSync('frontend/i18n.js', 'utf8');
    for (const forbidden of [
      'EXPERIMENTAL ML', 'NOT HUMAN-VALIDATED', 'method-experimental-badge',
      'method-card-desc', 'Stage 5', 'Rule-based', 'TF-IDF', 'TF\u2011IDF',
      'TruncatedSVD', '100 chiều', 'QUALITY_FLAGGED', 'MODEL_SELECTION_NOT_ESTABLISHED',
    ]) {
      assert.equal(htmlSource.includes(forbidden), false, `html still has ${forbidden}`);
      assert.equal(cssSource.includes(forbidden), false, `css still has ${forbidden}`);
      assert.equal(i18nSource.includes(forbidden), false, `i18n still has ${forbidden}`);
    }
    assert.equal(source.includes('EXPERIMENTAL ML'), false);
    assert.equal(source.includes('NOT HUMAN-VALIDATED'), false);
    assert.equal(source.includes('Stage 5'), false);
    assert.equal(source.includes('TruncatedSVD'), false);
    assert.equal(source.includes('TF\u2011IDF'), false);

    assert(htmlSource.includes('value="final"'));
    assert(htmlSource.includes('value="ml_tfidf"'));
    assert(htmlSource.includes('value="ml_lsa"'));
    assert(htmlSource.includes('Mặc định (khuyên dùng)'));
    assert(htmlSource.includes('Theo nguyên liệu tương đồng'));
    assert(htmlSource.includes('Khám phá món liên quan'));

    const s = await setup();
    s.run("appConfig.ranking_method = 'ml_tfidf'; refreshGlobalLanguage('vi');");
    assert.equal(s.elements.get('rankingBasis').textContent, 'Tìm món có nguyên liệu gần giống');
    s.run("appConfig.ranking_method = 'ml_lsa'; refreshGlobalLanguage('en');");
    assert.equal(s.elements.get('rankingBasis').textContent, 'Suggests additional related recipes');
  }

  // 7. Empty-state renders recognized explanation and clickable suggested_additions chips
  {
    const s = await setup({
      success: true,
      ranking_method: 'final',
      ingredients: ['ground pork'],
      recommendations: [],
      warnings: ['Không có recipe đạt ngưỡng phù hợp'],
      empty_reason: 'NO_CANDIDATE_PASSED_ELIGIBILITY',
      empty_detail: {
        candidate_count: 76,
        qualified_count: 0,
        pantry_group_count: 1,
        unresolved_count: 0,
        recognized_ingredients: ['ground pork'],
        suggested_additions: [
          { canonical: 'garlic', display_vi: 'tỏi', display_en: 'garlic' },
          { canonical: 'green_onion', display_vi: 'hành lá', display_en: 'green onion' },
        ],
        explanation_vi: 'Đã nhận diện nguyên liệu: thịt heo xay (ground pork). Tìm thấy 76 công thức liên quan.',
        explanation_en: 'Recognized ingredient(s): ground pork. Found 76 related recipes.',
      },
      timing_ms: { request: 5 },
    });
    const input = s.elements.get('ingredientInput');
    const form = s.elements.get('addIngredientForm');
    input.value = 'thịt heo xay';
    form.events.submit.forEach(fn => fn({ preventDefault() {} }));
    assert.equal(s.run('pantry[0].name'), 'ground pork');
    await s.elements.get('recommendButton').events.click[0]();
    const emptyCard = s.elements.get('recipeList').children[0];
    const suggBox = emptyCard.children.find(c => c.className === 'empty-suggestions-box');
    assert(suggBox, 'Expected suggested additions box in empty-state card');
    const chips = suggBox.children[1].children;
    assert.equal(chips.length, 2);
    assert.equal(chips[0].textContent, '+ tỏi');
    chips[0].events.click.forEach(fn => fn());
    assert.deepEqual([...s.run('pantry.map(x => x.name)')], ['ground pork', 'garlic']);
  }

  // 8. Simplified friendly copy in #methodInfoPanel & generic ca/hanh disambiguation
  {
    const htmlSource = fs.readFileSync('frontend/index.html', 'utf8');
    assert(htmlSource.includes('ưu tiên món phù hợp với nguyên liệu bạn đang có'));
    assert(htmlSource.includes('tìm món có nguyên liệu gần giống'));
    assert(htmlSource.includes('gợi ý thêm những món có liên quan'));

    const s = await setup();
    const input = s.elements.get('ingredientInput');
    const form = s.elements.get('addIngredientForm');
    const disambigBox = s.elements.get('disambiguationBox');

    input.value = 'cá, hành';
    form.events.submit.forEach(fn => fn({ preventDefault() {} }));
    assert.equal(s.run('pantry.length'), 2);
    assert.equal(s.run('pantry[0].unrecognized'), true);
    assert.equal(s.run('pantry[1].unrecognized'), true);
    assert.equal(disambigBox.hidden, false);
    assert.equal(disambigBox.children.length, 2);

    const salmonBtn = disambigBox.children[0].children[1].children.find(b => b.getAttribute('data-replace-canonical') === 'salmon');
    assert(salmonBtn, 'Expected salmon disambiguation pill for generic ca');
    salmonBtn.events.click.forEach(fn => fn());
    assert.equal(s.run('pantry[0].name'), 'salmon');
    assert.equal(s.run('pantry[0].unrecognized'), false);

    const greenOnionBtn = disambigBox.children[0].children[1].children.find(b => b.getAttribute('data-replace-canonical') === 'green_onion');
    assert(greenOnionBtn, 'Expected green_onion disambiguation pill for generic hanh');
    greenOnionBtn.events.click.forEach(fn => fn());
    assert.equal(s.run('pantry[1].name'), 'green_onion');
    assert.equal(disambigBox.hidden, true);
  }

  console.log('PASS all 8 recommendation audit frontend regression cases');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
