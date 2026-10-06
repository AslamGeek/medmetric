import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetPricing} from '../lib/sheets.js';
import {currentPrices} from '../lib/product-prices.js';

const headers=[
  'Product_SKU','Product_Name','Pack','Effective_From','MRP','PTS','PTR','Scheme','Paid_Packs','Free_Packs','Net_Price',
  'Effective cost per pack (Rs, before GST)','Purchase value, paid packs (Rs, before GST)','Sale value, full lot (Rs, before GST)',
  'Gross trade profit per lot (Rs, before income tax)','Profit per received pack (Rs)','Profit as % of sale value',
  'Return on pre-tax purchase spend (%)','Tax','Notes'
];
const row=(sku,pack,month,scheme,paid,free)=>[
  sku,'APITOP DROPS',pack,month,58,39.77,44.19,scheme,paid,free,33.99,32.37,420.86,718.10,297.24,22.86,0.4139,0.7063,0.05,'' 
];

test('price feed maps useful calculated columns without requiring Sl_No',()=>{
  const result=sheetPricing({values:[headers,row('APITOPDROPS','30ml','2026-10','10+3',10,3)]});
  assert.equal(result.priceStatus,'loaded');
  assert.equal(result.prices.length,1);
  assert.equal(result.prices[0].serial,undefined);
  assert.equal(result.prices[0].effectiveCost,32.37);
  assert.equal(result.prices[0].purchaseValue,420.86);
  assert.equal(result.prices[0].saleValue,718.1);
  assert.equal(result.prices[0].profitLot,297.24);
  assert.equal(result.prices[0].profitPerPack,22.86);
  assert.equal(result.prices[0].profitPct,0.4139);
  assert.equal(result.prices[0].returnOnSpend,0.7063);
});

test('latest price is chosen independently for each SKU and pack',()=>{
  const records=[
    {sku:'DIKLINIMENT',name:'DIK LINIMENT',pack:'30ML',effectiveFrom:'2026-04'},
    {sku:'DIKLINIMENT',name:'DIK LINIMENT',pack:'30ML',effectiveFrom:'2026-10'},
    {sku:'DIKLINIMENT',name:'DIK LINIMENT',pack:'50gm',effectiveFrom:'2026-04'},
    {sku:'DIKLINIMENT',name:'DIK LINIMENT',pack:'future',effectiveFrom:'2026-11'}
  ];
  assert.deepEqual(currentPrices(records,'2026-10').map(p=>p.pack),['30ML','50gm']);
  assert.deepEqual(currentPrices(records,'2026-11').map(p=>p.pack),['30ML','50gm','future']);
});
