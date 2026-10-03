import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID,createHmac} from 'node:crypto';
import {FIELD_SPEC,FIELD_OPTIONS_HEADERS,validateFieldRecord,fieldProducts,targetActual,indiaToday,nextDoctorId} from '../lib/field-tracking.js';
import {handleFields,fieldBackend,shareFieldReads} from '../lib/field-server.js';
const source=()=>({...Object.fromEntries(Object.keys(FIELD_SPEC).map(k=>[k,[]])),DOCTORS:[{Doctor_ID:'D1',Doctor_Name:'Doctor One',Pharmacy_ID:'P1'},{Doctor_ID:'D2',Pharmacy_ID:'P1'}],PHARMACIES:[{Pharmacy_ID:'P1',Pharmacy_Name:'Original pharmacy',Area:'Area',Camp:'Proddatur'}],products:[{Product_SKU:'SYP',Product_Name:'Product syrup',Active:true},{Product_SKU:'DROPS',Product_Name:'Product drops',Active:true}],agencies:['AGENCY'],options:{Areas:['Area'],Camps:['Proddatur','Jammalamadugu'],Specialties:['General'],Potentials:['A']}});
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
test('unknown prescription dates and quantities stay unknown',()=>{
 const d=source(),r=validateFieldRecord('RX_ACTIVITY',rx(),d,'2026-10-02');assert.equal(r.Prescription_Date,'');assert.equal(r.Quantity,'');
});
test('writes reject invalid dates, unknown product IDs and source financial tables',()=>{
 const d=source();for(const patch of [{Product_SKU:'Product syrup'},{Doctor_ID:'unknown'},{Prescription_Date:'2026-02-30'},{Prescription_Date:'2026-10-03'},{Quantity:-1},{Quantity:3},{Rx_ID:'------------------------------------'}])assert.throws(()=>validateFieldRecord('RX_ACTIVITY',{...rx(),...patch},d,'2026-10-02'));
 assert.throws(()=>validateFieldRecord('MONTHLY_TOTALS',{},d));assert.throws(()=>validateFieldRecord('DOCTORS',{},d));
});
test('existing catalogue preserves separate SKUs; conflicting canonical names fail',()=>{
 const config=[{Your_SKU:'SYP',Your_Product_Name:'Product syrup',Your_Status:'ACTIVE',Include_In_Charts:'YES'},{Your_SKU:'DROPS',Your_Product_Name:'Product drops',Your_Status:'ACTIVE',Include_In_Charts:'YES'}];assert.equal(fieldProducts(config).length,2);assert.throws(()=>fieldProducts([...config,{...config[0],Your_Product_Name:'Another name'}]));
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
 const d=source(),tables=Object.fromEntries(Object.entries(FIELD_SPEC).map(([k,s])=>[k,[[...s.headers],...d[k].map(r=>s.headers.map(h=>r[h]||''))]]));
 tables.PHARMACY_STOCK_CHECKS=[['Stock_Check_ID'],['retired-stock-check']];
 tables.PRODUCT_CONFIG=[['Your_SKU','Your_Product_Name','Your_Status','Include_In_Charts'],['SYP','Product syrup','ACTIVE','YES'],['DROPS','Product drops','ACTIVE','YES']];
 tables.MONTHLY_TOTALS=[['','','','','','','Agency'],['','','','','','','AGENCY']];
 tables.FIELD_OPTIONS=[FIELD_OPTIONS_HEADERS,...Array.from({length:2},(_,i)=>FIELD_OPTIONS_HEADERS.map(h=>({Areas:d.options.Areas,Camps:d.options.Camps,Specialties:d.options.Specialties,Potentials:d.options.Potentials}[h]||[])[i]||''))];
 const calls={reads:[],writes:0,timezones:0,failNextLinkWrite:false};
 const sheet=name=>{
  if(!tables[name])return null;
  const read=(row,col,count,width)=>Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>tables[name][row+i-1]?.[col+j-1]??''));
  const write=(row,col,values)=>{if(name==='DOCTOR_PRODUCTS'&&calls.failNextLinkWrite){calls.failNextLinkWrite=false;throw Error('Interrupted product write');}calls.writes++;for(let i=0;i<values.length;i++){tables[name][row+i-1]??=[];for(let j=0;j<values[i].length;j++)tables[name][row+i-1][col+j-1]=values[i][j];}};
  return {getSheetId:()=>({RX_ACTIVITY:610020103,FOLLOW_UPS:610020105,TARGETS:610020106,PHARMACY_STOCK_CHECKS:610020104}[name]||1),getLastRow:()=>tables[name].length,getMaxRows:()=>1000,getMaxColumns:()=>Math.max(...tables[name].map(row=>row.length)),insertColumnsAfter:()=>{},hideColumns:()=>{},getRange:(row,col,count=1,width=1)=>({getValue:()=>read(row,col,1,1)[0][0],getDisplayValues:()=>read(row,col,count,width).map(r=>r.map(String)),getValues:()=>{calls.reads.push(name);return read(row,col,count,width);},setValue:value=>write(row,col,[[value]]),setValues:values=>write(row,col,values)})};
 };
 const secret='synthetic-field-secret-12345678901234567890',cache=new Map();
 const context=vm.createContext({Date,Intl,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},PropertiesService:{getScriptProperties:()=>({getProperty:()=>secret})},Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(s,k)=>[...createHmac('sha256',k).update(s).digest()],formatDate:(v,tz)=>tz==='Asia/Kolkata'?indiaToday(v):v.toISOString().slice(0,10)},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},SpreadsheetApp:{openById:()=>({getSpreadsheetTimeZone:()=>{calls.timezones++;return 'Etc/GMT';},getSheetByName:sheet,deleteSheet:sheet=>{for(const name of ['RX_ACTIVITY','FOLLOW_UPS','TARGETS','PHARMACY_STOCK_CHECKS'])if(tables[name]&&({RX_ACTIVITY:610020103,FOLLOW_UPS:610020105,TARGETS:610020106,PHARMACY_STOCK_CHECKS:610020104}[name]===sheet.getSheetId()))delete tables[name];}}),flush:()=>{}}});
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 function call(command){const payload=JSON.stringify({...command,timestamp:Date.now(),nonce:randomUUID()});return context.doPost({postData:{contents:JSON.stringify({payload,signature:createHmac('sha256',secret).update(payload).digest('hex')})}});}
 return {tables,call,calls};
}

