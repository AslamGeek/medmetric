import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLiquidity,productLiquidity,formatCoverDays} from '../lib/product-liquidity.js';
import {prepareData,dashboardModel} from '../lib/analytics.js';
import {productExplorerModel} from '../lib/product-explorer.js';

test('category boundaries are exact at 30, 90 and 180 days',()=>{
  for(const [cover,category] of [[29.999,'fast'],[30,'medium'],[90,'medium'],[90.001,'slow'],[180,'slow'],[180.001,'verySlow']]) {
    const result=classifyLiquidity({qoh:cover,units:90,days:90,complete:true});
    assert.equal(result.category,category);assert.equal(result.daysOfCover,cover);
  }
});
test('rounded cover labels never contradict Fast, Slow or Very slow boundary rules',()=>{
  assert.equal(formatCoverDays(29.999),'<30 days');
  assert.equal(formatCoverDays(90.001),'>90 days');
  assert.equal(formatCoverDays(180.001),'>180 days');
  assert.equal(formatCoverDays(30),'30 days');assert.equal(formatCoverDays(null),'—');
});
test('zero sales, zero stock and incomplete observations are distinct and never infinite',()=>{
  assert.equal(classifyLiquidity({qoh:10,units:0,days:90,complete:true}).category,'nonMoving');
  assert.equal(classifyLiquidity({qoh:10,units:0,days:90,complete:true}).daysOfCover,null);
  assert.equal(classifyLiquidity({qoh:0,units:null,days:90,complete:false}).category,'outOfStock');
  for(const change of [{qoh:null},{qoh:-1},{complete:false},{negative:true},{units:null}])assert.equal(classifyLiquidity({qoh:20,units:90,days:90,complete:true,...change}).category,'unknown');
});
function fixture() {
  const months=['2026-07','2026-08','2026-09'];
  const totals=months.flatMap(Month=>['A','B'].map(Agency=>({Month,Agency,Is_Full_Month:'YES',Purchase_Value:100,Sale_Value:100,Closing_Value:100})));
  const sales=months.flatMap(Month=>['A','B'].map(Agency=>({Month,Agency,Product_Name:'Product',Sale:Agency==='A'?40:10,QOH:Agency==='A'?20:100,Value:200})));
  const config=[{Raw_Product_Name:'Product',Your_Product_Name:'Product',Your_SKU:'X',Your_Brand_Group:'Brand',Include_In_Charts:'YES'}];
  return prepareData(totals,sales,config,'UTC');
}
test('classification uses three calendar months ending at To, with agency rates and combined stock/units',()=>{
  const result=dashboardModel(fixture(),{start:'2026-09',end:'2026-09'}).liquidity;
  assert.deepEqual(result.months,['2026-07','2026-08','2026-09']);assert.equal(result.days,92);
  assert.equal(result.agencies.find(row=>row.agency==='A').category,'fast');assert.equal(result.agencies.find(row=>row.agency==='B').category,'verySlow');
  assert.equal(result.products[0].category,'medium');assert.equal(result.products[0].daysOfCover,120*92/150);
  const range=dashboardModel(fixture(),{start:'2026-07',end:'2026-09'}).liquidity;
  assert.equal(range.products[0].daysOfCover,result.products[0].daysOfCover);
  const agency=dashboardModel(fixture(),{agency:'A'}).liquidity;
  assert.equal(agency.products[0].category,'fast');assert.equal(agency.products[0].agencies.length,1);
});
test('missing months, blank sales and partial statements suppress coverage for the affected agency and combined product',()=>{
  for(const mutate of [
    data=>{data.sales=data.sales.filter(r=>!(r.agency==='B'&&r.month==='2026-08'));},
    data=>{data.sales.find(r=>r.agency==='B'&&r.month==='2026-08').units=null;},
    data=>{data.monthly.find(r=>r.agency==='B'&&r.month==='2026-08').full=false;}
  ]) {
    const data=fixture();mutate(data);const result=productLiquidity(data,{end:'2026-09'});
    assert.equal(result.agencies.find(row=>row.agency==='A').category,'fast');
    assert.equal(result.agencies.find(row=>row.agency==='B').category,'unknown');assert.equal(result.products[0].category,'unknown');
  }
});
test('alias returns cannot cancel into a false non-moving claim; excluded products and brands stay filtered',()=>{
  const data=fixture();data.sales.forEach(r=>r.units=0);
  data.sales.push({...data.sales[0],units:4},{...data.sales[0],units:-4});
  assert.equal(productLiquidity(data,{end:'2026-09'}).products[0].category,'unknown');
  assert.equal(productLiquidity(data,{end:'2026-09',brand:'Another'}).products.length,0);
  data.sales.forEach(r=>r.include=false);
  assert.equal(productLiquidity(data,{end:'2026-09'}).products.length,0);
  assert.equal(productLiquidity(data,{end:'2026-09',includeExcluded:true}).products.length,1);
});
test('calendar day counts include leap February, and ageing observations do not set cover categories',()=>{
  const data=fixture();for(const r of [...data.monthly,...data.sales])r.month={'2026-07':'2023-12','2026-08':'2024-01','2026-09':'2024-02'}[r.month];
  data.sales.forEach(r=>r.age=9999);
  const result=productLiquidity(data,{end:'2024-02'});assert.equal(result.days,91);assert.equal(result.agencies.find(r=>r.agency==='A').category,'fast');
});
test('category filtering conserves chart counts and filters the explorer list independently of movement status',()=>{
  const data=dashboardModel(fixture(),{});
  const model=productExplorerModel(data.productAnalysis,data.options.products,{liquidity:data.liquidity,liquidityCategory:'medium',agencies:data.options.agencies});
  assert.equal(model.visible.length,1);assert.equal(model.visible[0].liquidity.category,'medium');
  assert.equal(model.liquidityMix.reduce((sum,row)=>sum+row.count,0),model.products.length);
  assert.equal(productExplorerModel(data.productAnalysis,data.options.products,{liquidity:data.liquidity,liquidityCategory:'fast'}).visible.length,0);
});
