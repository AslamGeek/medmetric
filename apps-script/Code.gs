/** MedMetric: signed Sheets backend for sales reads and field activity. */
const SOURCE_ID = '1dYodW1QJQBAXvFQph-zhA_iVIjmt_YFUFlbnuZhpluE';
const TABLES = [['MONTHLY_TOTALS',14],['SALES_RAW',19],['PRODUCT_CONFIG',12]];
function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return reply_({service:'MedMetric',ok:true}); }
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 16384) return reply_({ok:false,error:'Unauthorized'});
    const packet = JSON.parse(raw);
    const secret = PropertiesService.getScriptProperties().getProperty('MEDMETRIC_BACKEND_SECRET');
    if (!secret || secret.length < 32 || typeof packet.payload !== 'string' || !/^[a-f0-9]{64}$/.test(packet.signature || '')) return reply_({ok:false,error:'Unauthorized'});
    const expected = Utilities.computeHmacSha256Signature(packet.payload,secret,Utilities.Charset.UTF_8).map(b=>(b&255).toString(16).padStart(2,'0')).join('');
    let difference=0;
    for(let i=0;i<64;i++) difference |= expected.charCodeAt(i)^packet.signature.charCodeAt(i);
    if(difference) return reply_({ok:false,error:'Unauthorized'});
    const command=JSON.parse(packet.payload);
    if(!['read','field_read','field_save'].includes(command.action) || !Number.isSafeInteger(command.timestamp) || Math.abs(Date.now()-command.timestamp)>60000 || !/^[a-f0-9-]{36}$/.test(command.nonce || '')) return reply_({ok:false,error:'Unauthorized'});
    const lock=LockService.getScriptLock();
    if(!lock.tryLock(5000)) return reply_({ok:false,error:'Busy'});
    try {
      const cache=CacheService.getScriptCache();
      const key='request-'+command.nonce;
      if(cache.get(key)) return reply_({ok:false,error:'Unauthorized'});
      cache.put(key,'used',120);
    } finally { lock.releaseLock(); }
    const ss=SpreadsheetApp.openById(SOURCE_ID);
    if(command.action==='field_read'){const data=readFields_(ss);removeRetiredTabs_(ss);return reply_({ok:true,data});}
    if(command.action==='field_save'){
      const writeLock=LockService.getScriptLock();
      if(!writeLock.tryLock(10000))return reply_({ok:false,error:'Another save is in progress. Retry with your entry unchanged.'});
      try{return reply_(saveField_(ss,command));}
      catch(error){return reply_({ok:false,error:error.message||'Could not save the entry.'});}
      finally{writeLock.releaseLock();}
    }
    const timezone=String(ss.getSpreadsheetTimeZone() || 'Asia/Kolkata');
    const valueRanges=TABLES.map(([name,width])=>{
      const sheet=ss.getSheetByName(name);
      if(!sheet) throw new Error('Missing table');
      const values=sheet.getRange(1,1,Math.max(1,sheet.getLastRow()),width).getValues().map(row=>row.map(value=>value instanceof Date ? Utilities.formatDate(value,timezone,'yyyy-MM-dd') : value));
      return {values};
    });
    return reply_({ok:true,valueRanges});
  } catch(error) { return reply_({ok:false,error:'Unable to read source spreadsheet'}); }
}
// User-requested cleanup runs only after the current tables have been read successfully.
// Old deployments keep working until this updated deployment is activated.
function removeRetiredTabs_(ss){
  const cache=CacheService.getScriptCache();if(cache.get('retired-tabs-cleaned-v2'))return;
  const lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('Another save is in progress. Retry refresh.');
  try{
    for(const [name,id] of [['RX_ACTIVITY',610020103],['FOLLOW_UPS',610020105],['TARGETS',610020106],['PHARMACY_STOCK_CHECKS',610020104]]){
      const sheet=ss.getSheetByName(name);
      if(sheet&&sheet.getSheetId()===id)ss.deleteSheet(sheet);
    }
    cache.put('retired-tabs-cleaned-v2','done',21600);
  }finally{lock.releaseLock();}
}
function readFields_(ss,names=FIELD_TABLES,includeAgencies=true) {
  const data={};
  for(const name of names){
    const sheet=ss.getSheetByName(name);if(!sheet)throw new Error('Missing '+name+' tab.');
    const values=sheet.getRange(1,1,Math.max(1,sheet.getLastRow()),FIELD_SPEC[name].headers.length).getValues().map(row=>row.map(v=>v instanceof Date?Utilities.formatDate(v,ss.getSpreadsheetTimeZone()||'Asia/Kolkata','yyyy-MM-dd'):v));
    data[name]=fieldRecords(values,FIELD_SPEC[name].headers,name);
  }
  const config=ss.getSheetByName('PRODUCT_CONFIG');
  const headers=['Your_SKU','Your_Product_Name','Your_Status','Include_In_Charts'];
  data.products=fieldProducts(fieldRecords(config.getRange(1,1,Math.max(1,config.getLastRow()),12).getValues(),headers,'PRODUCT_CONFIG'));
  if(includeAgencies){
  const totals=ss.getSheetByName('MONTHLY_TOTALS');
  const agencyValues=totals.getRange(1,7,Math.max(1,totals.getLastRow()),1).getValues();
  data.agencies=[...new Set(agencyValues.slice(1).map(r=>String(r[0]||'').trim()).filter(Boolean))].sort();
  }else data.agencies=[];
  return data;
}
function saveField_(ss,command) {
  if(!['create','update'].includes(command.operation))throw new Error('Invalid save operation.');
  const spec=FIELD_SPEC[command.table];if(!FIELD_TABLES.includes(command.table)||!spec?.required)throw new Error('This table cannot be edited from the app.');
  const data=readFields_(ss,[...new Set(['DOCTORS','PHARMACIES',command.table])],!!command.record?.Agency),today=Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd');
  if(command.links!==undefined)return saveLinks_(ss,command,data,today);
  const record=validateFieldRecord(command.table,command.record,data,today);
  const idKey=spec.headers[0],existing=data[command.table].filter(r=>r[idKey]===record[idKey]);
  if(existing.length>1)throw new Error('Duplicate activity IDs in this tab. Resolve the duplicate before editing.');
  if(command.operation==='create'&&existing.length){
    const same=spec.headers.filter(h=>!['Created_At','Updated_At'].includes(h)).every(h=>String(existing[0][h]??'')===String(record[h]??''));
    if(!same)throw new Error('This activity ID already exists with different values. Refresh before editing.');
    return {ok:true,record:existing[0],alreadySaved:true};
  }
  if(command.operation==='update'&&!existing.length)throw new Error('The entry no longer exists. Refresh and try again.');
  if(command.operation==='update'&&(!command.previous||spec.headers.some(h=>String(command.previous[h]??'')!==String(existing[0][h]??''))))throw new Error('This entry changed since you opened it. Refresh data before editing it again.');
  if(spec.headers.includes('Created_At'))record.Created_At=existing[0]?.Created_At||new Date().toISOString();
  if(spec.headers.includes('Updated_At'))record.Updated_At=new Date().toISOString();
  const sheet=ss.getSheetByName(command.table);
  let row=sheet.getLastRow()+1;
  if(existing.length){const idColumn=sheet.getRange(2,1,Math.max(1,sheet.getLastRow()-1),1).getValues();row=idColumn.findIndex(r=>r[0]===record[idKey])+2;if(row<2)throw new Error('Entry ID was not found.');}
  if(row>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),100);
  const values=spec.headers.map(h=>{
    const value=record[h]??'';
    if(value&&(spec.dates||[]).includes(h))return new Date(value+'T12:00:00Z');
    return typeof value==='string'&&value.startsWith('=')?"'"+value:value;
  });
  sheet.getRange(row,1,1,spec.headers.length).setValues([values]);
  SpreadsheetApp.flush();
  return {ok:true,record};
}