test('a missing Google response retries delivery without replaying a committed doctor edit',async()=>{
 const f=backendFixture(),created=f.call({action:'field_save',table:'DOCTORS',operation:'create',requestId:randomUUID(),pharmacyName:'Original pharmacy',record:{Doctor_Name:'Delivery Doctor',Area:'Area',Camp:'Proddatur',Active:'YES',Prescriber_Status:'NRx'}});
 const command={action:'field_save',table:'DOCTORS',operation:'update',record:{...created.record,Notes:'Saved edit'},previous:created.record,pharmacyName:'Original pharmacy'};
 const oldUrl=process.env.APPS_SCRIPT_URL,oldSecret=process.env.MEDMETRIC_BACKEND_SECRET;process.env.APPS_SCRIPT_URL='https://script.google.com/macros/s/test/exec';process.env.MEDMETRIC_BACKEND_SECRET='synthetic-backend-secret-for-retry-123456789';
 try{
  for(const failure of ['missing','timeout']){
   let posts=0,gets=0,committed;const delivery='https://script.googleusercontent.com/macros/echo?synthetic=delivery';
   const result=await fieldBackend(command,async(url,options)=>{
    if(options.method==='POST'){posts++;committed=f.call(JSON.parse(JSON.parse(options.body).payload));return new Response(null,{status:302,headers:{location:delivery}});}
    assert.equal(url,delivery);assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    if(++gets===1){if(failure==='timeout')throw new DOMException('Lost response','TimeoutError');return new Response('Missing content',{status:404});}
    return Response.json(committed);
   });
   assert.equal(result.record.Notes,'Saved edit');assert.equal(posts,1);assert.equal(gets,2);
  }
 }finally{if(oldUrl===undefined)delete process.env.APPS_SCRIPT_URL;else process.env.APPS_SCRIPT_URL=oldUrl;if(oldSecret===undefined)delete process.env.MEDMETRIC_BACKEND_SECRET;else process.env.MEDMETRIC_BACKEND_SECRET=oldSecret;}
});

