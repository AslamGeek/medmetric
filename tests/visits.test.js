import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {visitBuild,visitDoctors,visitPicker,visitLastDates,visitHistory,visitMonthGrid,visitToday} from '../lib/visits.js';
const doctors=[{id:'D1',name:'Same Name',camp:'Camp',specialties:['General'],pharmacy:'Shared Pharmacy',hospital:'H1',callSchedule:'Everyday'},{id:'D2',name:'Same Name',camp:'Camp',specialties:['Ortho'],pharmacy:' shared   pharmacy ',hospital:'H2',callSchedule:'Tue'},{id:'D3',name:'Another',camp:'Other',specialties:[],pharmacy:'Other',callSchedule:''}];
const input=extra=>({localId:randomUUID(),date:'2026-10-03',camp:'Camp',kind:'Visit',doctorIds:['D1','D2'],createdAt:'2026-10-03T10:00:00Z',...extra});
test('a bundle snapshots doctor names and specialties and derives distinct pharmacy names',()=>{
 const visit=visitBuild(input(),doctors,{today:'2026-10-03'});assert.equal(visit.doctorCount,2);assert.equal(visit.pharmacyCount,1);assert.deepEqual(visit.pharmacyLines,['1. Shared Pharmacy']);assert.deepEqual(visit.doctorIds,['D1','D2']);assert.equal(visit.doctorLines[1],'2. Same Name (Ortho)');
});
test('last visits use exact IDs, ignore undone and later bundles, and never match duplicate names',()=>{
 const visits=[visitBuild(input({doctorIds:['D1']}),doctors,{allowPast:true}),visitBuild(input({date:'2026-10-05',doctorIds:['D2']}),doctors,{allowPast:true})];
 assert.equal(visitLastDates(visits,'2026-10-03').get('D2'),undefined);
 assert.equal(visitPicker(doctors,visits,{camp:'Camp',date:'2026-10-03'})[0].id,'D2');
 visits[0].active=false;assert.equal(visitLastDates(visits,'2026-10-03').size,0);
});
test('deleted, duplicate, inactive and moved doctor identities cannot silently reduce a bundle',()=>{
 for(const ids of [['missing'],['D3'],['D1','D1']])assert.throws(()=>visitBuild(input({doctorIds:ids}),doctors,{allowPast:true}));
 assert.throws(()=>visitBuild(input({doctorIds:['D1']}),[...doctors,doctors[0]],{allowPast:true}));
 const mapped=visitDoctors({DOCTORS:[{Doctor_ID:'D1',Doctor_Name:'Name',Active:'NO'}]});assert.deepEqual(mapped,[]);
});
test('Sunday is automatic; Holiday and Leave have zero doctors and pharmacies',()=>{
 for(const kind of ['Sunday','Holiday','Leave']){const date=kind==='Sunday'?'2026-10-04':'2026-10-03';const v=visitBuild(input({kind,date,doctorIds:[]}),doctors,{allowPast:true});assert.equal(v.doctorCount,0);assert.equal(v.pharmacyCount,0);assert.deepEqual(v.doctorLines,['NO_VISIT:'+kind]);}
 assert.throws(()=>visitBuild(input({date:'2026-10-04'}),doctors,{allowPast:true}),/Sunday/);
 assert.throws(()=>visitBuild(input({kind:'Holiday'}),doctors,{allowPast:true}),/cannot include doctors/);
});
test('date validation rejects impossible and new past dates but accepts delayed offline delivery',()=>{
 assert.throws(()=>visitBuild(input({date:'2026-02-30'}),doctors,{allowPast:true}),/valid visit date/);
 assert.throws(()=>visitBuild(input(),doctors,{today:'2026-10-05'}),/Past dates/);
 assert.equal(visitBuild(input(),doctors,{allowPast:true}).date,'2026-10-03');
 assert.equal(visitToday(new Date('2026-10-03T20:00:00Z')),'2026-10-04');
});
test('history filters bundles by exact date/camp and calendar handles leap years',()=>{
 const visits=[visitBuild(input(),doctors,{allowPast:true}),visitBuild(input({date:'2026-10-05'}),doctors,{allowPast:true})];
 assert.equal(visitHistory(visits,{date:'2026-10-03',camp:'Camp'}).length,1);assert.equal(visitHistory(visits,{camp:'Other'}).length,0);
 assert.equal(visitMonthGrid('2028-02').filter(Boolean).length,29);assert.equal(visitMonthGrid('2026-02').filter(Boolean).length,28);
});
