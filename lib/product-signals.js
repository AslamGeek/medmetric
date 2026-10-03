// Portfolio signals use canonical products, full statements and the saved snapshot.
import {liquidityCategories} from './product-liquidity.js';

export const momentumCategories = [
  {key:'rising',label:'Rising',color:'#239d98',rule:'Daily sales pace increased by more than 10%'},
  {key:'stable',label:'Stable',color:'#3489e0',rule:'Daily sales pace changed by no more than ±10%'},
  {key:'falling',label:'Falling',color:'#c45434',rule:'Daily sales pace decreased by more than 10%'},
  {key:'resumed',label:'Started / resumed',color:'#8b79b9',rule:'Recent sales after zero sales in the previous three months'},
  {key:'stopped',label:'Stopped',color:'#a05380',rule:'No recent sales after positive previous-three-month sales'},
  {key:'noSales',label:'No sales',color:'#727f92',rule:'Confirmed zero sales in both three-month periods'},
  {key:'unknown',label:'Insufficient data',color:'#9aa6b6',rule:'Missing full months, product observations or negative adjustments'}
];
export const actionCategories = [
  {key:'replenish',label:'Replenishment review',color:'#3489e0',rule:'Below 30 days of cover with rising or started/resumed sales'},
  {key:'stockout',label:'Stockout review',color:'#c45434',rule:'Zero closing stock with positive latest-three-month sales'},
  {key:'excess',label:'Excess-stock review',color:'#c28a27',rule:'Above 90 days of cover with falling/stopped sales, or non-moving stock'},
  {key:'demand',label:'Demand review',color:'#a05380',rule:'Falling/stopped sales without the excess-stock condition'},
  {key:'monitor',label:'Monitor',color:'#239d98',rule:'Comparable observations without one of the review conditions'},
  {key:'unknown',label:'Insufficient data',color:'#9aa6b6',rule:'Not enough comparable observations for an action signal'}
];
const sum = (items,key) => {
  if(!items.length || items.some(item=>!Number.isFinite(item[key]) || item[key]<0))return null;
  const total=items.reduce((value,item)=>value+item[key],0);
  return Number.isFinite(total)?total:null;
};
const monthOffset = (month,offset) => {const date=new Date(month+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,7);};
const calendarDays = months => months.reduce((total,month)=>{const [year,m]=month.split('-').map(Number);return total+new Date(Date.UTC(year,m,0)).getUTCDate();},0);
const category = (items,key) => items.find(item=>item.key===key);

function momentum(recent,previous) {
  if(!recent.complete || !previous.complete)return {momentum:'unknown',growth:null,momentumReason:recent.reason || previous.reason};
  if(recent.units===0 && previous.units===0)return {momentum:'noSales',growth:null,momentumReason:'Zero sales in both periods; percentage change has no positive baseline.'};
  if(previous.units===0)return {momentum:'resumed',growth:null,momentumReason:'Positive recent sales after a confirmed zero previous baseline; percentage change is undefined.'};
  const growth=(recent.pace/previous.pace-1)*100;
  if(!Number.isFinite(growth))return {momentum:'unknown',growth:null,momentumReason:'Sales pace change cannot be represented as a finite percentage.'};
  // Floating-point noise at exactly ±10% must not cross the stable boundary.
  return {momentum:recent.units===0?'stopped':growth>10+1e-9?'rising':growth< -10-1e-9?'falling':'stable',growth,momentumReason:''};
}
function reviewAction(cover,recent,signal) {
  if(!cover || cover.category==='unknown' || !recent.complete)return 'unknown';
  if(cover.category==='outOfStock' && recent.units>0)return 'stockout';
  if(cover.category==='nonMoving')return 'excess';
  if(signal.momentum==='unknown')return 'unknown';
  if(cover.daysOfCover!=null && cover.daysOfCover<30 && ['rising','resumed'].includes(signal.momentum))return 'replenish';
  if(['falling','stopped'].includes(signal.momentum))return cover.daysOfCover>90?'excess':'demand';
  return 'monitor';
}

