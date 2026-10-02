'use client';
import ChartPanel, { compact, exact, monthLabel, DataTable } from './ChartPanel.jsx';

export default function ProductView({data,onSource,onAgency}) {
  const product=data.productDetail, trend=data.trend, f=data.filters;
  const agencyColumns=[{label:'Agency',render:r=><button type="button" onClick={()=>onAgency(r.agency)}>{r.agency}</button>},
    ...[['Units sold','units',false],['Units received','purchased',false],['Closing units','qoh',false],['Stock value ₹','value',true]].map(([label,key,currency])=>({label,numeric:true,render:r=>exact(r[key],currency)})),
    {label:'Latest month vs prior',numeric:true,render:r=>r.growth==null?'—':<span className={r.growth<0?'negative':'positive'}>{r.growth>0?'+':''}{r.growth.toFixed(1)}%</span>}];
  return <section id="product-detail" aria-label={`${product.name} product analysis`}>
    <div className="product-context"><div className="product-tags">{[product.brand,product.sku && 'SKU '+product.sku,...product.statuses].filter(Boolean).map(tag=><span key={tag}>{tag}</span>)}</div><button className="button" onClick={()=>onSource({productKey:product.key})}>View source rows ↗</button></div>
    <div className="section-heading"><h2>Product performance</h2><span className="period-label">{f.start===f.end?monthLabel(f.end):monthLabel(f.start)+' – '+monthLabel(f.end)} · {f.agency||'All agencies'}</span></div>
    <section className="kpi-grid" aria-label="Product metrics">{[
      ['Units sold','units',false,'Selected period'],['Units received','purchased',false,'Agency purchases · selected period'],
      ['Closing stock','qoh',false,'Units remaining · '+monthLabel(f.end)],['Stock value','value',true,'Closing inventory · '+monthLabel(f.end)]
    ].map(([label,key,currency,note])=><article className="kpi" key={key}><p>{label}<span>{currency?'₹':'units'}</span></p><strong title={exact(product.metrics[key],currency)}>{compact(product.metrics[key],currency)}</strong><small>{note}</small><span className="kpi-line primary-line"/></article>)}</section>
    <section className="insights panel product-insights"><div className="insights-title"><span className="insight-icon" aria-hidden="true">✧</span><div><h2>Trends &amp; agency insights</h2><p>Calculated only from {product.name} observations</p></div></div><ul>{(product.insights.length?product.insights:['No product insights available for this selection.']).map(text=><li key={text}>{text}</li>)}</ul></section>
    <div className="chart-grid">
      <ChartPanel title="Sales over time" subtitle={`${product.name} · units sold by agency`} labels={trend.months.map(monthLabel)} datasets={trend.product.map(s=>({label:s.name,data:s.values}))}
        onPoint={i=>onSource({productKey:product.key,month:trend.months[i]})}
        columns={[{label:'Month',render:r=><button onClick={()=>onSource({productKey:product.key,month:r.month})}>{monthLabel(r.month)}</button>},...trend.product.map((s,i)=>({label:s.name+' units',numeric:true,render:r=>exact(r.values[i])}))]}
        rows={trend.months.map((month,i)=>({month,values:trend.product.map(s=>s.values[i])}))}/>
      <ChartPanel title="Sales by agency" subtitle="This product · selected period · units sold" type="bar" labels={product.agencies.map(r=>r.agency)} datasets={[{label:'Units sold',data:product.agencies.map(r=>r.units)}]}
        onPoint={i=>onAgency(product.agencies[i].agency)} columns={agencyColumns} rows={product.agencies}/>
    </div>
    <article className="panel product-agencies"><div className="panel-header"><div><h2>Agency sales &amp; stock</h2><p>Sales and receipts cover the selected period. Closing stock is the {monthLabel(f.end)} snapshot.</p></div><span className="tag">{product.observations} source rows</span></div><DataTable columns={agencyColumns} rows={product.agencies}/><p>Growth compares {monthLabel(f.end)} with {monthLabel(product.previousMonth)} using complete statements. Missing observations are shown as —. Select an agency to focus this product’s analysis.</p></article>
  </section>;
}
