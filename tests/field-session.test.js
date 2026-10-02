import test from 'node:test';
import assert from 'node:assert/strict';
import {FIELD_SPEC} from '../lib/field-tracking.js';
import {createFieldSession,FIELD_SNAPSHOT_KEY} from '../lib/field-session.js';
function snapshot(name='Doctor One'){const d=Object.fromEntries(Object.keys(FIELD_SPEC).map(k=>[k,[]]));d.DOCTORS=[Object.fromEntries(FIELD_SPEC.DOCTORS.headers.map(h=>[h,h==='Doctor_ID'?'D1':h==='Doctor_Name'?name:'']))];return {...d,products:[{Product_SKU:'P1',Product_Name:'Existing product'}],agencies:['A']};}
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};}
const entry=(notes='Saved note')=>Object.fromEntries(FIELD_SPEC.RX_ACTIVITY.headers.map(h=>[h,h==='Rx_ID'?'entry-1':h==='Notes'?notes:'']));
test('a page reload restores doctor data without a new sheet read; only explicit refresh fetches again',async()=>{
 const store=storage();let reads=0;const loader=async()=>{reads++;return snapshot(reads===1?'Initial':'Changed');};
 const first=createFieldSession(loader,()=>store);await first.load();assert.equal(reads,1);
 const reload=createFieldSession(loader,()=>store);assert.equal((await reload.load()).DOCTORS[0].Doctor_Name,'Initial');assert.equal(reads,1);
 await reload.load();assert.equal(reads,1);assert.equal((await reload.load(true)).DOCTORS[0].Doctor_Name,'Changed');assert.equal(reads,2);
});
test('acknowledged creates and edits persist across reloads without duplicates',async()=>{
 const store=storage(),session=createFieldSession(async()=>snapshot(),()=>store);await session.load();session.saved('RX_ACTIVITY',entry());session.saved('RX_ACTIVITY',entry('Edited note'));
 const reload=createFieldSession(()=>{throw Error('Must not read');},()=>store);const data=await reload.load();assert.equal(data.RX_ACTIVITY.length,1);assert.equal(data.RX_ACTIVITY[0].Notes,'Edited note');
});
test('failed refresh preserves memory and the stored snapshot',async()=>{
 const store=storage();let fail=false;const session=createFieldSession(async()=>{if(fail)throw Error('Timeout');return snapshot();},()=>store);await session.load();const before=store.getItem(FIELD_SNAPSHOT_KEY);fail=true;await assert.rejects(()=>session.load(true),/Timeout/);assert.equal(store.getItem(FIELD_SNAPSHOT_KEY),before);assert.equal((await session.load()).DOCTORS.length,1);
});
test('corrupt or incomplete browser snapshots fall back to one read',async()=>{
 for(const saved of ['invalid JSON',JSON.stringify({products:[],agencies:[]})]){const store=storage();store.setItem(FIELD_SNAPSHOT_KEY,saved);let reads=0;const session=createFieldSession(async()=>{reads++;return snapshot();},()=>store);await Promise.all([session.load(),session.load()]);assert.equal(reads,1);}
});
test('blocked browser storage still permits memory reuse and saving',async()=>{
 let reads=0;const session=createFieldSession(async()=>{reads++;return snapshot();},()=>{throw Error('Storage blocked');});await session.load();session.saved('RX_ACTIVITY',entry());assert.equal((await session.load()).RX_ACTIVITY.length,1);assert.equal(reads,1);
});
test('a late refresh cannot replace an acknowledged saved record in browser storage',async()=>{
 const store=storage();let release;const session=createFieldSession(()=>new Promise(resolve=>{release=resolve;}),()=>store);store.setItem(FIELD_SNAPSHOT_KEY,JSON.stringify(snapshot()));session.restore();const pending=session.load(true);await Promise.resolve();session.saved('RX_ACTIVITY',entry());release(snapshot());assert.equal((await pending).RX_ACTIVITY.length,1);const reload=createFieldSession(()=>{throw Error('Must not read');},()=>store);assert.equal((await reload.load()).RX_ACTIVITY.length,1);
});

test('all acknowledged product links persist together after reload',async()=>{
 const store=storage(),session=createFieldSession(async()=>snapshot(),()=>store);await session.load();
 const rows=['P1','P2'].map((sku,i)=>Object.fromEntries(FIELD_SPEC.DOCTOR_PRODUCTS.headers.map(h=>[h,h==='Link_ID'?'link-'+i:h==='Product_SKU'?sku:''])));
 session.saved('DOCTOR_PRODUCTS',rows);session.saved('DOCTOR_PRODUCTS',rows);
 assert.equal((await createFieldSession(async()=>{throw Error('Unexpected read');},()=>store).load()).DOCTOR_PRODUCTS.length,2);
});

test('refresh removes a deleted product link even when another entry saves during the read',async()=>{
 const store=storage(),initial=snapshot();initial.DOCTOR_PRODUCTS=[Object.fromEntries(FIELD_SPEC.DOCTOR_PRODUCTS.headers.map(h=>[h,h==='Link_ID'?'deleted-link':'' ]))];store.setItem(FIELD_SNAPSHOT_KEY,JSON.stringify(initial));
 let release;const session=createFieldSession(()=>new Promise(resolve=>{release=resolve;}),()=>store);session.restore();const refresh=session.load(true);await Promise.resolve();session.saved('RX_ACTIVITY',entry());release(snapshot());
 const result=await refresh;assert.equal(result.DOCTOR_PRODUCTS.length,0);assert.equal(result.RX_ACTIVITY.length,1);assert.equal(JSON.parse(store.getItem(FIELD_SNAPSHOT_KEY)).DOCTOR_PRODUCTS.length,0);
});
test('explicit refresh waits for an older read then fetches again to remove deleted links',async()=>{
 let release,reads=0;const initial=snapshot();initial.DOCTOR_PRODUCTS=[Object.fromEntries(FIELD_SPEC.DOCTOR_PRODUCTS.headers.map(h=>[h,h==='Link_ID'?'deleted-link':'' ]))];
 const session=createFieldSession(()=>++reads===1?new Promise(resolve=>{release=resolve;}):snapshot());const old=session.load();await Promise.resolve();const refresh=session.load(true);release(initial);await old;assert.equal((await refresh).DOCTOR_PRODUCTS.length,0);assert.equal(reads,2);
});

test('tracking loads and restores after the retired sheet tabs are removed',async()=>{
 const current=snapshot();delete current.RX_ACTIVITY;delete current.FOLLOW_UPS;delete current.TARGETS;const store=storage();
 await createFieldSession(async()=>current,()=>store).load(true);
 const result=await createFieldSession(async()=>{throw Error('Unexpected read');},()=>store).load();assert.equal(result.DOCTORS.length,1);assert.equal('FOLLOW_UPS' in result,false);
});