function saveLinks_(ss,command,data,today){
  if(command.table!=='DOCTOR_PRODUCTS'||command.operation!=='create'||!Array.isArray(command.links)||!command.links.length||command.links.length>data.products.length)throw new Error('Choose products to link.');
  const spec=FIELD_SPEC.DOCTOR_PRODUCTS,ids=new Set(),skus=new Set(),newRows=[];
  const records=command.links.map(link=>{
    if(!link||Object.keys(link).some(k=>!['Link_ID','Product_SKU'].includes(k)))throw new Error('Invalid product selection.');
    const record=validateFieldRecord('DOCTOR_PRODUCTS',{...command.record,...link},data,today);
    if(ids.has(record.Link_ID)||skus.has(record.Product_SKU))throw new Error('Select each product only once.');
    ids.add(record.Link_ID);skus.add(record.Product_SKU);
    const existing=data.DOCTOR_PRODUCTS.filter(r=>r.Link_ID===record.Link_ID);
    if(existing.length>1)throw new Error('Duplicate link IDs.');
    if(existing.length){if(spec.headers.some(h=>String(existing[0][h]??'')!==String(record[h]??'')))throw new Error('This link already exists with different values. Refresh before editing.');return existing[0];}
    newRows.push(record);return record;
  });
  if(newRows.length){
    const sheet=ss.getSheetByName('DOCTOR_PRODUCTS'),row=sheet.getLastRow()+1;
    if(row+newRows.length-1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),Math.max(100,row+newRows.length-1-sheet.getMaxRows()));
    sheet.getRange(row,1,newRows.length,spec.headers.length).setValues(newRows.map(record=>spec.headers.map(h=>{
      const value=record[h]??'';
      if(value&&(spec.dates||[]).includes(h))return new Date(value+'T12:00:00Z');
      return typeof value==='string'&&value.startsWith('=')?"'"+value:value;
    })));
    SpreadsheetApp.flush();
  }
  return {ok:true,records,alreadySaved:!newRows.length};
}

