import test from 'node:test';
import assert from 'node:assert/strict';
import Chart from 'chart.js/auto';
import {BasicPlatform} from 'chart.js';
import {chartScales} from '../lib/chart-scales.js';

// Run the real Chart.js scale/tick pipeline; drawing is irrelevant to tick labels.
function renderScales({labels,horizontal=false,type='bar',currency=false}) {
  const canvas={width:800,height:400};
  const context=new Proxy({canvas,measureText:text=>({width:String(text).length*7}),getLineDash:()=>[]},{get:(target,key)=>key in target?target[key]:()=>{}});
  canvas.getContext=()=>context;
  return new Chart(canvas,{platform:BasicPlatform,type,data:{labels,datasets:[{label:'Values',data:labels.map((_,i)=>i+10)}]},options:{responsive:false,animation:false,indexAxis:horizontal?'y':'x',scales:chartScales({horizontal,currency,axisUnit:currency?'₹':'Units'},v=>currency?'₹'+v:String(v))}});
}

test('monthly bar and line charts show month labels, not array indexes',()=>{
  const labels=['Jun 2026','Jul 2026','Aug 2026','Sept 2026'];
  for(const type of ['bar','line']){
    const chart=renderScales({labels,type});
    try {assert.deepEqual(chart.scales.x.ticks.map(t=>t.label),labels);} finally {chart.destroy();}
  }
});
test('horizontal rankings retain product names and numeric values keep their formatter',()=>{
  const labels=['API-TOP SYP','MD 1 ML'];
  const chart=renderScales({labels,horizontal:true,currency:true});
  try {
    assert.deepEqual(chart.scales.y.ticks.map(t=>t.label),labels);
    assert.ok(chart.scales.x.ticks.every(t=>t.label.startsWith('₹')));
  } finally {chart.destroy();}
});
