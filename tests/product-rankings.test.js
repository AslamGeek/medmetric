import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareData,dashboardModel} from '../lib/analytics.js';
import {selectProductRankings} from '../lib/product-rankings.js';

function fixture() {
  const totals=['2026-08','2026-09'].flatMap(Month=>['A','B'].map(Agency=>({Month,Agency,Is_Full_Month:'YES',Purchase_Value:100,Sale_Value:900,Closing_Value:200})));
  const raw=[];
  for(const Month of ['2026-08','2026-09']) {
    raw.push({Month,Agency:'A',Product_Name:'Leader',Sale:20,QOH:10,Value:100,Age:30});
    raw.push({Month,Agency:'B',Product_Name:'Leader',Sale:5,QOH:5,Value:100,Age:20});
    raw.push({Month,Agency:'A',Product_Name:'Idle',Sale:0,QOH:40,Value:800,Age:50});
    raw.push({Month,Agency:'B',Product_Name:'Idle',Sale:4,QOH:10,Value:200,Age:15});
    raw.push({Month,Agency:'A',Product_Name:'Sold out',Sale:30,QOH:0,Value:0,Age:0});
  }
  const config=['Leader','Idle','Sold out'].map(name=>({Raw_Product_Name:name,Your_Product_Name:name,Your_SKU:name,Your_Brand_Group:name==='Idle'?'Other':'Main',Include_In_Charts:'YES'}));
  return prepareData(totals,raw,config,'UTC');
}
const model=(data,filters={})=>dashboardModel(data,{start:'2026-08',end:'2026-09',...filters}).productAnalysis;

test('estimated rankings use each agency/month stock unit valuation; closing balances are not revenue',()=>{
  const analysis=model(fixture()),leader=analysis.products.find(r=>r.name==='Leader');
  assert.equal(leader.units,50);assert.equal(leader.estimatedValue,600);assert.equal(leader.value,200);assert.equal(leader.qoh,15);
  const ranked=selectProductRankings(analysis);
  assert.equal(ranked.top[0].name,'Leader');assert.equal(ranked.salesTotal,760);assert.equal(ranked.unavailableValue,1);
  assert.equal(selectProductRankings(analysis,{salesMetric:'units'}).top[0].name,'Sold out');
});

test('zero sales cover the entire period, separating agency from combined product stock',()=>{
  const analysis=model(fixture()),agency=selectProductRankings(analysis),combined=selectProductRankings(analysis,{movementScope:'product'});
  assert.equal(agency.nonMovingCount,1);assert.equal(agency.nonMoving[0].agency,'A');assert.equal(agency.nonMoving[0].qoh,40);assert.equal(agency.stockTotal,800);
  assert.equal(combined.nonMovingCount,0);
  const data=fixture();data.sales.find(r=>r.rawName==='Idle'&&r.agency==='A'&&r.month==='2026-08').units=2;
  assert.equal(selectProductRankings(model(data)).nonMovingCount,0);
  assert.equal(selectProductRankings(model(data,{start:'2026-09'})).nonMovingCount,1);
});

test('missing rows, blanks and partial statements never become zero sales or complete estimates',()=>{
  for(const mutation of [
    data=>{data.sales=data.sales.filter(r=>!(r.rawName==='Idle'&&r.agency==='A'&&r.month==='2026-08'));},
    data=>{data.sales.find(r=>r.rawName==='Idle'&&r.agency==='A'&&r.month==='2026-08').units=null;},
    data=>{data.monthly.find(r=>r.agency==='A'&&r.month==='2026-08').full=false;}
  ]) {
    const data=fixture();mutation(data);const ranking=selectProductRankings(model(data));
    assert.equal(ranking.nonMovingCount,0);assert.ok(ranking.unknownMovement>0);
    assert.equal(model(data).products.find(r=>r.name==='Idle').estimatedValue,null);
  }
});

test('returns and offsetting aliases cannot classify a product as zero-sale',()=>{
  const data=fixture();data.sales.push({...data.sales.find(r=>r.rawName==='Idle'&&r.agency==='A'&&r.month==='2026-09'),units:5});
  data.sales.push({...data.sales.at(-1),units:-5});
  assert.equal(selectProductRankings(model(data)).nonMovingCount,0);
  assert.equal(selectProductRankings(model(data),{movementMode:'slow',maxUnits:100}).nonMoving.some(r=>r.name==='Idle'&&r.agency==='A'),false);
});

test('aliases aggregate before sales thresholds, closing quantities and age checks',()=>{
  const data=fixture(),source=data.sales.find(r=>r.rawName==='Idle'&&r.agency==='A'&&r.month==='2026-09');
  data.sales.push({...source,rawName:'Alias',units:4,qoh:5,value:50,age:5});
  let ranked=selectProductRankings(model(data),{movementMode:'slow',maxUnits:3});
  assert.equal(ranked.nonMoving.some(r=>r.agency==='A'),false);
  ranked=selectProductRankings(model(data),{movementMode:'slow',maxUnits:4,minStock:45});
  assert.equal(ranked.nonMoving[0].qoh,45);assert.equal(ranked.nonMoving[0].value,850);
  assert.equal(selectProductRankings(model(data),{movementMode:'slow',maxUnits:4,minAge:10}).nonMovingCount,0);
});

test('global filters and local search/limits affect rankings without sheet requests',()=>{
  const data=fixture();
  assert.equal(model(data,{agency:'B'}).products.find(r=>r.name==='Leader').estimatedValue,200);
  assert.equal(model(data,{start:'2026-09'}).products.find(r=>r.name==='Leader').estimatedValue,300);
  assert.equal(model(data,{brand:'Other'}).products.length,1);
  assert.equal(selectProductRankings(model(data),{search:'leader',limit:1}).top.length,1);
  assert.equal(selectProductRankings(model(data),{search:'B'}).nonMovingCount,0);
  data.sales.filter(r=>r.rawName==='Idle').forEach(r=>r.include=false);
  assert.equal(model(data).products.some(r=>r.name==='Idle'),false);
  assert.equal(model(data,{includeExcluded:true}).products.some(r=>r.name==='Idle'),true);
});

test('unknown closing value can be ranked by stock units and never becomes zero value',()=>{
  const data=fixture();data.sales.find(r=>r.rawName==='Idle'&&r.agency==='A'&&r.month==='2026-09').value=null;
  const ranked=selectProductRankings(model(data));assert.equal(ranked.nonMovingCount,1);assert.equal(ranked.unplottedMovement,1);assert.equal(ranked.stockTotal,null);
  assert.equal(selectProductRankings(model(data),{stockMetric:'qoh'}).nonMoving[0].qoh,40);
});

test('an agency tracked outside this period remains unknown in combined rankings',()=>{
  const data=fixture();data.sales=data.sales.filter(r=>!(r.rawName==='Leader'&&r.agency==='B'&&r.month==='2026-09'));
  const leader=model(data,{start:'2026-09'}).products.find(r=>r.name==='Leader');
  assert.equal(leader.units,null);assert.equal(leader.estimatedValue,null);assert.equal(leader.complete,false);
});