test('retrying a doctor edit after its response is lost confirms the saved edit without another write',()=>{
 const f=backendFixture();
 const created=f.call({action:'field_save',table:'DOCTORS',operation:'create',requestId:randomUUID(),pharmacyName:'Original pharmacy',record:{Doctor_ID:'',Doctor_Name:'Retry Doctor',Area:'Area',Camp:'Proddatur',Active:'YES',Prescriber_Status:'NRx'}});assert.equal(created.ok,true,created.error);
 const command={action:'field_save',table:'DOCTORS',operation:'update',record:{...created.record,Notes:'Saved before timeout'},previous:created.record,pharmacyName:'Original pharmacy'};
 const committed=f.call(command);assert.equal(committed.ok,true,committed.error);
 const writes=f.calls.writes,retry=f.call(command);assert.equal(retry.ok,true,retry.error);assert.equal(retry.alreadySaved,true);assert.equal(f.calls.writes,writes);assert.deepEqual(retry.record,committed.record);
});

test('doctor save reads the spreadsheet timezone once rather than once per cell',()=>{
 const f=backendFixture();
 for(let i=0;i<3;i++)f.tables.DOCTORS.push(FIELD_SPEC.DOCTORS.headers.map(h=>h==='Doctor_ID'?'IMPORTED-'+i:h==='OP_Timing'?new Date('2026-10-02T12:00:00Z'):''));
 const command={action:'field_save',table:'DOCTORS',operation:'create',requestId:randomUUID(),pharmacyName:'Original pharmacy',record:{Doctor_ID:'',Doctor_Name:'Fast Doctor',Area:'Area',Camp:'Proddatur',Active:'YES',Prescriber_Status:'NRx'}};
 const result=f.call(command);assert.equal(result.ok,true,result.error);assert.ok(f.calls.timezones<=1,'Repeated spreadsheet service calls: '+f.calls.timezones);
});

test('the doctor save connection recovers a lost response and preserves real edit conflicts',async()=>{
 const f=backendFixture(),created=f.call({action:'field_save',table:'DOCTORS',operation:'create',requestId:randomUUID(),pharmacyName:'Original pharmacy',record:{Doctor_ID:'',Doctor_Name:'Transport Doctor',Area:'Area',Camp:'Proddatur',Active:'YES',Prescriber_Status:'NRx'}});assert.equal(created.ok,true,created.error);
 const command={action:'field_save',table:'DOCTORS',operation:'update',record:{...created.record,Notes:'Recovered edit'},previous:created.record,pharmacyName:'Original pharmacy'};
 const oldUrl=process.env.APPS_SCRIPT_URL,oldSecret=process.env.MEDMETRIC_BACKEND_SECRET;process.env.APPS_SCRIPT_URL='https://script.google.com/macros/s/test/exec';process.env.MEDMETRIC_BACKEND_SECRET='synthetic-transport-secret-123456789012345';
 try{
  let calls=0;const saved=await fieldBackend(command,async(url,options)=>{calls++;const result=f.call(JSON.parse(JSON.parse(options.body).payload));if(calls===1)throw new DOMException('Lost response','TimeoutError');return Response.json(result);});
  assert.equal(saved.record.Notes,'Recovered edit');assert.equal(saved.alreadySaved,true);assert.equal(calls,2);
  calls=0;await assert.rejects(()=>fieldBackend({...command,record:{...command.record,Notes:'A conflicting edit'}},async(url,options)=>{calls++;return Response.json(f.call(JSON.parse(JSON.parse(options.body).payload)));}),/changed since/);assert.equal(calls,1);
 }finally{if(oldUrl===undefined)delete process.env.APPS_SCRIPT_URL;else process.env.APPS_SCRIPT_URL=oldUrl;if(oldSecret===undefined)delete process.env.MEDMETRIC_BACKEND_SECRET;else process.env.MEDMETRIC_BACKEND_SECRET=oldSecret;}
});

