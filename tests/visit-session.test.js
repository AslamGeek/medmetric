import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createVisitSession} from '../lib/visit-session.js';
import {visitBuild,visitToday,visitDay,visitAddDays} from '../lib/visits.js';
const doctors=[{id:'D1',name:'Doctor',camp:'Camp',pharmacy:'Pharmacy',specialties:[],callSchedule:'Everyday'}];
const date=()=>visitDay(visitToday())==='Sunday'?visitAddDays(visitToday(),1):visitToday();
function store(){let value={version:1,visits:[],queue:[],master:{doctors,camps:['Camp'],callSchedules:['Everyday']}};return {fail:false,async change(fn){if(this.fail)throw Error('Storage blocked');value=structuredClone(fn(structuredClone(value)));return structuredClone(value);}};}
function harness({storage=store(),request,online=()=>false}={}){const data={schemaVersion:1,doctors,camps:['Camp'],callSchedules:['Everyday'],visits:[]};const timers=[];const session=createVisitSession({store:storage,request:request||(async()=>({data})),uuid:randomUUID,online,schedule:fn=>{timers.push(fn);return timers.length;},cancel:()=>{}});return {session,storage,data,timers};}
const input=()=>({date:date(),camp:'Camp',kind:'Visit',doctorIds:['D1']});
test('local save atomically retains a bundle and operation across a reload while offline',async()=>{
 const h=harness();await h.session.start();const v=await h.session.save(input());await h.session.sync();assert.equal(h.session.snapshot().queue.length,1);assert.equal(h.session.history()[0].localId,v.localId);
 const reload=harness({storage:h.storage});await reload.session.start();assert.equal(reload.session.history().length,1);assert.equal(reload.session.snapshot().queue[0].visit.localId,v.localId);
});
test('storage failure rejects save and cannot display a saved bundle',async()=>{
 const h=harness();await h.session.start();h.storage.fail=true;await assert.rejects(h.session.save(input()),/Storage blocked/);assert.equal(h.session.history().length,0);
});
test('a committed save with a lost response retries the same identity without a duplicate',async()=>{
 let connected=false,calls=0;const committed=new Map();let h;
 h=harness({online:()=>connected,request:async cmd=>{if(cmd.action==='read')return {data:{...h.data,visits:[...committed.values()]}};calls++;const v=visitBuild(cmd.visit,doctors,{allowPast:true});committed.set(v.localId,v);if(calls===1)throw Error('Lost response');return {visit:v};}});
 await h.session.start();await h.session.save(input());await h.session.sync();connected=true;await h.session.sync();assert.equal(h.session.snapshot().queue.length,1);assert.equal(h.timers.length,1);await h.session.sync();assert.equal(committed.size,1);assert.equal(h.session.snapshot().queue.length,0);
});
test('undo stays after an in-flight save and later refresh cannot restore the bundle',async()=>{
 let release,connected=false,h;const sent=[];const backend=new Map();
 h=harness({online:()=>connected,request:async cmd=>{if(cmd.action==='read')return {data:{...h.data,visits:[...backend.values()].filter(v=>v.active)}};sent.push(cmd.action);if(cmd.action==='save')await new Promise(resolve=>{release=resolve;});const v=visitBuild(cmd.visit,doctors,{allowPast:true});v.active=cmd.action!=='undo';backend.set(v.localId,v);return {visit:v};}});
 await h.session.start();const visit=await h.session.save(input());await h.session.sync();connected=true;const syncing=h.session.sync();while(!release)await new Promise(resolve=>setImmediate(resolve));await h.session.undo(visit);assert.equal(h.session.history().length,0);release();await syncing;await h.session.sync();assert.deepEqual(sent,['save','undo']);assert.equal(h.session.snapshot().queue.length,0);await h.session.refresh();assert.equal(h.session.history().length,0);
});
test('refresh preserves a new local save queued after the read starts',async()=>{
 let release,connected=false,h;h=harness({online:()=>connected,request:async cmd=>cmd.action==='read'?new Promise(resolve=>{release=()=>resolve({data:h.data});}):{visit:visitBuild(cmd.visit,doctors,{allowPast:true})}});
 await h.session.start();connected=true;const refreshing=h.session.refresh();while(!release)await new Promise(resolve=>setImmediate(resolve));connected=false;const visit=await h.session.save(input());release();await refreshing;assert.equal(h.session.history()[0].localId,visit.localId);assert.equal(h.session.snapshot().queue.length,1);
});
test('validation failures stop retrying and rejected bundles can be discarded without replaying save',async()=>{
 let connected=false,h;const sent=[];h=harness({online:()=>connected,request:async cmd=>{if(cmd.action==='read')return {data:h.data};sent.push(cmd.action);if(cmd.action==='save'){const error=Error('Doctor removed');error.permanent=true;throw error;}return {visit:{...visitBuild(cmd.visit,doctors,{allowPast:true}),active:false}};}});
 await h.session.start();const visit=await h.session.save(input());await h.session.sync();connected=true;await h.session.sync();assert.equal(h.session.snapshot().queue[0].stopped,true);assert.equal(h.timers.length,0);await h.session.undo(visit);await h.session.sync();assert.deepEqual(sent,['save','undo']);assert.equal(h.session.history().length,0);assert.equal(h.session.snapshot().queue.length,0);
});
test('old confirmed bundles removed in Sheets disappear after a complete refresh',async()=>{
 let connected=false,h;h=harness({online:()=>connected,request:async cmd=>cmd.action==='read'?{data:h.data}:{visit:visitBuild(cmd.visit,doctors,{allowPast:true})}});await h.session.start();await h.session.save(input());connected=true;await h.session.sync();assert.equal(h.session.history().length,1);await h.session.refresh();assert.equal(h.session.history().length,0);
});
