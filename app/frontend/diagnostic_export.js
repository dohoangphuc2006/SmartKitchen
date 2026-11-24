"use strict";
// User-triggered local downloads only. No HTTP, localStorage, camera or dataset access.
(function(root){
  async function sha256(file){
    const hash=await root.crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  function download(blob,name){
    const url=root.URL.createObjectURL(blob),link=root.document.createElement('a');
    link.href=url;link.download=name;link.click();root.setTimeout(()=>root.URL.revokeObjectURL(url),30000);
  }
  class DiagnosticExport {
    constructor({consent,imageButton,jsonButton,notice,getFile,isBlocked=()=>false,save=download,hash=sha256,now=()=>new Date().toISOString()}){
      Object.assign(this,{consent,imageButton,jsonButton,notice,getFile,isBlocked,save,hash,now});
      this.file=null;this.response=null;this.source='unknown';consent.checked=false;
      consent.addEventListener('change',()=>this.refresh());
      imageButton.addEventListener('click',()=>this.saveImage());
      jsonButton.addEventListener('click',()=>this.saveJSON());this.refresh();
    }
    select(file,source='unknown'){
      this.file=file;this.source=source;this.response=null;this.consent.checked=false;
      this.notice.textContent='Không tự lưu. Chỉ tải tệp khi bạn đồng ý và bấm nút.';this.refresh();
    }
    begin(file){if(file===this.file){this.response=null;this.refresh();}}
    record(file,httpStatus,data,startedAt){
      if(file!==this.file||file!==this.getFile())return;
      const json=JSON.stringify(data);if(typeof json!=='string')return;
      this.response={file,http_status:httpStatus,json,request_started_at_utc:startedAt,response_received_at_utc:this.now()};
      this.refresh();
    }
    allowed(){return this.consent.checked&&this.file&&this.file===this.getFile()&&!this.isBlocked();}
    refresh(){
      this.consent.disabled=this.isBlocked();this.imageButton.disabled=!this.allowed();
      this.jsonButton.disabled=!this.allowed()||!this.response;
    }
    async saveImage(){
      if(!this.allowed())return false;
      try{
        this.save(this.file,this.file.name);
        this.notice.textContent='Đã yêu cầu tải ảnh gốc. Hãy kiểm tra thư mục tải xuống của trình duyệt.';return true;
      }catch(_){this.notice.textContent='Không tải được ảnh gốc. Hãy kiểm tra trình duyệt và thử lại.';return false;}
    }
    async saveJSON(){
      if(!this.allowed()||!this.response)return false;
      const file=this.file,response=this.response;
      try{
        const hash=await this.hash(file);
        if(!this.allowed()||this.file!==file||this.response!==response)return false;
        const value={schema:'smartkitchen.manual-diagnostic-export.v1',purpose:'DEVELOPMENT_DIAGNOSTIC_ONLY',
          exported_at_utc:this.now(),time_scope:'Browser technical event times; not independently verified capture time',
          image:{name:file.name,mime_type:file.type,bytes:file.size,sha256:hash,selection_source:this.source},
          request:{method:'POST',path:'/api/analyze',started_at_utc:response.request_started_at_utc},
          response:{http_status:response.http_status,received_at_utc:response.response_received_at_utc},
          analysis_response:JSON.parse(response.json),
          scope:'Parsed API response unchanged; not raw YOLO tensors or a human-verified annotation. Pantry edits do not overwrite it.',
          ground_truth:null,training_eligible:false,evaluation_eligible:false};
        const base=file.name.replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,150)||'selected-image';
        this.save(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),base+'-analysis.json');
        this.notice.textContent='Đã yêu cầu tải JSON của đúng ảnh. JSON giữ prediction trước khi chỉnh pantry.';return true;
      }catch(_){this.notice.textContent='Không tạo được JSON/hash. Hãy thử lại; chưa có tệp JSON được tải.';return false;}
    }
  }
  root.SmartKitchenDiagnosticExport=DiagnosticExport;
  if(typeof module!=='undefined')module.exports=DiagnosticExport;
})(globalThis);
