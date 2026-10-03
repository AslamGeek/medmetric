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
    // Prices are auxiliary reference data. A missing price tab must not prevent sales reads.
    const priceList=readPriceList_(ss);
    return reply_({ok:true,valueRanges,priceList});
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
function readPriceList_(ss){
  try{const prices=ss.getSheetByName('PRICE_LIST');return prices?{values:prices.getRange(1,1,Math.max(1,prices.getLastRow()),17).getValues()}:null;}catch(error){return null;}
}
function readFields_(ss,names=FIELD_TABLES,includeAgencies=true,includeProducts=true,saveOptions={}) {
  const data={products:[]},timezone=ss.getSpreadsheetTimeZone()||'Asia/Kolkata';
  for(const name of names){
    const sheet=ss.getSheetByName(name);if(!sheet)throw new Error('Missing '+name+' tab.');
    const rowCount=Math.max(1,sheet.getLastRow()),doctorSave=name==='DOCTORS'&&saveOptions.doctorSave,columnCount=doctorSave?sheet.getMaxColumns():FIELD_SPEC[name].headers.length;
    const values=sheet.getRange(1,1,rowCount,doctorSave?Math.min(16,columnCount):FIELD_SPEC[name].headers.length).getValues().map(row=>row.map(v=>v instanceof Date?Utilities.formatDate(v,timezone,'yyyy-MM-dd'):v));
    if(!FIELD_SPEC[name].headers.every((header,i)=>String(values[0][i]||'').trim()===header))throw new Error(name+' headers changed. Restore the expected column order before saving.');
    data[name]=fieldRecords(values.map(row=>row.slice(0,FIELD_SPEC[name].headers.length)),FIELD_SPEC[name].headers,name);
    if(doctorSave)data.doctorStorage={rowCount,columnCount,tokenHeader:String(values[0][14]||''),productsHeader:String(values[0][15]||''),rows:values.slice(1).map((r,i)=>({row:i+2,id:r[0],token:r[14],productIntent:r[15]}))};
  }
  if(includeProducts){
  const config=ss.getSheetByName('PRODUCT_CONFIG');
  const headers=['Your_SKU','Your_Product_Name','Your_Status','Include_In_Charts'];
  data.products=fieldProducts(fieldRecords(config.getRange(1,1,Math.max(1,config.getLastRow()),12).getValues(),headers,'PRODUCT_CONFIG'));
  }
  if(includeAgencies){
  const totals=ss.getSheetByName('MONTHLY_TOTALS');
  const agencyValues=totals.getRange(1,7,Math.max(1,totals.getLastRow()),1).getValues();
  data.agencies=[...new Set(agencyValues.slice(1).map(r=>String(r[0]||'').trim()).filter(Boolean))].sort();
  }else data.agencies=[];
  if(saveOptions.options!==false){
    const options=ss.getSheetByName('FIELD_OPTIONS');if(!options)throw new Error('Missing FIELD_OPTIONS tab.');
    data.options=fieldOptions(options.getRange(1,1,Math.max(1,options.getLastRow()),FIELD_OPTIONS_HEADERS.length).getDisplayValues());
  }
  data.schemaVersion=2;
  data.capabilities={doctorProducts:true};
  if(names===FIELD_TABLES)data.priceList=readPriceList_(ss);
  return data;
}
function saveField_(ss,command) {
  if(!['create','update'].includes(command.operation))throw new Error('Invalid save operation.');
  const spec=FIELD_SPEC[command.table];if(!FIELD_TABLES.includes(command.table)||!spec?.required)throw new Error('This table cannot be edited from the app.');
  const doctorSave=command.table==='DOCTORS',needsDoctorLinks=doctorSave&&(command.record?.Prescriber_Status==='Rx'||command.doctorProducts!==undefined);
  const data=readFields_(ss,[...new Set(['DOCTORS','PHARMACIES',command.table,...(needsDoctorLinks?['DOCTOR_PRODUCTS']:[])])],!!command.record?.Agency,!doctorSave||!!command.doctorProducts?.length,{doctorSave,options:doctorSave}),today=Utilities.formatDate(new Date(),'Asia/Kolkata','yyyy-MM-dd');
  if(command.links!==undefined)return saveLinks_(ss,command,data,today);
  if(command.table==='DOCTORS')return saveDoctor_(ss,command,data,today);
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

// Called under the field_save script lock: ID allocation and pharmacy creation are serialized.
function saveDoctor_(ss,command,data,today){
  const sheet=ss.getSheetByName('DOCTORS'),spec=FIELD_SPEC.DOCTORS,creating=command.operation==='create';
  const normalize=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
  if(!command.record||typeof command.record!=='object'||Array.isArray(command.record))throw new Error('Invalid doctor record.');
  if(creating&&(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(command.requestId||'')||command.record.Doctor_ID))throw new Error('Update the app before adding doctors; doctor IDs are assigned when saved.');
  const storage=data.doctorStorage,tokenHeader=storage.tokenHeader;
  if(tokenHeader&&tokenHeader!=='Create_Request_ID')throw new Error('DOCTORS column O must be reserved for Create_Request_ID.');
  const productsHeader=storage.productsHeader;
  if(productsHeader&&productsHeader!=='Create_Product_Links')throw new Error('DOCTORS column P must be reserved for Create_Product_Links.');
  const tokenRows=creating&&tokenHeader?storage.rows.filter(r=>r.token===command.requestId):[];
  if(tokenRows.length>1)throw new Error('Duplicate doctor create request IDs.');
  const priorId=tokenRows.length?String(tokenRows[0].id):command.record.Doctor_ID;
  const originals=data.DOCTORS.filter(d=>d.Doctor_ID===priorId),original=originals[0];
  if(originals.length>1)throw new Error('Duplicate doctor IDs. Resolve the duplicate before saving.');
  if(!creating&&!original)throw new Error('The doctor no longer exists. Refresh and try again.');
  if(!creating&&!command.previous)throw new Error('This doctor changed since you opened the form. Refresh before editing again.');
  const changed=!creating&&spec.headers.some(h=>String(command.previous[h]??'')!==String(original[h]??''));
  const name=command.pharmacyName;
  if(name!==undefined&&(typeof name!=='string'||name.trim().length>2000))throw new Error('Invalid pharmacy name.');
  if(name!==undefined&&!name.trim())throw new Error('Enter the pharmacy name.');
  let pharmacy,newPharmacy=false;
  const currentPharmacy=data.PHARMACIES.find(p=>p.Pharmacy_ID===original?.Pharmacy_ID);
  if(!creating&&name===undefined){
    pharmacy=data.PHARMACIES.find(p=>p.Pharmacy_ID===command.record.Pharmacy_ID);
    if(!pharmacy)throw new Error('Choose an existing pharmacy or enter the pharmacy name.');
  }else if(currentPharmacy&&normalize(name)===normalize(currentPharmacy.Pharmacy_Name)){
    pharmacy=currentPharmacy;
  }else{
    if(!name?.trim())throw new Error('Enter the pharmacy name.');
    const matches=data.PHARMACIES.filter(p=>normalize(p.Pharmacy_Name)===normalize(name)&&normalize(p.Area)===normalize(command.record.Area)&&normalize(p.Camp)===normalize(command.record.Camp));
    if(matches.length>1)throw new Error('Duplicate pharmacies with this name, area and camp. Resolve them before saving.');
    pharmacy=matches[0];
    if(!pharmacy){
      const latest=data.PHARMACIES.reduce((max,p)=>{const m=String(p.Pharmacy_ID).match(/^PH-(\d+)$/);return m?Math.max(max,Number(m[1])):max;},0);
      if(!Number.isSafeInteger(latest+1))throw new Error('Pharmacy ID sequence is out of range.');
      pharmacy={Pharmacy_ID:'PH-'+String(latest+1).padStart(3,'0'),Pharmacy_Name:name.trim(),Area:String(command.record.Area||'').trim(),Camp:String(command.record.Camp||'').trim(),Stockist:command.record.Stockist||'',Identity_Status:'ENTERED',Notes:'',Active:'YES'};
      newPharmacy=true;
    }
  }
  const proposed={...command.record,Doctor_ID:original?.Doctor_ID||nextDoctorId(command.record.Camp,data.DOCTORS),Pharmacy_ID:pharmacy.Pharmacy_ID};
  const record=validateFieldRecord('DOCTORS',proposed,{...data,PHARMACIES:newPharmacy?[...data.PHARMACIES,pharmacy]:data.PHARMACIES},today);
  const sameDoctor=original&&spec.headers.every(h=>String(original[h]??'')===String(record[h]??''));
  if(changed&&!sameDoctor)throw new Error('This doctor changed since you opened the form. Refresh before editing again.');
  if(creating&&record.Prescriber_Status==='Rx'&&command.doctorProducts===undefined)throw new Error('Update the app and select prescribed products before creating an Rx doctor.');
  const doctorProducts=command.doctorProducts!==undefined?doctorProductLinks(command.doctorProducts,record,{...data,PHARMACIES:newPharmacy?[...data.PHARMACIES,pharmacy]:data.PHARMACIES},today):[];
  const productIntent=JSON.stringify(doctorProducts.map(r=>({Link_ID:r.Link_ID,Product_SKU:r.Product_SKU})).sort((a,b)=>a.Product_SKU.localeCompare(b.Product_SKU)));
  const newLinks=doctorProducts.filter(r=>!data.DOCTOR_PRODUCTS.some(existing=>existing.Link_ID===r.Link_ID));
  if(creating&&original){
    if(!sameDoctor)throw new Error('This doctor request already saved with different values. Refresh before editing.');
    const priorIntent=productsHeader?String(tokenRows[0].productIntent||''):'';
    if(priorIntent&&priorIntent!==productIntent)throw new Error('This doctor request already saved with a different product selection. Retry unchanged or refresh before editing.');
    appendLinkRecords_(ss,newLinks);
    return {ok:true,record:original,pharmacies:[pharmacy],doctorProducts,alreadySaved:true};
  }
  // A response may be lost after the doctor row commits. Confirm the identical edit and finish any missing links.
  if(!creating&&sameDoctor){
    appendLinkRecords_(ss,newLinks);
    return {ok:true,record:original,pharmacies:[pharmacy],doctorProducts,alreadySaved:true};
  }
  // Validate the complete doctor before making any writes. Reuse the pharmacy if a prior save was interrupted.
  if(creating){
    if(storage.columnCount<16)sheet.insertColumnsAfter(storage.columnCount,16-storage.columnCount);
    if(!tokenHeader){sheet.getRange(1,15).setValue('Create_Request_ID');sheet.hideColumns(15);}
    if(!productsHeader){sheet.getRange(1,16).setValue('Create_Product_Links');sheet.hideColumns(16);}
  }
  if(newPharmacy){
    const pharmacies=ss.getSheetByName('PHARMACIES'),row=pharmacies.getLastRow()+1;
    if(row>pharmacies.getMaxRows())pharmacies.insertRowsAfter(pharmacies.getMaxRows(),100);
    pharmacies.getRange(row,1,1,FIELD_SPEC.PHARMACIES.headers.length).setValues([FIELD_SPEC.PHARMACIES.headers.map(h=>safeCell_(pharmacy[h]))]);
  }
  const row=creating?storage.rowCount+1:storage.rows.find(r=>r.id===record.Doctor_ID)?.row;
  if(!row||row<2)throw new Error('Doctor ID was not found.');
  if(row>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),100);
  const values=spec.headers.map(h=>safeCell_(record[h]));
  if(creating)values.push(command.requestId,productIntent);
  sheet.getRange(row,1,1,values.length).setValues([values]);
  SpreadsheetApp.flush();
  // Stable link IDs and the saved selection let an interrupted create finish on retry.
  appendLinkRecords_(ss,newLinks);
  return {ok:true,record,pharmacies:[pharmacy],doctorProducts};
}
function safeCell_(value){const v=value??'';return typeof v==='string'&&v.startsWith('=')?"'"+v:v;}

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
  appendLinkRecords_(ss,newRows);
  return {ok:true,records,alreadySaved:!newRows.length};
}
function appendLinkRecords_(ss,newRows){
  if(newRows.length){
    const spec=FIELD_SPEC.DOCTOR_PRODUCTS;
    const sheet=ss.getSheetByName('DOCTOR_PRODUCTS'),row=sheet.getLastRow()+1;
    if(row+newRows.length-1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),Math.max(100,row+newRows.length-1-sheet.getMaxRows()));
    sheet.getRange(row,1,newRows.length,spec.headers.length).setValues(newRows.map(record=>spec.headers.map(h=>{
      const value=record[h]??'';
      if(value&&(spec.dates||[]).includes(h))return new Date(value+'T12:00:00Z');
      return typeof value==='string'&&value.startsWith('=')?"'"+value:value;
    })));
    SpreadsheetApp.flush();
  }
}

