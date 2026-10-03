import test from 'node:test';
import assert from 'node:assert/strict';
import {doctorDirectory,emptyDoctorFilters,productPrescribers} from '../lib/doctor-directory.js';
const data=()=>({DOCTORS:[
  {Doctor_ID:'D1',Doctor_Name:'Dr Arun',Camp:'North',Area:'Hill',Specialties:'General; Pediatrics',Hospital:'Hospital One',Pharmacy_ID:'P1',Prescriber_Status:'Rx',Potential:'B',Active:'YES'},
  {Doctor_ID:'D2',Doctor_Name:'Dr Bala',Camp:'South',Area:'Lake',Specialties:'General',Hospital:'Hospital Two',Pharmacy_ID:'P2',Prescriber_Status:'NRx',Potential:'A',Active:'YES'},
  {Doctor_ID:'D3',Doctor_Name:'Dr Chandra',Camp:'North',Area:'Lake',Specialties:'ENT',Hospital:'',Pharmacy_ID:'P1',Prescriber_Status:'Rx',Potential:'',Active:'NO'}
],PHARMACIES:[{Pharmacy_ID:'P1',Pharmacy_Name:'Central Pharmacy'},{Pharmacy_ID:'P2',Pharmacy_Name:'West Pharmacy'}],products:[{Product_SKU:'SKU-A',Product_Name:'Product Alpha'},{Product_SKU:'SKU-B',Product_Name:'Product Beta'}],DOCTOR_PRODUCTS:[{Doctor_ID:'D1',Product_SKU:'SKU-A',Active:'YES'},{Doctor_ID:'D1',Product_SKU:'SKU-A',Active:'YES'},{Doctor_ID:'D2',Product_SKU:'SKU-B',Active:'YES'},{Doctor_ID:'D3',Product_SKU:'SKU-A',Active:'NO'}]});
test('search combines words across doctor, pharmacy, specialty and canonical product name',()=>{
 assert.deepEqual(doctorDirectory(data(),{search:'ARUN central alpha'}).doctors.map(d=>d.Doctor_ID),['D1']);
 assert.equal(doctorDirectory(data(),{search:'pediatrics'}).doctors.length,1);
 assert.equal(doctorDirectory(data(),{search:'bala central'}).doctors.length,0);
});
test('filters accept multiple values within a group and combine different groups',()=>{
 const filters={...emptyDoctorFilters(),Camp:['North','South'],Specialties:['General'],Prescriber_Status:['Rx']};
 assert.deepEqual(doctorDirectory(data(),{filters}).doctors.map(d=>d.Doctor_ID),['D1']);
 const result=doctorDirectory(data(),{filters:{...emptyDoctorFilters(),Camp:['North']}});
 assert.equal(result.groups.find(g=>g.field==='Prescriber_Status').items.find(i=>i.value==='Rx').count,2);
});
test('product filtering uses active canonical SKU links and never product-name guesses',()=>{
 const d=data();d.products[1].Product_Name=d.products[0].Product_Name;
 assert.deepEqual(doctorDirectory(d,{filters:{Product_SKU:['SKU-B']}}).doctors.map(d=>d.Doctor_ID),['D2']);
 assert.deepEqual(doctorDirectory(d,{filters:{Product_SKU:['SKU-A']}}).doctors.map(d=>d.Doctor_ID),['D1']);
 assert.equal(doctorDirectory(d).productNames.get('D1').length,1);
});
test('metrics and sorting use the selected directory subset; unknown potential follows A/B/C',()=>{
 const result=doctorDirectory(data(),{filters:{Active:['YES']},sort:'potential'});
 assert.deepEqual(result.doctors.map(d=>d.Doctor_ID),['D2','D1']);assert.deepEqual(result.metrics,{total:2,rx:1,nrx:1,hospitals:2,pharmacies:2});
 assert.equal(doctorDirectory(data(),{sort:'potential'}).doctors.at(-1).Doctor_ID,'D3');
});
test('saved selections no longer present remain visible with zero matches and can be cleared',()=>{
 const result=doctorDirectory(data(),{filters:{Camp:['Old camp']}});assert.equal(result.doctors.length,0);assert.equal(result.groups.find(g=>g.field==='Camp').items.find(i=>i.value==='Old camp').count,0);
 assert.equal(doctorDirectory(data(),{filters:emptyDoctorFilters()}).doctors.length,3);
});