test('retrying an interrupted Rx edit finishes its products without rewriting or duplicating the doctor',()=>{
 const f=backendFixture(),created=f.call({action:'field_save',table:'DOCTORS',operation:'create',requestId:randomUUID(),pharmacyName:'Original pharmacy',record:{Doctor_ID:'',Doctor_Name:'Interrupted Doctor',Area:'Area',Camp:'Proddatur',Active:'YES',Prescriber_Status:'NRx'}});assert.equal(created.ok,true,created.error);
 const command={action:'field_save',table:'DOCTORS',operation:'update',record:{...created.record,Prescriber_Status:'Rx'},previous:created.record,pharmacyName:'Original pharmacy',doctorProducts:[{Link_ID:randomUUID(),Product_SKU:'SYP'}]};
 f.calls.failNextLinkWrite=true;const interrupted=f.call(command);assert.equal(interrupted.ok,false);assert.match(interrupted.error,/Interrupted product write/);
 const doctors=JSON.stringify(f.tables.DOCTORS),writes=f.calls.writes,retried=f.call(command);assert.equal(retried.ok,true,retried.error);assert.equal(retried.doctorProducts.length,1);assert.equal(JSON.stringify(f.tables.DOCTORS),doctors);assert.equal(f.calls.writes,writes+1);
 const confirmed=f.call(command);assert.equal(confirmed.ok,true,confirmed.error);assert.equal(f.calls.writes,writes+1);assert.equal(f.tables.DOCTOR_PRODUCTS.length,2);
});

