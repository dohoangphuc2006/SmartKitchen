// DOM contract tests for safe recipe detail rendering and step navigation.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

class Element {
  constructor(tag='div') { this.tag=tag; this.children=[]; this.events={}; this.textContent=''; this.style={};
    this.value=''; this.hidden=false; this.disabled=false; this.attributes={}; this.className='';
    this.classList={add(){},remove(){}}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=items; }
  setAttribute(k,v) { this.attributes[k]=v; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(k,fn) { this.events[k]=fn; }
  querySelector() { return this.button ||= new Element('button'); }
  focus() { this.focused=true; }
}

const source=fs.readFileSync('frontend/app.js','utf8');
const detail={success:true,recipe_id:1,recipe_name:'Unsafe <b>Soup</b>',ingredients:['<img src=x onerror=alert(1)>','water'],
  instructions:'<script>alert(1)</script>\nServe.',instruction_steps:['<script>alert(1)</script>','Serve.'],language:'en',
  translations:{vi:{recipe_name:'Súp an toàn',recipe_name_source:'fixture',recipe_name_review_status:'auto_unreviewed',
    recipe_name_display_eligible:true,
    instructions:null,instruction_steps:[],instructions_source:'none',instructions_review_status:'untranslated'}},
  source:{dataset_name:'Fixture',publisher:'Publisher',original_content_source:'Source',dataset_url:'https://example.test',
    license:'CC TEST',license_url:'https://example.test/license',revision:'fixture-1',source_level:'dataset'}};
const recipe={recipe_id:1,recipe_name:'Unsafe <b>Soup</b>',match_ratio:.5,matched_ingredients:['egg'],missing_ingredients:['salt']};

async function setup() {
  const elements=new Map(); const requests=[];
  const documentEvents={};
  const sandbox={console,document:{getElementById(id){if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id);},
    createElement:t=>new Element(t),addEventListener(k,fn){documentEvents[k]=fn;}},
    localStorage:{getItem(){return null;},setItem(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},
    FormData:class{append(){}},window:{},fetch:async(url)=>{requests.push(url);return {ok:true,json:async()=>
      url==='/api/config'?{top_n:5,max_upload_mb:10,allowed_extensions:['jpg'],localization:{ingredients:{},recipe_titles:{},manual_aliases:{},ambiguous_inputs:[]}}:detail};}};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);await new Promise(setImmediate);
  return {elements,requests,documentEvents,run:s=>vm.runInContext(s,sandbox),sandbox};
}

(async()=>{
  const s=await setup();s.sandbox.sample=recipe;s.run('renderRecipes([sample],ui.recipeList)');
  const card=s.elements.get('recipeList').children[0];
  await card.children[0].children[1].events.click();
  assert.equal(s.requests.at(-1),'/api/recipes/1');
  assert.equal(s.elements.get('recipeModal').hidden,false);
  assert.equal(s.elements.get('recipeDetailTitle').textContent,'Súp an toàn');
  assert.equal(s.elements.get('recipeIngredientList').children[0].textContent,'<img src=x onerror=alert(1)>');
  assert.equal(s.elements.get('recipeStepText').textContent,'<script>alert(1)</script>');
  assert.equal(s.elements.get('recipeStepIndicator').textContent,'Bước 1/2');
  s.elements.get('nextRecipeStep').events.click();
  assert.equal(s.elements.get('recipeStepText').textContent,'Serve.');
  assert.equal(s.elements.get('recipeInstructionsTitle').textContent,'Hướng dẫn gốc (English)');
  assert.equal(s.elements.get('recipeLanguageBadge').textContent,'EN');
  assert.equal(s.elements.get('recipeInstructionStatus').hidden,true);
  assert.equal(s.elements.get('recipeInstructionStatus').textContent,'');
  assert.match(s.elements.get('recipeTranslationNote').textContent,/Dịch tự động/);
  s.elements.get('closeRecipeModal').events.click();
  assert.equal(s.elements.get('recipeModal').hidden,true);
  // A title without the repository's explicit display gate must stay English.
  // This flag describes fixture eligibility, never a human review decision.
  detail.translations.vi.recipe_name_display_eligible=false;
  await s.run('openRecipeDetail({recipe_id:1},null)');
  assert.equal(s.elements.get('recipeDetailTitle').textContent,detail.recipe_name);
  assert.equal(detail.translations.vi.recipe_name_review_status,'auto_unreviewed');
  s.elements.get('closeRecipeModal').events.click();
  assert(!source.includes('.innerHTML'));
  const html=fs.readFileSync('frontend/index.html','utf8');
  const css=fs.readFileSync('frontend/style.css','utf8');
  assert(html.includes('role="dialog"') && html.includes('aria-modal="true"'));
  assert(css.includes('@media (max-width: 540px)') && css.includes('.recipe-dialog'));
  console.log('PASS recipe detail fetch, safe text rendering, navigation, close and responsive contract');
})().catch(error=>{console.error(error);process.exitCode=1;});

