import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID,createHmac} from 'node:crypto';
import {FIELD_SPEC,validateFieldRecord,fieldProducts,latestPharmacyStock,targetActual,indiaToday} from '../lib/field-tracking.js';
import {handleFields,fieldBackend,shareFieldReads} from '../lib/field-server.js';
const source=()=>({...Object.fromEntries(Object.keys(FIELD_SPEC).map(k=>[k,[]])),DOCTORS:[{Doctor_ID:'D1',Doctor_Name:'Doctor One',Pharmacy_ID:'P1'},{Doctor_ID:'D2',Pharmacy_ID:'P1'}],PHARMACIES:[{Pharmacy_ID:'P1'}],products:[{Product_SKU:'SYP',Product_Name:'Product syrup'},{Product_SKU:'DROPS',Product_Name:'Product drops'}],agencies:['AGENCY']});
const rx=()=>({Rx_ID:randomUUID(),Reported_Date:'2026-10-02',Doctor_ID:'D1',Pharmacy_ID:'P1',Product_SKU:'SYP',Confirmation:'REPORTED'});
test('a temporary non-JSON backend response is retried with a new signed request',async()=>{
 const oldUrl=process.env.APPS_SCRIPT_URL,oldSecret=process.env.MEDMETRIC_BACKEND_SECRET;
 process.env.APPS_SCRIPT_URL='https://script.google.com/macros/s/test/exec';process.env.MEDMETRIC_BACKEND_SECRET='synthetic-backend-secret-for-retry-123456789';
 const packets=[];try{const result=await fieldBackend({action:'field_read'},async(url,options)=>{packets.push(JSON.parse(options.body));return packets.length===1?new Response('<html>Temporary upstream response</html>',{status:200,headers:{'Content-Type':'text/html'}}):Response.json({ok:true,data:{products:[]}});});assert.equal(result.ok,true);assert.equal(packets.length,2);assert.notEqual(JSON.parse(packets[0].payload).nonce,JSON.parse(packets[1].payload).nonce);}
 finally{if(oldUrl===undefined)delete process.env.APPS_SCRIPT_URL;else process.env.APPS_SCRIPT_URL=oldUrl;if(oldSecret===undefined)delete process.env.MEDMETRIC_BACKEND_SECRET;else process.env.MEDMETRIC_BACKEND_SECRET=oldSecret;}
});
test('simultaneous field reads share a request, while refresh reads again and writes remain separate',async()=>{
 let calls=0,release;const loader=shareFieldReads(async command=>{calls++;if(command.action==='field_read')await new Promise(r=>{release=r;});return {ok:true};});
 const a=loader({action:'field_read'}),b=loader({action:'field_read'});await Promise.resolve();assert.equal(calls,1);await loader({action:'field_save'});assert.equal(calls,2);release();await Promise.all([a,b]);const c=loader({action:'field_read'});await Promise.resolve();assert.equal(calls,3);release();await c;
});
test('retries stay bounded and do not retry stale edits or permanent authorization failures',async()=>{
 const oldUrl=process.env.APPS_SCRIPT_URL,oldSecret=process.env.MEDMETRIC_BACKEND_SECRET;process.env.APPS_SCRIPT_URL='https://script.google.com/macros/s/test/exec';process.env.MEDMETRIC_BACKEND_SECRET='synthetic-backend-secret-for-retry-123456789';
 try{
 let calls=0;await assert.rejects(()=>fieldBackend({action:'field_read'},async()=>{calls++;return new Response('HTML');}),/invalid response/);assert.equal(calls,2);
 calls=0;await assert.rejects(()=>fieldBackend({action:'field_save',operation:'update'},async()=>{calls++;throw new DOMException('timeout','TimeoutError');}),/Refresh data to check/);assert.equal(calls,1);
 calls=0;await assert.rejects(()=>fieldBackend({action:'field_read'},async()=>{calls++;return Response.json({ok:false,error:'Unauthorized'});}),/Update the deployed/);assert.equal(calls,1);
 calls=0;const saved=await fieldBackend({action:'field_save',operation:'create',record:{Rx_ID:'same-id'}},async()=>{calls++;if(calls===1)throw new DOMException('timeout','TimeoutError');return Response.json({ok:true,record:{Rx_ID:'same-id'},alreadySaved:true});});assert.equal(saved.alreadySaved,true);assert.equal(calls,2);
 }finally{if(oldUrl===undefined)delete process.env.APPS_SCRIPT_URL;else process.env.APPS_SCRIPT_URL=oldUrl;if(oldSecret===undefined)delete process.env.MEDMETRIC_BACKEND_SECRET;else process.env.MEDMETRIC_BACKEND_SECRET=oldSecret;}
});
test('unknown prescription dates and quantities stay unknown, while stock zero is valid',()=>{
 const d=source(),r=validateFieldRecord('RX_ACTIVITY',rx(),d,'2026-10-02');assert.equal(r.Prescription_Date,'');assert.equal(r.Quantity,'');
 const stock=validateFieldRecord('PHARMACY_STOCK_CHECKS',{Stock_Check_ID:randomUUID(),Checked_Date:'2026-10-01',Pharmacy_ID:'P1',Product_SKU:'SYP',Remaining_Units:0,Quantity_Unit:'BOTTLE',Source:'PHARMACIST'},d,'2026-10-02');assert.equal(stock.Remaining_Units,0);
});
test('writes reject invalid dates, unknown product IDs and source financial tables',()=>{
 const d=source();for(const patch of [{Product_SKU:'Product syrup'},{Doctor_ID:'unknown'},{Prescription_Date:'2026-02-30'},{Prescription_Date:'2026-10-03'},{Quantity:-1},{Quantity:3},{Rx_ID:'------------------------------------'}])assert.throws(()=>validateFieldRecord('RX_ACTIVITY',{...rx(),...patch},d,'2026-10-02'));
 assert.throws(()=>validateFieldRecord('MONTHLY_TOTALS',{},d));assert.throws(()=>validateFieldRecord('DOCTORS',{},d));
});
test('existing catalogue preserves separate SKUs; conflicting canonical names fail',()=>{
 const config=[{Your_SKU:'SYP',Your_Product_Name:'Product syrup',Your_Status:'ACTIVE',Include_In_Charts:'YES'},{Your_SKU:'DROPS',Your_Product_Name:'Product drops',Your_Status:'ACTIVE',Include_In_Charts:'YES'}];assert.equal(fieldProducts(config).length,2);assert.throws(()=>fieldProducts([...config,{...config[0],Your_Product_Name:'Another name'}]));
});
test('shared pharmacy stock keeps the latest observation per SKU and unit, never a sum',()=>{
 const rows=[{Pharmacy_ID:'P1',Product_SKU:'SYP',Quantity_Unit:'BOTTLE',Checked_Date:'2026-09-29',Remaining_Units:10},{Pharmacy_ID:'P1',Product_SKU:'SYP',Quantity_Unit:'BOTTLE',Checked_Date:'2026-10-01',Remaining_Units:0},{Pharmacy_ID:'P1',Product_SKU:'SYP',Quantity_Unit:'PACK',Checked_Date:'2026-10-01',Remaining_Units:2}];const latest=latestPharmacyStock(rows);assert.equal(latest.length,2);assert.equal(latest.find(r=>r.Quantity_Unit==='BOTTLE').Remaining_Units,0);
});
test('secondary targets count every agency sale and never add prescriptions or POBs',()=>{
 const d=source();d.RX_ACTIVITY=[{Quantity:999}];d.POB_ACTIVITY=[{Booked_Units:999}];assert.equal(targetActual({Metric:'SECONDARY_REVENUE',Month:'2026-09'},d,[{month:'2026-09',agency:'A',secondary:100},{month:'2026-09',agency:'B',secondary:70}]),170);assert.equal(targetActual({Metric:'SECONDARY_REVENUE',Month:'2026-09',Agency:'B'},d,[{month:'2026-09',agency:'B',secondary:null}]),null);
 assert.throws(()=>validateFieldRecord('TARGETS',{Target_ID:randomUUID(),Month:'2026-10',Scope:'DOCTOR',Doctor_ID:'D1',Metric:'SECONDARY_REVENUE',Target_Value:100,Active:'YES'},d));
});
test('activity targets separate units and exclude unknown dates and cancelled bookings',()=>{
 const d=source();d.RX_ACTIVITY=[{Doctor_ID:'D1',Prescription_Date:'2026-10-01',Quantity:2,Quantity_Unit:'BOTTLE'},{Doctor_ID:'D1',Prescription_Date:'',Quantity:100,Quantity_Unit:'BOTTLE'},{Doctor_ID:'D1',Prescription_Date:'2026-10-01',Quantity:10,Quantity_Unit:'PACK'}];const target={Metric:'RX_UNITS',Month:'2026-10',Quantity_Unit:'BOTTLE'};assert.equal(targetActual(target,d,[]),2);d.RX_ACTIVITY.push({Prescription_Date:'2026-10-01',Quantity:'',Quantity_Unit:''});assert.equal(targetActual(target,d,[]),null);
 d.POB_ACTIVITY=[{Booking_Date:'2026-10-01',Status:'CANCELLED',Booked_Units:20,Quantity_Unit:'BOTTLE'}];assert.equal(targetActual({...target,Metric:'POB_UNITS'},d,[]),0);
});
test('completed follow-ups and fulfilled POBs require consistent evidence',()=>{
 const d=source();assert.throws(()=>validateFieldRecord('FOLLOW_UPS',{Follow_Up_ID:randomUUID(),Doctor_ID:'D1',Due_Date:'2026-10-01',Reason:'STOCK_CHECK',Status:'DONE'},d,'2026-10-02'));
 assert.throws(()=>validateFieldRecord('POB_ACTIVITY',{POB_ID:randomUUID(),Booking_Date:'2026-10-01',Pharmacy_ID:'P1',Product_SKU:'SYP',Booked_Units:3,Quantity_Unit:'BOTTLE',Status:'FULFILLED',Fulfilled_Units:2,Fulfilled_Date:'2026-10-02'},d,'2026-10-02'));
});
test('activity dates use India at the UTC day boundary',()=>{assert.equal(indiaToday(new Date('2026-10-01T20:00:00Z')),'2026-10-02');});
test('public edit API passes only a fixed save command and rejects cross-origin requests',async()=>{
 let calls=0;const loader=async c=>{calls++;assert.equal(c.action,'field_save');return {ok:true,record:c.record};};const body={action:'save',table:'RX_ACTIVITY',operation:'create',record:rx()};
 const req=origin=>new Request('https://example.test/api/fields',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)});
 assert.equal((await handleFields(req('https://example.test'),loader)).status,200);assert.equal((await handleFields(req('https://other.test'),loader)).status,403);assert.equal(calls,1);
});
function backendFixture(){
 const d=source(),tables=Object.fromEntries(Object.entries(FIELD_SPEC).map(([k,s])=>[k,[s.headers,...d[k].map(r=>s.headers.map(h=>r[h]||''))]]));
 tables.PRODUCT_CONFIG=[['Your_SKU','Your_Product_Name','Your_Status','Include_In_Charts'],['SYP','Product syrup','ACTIVE','YES'],['DROPS','Product drops','ACTIVE','YES']];
 tables.MONTHLY_TOTALS=[['','','','','','','Agency'],['','','','','','','AGENCY']];
 const calls={reads:[],writes:0};
 const sheet=name=>({getLastRow:()=>tables[name].length,getMaxRows:()=>1000,getRange:(row,col,count,width)=>({getValues:()=>{calls.reads.push(name);return Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>tables[name][row+i-1]?.[col+j-1]??''));},setValues:values=>{calls.writes++;for(let i=0;i<values.length;i++){tables[name][row+i-1]??=[];for(let j=0;j<values[i].length;j++)tables[name][row+i-1][col+j-1]=values[i][j];}}})});
 const secret='synthetic-field-secret-12345678901234567890',cache=new Map();
 const context=vm.createContext({Date,Intl,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},PropertiesService:{getScriptProperties:()=>({getProperty:()=>secret})},Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(s,k)=>[...createHmac('sha256',k).update(s).digest()],formatDate:(v,tz)=>tz==='Asia/Kolkata'?indiaToday(v):v.toISOString().slice(0,10)},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},SpreadsheetApp:{openById:()=>({getSpreadsheetTimeZone:()=> 'Etc/GMT',getSheetByName:sheet}),flush:()=>{}}});
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 function call(command){const payload=JSON.stringify({...command,timestamp:Date.now(),nonce:randomUUID()});return context.doPost({postData:{contents:JSON.stringify({payload,signature:createHmac('sha256',secret).update(payload).digest('hex')})}});}
 return {tables,call,calls};
}
test('signed backend saves once, retries idempotently and leaves pharmacy stock and revenue untouched',()=>{
 const f=backendFixture(),before=JSON.stringify([f.tables.PHARMACY_STOCK_CHECKS,f.tables.MONTHLY_TOTALS]),r=rx();const first=f.call({action:'field_save',table:'RX_ACTIVITY',operation:'create',record:r});assert.equal(first.ok,true,first.error);const again=f.call({action:'field_save',table:'RX_ACTIVITY',operation:'create',record:r});assert.equal(again.alreadySaved,true);assert.equal(f.tables.RX_ACTIVITY.length,2);assert.equal(JSON.stringify([f.tables.PHARMACY_STOCK_CHECKS,f.tables.MONTHLY_TOTALS]),before);
 const read=f.call({action:'field_read'});assert.equal(read.ok,true,read.error);assert.equal(read.data.RX_ACTIVITY[0].Doctor_ID,'D1');assert.equal(read.data.products.length,2);
});
test('signed backend rejects master/financial edits and saves notes as literal text',()=>{
 const f=backendFixture();assert.equal(f.call({action:'field_save',table:'MONTHLY_TOTALS',operation:'create',record:{}}).ok,false);
 const result=f.call({action:'field_save',table:'RX_ACTIVITY',operation:'create',record:{...rx(),Notes:'=1+1'}});assert.equal(result.ok,true,result.error);assert.equal(f.tables.RX_ACTIVITY[1][9],"'=1+1");
});
test('a stale edit cannot overwrite another saved edit',()=>{
 const f=backendFixture(),r=rx(),created=f.call({action:'field_save',table:'RX_ACTIVITY',operation:'create',record:r}).record;
 const changed=f.call({action:'field_save',table:'RX_ACTIVITY',operation:'update',record:{...created,Notes:'New information'},previous:created});assert.equal(changed.ok,true,changed.error);
 const stale=f.call({action:'field_save',table:'RX_ACTIVITY',operation:'update',record:{...created,Notes:'Outdated information'},previous:created});assert.equal(stale.ok,false);assert.match(stale.error,/changed since/);assert.equal(f.tables.RX_ACTIVITY[1][9],'New information');
});
test('Apps Script uses exactly the shared validation code',()=>{
 const shared=fs.readFileSync(new URL('../lib/field-tracking.js',import.meta.url),'utf8').replace(/^export /gm,'');const backend=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');assert.ok(backend.includes(shared));
});