test('doctor update confirmation still requires the previous record',()=>{
 const f=backendFixture(),created=f.call({action:'field_save',table:'DOCTORS',operation:'create',requestId:randomUUID(),pharmacyName:'Original pharmacy',record:{Doctor_ID:'',Doctor_Name:'Previous Doctor',Area:'Area',Camp:'Proddatur',Active:'YES',Prescriber_Status:'NRx'}});assert.equal(created.ok,true,created.error);
 const writes=f.calls.writes,result=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:created.record,pharmacyName:'Original pharmacy'});assert.equal(result.ok,false);assert.match(result.error,/changed since/);assert.equal(f.calls.writes,writes);
});
test('signed backend saves once, retries idempotently and leaves pharmacy stock and revenue untouched',()=>{
 const f=backendFixture(),before=JSON.stringify([f.tables.PHARMACY_STOCK_CHECKS,f.tables.MONTHLY_TOTALS]),r=({POB_ID:randomUUID(),Booking_Date:'2026-10-02',Doctor_ID:'D1',Pharmacy_ID:'P1',Product_SKU:'SYP',Booked_Units:10,Quantity_Unit:'BOTTLE',Status:'BOOKED'});const first=f.call({action:'field_save',table:'POB_ACTIVITY',operation:'create',record:r});assert.equal(first.ok,true,first.error);const again=f.call({action:'field_save',table:'POB_ACTIVITY',operation:'create',record:r});assert.equal(again.alreadySaved,true);assert.equal(f.tables.POB_ACTIVITY.length,2);assert.equal(JSON.stringify([f.tables.PHARMACY_STOCK_CHECKS,f.tables.MONTHLY_TOTALS]),before);
 const read=f.call({action:'field_read'});assert.equal(read.ok,true,read.error);assert.equal(read.data.POB_ACTIVITY[0].Doctor_ID,'D1');assert.equal(read.data.products.length,2);assert.equal('RX_ACTIVITY' in f.tables,false);assert.equal('FOLLOW_UPS' in f.tables,false);assert.equal('TARGETS' in f.tables,false);assert.equal('PHARMACY_STOCK_CHECKS' in f.tables,false);assert.equal('DOCTOR_PRODUCTS' in f.tables,true);assert.equal('MONTHLY_TOTALS' in f.tables,true);
});
test('signed backend rejects master/financial edits and saves notes as literal text',()=>{
 const f=backendFixture();assert.equal(f.call({action:'field_save',table:'MONTHLY_TOTALS',operation:'create',record:{}}).ok,false);
 const result=f.call({action:'field_save',table:'POB_ACTIVITY',operation:'create',record:{...({POB_ID:randomUUID(),Booking_Date:'2026-10-02',Doctor_ID:'D1',Pharmacy_ID:'P1',Product_SKU:'SYP',Booked_Units:10,Quantity_Unit:'BOTTLE',Status:'BOOKED'}),Notes:'=1+1'}});assert.equal(result.ok,true,result.error);assert.equal(f.tables.POB_ACTIVITY[1][11],"'=1+1");
});
test('a stale edit cannot overwrite another saved edit',()=>{
 const f=backendFixture(),r=({POB_ID:randomUUID(),Booking_Date:'2026-10-02',Doctor_ID:'D1',Pharmacy_ID:'P1',Product_SKU:'SYP',Booked_Units:10,Quantity_Unit:'BOTTLE',Status:'BOOKED'}),created=f.call({action:'field_save',table:'POB_ACTIVITY',operation:'create',record:r}).record;
 const changed=f.call({action:'field_save',table:'POB_ACTIVITY',operation:'update',record:{...created,Notes:'New information'},previous:created});assert.equal(changed.ok,true,changed.error);
 const stale=f.call({action:'field_save',table:'POB_ACTIVITY',operation:'update',record:{...created,Notes:'Outdated information'},previous:created});assert.equal(stale.ok,false);assert.match(stale.error,/changed since/);assert.equal(f.tables.POB_ACTIVITY[1][11],'New information');
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

test('doctor product links cannot use a pharmacy other than the doctor master',()=>{
 const d=source();d.PHARMACIES.push({Pharmacy_ID:'P2'});
 const record={Link_ID:randomUUID(),Doctor_ID:'D1',Pharmacy_ID:'P2',Product_SKU:'SYP',Relationship:'EXISTING',Active:'YES'};
 assert.throws(()=>validateFieldRecord('DOCTOR_PRODUCTS',record,d),/pharmacy from the doctor/);
});

test('an explicit field refresh bypasses a previously started shared server read',async()=>{
 let reads=0,release;const loader=shareFieldReads(command=>{reads++;return command.force?Promise.resolve({ok:true,data:{DOCTOR_PRODUCTS:[]}}):new Promise(resolve=>{release=resolve;});});
 const old=loader({action:'field_read'});await Promise.resolve();const fresh=await loader({action:'field_read',force:true});assert.equal(reads,2);assert.equal(fresh.data.DOCTOR_PRODUCTS.length,0);release({ok:true});await old;
});

test('removed pharmacy stock records cannot be saved through the signed backend',()=>{
 const f=backendFixture();const result=f.call({action:'field_save',table:'PHARMACY_STOCK_CHECKS',operation:'create',record:{Stock_Check_ID:randomUUID()}});assert.equal(result.ok,false);assert.match(result.error,/cannot be edited/);
});

test('signed doctor creates retry safely and edits can change camp and pharmacy while protecting concurrent changes',()=>{
 const f=backendFixture(),record={Doctor_ID:'',Doctor_Name:'New Doctor',Hospital:'Clinic',Specialties:'General',Pharmacy_ID:'',Area:'Area',Camp:'Proddatur',Prescriber_Status:'NRx',Potential:'A',Stockist:'Both',Active:'YES'};
 const command={action:'field_save',table:'DOCTORS',operation:'create',record,requestId:randomUUID(),pharmacyName:'Original pharmacy'};
 const financial=JSON.stringify(f.tables.MONTHLY_TOTALS);f.calls.reads=[];
 const created=f.call(command);assert.equal(created.ok,true,created.error);assert.deepEqual(f.calls.reads,['DOCTORS','PHARMACIES']);
 const size=f.tables.DOCTORS.length;assert.equal(f.call(command).alreadySaved,true);assert.equal(f.tables.DOCTORS.length,size);
 const duplicate=f.call({...command,requestId:randomUUID()});assert.equal(duplicate.ok,false);assert.match(duplicate.error,/already exists/);assert.equal(f.tables.DOCTORS.length,size);
 const edited=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:{...created.record,Notes:'Updated',Camp:'Jammalamadugu'},pharmacyName:'New pharmacy',previous:created.record});assert.equal(edited.ok,true,edited.error);
 assert.equal(edited.record.Doctor_ID,created.record.Doctor_ID);assert.equal(edited.record.Camp,'Jammalamadugu');assert.equal(edited.pharmacies[0].Pharmacy_Name,'New pharmacy');assert.equal(edited.pharmacies[0].Camp,'Jammalamadugu');assert.notEqual(edited.record.Pharmacy_ID,created.record.Pharmacy_ID);
 const stale=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:{...created.record,Notes:'Old edit'},previous:created.record});assert.equal(stale.ok,false);assert.match(stale.error,/changed since/);
 const reused=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:{...edited.record,Camp:'Proddatur'},pharmacyName:'  Original PHARMACY ',previous:edited.record});assert.equal(reused.ok,true,reused.error);assert.equal(reused.record.Pharmacy_ID,'P1');assert.equal(f.tables.PHARMACIES.length,3);
 assert.equal(JSON.stringify(f.tables.MONTHLY_TOTALS),financial);
});
test('doctor validation preserves imported IDs, rejects unknown pharmacies and protects column order',()=>{
 const d=source(),existing={...d.DOCTORS[0],Area:'Area',Camp:'Proddatur',Stockist:'Both',Prescriber_Status:'Rx',Active:'YES'};d.DOCTORS[0]=existing;
 assert.equal(validateFieldRecord('DOCTORS',{...existing,Notes:'Edit imported doctor'},d).Doctor_ID,'D1');
 assert.throws(()=>validateFieldRecord('DOCTORS',{...existing,Pharmacy_ID:'Unknown'},d),/Unknown Pharmacy/);
 const f=backendFixture();[f.tables.DOCTORS[0][1],f.tables.DOCTORS[0][2]]=[f.tables.DOCTORS[0][2],f.tables.DOCTORS[0][1]];
 const result=f.call({action:'field_save',table:'DOCTORS',operation:'create',record:{...existing,Doctor_ID:randomUUID()}});assert.equal(result.ok,false);assert.match(result.error,/column order/);assert.equal(f.calls.writes,0);
});

