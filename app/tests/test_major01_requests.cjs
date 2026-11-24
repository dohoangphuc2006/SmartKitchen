// MAJOR-01: deterministic fetch/body deadlines; no server, camera or inference.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve()};
class Element{constructor(){this.children=[];this.events={};this.textContent='';this.style={};this.value='';this.hidden=false;this.classList={add(){},remove(){}}}append(...x){this.children.push(...x)}replaceChildren(...x){this.children=x}setAttribute(){}removeAttribute(){}addEventListener(k,v){this.events[k]=v}focus(){}querySelector(){return this.button||=new Element()}}
async function fixture(){
 const elements=new Map(),timers=new Map(),requests=[],events={};let serial=0,clock=0,transport=async()=>{throw Error('unexpected')};
 const sandbox={console,SmartKitchenCamera:class{constructor({onState}){this.state='idle';this.onState=onState}stop(){this.state='idle';this.onState('idle')}start(){this.state='live';this.onState('live')}},AbortController,Date:class extends Date{static now(){return clock}},setTimeout:(fn,ms)=>{timers.set(++serial,{fn,at:clock+ms});return serial},clearTimeout:id=>timers.delete(id),document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id)},createElement:()=>new Element()},localStorage:{getItem:()=>null,setItem(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},FormData:class{append(){}},window:{addEventListener:(name,fn)=>events[name]=fn},fetch:(url,opts)=>url==='/api/config'?Promise.resolve({ok:true,json:async()=>({top_n:5,max_upload_mb:10,allowed_extensions:['jpg']})}):url==='/api/display-catalog'?Promise.resolve({ok:false}):(requests.push({url,opts}),transport(url,opts))};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync('frontend/app.js','utf8'),sandbox);await flush();
 const run=s=>vm.runInContext(s,sandbox);run('selectFile({name:"before.jpg",type:"image/jpeg",size:1});pantry=[{name:"egg",source:"manual",count:1}];currentRecipes=[{recipe_id:7,recipe_name:"Old",match_ratio:1,matched_ingredients:["egg"],missing_ingredients:[]}];renderPantry();renderRecipes(currentRecipes,ui.recipeList);ui.results.hidden=false');
 return {run,sandbox,elements,timers,requests,events,transport:fn=>transport=fn,async advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn()}await flush()},start(kind){return kind==='analyze'?elements.get('analyzeForm').events.submit({preventDefault(){}}):elements.get('recommendButton').events.click()}};
}
const response=(name='new')=>({ok:true,status:200,json:async()=>({success:true,detected_ingredients:[{name,confidence:.9,count:1}],unmapped_ingredients:[],recommendations:[],warnings:[],timing_ms:{request:1}})});
const records=[];async function test(name,fn){try{await fn();records.push({name,status:'PASS'})}catch(e){records.push({name,status:'FAIL',error:String(e)})}}
(async()=>{
 for(const [kind,limit] of [['analyze',120000],['recommend',30000]]){
  await test(kind+' pending fetch recovers at deadline and preserves file/pantry/results',async()=>{
   const f=await fixture();f.transport(()=>new Promise(()=>{}));f.start(kind);await flush();assert.equal(f.run('isLoading'),true);await f.advance(limit-1);assert.equal(f.run('isLoading'),true);await f.advance(1);
   assert.equal(f.run('isLoading'),false);assert.equal(f.run('selectedFile.name'),'before.jpg');assert.equal(f.run('pantry[0].name'),'egg');assert.equal(f.run('currentRecipes[0].recipe_id'),7);assert.equal(f.elements.get('results').hidden,false);assert.equal(f.elements.get('imageInput').disabled,false);assert.equal(f.requests.length,1);assert.equal(f.requests[0].opts.signal.aborted,true);assert.equal(f.timers.size,0);
  });
  await test(kind+' body pending is included in same deadline',async()=>{
   const f=await fixture();f.transport(async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}));f.start(kind);await flush();await f.advance(limit);assert.equal(f.run('isLoading'),false);assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
  });
  await test(kind+' late body cannot overwrite or release newer request lock',async()=>{
   const f=await fixture(),old=deferred(),next=deferred();let n=0;f.transport(async()=>++n===1?{ok:true,status:200,json:()=>old.promise}:next.promise);
   f.start(kind);await flush();await f.advance(limit);assert.equal(f.run('isLoading'),false);const second=f.start(kind);await flush();assert.equal(f.run('isLoading'),true);
   old.resolve(await response('OLD').json());await flush();assert.equal(f.run('isLoading'),true);assert.equal(f.run('pantry[0].name'),'egg');assert.equal(f.run('currentRecipes[0].recipe_id'),7);
   next.resolve(response('fresh'));await second;assert.equal(f.run('isLoading'),false);assert.equal(f.requests.length,2);assert.equal(f.timers.size,0);
  });
  await test(kind+' explicit cancel settles ignored transport and keeps prior data',async()=>{
   const f=await fixture();f.transport(()=>new Promise(()=>{}));const task=f.start(kind);await flush();f.events.pagehide();await task;
   assert.equal(f.run('isLoading'),false);assert.equal(f.run('selectedFile.name'),'before.jpg');assert.equal(f.run('pantry[0].name'),'egg');assert.equal(f.run('activeActionRequest'),null);assert.equal(f.timers.size,0);assert.equal(f.requests.length,1);
   const text=kind==='analyze'?f.elements.get('statusRegion').children.map(x=>x.textContent).join(''):f.elements.get('pantryNotice').textContent;assert.match(text,/Đã hủy/);
  });
  await test(kind+' late fetch and old finally cannot release a different endpoint owner',async()=>{
   const f=await fixture(),old=deferred(),next=deferred();let calls=0;f.transport(()=>++calls===1?old.promise:next.promise);f.start(kind);await flush();const owner=f.run('activeActionRequest');await f.advance(limit);
   const other=kind==='analyze'?'recommend':'analyze';const job=f.start(other);await flush();old.resolve(response('OLD'));await flush();
   f.sandbox.obsoleteRequest=owner;f.run('finishActionRequest(obsoleteRequest)');const current=f.run('activeActionRequest');
   assert.notEqual(current,owner);assert.equal(f.run('isLoading'),true);assert.equal(f.run('pantry[0].name'),'egg');
   next.resolve(response('fresh'));await job;assert.equal(f.run('isLoading'),false);assert.equal(f.run('activeActionRequest'),null);assert.equal(f.timers.size,0);assert.equal(f.requests.length,2);
  });
  await test(kind+' timeout enables next image, pantry edit and camera start',async()=>{
   const f=await fixture();f.transport(()=>new Promise(()=>{}));f.start(kind);await flush();await f.advance(limit);
   f.run('selectFile({name:"next.jpg",type:"image/jpeg",size:1})');assert.equal(f.run('selectedFile.name'),'next.jpg');
   f.elements.get('ingredientInput').value='onion';f.elements.get('addIngredientForm').events.submit({preventDefault(){}});assert.equal(f.run('pantry.length'),2);
   assert.equal(f.elements.get('openCamera').disabled,false);f.elements.get('openCamera').events.click();assert.equal(f.run('cameraController.state'),'live');assert.equal(f.requests.length,1);
  });
  await test(kind+' normal success clears deadline and does not abort successful request',async()=>{
   const f=await fixture();f.transport(async()=>response());await f.start(kind);assert.equal(f.run('isLoading'),false);assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);assert.equal(f.requests[0].opts.signal.aborted,false);
  });
  for(const failure of ['network','AbortError','HTTP'])await test(kind+' '+failure+' preserves prior data and allows retry',async()=>{
   const f=await fixture();f.transport(async()=>{if(failure==='HTTP')return {ok:false,status:503,json:async()=>({success:false,message:'TEST unavailable'})};throw Object.assign(new Error('TEST failure'),{name:failure==='network'?'TypeError':'AbortError'})});await f.start(kind);
   assert.equal(f.run('isLoading'),false);assert.equal(f.run('pantry[0].name'),'egg');assert.equal(f.run('currentRecipes[0].recipe_id'),7);assert.equal(f.elements.get('results').hidden,false);assert.equal(f.timers.size,0);f.transport(async()=>response());await f.start(kind);assert.equal(f.requests.length,2);assert.equal(f.run('isLoading'),false);
  });
 }
 await test('deadline and cancellation messages translate VI/EN including recommendation prefix',async()=>{
  const f=await fixture();f.sandbox.MutationObserver=class{observe(){}};f.sandbox.NodeFilter={SHOW_TEXT:4};f.sandbox.queueMicrotask=()=>{};
  Object.assign(f.sandbox.document,{documentElement:{},body:{},querySelectorAll:()=>[],createTreeWalker:()=>({nextNode:()=>null})});
  vm.runInContext(fs.readFileSync('frontend/i18n.js','utf8'),f.sandbox);
  for(const kind of ['analyze','recommend'])for(const name of ['TimeoutError','AbortError','TypeError']){
   f.sandbox.message=f.run(`actionFailureMessage({kind:'${kind}',abortReason:${name==='TimeoutError'?"'timeout'":"null"}},{name:'${name}'})`);
   const vi=f.sandbox.message;f.run("SmartKitchenI18N.set('en')");const en=f.run('SmartKitchenI18N.text(message)');assert.notEqual(en,vi);assert.ok(!/[Ảạệờ]/u.test(en));
   if(kind==='recommend'){f.sandbox.message='Chưa cập nhật gợi ý. '+vi;assert.match(f.run('SmartKitchenI18N.text(message)'),/^Suggestions not updated/)}
   f.run("SmartKitchenI18N.set('vi')");f.sandbox.message=vi;assert.equal(f.run('SmartKitchenI18N.text(message)'),vi);
  }
 });
 console.log(JSON.stringify({scope:'MAJOR01_FAKE_CLOCK_NO_POST_RETRY_NO_SERVER',records},null,2));process.exitCode=records.some(r=>r.status==='FAIL')?1:0;
})();
