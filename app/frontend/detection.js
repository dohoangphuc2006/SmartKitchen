"use strict";
(function(root) {
  function orientedPoint(x,y,w,h,o) {
    return ({2:[w-x,y],3:[w-x,h-y],4:[x,h-y],5:[y,x],6:[h-y,x],7:[h-y,w-x],8:[y,w-x]})[o] || [x,y];
  }
  function projectBox(box, image, width, height) {
    const w=Number(image?.width), h=Number(image?.height), o=Number(image?.exif_orientation)||1;
    if(!(w>0&&h>0&&width>0&&height>0) || !Array.isArray(box.xyxy) || box.xyxy.length!==4 || !box.xyxy.every(Number.isFinite))return null;
    const [x1,y1,x2,y2]=box.xyxy;if(x2<=x1||y2<=y1)return null;
    const points=[[x1,y1],[x2,y1],[x1,y2],[x2,y2]].map(([x,y])=>orientedPoint(Math.max(0,Math.min(w,x)),Math.max(0,Math.min(h,y)),w,h,o));
    const iw=o>=5&&o<=8?h:w, ih=o>=5&&o<=8?w:h;
    const s=Math.min(width/iw,height/ih), ox=(width-iw*s)/2,oy=(height-ih*s)/2;
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    return {x:ox+Math.min(...xs)*s,y:oy+Math.min(...ys)*s,width:(Math.max(...xs)-Math.min(...xs))*s,height:(Math.max(...ys)-Math.min(...ys))*s};
  }
  class BoxOverlay {
    constructor(element,label) {this.element=element;this.label=label;this.last=null;
      this.resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>this.draw()):null;this.resize?.observe(element.parentElement);}
    set(data){this.last=data?.image&&Array.isArray(data.boxes)?data:null;this.draw();}
    clear(){this.set(null);}
    draw(){
      const svg=this.element, width=svg.parentElement.clientWidth,height=svg.parentElement.clientHeight;
      svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
      const occupied=[];
      for(const box of this.last?.boxes||[]) {
        if(box.decision==='REJECT')continue;
        const p=projectBox(box,this.last.image,width,height);if(!p||!Number.isFinite(box.confidence))continue;
        const ns='http://www.w3.org/2000/svg';const rect=document.createElementNS(ns,'rect');
        Object.entries(p).forEach(([k,v])=>rect.setAttribute(k,String(v)));
        rect.setAttribute('class','detection-box');svg.append(rect);
        if(box.decision==='REVIEW')rect.setAttribute('stroke-dasharray','6 4');
        const text=document.createElementNS(ns,'text');text.setAttribute('x',String(Math.max(2,p.x+3)));text.setAttribute('y',String(Math.min(height-3,Math.max(17,p.y+17))));
        text.setAttribute('class','detection-label');text.textContent=box.decision==='REVIEW'
          ? `${this.last.reviewPrefix || 'Có thể là'} ${this.label(box.name)}`
          : `${this.label(box.name)} ${Math.round(box.confidence*100)}%`;svg.append(text);
        const measured=text.getComputedTextLength?.()||text.textContent.length*8;
        const length=Math.min(measured,Math.max(1,width-10));
        if(measured>length){text.setAttribute('textLength',String(length));text.setAttribute('lengthAdjust','spacingAndGlyphs');}
        const x=Math.max(4,Math.min(p.x+3,width-length-6));let y=Math.min(height-3,Math.max(17,p.y+17));
        for(const offset of [17,-4,35,53,71]){
          const candidate=Math.min(height-3,Math.max(17,p.y+offset));
          if(!occupied.some(r=>x<r.x+r.w+2&&x+length+2>r.x&&candidate-16<r.y+2&&candidate>r.y-18)){y=candidate;break;}
        }
        text.setAttribute('x',String(x));text.setAttribute('y',String(y));occupied.push({x,y,w:length});
      }
    }
  }
  class LiveDetection {
    constructor({video,overlay,onMetrics=()=>{},onError=()=>{},interval=1100,fetchFrame}) {
      Object.assign(this,{video,overlay,onMetrics,onError,interval,fetchFrame});this.generation=0;this.inFlight=false;this.active=false;
    }
    stop(){this.active=false;this.generation++;clearTimeout(this.timer);clearTimeout(this.expiry);this.abort?.abort();this.overlay.clear();}
    start(){this.stop();this.active=true;this.count=0;this.firstStarted=0;this.tick(this.generation);}
    async tick(generation){
      if(!this.active||generation!==this.generation)return;
      if(this.inFlight||this.video.readyState<2){this.timer=setTimeout(()=>this.tick(generation),this.interval);return;}
      this.inFlight=true;this.abort=new AbortController();const requestAbort=this.abort;
      const timeout=setTimeout(()=>requestAbort.abort(),10000);const started=performance.now();let delay=this.interval;
      if(!this.firstStarted)this.firstStarted=started;
      try {
        const canvas=document.createElement('canvas'),s=Math.min(1,640/Math.max(this.video.videoWidth,this.video.videoHeight));
        canvas.width=Math.max(1,Math.round(this.video.videoWidth*s));canvas.height=Math.max(1,Math.round(this.video.videoHeight*s));
        canvas.getContext('2d').drawImage(this.video,0,0,canvas.width,canvas.height);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));
        if(!blob||generation!==this.generation)return;
        const response=await this.fetchFrame(blob,this.abort.signal);
        if(generation!==this.generation)return;
        if(response.status===429){delay=Math.max(2000,1000*Number(response.headers.get('Retry-After')||1));this.overlay.clear();this.onError('Bộ nhận diện đang bận. Hãy chờ một chút.');return;}
        const data=await response.json();
        // Camera stop/restart or request timeout may happen while the body is read.
        if(generation!==this.generation||!this.active||requestAbort.signal.aborted)return;
        if(!response.ok||!data.success)throw Error(data.error||'DETECTOR_ERROR');
        const now=performance.now();
        const visible=data.scope?.profile==='fridge30_precision_guard' ? {...data,boxes:[]} : data;
        this.overlay.set(now-started<=1800?visible:null);clearTimeout(this.expiry);
        this.expiry=setTimeout(()=>this.overlay.clear(),Math.max(0,1800-(now-started)));
        this.count++;
        this.onMetrics({latency_ms:now-started,inference_ms:data.detection_ms,completed:this.count,elapsed_ms:now-this.firstStarted,fps:this.count>1?(this.count-1)*1000/(now-this.firstStarted):0,
          scope:data.scope,boxes:data.boxes,excluded_detections:data.excluded_detections});
      } catch(e) {if(generation===this.generation){this.overlay.clear();this.onError('Không thể nhận diện trực tiếp. Bạn vẫn có thể chụp hoặc tải ảnh lên.');delay=3000;}}
      finally {clearTimeout(timeout);this.inFlight=false;if(this.active&&generation===this.generation)this.timer=setTimeout(()=>this.tick(generation),Math.max(delay-(performance.now()-started),100));}
    }
  }
  root.SmartKitchenDetection={BoxOverlay,LiveDetection,projectBox};
  if(typeof module!=='undefined')module.exports={projectBox};
})(globalThis);