test('camp edits preserve imported IDs, validate options and leave configured ID allocation usable',()=>{
 const d=source(),existing={...d.DOCTORS[0],Doctor_ID:'PDTR-094',Area:'Area',Camp:'Proddatur',Stockist:'Both',Active:'YES'};d.DOCTORS[0]=existing;
 d.PHARMACIES.push({Pharmacy_ID:'P2'});
 const changed=validateFieldRecord('DOCTORS',{...existing,Camp:'Jammalamadugu',Pharmacy_ID:'P2'},d);
 assert.equal(changed.Doctor_ID,existing.Doctor_ID);assert.equal(changed.Pharmacy_ID,'P2');d.DOCTORS[0]=changed;
 assert.equal(nextDoctorId('Proddatur',d.DOCTORS),'PDTR-095');assert.equal(nextDoctorId('Jammalamadugu',d.DOCTORS),'JAMD-001');
 assert.throws(()=>validateFieldRecord('DOCTORS',{...changed,Camp:'Unknown camp'},d),/Choose camp from FIELD_OPTIONS/);
 assert.throws(()=>validateFieldRecord('DOCTORS',{...changed,Pharmacy_ID:'Unknown'},d),/Unknown Pharmacy/);
});

test('pharmacy edits preserve saved activity and new Rx products use the edited pharmacy',()=>{
 const f=backendFixture();
 const created=f.call({action:'field_save',table:'DOCTORS',operation:'create',requestId:randomUUID(),pharmacyName:'Original pharmacy',record:{Doctor_ID:'',Doctor_Name:'History Doctor',Hospital:'Clinic',Specialties:'General',Area:'Area',Camp:'Proddatur',Stockist:'Both',Active:'YES',Prescriber_Status:'Rx'},doctorProducts:[{Link_ID:randomUUID(),Product_SKU:'SYP'}]});assert.equal(created.ok,true,created.error);
 const booking=f.call({action:'field_save',table:'POB_ACTIVITY',operation:'create',record:{POB_ID:randomUUID(),Booking_Date:'2026-10-02',Doctor_ID:created.record.Doctor_ID,Pharmacy_ID:'P1',Product_SKU:'SYP',Booked_Units:10,Quantity_Unit:'BOTTLE',Status:'BOOKED'}});assert.equal(booking.ok,true,booking.error);
 const history=JSON.stringify([f.tables.DOCTOR_PRODUCTS[1],f.tables.POB_ACTIVITY]);
 const edited=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:{...created.record,Camp:'Jammalamadugu'},previous:created.record,pharmacyName:'Updated pharmacy',doctorProducts:[{Link_ID:randomUUID(),Product_SKU:'DROPS'}]});assert.equal(edited.ok,true,edited.error);
 assert.equal(JSON.stringify([f.tables.DOCTOR_PRODUCTS[1],f.tables.POB_ACTIVITY]),history);assert.equal(edited.doctorProducts[0].Pharmacy_ID,edited.record.Pharmacy_ID);assert.equal(edited.doctorProducts[0].Doctor_ID,created.record.Doctor_ID);
 const editedBooking=f.call({action:'field_save',table:'POB_ACTIVITY',operation:'update',record:{...booking.record,Notes:'Updated historical booking'},previous:booking.record});assert.equal(editedBooking.ok,true,editedBooking.error);assert.equal(editedBooking.record.Pharmacy_ID,'P1');
 const oldLink=created.doctorProducts[0],editedLink=f.call({action:'field_save',table:'DOCTOR_PRODUCTS',operation:'update',record:{...oldLink,Notes:'Updated historical link'},previous:oldLink});assert.equal(editedLink.ok,true,editedLink.error);assert.equal(editedLink.record.Pharmacy_ID,'P1');
 const before=JSON.stringify(f.tables);
 for(const pharmacyName of ['', '   ']){const invalid=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:edited.record,previous:edited.record,pharmacyName});assert.equal(invalid.ok,false);assert.match(invalid.error,/Enter the pharmacy name/);}
 assert.equal(JSON.stringify(f.tables),before);
});

