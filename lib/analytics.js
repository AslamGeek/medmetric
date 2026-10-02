// Pure analytics shared by the dashboard and Next.js route handlers.
import { productAnalysis } from './product-rankings.js';
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
const monthFormatter=new Intl.DateTimeFormat('en-IN',{month:'short',year:'numeric',timeZone:'UTC'});
function displayMonth_(month) {return month?monthFormatter.format(new Date(month+'-01T12:00:00Z')):'—';}
function displayPercentage_(value,signed=false) {
  if(value==null)return '—';
  const magnitude=Math.abs(value),amount=magnitude>0&&magnitude<0.1?'<0.1':magnitude.toFixed(1);
  return (signed&&value!==0?(value>0?'+':'−'):'')+amount+'%';
}

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
  const eligible=d.sales.filter(r=>agencyMatch_(r,f)&&(f.includeExcluded||r.include));
  const map=new Map();eligible.filter(r=>!f.brand||r.brand===f.brand).forEach(r=>{if(!map.has(r.productKey))map.set(r.productKey,{key:r.productKey,name:r.productName,sku:r.sku,brand:r.brand});});
  // Keep the selected product in focus even when an agency has no observations.
  const selected=d.sales.find(r=>r.productKey===f.product&&(f.includeExcluded||r.include)&&(!f.brand||r.brand===f.brand));
  if(selected&&!map.has(selected.productKey))map.set(selected.productKey,{key:selected.productKey,name:selected.productName,sku:selected.sku,brand:selected.brand});
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
    const complete=selectedAgencies.every(a=>rows.some(r=>r.agency===a));
    return {month,primary:complete?sum_(rows,'primary'):null,secondary:complete?sum_(rows,'secondary'):null,partial:!complete||rows.some(r=>!r.full)};
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
  if(comparison.value===0)insights.push('Secondary sales were unchanged from '+displayMonth_(comparison.previousMonth)+'.');
  else if(comparison.value!=null)insights.push('Secondary sales '+(comparison.value>0?'increased':'decreased')+' '+displayPercentage_(comparison.value)+' versus '+displayMonth_(comparison.previousMonth)+'.');
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
  return {filters:f,options,kpis,trend:trend_(d,f),productAnalysis:productAnalysis(d,f,monthList_(f.start,f.end)),productDetail:f.product?productDetail_(d,f):null,topProducts:products.slice(0,10),inventory:inventory.slice(0,10),candidates:candidates.slice(0,25),candidateCount:candidates.length,insights,warnings,
    diagnostics:{latestMonth:d.months[d.months.length-1]||'',agencies:d.agencies,rawNames:unique_(d.sales.map(r=>r.rawName)).length,skus:unique_(d.sales.filter(r=>r.sku).map(r=>r.sku)).length,unmappedRawCount:unique_(unmapped.map(r=>r.rawName)).length,unmapped:[...unmappedMap.values()],excludedNo:scope.filter(r=>r.includeFlag==='NO').length,excludedOther:scope.filter(r=>!r.include&&r.includeFlag!=='NO').length,rawRows:d.sales.length,scopeRows:scope.length,configRows:d.config.length},loadedAt:d.loadedAt || new Date().toISOString()};
}

