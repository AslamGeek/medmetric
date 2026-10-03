// Shared visit rules. This module is also generated into the signed Sheets backend.
export const VISIT_HEADERS=['Date','Day','Camp','Type','Doctors (count)','Pharmacies (count)','Doctors','Pharmacies','Visit ID','Doctor IDs','Created At','Updated At','Active'];
export const VISIT_KINDS=['Visit','Sunday','Holiday','Leave'];
export const visitText=value=>String(value??'').trim();
export const visitNormalize=value=>visitText(value).toLowerCase().replace(/\s+/g,' ');
export function visitDate(value){
  return typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
}
export function visitToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function visitDay(date){return visitDate(date)?new Intl.DateTimeFormat('en-IN',{weekday:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')):'';}
export function visitAddDays(date,days){const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
export function visitDateLabel(date){return visitDate(date)?new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')):date;}
export function visitUnique(values){const names=new Map();for(const value of values){const name=visitText(value);if(name&&!names.has(visitNormalize(name)))names.set(visitNormalize(name),name);}return [...names.values()];}
export function visitDoctors(data){
  const pharmacies=new Map((data.PHARMACIES||[]).map(p=>[p.Pharmacy_ID,p.Pharmacy_Name]));
  return (data.DOCTORS||[]).filter(d=>d.Active==='YES').map(d=>({id:d.Doctor_ID,name:d.Doctor_Name,camp:d.Camp,hospital:d.Hospital||'',specialties:visitText(d.Specialties).split(/[;,|]/).map(v=>v.trim()).filter(Boolean),pharmacy:visitText(d.Pharmacy_Name||pharmacies.get(d.Pharmacy_ID)),callSchedule:d.Call_Schedule||''}));
}
export function visitLastDates(visits,asOf=visitToday()){
  const dates=new Map();
  for(const visit of visits)if(visit.kind==='Visit'&&visit.active!==false&&visit.date<=asOf){
    for(const id of visit.doctorIds||[])if(!dates.has(id)||dates.get(id)<visit.date)dates.set(id,visit.date);
  }
  return dates; // Never infer identities from doctor names.
}
export function visitRecency(date,asOf=visitToday()){
  if(!date)return {label:'Never visited',stale:true};
  const days=Math.max(0,Math.round((Date.parse(asOf+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000));
  return {label:days===0?(asOf===visitToday()?'Visited today':'Visited on selected date'):days===1?'1 day ago':days+' days ago',stale:days>=14};
}
export function visitPicker(doctors,visits,{camp,date,query='',specialty='',callSchedule=''}={}){
  const last=visitLastDates(visits,date),words=visitNormalize(query).split(' ').filter(Boolean);
  return doctors.filter(d=>d.camp===camp&&(!specialty||d.specialties.includes(specialty))&&(!callSchedule||visitNormalize(d.callSchedule)===visitNormalize(callSchedule))&&words.every(word=>visitNormalize([d.name,d.hospital,d.pharmacy].join(' ')).includes(word))).sort((a,b)=>(last.get(a.id)||'').localeCompare(last.get(b.id)||'')||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
export function visitBuild({localId,date,camp,kind='Visit',doctorIds=[],createdAt=new Date().toISOString()},doctors,{today=visitToday(),allowPast=false,camps=[]}={}){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(localId||''))throw new Error('Invalid visit identity.');
  if(!visitDate(date))throw new Error('Choose a valid visit date.');
  if(!allowPast&&date<today)throw new Error('Past dates cannot be logged.');
  if(!visitText(camp)||camp.length>150||(camps.length&&!camps.includes(camp)))throw new Error('Choose a camp from the current list.');
  if(!VISIT_KINDS.includes(kind))throw new Error('Choose a valid visit type.');
  if(visitDay(date)==='Sunday'&&kind!=='Sunday')throw new Error('Sunday is a no-visits day.');
  if(visitDay(date)!=='Sunday'&&kind==='Sunday')throw new Error('The selected date is not a Sunday.');
  if(!Array.isArray(doctorIds)||doctorIds.length>100||doctorIds.some(id=>typeof id!=='string')||new Set(doctorIds).size!==doctorIds.length)throw new Error('Choose up to 100 different doctors.');
  if(!Number.isFinite(Date.parse(createdAt)))throw new Error('Invalid visit creation time.');
  if(kind!=='Visit'&&doctorIds.length)throw new Error('No-visits days cannot include doctors.');
  const selected=kind==='Visit'?doctorIds.map(id=>{const matches=doctors.filter(d=>d.id===id);if(matches.length!==1||matches[0].camp!==camp)throw new Error('A selected doctor is no longer active in this camp. Refresh doctors and review this bundle.');return matches[0];}):[];
  if(kind==='Visit'&&!selected.length)throw new Error('Select at least one doctor.');
  const pharmacies=visitUnique(selected.map(d=>d.pharmacy));
  return {localId,date,day:visitDay(date),camp,kind,doctorIds:kind==='Visit'?[...doctorIds]:[],doctorCount:selected.length,pharmacyCount:pharmacies.length,doctorLines:kind==='Visit'?selected.map((d,i)=>`${i+1}. ${d.name} (${d.specialties.join(', ')||'General'})`):['NO_VISIT:'+kind],pharmacyLines:pharmacies.map((name,i)=>`${i+1}. ${name}`),createdAt,updatedAt:createdAt,active:true};
}
export function visitSameIdentity(a,b){return a.localId===b.localId&&a.date===b.date&&a.camp===b.camp&&a.kind===b.kind&&JSON.stringify(a.doctorIds)===JSON.stringify(b.doctorIds);}
export function visitHistory(visits,{date='',camp=''}={}){return visits.filter(v=>v.active!==false&&(!date||v.date===date)&&(!camp||v.camp===camp)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||a.localId.localeCompare(b.localId));}
export function visitDisplayLine(line){return String(line).replace(/^\s*\d+\.\s*/,'');}
export function visitMonthGrid(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return [];
  const first=month+'-01',offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7;
  const next=visitAddDays(first,32).slice(0,7)+'-01',days=Math.round((Date.parse(next+'T12:00:00Z')-Date.parse(first+'T12:00:00Z'))/86400000);
  return [...Array(offset).fill(null),...Array.from({length:days},(_,i)=>visitAddDays(first,i))];
}
