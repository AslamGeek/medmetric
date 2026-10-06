// Base input fields required by the app. The serial column is deliberately
// omitted; the remaining calculation fields are read when present.
export const PRICE_HEADERS='Product_SKU,Product_Name,Pack,Last_Updated,MRP,PTS,PTR,Scheme,Paid_Packs,Free_Packs,Net_Price'.split(',');
export const PRICE_OPTIONAL_HEADERS=[
  'Effective cost per pack (Rs, before GST)',
  'Effective cost per unit (before GST)',
  'Purchase value, paid packs (Rs, before GST)',
  'Sale value, full lot (Rs, before GST)',
  'Gross trade profit per lot (Rs, before income tax)',
  'Profit per received pack (Rs)',
  'Margin / Unit',
  'Profit as % of sale value',
  'Margin % of MRP',
  'Return on pre-tax purchase spend (%)',
  'Tax',
  'Notes'
];
const text=value=>String(value??'').trim();
const firstValue=(row,headers)=>headers.map(header=>row[header]).find(value=>value!=null&&text(value)!=='');
const money=value=>{
  if(value==null||text(value)==='')return null;
  const raw=text(value).replace(/[₹,\s]/g,'');
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw))return null;
  const amount=Number(raw);return Number.isFinite(amount)?amount:null;
};
const ratio=value=>{
  const raw=text(value);
  if(!raw)return null;
  const amount=money(raw.replace(/%$/,''));
  return amount==null?null:raw.endsWith('%')?amount/100:amount;
};
const packKey=value=>text(value).toUpperCase().replace(/\s/g,'');
function normalizeUpdateDate(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  if(typeof value==='number'&&Number.isFinite(value)&&value>0){
    const date=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000);
    return Number.isNaN(date.getTime())?'':date.toISOString().slice(0,10);
  }
  const raw=text(value);
  if(/^\d{4}-(0[1-9]|1[0-2])$/.test(raw))return raw+'-01';
  if(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw)){
    const [year,month,day]=raw.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?raw:'';
  }
  const monthDayYear=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(monthDayYear){
    const [,monthText,dayText,yearText]=monthDayYear,year=Number(yearText),month=Number(monthText),day=Number(dayText),date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?`${yearText}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';
  }
  const parsed=Date.parse(raw);
  return Number.isNaN(parsed)?'':new Date(parsed).toISOString().slice(0,10);
}
export function schemeNetPrice(ptr,paidPacks,freePacks){
  const rate=money(ptr),paid=Number(paidPacks),free=Number(freePacks);
  if(rate==null||!/^\d+$/.test(text(paidPacks))||!/^\d+$/.test(text(freePacks))||!Number.isSafeInteger(paid)||paid<=0||!Number.isSafeInteger(free)||free<0||!Number.isSafeInteger(paid+free))return null;
  const value=rate*paid/(paid+free);
  const rounded=Number.isFinite(value)?Math.round((value+Number.EPSILON*Math.max(1,value))*100)/100:null;
  return Number.isFinite(rounded)?rounded:null;
}
export function preparePriceList(records){
  const warnings=[],prices=[];
  for(const row of records){
    const name=text(row.Product_Name),lastUpdated=normalizeUpdateDate(row.Last_Updated);
    if(!name||!lastUpdated){warnings.push('Price list row '+row._row+' needs a product name and valid Last_Updated date.');continue;}
    const issues=[],mrp=money(row.MRP),pts=money(row.PTS),ptr=money(row.PTR);
    if([mrp,pts,ptr].some(v=>v==null))issues.push('Some listed prices are missing or invalid.');
    const scheme=text(row.Scheme),match=scheme.match(/^([1-9]\d*)\s*\+\s*(\d+)$/),paid=money(row.Paid_Packs),free=money(row.Free_Packs);
    const validScheme=match&&Number.isSafeInteger(paid)&&paid>0&&Number.isSafeInteger(free)&&free>=0&&paid===Number(match[1])&&free===Number(match[2]);
    if(!validScheme)issues.push('Scheme and paid/free pack counts are incomplete or disagree.');
    const taxText=text(row.Tax),taxNumber=money(taxText.replace(/%$/,'')),tax=taxNumber==null?null:taxText.endsWith('%')?taxNumber/100:taxNumber;
    const validTax=tax!=null&&tax>=0&&tax<=1;
    if(!validTax)issues.push('Tax is missing or invalid.');
    const listedNet=money(row.Net_Price),expectedNet=validScheme?schemeNetPrice(ptr,paid,free):null;
    const net=listedNet!=null&&expectedNet!=null&&Number.isFinite(expectedNet)&&Math.abs(listedNet-expectedNet)<0.000001?listedNet:null;
    if(net==null)issues.push('Net price is unavailable or differs from PTR after the listed scheme.');
    if(!text(row.Pack))issues.push('Listed pack is missing.');
    const price={
      key:'price:'+row._row,sku:text(row.Product_SKU),name,pack:text(row.Pack),mrp,pts,ptr,
      tax:validTax?tax:null,scheme,paid:validScheme?paid:null,free:validScheme?free:null,net,lastUpdated,
      effectiveCost:money(firstValue(row,['Effective cost per pack (Rs, before GST)','Effective cost per unit (before GST)'])),
      purchaseValue:money(firstValue(row,['Purchase value, paid packs (Rs, before GST)','Purchase value before GST'])),
      saleValue:money(firstValue(row,['Sale value, full lot (Rs, before GST)','Sale value before GST'])),
      profitLot:money(firstValue(row,['Gross trade profit per lot (Rs, before income tax)','Profit before income tax, per lot (Rs)'])),
      profitPerPack:money(firstValue(row,['Profit per received pack (Rs)','Margin / Unit'])),
      profitPct:ratio(firstValue(row,['Profit as % of sale value','Margin % of MRP'])),
      returnOnSpend:ratio(row['Return on pre-tax purchase spend (%)']),
      manufacturer:'',notes:text(row.Notes),source:'',issues
    };
    prices.push(price);
    if(issues.length)warnings.push(name+': '+issues.join(' '));
  }
  // A duplicate SKU/pack/update date is ambiguous; never silently pick a price from it.
  const identities=new Map();
  for(const price of prices){const identity=JSON.stringify([price.sku||price.name,packKey(price.pack),price.lastUpdated]);if(!identities.has(identity))identities.set(identity,[]);identities.get(identity).push(price);}
  for(const duplicates of identities.values())if(duplicates.length>1){for(const price of duplicates){price.mrp=price.pts=price.ptr=price.net=null;price.issues.push('Duplicate price entries for this SKU, pack and Last_Updated date.');}warnings.push('Duplicate prices: '+duplicates[0].name+' · '+duplicates[0].pack+'.');}
  return {prices,priceWarnings:warnings,priceStatus:'loaded'};
}
export function currentPrices(prices=[]){
  const latest=new Map();
  const identity=p=>JSON.stringify([p.sku||p.name,packKey(p.pack)]);
  for(const p of prices){const key=identity(p);latest.set(key,[latest.get(key)||'',p.lastUpdated||''].sort().at(-1));}
  return prices.filter(p=>p.lastUpdated===latest.get(identity(p)));
}
export function pricesForSku(prices,sku){return sku?currentPrices(prices).filter(p=>p.sku===sku):[];}
