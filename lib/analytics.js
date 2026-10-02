// Pure analytics shared by authenticated Next.js route handlers.
const HEADERS = {
  MONTHLY_TOTALS: 'Statement_ID,Month,Period_Start,Period_End,Period_Days,Is_Full_Month,Agency,Opening_Value,Purchase_Value,Sale_Value,Closing_Value,Product_Row_Count,Source_PDF,Coverage'.split(','),
  SALES_RAW: 'Statement_ID,Month,Period_Start,Period_End,Period_Days,Is_Full_Month,Agency,Product_Name,Packing,O_Stk,Purc,Tot,Sale,QOH,Value,Age,Source_PDF,Source_Line_No,Raw_Row_Text'.split(','),
  PRODUCT_CONFIG: 'Raw_Product_Name,Agency_Reference,Packing_Seen,Agencies_Seen,First_Month,Last_Month,Your_Product_Name,Your_SKU,Your_Brand_Group,Your_Status,Include_In_Charts,Notes'.split(',')
};

function dateMonth_(value,tz='Etc/UTC') { const p=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',timeZone:tz}).formatToParts(value); return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value; }
function text_(v) { return v == null ? '' : String(v).trim(); }
function yes_(v) { return v === true || /^(yes|true|1)$/i.test(text_(v)); }
function unique_(items) { return [...new Set(items)].sort(); }
function num_(v, location) {
  if (v == null || text_(v) === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = text_(v).replace(/[₹,\s]/g, '');
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) throw new Error('Invalid number at ' + location + '. Correct the source cell before loading analytics.');
  return Number(s);
}
function month_(value, tz) {
  if (value instanceof Date && !isNaN(value.getTime())) return dateMonth_(value, tz);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return d.toISOString().slice(0, 7);
  }
  const s = text_(value);
  let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2}(?:T.*)?)?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return m[1] + '-' + m[2].padStart(2, '0');
  m = s.match(/^(?:\d{1,2}[-\s])?([A-Za-z]+)[-\s](\d{4})$/);
  if (m) {
    const index = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase());
    if (index >= 0) return m[2] + '-' + String(index + 1).padStart(2, '0');
  }
  return null; // Ambiguous numeric day/month strings are deliberately not guessed.
}
function shiftMonth_(m, n) { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0,7); }
function monthList_(start, end) { const a = []; for (let m = start; m && m <= end; m = shiftMonth_(m,1)) { a.push(m); if (a.length > 240) throw new Error('Choose a period of 20 years or less.'); } return a; }
function sum_(rows, key) { return !rows.length || rows.some(r => r[key] == null) ? null : rows.reduce((s,r) => s + r[key], 0); }
function add_(a,b) { return a == null || b == null ? null : a+b; }
function money_(v) { return v == null ? 'unavailable' : '₹' + v.toLocaleString('en-IN', {maximumFractionDigits:2}); }