// BEGIN GENERATED FIELD TRACKING
// Shared with the Apps Script backend by scripts/build-field-backend.js.
const FIELD_SPEC = {
  DOCTORS: {headers:'Doctor_ID,Doctor_Name,Specialties,Hospital,Pharmacy_ID,Area,Camp,Potential,Prescriber_Status,Stockist,OP_Timing,Call_Schedule,Notes,Active'.split(','),required:['Doctor_Name','Pharmacy_ID','Area','Camp','Active'],options:{Stockist:['Both','Madhu','Meda'],Prescriber_Status:['Rx','NRx'],Active:['YES','NO']}},
  PHARMACIES: {headers:'Pharmacy_ID,Pharmacy_Name,Area,Camp,Stockist,Identity_Status,Notes,Active'.split(',')},
  DOCTOR_PRODUCTS: {headers:'Link_ID,Doctor_ID,Product_SKU,Pharmacy_ID,Relationship,Start_Date,End_Date,Notes,Active'.split(','),required:['Doctor_ID','Product_SKU','Relationship','Active'],dates:['Start_Date','End_Date'],options:{Relationship:['EXISTING','DISCUSSION','OTHER'],Active:['YES','NO']}},
  RX_ACTIVITY: {headers:'Rx_ID,Prescription_Date,Reported_Date,Doctor_ID,Pharmacy_ID,Product_SKU,Quantity,Quantity_Unit,Confirmation,Notes,Created_At,Updated_At'.split(','),required:['Reported_Date','Doctor_ID','Product_SKU','Confirmation'],dates:['Prescription_Date','Reported_Date'],numbers:['Quantity'],options:{Confirmation:['REPORTED','CONFIRMED']}},
  FOLLOW_UPS: {headers:'Follow_Up_ID,Doctor_ID,Pharmacy_ID,Product_SKU,Due_Date,Reason,Status,Completed_Date,Notes,Created_At,Updated_At'.split(','),required:['Due_Date','Reason','Status'],dates:['Due_Date','Completed_Date'],options:{Reason:['PRESCRIPTION_REVIEW','STOCK_CHECK','REPLENISHMENT_REVIEW','POB_REVIEW','PRODUCT_DISCUSSION','OTHER'],Status:['OPEN','DONE','CANCELLED']}},
  TARGETS: {headers:'Target_ID,Month,Scope,Agency,Doctor_ID,Pharmacy_ID,Product_SKU,Metric,Target_Value,Quantity_Unit,Notes,Active'.split(','),required:['Month','Scope','Metric','Target_Value','Active'],numbers:['Target_Value'],options:{Scope:['OVERALL','AGENCY','DOCTOR','PHARMACY'],Metric:['SECONDARY_REVENUE','RX_UNITS','POB_UNITS'],Active:['YES','NO']}},
  POB_ACTIVITY: {headers:'POB_ID,Booking_Date,Doctor_ID,Pharmacy_ID,Agency,Product_SKU,Booked_Units,Quantity_Unit,Status,Fulfilled_Units,Fulfilled_Date,Notes,Created_At,Updated_At'.split(','),required:['Booking_Date','Pharmacy_ID','Product_SKU','Booked_Units','Quantity_Unit','Status'],dates:['Booking_Date','Fulfilled_Date'],numbers:['Booked_Units','Fulfilled_Units'],options:{Status:['BOOKED','PARTIAL','FULFILLED','CANCELLED']}}
};
const FIELD_TABLES=['DOCTORS','PHARMACIES','DOCTOR_PRODUCTS','POB_ACTIVITY'];
const FIELD_OPTIONS_HEADERS=['Areas','Specialties','Camps','Potentials','Stockist','OP Timings','Call Schedule'];
const DOCTOR_OPTION_COLUMNS={Area:'Areas',Specialties:'Specialties',Camp:'Camps',Potential:'Potentials',Stockist:'Stockist',OP_Timing:'OP Timings',Call_Schedule:'Call Schedule'};
const CAMP_CODES={'Jammalamadugu':'JAMD','Mydukuru/GV Satram':'MYGV','Porumamilla/Kalasapadu':'POKA','Proddatur':'PDTR','Yerraguntla/Kamalapuram':'YEKA'};
const splitSpecialties=value=>[...new Set(String(value||'').split(/[;,|]/).map(v=>v.trim()).filter(Boolean))];
function fieldOptions(values){
  if(!Array.isArray(values)||FIELD_OPTIONS_HEADERS.some((h,i)=>String(values[0]?.[i]||'').trim()!==h))throw new Error('FIELD_OPTIONS needs the expected seven column headers.');
  return Object.fromEntries(FIELD_OPTIONS_HEADERS.map((h,i)=>[h,h==='Stockist'?[...FIELD_SPEC.DOCTORS.options.Stockist]:[...new Set(values.slice(1).map(row=>String(row[i]??'').trim()).filter(Boolean))]]));
}
function doctorCampCode(camp,doctors=[]){
  const name=String(camp||'').trim(),normalized=name.toLowerCase();
  if(!name)throw new Error('Choose a camp before assigning a doctor ID.');
  const configured=Object.entries(CAMP_CODES).find(([key])=>key.toLowerCase()===normalized)?.[1];
  // An edited camp keeps the doctor's ID, so configured prefixes follow the camp code rather than current membership.
  if(configured)return configured;
  const prefixes=[...new Set(doctors.filter(d=>String(d.Camp).trim().toLowerCase()===normalized&&/^[A-Z]{2,12}-\d+$/.test(d.Doctor_ID)).map(d=>d.Doctor_ID.split('-')[0]))];
  if(prefixes.length>1)throw new Error('This camp has conflicting doctor ID prefixes. Correct them before adding a doctor.');
  const letters=name.toUpperCase().replace(/[^A-Z]/g,''),consonants=letters.replace(/[AEIOU]/g,'');
  const code=configured||prefixes[0]||(consonants.length>=3?consonants:letters).slice(0,4);
  if(!/^[A-Z]{2,12}$/.test(code))throw new Error('This camp needs a valid code in CAMP_CODES before adding a doctor.');
  if(doctors.some(d=>String(d.Camp).trim().toLowerCase()!==normalized&&String(d.Doctor_ID).startsWith(code+'-'))||Object.entries(CAMP_CODES).some(([key,value])=>key.toLowerCase()!==normalized&&value===code))throw new Error('This camp code is already in use. Assign a unique code in CAMP_CODES.');
  return code;
}
function nextDoctorId(camp,doctors=[]){
  const prefix=doctorCampCode(camp,doctors),pattern=new RegExp('^'+prefix+'-(\\d+)$');
  const latest=doctors.reduce((max,d)=>{const match=String(d.Doctor_ID).match(pattern);return match?Math.max(max,Number(match[1])):max;},0);
  if(!Number.isSafeInteger(latest+1))throw new Error('Doctor ID sequence is out of range.');
  return prefix+'-'+String(latest+1).padStart(3,'0');
}
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
    const active=String(row.Your_Status).trim().toUpperCase()==='ACTIVE';
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
    for(const h of ['Area','Camp','Potential'])if(record[h]&&record[h]!==original?.[h]&&!data.options?.[DOCTOR_OPTION_COLUMNS[h]]?.includes(record[h]))throw new Error('Choose '+h.toLowerCase()+' from FIELD_OPTIONS.');
    const specialties=splitSpecialties(record.Specialties),allowed=new Set([...(data.options?.Specialties||[]),...splitSpecialties(original?.Specialties)]);
    if(specialties.some(v=>!allowed.has(v)))throw new Error('Choose specialties from FIELD_OPTIONS.');
    record.Specialties=specialties.join(', ');
    const identity=d=>[d.Doctor_Name,d.Hospital,d.Camp].map(value=>String(value||'').toLowerCase().replace(/\s+/g,' ').trim()).join('\u0000');
    if((!original||identity(original)!==identity(record))&&data.DOCTORS.some(d=>d.Doctor_ID!==id&&identity(d)===identity(record)))throw new Error('A doctor with this name, hospital and camp already exists. Open that doctor to edit.');
  }
  if(record.Doctor_ID&&['DOCTOR_PRODUCTS','POB_ACTIVITY','FOLLOW_UPS','RX_ACTIVITY'].includes(table)){
    const previous=data[table]?.find(r=>r[spec.headers[0]]===id);
    const pharmacy=previous?.Doctor_ID===record.Doctor_ID&&previous.Pharmacy_ID&&previous.Pharmacy_ID===record.Pharmacy_ID?previous.Pharmacy_ID:data.DOCTORS.find(d=>d.Doctor_ID===record.Doctor_ID)?.Pharmacy_ID;
    if(!pharmacy)throw new Error('This doctor has no pharmacy in the doctor master.');
    if(record.Pharmacy_ID&&record.Pharmacy_ID!==pharmacy)throw new Error('Use the pharmacy from the doctor’s details.');
    record.Pharmacy_ID=pharmacy;
  }
  if(record.Product_SKU){
    const product=data.products?.find(p=>p.Product_SKU===record.Product_SKU);
    if(!product)throw new Error('Choose an existing product SKU.');
    const previous=data[table]?.find(r=>r[spec.headers[0]]===id);
    if(!product.Active&&previous?.Product_SKU!==record.Product_SKU)throw new Error('Choose an active product for a new entry or changed product.');
  }
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
// Initial Rx links use unknown dates and quantities; a doctor save records relationships only.
function doctorProductLinks(selection,doctor,data,today=indiaToday()){
  if(!Array.isArray(selection)||selection.length>data.products.length)throw new Error('Invalid prescribed product selection.');
  if(doctor.Prescriber_Status!=='Rx'&&selection.length)throw new Error('Select Rx before adding prescribed products.');
  const ids=new Set(),skus=new Set();
  const records=selection.map(link=>{
    if(!link||typeof link!=='object'||Array.isArray(link)||Object.keys(link).some(k=>!['Link_ID','Product_SKU'].includes(k)))throw new Error('Invalid prescribed product selection.');
    const record=validateFieldRecord('DOCTOR_PRODUCTS',{...link,Doctor_ID:doctor.Doctor_ID,Pharmacy_ID:doctor.Pharmacy_ID,Relationship:'EXISTING',Start_Date:'',End_Date:'',Notes:'',Active:'YES'},{...data,DOCTORS:[...data.DOCTORS.filter(d=>d.Doctor_ID!==doctor.Doctor_ID),doctor]},today);
    if(ids.has(record.Link_ID)||skus.has(record.Product_SKU))throw new Error('Select each prescribed product only once.');
    ids.add(record.Link_ID);skus.add(record.Product_SKU);
    const existing=data.DOCTOR_PRODUCTS.filter(r=>r.Link_ID===record.Link_ID);
    if(existing.length>1)throw new Error('Duplicate link IDs.');
    if(existing.length&&FIELD_SPEC.DOCTOR_PRODUCTS.headers.some(h=>String(existing[0][h]??'')!==String(record[h]??'')))throw new Error('This prescribed product request already saved with different values. Refresh before editing.');
    if(data.DOCTOR_PRODUCTS.some(r=>r.Link_ID!==record.Link_ID&&r.Doctor_ID===doctor.Doctor_ID&&r.Product_SKU===record.Product_SKU&&r.Relationship==='EXISTING'&&r.Active==='YES'))throw new Error('This prescribed product is already linked to the doctor. Refresh before editing.');
    return existing[0]||record;
  });
  if(doctor.Prescriber_Status==='Rx'&&!records.length&&!data.DOCTOR_PRODUCTS.some(r=>r.Doctor_ID===doctor.Doctor_ID&&r.Relationship==='EXISTING'&&r.Active==='YES'))throw new Error('Choose at least one prescribed product for an Rx doctor.');
  return records;
}
function targetActual(target,data,monthly) {
  const scope=r=>(!target.Doctor_ID||r.Doctor_ID===target.Doctor_ID)&&(!target.Pharmacy_ID||r.Pharmacy_ID===target.Pharmacy_ID)&&(!target.Product_SKU||r.Product_SKU===target.Product_SKU)&&(!target.Agency||r.Agency===target.Agency);
  if(target.Metric==='SECONDARY_REVENUE'){const rows=monthly.filter(r=>r.month===target.Month&&(!target.Agency||r.agency===target.Agency));return !rows.length||rows.some(r=>r.secondary==null)?null:rows.reduce((s,r)=>s+r.secondary,0);}
  const isRx=target.Metric==='RX_UNITS',candidates=(data[isRx?'RX_ACTIVITY':'POB_ACTIVITY']||[]).filter(r=>scope(r)&&String(r[isRx?'Prescription_Date':'Booking_Date']).startsWith(target.Month)&&(!isRx?r.Status!=='CANCELLED':true));
  const key=isRx?'Quantity':'Booked_Units';if(candidates.some(r=>!r.Quantity_Unit&&(r[key]===''||r[key]==null)))return null;
  const rows=candidates.filter(r=>r.Quantity_Unit===target.Quantity_Unit);return rows.some(r=>r[key]===''||r[key]==null)?null:rows.reduce((n,r)=>n+Number(r[key]),0);
}

// END GENERATED FIELD TRACKING
