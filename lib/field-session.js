import {FIELD_SPEC} from './field-tracking.js';
export const FIELD_SNAPSHOT_KEY='medmetric-field-snapshot-v1';
function validSnapshot(value){
  return !!value&&typeof value==='object'&&Object.entries(FIELD_SPEC).every(([name,spec])=>Array.isArray(value[name])&&value[name].every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&spec.headers.every(h=>Object.hasOwn(row,h))))&&Array.isArray(value.products)&&value.products.every(p=>typeof p?.Product_SKU==='string'&&typeof p.Product_Name==='string')&&Array.isArray(value.agencies)&&value.agencies.every(a=>typeof a==='string');
}
// Browser reloads reuse this snapshot until Refresh data. Storage failure still permits memory reuse.
export function createFieldSession(readSnapshot,getStorage=()=>null){
  let snapshot=null,pending=null,revision=0;
  function persist(){try{getStorage()?.setItem(FIELD_SNAPSHOT_KEY,JSON.stringify(snapshot));}catch{}}
  const session={
    restore(){if(snapshot)return snapshot;try{const saved=JSON.parse(getStorage()?.getItem(FIELD_SNAPSHOT_KEY)||'null');if(validSnapshot(saved))snapshot=saved;}catch{}return snapshot;},
    load(force=false){
      if(pending)return pending;
      if(!force&&session.restore())return Promise.resolve(snapshot);
      const startedRevision=revision;
      pending=Promise.resolve().then(readSnapshot).then(value=>{
        if(!validSnapshot(value))throw new Error('The tracking snapshot is incomplete. Retry connection.');
        // A late read must not overwrite an entry that was acknowledged as saved meanwhile.
        if(revision===startedRevision){snapshot=value;persist();}
        return snapshot;
      }).finally(()=>{pending=null;});
      return pending;
    },
    saved(table,record){
      const spec=FIELD_SPEC[table];if(!snapshot||!spec?.required||!record||spec.headers.some(h=>!Object.hasOwn(record,h)))throw new Error('The saved entry response is incomplete. Refresh data to check the entry.');
      const key=spec.headers[0];revision++;
      snapshot={...snapshot,[table]:[...snapshot[table].filter(r=>r[key]!==record[key]),record]};persist();return snapshot;
    }
  };return session;
}
