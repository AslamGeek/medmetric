import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardSession } from '../lib/dashboard-session.js';
import { prepareData } from '../lib/analytics.js';

const snapshot = () => ({...prepareData(
  [{_row:2,Month:'2026-09',Agency:'MADHU',Is_Full_Month:'YES',Purchase_Value:100,Sale_Value:150,Closing_Value:50}],
  ['ONE','TWO'].map((sku,i)=>({_row:i+2,Month:'2026-09',Agency:'MADHU',Product_Name:sku,Sale:10+i,QOH:2,Value:20})),
  ['ONE','TWO'].map(sku=>({Raw_Product_Name:sku,Your_Product_Name:sku,Your_SKU:sku,Your_Brand_Group:'BRAND',Include_In_Charts:'YES'})),
  'Etc/UTC'),loadedAt:'2026-10-02T00:00:00.000Z'});

test('product changes and drilldowns never reread Sheets after the initial load',async()=>{
  let calls=0;
  const session=createDashboardSession(async()=>{if(++calls>1)throw Error('upstream timeout');return snapshot();});
  await session.load();
  for(const product of ['sku:ONE','sku:TWO','sku:ONE']){
    const model=session.dashboard({product});
    assert.equal(model.filters.product,product);
    assert.equal(model.topProducts.length,1);
    assert.equal(model.kpis.secondary,150);
    assert.equal(session.drilldown(model.filters,{productKey:product}).rows.length,1);
  }
  assert.equal(calls,1);
});

test('concurrent initial loads share one read; failed refresh retains usable data',async()=>{
  let calls=0;
  const session=createDashboardSession(async()=>{if(++calls>1)throw Error('upstream timeout');return snapshot();});
  await Promise.all([session.load(),session.load()]);
  assert.equal(calls,1);
  await assert.rejects(session.load(true),/upstream timeout/);
  assert.equal(session.dashboard({product:'sku:TWO'}).topProducts[0].units,11);
  assert.equal(session.dashboard({}).loadedAt,'2026-10-02T00:00:00.000Z');
});

test('restored snapshot is reused across reloads until an explicit refresh',async()=>{
  let calls=0;
  const session=createDashboardSession(async()=>{calls++;return {...snapshot(),loadedAt:'2026-10-03T00:00:00.000Z'};});
  session.restore(snapshot());
  await session.load();
  assert.equal(calls,0);
  assert.equal(session.dashboard({}).loadedAt,'2026-10-02T00:00:00.000Z');
  await session.load(true);
  assert.equal(calls,1);
  assert.equal(session.dashboard({}).loadedAt,'2026-10-03T00:00:00.000Z');
});