test('doctors can be added without a stockist and an existing stockist can be cleared',()=>{
 const f=backendFixture();
 const created=f.call({action:'field_save',table:'DOCTORS',operation:'create',requestId:randomUUID(),pharmacyName:'Optional stockist pharmacy',record:{Doctor_ID:'',Doctor_Name:'Optional Stockist Doctor',Area:'Area',Camp:'Proddatur',Active:'YES',Prescriber_Status:'NRx'}});
 assert.equal(created.ok,true,created.error);assert.equal(created.record.Stockist,'');assert.equal(created.pharmacies[0].Stockist,'');
 const selected=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:{...created.record,Stockist:'Madhu'},previous:created.record,pharmacyName:'Optional stockist pharmacy'});assert.equal(selected.ok,true,selected.error);
 const cleared=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:{...selected.record,Stockist:''},previous:selected.record,pharmacyName:'Optional stockist pharmacy'});assert.equal(cleared.ok,true,cleared.error);assert.equal(cleared.record.Stockist,'');
 const invalid=f.call({action:'field_save',table:'DOCTORS',operation:'update',record:{...cleared.record,Stockist:'Unknown'},previous:cleared.record,pharmacyName:'Optional stockist pharmacy'});assert.equal(invalid.ok,false);assert.match(invalid.error,/Invalid Stockist/);
});