// BEGIN GENERATED FIELD TRACKING
// Shared with the Apps Script backend by scripts/build-field-backend.js.
const FIELD_SPEC = {
  DOCTORS: {headers:'Doctor_ID,Doctor_Name,Specialties,Hospital,Pharmacy_ID,Area,Camp,Potential,Prescriber_Status,Stockist,OP_Timing,Call_Schedule,Notes,Active'.split(',')},
  PHARMACIES: {headers:'Pharmacy_ID,Pharmacy_Name,Area,Camp,Stockist,Identity_Status,Notes,Active'.split(',')},
  DOCTOR_PRODUCTS: {headers:'Link_ID,Doctor_ID,Product_SKU,Pharmacy_ID,Relationship,Start_Date,End_Date,Notes,Active'.split(','),required:['Doctor_ID','Product_SKU','Relationship','Active'],dates:['Start_Date','End_Date'],options:{Relationship:['EXISTING','DISCUSSION','OTHER'],Active:['YES','NO']}},
  RX_ACTIVITY: {headers:'Rx_ID,Prescription_Date,Reported_Date,Doctor_ID,Pharmacy_ID,Product_SKU,Quantity,Quantity_Unit,Confirmation,Notes,Created_At,Updated_At'.split(','),required:['Reported_Date','Doctor_ID','Product_SKU','Confirmation'],dates:['Prescription_Date','Reported_Date'],numbers:['Quantity'],options:{Confirmation:['REPORTED','CONFIRMED']}},
  FOLLOW_UPS: {headers:'Follow_Up_ID,Doctor_ID,Pharmacy_ID,Product_SKU,Due_Date,Reason,Status,Completed_Date,Notes,Created_At,Updated_At'.split(','),required:['Due_Date','Reason','Status'],dates:['Due_Date','Completed_Date'],options:{Reason:['PRESCRIPTION_REVIEW','STOCK_CHECK','REPLENISHMENT_REVIEW','POB_REVIEW','PRODUCT_DISCUSSION','OTHER'],Status:['OPEN','DONE','CANCELLED']}},
  TARGETS: {headers:'Target_ID,Month,Scope,Agency,Doctor_ID,Pharmacy_ID,Product_SKU,Metric,Target_Value,Quantity_Unit,Notes,Active'.split(','),required:['Month','Scope','Metric','Target_Value','Active'],numbers:['Target_Value'],options:{Scope:['OVERALL','AGENCY','DOCTOR','PHARMACY'],Metric:['SECONDARY_REVENUE','RX_UNITS','POB_UNITS'],Active:['YES','NO']}},
  POB_ACTIVITY: {headers:'POB_ID,Booking_Date,Doctor_ID,Pharmacy_ID,Agency,Product_SKU,Booked_Units,Quantity_Unit,Status,Fulfilled_Units,Fulfilled_Date,Notes,Created_At,Updated_At'.split(','),required:['Booking_Date','Pharmacy_ID','Product_SKU','Booked_Units','Quantity_Unit','Status'],dates:['Booking_Date','Fulfilled_Date'],numbers:['Booked_Units','Fulfilled_Units'],options:{Status:['BOOKED','PARTIAL','FULFILLED','CANCELLED']}}
};
const FIELD_TABLES=['DOCTORS','PHARMACIES','DOCTOR_PRODUCTS','POB_ACTIVITY'];
const QUANTITY_UNITS=['STOCK_UNIT','TABLET','STRIP','BOTTLE','SACHET','AMPOULE','VIAL','TUBE','PACK','OTHER'];
function indiaToday(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function fieldRecords(values,headers,name) {
  if(!Array.isArray(values)||headers.some(h=>!values[0]?.includes(h)))throw new Error(name+' has missing headers.');
  return values.slice(1).filter(row=>row.some(v=>v!==''&&v!=null)).map(row=>Object.fromEntries(headers.map(h=>[h,row[values[0].indexOf(h)]??''])));
}
function fieldProducts(config) {
  const products=new Map();
  for(const row of config){const sku=String(row.Your_SKU||'').trim();if(!sku)continue;
    const name=String(row.Your_Product_Name||sku).trim(),existing=products.get(sku);
    if(existing&&existing.Product_Name!==name)throw new Error('Conflicting names for SKU '+sku+' in PRODUCT_CONFIG.');
    const active=String(row.Your_Status)==='ACTIVE'&&String(row.Include_In_Charts).toUpperCase()==='YES';
    products.set(sku,{Product_SKU:sku,Product_Name:name,Active:active||existing?.Active||false});
  }
  return [...products.values()].sort((a,b)=>a.Product_Name.localeCompare(b.Product_Name));
}
function validateFieldRecord(table,input,data,today=indiaToday()) {
  const spec=FIELD_SPEC[table];if(!spec?.required)throw new Error('This table cannot be edited from the app.');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid record.');
  if(Object.keys(input).some(k=>!spec.headers.includes(k)))throw new Error('Unknown record field.');
  const record={};for(const h of spec.headers){const v=input[h]??'';if(!['string','number'].includes(typeof v)||String(v).length>2000)throw new Error('Invalid '+h);record[h]=typeof v==='string'?v.trim():v;}
  const present=v=>v!==''&&v!=null;
  const id=record[spec.headers[0]];if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new Error('Invalid activity ID.');
  for(const h of spec.required)if(!present(record[h]))throw new Error(h.replaceAll('_',' ')+' is required.');
  for(const h of spec.dates||[]){const v=record[h];if(!v)continue;if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||isNaN(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw new Error('Invalid '+h);
    if(['Prescription_Date','Reported_Date','Booking_Date','Fulfilled_Date','Completed_Date'].includes(h)&&v>today)throw new Error(h.replaceAll('_',' ')+' cannot be in the future.');}
  for(const h of spec.numbers||[]){if(!present(record[h]))continue;if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(record[h]))||!Number.isFinite(Number(record[h]))||Number(record[h])<0)throw new Error(h.replaceAll('_',' ')+' must be a non-negative number.');record[h]=Number(record[h]);}
  for(const [h,choices] of Object.entries(spec.options||{}))if(present(record[h])&&!choices.includes(record[h]))throw new Error('Invalid '+h);
  for(const [h,name,idKey] of [['Doctor_ID','DOCTORS','Doctor_ID'],['Pharmacy_ID','PHARMACIES','Pharmacy_ID']])if(record[h]&&!data[name]?.some(r=>r[idKey]===record[h]))throw new Error('Unknown '+h);
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
function targetActual(target,data,monthly) {
  const scope=r=>(!target.Doctor_ID||r.Doctor_ID===target.Doctor_ID)&&(!target.Pharmacy_ID||r.Pharmacy_ID===target.Pharmacy_ID)&&(!target.Product_SKU||r.Product_SKU===target.Product_SKU)&&(!target.Agency||r.Agency===target.Agency);
  if(target.Metric==='SECONDARY_REVENUE'){const rows=monthly.filter(r=>r.month===target.Month&&(!target.Agency||r.agency===target.Agency));return !rows.length||rows.some(r=>r.secondary==null)?null:rows.reduce((s,r)=>s+r.secondary,0);}
  const isRx=target.Metric==='RX_UNITS',candidates=(data[isRx?'RX_ACTIVITY':'POB_ACTIVITY']||[]).filter(r=>scope(r)&&String(r[isRx?'Prescription_Date':'Booking_Date']).startsWith(target.Month)&&(!isRx?r.Status!=='CANCELLED':true));
  const key=isRx?'Quantity':'Booked_Units';if(candidates.some(r=>!r.Quantity_Unit&&(r[key]===''||r[key]==null)))return null;
  const rows=candidates.filter(r=>r.Quantity_Unit===target.Quantity_Unit);return rows.some(r=>r[key]===''||r[key]==null)?null:rows.reduce((n,r)=>n+Number(r[key]),0);
}

// END GENERATED FIELD TRACKING
