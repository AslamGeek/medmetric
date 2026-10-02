export const liquidityCategories=[
  {key:'fast',label:'Fast',range:'Below 30 days',color:'#239d98'},
  {key:'medium',label:'Medium',range:'30–90 days',color:'#3489e0'},
  {key:'slow',label:'Slow',range:'Above 90–180 days',color:'#c28a27'},
  {key:'verySlow',label:'Very slow',range:'Above 180 days',color:'#c45434'},
  {key:'nonMoving',label:'Non-moving',range:'Stock held, no sales',color:'#a05380'},
  {key:'outOfStock',label:'Out of stock',range:'Zero closing units',color:'#727f92'},
  {key:'unknown',label:'Insufficient data',range:'Incomplete / adjustments',color:'#9aa6b6'}
];

export function formatCoverDays(value) {
  if(value==null)return '—';
  if(value>0&&value<0.1)return '<0.1 days';
  const rounded=Math.round(value*10)/10;
  if(value<30&&rounded>=30)return '<30 days';
  if(value>90&&rounded<=90)return '>90 days';
  if(value>180&&rounded<=180)return '>180 days';
  return value.toLocaleString('en-IN',{maximumFractionDigits:1})+' days';
}

export function classifyLiquidity({qoh,units,days,complete,negative=false,reason=''}) {
  const result=(category,daysOfCover=null,note='')=>({category,label:liquidityCategories.find(c=>c.key===category).label,daysOfCover,reason:note});
  if(qoh==null||qoh<0||negative)return result('unknown',null,reason||'Missing or negative stock/sales observations');
  if(qoh===0)return result('outOfStock',0);
  if(!complete||units==null||units<0||!Number.isFinite(days)||days<=0)return result('unknown',null,reason||'Needs three complete calendar months of product sales');
  if(units===0)return result('nonMoving',null,'No sales during the three-month baseline');
  const cover=qoh*days/units;
  if(!Number.isFinite(cover))return result('unknown',null,'Stock cover cannot be calculated');
  return result(cover<30?'fast':cover<=90?'medium':cover<=180?'slow':'verySlow',cover);
}

export function productLiquidity(data,filters) {
  if(!filters.end)return {months:[],days:0,products:[],agencies:[]};
  const shift=n=>{const date=new Date(filters.end+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+n);return date.toISOString().slice(0,7);};
  const months=[shift(-2),shift(-1),filters.end];
  const days=months.reduce((sum,month)=>{const [year,m]=month.split('-').map(Number);return sum+new Date(Date.UTC(year,m,0)).getUTCDate();},0);
  const rows=data.sales.filter(r=>(!filters.agency||r.agency===filters.agency)&&(filters.includeExcluded||r.include)&&(!filters.brand||r.brand===filters.brand)&&(!filters.product||r.productKey===filters.product));
  const groups=new Map();
  for(const row of rows){const key=JSON.stringify([row.productKey,row.agency]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const sum=(items,key)=>!items.length||items.some(r=>r[key]==null)?null:items.reduce((total,r)=>total+r[key],0);
  const agencies=[...groups.values()].map(history=>{
    const first=history[0],baseline=history.filter(r=>months.includes(r.month)),closing=history.filter(r=>r.month===filters.end);
    const full=month=>data.monthly.some(r=>r.agency===first.agency&&r.month===month&&r.full);
    const complete=months.every(month=>full(month)&&baseline.some(r=>r.month===month))&&baseline.every(r=>r.units!=null);
    const negative=baseline.some(r=>r.units!=null&&r.units<0)||closing.some(r=>r.qoh!=null&&r.qoh<0);
    const qoh=full(filters.end)?sum(closing,'qoh'):null,units=complete?sum(baseline,'units'):null;
    return {productKey:first.productKey,agency:first.agency,name:first.productName,units,qoh,complete,negative,...classifyLiquidity({qoh,units,days,complete,negative})};
  });
  const productGroups=new Map();
  for(const row of agencies){if(!productGroups.has(row.productKey))productGroups.set(row.productKey,[]);productGroups.get(row.productKey).push(row);}
  const products=[...productGroups.entries()].map(([key,items])=>{
    const complete=items.every(r=>r.complete),negative=items.some(r=>r.negative),qoh=sum(items,'qoh'),units=complete?sum(items,'units'):null;
    return {key,name:items[0].name,qoh,units,complete,agencies:items,...classifyLiquidity({qoh,units,days,complete,negative})};
  });
  return {months,days,products,agencies};
}
