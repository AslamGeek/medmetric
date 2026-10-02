import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareData,dashboardModel,drilldownModel} from '../lib/analytics.js';

function fixture({partial=false,missing=false}={}) {
  const months=['2026-07','2026-08','2026-09'];
  const totals=months.flatMap(Month=>['MADHU','MEDA'].map(Agency=>({Month,Agency,Is_Full_Month:partial&&Month==='2026-09'?'NO':'YES',Purchase_Value:1000,Sale_Value:2000,Closing_Value:5000})));
  const raw=months.flatMap((Month,i)=>['MADHU','MEDA'].map(Agency=>({Month,Agency,Product_Name:'PRODUCT A',Sale:Agency==='MADHU'?10*(i+1):30-10*i,Purc:40,QOH:Agency==='MADHU'?20:80,Value:Agency==='MADHU'?200:800,_row:i+2})));
  if(missing)raw.splice(raw.findIndex(r=>r.Month==='2026-08'&&r.Agency==='MEDA'),1);
  raw.push({Month:'2026-09',Agency:'MADHU',Product_Name:'PRODUCT B',Sale:999,Purc:999,QOH:999,Value:99999,_row:20});
  const config=['A','B'].map(letter=>({Raw_Product_Name:'PRODUCT '+letter,Your_Product_Name:'Product '+letter,Your_SKU:letter,Your_Brand_Group:'BRAND',Include_In_Charts:'YES'}));
  return prepareData(totals,raw,config,'Etc/UTC');
}

test('product metrics and insights use only the chosen product, not agency financial totals',()=>{
  const model=dashboardModel(fixture(),{product:'sku:A'}),p=model.productDetail;
  assert.equal(p.name,'Product A');assert.equal(p.metrics.units,40);assert.equal(p.metrics.purchased,80);assert.equal(p.metrics.qoh,100);assert.equal(p.metrics.value,1000);
  assert.equal(p.agencies[0].units,30);assert.equal(p.agencies[1].units,10);
  assert.ok(p.insights.some(s=>s.includes('75.0%')));
  assert.ok(p.insights.some(s=>s.includes('20 more units')));
  assert.ok(p.insights.some(s=>s.includes('rising sales pattern')));
  assert.ok(p.insights.some(s=>s.includes('declining sales pattern')));
  assert.ok(p.insights.some(s=>s.includes('80.0% of closing stock units')&&s.includes('25.0% of units sold')));
  assert.ok(p.insights.every(s=>!s.includes('Secondary')&&!s.includes('Primary')&&!s.includes('Product B')));
});

test('agency growth uses that agency’s own full-month product observations',()=>{
  const p=dashboardModel(fixture(),{product:'sku:A'}).productDetail;
  assert.equal(p.agencies[0].growth,50);assert.equal(p.agencies[1].growth,-50);
  for(const opts of [{partial:true},{missing:true}]){
    const p=dashboardModel(fixture(opts),{product:'sku:A'}).productDetail;
    assert.equal(p.growth,null);assert.equal(p.agencies[1].growth,null);
    assert.ok(!p.insights.some(s=>s.includes('MEDA shows a declining')));
  }
});

test('changing months keeps the product focused and closing stock uses the end month',()=>{
  const d=fixture();
  const range=dashboardModel(d,{product:'sku:A',start:'2026-07',end:'2026-09'}).productDetail;
  assert.equal(range.metrics.units,120);assert.equal(range.metrics.qoh,100);
  const absent=dashboardModel(d,{product:'sku:B',start:'2026-07',end:'2026-07'});
  assert.equal(absent.filters.product,'sku:B');assert.equal(absent.productDetail.name,'Product B');assert.equal(absent.productDetail.metrics.units,null);
  const agency=dashboardModel(d,{product:'sku:B',agency:'MEDA'});
  assert.equal(agency.filters.product,'sku:B');assert.equal(agency.productDetail.metrics.units,null);
});

test('blank units never become a zero-growth or three-month trend claim',()=>{
  const d=fixture();d.sales.find(r=>r.productKey==='sku:A'&&r.agency==='MADHU'&&r.month==='2026-08').units=null;
  const p=dashboardModel(d,{product:'sku:A'}).productDetail;
  assert.equal(p.agencies[0].growth,null);
  assert.ok(!p.insights.some(s=>s.includes('MADHU shows a rising')));
});

test('monthly charts separate restocked, sold and stock units for each agency',()=>{
  const p=dashboardModel(fixture(),{product:'sku:A'}).productDetail;
  assert.deepEqual(p.monthly.months,['2026-07','2026-08','2026-09']);
  const madhu=p.monthly.agencies.find(a=>a.agency==='MADHU').rows;
  assert.deepEqual(madhu.map(r=>r.units),[10,20,30]);
  assert.deepEqual(madhu.map(r=>r.purchased),[40,40,40]);
  assert.deepEqual(madhu.map(r=>r.qoh),[20,20,20]);
  const range=dashboardModel(fixture(),{product:'sku:A',start:'2026-08',end:'2026-09',agency:'MEDA'}).productDetail.monthly;
  assert.deepEqual(range.months,['2026-08','2026-09']);assert.equal(range.agencies.length,1);
  assert.deepEqual(range.agencies[0].rows.map(r=>r.units),[20,10]);
});

test('monthly chart gaps stay unknown while actual zeros remain zero',()=>{
  const d=fixture({missing:true});
  d.sales.find(r=>r.productKey==='sku:A'&&r.agency==='MEDA'&&r.month==='2026-09').purchased=0;
  const series=dashboardModel(d,{product:'sku:A'}).productDetail.monthly.agencies.find(a=>a.agency==='MEDA');
  assert.equal(series.rows[1].units,null);assert.equal(series.rows[1].purchased,null);assert.equal(series.rows[1].qoh,null);
  assert.equal(series.rows[2].purchased,0);
});

test('an agency monthly chart drills into that agency, product and month only',()=>{
  const result=drilldownModel(fixture(),{product:'sku:A'},{productKey:'sku:A',month:'2026-08',agency:'MEDA'});
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].agency,'MEDA');assert.equal(result.rows[0].month,'2026-08');assert.equal(result.rows[0].units,20);
});
