// Targeted race cases, isolated from QA chat artifacts. No server/camera/YOLO.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture(fetchFrame){
 const timers=new Map(),events=[],errors=[],metrics=[];let serial=0;
 const context={AbortController,performance:{now:()=>100},setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial},clearTimeout:id=>timers.delete(id),document:{createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:cb=>cb({type:'image/jpeg'})})}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('frontend/detection.js','utf8'),context);
 const live=new context.SmartKitchenDetection.LiveDetection({video:{readyState:4,videoWidth:640,videoHeight:480},overlay:{set:x=>events.push(x),clear:()=>events.push('clear')},fetchFrame,onError:x=>errors.push(x),onMetrics:x=>metrics.push(x)});
 async function begin(){live.active=true;const task=live.tick(live.generation);await Promise.resolve();await Promise.resolve();return {task}}
 return {live,timers,events,errors,metrics,begin};
}
const records=[];
async function test(name,fn){try{await fn();records.push({name,status:'PASS'})}catch(e){records.push({name,status:'FAIL',error:String(e)})}}
(async()=>{
 await test('stop during delayed response.json cannot redraw stale boxes or metrics',async()=>{
  const body=deferred(),entered=deferred(),f=fixture(async()=>({status:200,ok:true,json:()=>{entered.resolve();return body.promise}}));const {task}=await f.begin();await entered.promise;f.live.stop();const before=f.events.length;
  body.resolve({success:true,image:{width:640,height:480},boxes:[{name:'STALE'}]});await task;
  assert.equal(f.events.length,before);assert.equal(f.metrics.length,0);assert.equal(f.timers.size,0);
 });
 await test('old JSON cannot overwrite new camera generation',async()=>{
  const body=deferred(),entered=deferred();let calls=0;const f=fixture(async()=>++calls===1?{status:200,ok:true,json:()=>{entered.resolve();return body.promise}}:{status:200,ok:true,json:async()=>({success:true,boxes:[{name:'NEW'}]})});
  const {task}=await f.begin();await entered.promise;f.live.start();body.resolve({success:true,boxes:[{name:'OLD'}]});await task;
  assert.ok(!f.events.some(e=>e?.boxes?.[0]?.name==='OLD'));assert.equal(f.metrics.length,0);f.live.stop();
 });
 await test('late JSON after timeout cannot draw boxes even if transport ignores abort',async()=>{
  const body=deferred(),entered=deferred(),f=fixture(async()=>({status:200,ok:true,json:()=>{entered.resolve();return body.promise}}));const {task}=await f.begin();await entered.promise;
  [...f.timers.values()].find(t=>t.ms===10000).fn();body.resolve({success:true,boxes:[{name:'TIMED_OUT'}]});await task;
  assert.equal(f.metrics.length,0);assert.ok(!f.events.some(e=>e?.boxes));assert.equal(f.live.inFlight,false);f.live.stop();
 });
 await test('network rejection releases inFlight and schedules bounded retry',async()=>{
  const f=fixture(async()=>{throw new TypeError('TEST network disconnect')});const {task}=await f.begin();await task;
  assert.equal(f.live.inFlight,false);assert.equal(f.errors.length,1);assert.ok([...f.timers.values()].some(t=>t.ms===3000));f.live.stop();assert.equal(f.timers.size,0);
 });
 await test('timeout aborts owned request and permits later retry',async()=>{
  const f=fixture((_b,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))));
  const {task}=await f.begin();[...f.timers.values()].find(t=>t.ms===10000).fn();await task;assert.equal(f.live.inFlight,false);assert.ok(f.errors.length===1);f.live.stop();
 });
 await test('429 respects Retry-After without rendering boxes',async()=>{
  const f=fixture(async()=>({status:429,headers:{get:()=> '4'},json:()=>{throw Error('must not parse busy response')}}));const {task}=await f.begin();await task;
  assert.equal(f.live.inFlight,false);assert.ok([...f.timers.values()].some(t=>t.ms===4000));assert.equal(f.metrics.length,0);f.live.stop();
 });
 await test('pending request prevents a concurrent frame admission',async()=>{
  const pending=deferred();let calls=0;const f=fixture(()=>{calls++;return pending.promise});const {task}=await f.begin();await f.live.tick(f.live.generation);assert.equal(calls,1);
  f.live.stop();pending.resolve({status:200,ok:true,json:async()=>({success:true,boxes:[]})});await task;assert.equal(f.live.inFlight,false);
 });
 console.log(JSON.stringify({scope:'DETERMINISTIC_NEW_RACE_CASES_NO_SERVER_NO_INFERENCE',records},null,2));process.exitCode=records.some(r=>r.status==='FAIL')?1:0;
})();
