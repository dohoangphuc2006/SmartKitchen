// DOM unit tests for storage failure paths and request contracts. No browser mocks counted as browser tests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Element {
  constructor(tag='div') { this.tag=tag; this.children=[]; this.events={}; this.textContent=''; this.style={}; this.value=''; this.hidden=false; this.attributes={}; this.classList={add(){},remove(){}}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=items; }
  setAttribute(k,v) { this.attributes[k]=v; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(k,fn) { this.events[k]=fn; }
  querySelector() { return this.button ||= new Element('button'); }
  focus() {}
}
const source=fs.readFileSync('frontend/app.js','utf8');
const recipe={recipe_id:1,recipe_name:'Example',match_ratio:.5,matched_ingredients:['egg'],missing_ingredients:['salt']};
async function setup(seed={}, blocked=false) {
  const elements=new Map(); const storage={...seed}; const requests=[];
  const sandbox={console,AbortController,setTimeout,clearTimeout,document:{getElementById(id){if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id);},createElement:t=>new Element(t)},
    localStorage:{getItem(k){if(blocked) throw Error('blocked');return storage[k]??null;},setItem(k,v){if(blocked) throw Error('quota');storage[k]=v;}},
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},FormData:class{append(){}},window:{confirm:()=>true},
    fetch:async(url,opts)=>{requests.push({url,body:opts?.body});return {ok:true,json:async()=>url==='/api/config'?{top_n:5,max_upload_mb:10,allowed_extensions:['jpg']}:{success:true,ingredients:['egg'],recommendations:[recipe],warnings:[],timing_ms:{request:1}}};}};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);await new Promise(setImmediate);
  return {elements,storage,requests,run:s=>vm.runInContext(s,sandbox),sandbox};
}
const tests=[]; const test=(name,fn)=>tests.push({name,fn});
test('empty/malformed/invalid-shaped storage does not crash',async()=>{
  for(const seed of [{},{smart_kitchen_favorites:'{bad',smart_kitchen_history:'{bad'},
    {smart_kitchen_favorites:'[null,{},"x"]',smart_kitchen_history:'[null,{},"x"]'},
    {smart_kitchen_favorites:'{}',smart_kitchen_history:'123'}]) {
    const s=await setup(seed);assert.equal(s.run('favorites.length + history.length'),0);
  }
});
test('blocked read/write keeps in-memory state and reports storage error',async()=>{
  const s=await setup({},true);s.run('persist(FAVORITES_KEY, [])');assert.match(s.elements.get('storageNotice').textContent,/Không thể lưu/);
});
test('favorite saves, reloads, deduplicates and unsaves',async()=>{
  const s=await setup();s.sandbox.sample=recipe;s.run('currentRecipes=[sample];renderRecipes(currentRecipes,ui.recipeList)');
  s.elements.get('recipeList').children[0].children.at(-1).events.click();
  assert.equal(JSON.parse(s.storage.smart_kitchen_favorites).length,1);
  const r=await setup(s.storage);assert.equal(r.run('favorites.length'),1);
  r.elements.get('favoriteList').children[0].children.at(-1).events.click();assert.equal(r.storage.smart_kitchen_favorites,'[]');
  const d=await setup({smart_kitchen_favorites:JSON.stringify([recipe,recipe])});assert.equal(d.run('favorites.length'),1);
});
test('edited pantry posts exact names and never analyzes',async()=>{
  const s=await setup();s.run('pantry=["banana","milk","butter","potato"].map(name=>({name,source:"detected",confidence:.91,count:1}));renderPantry()');
  s.elements.get('ingredientList').children[3].children.at(-1).events.click();
  s.elements.get('ingredientInput').value=' EGG ';s.elements.get('addIngredientForm').events.submit({preventDefault(){}});
  await s.elements.get('recommendButton').events.click();
  assert.deepEqual(JSON.parse(s.requests.at(-1).body).ingredients,['banana','milk','butter','egg']);
  assert.equal(s.requests.filter(r=>r.url==='/api/analyze').length,0);
  assert.equal(s.elements.get('ingredientList').children[3].children[1].textContent,'thủ công · x1');
});
test('manual case duplicate and whitespace handling',async()=>{
  const s=await setup();for(const value of ['Tomato',' tomato ','TOMATO']){s.elements.get('ingredientInput').value=value;s.elements.get('addIngredientForm').events.submit({preventDefault(){}});}
  assert.equal(s.run('pantry.length'),1);assert.equal(s.run('pantry[0].name'),'tomato');
});
test('empty pantry disables recommendation',async()=>{
  const s=await setup();s.run('pantry=[];renderPantry()');assert.equal(s.elements.get('recommendButton').disabled,true);
  const before=s.requests.length;
  await s.elements.get('recommendButton').events.click();assert.equal(s.requests.length,before);
  assert.equal(s.requests.filter(r=>r.url==='/api/recommend').length,0);
});
test('food availability drives the card ratio, shopping list and saved favorite', async () => {
  const s = await setup();
  s.sandbox.sample = {
    ...recipe, matched_ingredients: ['egg'],
    missing_ingredients: ['tomato, each cut into 6 wedges', 'potato masher', 'salt'],
    match_ratio: 0.25, required_equipment: ['potato masher'],
    food_availability: {matched_ingredients: ['egg', 'tomato'], missing_ingredients: ['salt']}
  };
  s.run('renderRecipes([sample], ui.recipeList)');
  const card = s.elements.get('recipeList').children[0];
  const visible = node => [node.textContent, ...node.children.flatMap(visible)].join(' ');
  assert.match(visible(card), /2\/3.*67%/);
  assert.match(visible(card), /Kiểm tra dụng cụ: potato masher/);
  assert.doesNotMatch(visible(card), /each cut into 6 wedges/);
  card.children.at(-1).events.click();
  const saved = JSON.parse(s.storage.smart_kitchen_favorites)[0];
  assert.deepEqual(saved.food_availability, s.sandbox.sample.food_availability);
  assert.deepEqual(saved.required_equipment, ['potato masher']);
});
test('all rankers keep recipe ID and warnings when rendering API results', async () => {
  // MOCK API replies. Live browser checks are tracked separately.
  for (const method of ['final', 'ml_tfidf', 'ml_lsa']) {
    const s = await setup();
    const warning = 'Chưa xác nhận đủ định lượng để nấu';
    const recommendation = {...recipe, quantity_status: 'not_checked'};
    const result = {
      success: true, ingredients: ['egg'], recommendations: [recommendation],
      warnings: [warning], timing_ms: {request: 1}, ranking_method: method
    };
    if (method !== 'final') {
      result.model_version = 'mock';
      result.artifact_sha256 = 'a'.repeat(64);
    }
    s.sandbox.reply = result;
    s.run(`
      pantryUi.rankingMethodSelect.value = reply.ranking_method;
      pantry = [{name: "egg", source: "manual"}];
      renderPantry();
    `);
    s.sandbox.fetch = async (url, options) => {
      s.requests.push({url, body: options?.body});
      return {ok: true, json: async () => result};
    };
    await s.elements.get('recommendButton').events.click();
    assert.equal(JSON.parse(s.requests.at(-1).body).ranking_method, method);
    assert.equal(s.run('appConfig.ranking_method'), method);
    assert.equal(s.run('currentRecipes[0].recipe_id'), recommendation.recipe_id);
    assert.equal(s.run('currentRecipes[0].quantity_status'), 'not_checked');
    assert.match(s.elements.get('pantryNotice').textContent, new RegExp(warning));
  }
});
test('history is metadata only, bounded to 20, survives reload and clears',async()=>{
  const s=await setup();s.sandbox.sample=recipe;
  s.run('originalDetections=[{name:"milk",confidence:.9,count:1}];pantry=[{name:"egg",source:"manual"}];currentRecipes=[sample];analyzedFilename="image.jpg";for(let i=0;i<25;i++)saveHistory("recommend")');
  const records=JSON.parse(s.storage.smart_kitchen_history);assert.equal(records.length,20);
  assert.deepEqual(records[0].detected_ingredients,['milk']);assert.deepEqual(records[0].ingredients,['egg']);
  assert(!s.storage.smart_kitchen_history.includes('base64'));assert(!s.storage.smart_kitchen_history.includes('blob:'));
  const r=await setup(s.storage);assert.equal(r.run('history.length'),20);
  r.elements.get('clearHistory').events.click();assert.equal(r.elements.get('clearHistoryPrompt').hidden,false);
  r.elements.get('cancelClearHistory').events.click();assert.equal(r.run('history.length'),20);
  r.elements.get('clearHistory').events.click();r.elements.get('confirmClearHistory').events.click();assert.equal(r.storage.smart_kitchen_history,'[]');
});
test('in-flight controls prevent file/pantry races',async()=>{
  const s=await setup();s.run('setBusy(true)');assert.equal(s.elements.get('imageInput').disabled,true);
  s.run('selectFile({name:"different.jpg",type:"image/jpeg",size:1})');assert.equal(s.run('selectedFile'),null);
  s.elements.get('ingredientInput').value='egg';s.elements.get('addIngredientForm').events.submit({preventDefault(){}});assert.equal(s.run('pantry.length'),0);
});
(async()=>{
  const results=[];
  for(const {name,fn} of tests){await fn();results.push({name,status:'PASS'});console.log('PASS',name);}
  const output = process.env.FRONTEND_TEST_OUT || 'reports/final/feature_frontend_unit.json';
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({total:results.length,passed:results.length,tests:results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
