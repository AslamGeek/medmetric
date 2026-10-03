'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { chartScales } from '../lib/chart-scales.js';
import { displayMonth, displayPercentage, displayCoverage } from '../lib/analytics.js';

export const colors = ['#3489e0','#e65722','#8b79b9','#239d98','#b99a64'];
export const exact = (value, currency = false) => value == null ? '—' : (currency ? '₹' : '') + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export function compact(value, currency = false) {
  if (value == null) return '—';
  const abs = Math.abs(value), [divisor,suffix] = abs >= 1e7 ? [1e7,'Cr'] : abs >= 1e5 ? [1e5,'L'] : abs >= 1e3 ? [1e3,'K'] : [1,''];
  return (value < 0 ? '−' : '') + (currency ? '₹' : '') + (abs / divisor).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + suffix;
}
export const monthLabel = displayMonth;
export const percentage = value => displayPercentage(value,true);

export function DataTable({ columns, rows, empty = 'No data available' }) {
  if (!rows?.length) return <p className="empty-text">{empty}</p>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(c => <th key={c.label} scope="col">{c.label}</th>)}</tr></thead><tbody>{rows.map((r,i) => <tr key={r.key || r.sheetRow || i}>{columns.map(c => <td key={c.label} className={c.numeric ? 'num' : ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}

export default function ChartPanel({ title, subtitle, labels, datasets, currency = false, horizontal = false, type = 'line', onPoint, columns, rows, children, unit, interactionHint, valueRange, coverage, chartHeight, emptyText, stacked=false, xAxisTitle, yAxisTitle, referenceLines, selectDataset=false }) {
  const [view,setView]=useState('chart');
  const id=useId();
  const axisUnit=unit || (currency?'₹':'Units');
  const canvas = useRef(null), onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;
  const signature = JSON.stringify({ labels,datasets,currency,horizontal,type,axisUnit,valueRange,coverage,stacked,xAxisTitle,yAxisTitle,referenceLines,selectDataset });
  const available = datasets.some(s => s.data.some(v => v != null));
  useEffect(() => {
    if (view!=='chart' || !canvas.current || !available) return;
    const spec = JSON.parse(signature);
    const scatter=spec.type==='scatter';
    const mixed=spec.datasets.some(series=>series.type&&series.type!==spec.type);
    const scales=scatter?{
      x:{type:'linear',min:0,title:{display:true,text:spec.xAxisTitle||'Stock cover · days'},grid:{color:'#e5e9ee'},border:{display:false},ticks:{color:'#687586',callback:v=>compact(v)}},
      y:{type:'linear',beginAtZero:true,title:{display:true,text:spec.yAxisTitle||'Sales pace change · %'},grid:{color:'#e5e9ee'},border:{display:false},ticks:{color:'#687586',callback:v=>compact(v)+'%'}}
      }:chartScales(spec,v=>compact(v,spec.currency));
    if(spec.stacked) {scales.x.stacked=true;scales.y.stacked=true;}
    const guides={id:'signalReferenceLines',beforeDatasetsDraw(chart){
      if(!scatter||!spec.referenceLines)return;
      const {ctx,chartArea,scales:axes}=chart;ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle='#98acc5';ctx.lineWidth=1;
      for(const value of spec.referenceLines.x||[]) {const x=axes.x.getPixelForValue(value);if(x<chartArea.left||x>chartArea.right)continue;ctx.beginPath();ctx.moveTo(x,chartArea.top);ctx.lineTo(x,chartArea.bottom);ctx.stroke();}
      for(const value of spec.referenceLines.y||[]) {const y=axes.y.getPixelForValue(value);if(y<chartArea.top||y>chartArea.bottom)continue;ctx.beginPath();ctx.moveTo(chartArea.left,y);ctx.lineTo(chartArea.right,y);ctx.stroke();}
      ctx.restore();
    }};
    const chart = new Chart(canvas.current, {
      type: spec.type,
      data: { labels: spec.labels, datasets: spec.datasets.map((s,i) => {
        const datasetType=s.type||spec.type,color=s.color||colors[i % colors.length];
        return {type:datasetType,label:s.label,data:s.data,borderColor:color,backgroundColor:color,borderWidth:datasetType==='line'?2.5:0,borderDash:s.borderDash||[],order:mixed&&datasetType==='bar'?1:0,pointRadius:scatter?5:4,pointHitRadius:mixed&&datasetType==='line'?8:1,pointHoverRadius:7,pointBackgroundColor:color,pointBorderWidth:1,tension:0,fill:false,borderRadius:4,maxBarThickness:spec.horizontal?24:42,spanGaps:false};
      }) },
      plugins:[guides],
      options: {
        responsive:true, maintainAspectRatio:false, indexAxis:spec.horizontal ? 'y' : 'x', animation:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration:200 },
        interaction:{ mode:scatter||spec.horizontal ? 'nearest' : 'index', intersect:scatter },
        plugins:{ legend:{ display:true, position:'bottom', align:'start', labels:{ usePointStyle:true, generateLabels:chart=>Chart.defaults.plugins.legend.labels.generateLabels(chart).map(item=>({...item,pointStyle:chart.data.datasets[item.datasetIndex].type==='line'?'line':scatter?'circle':'rectRounded'})),sort:(a,b)=>a.datasetIndex-b.datasetIndex,boxWidth:12, boxHeight:12, padding:20, color:'#465366', font:{ size:12 } } }, tooltip:{ backgroundColor:'#233347', padding:12,itemSort:(a,b)=>a.datasetIndex-b.datasetIndex, callbacks:{ title:items=>{const item=items[0];if(!item)return '';if(scatter)return item.raw.name;const note=displayCoverage(spec.coverage?.[item.dataIndex]);return item.label+(note?' · '+note:'');},label:ctx => scatter?['Stock cover: '+exact(ctx.parsed.x)+' days','Daily sales pace change: '+percentage(ctx.parsed.y),'Review: '+ctx.dataset.label]:ctx.dataset.label + ': ' + exact(ctx.raw,spec.currency) + (spec.currency ? '' : ' '+spec.axisUnit.toLowerCase()) } } },
        scales,
        onClick:(event,points,chart) => {
          const selected=spec.selectDataset?chart.getElementsAtEventForMode(event,'nearest',{intersect:true},false):points;
          if (selected.length) onPointRef.current?.(selected[0].index,selected[0].datasetIndex);
        }
      }
    });
    return () => chart.destroy();
  }, [signature,available,view,chartHeight]);
  return <article className="panel chart-panel"><div className="panel-header"><div><h2 id={id+'-title'}>{title}</h2><p>{subtitle}</p></div><div className="chart-view-toggle" role="group" aria-label={title+' display'}>{[['chart','Chart'],['table','Table']].map(([key,label])=><button key={key} type="button" aria-pressed={view===key} aria-controls={id+'-content'} title={'Show '+label.toLowerCase()} onClick={()=>setView(key)}>{key==='chart'?<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3v14h14M5 12l4-5 4 3 4-5"/></svg>:<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1"/><path d="M3 8h14M3 12h14M8 4v12"/></svg>}<span>{label}</span></button>)}</div></div>{children}<div id={id+'-content'} aria-labelledby={id+'-title'}>{view==='chart'?<div className={'chart-wrap' + (horizontal ? ' tall' : '')} style={chartHeight?{height:chartHeight}:undefined}>{available ? <canvas ref={canvas} role="img" aria-label={title} /> : <p className="empty">{emptyText || 'No observations available for this selection'}</p>}</div>:<div className="chart-table-view"><DataTable columns={columns} rows={rows}/></div>}</div>{onPoint && <p className="chart-help">{interactionHint || 'Select a data point to explore its details.'}</p>}</article>;
}
