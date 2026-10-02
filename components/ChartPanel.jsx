'use client';
import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export const colors = ['#315fcb','#239d98','#8b79b9','#b99a64','#7196b6'];
export const exact = (value, currency = false) => value == null ? '—' : (currency ? '₹' : '') + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export function compact(value, currency = false) {
  if (value == null) return '—';
  const abs = Math.abs(value), [divisor,suffix] = abs >= 1e7 ? [1e7,'Cr'] : abs >= 1e5 ? [1e5,'L'] : abs >= 1e3 ? [1e3,'K'] : [1,''];
  return (value < 0 ? '−' : '') + (currency ? '₹' : '') + (abs / divisor).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + suffix;
}
export const monthLabel = month => month ? new Date(month + '-01T12:00:00Z').toLocaleDateString('en-IN', { month:'short',year:'numeric',timeZone:'UTC' }) : '—';

export function DataTable({ columns, rows, empty = 'No data available' }) {
  if (!rows?.length) return <p className="empty-text">{empty}</p>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(c => <th key={c.label} scope="col">{c.label}</th>)}</tr></thead><tbody>{rows.map((r,i) => <tr key={r.key || r.sheetRow || i}>{columns.map(c => <td key={c.label} className={c.numeric ? 'num' : ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}

export default function ChartPanel({ title, subtitle, labels, datasets, currency = false, horizontal = false, type = 'line', onPoint, columns, rows, children }) {
  const canvas = useRef(null), onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;
  const signature = JSON.stringify({ labels,datasets,currency,horizontal,type });
  const available = datasets.some(s => s.data.some(v => v != null));
  useEffect(() => {
    if (!canvas.current || !available) return;
    const spec = JSON.parse(signature);
    const chart = new Chart(canvas.current, {
      type: spec.type,
      data: { labels: spec.labels, datasets: spec.datasets.map((s,i) => ({ label:s.label, data:s.data, borderColor:colors[i % colors.length], backgroundColor:colors[i % colors.length], borderWidth:spec.type === 'line' ? 2 : 0, pointRadius:3, pointHoverRadius:5, pointBackgroundColor:'#fff', pointBorderWidth:2, tension:.25, fill:false, borderRadius:4, maxBarThickness:spec.horizontal ? 17 : 24, spanGaps:false })) },
      options: {
        responsive:true, maintainAspectRatio:false, indexAxis:spec.horizontal ? 'y' : 'x', animation:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration:200 },
        interaction:{ mode:spec.horizontal ? 'nearest' : 'index', intersect:false },
        plugins:{ legend:{ display:spec.datasets.length > 1, position:'bottom', align:'start', labels:{ usePointStyle:true, boxWidth:6, boxHeight:6, padding:18, color:'#687586', font:{ size:10 } } }, tooltip:{ backgroundColor:'#233347', padding:12, callbacks:{ label:ctx => ctx.dataset.label + ': ' + exact(ctx.raw,spec.currency) + (spec.currency ? '' : ' units') } } },
        scales:{ x:{ grid:{ display:spec.horizontal,color:'#edf0f4' }, border:{ display:false }, ticks:{ color:'#8994a3',font:{ size:9 },maxRotation:0,callback:spec.horizontal ? v => compact(v,spec.currency) : undefined },beginAtZero:spec.horizontal }, y:{ grid:{ display:!spec.horizontal,color:'#edf0f4' },border:{ display:false },ticks:{ color:'#687586',font:{ size:spec.horizontal ? 10 : 9 },callback:spec.horizontal ? undefined : v => compact(v,spec.currency) },beginAtZero:!spec.horizontal } },
        onClick:(_,points) => { if (points.length) onPointRef.current?.(points[0].index); }
      }
    });
    return () => chart.destroy();
  }, [signature,available]);
  return <article className="panel"><div className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}<div className={'chart-wrap' + (horizontal ? ' tall' : '')}>{available ? <canvas ref={canvas} role="img" aria-label={title} /> : <p className="empty">No data available</p>}</div><details className="data-table"><summary>View exact values &amp; source rows</summary><DataTable columns={columns} rows={rows} /></details></article>;
}
