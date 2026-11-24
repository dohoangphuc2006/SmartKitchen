// Only new error/retry and superseding-request sequences, no server or inference.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
class Element{
 constructor(){this.children=[];this.events={};this.textContent='';this.style={};this.value='';this.hidden=false;this.classList={add(){},remove(){}}}
 append(...xs){this.children.push(...xs)}replaceChildren(...xs){this.children=xs}setAttribute(){}removeAttribute(){}addEventListener(k,v){this.events[k]=v}focus(){}querySelector(){return this.button||=new Element()}
}
async function fixture(){
 const elements=new Map(),box={};let transport=async()=>{throw new Error('No request expected')};
 box.document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id)},createElement:()=>new Element()};
 Object.assign(box,{console,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},FormData:class{append(){}},window:{},fetch:(url,opts)=>url==='/api/config'?Promise.resolve({ok:true,json:async()=>({top_n:5,max_upload_mb:10,allowed_extensions:['jpg']})}):url==='/api/display-catalog'?Promise.resolve({ok:false}):transport(url,opts)});
 vm.createContext(box);vm.runInContext(fs.readFileSync('frontend/app.js','utf8'),box);await new Promise(setImmediate);
 return {elements,box,run:s=>vm.runInContext(s,box),transport:fn=>transport=fn};
}
const empty={success:true,detected_ingredients:[],recommendations:[],unmapped_ingredients:[],timing_ms:{request:1}};
const records=[];async function test(name,fn){try{await fn();records.push({name,status:'PASS'})}catch(e){records.push({name,status:'FAIL',error:String(e)})}}
(async()=>{
 await test('analyze HTTP error then retry empty detections does not freeze controls',async()=>{
  const f=await fixture();f.run('selectFile({name:"test.jpg",type:"image/jpeg",size:1});pantry=[{name:"onion",source:"manual"}]');
  f.transport(async()=>({ok:false,status:503,json:async()=>({success:false,message:'TEST ERROR'})}));await f.elements.get('analyzeForm').events.submit({preventDefault(){}});
  assert.equal(f.run('pantry[0].name'),'onion');assert.equal(f.run('isLoading'),false);assert.equal(f.elements.get('analyzeButton').disabled,false);
  f.transport(async()=>({ok:true,status:200,json:async()=>empty}));await f.elements.get('analyzeForm').events.submit({preventDefault(){}});
  assert.equal(f.run('pantry.length'),0);assert.equal(f.run('isLoading'),false);assert.equal(f.elements.get('results').hidden,false);
 });
 await test('network error recommendation retains manual pantry and next retry succeeds',async()=>{
  const f=await fixture();f.run('pantry=[{name:"egg",source:"manual",count:1}];renderPantry()');f.transport(async()=>{throw new TypeError('TEST disconnected')});await f.elements.get('recommendButton').events.click();
  assert.equal(f.run('pantry[0].name'),'egg');assert.equal(f.run('isLoading'),false);
  f.transport(async()=>({ok:true,json:async()=>({success:true,recommendations:[],warnings:[],timing_ms:{request:1}})}));await f.elements.get('recommendButton').events.click();
  assert.equal(f.run('pantry[0].name'),'egg');assert.equal(f.run('currentRecipes.length'),0);assert.equal(f.elements.get('recommendButton').disabled,false);
 });
 await test('late recipe JSON cannot overwrite newer modal error or reopen after close',async()=>{
  const f=await fixture(),old=deferred(),entered=deferred();f.transport(async(url)=>({ok:false,json:()=>url.endsWith('/1')?(entered.resolve(),old.promise):Promise.resolve({message:'NEW request error'})}));
  const first=f.run('openRecipeDetail({recipe_id:1},null)');await entered.promise;await f.run('openRecipeDetail({recipe_id:2},null)');const before=f.elements.get('recipeDetailStatus').children.map(x=>x.textContent).join('');
  f.run('closeRecipeDetail()');old.resolve({message:'OLD error'});await first;
  assert.equal(f.elements.get('recipeModal').hidden,true);assert.equal(f.elements.get('recipeDetailStatus').children.map(x=>x.textContent).join(''),before);
 });
 await test('new camera stream survives rejection of previous pending playback',async()=>{
  const Camera=require('../frontend/camera.js'),oldPlay=deferred();let call=0;const errors=[];
  const track=()=>({readyState:'live',stop(){this.readyState='ended'},addEventListener(){},removeEventListener(){}}),a=track(),b=track();
  const video={pause(){},readyState:4,videoWidth:640,videoHeight:480,play:()=>++call===1?oldPlay.promise:Promise.resolve()};let streams=0;
  const c=new Camera({video,secureContext:()=>true,onError:x=>errors.push(x),mediaDevices:{getUserMedia:async()=>{const t=++streams===1?a:b;return {getTracks:()=>[t],getVideoTracks:()=>[t]}}}});
  const first=c.start();await new Promise(setImmediate);assert.equal(await c.start(),true);oldPlay.resolve();assert.equal(await first,false);assert.equal(a.readyState,'ended');assert.equal(b.readyState,'live');assert.equal(c.state,'live');assert.equal(errors.length,0);c.stop();assert.equal(b.readyState,'ended');
 });
 console.log(JSON.stringify({scope:'NEW_STATE_RECOVERY_SEQUENCES_MOCK_ONLY',records},null,2));process.exitCode=records.some(r=>r.status==='FAIL')?1:0;
})();
