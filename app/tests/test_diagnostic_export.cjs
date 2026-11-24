// Byte-transport tests only: generic .bin files and TEST_ONLY error JSON, no food GT.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const Diagnostic=require('../frontend/diagnostic_export.js');
const records=[];
function control(){return {checked:false,disabled:false,textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn;}};}
function fixture(extra={}){
  const controls={consent:control(),imageButton:control(),jsonButton:control(),notice:control()},downloads=[];
  let current=null,blocked=false;
  const exporter=new Diagnostic({...controls,getFile:()=>current,isBlocked:()=>blocked,
    save:(blob,name)=>downloads.push({blob,name}),...extra});
  return {...controls,exporter,downloads,select(file){current=file;exporter.select(file,'TEST_TRANSPORT_NOT_CAMERA');},
    agree(value=true){controls.consent.checked=value;controls.consent.events.change();},block(value){blocked=value;exporter.refresh();}};
}
const file=()=>new File([new Uint8Array([1,9,2,8,3,7])],'TEST_TRANSPORT.bin',{type:'application/octet-stream'});
const body=()=>({success:false,error:'TEST_ONLY_NO_MODEL_OUTPUT'});
async function test(name,fn){try{await fn();records.push({name,status:'PASS'});}catch(error){records.push({name,status:'FAIL',error:String(error)});console.error(error);}}
(async()=>{
  await test('selection/response never auto-download or preselect consent',async()=>{
    const f=fixture(),image=file();f.select(image);f.exporter.record(image,422,body(),'TECHNICAL_TEST_TIME');
    assert.equal(f.consent.checked,false);assert.equal(f.imageButton.disabled,true);assert.equal(f.jsonButton.disabled,true);assert.equal(f.downloads.length,0);
  });
  await test('both actions refuse without consent even if called directly',async()=>{
    const f=fixture(),image=file();f.select(image);f.exporter.record(image,422,body(),null);
    assert.equal(await f.exporter.saveImage(),false);assert.equal(await f.exporter.saveJSON(),false);assert.equal(f.downloads.length,0);
  });
  await test('image download preserves exact original File bytes/name without canvas',async()=>{
    const f=fixture(),image=file();f.select(image);f.agree();assert.equal(await f.exporter.saveImage(),true);
    assert.equal(f.downloads[0].blob,image);assert.equal(f.downloads[0].name,image.name);
    assert.deepEqual(Buffer.from(await f.downloads[0].blob.arrayBuffer()),Buffer.from(await image.arrayBuffer()));
  });
  await test('JSON requires an actual recorded response, not a placeholder',async()=>{
    const f=fixture();f.select(file());f.agree();assert.equal(f.jsonButton.disabled,true);assert.equal(await f.exporter.saveJSON(),false);assert.equal(f.downloads.length,0);
  });
  await test('JSON preserves response, HTTP status and SHA binding without creating GT',async()=>{
    const f=fixture(),image=file(),data=body();f.select(image);f.exporter.record(image,422,data,'TECHNICAL_TEST_TIME');f.agree();
    assert.equal(await f.exporter.saveJSON(),true);const json=JSON.parse(await f.downloads[0].blob.text());
    assert.deepEqual(json.analysis_response,data);assert.equal(json.response.http_status,422);
    assert.equal(json.image.sha256,crypto.createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex'));
    assert.equal(json.ground_truth,null);assert.equal(json.training_eligible,false);assert.equal(json.evaluation_eligible,false);
  });
  await test('later pantry/response object changes cannot rewrite saved analysis',async()=>{
    const f=fixture(),image=file(),data=body();f.select(image);f.exporter.record(image,422,data,null);data.error='LATER_TEST_EDIT';f.agree();
    await f.exporter.saveJSON();assert.equal(JSON.parse(await f.downloads[0].blob.text()).analysis_response.error,'TEST_ONLY_NO_MODEL_OUTPUT');
  });
  await test('new image or remove clears response and consent',async()=>{
    const f=fixture(),image=file();f.select(image);f.exporter.record(image,422,body(),null);f.agree();f.select(file());
    assert.equal(f.consent.checked,false);assert.equal(f.jsonButton.disabled,true);f.select(null);f.agree();assert.equal(await f.exporter.saveImage(),false);
  });
  await test('late response from another selection is ignored',async()=>{
    const f=fixture(),old=file();f.select(old);f.select(file());f.exporter.record(old,422,body(),null);f.agree();assert.equal(await f.exporter.saveJSON(),false);
  });
  await test('analysis retry clears prior response, including network failure path',async()=>{
    const f=fixture(),image=file();f.select(image);f.exporter.record(image,422,body(),null);f.agree();f.exporter.begin(image);
    assert.equal(f.jsonButton.disabled,true);assert.equal(await f.exporter.saveJSON(),false);
  });
  await test('busy/live-camera state blocks every export',async()=>{
    const f=fixture(),image=file();f.select(image);f.exporter.record(image,422,body(),null);f.agree();f.block(true);
    assert.equal(f.consent.disabled,true);assert.equal(await f.exporter.saveImage(),false);assert.equal(await f.exporter.saveJSON(),false);
  });
  await test('revoking consent while hashing prevents download',async()=>{
    let resolve;const f=fixture({hash:()=>new Promise(r=>resolve=r)}),image=file();f.select(image);f.exporter.record(image,422,body(),null);f.agree();
    const pending=f.exporter.saveJSON();f.agree(false);resolve('TEST_ONLY_HASH');assert.equal(await pending,false);assert.equal(f.downloads.length,0);
  });
  await test('replacing response while hashing prevents stale export',async()=>{
    let resolve;const f=fixture({hash:()=>new Promise(r=>resolve=r)}),image=file();f.select(image);f.exporter.record(image,422,body(),null);f.agree();
    const pending=f.exporter.saveJSON();f.exporter.begin(image);resolve('TEST_ONLY_HASH');assert.equal(await pending,false);assert.equal(f.downloads.length,0);
  });
  await test('hash/download errors remain retryable with no claimed saved file',async()=>{
    const f=fixture({hash:async()=>{throw Error('TEST_ONLY_HASH_FAILURE');},save:()=>{throw Error('TEST_ONLY_DOWNLOAD_FAILURE');}}),image=file();
    f.select(image);f.exporter.record(image,422,body(),null);f.agree();assert.equal(await f.exporter.saveJSON(),false);assert.equal(await f.exporter.saveImage(),false);
  });
  const dest=process.env.DIAGNOSTIC_EXPORT_TEST_OUT||'reports/phase6_webcam_20261028/export_unit.json';
  fs.mkdirSync(require('node:path').dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify({records,scope:'Software byte transport only; no real incident/image/GT generated'},null,2));
  console.log(JSON.stringify({passed:records.filter(r=>r.status==='PASS').length,failed:records.filter(r=>r.status==='FAIL').length}));
  if(records.some(r=>r.status==='FAIL'))process.exitCode=1;
})();
