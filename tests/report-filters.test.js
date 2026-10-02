import test from 'node:test';
import assert from 'node:assert/strict';
import {patchReportFilters,periodPreset,resolveVisualFilters,productDrillFilters} from '../lib/report-filters.js';
import {createDashboardSession} from '../lib/dashboard-session.js';
import {prepareData} from '../lib/analytics.js';

test('changing either period boundary keeps report and visual ranges chronological',()=>{
  const original={start:'2026-07',end:'2026-09',agency:'A',brand:'X'};
  assert.deepEqual(patchReportFilters(original,{start:'2026-10'}),{...original,start:'2026-10',end:'2026-10'});
  assert.deepEqual(patchReportFilters(original,{end:'2026-06'}),{...original,start:'2026-06',end:'2026-06'});
  assert.equal(original.start,'2026-07');
});

test('agency changes clear stale brands unless the patch explicitly supplies a valid brand',()=>{
  const scope={agency:'A',brand:'Only A'};
  assert.equal(patchReportFilters(scope,{agency:'B'}).brand,'');
  assert.equal(patchReportFilters(scope,{agency:'B',brand:'B brand'}).brand,'B brand');
});

test('quick periods are calendar ranges, clamp to loaded data and cross years correctly',()=>{
  const months=['2025-11','2025-12','2026-01','2026-02'];
  assert.deepEqual(periodPreset(months,'latest'),{start:'2026-02',end:'2026-02'});
  assert.deepEqual(periodPreset(months,'three','2026-01'),{start:'2025-11',end:'2026-01'});
  assert.deepEqual(periodPreset(months,'three','2025-12'),{start:'2025-11',end:'2025-12'});
  assert.deepEqual(periodPreset(months,'all'),{start:'2025-11',end:'2026-02'});
  assert.deepEqual(periodPreset([],'all'),{});
});

test('chart selections stay independent, and resetting an override follows current report filters',()=>{
  const report={start:'2026-07',end:'2026-09',agency:'',brand:'',product:'sku:X',includeExcluded:false};
  const sales={start:'2026-08',end:'2026-08',agency:'A',brand:'X'};
  const stock={start:'2026-09',end:'2026-09',agency:'B',brand:'Y'};
  assert.equal(resolveVisualFilters(report,sales).agency,'A');
  assert.equal(resolveVisualFilters(report,stock).agency,'B');
  const changed={...report,end:'2026-10',includeExcluded:true};
  assert.equal(resolveVisualFilters(changed,sales).end,'2026-08');
  assert.equal(resolveVisualFilters(changed,sales).includeExcluded,true);
  assert.equal(resolveVisualFilters(changed,null).end,'2026-10');
  assert.equal(resolveVisualFilters(report,sales).product,'');
  assert.equal(report.product,'sku:X');
});

test('drill into a product carries the visual period and agency instead of the report period',async()=>{
  const months=['2026-08','2026-09'];
  const monthly=months.flatMap(Month=>['A','B'].map(Agency=>({Month,Agency,Is_Full_Month:'YES',Purchase_Value:100,Sale_Value:100,Closing_Value:50})));
  const raw=months.flatMap((Month,i)=>['A','B'].map(Agency=>({Month,Agency,Product_Name:'Product',Sale:Agency==='A'?10+i:20+i,QOH:5,Value:50})));
  const config=[{Raw_Product_Name:'Product',Your_Product_Name:'Product',Your_SKU:'X',Your_Brand_Group:'Brand',Include_In_Charts:'YES'}];
  let reads=0;const session=createDashboardSession(async()=>{reads++;return prepareData(monthly,raw,config,'UTC');});
  await session.load();
  const report=session.dashboard({start:'2026-09',end:'2026-09'}).filters;
  const visual=session.dashboard(resolveVisualFilters(report,{start:'2026-08',end:'2026-08',agency:'B'}));
  const drill=productDrillFilters(visual.filters,'sku:X','B');
  assert.equal(session.dashboard(drill).productDetail.metrics.units,20);
  assert.equal(session.drilldown(drill,{}).rows[0].month,'2026-08');
  assert.equal(session.dashboard(report).filters.end,'2026-09');
  assert.equal(reads,1);
});
