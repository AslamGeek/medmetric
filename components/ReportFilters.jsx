'use client';
import {monthLabel} from './ChartPanel.jsx';
import {periodPreset} from '../lib/report-filters.js';

export default function ReportFilters({data,onChange,onReset,visual=false,custom=false,disabled=false}) {
  const f=data.filters,o=data.options;
  return <fieldset className={visual?'visual-slicers':'report-slicers'} disabled={disabled} aria-label={visual?'Chart filters':'Report filters'}>
    <div className="slicer-heading"><span>{visual?(custom?'Chart filters':'Following report filters'):'Report filters'}</span><div className="period-presets" role="group" aria-label="Period shortcuts">{[['latest','Latest'],['three','3 months'],['all','All time']].map(([key,label])=><button type="button" key={key} onClick={()=>onChange(periodPreset(o.months,key,f.end))}>{label}</button>)}</div>{onReset&&<button className="text-button" type="button" onClick={onReset}>{visual?'Use report filters':'Reset'}</button>}</div>
    <div className="slicer-fields"><label>From<select value={f.start} onChange={e=>onChange({start:e.target.value})}>{o.months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label><label>To<select value={f.end} onChange={e=>onChange({end:e.target.value})}>{o.months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label><label>Agency<select value={f.agency} onChange={e=>onChange({agency:e.target.value})}><option value="">All agencies</option>{o.agencies.map(a=><option key={a}>{a}</option>)}</select></label><label>Brand<select value={f.brand} onChange={e=>onChange({brand:e.target.value})}><option value="">All brands</option>{o.brands.map(b=><option key={b}>{b}</option>)}</select></label></div>
  </fieldset>;
}