export function productSignals(data,filters,liquidity) {
  if(!filters.end)return {recentMonths:[],previousMonths:[],recentDays:0,previousDays:0,products:[],agencies:[],agencyNames:[],closingComplete:{}};
  const recentMonths=[-2,-1,0].map(n=>monthOffset(filters.end,n)),previousMonths=[-5,-4,-3].map(n=>monthOffset(filters.end,n));
  const recentDays=calendarDays(recentMonths),previousDays=calendarDays(previousMonths);
  const eligible=data.sales.filter(r=>(!filters.agency||r.agency===filters.agency)&&(filters.includeExcluded||r.include)&&(!filters.brand||r.brand===filters.brand)&&(!filters.product||r.productKey===filters.product));
  const fullStatements=new Set(data.monthly.filter(r=>r.full).map(r=>JSON.stringify([r.agency,r.month])));
  const full=(agency,month)=>fullStatements.has(JSON.stringify([agency,month]));
  const covers=new Map((liquidity?.agencies||[]).map(row=>[JSON.stringify([row.productKey,row.agency]),row]));
  const combinedCovers=new Map((liquidity?.products||[]).map(row=>[row.key,row]));
  const histories=new Map();
  for(const row of eligible) {const key=JSON.stringify([row.productKey,row.agency]);if(!histories.has(key))histories.set(key,[]);histories.get(key).push(row);}
  const agencies=[...histories.entries()].map(([key,history])=>{
    const identity=history[0];
    function period(months,days) {
      const rows=history.filter(row=>months.includes(row.month));
      const missing=months.filter(month=>!full(identity.agency,month)||!rows.some(row=>row.month===month));
      const invalid=rows.some(row=>!Number.isFinite(row.units)||row.units<0);
      const units=!missing.length&&!invalid?sum(rows,'units'):null;
      const complete=!missing.length&&!invalid&&units!=null;
      return {units,days,pace:units==null?null:units/days,complete,
        reason:missing.length?'Needs full statements and product observations for '+identity.agency+' in '+missing.join(', '):!complete?'Missing, invalid or negative sale units in '+identity.agency:''};
    }
    const recent=period(recentMonths,recentDays),previous=period(previousMonths,previousDays),signal=momentum(recent,previous);
    const cover=covers.get(key),closing=history.filter(row=>row.month===filters.end);
    const closingValid=full(identity.agency,filters.end)&&closing.length>0&&closing.every(row=>Number.isFinite(row.qoh)&&row.qoh>=0);
    const value=closingValid?sum(closing,'value'):null,action=reviewAction(cover,recent,signal);
    return {productKey:identity.productKey,name:identity.productName,sku:identity.sku,brand:identity.brand,agency:identity.agency,
      recent,previous,...signal,momentumLabel:category(momentumCategories,signal.momentum).label,
      cover:cover||{category:'unknown',label:'Insufficient data',daysOfCover:null},qoh:closingValid?sum(closing,'qoh'):null,
      value,valueComplete:value!=null,action,actionLabel:category(actionCategories,action).label};
  });
  const groups=new Map();
  for(const row of agencies) {if(!groups.has(row.productKey))groups.set(row.productKey,[]);groups.get(row.productKey).push(row);}
  const products=[...groups.entries()].map(([key,items])=>{
    function aggregate(period,days) {
      const units=items.every(row=>row[period].complete)?sum(items.map(row=>row[period]),'units'):null;
      const complete=units!=null;
      return {units,days,pace:units==null?null:units/days,complete,reason:items.find(row=>!row[period].complete)?.[period].reason||(!complete?'Combined sale units are unavailable.':'')};
    }
    const recent=aggregate('recent',recentDays),previous=aggregate('previous',previousDays),signal=momentum(recent,previous),cover=combinedCovers.get(key);
    const action=reviewAction(cover,recent,signal);
    return {key,name:items[0].name,sku:items[0].sku,brand:items[0].brand,recent,previous,...signal,
      momentumLabel:category(momentumCategories,signal.momentum).label,action,actionLabel:category(actionCategories,action).label,
      value:sum(items,'value'),cover:cover||{category:'unknown',label:'Insufficient data',daysOfCover:null},agencies:items};
  });
  const agencyNames=filters.agency?[filters.agency]:data.agencies;
  return {recentMonths,previousMonths,recentDays,previousDays,products,agencies,agencyNames,
    closingComplete:Object.fromEntries(agencyNames.map(agency=>[agency,full(agency,filters.end)]))};
}

export function stockValueByCategory(signals,productKeys) {
  const keys=new Set(productKeys),pairs=signals.agencies.filter(row=>keys.has(row.productKey));
  const completeness=new Map(signals.agencyNames.map(agency=>{
    const agencyPairs=pairs.filter(row=>row.agency===agency),missing=agencyPairs.filter(row=>!row.valueComplete).length;
    return [agency,{complete:signals.closingComplete[agency]&&!missing,missing}];
  }));
  const rows=liquidityCategories.map(item=>{
    const selected=pairs.filter(row=>row.cover.category===item.key);
    const agencyValues=Object.fromEntries(signals.agencyNames.map(agency=>[agency,completeness.get(agency).complete?
      selected.filter(row=>row.agency===agency).reduce((total,row)=>total+row.value,0):null]));
    const values=Object.values(agencyValues);
    return {...item,pairCount:selected.length,agencyValues,total:values.length&&values.every(value=>value!=null)?values.reduce((a,b)=>a+b,0):null};
  });
  return {rows,pairCount:pairs.length,missingPairs:pairs.filter(row=>!row.valueComplete).length,
    incompleteAgencies:signals.agencyNames.filter(agency=>!completeness.get(agency).complete)};
}
