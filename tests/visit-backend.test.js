import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID,createHmac} from 'node:crypto';
import {FIELD_SPEC,FIELD_OPTIONS_HEADERS} from '../lib/field-tracking.js';
import {VISIT_HEADERS} from '../lib/visits.js';
import {handleVisits} from '../lib/visit-server.js';
function fixture(){
 const tables={VISITS:[VISIT_HEADERS],DOCTORS:[FIELD_SPEC.DOCTORS.headers,...['D1','D2'].map(id=>FIELD_SPEC.DOCTORS.headers.map(h=>({Doctor_ID:id,Doctor_Name:'Same Name',Camp:'Camp',Specialties:'General',Pharmacy_ID:'PH1',Active:'YES'}[h]||'')))],PHARMACIES:[FIELD_SPEC.PHARMACIES.headers,FIELD_SPEC.PHARMACIES.headers.map(h=>({Pharmacy_ID:'PH1',Pharmacy_Name:'Pharmacy'}[h]||''))],FIELD_OPTIONS:[FIELD_OPTIONS_HEADERS,FIELD_OPTIONS_HEADERS.map(h=>h==='Camps'?'Camp':h==='Call Schedule'?'Everyday':'')]};
 let writes=0;
 const sheet=name=>tables[name]?{getLastRow:()=>tables[name].length,getMaxRows:()=>1000,getRange:(r,c,n=1,w=1)=>({getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>tables[name][r+i-1]?.[c+j-1]??'')),getDisplayValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(tables[name][r+i-1]?.[c+j-1]??''))),setValues:values=>{writes++;values.forEach((row,i)=>{tables[name][r+i-1]??=[];row.forEach((v,j)=>{tables[name][r+i-1][c+j-1]=v;});});},setWrap:()=>{}})}:null;
 const secret='synthetic-visits-secret-only-for-testing',cache=new Map();
 const context=vm.createContext({Date,Intl,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},PropertiesService:{getScriptProperties:()=>({getProperty:()=>secret})},Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(s,k)=>[...createHmac('sha256',k).update(s).digest()],formatDate:v=>v.toISOString().slice(0,10)},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},SpreadsheetApp:{openById:()=>({getSheetByName:sheet,getSpreadsheetTimeZone:()=> 'Etc/GMT'}),flush:()=>{}}});
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 const call=command=>{const payload=JSON.stringify({...command,timestamp:Date.now(),nonce:randomUUID()});return context.doPost({postData:{contents:JSON.stringify({payload,signature:createHmac('sha256',secret).update(payload).digest('hex')})}});};
 return {call,tables,writes:()=>writes};
}
const input=extra=>({localId:randomUUID(),date:'2026-10-03',camp:'Camp',kind:'Visit',doctorIds:['D1','D2'],createdAt:'2026-10-03T10:00:00Z',...extra});
test('signed visit save derives canonical doctor/pharmacy lines, retries without writing, and preserves existing tables',()=>{
 const f=fixture(),v=input(),saved=f.call({action:'visits_write',operation:'save',visit:v});assert.equal(saved.ok,true);assert.equal(saved.visit.doctorCount,2);assert.equal(saved.visit.pharmacyCount,1);assert.equal(f.tables.VISITS.length,2);const writes=f.writes();assert.equal(f.call({action:'visits_write',operation:'save',visit:v}).ok,true);assert.equal(f.writes(),writes);assert.equal(f.tables.DOCTORS.length,3);
 const read=f.call({action:'visits_read'});assert.equal(read.data.visits.length,1);assert.deepEqual(read.data.visits[0].doctorIds,['D1','D2']);
});
test('Undo uses exact visit identity, is idempotent, and a delayed save cannot revive it',()=>{
 const f=fixture(),v=input();f.call({action:'visits_write',operation:'save',visit:v});assert.equal(f.call({action:'visits_write',operation:'undo',visit:v}).visit.active,false);const writes=f.writes();f.call({action:'visits_write',operation:'undo',visit:v});assert.equal(f.writes(),writes);assert.equal(f.call({action:'visits_write',operation:'save',visit:v}).visit.active,false);assert.equal(f.call({action:'visits_read'}).data.visits.length,0);
 const early=input({doctorIds:['D1']});assert.equal(f.call({action:'visits_write',operation:'undo',visit:early}).ok,true);assert.equal(f.call({action:'visits_write',operation:'save',visit:early}).visit.active,false);
});
test('changed retry identity and removed doctor cannot silently save a different or reduced bundle',()=>{
 const f=fixture(),v=input();f.call({action:'visits_write',operation:'save',visit:v});assert.equal(f.call({action:'visits_write',operation:'save',visit:{...v,doctorIds:['D1']}}).ok,false);
 f.tables.DOCTORS.pop();assert.equal(f.call({action:'visits_write',operation:'save',visit:input()}).ok,false);assert.equal(f.tables.VISITS.length,2);
 // A previously committed bundle remains confirmable even after a master record is removed.
 assert.equal(f.call({action:'visits_write',operation:'save',visit:v}).ok,true);
});
test('no-visits days save zero counts; formula-looking names are stored as text',()=>{
 const f=fixture();const result=f.call({action:'visits_write',operation:'save',visit:input({kind:'Leave',doctorIds:[]})});assert.equal(result.visit.doctorCount,0);assert.equal(result.visit.pharmacyCount,0);
 f.tables.DOCTORS[1][1]='=HYPERLINK("https://example.test")';const v=f.call({action:'visits_write',operation:'save',visit:input({doctorIds:['D1']})});assert.equal(v.ok,true);assert.match(f.tables.VISITS.at(-1)[6],/^1\. =HYPERLINK/);
});
test('Visits route accepts only fixed commands and rejects cross-origin requests',async()=>{
 let command;const loader=async c=>{command=c;return {ok:true};};const req=(body,origin='https://example.test')=>new Request('https://example.test/api/visits',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)});
 assert.equal((await handleVisits(req({action:'read',spreadsheet:'elsewhere'}),loader)).status,200);assert.deepEqual(command,{action:'visits_read'});
 assert.equal((await handleVisits(req({action:'read'},'https://other.test'),loader)).status,403);
 assert.equal((await handleVisits(req({action:'delete',table:'DOCTORS'}),loader)).status,400);
});
