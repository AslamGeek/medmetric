'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { chartScales } from '../lib/chart-scales.js';
import { displayMonth, displayPercentage } from '../lib/analytics.js';

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

export default function ChartPanel({ title, subtitle, labels, datasets, currency = false, horizontal = false, type = 'line', onPoint, columns, rows, children, unit, interactionHint, valueRange, takeaway, coverage, chartHeight, emptyText }) {
  const [view,setView]=useState('chart');
  const id=useId();
  const axisUnit=unit || (currency?'₹':'Units');
  const canvas = useRef(null), onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;
  const signature = JSON.stringify({ labels,datasets,currency,horizontal,type,axisUnit,valueRange,coverage });
  const available = datasets.some(s => s.data.some(v => v != null));
  useEffect(() => {
    if (view!=='chart' || !canvas.current || !available) return;
    const spec = JSON.parse(signature);
    const chart = new Chart(canvas.current, {
      type: spec.type,
      data: { labels: spec.labels, datasets: spec.datasets.map((s,i) => ({ label:s.label, data:s.data, borderColor:s.color || colors[i % colors.length], backgroundColor:s.color || colors[i % colors.length], borderWidth:spec.type === 'line' ? 2.5 : 0, pointRadius:4, pointHoverRadius:6, pointBackgroundColor:s.color || colors[i % colors.length], pointBorderWidth:1, tension:0, fill:false, borderRadius:4, maxBarThickness:spec.horizontal ? 24 : 42, spanGaps:false })) },
      options: {
        responsive:true, maintainAspectRatio:false, indexAxis:spec.horizontal ? 'y' : 'x', animation:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration:200 },
        interaction:{ mode:spec.horizontal ? 'nearest' : 'index', intersect:false },
        plugins:{ legend:{ display:true, position:'bottom', align:'start', labels:{ usePointStyle:true, pointStyle:spec.type==='line'?'line':'rectRounded', boxWidth:12, boxHeight:12, padding:20, color:'#465366', font:{ size:12 } } }, tooltip:{ backgroundColor:'#233347', padding:12, callbacks:{ title:items=>{const item=items[0];if(!item)return '';const coverage=spec.coverage?.[item.dataIndex];return item.label+(coverage&&coverage!=='Full month'?' · '+coverage:'');},label:ctx => ctx.dataset.label + ': ' + exact(ctx.raw,spec.currency) + (spec.currency ? '' : ' '+spec.axisUnit.toLowerCase()) } } },
        scales:chartScales(spec,v=>compact(v,spec.currency)),
        onClick:(_,points) => { if (points.length) onPointRef.current?.(points[0].index); }
      }
    });
    return () => chart.destroy();
  }, [signature,available,view,chartHeight]);
  return <article className="panel chart-panel"><div className="panel-header"><div><h2 id={id+'-title'}>{title}</h2><p>{subtitle}</p></div><div className="chart-view-toggle" role="group" aria-label={title+' display'}>{[['chart','Chart'],['table','Table']].map(([key,label])=><button key={key} type="button" aria-pressed={view===key} aria-controls={id+'-content'} title={'Show '+label.toLowerCase()} onClick={()=>setView(key)}>{key==='chart'?<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3v14h14M5 12l4-5 4 3 4-5"/></svg>:<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1"/><path d="M3 8h14M3 12h14M8 4v12"/></svg>}<span>{label}</span></button>)}</div></div>{children}<div id={id+'-content'} aria-labelledby={id+'-title'}>{view==='chart'?<div className={'chart-wrap' + (horizontal ? ' tall' : '')} style={chartHeight?{height:chartHeight}:undefined}>{available ? <canvas ref={canvas} role="img" aria-label={title} /> : <p className="empty">{emptyText || 'No observations available for this selection'}</p>}</div>:<div className="chart-table-view"><DataTable columns={columns} rows={rows}/></div>}</div>{takeaway && <div className="chart-takeaway">{(Array.isArray(takeaway)?takeaway:[takeaway]).map(text=><p key={text}>{text}</p>)}</div>}{onPoint && <p className="chart-help">{interactionHint || 'Select a data point to explore its details.'}</p>}</article>;
}
