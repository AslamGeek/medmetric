// Shared with the Apps Script backend by scripts/build-field-backend.js.
export const FIELD_SPEC = {
  DOCTORS: {headers:'Doctor_ID,Doctor_Name,Specialties,Hospital,Pharmacy_ID,Area,Camp,Potential,Prescriber_Status,Stockist,OP_Timing,Call_Schedule,Notes,Active'.split(','),required:['Doctor_Name','Pharmacy_ID','Area','Camp','Stockist','Active'],options:{Stockist:['Both','Madhu','Meda'],Prescriber_Status:['Rx','NRx'],Active:['YES','NO']}},
  PHARMACIES: {headers:'Pharmacy_ID,Pharmacy_Name,Area,Camp,Stockist,Identity_Status,Notes,Active'.split(',')},
  DOCTOR_PRODUCTS: {headers:'Link_ID,Doctor_ID,Product_SKU,Pharmacy_ID,Relationship,Start_Date,End_Date,Notes,Active'.split(','),required:['Doctor_ID','Product_SKU','Relationship','Active'],dates:['Start_Date','End_Date'],options:{Relationship:['EXISTING','DISCUSSION','OTHER'],Active:['YES','NO']}},
  RX_ACTIVITY: {headers:'Rx_ID,Prescription_Date,Reported_Date,Doctor_ID,Pharmacy_ID,Product_SKU,Quantity,Quantity_Unit,Confirmation,Notes,Created_At,Updated_At'.split(','),required:['Reported_Date','Doctor_ID','Product_SKU','Confirmation'],dates:['Prescription_Date','Reported_Date'],numbers:['Quantity'],options:{Confirmation:['REPORTED','CONFIRMED']}},
  FOLLOW_UPS: {headers:'Follow_Up_ID,Doctor_ID,Pharmacy_ID,Product_SKU,Due_Date,Reason,Status,Completed_Date,Notes,Created_At,Updated_At'.split(','),required:['Due_Date','Reason','Status'],dates:['Due_Date','Completed_Date'],options:{Reason:['PRESCRIPTION_REVIEW','STOCK_CHECK','REPLENISHMENT_REVIEW','POB_REVIEW','PRODUCT_DISCUSSION','OTHER'],Status:['OPEN','DONE','CANCELLED']}},
  TARGETS: {headers:'Target_ID,Month,Scope,Agency,Doctor_ID,Pharmacy_ID,Product_SKU,Metric,Target_Value,Quantity_Unit,Notes,Active'.split(','),required:['Month','Scope','Metric','Target_Value','Active'],numbers:['Target_Value'],options:{Scope:['OVERALL','AGENCY','DOCTOR','PHARMACY'],Metric:['SECONDARY_REVENUE','RX_UNITS','POB_UNITS'],Active:['YES','NO']}},
  POB_ACTIVITY: {headers:'POB_ID,Booking_Date,Doctor_ID,Pharmacy_ID,Agency,Product_SKU,Booked_Units,Quantity_Unit,Status,Fulfilled_Units,Fulfilled_Date,Notes,Created_At,Updated_At'.split(','),required:['Booking_Date','Pharmacy_ID','Product_SKU','Booked_Units','Quantity_Unit','Status'],dates:['Booking_Date','Fulfilled_Date'],numbers:['Booked_Units','Fulfilled_Units'],options:{Status:['BOOKED','PARTIAL','FULFILLED','CANCELLED']}}
};
export const FIELD_TABLES=['DOCTORS','PHARMACIES','DOCTOR_PRODUCTS','POB_ACTIVITY'];
export const FIELD_OPTIONS_HEADERS=['Areas','Specialties','Camps','Potentials','Stockist','OP Timings','Call Schedule'];
export const DOCTOR_OPTION_COLUMNS={Area:'Areas',Specialties:'Specialties',Camp:'Camps',Potential:'Potentials',Stockist:'Stockist',OP_Timing:'OP Timings',Call_Schedule:'Call Schedule'};
export const CAMP_CODES={'Jammalamadugu':'JAMD','Mydukuru/GV Satram':'MYGV','Porumamilla/Kalasapadu':'POKA','Proddatur':'PDTR','Yerraguntla/Kamalapuram':'YEKA'};
export const splitSpecialties=value=>[...new Set(String(value||'').split(/[;,|]/).map(v=>v.trim()).filter(Boolean))];
export function fieldOptions(values){
  if(!Array.isArray(values)||FIELD_OPTIONS_HEADERS.some((h,i)=>String(values[0]?.[i]||'').trim()!==h))throw new Error('FIELD_OPTIONS needs the expected seven column headers.');
  return Object.fromEntries(FIELD_OPTIONS_HEADERS.map((h,i)=>[h,h==='Stockist'?[...FIELD_SPEC.DOCTORS.options.Stockist]:[...new Set(values.slice(1).map(row=>String(row[i]??'').trim()).filter(Boolean))]]));
}
export function doctorCampCode(camp,doctors=[]){
  const name=String(camp||'').trim(),normalized=name.toLowerCase();
  if(!name)throw new Error('Choose a camp before assigning a doctor ID.');
  const configured=Object.entries(CAMP_CODES).find(([key])=>key.toLowerCase()===normalized)?.[1];
  const prefixes=[...new Set(doctors.filter(d=>String(d.Camp).trim().toLowerCase()===normalized&&/^[A-Z]{2,12}-\d+$/.test(d.Doctor_ID)).map(d=>d.Doctor_ID.split('-')[0]))];
  if(prefixes.length>1)throw new Error('This camp has conflicting doctor ID prefixes. Correct them before adding a doctor.');
  const letters=name.toUpperCase().replace(/[^A-Z]/g,''),consonants=letters.replace(/[AEIOU]/g,'');
  const code=configured||prefixes[0]||(consonants.length>=3?consonants:letters).slice(0,4);
  if(!/^[A-Z]{2,12}$/.test(code))throw new Error('This camp needs a valid code in CAMP_CODES before adding a doctor.');
  if(doctors.some(d=>String(d.Camp).trim().toLowerCase()!==normalized&&String(d.Doctor_ID).startsWith(code+'-'))||Object.entries(CAMP_CODES).some(([key,value])=>key.toLowerCase()!==normalized&&value===code))throw new Error('This camp code is already in use. Assign a unique code in CAMP_CODES.');
  return code;
}
export function nextDoctorId(camp,doctors=[]){
  const prefix=doctorCampCode(camp,doctors),pattern=new RegExp('^'+prefix+'-(\\d+)$');
  const latest=doctors.reduce((max,d)=>{const match=String(d.Doctor_ID).match(pattern);return match?Math.max(max,Number(match[1])):max;},0);
  if(!Number.isSafeInteger(latest+1))throw new Error('Doctor ID sequence is out of range.');
  return prefix+'-'+String(latest+1).padStart(3,'0');
}
export const QUANTITY_UNITS=['STOCK_UNIT','TABLET','STRIP','BOTTLE','SACHET','AMPOULE','VIAL','TUBE','PACK','OTHER'];
export function indiaToday(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function fieldRecords(values,headers,name) {
  if(!Array.isArray(values)||headers.some(h=>!values[0]?.includes(h)))throw new Error(name+' has missing headers.');
  return values.slice(1).filter(row=>row.some(v=>v!==''&&v!=null)).map(row=>Object.fromEntries(headers.map(h=>[h,row[values[0].indexOf(h)]??''])));
}
export function fieldProducts(config) {
  const products=new Map();
  for(const row of config){const sku=String(row.Your_SKU||'').trim();if(!sku)continue;
    const name=String(row.Your_Product_Name||sku).trim(),existing=products.get(sku);
    if(existing&&existing.Product_Name!==name)throw new Error('Conflicting names for SKU '+sku+' in PRODUCT_CONFIG.');
    const active=String(row.Your_Status)==='ACTIVE'&&String(row.Include_In_Charts).toUpperCase()==='YES';
    products.set(sku,{Product_SKU:sku,Product_Name:name,Active:active||existing?.Active||false});
  }
  return [...products.values()].sort((a,b)=>a.Product_Name.localeCompare(b.Product_Name));
}
export function validateFieldRecord(table,input,data,today=indiaToday()) {
  const spec=FIELD_SPEC[table];if(!spec?.required)throw new Error('This table cannot be edited from the app.');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid record.');
  if(Object.keys(input).some(k=>!spec.headers.includes(k)))throw new Error('Unknown record field.');
  const record={};for(const h of spec.headers){const v=input[h]??'';if(!['string','number'].includes(typeof v)||String(v).length>2000)throw new Error('Invalid '+h);record[h]=typeof v==='string'?v.trim():v;}
  const present=v=>v!==''&&v!=null;
  const id=record[spec.headers[0]];
  if(table==='DOCTORS'){
    if(typeof id!=='string'||(!data.DOCTORS?.some(d=>d.Doctor_ID===id)&&!new RegExp('^'+doctorCampCode(record.Camp,data.DOCTORS)+'-\\d{3,}$').test(id)))throw new Error('Invalid camp-specific doctor ID.');
  }else if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new Error('Invalid activity ID.');
  for(const h of spec.required)if(!present(record[h]))throw new Error(h.replaceAll('_',' ')+' is required.');
  for(const h of spec.dates||[]){const v=record[h];if(!v)continue;if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||isNaN(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw new Error('Invalid '+h);
    if(['Prescription_Date','Reported_Date','Booking_Date','Fulfilled_Date','Completed_Date'].includes(h)&&v>today)throw new Error(h.replaceAll('_',' ')+' cannot be in the future.');}
  for(const h of spec.numbers||[]){if(!present(record[h]))continue;if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(record[h]))||!Number.isFinite(Number(record[h]))||Number(record[h])<0)throw new Error(h.replaceAll('_',' ')+' must be a non-negative number.');record[h]=Number(record[h]);}
  for(const [h,choices] of Object.entries(spec.options||{}))if(present(record[h])&&!choices.includes(record[h]))throw new Error('Invalid '+h);
  for(const [h,name,idKey] of [['Doctor_ID','DOCTORS','Doctor_ID'],['Pharmacy_ID','PHARMACIES','Pharmacy_ID']])if(!(table==='DOCTORS'&&h==='Doctor_ID')&&record[h]&&!data[name]?.some(r=>r[idKey]===record[h]))throw new Error('Unknown '+h);
  if(table==='DOCTORS'){
    const original=data.DOCTORS.find(d=>d.Doctor_ID===id);
    if(original?.Pharmacy_ID&&original.Pharmacy_ID!==record.Pharmacy_ID)throw new Error('The doctor’s linked pharmacy is fixed and cannot be changed.');
    if(original&&original.Camp!==record.Camp)throw new Error('Camp identifies the doctor ID and is fixed after creation.');
    for(const h of ['Area','Camp','Potential'])if(record[h]&&record[h]!==original?.[h]&&!data.options?.[DOCTOR_OPTION_COLUMNS[h]]?.includes(record[h]))throw new Error('Choose '+h.toLowerCase()+' from FIELD_OPTIONS.');
    const specialties=splitSpecialties(record.Specialties),allowed=new Set([...(data.options?.Specialties||[]),...splitSpecialties(original?.Specialties)]);
    if(specialties.some(v=>!allowed.has(v)))throw new Error('Choose specialties from FIELD_OPTIONS.');
    record.Specialties=specialties.join(', ');
    const identity=d=>[d.Doctor_Name,d.Hospital,d.Camp].map(value=>String(value||'').toLowerCase().replace(/\s+/g,' ').trim()).join('\u0000');
    if((!original||identity(original)!==identity(record))&&data.DOCTORS.some(d=>d.Doctor_ID!==id&&identity(d)===identity(record)))throw new Error('A doctor with this name, hospital and camp already exists. Open that doctor to edit.');
  }
  if(record.Doctor_ID&&['DOCTOR_PRODUCTS','POB_ACTIVITY','FOLLOW_UPS','RX_ACTIVITY'].includes(table)){
    const pharmacy=data.DOCTORS.find(d=>d.Doctor_ID===record.Doctor_ID)?.Pharmacy_ID;
    if(!pharmacy)throw new Error('This doctor has no linked pharmacy in the doctor master.');
    if(record.Pharmacy_ID&&record.Pharmacy_ID!==pharmacy)throw new Error('Use the doctor’s fixed linked pharmacy.');
    record.Pharmacy_ID=pharmacy;
  }
  if(record.Product_SKU&&!data.products?.some(p=>p.Product_SKU===record.Product_SKU))throw new Error('Choose an existing product SKU.');
  if(record.Agency&&!data.agencies?.includes(record.Agency))throw new Error('Unknown agency.');
  if(record.Quantity_Unit&&!QUANTITY_UNITS.includes(record.Quantity_Unit))throw new Error('Invalid quantity unit.');
  if((spec.numbers||[]).some(h=>present(record[h]))&&table!=='TARGETS'&&!record.Quantity_Unit)throw new Error('Select a quantity unit.');
  if(table==='RX_ACTIVITY'&&record.Prescription_Date&&record.Prescription_Date>record.Reported_Date)throw new Error('Prescription date must be on or before reported date.');
  if(table==='DOCTOR_PRODUCTS'&&record.Start_Date&&record.End_Date&&record.Start_Date>record.End_Date)throw new Error('End date must follow start date.');
  if(table==='FOLLOW_UPS'){if(!record.Doctor_ID&&!record.Pharmacy_ID)throw new Error('Choose a doctor or pharmacy.');if(record.Status==='DONE'&&!record.Completed_Date)throw new Error('Completed date is required.');if(record.Status!=='DONE'&&record.Completed_Date)throw new Error('Only completed follow-ups can have a completed date.');}
  if(table==='POB_ACTIVITY'){if(record.Booked_Units<=0)throw new Error('Booked units must be greater than zero.');if(present(record.Fulfilled_Units)&&record.Fulfilled_Units>record.Booked_Units)throw new Error('Fulfilled units exceed booked units.');if(record.Status==='FULFILLED'&&(record.Fulfilled_Units!==record.Booked_Units||!record.Fulfilled_Date))throw new Error('Enter the full supplied quantity and fulfilment date.');if(record.Status==='PARTIAL'&&(!(record.Fulfilled_Units>0)||record.Fulfilled_Units>=record.Booked_Units||!record.Fulfilled_Date))throw new Error('Enter a partial supplied quantity and fulfilment date.');if(record.Status==='BOOKED'&&(Number(record.Fulfilled_Units)>0||record.Fulfilled_Date))throw new Error('Use partial or fulfilled status for supplied bookings.');if(record.Fulfilled_Date&&record.Fulfilled_Date<record.Booking_Date)throw new Error('Fulfilment cannot precede booking.');}
  if(table==='TARGETS'){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.Month))throw new Error('Choose a valid target month.');
    const scopeKey={AGENCY:'Agency',DOCTOR:'Doctor_ID',PHARMACY:'Pharmacy_ID'}[record.Scope];if(scopeKey&&!record[scopeKey])throw new Error('Choose the target '+scopeKey);
    if(record.Metric==='SECONDARY_REVENUE'&&(!['OVERALL','AGENCY'].includes(record.Scope)||record.Product_SKU||record.Doctor_ID||record.Pharmacy_ID||record.Quantity_Unit))throw new Error('Secondary revenue targets use overall or agency sales only, without a product, doctor, pharmacy or quantity unit.');
    if(record.Metric!=='SECONDARY_REVENUE'&&!record.Quantity_Unit)throw new Error('Choose the target quantity unit.');
    if(record.Metric==='RX_UNITS'&&record.Agency)throw new Error('Prescription quantities cannot be attributed to an agency. Use an overall, doctor or pharmacy target.');
    if(record.Scope==='OVERALL'&&(record.Agency||record.Doctor_ID||record.Pharmacy_ID))throw new Error('Overall targets cannot specify an agency, doctor or pharmacy.');
    if(record.Scope==='AGENCY'&&(record.Doctor_ID||record.Pharmacy_ID))throw new Error('Agency targets cannot specify a doctor or pharmacy.');
    if(data.TARGETS?.some(r=>r.Target_ID!==id&&r.Active==='YES'&&record.Active==='YES'&&['Month','Scope','Agency','Doctor_ID','Pharmacy_ID','Product_SKU','Metric','Quantity_Unit'].every(h=>(r[h]||'')===(record[h]||''))))throw new Error('An active target already exists for this selection. Edit it instead.');
  }
  return record;
}
export function targetActual(target,data,monthly) {
  const scope=r=>(!target.Doctor_ID||r.Doctor_ID===target.Doctor_ID)&&(!target.Pharmacy_ID||r.Pharmacy_ID===target.Pharmacy_ID)&&(!target.Product_SKU||r.Product_SKU===target.Product_SKU)&&(!target.Agency||r.Agency===target.Agency);
  if(target.Metric==='SECONDARY_REVENUE'){const rows=monthly.filter(r=>r.month===target.Month&&(!target.Agency||r.agency===target.Agency));return !rows.length||rows.some(r=>r.secondary==null)?null:rows.reduce((s,r)=>s+r.secondary,0);}
  const isRx=target.Metric==='RX_UNITS',candidates=(data[isRx?'RX_ACTIVITY':'POB_ACTIVITY']||[]).filter(r=>scope(r)&&String(r[isRx?'Prescription_Date':'Booking_Date']).startsWith(target.Month)&&(!isRx?r.Status!=='CANCELLED':true));
  const key=isRx?'Quantity':'Booked_Units';if(candidates.some(r=>!r.Quantity_Unit&&(r[key]===''||r[key]==null)))return null;
  const rows=candidates.filter(r=>r.Quantity_Unit===target.Quantity_Unit);return rows.some(r=>r[key]===''||r[key]==null)?null:rows.reduce((n,r)=>n+Number(r[key]),0);
}
