import { createHmac } from 'node:crypto';
process.env.MEDMETRIC_BACKEND_SECRET='backend-secret-for-synthetic-tests-only';
process.env.APPS_SCRIPT_URL='https://script.google.com/macros/s/test/exec';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleData } from '../lib/api.js';
import { readSheet, tableRecords } from '../lib/sheets.js';
import { HEADERS, prepareData, dashboardModel, drilldownModel } from '../lib/analytics.js';

const totals = [
  { _row:2,Statement_ID:'M-AUG',Month:'2026-08',Agency:'MADHU',Is_Full_Month:'YES',Purchase_Value:60,Sale_Value:100,Closing_Value:80,Opening_Value:50 },
  { _row:3,Statement_ID:'M-SEP',Month:'2026-09',Agency:'MADHU',Is_Full_Month:'YES',Purchase_Value:70,Sale_Value:120,Closing_Value:30,Opening_Value:80 },
  { _row:4,Statement_ID:'E-AUG',Month:'2026-08',Agency:'MEDA',Is_Full_Month:'YES',Purchase_Value:20,Sale_Value:50,Closing_Value:20,Opening_Value:30 },
  { _row:5,Statement_ID:'E-SEP',Month:'2026-09',Agency:'MEDA',Is_Full_Month:'YES',Purchase_Value:30,Sale_Value:60,Closing_Value:10,Opening_Value:20 }
];
const raw = [
  { _row:2,Month:'2026-09',Agency:'MADHU',Product_Name:'ALIAS ONE',Sale:10,Purc:20,QOH:30,Value:100,Age:12,Source_PDF:'a.pdf' },
  { _row:3,Month:'2026-09',Agency:'MEDA',Product_Name:'ALIAS TWO',Sale:5,Purc:10,QOH:10,Value:50,Age:20,Source_PDF:'b.pdf' },
  { _row:4,Month:'2026-09',Agency:'MADHU',Product_Name:'EXCLUDED',Sale:0,Purc:0,QOH:2,Value:30,Age:100,Source_PDF:'c.pdf' }
];
const config = [
  { Raw_Product_Name:'ALIAS ONE',Agency_Reference:'MADHU',Your_Product_Name:'Canonical',Your_SKU:'ONE',Your_Brand_Group:'BRAND',Your_Status:'ACTIVE',Include_In_Charts:'YES' },
  { Raw_Product_Name:'ALIAS TWO',Agency_Reference:'MEDA',Your_Product_Name:'Canonical',Your_SKU:'ONE',Your_Brand_Group:'BRAND',Your_Status:'ACTIVE',Include_In_Charts:'YES' },
  { Raw_Product_Name:'EXCLUDED',Agency_Reference:'MADHU',Your_Product_Name:'Old product',Your_SKU:'OLD',Your_Brand_Group:'BRAND',Your_Status:'OLD_PACK',Include_In_Charts:'NO' }
];
const data = () => prepareData(totals,raw,config,'Etc/UTC');
const request = (body={filters:{}},headers={}) => new Request('https://medmetric.example/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('dashboard opens without an access code or authorization header',async()=>{
  let called=false;const res=await handleData(request(),'dashboard',async()=>{called=true;return data();});
  assert.equal(res.status,200);assert.equal(called,true);assert.match(res.headers.get('cache-control'),/no-store/);
  assert.equal((await res.json()).kpis.secondary,180);
});
test('drilldown also works without login',async()=>{
  const res=await handleData(request({request:{kind:'product'}}),'drilldown',async()=>data());
  assert.equal(res.status,200);assert.ok((await res.json()).rows.length>0);
});
test('cross-origin requests are rejected before reading data',async()=>{
  const res=await handleData(request({}, {Origin:'https://untrusted.example'}),'dashboard',()=>{throw Error('must not load');});assert.equal(res.status,403);
});
test('malformed JSON and invalid filter shapes return 400',async()=>{
  const malformed=new Request('https://medmetric.example/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer valid-test-token-long-enough'},body:'{'});
  assert.equal((await handleData(malformed,'dashboard')).status,400);
  assert.equal((await handleData(request({filters:[]}), 'dashboard')).status,400);
  assert.equal((await handleData(request({filters:{minAge:-1}}),'dashboard')).status,400);
});
test('oversized input, invalid pagination and unknown drill kinds are rejected',async()=>{
  assert.equal((await handleData(request({filters:{product:'x'.repeat(17000)}}),'dashboard')).status,413);
  assert.equal((await handleData(request({request:{offset:-1}}),'drilldown')).status,400);
  assert.equal((await handleData(request({request:{kind:'arbitrary-code'}}),'drilldown')).status,400);
});
test('financial and product semantics are preserved',()=>{
  const d=dashboardModel(data(),{});assert.equal(d.kpis.primary,100);assert.equal(d.kpis.secondary,180);assert.equal(d.kpis.closing,40);assert.equal(d.kpis.comparison.value,20);
  assert.equal(d.topProducts[0].units,15);assert.equal(d.inventory[0].value,150);assert.equal(d.topProducts.length,1);
});
test('range flows accumulate while closing stock is an end-month snapshot',()=>{
  const d=dashboardModel(data(),{start:'2026-08',end:'2026-09'});assert.equal(d.kpis.secondary,330);assert.equal(d.kpis.closing,40);assert.equal(d.kpis.comparison.value,null);
});
test('product and brand filters do not reinterpret agency rupee totals',()=>{
  assert.equal(dashboardModel(data(),{product:'sku:ONE',brand:'BRAND'}).kpis.secondary,180);
  assert.equal(dashboardModel(data(),{agency:'MADHU'}).kpis.secondary,120);
});
test('unmapped aliases are retained and excluded by default',()=>{
  const d=prepareData(totals,[...raw,{...raw[0],Product_Name:'unknown',_row:5}],config,'Etc/UTC');
  assert.equal(dashboardModel(d,{}).diagnostics.unmappedRawCount,1);assert.equal(dashboardModel(d,{}).topProducts.length,1);assert.equal(dashboardModel(d,{includeExcluded:true}).topProducts.length,3);
});
test('blank metrics are unknown and zero baselines suppress growth',()=>{
  const t=totals.map(r=>({...r,Sale_Value:r.Month==='2026-08'?0:r.Sale_Value}));
  const d=prepareData(t,[{...raw[0],Sale:''}],config,'Etc/UTC');assert.equal(dashboardModel(d,{}).kpis.comparison.value,null);assert.equal(dashboardModel(d,{}).topProducts[0].units,null);
});
test('duplicate monthly statements fail rather than double count',()=>{
  assert.throws(()=>prepareData([...totals,totals[0]],raw,config,'Etc/UTC'),/Multiple MONTHLY_TOTALS/);
});
test('partial-month comparisons are unavailable',()=>{
  const t=totals.map(r=>({...r,Is_Full_Month:r.Month==='2026-09'?'NO':'YES'}));assert.equal(dashboardModel(prepareData(t,raw,config,'Etc/UTC'),{}).kpis.comparison.value,null);
});
test('empty data renders no-data summaries',()=>{const d=dashboardModel(prepareData([],[],[],'Etc/UTC'),{});assert.equal(d.kpis.primary,null);assert.equal(d.topProducts.length,0);});
test('drill-down is bounded and preserves raw name and stock age observations',()=>{
  const many=Array.from({length:110},(_,i)=>({...raw[0],_row:i+2}));const d=prepareData(totals,many,config,'Etc/UTC');
  const rows=drilldownModel(d,{}, {offset:50});assert.equal(rows.rows.length,50);assert.equal(rows.total,110);assert.equal(rows.rows[0].rawName,'ALIAS ONE');assert.equal(rows.rows[0].age,12);
});
test('source records validate headers and ignore unrequested columns',()=>{
  const name='PRODUCT_CONFIG',headers=HEADERS[name];const rows=tableRecords([headers,headers.map(h=>config[0][h]||'')],name);assert.equal(rows[0]._row,2);assert.equal(rows[0].Your_SKU,'ONE');assert.throws(()=>tableRecords([['Wrong']],name),/missing headers/);
});
test('signed Apps Script request reads three tables without forwarding access code',async()=>{
  const groups=[totals,raw,config],names=['MONTHLY_TOTALS','SALES_RAW','PRODUCT_CONFIG'];
  const fetched=await readSheet(async(url,options)=>{
    assert.equal(url,process.env.APPS_SCRIPT_URL);assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');
    const packet=JSON.parse(options.body);
    assert.equal(packet.signature,createHmac('sha256',process.env.MEDMETRIC_BACKEND_SECRET).update(packet.payload).digest('hex'));
    assert.ok(!options.body.includes(process.env.MEDMETRIC_BACKEND_SECRET));
    return Response.json({ok:true,valueRanges:groups.map((rows,i)=>({values:[HEADERS[names[i]],...rows.map(r=>HEADERS[names[i]].map(h=>r[h]??''))]}))});
  });assert.equal(dashboardModel(fetched,{}).kpis.secondary,180);
});
test('backend configuration does not require a dashboard access code',async()=>{
  const {backendConfigured}=await import('../lib/sheets.js');
  assert.equal(backendConfigured(),true);
});
test('backend rejection and HTML login responses fail closed',async()=>{
  for(const response of [Response.json({ok:false,error:'Unauthorized'}),new Response('<html>Login</html>')])await assert.rejects(()=>readSheet(process.env.MEDMETRIC_ACCESS_CODE,async()=>response),e=>e.status===502);
});
test('upstream internals and tokens are not leaked in unexpected errors',async()=>{
  const res=await handleData(request(),'dashboard',()=>{throw Error('private-access-token credential');});assert.equal(res.status,502);assert.ok(!(await res.text()).includes('credential'));
});