function productDetail_(d,f) {
  const history=d.sales.filter(r=>productMatch_(r,f));
  const rows=history.filter(r=>periodMatch_(r,f));
  const identity=history[0]||d.sales.find(r=>r.productKey===f.product);
  const expected=f.agency?[f.agency]:d.agencies;
  const periodMonths=monthList_(f.start,f.end);
  const months=monthList_(f.start===f.end?shiftMonth_(f.end,-11):f.start,f.end).filter(month=>month>=d.months[0]);
  const previousMonth=shiftMonth_(f.end,-1);
  const monthlyRows=(agency,month)=>history.filter(r=>r.agency===agency&&r.month===month);
  const fullMonth=(agency,month)=>d.monthly.some(r=>r.agency===agency&&r.month===month&&r.full);
  const label=displayMonth_;
  const unitsText=value=>value==null?'unknown':value.toLocaleString('en-IN');
  function monthUnits(agency,month) {return fullMonth(agency,month)?sum_(monthlyRows(agency,month),'units'):null;}
  function periodSum(agency,key) {
    return periodMonths.every(month=>sum_(monthlyRows(agency,month),key)!=null)?sum_(rows.filter(r=>r.agency===agency),key):null;
  }
  const agencies=expected.map(agency=>{
    const period=rows.filter(r=>r.agency===agency),stock=monthlyRows(agency,f.end);
    const currentUnits=monthUnits(agency,f.end),previousUnits=monthUnits(agency,previousMonth);
    const growth=currentUnits!=null&&previousUnits>0?(currentUnits-previousUnits)/previousUnits*100:null;
    return {agency,units:periodSum(agency,'units'),purchased:periodSum(agency,'purchased'),qoh:sum_(stock,'qoh'),value:sum_(stock,'value'),observations:period.length,currentUnits,previousUnits,growth};
  });
  const metrics={units:sum_(agencies,'units'),purchased:sum_(agencies,'purchased'),qoh:sum_(agencies,'qoh'),value:sum_(agencies,'value')};
  const comparable=f.start===f.end&&expected.every(agency=>[f.end,previousMonth].every(month=>monthUnits(agency,month)!=null));
  const previous=comparable?sum_(history.filter(r=>r.month===previousMonth),'units'):null;
  const growth=previous>0&&metrics.units!=null?(metrics.units-previous)/previous*100:null;
  const comparableAgencies=agencies.length>1&&agencies.every(a=>a.units!=null&&periodMonths.every(month=>fullMonth(a.agency,month)));
  const validShares=comparableAgencies&&metrics.units>0&&agencies.every(a=>a.units>=0);
  function stockCoverage(qoh,units,full) {
    if(!full)return {value:null,reason:'Needs full-month sales'};
    if(qoh==null||units==null)return {value:null,reason:'Missing data'};
    if(qoh<0||units<0)return {value:null,reason:'Negative stock or sales'};
    if(units===0)return {value:null,reason:qoh>0?'Stock, no sales':'No sales baseline'};
    return {value:qoh/units,reason:''};
  }
  const currentUnits=sum_(agencies,'currentUnits'),previousUnits=sum_(agencies,'previousUnits');
  const latestGrowth=currentUnits!=null&&previousUnits>0?(currentUnits-previousUnits)/previousUnits*100:null;
  const latestGrowthReason=currentUnits==null||previousUnits==null?'Needs complete full-month data':previousUnits===0?'No prior sales baseline':previousUnits<0?'Negative prior sales':'';
  const latestFull=expected.every(agency=>fullMonth(agency,f.end));
  metrics.stockCoverage=stockCoverage(metrics.qoh,currentUnits,latestFull);
  metrics.restockingGap=metrics.purchased!=null&&metrics.units!=null?metrics.purchased-metrics.units:null;
  agencies.forEach(a=>{
    a.restockingGap=a.purchased!=null&&a.units!=null?a.purchased-a.units:null;
    a.stockCoverage=stockCoverage(a.qoh,a.currentUnits,fullMonth(a.agency,f.end));
    a.growthReason=a.currentUnits==null||a.previousUnits==null?'Incomplete month data':a.previousUnits===0?'No prior sales':a.previousUnits<0?'Negative prior sales':'';
    a.shares={};
    for(const key of ['units','purchased','qoh','value']){
      const full=key==='units'||key==='purchased'?expected.every(agency=>periodMonths.every(month=>fullMonth(agency,month))):latestFull;
      a.shares[key]=agencies.length>1&&full&&metrics[key]>0&&agencies.every(row=>row[key]!=null&&row[key]>=0)?a[key]/metrics[key]*100:null;
    }
  });
  const insights=[];
  if(growth===0)insights.push('Total units sold were unchanged from '+label(previousMonth)+'.');
  else if(growth!=null)insights.push('Total units sold '+(growth>0?'increased':'decreased')+' '+displayPercentage_(growth)+' compared with '+label(previousMonth)+'.');
  const ranked=agencies.filter(a=>a.units!=null).sort((a,b)=>b.units-a.units);
  if(validShares)insights.push(ranked[0].agency+' accounted for '+(ranked[0].units/metrics.units*100).toFixed(1)+'% of this product’s units sold in the selected period.');
  if(comparableAgencies&&ranked[0].units>ranked[1].units)insights.push(ranked[0].agency+' sold '+unitsText(ranked[0].units-ranked[1].units)+' more units than '+ranked[1].agency+' during the selected period ('+unitsText(ranked[0].units)+' vs '+unitsText(ranked[1].units)+').');
  agencies.forEach(a=>{
    if(a.growth===0)insights.push(a.agency+' sales were unchanged at '+unitsText(a.currentUnits)+' units in '+label(f.end)+' versus '+label(previousMonth)+'.');
    else if(a.growth!=null)insights.push(a.agency+' sold '+unitsText(a.currentUnits)+' units in '+label(f.end)+', '+(a.growth>0?'up':'down')+' '+displayPercentage_(a.growth)+' from '+unitsText(a.previousUnits)+' in '+label(previousMonth)+'.');
    else if(a.previousUnits===0&&a.currentUnits>0)insights.push(a.agency+' recorded '+unitsText(a.currentUnits)+' units sold in '+label(f.end)+' after zero in '+label(previousMonth)+'.');
    const patternMonths=[shiftMonth_(f.end,-2),previousMonth,f.end],values=patternMonths.map(month=>monthUnits(a.agency,month));
    if(patternMonths.every(month=>months.includes(month))&&values.every(v=>v!=null)){
      const rising=values[0]<values[1]&&values[1]<values[2],falling=values[0]>values[1]&&values[1]>values[2];
      if(rising||falling)insights.push(a.agency+' shows a '+(rising?'rising':'declining')+' sales pattern over three months: '+values.map(unitsText).join(' → ')+' units ('+label(patternMonths[0])+' to '+label(f.end)+').');
    }
    if(validShares&&metrics.qoh>0&&agencies.every(r=>r.qoh!=null&&r.qoh>=0&&fullMonth(r.agency,f.end))){
      const stockShare=a.qoh/metrics.qoh*100,salesShare=a.units/metrics.units*100;
      if(stockShare-salesShare>=25)insights.push(a.agency+' holds '+stockShare.toFixed(1)+'% of closing stock units but contributed '+salesShare.toFixed(1)+'% of units sold in the selected period. Review stock allocation.');
    }
  });
  if(agencies.length>1&&agencies.every(a=>a.value!=null&&fullMonth(a.agency,f.end))){
    const stockRank=agencies.slice().sort((a,b)=>b.value-a.value);
    if(stockRank[0].value>stockRank[1].value)insights.push(stockRank[0].agency+' held the most closing stock value: '+money_(stockRank[0].value)+'.');
  }
  const idle=agencies.filter(a=>sum_(monthlyRows(a.agency,f.end),'units')===0&&a.qoh>0);
  if(idle.length)insights.push(idle.map(a=>a.agency).join(', ')+' had stock remaining with no units sold in the '+label(f.end)+' statement.');
  if(metrics.units!=null&&metrics.purchased!=null)insights.push(unitsText(metrics.units)+' units sold and '+unitsText(metrics.purchased)+' units restocked during the selected period.');
  if(!rows.length)insights.push('No observations for this product in the selected period. Choose another period to explore its history.');
  const missing=expected.flatMap(agency=>periodMonths.filter(month=>!monthlyRows(agency,month).length).map(month=>agency+' / '+label(month)));
  const warnings=[];
  if(missing.length)warnings.push('Missing product observations: '+missing.join(', ')+'. Incomplete combined totals are unavailable; missing data is not zero.');
  if(rows.some(r=>r.units==null||r.purchased==null||r.qoh==null||r.value==null))warnings.push('Some product observations have blank metrics. Affected sums are unavailable.');
  if(!expected.every(agency=>periodMonths.every(month=>fullMonth(agency,month))))warnings.push('Some selected agency statements are partial or unconfirmed. Agency-share comparisons require matching full-month coverage.');
  const monthly={months,agencies:expected.map(agency=>({agency,rows:months.map(month=>{
    const observations=monthlyRows(agency,month);
    const coverage=!observations.length?'Missing observation':fullMonth(agency,month)?'Full month':'Partial / unconfirmed';
    return {month,units:sum_(observations,'units'),purchased:sum_(observations,'purchased'),qoh:sum_(observations,'qoh'),value:sum_(observations,'value'),observations:observations.length,coverage};
  })}))};
  monthly.agencies.forEach(series=>{
    const latest=series.rows.at(-1);let takeaway;
    if(!latest?.observations)takeaway=label(f.end)+': no product observation for '+series.agency+'.';
    else {
      takeaway=label(f.end)+': restocked '+unitsText(latest.purchased)+' units; sold '+unitsText(latest.units)+' units.';
      if(latest.units!=null&&latest.purchased!=null){
        const difference=latest.units-latest.purchased;
        takeaway+=' '+(difference>0?'Sales exceeded restocking by '+unitsText(difference)+' units.':difference<0?'Restocking exceeded sales by '+unitsText(-difference)+' units.':'Restocking matched sales.');
      }
      if(latest.coverage!=='Full month')takeaway+=' Statement coverage is partial or unconfirmed.';
    }
    series.takeaway=takeaway;
  });
  monthly.stockTakeaways=monthly.agencies.map(series=>{
    const latest=series.rows.at(-1),prior=series.rows.at(-2);
    if(latest?.qoh==null)return series.agency+': closing stock is unknown for '+label(f.end)+'.';
    if(prior?.qoh==null)return series.agency+': '+unitsText(latest.qoh)+' closing stock units in '+label(f.end)+'. Previous stock is unavailable.';
    const difference=latest.qoh-prior.qoh;
    return series.agency+': closing stock '+(difference===0?'stayed at '+unitsText(latest.qoh):difference>0?'rose from '+unitsText(prior.qoh)+' to '+unitsText(latest.qoh):'fell from '+unitsText(prior.qoh)+' to '+unitsText(latest.qoh))+' units ('+label(prior.month)+' → '+label(latest.month)+').';
  });
  return {key:f.product,name:identity?.productName||f.product,sku:identity?.sku||'',brand:identity?.brand||'',statuses:unique_(history.map(r=>r.status).filter(Boolean)),metrics,agencies,monthly,insights,warnings,growth,latestGrowth,latestGrowthReason,previousMonth,observations:rows.length};
}

function drilldown_(d,filters,request) {
  request=request||{};
  const f=filters_(request.agency?{...filters,agency:request.agency}:filters,d);
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

export { HEADERS, prepare_ as prepareData, dashboard_ as dashboardModel, drilldown_ as drilldownModel, displayMonth_ as displayMonth, displayPercentage_ as displayPercentage };
