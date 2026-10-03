import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHmac,randomUUID} from 'node:crypto';
function fixture(){
  const secret='synthetic-backend-secret-for-tests-123456';
  let reads=0;const ranges=[];const cache=new Map();
  const context=vm.createContext({Date,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},PropertiesService:{getScriptProperties:()=>({getProperty:()=>secret})},Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(text,key)=>[...createHmac('sha256',key).update(text).digest()].map(b=>b>127?b-256:b),formatDate:(value,tz)=>{assert.equal(typeof tz,'string');return value.toISOString().slice(0,10);}},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},SpreadsheetApp:{openById:()=>{reads++;return {getSpreadsheetTimeZone:()=>null,getSheetByName:name=>name==='PRICE_LIST'?null:({getLastRow:()=>2,getRange:(row,col,count,width)=>{ranges.push([name,width]);return {getValues:()=>[['Month'],[new Date('2026-09-01T00:00:00Z')]]};}})}}}});
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
  const packet=(extra={})=>{const payload=JSON.stringify({action:'read',timestamp:Date.now(),nonce:randomUUID(),...extra});return {payload,signature:createHmac('sha256',secret).update(payload).digest('hex')};};
  return {context,packet,call:p=>context.doPost({postData:{contents:JSON.stringify(p)}}),reads:()=>reads,ranges};
}
test('public GET never reads or returns spreadsheet data',()=>{const f=fixture();assert.equal(f.context.doGet().service,'MedMetric');assert.equal(f.reads(),0);});
test('missing signature, tampered payload and expired requests cannot read sheets',()=>{const f=fixture();const p=f.packet();for(const bad of [{}, {...p,payload:p.payload+' '},f.packet({timestamp:Date.now()-120000})])assert.equal(f.call(bad).ok,false);assert.equal(f.reads(),0);});
test('signed requests read only fixed columns; replay is rejected',()=>{const f=fixture(),p=f.packet();const result=f.call(p);assert.equal(result.ok,true);assert.deepEqual(f.ranges,[['MONTHLY_TOTALS',14],['SALES_RAW',19],['PRODUCT_CONFIG',12]]);assert.equal(result.valueRanges[0].values[1][0],'2026-09-01');assert.equal(f.call(p).ok,false);assert.equal(f.reads(),1);});
