// Deterministic lifecycle tests. No browser, real camera, inference or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Camera = require('../frontend/camera.js');
const records = [];
const deferred = () => {let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve};};
function fixture(options={}) {
  const track = {readyState:'live', listeners:new Set(), stops:0,
    stop(){this.readyState='ended';this.stops++;},
    addEventListener(_,f){this.listeners.add(f);}, removeEventListener(_,f){this.listeners.delete(f);}};
  const stream = {getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video = {readyState:4,videoWidth:1280,videoHeight:720,srcObject:null,pause(){},async play(){}};
  const errors=[],states=[],constraints=[];
  const canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toBlob(cb,type,q){this.type=type;this.quality=q;cb(new Blob(['frame'],{type}));}};
  const camera=new Camera({video,onError:e=>errors.push(e),onState:s=>states.push(s),
    secureContext:()=>true,mediaDevices:{getUserMedia:async c=>{constraints.push(c);return stream;}},createCanvas:()=>canvas,...options});
  return {camera,track,stream,video,errors,states,canvas,constraints};
}
async function test(name,fn){try{await fn();records.push({name,status:'PASS'});}catch(e){records.push({name,status:'FAIL',error:String(e)});console.error(e);}}
(async()=>{
  await test('rear camera preferred, audio disabled; stop clears all tracks and listeners',async()=>{
    const f=fixture();assert.equal(await f.camera.start(),true);assert.equal(f.camera.ready,true);
    assert.equal(f.constraints[0].audio,false);assert.equal(f.constraints[0].video.facingMode.ideal,'environment');
    f.camera.stop();assert.equal(f.track.readyState,'ended');assert.equal(f.video.srcObject,null);assert.equal(f.track.listeners.size,0);assert.equal(f.camera.ready,false);
  });
  await test('capture JPEG current frame and immediately release camera',async()=>{
    const f=fixture();await f.camera.start();const b=await f.camera.capture();assert.equal(b.type,'image/jpeg');
    assert.equal(f.canvas.width,1280);assert.equal(f.canvas.height,720);assert.equal(f.canvas.quality,.92);assert.equal(f.track.readyState,'ended');assert.equal(f.camera.state,'idle');
  });
  await test('no frame cannot be captured',async()=>{
    const f=fixture();assert.equal(await f.camera.capture(),null);await f.camera.start();f.video.videoWidth=0;
    assert.equal(await f.camera.capture(),null);assert.equal(f.errors.length,2);f.camera.stop();
  });
  await test('stop while permission pending disposes late stream',async()=>{
    const d=deferred(),f=fixture({mediaDevices:{getUserMedia:()=>d.promise}});const pending=f.camera.start();
    f.camera.stop();d.resolve(f.stream);assert.equal(await pending,false);assert.equal(f.track.readyState,'ended');assert.equal(f.video.srcObject,null);
  });
  await test('stop while playback pending cannot reactivate camera',async()=>{
    const d=deferred(),f=fixture();f.video.play=()=>d.promise;const pending=f.camera.start();await Promise.resolve();
    f.camera.stop();d.resolve();assert.equal(await pending,false);assert.equal(f.camera.state,'idle');assert.equal(f.track.readyState,'ended');
  });
  await test('cancel pending JPEG cannot replace a newly selected upload',async()=>{
    const d=deferred(),f=fixture();f.canvas.toBlob=cb=>{d.resolve(cb);};await f.camera.start();const pending=f.camera.capture();
    const callback=await d.promise;f.camera.stop();callback(new Blob(['frame'],{type:'image/jpeg'}));assert.equal(await pending,null);
  });
  await test('insecure context and unsupported browser never request camera',async()=>{
    const a=fixture({secureContext:()=>false});assert.equal(await a.camera.start(),false);assert.equal(a.constraints.length,0);assert.match(a.errors[0],/HTTPS/);
    const b=fixture({mediaDevices:{}});assert.equal(await b.camera.start(),false);assert.match(b.errors[0],/không hỗ trợ/);
  });
  for(const [name,pattern] of [['NotAllowedError',/cho phép/],['NotFoundError',/Không tìm thấy/],['NotReadableError',/Không đọc được/],['OverconstrainedError',/cấu hình/]]) {
    await test(name+' returns actionable error and idle state',async()=>{
      const f=fixture({mediaDevices:{getUserMedia:async()=>{throw Object.assign(Error(name),{name});}}});
      assert.equal(await f.camera.start(),false);assert.match(f.errors[0],pattern);assert.equal(f.camera.state,'idle');assert.equal(f.video.srcObject,null);
    });
  }
  await test('playback failure releases granted stream',async()=>{
    const f=fixture();f.video.play=async()=>{throw Error('play');};assert.equal(await f.camera.start(),false);assert.equal(f.track.readyState,'ended');
  });
  await test('device disconnected ends stream with message',async()=>{
    const f=fixture();await f.camera.start();[...f.track.listeners][0]();assert.equal(f.camera.state,'idle');assert.match(f.errors[0],/ngắt kết nối/);assert.equal(f.track.listeners.size,0);
  });
  await test('encoding failure remains live for retry and can still stop',async()=>{
    const f=fixture();f.canvas.toBlob=cb=>cb(null);await f.camera.start();assert.equal(await f.camera.capture(),null);
    assert.equal(f.camera.state,'live');assert.match(f.errors[0],/Không chụp/);f.camera.stop();assert.equal(f.track.readyState,'ended');
  });
  await test('large video bounded to existing 25M pixel API limit without upscale',async()=>{
    const f=fixture();f.video.videoWidth=10000;f.video.videoHeight=8000;await f.camera.start();await f.camera.capture();assert.ok(f.canvas.width*f.canvas.height<=25000000);
  });
  console.log(JSON.stringify({records,counts:{PASS:records.filter(r=>r.status==='PASS').length,FAIL:records.filter(r=>r.status==='FAIL').length}},null,2));
  if(process.env.CAMERA_TEST_OUT)fs.writeFileSync(process.env.CAMERA_TEST_OUT,JSON.stringify({records},null,2));
  process.exitCode=records.some(r=>r.status==='FAIL')?1:0;
})();
