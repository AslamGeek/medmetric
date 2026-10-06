import {FIELD_SPEC,FIELD_TABLES} from './field-tracking.js';
export const FIELD_SNAPSHOT_KEY='medmetric-field-snapshot-v5-last-updated-prices';
function validSnapshot(value){
  return !!value&&typeof value==='object'&&value.schemaVersion===2&&value.options&&['Areas','Specialties','Camps','Potentials','Stockist','OP Timings','Call Schedule'].every(h=>Array.isArray(value.options[h])&&value.options[h].every(v=>typeof v==='string'))&&FIELD_TABLES.every(name=>Array.isArray(value[name])&&value[name].every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&FIELD_SPEC[name].headers.every(h=>Object.hasOwn(row,h))))&&Array.isArray(value.products)&&value.products.every(p=>typeof p?.Product_SKU==='string'&&typeof p.Product_Name==='string')&&Array.isArray(value.agencies)&&value.agencies.every(a=>typeof a==='string');
}
function currentSnapshot(value){return Object.fromEntries([...FIELD_TABLES.map(name=>[name,value[name]]),['products',value.products],['agencies',value.agencies],['options',value.options],['schemaVersion',value.schemaVersion],['capabilities',value.capabilities||{}],['prices',value.prices||[]],['priceWarnings',value.priceWarnings||[]],['priceStatus',value.priceStatus||'unavailable']]);}
// Browser reloads reuse this snapshot until Refresh data. Storage failure still permits memory reuse.
export function createFieldSession(readSnapshot,getStorage=()=>null){
  let snapshot=null,pending=null,revision=0,queuedRefresh=null;const acknowledged=[];
  function persist(){try{getStorage()?.setItem(FIELD_SNAPSHOT_KEY,JSON.stringify(snapshot));}catch{}}
  const session={
    restore(){if(snapshot)return snapshot;try{const saved=JSON.parse(getStorage()?.getItem(FIELD_SNAPSHOT_KEY)||'null');if(validSnapshot(saved)){snapshot=currentSnapshot(saved);persist();}}catch{}return snapshot;},
    load(force=false){
      if(pending){if(!force)return pending;if(!queuedRefresh)queuedRefresh=pending.catch(()=>null).then(()=>session.load(true)).finally(()=>{queuedRefresh=null;});return queuedRefresh;}
      if(!force&&session.restore())return Promise.resolve(snapshot);
      const startedRevision=revision;
      pending=Promise.resolve().then(()=>readSnapshot(force)).then(value=>{
        if(!validSnapshot(value))throw new Error('Update the existing Apps Script deployment with the new Code.gs to load FIELD_OPTIONS and the revised doctor form.');
        // Replace the old snapshot, preserving only writes acknowledged after this read began.
        snapshot=currentSnapshot(value);
        for(const saved of acknowledged.filter(change=>change.revision>startedRevision)){
          const key=FIELD_SPEC[saved.table].headers[0];
          snapshot={...snapshot,[saved.table]:[...snapshot[saved.table].filter(r=>!saved.records.some(record=>record[key]===r[key])),...saved.records]};
        }
        acknowledged.length=0;persist();
        return snapshot;
      }).finally(()=>{pending=null;});
      return pending;
    },
    saved(table,record,pharmacies=[],doctorProducts=[]){
      const records=Array.isArray(record)?record:[record];const spec=FIELD_SPEC[table];if(!snapshot||!FIELD_TABLES.includes(table)||!spec?.required||!records.length||records.some(r=>!r||spec.headers.some(h=>!Object.hasOwn(r,h))))throw new Error('The saved entry response is incomplete. Refresh data to check the entry.');
      if(!Array.isArray(pharmacies)||pharmacies.some(r=>!r||FIELD_SPEC.PHARMACIES.headers.some(h=>!Object.hasOwn(r,h))))throw new Error('The saved pharmacy response is incomplete. Refresh data to check the entry.');
      if(!Array.isArray(doctorProducts)||(doctorProducts.length&&table!=='DOCTORS')||doctorProducts.some(r=>!r||FIELD_SPEC.DOCTOR_PRODUCTS.headers.some(h=>!Object.hasOwn(r,h))||!records.some(d=>d.Doctor_ID===r.Doctor_ID&&d.Pharmacy_ID===r.Pharmacy_ID)))throw new Error('The saved prescribed product response is incomplete. Refresh data to check the entry.');
      const key=spec.headers[0];revision++;if(pending){acknowledged.push({revision,table,records});if(pharmacies.length)acknowledged.push({revision,table:'PHARMACIES',records:pharmacies});if(doctorProducts.length)acknowledged.push({revision,table:'DOCTOR_PRODUCTS',records:doctorProducts});}
      snapshot={...snapshot,[table]:[...snapshot[table].filter(r=>!records.some(saved=>saved[key]===r[key])),...records],PHARMACIES:[...snapshot.PHARMACIES.filter(r=>!pharmacies.some(saved=>saved.Pharmacy_ID===r.Pharmacy_ID)),...pharmacies],...(table==='DOCTORS'?{DOCTOR_PRODUCTS:[...snapshot.DOCTOR_PRODUCTS.filter(r=>!doctorProducts.some(saved=>saved.Link_ID===r.Link_ID)),...doctorProducts]}:{})};persist();return snapshot;
    }
  };return session;
}