function prepare_(totals, raw, config, tz) {
  const warnings = [];
  const lookup = new Map();
  config.forEach(c => {
    const rawName = text_(c.Raw_Product_Name); if (!rawName) return;
    const item = {rawName, agency:text_(c.Agency_Reference), productName:text_(c.Your_Product_Name), sku:text_(c.Your_SKU), brand:text_(c.Your_Brand_Group), status:text_(c.Your_Status), include:yes_(c.Include_In_Charts), includeFlag:text_(c.Include_In_Charts).toUpperCase()};
    if (!lookup.has(rawName)) lookup.set(rawName,[]);
    lookup.get(rawName).push(item);
  });
  function base(r, tab) {
    const month = month_(r.Month,tz) || month_(r.Period_Start,tz);
    if (!month) throw new Error(tab + ' row ' + r._row + ': unrecognized Month and Period_Start. Use a date cell, YYYY-MM, or a month name with four-digit year.');
    const agency = text_(r.Agency); if (!agency) throw new Error(tab + ' row ' + r._row + ': Agency is blank.');
    const out = {month,agency,statementId:text_(r.Statement_ID),full:yes_(r.Is_Full_Month),periodStart:text_(r.Period_Start),periodEnd:text_(r.Period_End),periodDays:num_(r.Period_Days,tab+'!E'+r._row),source:text_(r.Source_PDF),sheetRow:r._row};
    return out;
  }
  const monthly = totals.map(r => Object.assign(base(r,'MONTHLY_TOTALS'), {
    primary:num_(r.Purchase_Value,'MONTHLY_TOTALS!I'+r._row),secondary:num_(r.Sale_Value,'MONTHLY_TOTALS!J'+r._row),closing:num_(r.Closing_Value,'MONTHLY_TOTALS!K'+r._row),opening:num_(r.Opening_Value,'MONTHLY_TOTALS!H'+r._row),coverage:text_(r.Coverage)
  }));
  const seen = new Set();
  monthly.forEach(r => { const key=JSON.stringify([r.agency,r.month]); if(seen.has(key)) throw new Error('Multiple MONTHLY_TOTALS rows for '+r.agency+' / '+r.month+'. Resolve duplicate or overlapping statements before analytics; the app will not guess which row is authoritative.'); seen.add(key); });
  const sales = raw.map(r => {
    const b=base(r,'SALES_RAW'), rawName=text_(r.Product_Name), candidates=lookup.get(rawName)||[];
    const exact=candidates.filter(c=>c.agency===b.agency), generic=candidates.filter(c=>!c.agency);
    const choices=exact.length?exact:generic.length?generic:candidates;
    const signatures=unique_(choices.map(c=>JSON.stringify([c.productName,c.sku,c.brand,c.status,c.include])));
    const c=signatures.length===1?choices[0]:null;
    const mapped=!!c && !!(c.sku || c.productName);
    const mappingIssue=mapped?'':signatures.length>1?'Conflicting PRODUCT_CONFIG mappings':c?'Missing canonical name and SKU':'No exact PRODUCT_CONFIG mapping';
    const productKey=mapped?(c.sku?'sku:'+c.sku:'name:'+c.productName):'unmapped:'+JSON.stringify([b.agency,rawName]);
    return Object.assign(b, {rawName,packing:text_(r.Packing),productKey,sku:mapped?c.sku:'',productName:mapped?(c.productName||c.sku):'Unmapped · '+rawName,brand:mapped?(c.brand||'Ungrouped'):'Unmapped',status:mapped?c.status:'',include:mapped&&c.include,includeFlag:mapped?c.includeFlag:'',mapped,mappingIssue,
      units:num_(r.Sale,'SALES_RAW!M'+r._row),purchased:num_(r.Purc,'SALES_RAW!K'+r._row),qoh:num_(r.QOH,'SALES_RAW!N'+r._row),value:num_(r.Value,'SALES_RAW!O'+r._row),age:num_(r.Age,'SALES_RAW!P'+r._row),sourceLine:text_(r.Source_Line_No)});
  });
  const months=unique_([...monthly,...sales].map(r=>r.month));
  const agencies=unique_([...monthly,...sales].map(r=>r.agency));
  const missing=sales.filter(r=>[r.units,r.qoh,r.value].some(v=>v==null)).length;
  if(missing) warnings.push(missing+' raw rows have blank metrics. Affected sums are shown as unavailable, not zero.');
  if(monthly.some(r=>[r.primary,r.secondary,r.closing].some(v=>v==null))) warnings.push('Some financial values are blank. Affected totals are unavailable.');
  const fallback=unique_(sales.filter(r=>r.mapped&&!r.sku).map(r=>r.productKey)).length;
  if(fallback) warnings.push(fallback+' canonical products have no SKU; exact canonical name is used as a fallback identity.');
  const skuNames=new Map(); sales.filter(r=>r.sku).forEach(r=>{if(!skuNames.has(r.sku))skuNames.set(r.sku,new Set());skuNames.get(r.sku).add(r.productName+' / '+r.brand);});
  if([...skuNames.values()].some(s=>s.size>1)) warnings.push('Some SKUs have differing names or brand groups in PRODUCT_CONFIG. SKU aggregation uses the first observed display name; brand filters follow each configured alias.');
  return {monthly,sales,config,months,agencies,warnings};
}
function filters_(input,d) {
  input=input||{}; const latest=d.months[d.months.length-1]||'';
  const f={start:text_(input.start)||latest,end:text_(input.end)||latest,agency:text_(input.agency),brand:text_(input.brand),product:text_(input.product),trendProduct:text_(input.trendProduct),includeExcluded:input.includeExcluded===true,maxUnits:input.maxUnits==null?0:Number(input.maxUnits),minAge:input.minAge==null||input.minAge===''?null:Number(input.minAge)};
  if(f.start && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.start)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.end)||f.start>f.end)) throw new Error('Choose a valid start and end month in chronological order.');
  if(f.start)monthList_(f.start,f.end);
  if(f.agency&&!d.agencies.includes(f.agency)) throw new Error('The selected agency is no longer available. Reset the filters.');
  if(!Number.isFinite(f.maxUnits)||f.maxUnits<0 || (f.minAge!=null&&(!Number.isFinite(f.minAge)||f.minAge<0))) throw new Error('Movement and age thresholds must be non-negative numbers.');
  return f;
}
function agencyMatch_(r,f) { return !f.agency||r.agency===f.agency; }
function periodMatch_(r,f) { return r.month>=f.start&&r.month<=f.end; }
function productMatch_(r,f) { return agencyMatch_(r,f)&&(f.includeExcluded||r.include)&&(!f.brand||r.brand===f.brand)&&(!f.product||r.productKey===f.product); }
function options_(d,f) {
  const eligible=d.sales.filter(r=>agencyMatch_(r,f)&&periodMatch_(r,f)&&(f.includeExcluded||r.include));
  const map=new Map();eligible.filter(r=>!f.brand||r.brand===f.brand).forEach(r=>{if(!map.has(r.productKey))map.set(r.productKey,{key:r.productKey,name:r.productName,sku:r.sku,brand:r.brand});});
  return {months:d.months,agencies:d.agencies,brands:unique_(eligible.map(r=>r.brand)),products:[...map.values()].sort((a,b)=>a.name.localeCompare(b.name))};
}
function groupProducts_(rows) {
  const map=new Map();rows.forEach(r=>{
    if(!map.has(r.productKey))map.set(r.productKey,{key:r.productKey,sku:r.sku,name:r.productName,brand:r.brand,mapped:r.mapped,units:0,purchased:0,qoh:0,value:0,agencies:Object.create(null)});
    const p=map.get(r.productKey);['units','purchased','qoh','value'].forEach(k=>p[k]=add_(p[k],r[k]));
    if(!Object.prototype.hasOwnProperty.call(p.agencies,r.agency))p.agencies[r.agency]=0;
    p.agencies[r.agency]=add_(p.agencies[r.agency],r.units);
  });return [...map.values()];
}
function rank_(rows,key) { return rows.slice().sort((a,b)=>(b[key]==null?-Infinity:b[key])-(a[key]==null?-Infinity:a[key])||a.name.localeCompare(b.name)); }
function comparison_(d,f) {
  if(!f.end)return {value:null,reason:'No statement data available.'};
  if(f.start!==f.end)return {value:null,reason:'Month-on-month growth is available for a single selected month.'};
  const prev=shiftMonth_(f.end,-1),current=d.monthly.filter(r=>agencyMatch_(r,f)&&r.month===f.end),previous=d.monthly.filter(r=>agencyMatch_(r,f)&&r.month===prev);
  const expected=f.agency?[f.agency]:d.agencies;
  if(expected.some(a=>!current.some(r=>r.agency===a)||!previous.some(r=>r.agency===a)))return {value:null,reason:'Current or previous month is missing an agency statement.',previousMonth:prev};
  if([...current,...previous].some(r=>!r.full))return {value:null,reason:'Partial or unconfirmed full-month coverage; growth is not comparable.',previousMonth:prev};
  const now=sum_(current,'secondary'),before=sum_(previous,'secondary');
  if(now==null||before==null||before<=0)return {value:null,reason:'Previous secondary sales are zero, negative, or unavailable.',previousMonth:prev};
  return {value:(now-before)/before*100,previous:before,current:now,previousMonth:prev,reason:'Same agencies; full calendar-month statements.'};
}
function trend_(d,f) {
  if(!f.end)return {months:[],financial:[],agency:[],product:[],productKey:''};
  const start=f.start===f.end?shiftMonth_(f.end,-11):f.start;
  const months=monthList_(start,f.end).filter(m=>m>=d.months[0]);
  const selectedAgencies=f.agency?[f.agency]:d.agencies;
  const financial=months.map(month=>{
    const rows=d.monthly.filter(r=>r.month===month&&agencyMatch_(r,f));
    return {month,primary:sum_(rows,'primary'),secondary:sum_(rows,'secondary'),partial:rows.some(r=>!r.full)||selectedAgencies.some(a=>!rows.some(r=>r.agency===a))};
  });
  const agency=selectedAgencies.map(name=>({name,values:months.map(month=>sum_(d.monthly.filter(r=>r.month===month&&r.agency===name),'secondary'))}));
  const key=f.product||f.trendProduct;
  const product=selectedAgencies.map(name=>({name,values:months.map(month=>sum_(d.sales.filter(r=>r.agency===name&&r.month===month&&r.productKey===key&&productMatch_(r,Object.assign({},f,{product:''}))),'units'))}));
  return {months,financial,agency,product,productKey:key,start,end:f.end};
}
function dashboard_(d,input) {
  const f=filters_(input,d);
  let options=options_(d,f);
  if(f.brand&&!options.brands.includes(f.brand)){f.brand='';f.product=''; options=options_(d,f);}
  if(f.product&&!options.products.some(p=>p.key===f.product))f.product='';
  const rows=d.sales.filter(r=>productMatch_(r,f)&&periodMatch_(r,f));
  const endRows=rows.filter(r=>r.month===f.end);
  const products=rank_(groupProducts_(rows),'units');
  const inventory=rank_(groupProducts_(endRows),'value');
  if(!options.products.some(p=>p.key===f.trendProduct))f.trendProduct=products[0]?.key||options.products[0]?.key||'';
  const financial=d.monthly.filter(r=>agencyMatch_(r,f)&&periodMatch_(r,f));
  const closing=financial.filter(r=>r.month===f.end);
  const comparison=comparison_(d,f);
  const candidates=endRows.filter(r=>r.qoh>0&&r.units!=null&&r.units<=f.maxUnits&&(f.minAge==null||(r.age!=null&&r.age>=f.minAge))).sort((a,b)=>(b.value||0)-(a.value||0));
  const kpis={primary:sum_(financial,'primary'),secondary:sum_(financial,'secondary'),closing:sum_(closing,'closing'),comparison,statementCount:financial.length};
  const insights=[];
  if(comparison.value!=null)insights.push('Secondary sales '+(comparison.value>=0?'increased':'decreased')+' '+Math.abs(comparison.value).toFixed(1)+'% versus '+comparison.previousMonth+'.');
  if(kpis.secondary>0) {
    const contributions=d.agencies.map(name=>({name,value:sum_(financial.filter(r=>r.agency===name),'secondary')})).filter(r=>r.value!=null).sort((a,b)=>b.value-a.value);
    if(contributions[0])insights.push(contributions[0].name+' contributed '+(contributions[0].value/kpis.secondary*100).toFixed(1)+'% of selected secondary sales.');
  }
  if(products[0]?.units!=null)insights.push(products[0].name+' led movement with '+products[0].units.toLocaleString('en-IN')+' units in the selected period.');
  if(inventory[0]?.value!=null)insights.push(inventory[0].name+' held the largest closing inventory value: '+money_(inventory[0].value)+'.');
  const zero=unique_(endRows.filter(r=>r.mapped&&r.units===0&&r.qoh>0).map(r=>r.productKey)).length;
  if(endRows.length)insights.push(zero+' mapped products had an agency stock observation with zero sales and positive closing quantity in '+f.end+'.');
  if(kpis.primary!=null&&kpis.secondary!=null)insights.push('Primary was '+money_(Math.abs(kpis.primary-kpis.secondary))+' '+(kpis.primary>=kpis.secondary?'above':'below')+' secondary in the selected period.');
  const scope=d.sales.filter(r=>agencyMatch_(r,f)&&periodMatch_(r,f));
  const unmapped=scope.filter(r=>!r.mapped),unmappedMap=new Map();
  unmapped.forEach(r=>unmappedMap.set(JSON.stringify([r.agency,r.rawName]),{rawName:r.rawName,agency:r.agency,issue:r.mappingIssue}));
  const expected=f.agency?[f.agency]:d.agencies;
  const missingStatements=monthList_(f.start,f.end).flatMap(month=>expected.filter(a=>!financial.some(r=>r.month===month&&r.agency===a)).map(a=>a+' / '+month));
  const warnings=d.warnings.slice();
  if(missingStatements.length)warnings.push('Missing financial statements: '+missingStatements.join(', ')+'. Financial totals include available statements only.');
  if(financial.some(r=>!r.full))warnings.push('Selected financial totals contain partial or unconfirmed full-month statements.');
  if(!endRows.length)warnings.push('No matching product inventory observations for the selected end month.');
  return {filters:f,options,kpis,trend:trend_(d,f),topProducts:products.slice(0,10),inventory:inventory.slice(0,10),candidates:candidates.slice(0,25),candidateCount:candidates.length,insights,warnings,
    diagnostics:{latestMonth:d.months[d.months.length-1]||'',agencies:d.agencies,rawNames:unique_(d.sales.map(r=>r.rawName)).length,skus:unique_(d.sales.filter(r=>r.sku).map(r=>r.sku)).length,unmappedRawCount:unique_(unmapped.map(r=>r.rawName)).length,unmapped:[...unmappedMap.values()],excludedNo:scope.filter(r=>r.includeFlag==='NO').length,excludedOther:scope.filter(r=>!r.include&&r.includeFlag!=='NO').length,rawRows:d.sales.length,scopeRows:scope.length,configRows:d.config.length},loadedAt:new Date().toISOString()};
}

function drilldown_(d,filters,request) {
  const f=filters_(filters,d);request=request||{};
  const offset=Math.max(0,Math.floor(Number(request.offset)||0)),limit=50;
  let rows;
  if(request.kind==='financial') rows=d.monthly.filter(r=>agencyMatch_(r,f)&&(request.month?r.month===request.month:periodMatch_(r,f)));
  else {
    rows=d.sales.filter(r=>productMatch_(r,f)&&(request.month?r.month===request.month:periodMatch_(r,f))&&(!request.productKey||r.productKey===request.productKey));
    if(request.kind==='candidates')rows=rows.filter(r=>r.month===f.end&&r.qoh>0&&r.units!=null&&r.units<=f.maxUnits&&(f.minAge==null||(r.age!=null&&r.age>=f.minAge)));
  }
  rows.sort((a,b)=>b.month.localeCompare(a.month)||a.agency.localeCompare(b.agency)||a.sheetRow-b.sheetRow);
  return {rows:rows.slice(offset,offset+limit),offset,limit,total:rows.length,kind:request.kind||'product'};
}

export { HEADERS, prepare_ as prepareData, dashboard_ as dashboardModel, drilldown_ as drilldownModel };