test('call schedule and manually chosen camps combine with other filters and can change immediately',()=>{
 const d=data();d.DOCTORS[0].Call_Schedule='Monday';d.DOCTORS[1].Call_Schedule='Monday';d.DOCTORS[2].Call_Schedule='Tuesday';
 const filters={...emptyDoctorFilters(),Call_Schedule:['Monday'],Camp:['North']};
 assert.deepEqual(doctorDirectory(d,{filters}).doctors.map(doctor=>doctor.Doctor_ID),['D1']);
 assert.deepEqual(doctorDirectory(d,{filters:{...filters,Camp:['South']}}).doctors.map(doctor=>doctor.Doctor_ID),['D2']);
 assert.deepEqual(doctorDirectory(d,{filters:{...filters,Camp:['North','South']}}).doctors.map(doctor=>doctor.Doctor_ID),['D1','D2']);
 assert.deepEqual(doctorDirectory(d,{filters:{...filters,Camp:[],Call_Schedule:['Tuesday']}}).doctors.map(doctor=>doctor.Doctor_ID),['D3']);
 assert.equal(doctorDirectory(d,{filters:{...filters,Call_Schedule:[]}}).doctors.length,2);
 const result=doctorDirectory(d,{filters:{...filters,Prescriber_Status:['Rx']}});
 assert.deepEqual(result.groups.find(group=>group.field==='Camp').items.map(item=>[item.value,item.count]),[['North',1],['South',0]]);
 assert.deepEqual(result.groups.find(group=>group.field==='Call_Schedule').items.map(item=>[item.value,item.count]),[['Monday',1],['Tuesday',1]]);
});

test('product prescribers use active Existing links, deduplicate doctor IDs and match exact SKUs',()=>{
 const d=data();
 d.DOCTOR_PRODUCTS=d.DOCTOR_PRODUCTS.map(link=>({...link,Relationship:'EXISTING'}));
 d.DOCTOR_PRODUCTS.push(
  {Doctor_ID:'D2',Product_SKU:'SKU-A',Active:'YES',Relationship:'DISCUSSION'},
  {Doctor_ID:'D3',Product_SKU:'SKU-A',Active:'YES',Relationship:'EXISTING'},
  {Doctor_ID:'missing',Product_SKU:'SKU-A',Active:'YES',Relationship:'EXISTING'},
  {Doctor_ID:'D1',Product_SKU:'SKU-B',Active:'NO',Relationship:'EXISTING'}
 );
 d.products[1].Product_Name=d.products[0].Product_Name;
 const result=productPrescribers(d);
 assert.deepEqual(result.get('SKU-A').map(doctor=>doctor.Doctor_ID),['D1']);
 assert.deepEqual(result.get('SKU-B').map(doctor=>doctor.Doctor_ID),['D2']);
 assert.equal(result.has('unmapped'),false);
 assert.equal(productPrescribers(null).size,0);
});

test('product prescribers reflect saved link changes and preserve distinct doctors with the same name',()=>{
 const d=data();d.DOCTORS[1].Doctor_Name=d.DOCTORS[0].Doctor_Name;
 d.DOCTOR_PRODUCTS=[{Doctor_ID:'D2',Product_SKU:'SKU-A',Active:'YES',Relationship:'EXISTING'},{Doctor_ID:'D1',Product_SKU:'SKU-A',Active:'YES',Relationship:'EXISTING'}];
 assert.deepEqual(productPrescribers(d).get('SKU-A').map(doctor=>doctor.Doctor_ID),['D1','D2']);
 d.DOCTOR_PRODUCTS[0].Active='NO';
 assert.deepEqual(productPrescribers(d).get('SKU-A').map(doctor=>doctor.Doctor_ID),['D1']);
});
