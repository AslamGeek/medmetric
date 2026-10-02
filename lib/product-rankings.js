// Product rankings use the saved snapshot. Closing stock value is never revenue.
const sum = (rows,key) => !rows.length || rows.some(r=>r[key]==null) ? null : rows.reduce((total,r)=>total+r[key],0);
const total = (rows,key) => sum(rows,key);

export function productAnalysis(data,filters,months) {
  const eligible=data.sales.filter(r=>(!filters.agency||r.agency===filters.agency)&&(filters.includeExcluded||r.include)&&(!filters.brand||r.brand===filters.brand)&&(!filters.product||r.productKey===filters.product));
  const groups=new Map();
  for(const row of eligible) {
    const key=JSON.stringify([row.productKey,row.agency]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const agencies=[];
  for(const history of groups.values()) {
    const first=history[0],rows=history.filter(r=>months.includes(r.month)),closing=rows.filter(r=>r.month===filters.end);
    if(!rows.length)continue;
    const complete=months.every(month=>rows.some(r=>r.month===month)&&data.monthly.some(r=>r.agency===first.agency&&r.month===month&&r.full));
    const units=complete?sum(rows,'units'):null;
    const negativeSales=rows.some(r=>r.units!=null&&r.units<0);
    // Estimate each observed row separately; do not borrow another agency's rate.
    const estimates=rows.map(r=>({estimate:r.units===0?0:r.units>0&&r.qoh>0&&r.value!=null&&r.value>=0?r.units*r.value/r.qoh:null}));
    agencies.push({key:JSON.stringify([first.productKey,first.agency]),productKey:first.productKey,name:first.productName,sku:first.sku,brand:first.brand,agency:first.agency,units,
      estimatedValue:complete&&!negativeSales?sum(estimates,'estimate'):null,qoh:sum(closing,'qoh'),value:sum(closing,'value'),
      age:closing.length&&closing.every(r=>r.age!=null)?Math.min(...closing.map(r=>r.age)):null,
      complete,negativeSales,zeroSales:complete&&rows.every(r=>r.units===0),observedMonths:new Set(rows.map(r=>r.month)).size});
  }
  const products=new Map();
  for(const row of agencies) {
    if(!products.has(row.productKey))products.set(row.productKey,[]);
    products.get(row.productKey).push(row);
  }
  return {agencies,products:[...products.entries()].map(([key,rows])=>{
    const first=rows[0];
    // An agency tracked historically but absent from this range remains unknown.
    const tracked=new Set(eligible.filter(r=>r.productKey===key).map(r=>r.agency));
    const complete=rows.length===tracked.size&&rows.every(r=>r.complete);
    return {key,productKey:key,name:first.name,sku:first.sku,brand:first.brand,agency:rows.map(r=>r.agency).join(', '),
      units:complete?total(rows,'units'):null,estimatedValue:complete?total(rows,'estimatedValue'):null,
      qoh:rows.length===tracked.size?total(rows,'qoh'):null,value:rows.length===tracked.size?total(rows,'value'):null,
      age:rows.every(r=>r.age!=null)?Math.min(...rows.map(r=>r.age)):null,
      complete,negativeSales:rows.some(r=>r.negativeSales),zeroSales:complete&&rows.every(r=>r.zeroSales)};
  })};
}

export function selectProductRankings(analysis,{search='',limit=10,salesMetric='estimatedValue',movementScope='agency',movementMode='zero',maxUnits=5,minStock=1,minAge=null,stockMetric='value'}={}) {
  const matches=row=>[row.name,row.sku,row.brand,row.agency].some(value=>String(value||'').toLowerCase().includes(search.trim().toLowerCase()));
  const products=analysis.products.filter(matches),movementRows=(movementScope==='product'?analysis.products:analysis.agencies).filter(matches);
  const compare=metric=>(a,b)=>b[metric]-a[metric]||a.name.localeCompare(b.name)||a.agency.localeCompare(b.agency);
  const sold=products.filter(r=>r.units>0&&!r.negativeSales);
  const ranked=sold.filter(r=>r[salesMetric]!=null&&r[salesMetric]>0).sort(compare(salesMetric));
  const stagnant=movementRows.filter(r=>r.complete&&r.units!=null&&!r.negativeSales&&r.qoh>0&&r.qoh>=minStock&&(minAge==null||(r.age!=null&&r.age>=minAge))&&(movementMode==='zero'?r.zeroSales:r.units<=maxUnits));
  const movingRank=stagnant.filter(r=>r[stockMetric]!=null&&r[stockMetric]>=0).sort(compare(stockMetric));
  return {top:ranked.slice(0,limit),topCount:ranked.length,salesTotal:ranked.length?total(ranked,salesMetric):null,
    unavailableValue:sold.filter(r=>r.estimatedValue==null).length,incompleteProducts:products.filter(r=>!r.complete||r.units==null).length,
    nonMoving:movingRank.slice(0,limit),nonMovingCount:stagnant.length,unplottedMovement:stagnant.length-movingRank.length,
    stockTotal:stagnant.length?total(stagnant,'value'):null,stockUnits:stagnant.length?total(stagnant,'qoh'):null,
    unknownMovement:movementRows.filter(r=>!r.complete||r.units==null).length};
}
