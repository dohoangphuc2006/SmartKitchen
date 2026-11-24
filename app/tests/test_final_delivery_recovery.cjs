// Synthetic DOM regression. Real browser / YOLO are verified separately.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
class Element {
 constructor(){this.children=[];this.events={};this.style={};this.hidden=false;this.value='';this.textContent='';this.classList={add(){},remove(){}};}
 append(...items){this.children.push(...items);} replaceChildren(...items){this.children=items;}
 setAttribute(){} removeAttribute(){} addEventListener(k,fn){this.events[k]=fn;}
 querySelector(){return this.button ||= new Element();} focus(){this.focused=true;}
}
(async()=>{
 const elements=new Map(),sandbox={console,AbortController,setTimeout,clearTimeout,
  document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()},
  localStorage:{getItem:()=>null,setItem(){}},URL:{createObjectURL:()=>'',revokeObjectURL(){}},
  FormData:class{append(){}},window:{},fetch:async()=>({ok:true,json:async()=>({top_n:5,max_upload_mb:10,allowed_extensions:['jpg']})})};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync('frontend/app.js','utf8'),sandbox);await new Promise(setImmediate);
 const run=s=>vm.runInContext(s,sandbox);
 run("selectedFile={name:'SYNTHETIC_TEST_ONLY.jpg'}; originalDetections=[{name:'tomato'}]; pantry=[{name:'tomato'}]; currentRecipes=[{recipe_id:1}]");
 assert.equal(typeof sandbox.offerManualPantry,'function','No-detection response needs a manual recovery action');
 for(const error of ['NO_INGREDIENT_DETECTED','NO_MAPPED_INGREDIENT']){
  sandbox.data={error,message:'Không phát hiện được nguyên liệu phù hợp trong ảnh.'};run('offerManualPantry(data)');
  const button=elements.get('statusRegion').children.at(-1);assert.match(button.textContent,/thủ công/);
  button.events.click();
  assert.equal(run('originalDetections.length'),0);assert.equal(run('pantry.length'),0);assert.equal(run('currentRecipes.length'),0);
  assert.equal(elements.get('results').hidden,false);assert.equal(elements.get('addIngredientForm').hidden,false);
  assert.equal(elements.get('ingredientInput').focused,true);assert.equal(elements.get('recommendButton').disabled,true);
  assert.match(elements.get('resultBadge').textContent,/THỦ CÔNG/);
  elements.get('ingredientInput').value='egg';elements.get('addIngredientForm').events.submit({preventDefault(){}});
  assert.equal(run('pantry[0].source'),'manual');assert.equal(run('originalDetections.length'),0);
 }
 const count=elements.get('statusRegion').children.length;
 run("offerManualPantry({error:'DETECTOR_ERROR'})");assert.equal(elements.get('statusRegion').children.length,count);
 console.log('PASS: empty/unmapped recovery, manual provenance, old results explicit reset, no fake detections, transport error excluded');
})().catch(e=>{console.error(e);process.exitCode=1;});