test('doctor products batch validates before writing and safely retries every selected product',()=>{
 const f=backendFixture(),record={Doctor_ID:'D1',Pharmacy_ID:'P1',Relationship:'EXISTING',Active:'YES'},links=[{Link_ID:randomUUID(),Product_SKU:'SYP'},{Link_ID:randomUUID(),Product_SKU:'DROPS'}];
 const command={action:'field_save',table:'DOCTOR_PRODUCTS',operation:'create',record,links};
 const invalid=f.call({...command,links:[links[0],{...links[1],Product_SKU:'UNKNOWN'}]});assert.equal(invalid.ok,false);assert.equal(f.tables.DOCTOR_PRODUCTS.length,1);
 f.calls.reads=[];const first=f.call(command);assert.equal(first.ok,true,first.error);assert.equal(f.calls.writes,1);assert.deepEqual(f.calls.reads,['DOCTORS','PHARMACIES','DOCTOR_PRODUCTS','PRODUCT_CONFIG']);assert.equal(first.records.length,2);assert.equal(f.tables.DOCTOR_PRODUCTS.length,3);
 const retry=f.call(command);assert.equal(retry.alreadySaved,true);assert.equal(f.tables.DOCTOR_PRODUCTS.length,3);
 const duplicate=f.call({...command,links:[links[0],{...links[1],Product_SKU:'SYP'}]});assert.equal(duplicate.ok,false);
});
