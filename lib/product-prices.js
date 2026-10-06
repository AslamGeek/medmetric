// Base input fields required by the app. The serial column is deliberately
// omitted; the remaining calculation fields are read when present.
export const PRICE_HEADERS='Product_SKU,Product_Name,Pack,Effective_From,MRP,PTS,PTR,Tax,Scheme,Paid_Packs,Free_Packs,Net_Price'.split(',');
export const PRICE_OPTIONAL_HEADERS=[
  'Effective cost per pack (Rs, before GST)',
  'Purchase value, paid packs (Rs, before GST)',
  'Sale value, full lot (Rs, before GST)',
  'Gross trade profit per lot (Rs, before income tax)',
  'Profit per received pack (Rs)',
  'Profit as % of sale value',
  'Return on pre-tax purchase spend (%)',
  'Notes'
];
const text=value=>String(value??'').trim();
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
    const name=text(row.Product_Name),effectiveFrom=text(row.Effective_From);
    if(!name||!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveFrom)){warnings.push('Price list row '+row._row+' needs a product name and effective month (YYYY-MM).');continue;}
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
      tax:validTax?tax:null,scheme,paid:validScheme?paid:null,free:validScheme?free:null,net,effectiveFrom,
      effectiveCost:money(row['Effective cost per pack (Rs, before GST)']),
      purchaseValue:money(row['Purchase value, paid packs (Rs, before GST)']),
      saleValue:money(row['Sale value, full lot (Rs, before GST)']),
      profitLot:money(row['Gross trade profit per lot (Rs, before income tax)']),
      profitPerPack:money(row['Profit per received pack (Rs)']),
      profitPct:ratio(row['Profit as % of sale value']),
      returnOnSpend:ratio(row['Return on pre-tax purchase spend (%)']),
      manufacturer:'',notes:text(row.Notes),source:'',issues
    };
    prices.push(price);
    if(issues.length)warnings.push(name+': '+issues.join(' '));
  }
  // A duplicate SKU/pack/month is ambiguous; never silently pick a price from it.
  const identities=new Map();
  for(const price of prices){const identity=JSON.stringify([price.sku||price.name,packKey(price.pack),price.effectiveFrom]);if(!identities.has(identity))identities.set(identity,[]);identities.get(identity).push(price);}
  for(const duplicates of identities.values())if(duplicates.length>1){for(const price of duplicates){price.mrp=price.pts=price.ptr=price.net=null;price.issues.push('Duplicate price entries for this SKU, pack and effective month.');}warnings.push('Duplicate prices: '+duplicates[0].name+' · '+duplicates[0].pack+'.');}
  return {prices,priceWarnings:warnings,priceStatus:'loaded'};
}
export function currentPrices(prices=[],asOf=new Date().toISOString().slice(0,7)){
  const eligible=prices.filter(p=>p.effectiveFrom<=asOf),latest=new Map();
  const identity=p=>JSON.stringify([p.sku||p.name,packKey(p.pack)]);
  for(const p of eligible){const key=identity(p);latest.set(key,[latest.get(key)||'',p.effectiveFrom].sort().at(-1));}
  return eligible.filter(p=>p.effectiveFrom===latest.get(identity(p)));
}
export function pricesForSku(prices,sku){return sku?currentPrices(prices).filter(p=>p.sku===sku):[];}
