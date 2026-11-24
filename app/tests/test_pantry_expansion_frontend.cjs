// Comprehensive DOM/VM regression and feature tests for Pantry Input Expansion (Phase B/C/D/F).
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
  dispatchEvent(ev) {
    for (const fn of (this.events[ev.type] || [])) fn(ev);
  }
  querySelector() { return this.button ||= new Element('button'); }
  querySelectorAll() { return []; }
  focus() { this.focused = true; }
}

const source = fs.readFileSync('frontend/app.js', 'utf8');
const htmlSource = fs.readFileSync('frontend/index.html', 'utf8');
const catalogData = JSON.parse(fs.readFileSync('config/pantry_ingredient_catalog.json', 'utf8'));
const viIngredients = JSON.parse(fs.readFileSync('config/ingredient_display_vi.json', 'utf8'));

async function setup() {
  const elements = new Map();
  const hiddenByDefault = new Set([
    'recipeModal', 'aiModal', 'quickQuantityPopover', 'uploadPanel',
    'methodInfoPanel', 'clearPantryPrompt', 'clearHistoryPrompt', 'resultStatusBanner', 'quantityScopeHint',
    'ingredientAutocomplete', 'catalogBrowserPanel', 'disambiguationBox', 'catalogSearchClearBtn', 'catalogLoadMoreBtn',
  ]);
  const storage = {};
  const requests = [];
  const documentEvents = {};
  const docEl = new Element('html');
  const bodyEl = new Element('body');
  const scrollCalls = [];
  const winObj = {
    scrollY: 480,
    scrollTo(x, y) {
      scrollCalls.push({ x, y });
      winObj.scrollY = y;
    },
    addEventListener() {},
  };
  const sandbox = {
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    Event: class { constructor(type) { this.type = type; } },
    document: {
      activeElement: null,
      documentElement: docEl,
      body: bodyEl,
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
    window: winObj,
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
              ingredients: { ...viIngredients, ...catalogData.display_variants_en },
              recipe_titles: {},
              manual_aliases: catalogData.pantry_aliases,
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
      if (url === '/api/display-catalog') {
        return { ok: false };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          ranking_method: 'final',
          recommendations: [],
          warnings: [],
          timing_ms: { request: 5 },
        }),
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return { elements, storage, requests, documentEvents, docEl, bodyEl, winObj, scrollCalls, run: s => vm.runInContext(s, sandbox), sandbox };
}

(async () => {
  const results = [];
  async function runCase(name, fn) {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS', name);
  }

  await runCase('HTML contract: maxlength=1000, autocomplete listbox, catalog browser panel, disambiguation box', async () => {
    assert(htmlSource.includes('id="ingredientInput" maxlength="1000"'));
    assert(htmlSource.includes('id="ingredientAutocomplete"'));
    assert(htmlSource.includes('id="toggleCatalogBtn"'));
    assert(htmlSource.includes('id="catalogBrowserPanel"'));
    assert(htmlSource.includes('id="disambiguationBox"'));
    assert(!source.includes('.innerHTML'));
  });

  await runCase('All 526 catalog items are recognized by parseManualInputSegment in VI, unaccented VI, and EN', async () => {
    const s = await setup();
    assert.equal(catalogData.items.length, 526);
    for (const item of catalogData.items) {
      s.sandbox.testInputVi = item.display_name_vi;
      const resVi = s.run('parseManualInputSegment(testInputVi)');
      assert.equal(resVi.unrecognized, false, `Expected VI "${item.display_name_vi}" to be recognized`);
      assert.equal(resVi.name, item.canonical_name, `Expected VI "${item.display_name_vi}" -> "${item.canonical_name}", got "${resVi.name}"`);

      s.sandbox.testInputEn = item.canonical_name;
      const resEn = s.run('parseManualInputSegment(testInputEn)');
      assert.equal(resEn.unrecognized, false, `Expected EN "${item.canonical_name}" to be recognized`);

      for (const unacc of (item.aliases_vi_unaccented || []).slice(0, 2)) {
        s.sandbox.testInputUnacc = unacc;
        const resUnacc = s.run('parseManualInputSegment(testInputUnacc)');
        assert.equal(resUnacc.unrecognized, false, `Expected unaccented "${unacc}" to be recognized`);
        assert.equal(resUnacc.name, item.canonical_name);
      }
    }
  });

  await runCase('Autocomplete dropdown searches catalog, preserves quantity prefix, and commits via keyboard or click', async () => {
    const s = await setup();
    const input = s.elements.get('ingredientInput');
    const dropdown = s.elements.get('ingredientAutocomplete');
    assert.equal(dropdown.hidden, true);

    input.value = '200g thịt ba ch';
    input.events.input.forEach(fn => fn());
    assert.equal(dropdown.hidden, false);
    assert(dropdown.children.length >= 1);
    const firstOption = dropdown.children[0];
    assert.equal(firstOption.getAttribute('data-canonical'), 'pork belly');

    // Keyboard ArrowDown + Enter commits '200g thịt ba chỉ' -> pork belly with quantity '200g'
    input.events.keydown.forEach(fn => fn({ key: 'ArrowDown', preventDefault() {} }));
    assert.equal(firstOption.getAttribute('aria-selected'), 'true');
    input.events.keydown.forEach(fn => fn({ key: 'Enter', preventDefault() {} }));

    assert.equal(dropdown.hidden, true);
    assert.equal(s.run('pantry.length'), 1);
    assert.equal(s.run('pantry[0].name'), 'pork belly');
    assert.equal(s.run('pantry[0].quantity'), '200g');
    assert.equal(s.run('pantry[0].unrecognized'), false);
  });

  await runCase('Catalog Browser Panel opens, filters by category & search query, paginates, and adds ingredients on click', async () => {
    const s = await setup();
    const toggleBtn = s.elements.get('toggleCatalogBtn');
    const panel = s.elements.get('catalogBrowserPanel');
    const grid = s.elements.get('catalogItemGrid');
    const tabs = s.elements.get('catalogCategoryTabs');
    const loadMoreBtn = s.elements.get('catalogLoadMoreBtn');
    const searchInput = s.elements.get('catalogSearchInput');

    assert.equal(panel.hidden, true);
    toggleBtn.events.click.forEach(fn => fn());
    assert.equal(panel.hidden, false);
    assert.equal(tabs.children.length, 13); // 'all' + 12 categories
    assert.equal(grid.children.length, 36); // First page of 36 items
    assert.equal(loadMoreBtn.hidden, false);

    // Click Load More -> 72 items
    loadMoreBtn.events.click.forEach(fn => fn());
    assert.equal(grid.children.length, 72);

    // Filter by seafood category tab
    const seafoodTab = tabs.children.find(btn => btn.getAttribute('data-category') === 'seafood');
    assert(seafoodTab);
    seafoodTab.events.click.forEach(fn => fn());
    assert(grid.children.length > 10 && grid.children.length <= 36);

    // Search in catalog for 'ca hoi' (unaccented salmon)
    searchInput.value = 'ca hoi';
    searchInput.events.input.forEach(fn => fn());
    assert(grid.children.length >= 1);
    const salmonChip = grid.children.find(c => c.getAttribute('data-canonical') === 'salmon');
    assert(salmonChip);
    salmonChip.events.click.forEach(fn => fn());

    assert.equal(s.run('pantry.some(x => x.name === "salmon")'), true);
  });

  await runCase('Disambiguation pills appear for generic beef/pork/chili/tofu and one-click replace preserving quantity', async () => {
    const s = await setup();
    const input = s.elements.get('ingredientInput');
    const form = s.elements.get('addIngredientForm');
    const disambigBox = s.elements.get('disambiguationBox');

    input.value = '300g thịt bò, 2 quả ớt';
    form.events.submit.forEach(fn => fn({ preventDefault() {} }));

    assert.equal(s.run('pantry.length'), 2);
    assert.equal(s.run('pantry[0].name'), 'beef');
    assert.equal(s.run('pantry[0].quantity'), '300g');
    assert.equal(s.run('pantry[0].unrecognized'), true);
    assert.equal(s.run('pantry[1].name'), 'ớt');
    assert.equal(s.run('pantry[1].quantity'), '2 quả');
    assert.equal(s.run('pantry[1].unrecognized'), true);
    assert.equal(disambigBox.hidden, false);
    assert.equal(disambigBox.children.length, 2);

    // Click first disambiguation pill for beef ('thịt bò xay' -> 'ground beef')
    const beefGroupPills = disambigBox.children[0].children[1].children;
    const groundBeefPill = beefGroupPills.find(b => b.getAttribute('data-replace-canonical') === 'ground beef');
    assert(groundBeefPill);
    groundBeefPill.events.click.forEach(fn => fn());

    assert.equal(s.run('pantry[0].name'), 'ground beef');
    assert.equal(s.run('pantry[0].quantity'), '300g');
    assert.equal(s.run('pantry[0].unrecognized'), false);
    assert.equal(disambigBox.hidden, false); // Chili is still ambiguous

    // Click disambiguation pill for chili ('ớt hiểm' -> 'thai chile')
    const chiliGroupPills = disambigBox.children[0].children[1].children;
    const thaiChilePill = chiliGroupPills.find(b => b.getAttribute('data-replace-canonical') === 'thai chile');
    assert(thaiChilePill);
    thaiChilePill.events.click.forEach(fn => fn());

    assert.equal(s.run('pantry[1].name'), 'thai chile');
    assert.equal(s.run('pantry[1].quantity'), '2 quả');
    assert.equal(s.run('pantry[1].unrecognized'), false);
    assert.equal(disambigBox.hidden, true); // All ambiguous items resolved!
  });

  await runCase('Multi-ingredient session (18 items mixing VI, unaccented VI, EN, quantities, and duplicates) deduplicates cleanly', async () => {
    const s = await setup();
    const input = s.elements.get('ingredientInput');
    const form = s.elements.get('addIngredientForm');

    input.value = [
      '2 quả trứng', 'eggs', 'trung',
      '300g thịt ba chỉ', '2 tép tỏi', '2 nhánh hành lá',
      '1 củ hành tây', 'cà chua', 'ca rot',
      'nước mắm', 'dầu hào', 'tiêu đen',
      'cải thảo', 'nấm hương', 'cơm nguội',
      'tôm sú', 'gừng', 'sả', 'ớt hiểm', 'dầu ăn'
    ].join(', ');
    form.events.submit.forEach(fn => fn({ preventDefault() {} }));

    // 20 segments with 3 egg duplicates -> 18 unique recognized canonical items
    assert.equal(s.run('pantry.length'), 18);
    assert.equal(s.run('pantry.every(x => x.unrecognized === false)'), true);
  });

  await runCase('Inline Catalog UX: separated from quick-add, inline expandable (no modal/body lock), scoped wheel boundary guard, mobile select', async () => {
    const htmlSource = fs.readFileSync('frontend/index.html', 'utf8');
    const cssSource = fs.readFileSync('frontend/style.css', 'utf8');

    // Quick-add bar has only the 6 quick-chips and does NOT contain toggleCatalogBtn
    const quickBarMatch = htmlSource.match(/<div class="quick-add-bar"[\s\S]*?<\/div>/);
    assert(quickBarMatch);
    assert(!quickBarMatch[0].includes('id="toggleCatalogBtn"'), 'toggleCatalogBtn must be separated from quick-add-bar');

    // Catalog is inline inside .catalog-explore-bar and NOT a modal/dialog
    const exploreMatch = htmlSource.match(/<div class="catalog-explore-bar">[\s\S]*?<\/section>\s*<\/div>/);
    assert(exploreMatch && exploreMatch[0].includes('id="catalogBrowserPanel"'));
    assert(!htmlSource.includes('id="catalogDialog"'), 'Must not render a modal dialog for catalog');
    assert(!exploreMatch[0].includes('role="dialog"') && !exploreMatch[0].includes('aria-modal="true"'));
    assert(htmlSource.includes('id="catalogResultsScroll"'));
    assert(htmlSource.includes('id="catalogCategorySelect"'));
    assert(htmlSource.includes('id="doneCatalogBtn"'));

    // CSS uses single unified layout (no .catalog-open layout morphing, no outer left-column overflow-y scrollbar, Zone B only scrollable)
    assert(!cssSource.includes('catalog-scroll-locked'));
    assert(!cssSource.includes('.catalog-open'));
    assert(cssSource.includes('grid-template-columns: minmax(0, 45fr) minmax(0, 55fr);'));
    assert(cssSource.includes('.catalog-inline-panel') && cssSource.includes('min-width: 0;'));
    assert(cssSource.includes('.catalog-results-scroll') && cssSource.includes('overscroll-behavior-y: contain;') && cssSource.includes('min-height: 0;'));
    assert(cssSource.includes('@media (min-width: 961px)') && cssSource.includes('@media (max-width: 960px)'));
    assert(cssSource.includes('@media (max-width: 640px)'));

    const s = await setup();
    const pantrySection = s.sandbox.document.getElementById('pantrySection');
    const recommendBtn = s.elements.get('recommendButton');
    const pantryCountEl = s.elements.get('ingredientCount');
    const ingredientListEl = s.elements.get('ingredientList');
    const loadMoreBtn = s.elements.get('catalogLoadMoreBtn');
    const toggleBtn = s.elements.get('toggleCatalogBtn');
    const panel = s.elements.get('catalogBrowserPanel');
    const closeBtn = s.elements.get('closeCatalogBtn');
    const doneBtn = s.elements.get('doneCatalogBtn');
    const searchInput = s.elements.get('catalogSearchInput');
    const catSelect = s.elements.get('catalogCategorySelect');
    const grid = s.elements.get('catalogItemGrid');
    const resultsScroll = s.elements.get('catalogResultsScroll');

    let focusedEl = null;
    toggleBtn.focus = () => { focusedEl = toggleBtn; };
    searchInput.focus = () => { focusedEl = searchInput; };

    // Open & collapse repeatedly (3x) without locking body scroll or morphing #pantrySection classes
    for (let cycle = 0; cycle < 3; cycle++) {
      toggleBtn.events.click.forEach(fn => fn());
      assert.equal(panel.hidden, false);
      assert.equal(pantrySection.classList.contains('catalog-open'), false);
      assert(!s.bodyEl.style.position && !s.bodyEl.style.overflow);
      assert.equal(focusedEl, searchInput);

      if (cycle === 0) closeBtn.events.click.forEach(fn => fn());
      else if (cycle === 1) doneBtn.events.click.forEach(fn => fn());
      else toggleBtn.events.click.forEach(fn => fn()); // toggle button collapses too

      assert.equal(panel.hidden, true);
      assert.equal(pantrySection.classList.contains('catalog-open'), false);
      assert(!s.bodyEl.style.position && !s.bodyEl.style.overflow);
      assert.equal(focusedEl, toggleBtn);
    }

    // Reopen and verify scoped wheel boundary guard on #catalogResultsScroll
    toggleBtn.events.click.forEach(fn => fn());
    assert.equal(panel.hidden, false);
    assert.equal(pantrySection.classList.contains('catalog-open'), false);
    resultsScroll.clientHeight = 320;
    resultsScroll.scrollHeight = 1200;

    // At top (scrollTop=0), wheel up (deltaY < 0) prevents chaining
    resultsScroll.scrollTop = 0;
    let preventedTop = false;
    resultsScroll.events.wheel.forEach(fn => fn({ deltaY: -40, preventDefault() { preventedTop = true; } }));
    assert.equal(preventedTop, true);

    // Mid-list (scrollTop=200), wheel down/up is NOT prevented
    resultsScroll.scrollTop = 200;
    let preventedMid = false;
    resultsScroll.events.wheel.forEach(fn => fn({ deltaY: 40, preventDefault() { preventedMid = true; } }));
    assert.equal(preventedMid, false);

    // At bottom (even within 1.5px fractional DPR tolerance), wheel down (deltaY > 0) prevents chaining
    resultsScroll.scrollTop = 878.5;
    let preventedBottom = false;
    resultsScroll.events.wheel.forEach(fn => fn({ deltaY: 40, preventDefault() { preventedBottom = true; } }));
    assert.equal(preventedBottom, true);

    // Adding items from scrolled Zone B preserves scrollTop and updates Zone C pantry & CTA
    resultsScroll.scrollTop = 240;
    const midCatalogItem = grid.children[10];
    midCatalogItem.events.click.forEach(fn => fn());
    assert.equal(s.run('pantry.length'), 1);
    assert.equal(resultsScroll.scrollTop, 240, 'Adding an item from Zone B must not reset catalog scrollTop');
    assert.equal(recommendBtn.disabled, false);
    assert(String(pantryCountEl.textContent).includes('1'));
    assert.equal(ingredientListEl.children.length, 1);

    // Load more in Zone B also preserves scrollTop
    if (!loadMoreBtn.hidden) {
      resultsScroll.scrollTop = 360;
      loadMoreBtn.events.click.forEach(fn => fn());
      assert.equal(resultsScroll.scrollTop, 360, 'Load more must preserve Zone B scrollTop');
    }

    // Filter via mobile <select>
    catSelect.value = 'seafood';
    catSelect.events.change.forEach(fn => fn());
    assert(grid.children.length > 10 && grid.children.every(c => c.getAttribute('data-canonical')));

    // Clicking same item twice does not add duplicate and preserves pantry count cleanly
    const countBeforeSeafood = s.run('pantry.length');
    const firstSeafood = grid.children[0];
    firstSeafood.events.click.forEach(fn => fn());
    assert.equal(s.run('pantry.length'), countBeforeSeafood + 1);
    firstSeafood.events.click.forEach(fn => fn());
    assert.equal(s.run('pantry.length'), countBeforeSeafood + 1);

    // Empty search state
    searchInput.value = 'zzzznonexistent999';
    searchInput.events.input.forEach(fn => fn());
    assert.equal(grid.children.length, 1);
    assert.equal(grid.children[0].className, 'catalog-empty-state');

    // Escape collapses panel and preserves pantry items
    s.documentEvents.keydown.forEach(fn => fn({ key: 'Escape', preventDefault() {} }));
    assert.equal(panel.hidden, true);
    assert.equal(pantrySection.classList.contains('catalog-open'), false);
    assert.equal(s.run('pantry.length'), countBeforeSeafood + 1);
  });

  fs.mkdirSync('reports/pantry_input_expansion_20261115', { recursive: true });
  fs.writeFileSync(
    'reports/pantry_input_expansion_20261115/frontend_expansion_tests.json',
    JSON.stringify({ total: results.length, passed: results.length, results }, null, 2)
  );
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
