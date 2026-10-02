import test from 'node:test';
import assert from 'node:assert/strict';
import Chart from 'chart.js/auto';
import {BasicPlatform} from 'chart.js';
import {chartScales,sharedValueRange} from '../lib/chart-scales.js';

// Run the real Chart.js scale/tick pipeline; drawing is irrelevant to tick labels.
function renderScales({labels,horizontal=false,type='bar',currency=false,values,valueRange}) {
  const canvas={width:800,height:400};
  const context=new Proxy({canvas,measureText:text=>({width:String(text).length*7}),getLineDash:()=>[]},{get:(target,key)=>key in target?target[key]:()=>{}});
  canvas.getContext=()=>context;
  return new Chart(canvas,{platform:BasicPlatform,type,data:{labels,datasets:[{label:'Values',data:values || labels.map((_,i)=>i+10)}]},options:{responsive:false,animation:false,indexAxis:horizontal?'y':'x',scales:chartScales({horizontal,currency,valueRange,axisUnit:currency?'₹':'Units'},v=>currency?'₹'+v:String(v))}});
}

test('monthly bar and line charts show month labels, not array indexes',()=>{
  const labels=['Jun 2026','Jul 2026','Aug 2026','Sept 2026'];
  for(const type of ['bar','line']){
    const chart=renderScales({labels,type});
    try {assert.deepEqual(chart.scales.x.ticks.map(t=>t.label),labels);} finally {chart.destroy();}
  }
});

test('agency comparison charts honor the same value-axis range',()=>{
  const charts=[[10,20],[1000,2000]].map(values=>renderScales({labels:['Aug','Sep'],values,valueRange:{min:0,max:2000}}));
  try {assert.equal(charts[0].scales.y.max,charts[1].scales.y.max);assert.equal(charts[0].scales.y.max,2000);}finally{charts.forEach(chart=>chart.destroy());}
});
test('horizontal rankings retain product names and numeric values keep their formatter',()=>{
  const labels=['API-TOP SYP','MD 1 ML'];
  const chart=renderScales({labels,horizontal:true,currency:true});
  try {
    assert.deepEqual(chart.scales.y.ticks.map(t=>t.label),labels);
    assert.ok(chart.scales.x.ticks.every(t=>t.label.startsWith('₹')));
  } finally {chart.destroy();}
});

test('shared chart ranges include zero and negative movements without clipping data',()=>{
  const values=[-15,0,83],valueRange=sharedValueRange([...values,null]);
  const chart=renderScales({labels:['Jul','Aug','Sep'],values,valueRange});
  try {
    assert.ok(chart.scales.y.min<=-15);assert.ok(chart.scales.y.max>=83);
    assert.ok(chart.scales.y.ticks.some(t=>t.value===0));
    assert.equal(chart.scales.y.min,valueRange.min);assert.equal(chart.scales.y.max,valueRange.max);
  }finally{chart.destroy();}
});

test('unknown line points remain gaps while a recorded zero is a plotted value',()=>{
  const chart=renderScales({labels:['Jun','Jul','Aug','Sep'],type:'line',values:[5,null,0,8]});
  try {
    const points=chart.getDatasetMeta(0).data;
    assert.equal(points[1].skip,true);assert.equal(points[2].skip,false);
    assert.equal(chart.data.datasets[0].data[1],null);
  }finally{chart.destroy();}
});
