import {liquidityCategories} from './product-liquidity.js';
export const productStatuses=[
  {key:'selling',label:'Selling with stock'},
  {key:'idle',label:'Zero sales, stock held'},
  {key:'empty',label:'No closing stock'},
  {key:'unknown',label:'Incomplete / adjustments'}
];

export function productExplorerModel(analysis,catalog,{search='',status='all',agencies=[],liquidity,liquidityCategory='all'}={}) {
  const byKey=new Map(analysis.products.map(p=>[p.key,p]));
  const liquidityByKey=new Map((liquidity?.products||[]).map(p=>[p.key,p]));
  const query=search.trim().toLowerCase();
  const products=catalog.filter(p=>[p.name,p.sku,p.brand].some(value=>String(value||'').toLowerCase().includes(query))).map(identity=>{
    const row=byKey.get(identity.key);
    let movement='unknown';
    if(row?.complete&&row.units!=null&&!row.negativeSales&&row.qoh!=null&&row.qoh>=0) {
      if(row.qoh===0)movement='empty';
      else if(row.zeroSales)movement='idle';
      else if(row.units>0)movement='selling';
    }
    return {...identity,units:row?.units??null,qoh:row?.qoh??null,value:row?.value??null,movement,liquidity:liquidityByKey.get(identity.key)||{category:'unknown',label:'Insufficient data',daysOfCover:null,agencies:[]}};
  });
  const categories=productStatuses.map(item=>({...item,count:products.filter(p=>p.movement===item.key).length}));
  const matching=products.filter(p=>status==='all'||p.movement===status);
  const matchesCover=p=>liquidityCategory==='all'||p.liquidity.category===liquidityCategory;
  const liquidityMix=liquidityCategories.map(category=>({...category,count:matching.filter(p=>p.liquidity.category===category.key).length}));
  const visible=matching.filter(matchesCover);
  const keys=new Set(visible.map(p=>p.key));
  const completeKeys=new Set(visible.filter(p=>p.movement!=='unknown').map(p=>p.key));
  const sum=(rows,key)=>!rows.length||rows.some(r=>r[key]==null)?null:rows.reduce((total,r)=>total+r[key],0);
  const balance=agencies.map(agency=>{
    const rows=analysis.agencies.filter(r=>r.agency===agency&&keys.has(r.productKey));
    const comparable=rows.filter(r=>completeKeys.has(r.productKey)&&r.complete&&r.units!=null&&r.units>=0&&r.qoh!=null&&r.qoh>=0);
    return {agency,units:sum(comparable,'units'),qoh:sum(comparable,'qoh'),included:comparable.length,excluded:rows.length-comparable.length};
  });
  return {products,visible,categories,liquidityMix,balance,unknown:categories.find(c=>c.key==='unknown').count};
}
